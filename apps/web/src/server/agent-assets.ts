import { createHash } from "node:crypto";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentAssets, agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { generateAgentAssets } from "@workspace/aos-aps/assets";
import { extractMcpEndpoint } from "@workspace/aos-aps/aos";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyFromEnv } from "@workspace/aos-aps/provenance";
import { claimCount, claimsGuardDecision } from "@/lib/claims-guard";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

function hashContent(content: string): string {
return createHash("sha256").update(content).digest("hex");
}

/**
 * La URL del MCP que el sitio YA declara, para completar el server-card en el formato que los
 * lectores esperan.
 *
 * BeAOS no inventa endpoints: si el sitio no declara ninguno, no se emite server-card. Se lee en el
 * orden en que los lectores lo buscan: `serverUrl` del card que el sitio ya sirve — y si no está,
 * `transport.endpoint`, que es la forma vieja y la que usa believe-global.com, y por eso su card
 * figuraba como incompleto —; y como ultimo recurso, el endpoint declarado en su llms.txt.
 *
 * Los dos pedidos tienen timeout corto: esto corre al apretar "Generar assets", no en un job.
 */
async function declaredMcpUrl(websiteUrl: string | undefined): Promise<string | undefined> {
if (websiteUrl === undefined) return undefined;
let origin: string;
try {
origin = new URL(websiteUrl).origin;
} catch {
return undefined;
}

try {
const response = await fetch(`${origin}/.well-known/mcp/server-card.json`, {
signal: AbortSignal.timeout(5000),
headers: { accept: "application/json" },
});
if (response.ok) {
const card = (await response.json()) as Record<string, unknown>;
const transport = card.transport as { endpoint?: unknown } | undefined;
const found = [card.serverUrl, transport?.endpoint, card.url].find(
(value): value is string => typeof value === "string" && value.trim().length > 0,
);
if (found !== undefined) return found.trim();
}
} catch {
// Sin card accesible: se intenta por llms.txt.
}

try {
const response = await fetch(`${origin}/llms.txt`, { signal: AbortSignal.timeout(5000) });
if (response.ok === false) return undefined;
return extractMcpEndpoint(await response.text()) ?? undefined;
} catch {
return undefined;
}
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

const websiteUrl =
typeof dnaPayload?.website_url === "string" ? dnaPayload.website_url : current.websiteUrl ?? undefined;

const generated = generateAgentAssets({
name: String(dnaPayload?.brand_name ?? current.name),
websiteUrl,
mcpUrl: await declaredMcpUrl(websiteUrl),
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

/**
 * Publication gate. Closed by default: nothing is handed to a delivery agent until an operator
 * publishes the entity explicitly, so a profile signed with a wrong key never reaches a site.
 */
/**
 * Los claims que declara el brand.json que el sitio sirve HOY. `null` si no se puede leer.
 *
 * El gate lo compara con los del bundle antes de publicar: nunca interpreta ni traduce el texto, solo
 * cuenta. La decision es pura y vive en @/lib/claims-guard.
 */
async function liveClaimCount(websiteUrl: string | undefined): Promise<number | null> {
if (websiteUrl === undefined) return null;
try {
const origin = new URL(websiteUrl).origin;
const response = await fetch(`${origin}/.well-known/brand.json`, {
signal: AbortSignal.timeout(5000),
headers: { accept: "application/json" },
});
if (response.ok === false) return null;
return claimCount(await response.text());
} catch {
return null;
}
}

export const setAgentEntityPublishedFn = createServerFn({ method: "POST" })
.validator(
z.object({
brandId: z.string().min(1),
entityId: z.string().uuid(),
published: z.boolean(),
}),
)
.handler(async ({ data }) => {
const session = await requireAuthSession();
await requireOrgAccess(session.user.id, data.brandId);

// Guardián de regresión: publicar un perfil con MENOS claims que el que el sitio sirve hoy degrada
// la evidencia verificable de la marca en silencio, y el gate lo dejaba pasar porque solo miraba que
// el archivo existiera. Solo bloquea cuando el bundle pierde claims; si no puede comparar, avisa.
let warning: string | undefined;
if (data.published) {
const [entity] = await db
.select({ websiteUrl: agentBrandEntities.websiteUrl })
.from(agentBrandEntities)
.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
.limit(1);
const [bundle] = await db
.select({ content: agentAssets.content })
.from(agentAssets)
.where(and(eq(agentAssets.entityId, data.entityId), eq(agentAssets.path, "/.well-known/brand.json")))
.orderBy(desc(agentAssets.createdAt))
.limit(1);
const decision = claimsGuardDecision(claimCount(bundle?.content), await liveClaimCount(entity?.websiteUrl ?? undefined));
if (decision.blocked) return { ok: false as const, reason: decision.reason ?? "Regresión de claims." };
warning = decision.warning;
}

const updated = await db
.update(agentBrandEntities)
.set({ isPublished: data.published, publishedAt: data.published ? new Date() : null })
.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
.returning({ id: agentBrandEntities.id, isPublished: agentBrandEntities.isPublished, publishedAt: agentBrandEntities.publishedAt });
const row = updated[0];
if (row === undefined) throw new Error("Entity not found");
return { ok: true as const, id: row.id, isPublished: row.isPublished, publishedAt: row.publishedAt?.toISOString() ?? null, warning };
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
