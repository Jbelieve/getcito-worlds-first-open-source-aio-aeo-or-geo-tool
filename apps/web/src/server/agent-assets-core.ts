/**
 * El núcleo de generación y publicación del bundle, sin sesión de navegador.
 *
 * Existe porque hay **dos** puertas al mismo trabajo: la server function que usa la UI (autenticada con
 * sesión y organización) y el MCP de BeAOS (autenticado con token de API, para que lo consuman los
 * demás productos de Believe). Si la lógica viviera dentro de la server function, el MCP tendría que
 * duplicarla, y dos copias del gate de publicación es exactamente cómo se publica algo que no se debía.
 *
 * Acá no hay autorización: quien llama ya se autenticó. La autorización vive en las dos puertas.
 */

import { createHash } from "node:crypto";
import { extractMcpEndpoint } from "@workspace/aos-aps/aos";
import { type DeclaredMcp, type DeclaredMcpTool, generateAgentAssets } from "@workspace/aos-aps/assets";
import { agentAssets, agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyFromEnv } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { claimCount, claimsGuardDecision } from "@/lib/claims-guard";

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * Lo que el sitio YA declara sobre su MCP: la URL y, cuando la publica, sus tools.
 *
 * BeAOS no inventa endpoints ni capacidades: si el sitio no declara MCP, no se emite server-card. Se lee
 * en el orden en que los lectores lo buscan: `serverUrl` del card que el sitio ya sirve — y si no está,
 * `transport.endpoint`, que es la forma vieja y la que usa believe-global.com, y por eso su card
 * figuraba como incompleto —; y como último recurso, el endpoint declarado en su llms.txt.
 *
 * Los tools se copian del card en vivo, que es lo que hace útil al server-card: sin ellos el agente sabe
 * dónde está el MCP pero no qué puede pedirle. Si el card no los declara se omite la clave, en vez de
 * emitir una lista vacía que afirmaría que el servidor no tiene ninguno.
 *
 * Los dos pedidos tienen timeout corto: esto corre al apretar "Generar assets", no en un job.
 */
export async function declaredMcp(websiteUrl: string | undefined): Promise<DeclaredMcp | undefined> {
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
			if (found !== undefined) {
				const tools = declaredTools(card.tools);
				return tools === undefined ? { url: found.trim() } : { url: found.trim(), tools };
			}
		}
	} catch {
		// Sin card accesible: se intenta por llms.txt.
	}

	try {
		const response = await fetch(`${origin}/llms.txt`, { signal: AbortSignal.timeout(5000) });
		if (response.ok === false) return undefined;
		const url = extractMcpEndpoint(await response.text());
		return url === undefined || url === null || url.trim().length === 0 ? undefined : { url: url.trim() };
	} catch {
		return undefined;
	}
}

/** Normaliza los tools del card en vivo. Descarta lo que no tenga nombre: sin nombre no se puede llamar. */
function declaredTools(raw: unknown): DeclaredMcpTool[] | undefined {
	if (Array.isArray(raw) === false) return undefined;
	const tools: DeclaredMcpTool[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.name !== "string" || record.name.trim().length === 0) continue;
		const tool: DeclaredMcpTool = { name: record.name.trim() };
		if (typeof record.title === "string" && record.title.trim().length > 0) tool.title = record.title.trim();
		if (typeof record.description === "string" && record.description.trim().length > 0) {
			tool.description = record.description.trim();
		}
		tools.push(tool);
	}
	return tools.length === 0 ? undefined : tools;
}

/**
 * Los claims que declara el brand.json que el sitio sirve HOY. `null` si no se puede leer.
 *
 * El gate lo compara con los del bundle antes de publicar: nunca interpreta ni traduce el texto, solo
 * cuenta. La decision es pura y vive en @/lib/claims-guard.
 */
export async function liveClaimCount(websiteUrl: string | undefined): Promise<number | null> {
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

export interface GeneratedAsset {
	path: string;
	type: string;
	content: string;
	hash: string;
}

/**
 * Genera el bundle de una entidad y lo persiste.
 *
 * Sub-marcas heredan la llave canónica del umbrella: se firma con la identidad de la raíz de la
 * jerarquía, nunca con una llave propia de la entidad.
 */
export async function generateAssetsForEntity(brandId: string, entityId: string): Promise<GeneratedAsset[]> {
	const entity = await db
		.select()
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
		.limit(1);
	const current = entity[0];
	if (current === undefined) throw new Error("Entity not found");

	const snapshots = await db
		.select()
		.from(agentBrandDnaSnapshots)
		.where(and(eq(agentBrandDnaSnapshots.entityId, entityId), eq(agentBrandDnaSnapshots.brandId, brandId)))
		.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
		.limit(1);
	const dnaPayload = snapshots[0]?.payload as Record<string, unknown> | undefined;
	const dna = dnaPayload?.dna as Record<string, unknown> | undefined;

	const hierarchy = await db
		.select({
			id: agentBrandEntities.id,
			parentEntityId: agentBrandEntities.parentEntityId,
			websiteUrl: agentBrandEntities.websiteUrl,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.brandId, brandId));
	const umbrella = findUmbrellaEntity(hierarchy, entityId);
	if (umbrella === null) throw new Error("Entity hierarchy is incomplete: no umbrella found");
	const signing = signingKeyFromEnv(process.env, keysUriForWebsite(umbrella.websiteUrl));

	const websiteUrl =
		typeof dnaPayload?.website_url === "string" ? dnaPayload.website_url : (current.websiteUrl ?? undefined);

	const mcp = await declaredMcp(websiteUrl);

	const generated = generateAgentAssets({
		name: String(dnaPayload?.brand_name ?? current.name),
		websiteUrl,
		mcpUrl: mcp?.url,
		mcpTools: mcp?.tools,
		industry: typeof dnaPayload?.industry === "string" ? dnaPayload.industry : undefined,
		brief: typeof dnaPayload?.brief === "string" ? dnaPayload.brief : undefined,
		dna,
		signing: signing ?? undefined,
	});

	await db.insert(agentAssets).values(
		generated.map((asset) => ({
			brandId,
			entityId,
			path: asset.path,
			type: asset.type,
			content: asset.content,
			hash: hashContent(asset.content),
		})),
	);

	return generated.map((asset) => ({ ...asset, hash: hashContent(asset.content) }));
}

export type PublishResult =
	| { ok: true; id: string; isPublished: boolean; publishedAt: string | null; warning?: string }
	| { ok: false; reason: string };

/**
 * Publication gate. Closed by default: nothing is handed to a delivery agent until an operator
 * publishes the entity explicitly, so a profile signed with a wrong key never reaches a site.
 *
 * Guardián de regresión: publicar un perfil con MENOS claims que el que el sitio sirve hoy degrada la
 * evidencia verificable de la marca en silencio, y el gate lo dejaba pasar porque solo miraba que el
 * archivo existiera. Solo bloquea cuando el bundle pierde claims; si no puede comparar, avisa.
 */
export async function setEntityPublished(
	brandId: string,
	entityId: string,
	published: boolean,
): Promise<PublishResult> {
	let warning: string | undefined;
	if (published) {
		const [entity] = await db
			.select({ websiteUrl: agentBrandEntities.websiteUrl })
			.from(agentBrandEntities)
			.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
			.limit(1);
		const [bundle] = await db
			.select({ content: agentAssets.content })
			.from(agentAssets)
			.where(and(eq(agentAssets.entityId, entityId), eq(agentAssets.path, "/.well-known/brand.json")))
			.orderBy(desc(agentAssets.createdAt))
			.limit(1);
		const decision = claimsGuardDecision(
			claimCount(bundle?.content),
			await liveClaimCount(entity?.websiteUrl ?? undefined),
		);
		if (decision.blocked) return { ok: false, reason: decision.reason ?? "Regresión de claims." };
		warning = decision.warning;
	}

	const updated = await db
		.update(agentBrandEntities)
		.set({ isPublished: published, publishedAt: published ? new Date() : null })
		.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
		.returning({
			id: agentBrandEntities.id,
			isPublished: agentBrandEntities.isPublished,
			publishedAt: agentBrandEntities.publishedAt,
		});
	const row = updated[0];
	if (row === undefined) throw new Error("Entity not found");
	return {
		ok: true,
		id: row.id,
		isPublished: row.isPublished,
		publishedAt: row.publishedAt?.toISOString() ?? null,
		warning,
	};
}
