/**
 * Las server functions del código de conexión: la puerta de la UI.
 *
 * Es la hermana de `scripts/beaos-enroll.sh`. Las dos generan lo mismo —un código de un solo uso, atado
 * a una marca y una entidad— y las dos lo imprimen una sola vez; lo que cambia es quién aprieta el
 * botón. La lógica vive en `@/lib/enrollment.server` para que no haya dos implementaciones del canje.
 *
 * El `entityId` no se le pide al operador: nadie tiene un UUID a mano. Si la marca todavía no tiene su
 * entidad, se crea acá —el sitio de WordPress es la marca que firma, así que es `umbrella`: el mismo
 * criterio que el paso 2 del asistente del plugin— y se avisa que se creó.
 */

import { createServerFn } from "@tanstack/react-start";
import { agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { createEnrollmentCode, listEnrollmentCodes, revokeEnrollmentCode } from "@/lib/enrollment.server";
import { ensureEntity } from "@/server/agent-entities-core";

export interface SiteEnrollmentCode {
	/** El código en claro. Viaja al navegador **una sola vez**: no se puede volver a pedir. */
	code: string;
	prefix: string;
	brandId: string;
	entityId: string;
	expiresAt: string;
	/** `true` si la entidad se creó en este mismo paso (la marca no tenía ninguna). */
	entityCreated: boolean;
}

/**
 * Genera el código de conexión para el sitio.
 *
 * Garantiza que la marca tenga una entidad —la crea si no la hay, con el nombre y la web de la marca—
 * porque el código está atado a una entidad **y** a una marca: sin entidad no hay kit que el plugin
 * pueda servir, y el canje devolvería un `entityId` que no existe.
 */
export const createSiteEnrollmentCodeFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			/** Etiqueta para el listado ("wordpress-acme-com"). Trazabilidad, no seguridad. */
			label: z.string().trim().max(200).optional(),
		}),
	)
	.handler(async ({ data }): Promise<SiteEnrollmentCode> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const [brand] = await db
			.select({ id: brands.id, name: brands.name, website: brands.website })
			.from(brands)
			.where(eq(brands.id, data.brandId))
			.limit(1);
		if (brand === undefined) throw new Error(`No existe la marca "${data.brandId}".`);

		// La entidad primaria de la marca, si ya existe. `isPrimary` primero: es la que el asistente del
		// plugin crea para el sitio, y es la que el kit sirve.
		const [existing] = await db
			.select({ id: agentBrandEntities.id })
			.from(agentBrandEntities)
			.where(eq(agentBrandEntities.brandId, data.brandId))
			.orderBy(desc(agentBrandEntities.isPrimary), agentBrandEntities.createdAt)
			.limit(1);

		let entityId: string;
		let entityCreated = false;
		if (existing !== undefined) {
			entityId = existing.id;
		} else {
			// La misma función que usa el tool `ensure_entity` del MCP: la idempotencia por host y la
			// validación de jerarquía no se duplican acá. `maasyProjectId` no se manda (la marca puede no
			// estar en Maasy) y `parentEntityId` tampoco: una `umbrella` no cuelga de nada.
			const created = await ensureEntity({
				brandId: brand.id,
				name: brand.name,
				entityType: "umbrella",
				websiteUrl: brand.website,
				isPrimary: true,
			});
			entityId = created.entityId;
			entityCreated = created.created;
		}

		const code = await createEnrollmentCode({
			brandId: brand.id,
			entityId,
			label: data.label ?? `wordpress-${brand.id}`,
			createdBy: session.user.id,
		});

		return {
			code: code.code,
			prefix: code.prefix,
			brandId: code.brandId,
			entityId: code.entityId,
			expiresAt: code.expiresAt.toISOString(),
			entityCreated,
		};
	});

/** Los códigos de la marca, sin los códigos: el listado no puede mostrarlos porque no existen. */
export const listSiteEnrollmentCodesFn = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const rows = await listEnrollmentCodes(data.brandId);
		return rows.map((row) => ({
			prefix: row.prefix,
			label: row.label,
			createdAt: row.createdAt.toISOString(),
			expiresAt: row.expiresAt.toISOString(),
			usedAt: row.usedAt === null ? null : row.usedAt.toISOString(),
			expired: row.usedAt === null && row.expiresAt.getTime() <= Date.now(),
		}));
	});

/** Revoca un código que todavía no se canjeó. No toca el token de un sitio ya conectado. */
export const revokeSiteEnrollmentCodeFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), prefix: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const revoked = await revokeEnrollmentCode(data.prefix);
		return { revoked };
	});
