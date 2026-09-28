/**
 * El núcleo de las pruebas de marca: leer la entidad con su paraguas y marcar qué se hereda.
 *
 * Vive acá y no en la server function por la misma razón que `agent-assets-core`: la pantalla de
 * Pruebas y el MCP tienen que decidir **lo mismo**. Si cada puerta armara su propia lista de heredadas,
 * la pantalla podría decir "heredás 3" mientras el bundle declara 0, que es el error que este módulo
 * existe para impedir.
 *
 * La regla —qué se hereda, qué gana y qué queda afuera— no se escribe acá: vive en
 * `@workspace/aos-aps/claims`, que es puro y se prueba sin base. Acá solo se leen filas y se serializan.
 */

import { inheritedRowsFor, resolveBundleClaims, type UmbrellaClaims } from "@workspace/aos-aps/claims";
import { type AgentBrandClaim, agentBrandClaims, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { and, asc, eq } from "drizzle-orm";

/** Todo lo que la UI y el MCP necesitan mostrar de una prueba, con las dos marcas de la herencia. */
export function serializeClaim(row: AgentBrandClaim) {
	return {
		id: row.id,
		claimId: row.claimId,
		statement: row.statement,
		metric: row.metric,
		category: row.category,
		boundaryApplicableFor: row.boundaryApplicableFor,
		boundaryNotApplicableFor: row.boundaryNotApplicableFor,
		confidence: row.confidence,
		proofType: row.proofType,
		proofTitle: row.proofTitle,
		proofSummary: row.proofSummary,
		proofClient: row.proofClient,
		verifiableBy: row.verifiableBy,
		confidentiality: row.confidentiality,
		sourceFragment: row.sourceFragment,
		status: row.status,
		/** Si las sub-entidades de esta marca pueden heredarla. Lo decide el operador. */
		inheritable: row.inheritable,
		/** La entidad de la que salió esta fila cuando es una copia heredada; null si es propia. */
		inheritedFromEntityId: row.inheritedFromEntityId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type SerializedClaim = ReturnType<typeof serializeClaim>;

export interface ClaimsContext {
	/** Las filas guardadas de la entidad consultada, propias y copias. */
	rows: AgentBrandClaim[];
	/** El paraguas del que hereda, con sus filas. `null` cuando la entidad **es** el paraguas. */
	umbrella: UmbrellaClaims | null;
	/** La entidad paraguas de la jerarquía, siempre presente (o se falla). */
	umbrellaEntity: { id: string; name: string };
	isUmbrella: boolean;
}

/**
 * Lee la entidad con su jerarquía y el paraguas del que hereda.
 *
 * Una entidad que **es** el paraguas no hereda de nadie: heredar de sí misma duplicaría sus pruebas.
 * Una jerarquía rota falla explícitamente en vez de inventar una raíz, igual que al firmar.
 */
export async function loadClaimsContext(brandId: string, entityId: string): Promise<ClaimsContext> {
	const hierarchy = await db
		.select({
			id: agentBrandEntities.id,
			parentEntityId: agentBrandEntities.parentEntityId,
			name: agentBrandEntities.name,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.brandId, brandId));
	const umbrellaEntity = findUmbrellaEntity(hierarchy, entityId);
	if (umbrellaEntity === null) throw new Error("Entity hierarchy is incomplete: no umbrella found");

	const rows = await readEntityClaims(brandId, entityId);
	const isUmbrella = umbrellaEntity.id === entityId;
	const umbrella = isUmbrella
		? null
		: { claims: await readEntityClaims(brandId, umbrellaEntity.id), entityName: umbrellaEntity.name };
	return { rows, umbrella, umbrellaEntity: { id: umbrellaEntity.id, name: umbrellaEntity.name }, isUmbrella };
}

function readEntityClaims(brandId: string, entityId: string): Promise<AgentBrandClaim[]> {
	return db
		.select()
		.from(agentBrandClaims)
		.where(and(eq(agentBrandClaims.brandId, brandId), eq(agentBrandClaims.entityId, entityId)))
		.orderBy(asc(agentBrandClaims.createdAt));
}

/** Las pruebas que la entidad hereda de verdad, ya filtradas por la regla pura. */
export function inheritedClaimsOf(context: ClaimsContext): AgentBrandClaim[] {
	return inheritedRowsFor({ saved: context.rows, umbrella: context.umbrella ?? undefined });
}

/**
 * Cuántos claims declara el bundle de la entidad.
 *
 * Es el mismo cálculo que hace el generador —`resolveBundleClaims`— y no una copia: lo que muestra la
 * pantalla es lo que va a quedar firmado.
 */
export function bundleClaimCountOf(context: ClaimsContext, dna: Record<string, unknown> | undefined): number {
	return resolveBundleClaims({ dna, saved: context.rows, umbrella: context.umbrella ?? undefined }).claims.length;
}

export class ClaimNotFoundError extends Error {}

/**
 * Cambia la marca de heredable de una prueba.
 *
 * Solo toca esa columna: la afirmación, la prueba y el estado no se modifican desde acá. Una prueba que
 * no existe no se crea —marcar algo que no está sería inventar evidencia—.
 */
export async function setClaimInheritable(input: {
	brandId: string;
	entityId: string;
	claimId: string;
	inheritable: boolean;
}): Promise<SerializedClaim> {
	const claimId = input.claimId.trim();
	const [updated] = await db
		.update(agentBrandClaims)
		.set({ inheritable: input.inheritable, updatedAt: new Date() })
		.where(
			and(
				eq(agentBrandClaims.brandId, input.brandId),
				eq(agentBrandClaims.entityId, input.entityId),
				eq(agentBrandClaims.claimId, claimId),
			),
		)
		.returning();
	if (updated === undefined) {
		throw new ClaimNotFoundError(`No existe la prueba "${claimId}" en esa entidad.`);
	}
	return serializeClaim(updated);
}
