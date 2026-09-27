/**
 * El núcleo de "asegurar una entidad", sin autorización.
 *
 * Existe por la misma razón que `agent-assets-core` y `agent-maasy-core`: hay **dos** puertas que crean
 * entidades —el tool `ensure_entity` del MCP y la pantalla de entidades de la UI— y una entidad que no
 * está en Maasy (un dealer independiente de Autex, por ejemplo) tiene que poder nacer por la interfaz.
 * Si la lógica viviera dentro del tool, la UI tendría que duplicar la idempotencia y las dos puertas
 * podrían divergir: la misma web crearía dos entidades según por dónde entró.
 *
 * Acá no hay autorización: quien llama ya se autenticó. La autorización vive en las dos puertas.
 */

import { agentBrandEntities, type NewAgentBrandEntity } from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { hostOf } from "@/lib/report-agent";

export const ENTITY_TYPES = ["umbrella", "product"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export interface EnsureEntityInput {
	brandId: string;
	name: string;
	entityType: EntityType;
	websiteUrl?: string;
	parentEntityId?: string;
	maasyProjectId?: string;
	isPrimary?: boolean;
}

export interface EnsureEntityResult {
	entityId: string;
	created: boolean;
	updated: boolean;
}

/**
 * Un error de entrada del núcleo. La puerta decide cómo lo traduce: el MCP lo convierte en
 * `ToolInputError` para no cambiar su contrato de respuesta, y la UI lo muestra tal cual.
 */
export class EnsureEntityError extends Error {}

/** Lo mínimo de una entidad para resolver la idempotencia y validar la jerarquía. */
export interface EntityHierarchyRow {
	id: string;
	parentEntityId: string | null;
	websiteUrl: string | null;
	maasyProjectId: string | null;
}

/**
 * La clave de idempotencia, en orden: el proyecto de Maasy gana sobre el host.
 *
 * El proyecto es un vínculo explícito y el host es una heurística; si los dos apuntan a entidades
 * distintas, quedarse con el proyecto evita pisar la entidad que ya se midió por su web. `matchedBy`
 * se devuelve para que la puerta pueda decir *por qué* reusó una entidad en vez de crearla.
 */
export function resolveExistingEntity(
	rows: EntityHierarchyRow[],
	keys: { maasyProjectId?: string | undefined; siteHost: string | null },
): { row: EntityHierarchyRow; matchedBy: "maasyProjectId" | "host" } | null {
	if (keys.maasyProjectId !== undefined) {
		const byProject = rows.find((row) => row.maasyProjectId === keys.maasyProjectId);
		if (byProject !== undefined) return { row: byProject, matchedBy: "maasyProjectId" };
	}
	if (keys.siteHost !== null) {
		const byHost = rows.find((row) => hostOf(row.websiteUrl) === keys.siteHost);
		if (byHost !== undefined) return { row: byHost, matchedBy: "host" };
	}
	return null;
}

/**
 * Valida la jerarquía antes de escribir. Un padre de otra marca o un ciclo hacen que la generación de
 * assets falle más tarde, cuando el error ya es caro de rastrear; acá se dice en el momento.
 */
export function assertEntityHierarchy(
	rows: Array<{ id: string; parentEntityId: string | null }>,
	entityId: string | null,
	parentEntityId: string | undefined,
): void {
	if (parentEntityId === undefined) return;
	const parent = rows.find((row) => row.id === parentEntityId);
	if (parent === undefined) {
		throw new EnsureEntityError(`"parentEntityId" ${parentEntityId} no pertenece a esta marca.`);
	}
	if (findUmbrellaEntity(rows, parentEntityId) === null) {
		throw new EnsureEntityError(
			`La jerarquía de "${parentEntityId}" ya está rota o tiene un ciclo: hay que repararla antes.`,
		);
	}
	if (entityId === null) return;
	if (entityId === parentEntityId) throw new EnsureEntityError("Una entidad no puede ser su propio padre.");
	const proposed = rows.map((row) => (row.id === entityId ? { ...row, parentEntityId } : row));
	if (findUmbrellaEntity(proposed, entityId) === null) {
		throw new EnsureEntityError(
			`Ese padre crearía un ciclo: "${parentEntityId}" desciende de la entidad que se está editando.`,
		);
	}
}

/**
 * Crea o actualiza una entidad de forma idempotente.
 *
 * Idempotencia por `maasyProjectId` o por host de `websiteUrl`: reintentar no duplica. Los campos que
 * no vienen no se tocan, y la jerarquía se valida contra la marca dueña. Devuelve `updated` además de
 * `created` porque "no se creó" puede significar dos cosas distintas y el consumidor necesita saber
 * cuál: se reusó y se pisó una fila, o se reusó y no había nada que cambiar.
 */
export async function ensureEntity(input: EnsureEntityInput): Promise<EnsureEntityResult> {
	const [brand] = await db.select({ id: brands.id }).from(brands).where(eq(brands.id, input.brandId)).limit(1);
	if (brand === undefined) {
		throw new EnsureEntityError(
			`No existe la marca "${input.brandId}". Creala primero con ensure_brand o mirá list_brands.`,
		);
	}

	const siteHost = input.websiteUrl === undefined ? null : hostOf(input.websiteUrl);
	if (input.websiteUrl !== undefined && siteHost === null) {
		throw new EnsureEntityError(`"websiteUrl" no es una URL usable: ${input.websiteUrl}`);
	}

	const rows = await db
		.select({
			id: agentBrandEntities.id,
			parentEntityId: agentBrandEntities.parentEntityId,
			websiteUrl: agentBrandEntities.websiteUrl,
			maasyProjectId: agentBrandEntities.maasyProjectId,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.brandId, input.brandId));

	const existing = resolveExistingEntity(rows, {
		maasyProjectId: input.maasyProjectId,
		siteHost,
	});
	assertEntityHierarchy(rows, existing?.row.id ?? null, input.parentEntityId);

	if (existing !== null) {
		const patch: Partial<NewAgentBrandEntity> = { name: input.name, entityType: input.entityType };
		if (input.websiteUrl !== undefined) patch.websiteUrl = input.websiteUrl;
		if (input.parentEntityId !== undefined) patch.parentEntityId = input.parentEntityId;
		if (input.maasyProjectId !== undefined) patch.maasyProjectId = input.maasyProjectId;
		if (input.isPrimary !== undefined) patch.isPrimary = input.isPrimary;
		await db
			.update(agentBrandEntities)
			.set(patch)
			.where(and(eq(agentBrandEntities.id, existing.row.id), eq(agentBrandEntities.brandId, input.brandId)));
		return { entityId: existing.row.id, created: false, updated: true };
	}

	const values: NewAgentBrandEntity = {
		brandId: input.brandId,
		name: input.name,
		entityType: input.entityType,
		websiteUrl: input.websiteUrl ?? null,
	};
	if (input.parentEntityId !== undefined) values.parentEntityId = input.parentEntityId;
	if (input.maasyProjectId !== undefined) values.maasyProjectId = input.maasyProjectId;
	if (input.isPrimary !== undefined) values.isPrimary = input.isPrimary;
	const [inserted] = await db.insert(agentBrandEntities).values(values).returning({ id: agentBrandEntities.id });
	return { entityId: inserted.id, created: true, updated: false };
}
