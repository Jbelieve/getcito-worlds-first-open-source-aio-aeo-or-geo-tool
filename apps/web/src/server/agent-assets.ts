import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentAssets, agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { generateAgentAssets } from "@workspace/aos-aps/assets";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyFromEnv } from "@workspace/aos-aps/provenance";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

function hashContent(content: string): string {
return createHash("sha256").update(content).digest("hex");
}

export const generateAgentAssetsFn = createServerFn({ method: "POST" })
.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
.handler(async ({ data }) => {
const session = await requireAuthSession();
await requireOrgAccess(session.user.id, data.brandId);

const entity = await db
.select()
.from(agentBrandEntities)
.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
.limit(1);
const current = entity[0];
if (current === undefined) throw new Error("Entity not found");

const snapshots = await db
.select()
.from(agentBrandDnaSnapshots)
.where(and(eq(agentBrandDnaSnapshots.entityId, data.entityId), eq(agentBrandDnaSnapshots.brandId, data.brandId)))
.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
.limit(1);
const dnaPayload = snapshots[0]?.payload as Record<string, unknown> | undefined;
const dna = dnaPayload?.dna as Record<string, unknown> | undefined;

// Sub-brands inherit the umbrella's canonical key: resolve the root of this entity's hierarchy
// and sign with its identity, never with a key of the entity's own.
const hierarchy = await db
.select({
id: agentBrandEntities.id,
parentEntityId: agentBrandEntities.parentEntityId,
websiteUrl: agentBrandEntities.websiteUrl,
})
.from(agentBrandEntities)
.where(eq(agentBrandEntities.brandId, data.brandId));
const umbrella = findUmbrellaEntity(hierarchy, data.entityId);
if (umbrella === null) throw new Error("Entity hierarchy is incomplete: no umbrella found");
const signing = signingKeyFromEnv(process.env, keysUriForWebsite(umbrella.websiteUrl));

const generated = generateAgentAssets({
name: String(dnaPayload?.brand_name ?? current.name),
websiteUrl: typeof dnaPayload?.website_url === "string" ? dnaPayload.website_url : current.websiteUrl ?? undefined,
industry: typeof dnaPayload?.industry === "string" ? dnaPayload.industry : undefined,
brief: typeof dnaPayload?.brief === "string" ? dnaPayload.brief : undefined,
dna,
signing: signing ?? undefined,
});

await db.insert(agentAssets).values(
generated.map((asset) => ({
brandId: data.brandId,
entityId: data.entityId,
path: asset.path,
type: asset.type,
content: asset.content,
hash: hashContent(asset.content),
})),
);

return generated.map((asset) => ({ ...asset, hash: hashContent(asset.content) }));
});

export const getAgentAssetsFn = createServerFn({ method: "POST" })
.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
.handler(async ({ data }) => {
const session = await requireAuthSession();
await requireOrgAccess(session.user.id, data.brandId);
const rows = await db
.select()
.from(agentAssets)
.where(and(eq(agentAssets.brandId, data.brandId), eq(agentAssets.entityId, data.entityId)))
.orderBy(desc(agentAssets.createdAt));
const latestByPath = new Map<string, typeof rows[number]>();
for (const row of rows) {
if (latestByPath.has(row.path) === false) latestByPath.set(row.path, row);
}
return [...latestByPath.values()].map((row) => ({
id: row.id,
path: row.path,
type: row.type,
content: row.content,
hash: row.hash,
createdAt: row.createdAt.toISOString(),
}));
});
