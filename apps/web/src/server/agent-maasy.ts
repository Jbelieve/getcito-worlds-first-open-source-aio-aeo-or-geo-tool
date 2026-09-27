import { createServerFn } from "@tanstack/react-start";
import { agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { listMaasyBrands } from "@workspace/aos-aps/maasy";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { ensureEntity } from "@/server/agent-entities-core";
import { syncAgentDnaForEntity } from "@/server/agent-maasy-core";

function requireAdmin(session: { user: { role?: string | null } }): void {
	if (session.user.role !== "admin") throw new Error("Admin access required");
}

export const listMaasyBrandsFn = createServerFn({ method: "POST" }).handler(async () => {
	const session = await requireAuthSession();
	requireAdmin(session);
	const brands = await listMaasyBrands();
	return brands.map((brand) => ({ id: brand.id, name: brand.name }));
});

export const listAgentEntitiesFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const rows = await db
			.select()
			.from(agentBrandEntities)
			.where(eq(agentBrandEntities.brandId, data.brandId))
			.orderBy(desc(agentBrandEntities.isPrimary), desc(agentBrandEntities.createdAt));
		return rows.map((row) => ({
			...row,
			createdAt: row.createdAt.toISOString(),
			updatedAt: row.updatedAt.toISOString(),
			publishedAt: row.publishedAt?.toISOString() ?? null,
		}));
	});

export const linkMaasyProjectFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			projectId: z.string().min(1),
			name: z.string().min(1),
			websiteUrl: z.string().url().optional(),
			entityType: z.enum(["umbrella", "product"]).optional(),
			parentEntityId: z.string().uuid().optional(),
			isPrimary: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const existing = await db
			.select({ id: agentBrandEntities.id })
			.from(agentBrandEntities)
			.where(and(eq(agentBrandEntities.brandId, data.brandId), eq(agentBrandEntities.maasyProjectId, data.projectId)))
			.limit(1);
		const first = existing[0];
		if (first !== undefined) {
			await db
				.update(agentBrandEntities)
				.set({
					name: data.name,
					websiteUrl: data.websiteUrl ?? null,
					entityType: data.entityType ?? "product",
					parentEntityId: data.parentEntityId ?? null,
					isPrimary: data.isPrimary ?? false,
				})
				.where(eq(agentBrandEntities.id, first.id));
			return { ok: true, updated: true };
		}
		await db.insert(agentBrandEntities).values({
			brandId: data.brandId,
			name: data.name,
			websiteUrl: data.websiteUrl ?? null,
			entityType: data.entityType ?? "product",
			parentEntityId: data.parentEntityId ?? null,
			maasyProjectId: data.projectId,
			isPrimary: data.isPrimary ?? false,
		});
		return { ok: true, updated: false };
	});

/**
 * La otra vía de creación de entidades: la UI.
 *
 * `linkMaasyProjectFn` solo crea al vincular una marca de Maasy, así que una entidad que no está en
 * Maasy (un dealer independiente de Autex) no tenía cómo nacer desde la interfaz. Esta server function
 * llama al mismo `ensureEntity` que el tool `ensure_entity` del MCP: la idempotencia por host y por
 * proyecto de Maasy, y la validación de la jerarquía, son una sola.
 */
export const createAgentEntityFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			name: z.string().min(1),
			// Igual que el MCP: la web se valida por host en el núcleo (`hostOf`), no por el formato.
			websiteUrl: z.string().min(1).optional(),
			entityType: z.enum(["umbrella", "product"]),
			parentEntityId: z.string().uuid().optional(),
			maasyProjectId: z.string().min(1).optional(),
			isPrimary: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return ensureEntity(data);
	});

export const syncAgentDnaFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			entityId: z.string().uuid(),
			projectId: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const result = await syncAgentDnaForEntity(data.brandId, data.entityId, data.projectId);
		return { ok: true, hash: result.hash };
	});

export const getAgentDnaSnapshotsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const rows = await db
			.select({
				id: agentBrandDnaSnapshots.id,
				entityId: agentBrandDnaSnapshots.entityId,
				maasyProjectId: agentBrandDnaSnapshots.maasyProjectId,
				hash: agentBrandDnaSnapshots.hash,
				syncedAt: agentBrandDnaSnapshots.syncedAt,
			})
			.from(agentBrandDnaSnapshots)
			.where(eq(agentBrandDnaSnapshots.brandId, data.brandId))
			.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
			.limit(20);
		return rows.map((row) => ({ ...row, syncedAt: row.syncedAt.toISOString() }));
	});
