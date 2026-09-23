import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { getMaasyBrandContext, listMaasyBrands } from "@workspace/aos-aps/maasy";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

function requireAdmin(session: { user: { role?: string | null } }): void {
if (session.user.role !== "admin") throw new Error("Admin access required");
}

export const listMaasyBrandsFn = createServerFn({ method: "POST" })
.handler(async () => {
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
return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() }));
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
const payload = await getMaasyBrandContext(data.projectId);
const json = JSON.stringify(payload);
const hash = createHash("sha256").update(json).digest("hex");
await db.insert(agentBrandDnaSnapshots).values({
brandId: data.brandId,
entityId: data.entityId,
maasyProjectId: data.projectId,
payload,
hash,
});
return { ok: true, hash };
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
