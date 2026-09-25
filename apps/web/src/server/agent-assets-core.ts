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
import {
	type DeclaredAgentResource,
	type DeclaredMcp,
	type DeclaredMcpTool,
	generateAgentAssets,
} from "@workspace/aos-aps/assets";
import {
	agentApsPromptLibraries,
	agentApsPrompts,
	agentAssets,
	agentBrandDnaSnapshots,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyFromEnv } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { claimCount, claimsGuardDecision } from "@/lib/claims-guard";

/**
 * Techo de cada descubrimiento contra el sitio de la marca.
 *
 * Esto corre cuando el operador aprieta "Generar assets", no en un job: un sitio que no contesta no
 * puede colgar la pantalla. El reloj se crea una vez por funcion y lo comparten todos sus pedidos, asi
 * que el peor caso de cada descubrimiento es este techo y no la suma de sus intentos.
 */
const DISCOVERY_TIMEOUT_MS = 5000;

export function hashContent(content: string): string {
	return createHash("sha256").update(content).digest("hex");
}

/**
 * El `Contact:` de un `security.txt` (RFC 9116), ya validado.
 *
 * La RFC admite varios campos `Contact`, comentarios con `#` y valores sin espacios. Se devuelve el
 * primero que sea una URI usable (`mailto:` o `https:`, que es lo que el generador acepta) porque un
 * `Contact:` que no lleva a ningun lado es peor que no publicar el archivo: un agente lee ese valor y
 * manda ahi el aviso de vulnerabilidad.
 */
export function parseSecurityContact(body: string): string | undefined {
	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const match = /^contact\s*:\s*(.+)$/i.exec(line);
		if (match === null) continue;
		const value = (match[1] ?? "").trim();
		if (value.startsWith("mailto:") && value.length > "mailto:".length) return value;
		if (value.startsWith("https://") && value.length > "https://".length) return value;
	}
	return undefined;
}

/** Un enlace del header `Link` (RFC 8288). `rel` puede traer varios valores separados por espacios. */
export interface ParsedLink {
	url: string;
	rel: string;
}

/**
 * Parsea un header `Link` sin romperse con las comas.
 *
 * Las URLs pueden contener comas, asi que solo se corta en las comas de afuera de los `<>`. Los
 * parametros que no son `rel` se ignoran: aca solo se busca la relacion declarada.
 */
export function parseLinkHeader(value: string | null | undefined): ParsedLink[] {
	if (typeof value !== "string" || value.trim().length === 0) return [];
	const parts: string[] = [];
	let current = "";
	let insideAngle = false;
	for (const char of value) {
		if (char === "<") insideAngle = true;
		if (char === ">") insideAngle = false;
		if (char === "," && insideAngle === false) {
			parts.push(current);
			current = "";
			continue;
		}
		current += char;
	}
	parts.push(current);

	const links: ParsedLink[] = [];
	for (const part of parts) {
		const url = /<([^>]*)>/.exec(part)?.[1]?.trim();
		if (url === undefined || url.length === 0) continue;
		const rel = /\brel\s*=\s*"?([^";]+)"?/i.exec(part)?.[1]?.trim();
		if (rel === undefined || rel.length === 0) continue;
		links.push({ url, rel });
	}
	return links;
}

/** El primer enlace cuya `rel` declarada incluya la buscada, o `undefined`. */
export function linkByRel(links: ParsedLink[], rel: string): string | undefined {
	for (const link of links) {
		if (link.rel.split(/\s+/).includes(rel)) return link.url;
	}
	return undefined;
}

/** Resuelve una URL declarada contra el origen. Un valor relativo vale; uno inventado no. */
function resolveUrl(value: unknown, origin: string): string | undefined {
	if (typeof value !== "string" || value.trim().length === 0) return undefined;
	try {
		return new URL(value.trim(), origin).toString();
	} catch {
		return undefined;
	}
}

/**
 * La API que la marca declara en su descripcion OpenAPI, ya derivada.
 *
 * `apiDocsUrl` cae en `/developers` cuando la marca no la declara: es la convencion que la propia
 * consigna pide, no un endpoint que inventemos. `apiStatusUrl` solo viaja si la marca lo declaro en un
 * `Link rel="status"`: sin dato no se emite, y el generador ya sabe omitir campos que faltan.
 */
export interface DeclaredApi {
	apiUrl: string;
	openApiUrl: string;
	apiDocsUrl: string;
	apiStatusUrl?: string;
}

/**
 * Deriva el catalogo de API del documento OpenAPI que el sitio YA sirve.
 *
 * Devolver `undefined` cuando el JSON no trae `openapi` es la regla del bundle: un documento que
 * responde 200 pero no es una descripcion de API no declara ninguna API, y el `api-catalog` (RFC 9727)
 * no puede emitirse por el solo hecho de que exista una URL.
 */
export function apiFromOpenApiDocument(
	document: unknown,
	openApiUrl: string,
	origin: string,
	declaredDocsUrl?: string,
	declaredStatusUrl?: string,
): DeclaredApi | undefined {
	if (typeof document !== "object" || document === null) return undefined;
	const record = document as Record<string, unknown>;
	if (typeof record.openapi !== "string" || record.openapi.trim().length === 0) return undefined;

	// `servers[0].url` es la raiz que la propia API declara; si no la hay, se cae al prefijo
	// convencional del origen en vez de inventar un host.
	const servers = Array.isArray(record.servers) ? record.servers : [];
	const firstServer = servers.find(
		(server): server is Record<string, unknown> => typeof server === "object" && server !== null,
	);
	const apiUrl = resolveUrl(firstServer?.url, origin) ?? `${origin}/api/v1`;

	const docsUrl = resolveUrl(declaredDocsUrl, origin) ?? `${origin}/developers`;
	const statusUrl = resolveUrl(declaredStatusUrl, origin);
	return {
		apiUrl,
		openApiUrl,
		apiDocsUrl: docsUrl,
		...(statusUrl === undefined ? {} : { apiStatusUrl: statusUrl }),
	};
}

/**
 * El contacto de seguridad que el sitio YA publica, leido en el orden en que los lectores lo buscan:
 * `/.well-known/security.txt` y, si no esta, `security.txt` en la raiz.
 *
 * Sin contacto no se emite el archivo y no se inventa un buzon: una direccion falsa manda a quien
 * reporta una vulnerabilidad al vacio, que es peor que no publicar nada.
 */
export async function declaredSecurityContact(websiteUrl: string | undefined): Promise<string | undefined> {
	if (websiteUrl === undefined) return undefined;
	let origin: string;
	try {
		origin = new URL(websiteUrl).origin;
	} catch {
		return undefined;
	}

	const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);
	for (const path of ["/.well-known/security.txt", "/security.txt"]) {
		try {
			const response = await fetch(`${origin}${path}`, { signal, headers: { accept: "text/plain" } });
			if (response.ok === false) continue;
			const contact = parseSecurityContact(await response.text());
			if (contact !== undefined) return contact;
		} catch {
			// Sin archivo accesible en esta ubicacion: se prueba la siguiente.
		}
	}
	return undefined;
}

/**
 * La API que el sitio YA declara, descubierta como el MCP: primero el `Link rel="service-desc"` del
 * home, despues `/openapi.json` y `/.well-known/openapi.json`.
 *
 * Sin API declarada no se pasa nada y el `api-catalog` no se emite. El generador exige `apiUrl` y
 * `openApiUrl` juntos: un catalogo sin descripcion no lleva a ninguna parte.
 */
export async function declaredApi(websiteUrl: string | undefined): Promise<DeclaredApi | undefined> {
	if (websiteUrl === undefined) return undefined;
	let origin: string;
	try {
		origin = new URL(websiteUrl).origin;
	} catch {
		return undefined;
	}

	const signal = AbortSignal.timeout(DISCOVERY_TIMEOUT_MS);

	// El `Link` del home es la unica fuente que puede declarar tambien la doc y el estado. Las URLs
	// pueden venir relativas (`</openapi.json>`), asi que se resuelven contra el origen antes de usarlas.
	let declaredDocsUrl: string | undefined;
	let declaredStatusUrl: string | undefined;
	let declaredDescUrl: string | undefined;
	try {
		const home = await fetch(`${origin}/`, { signal, headers: { accept: "text/html" }, redirect: "follow" });
		if (home.ok) {
			const links = parseLinkHeader(home.headers.get("link"));
			declaredDescUrl = resolveUrl(linkByRel(links, "service-desc"), origin);
			declaredDocsUrl = resolveUrl(linkByRel(links, "service-doc"), origin);
			declaredStatusUrl = resolveUrl(linkByRel(links, "status"), origin);
		}
	} catch {
		// Sin home accesible: quedan los archivos conocidos.
	}

	const candidates = [declaredDescUrl, `${origin}/openapi.json`, `${origin}/.well-known/openapi.json`].filter(
		(candidate): candidate is string => candidate !== undefined && candidate.length > 0,
	);

	for (const candidate of candidates) {
		try {
			const response = await fetch(candidate, { signal, headers: { accept: "application/json" } });
			if (response.ok === false) continue;
			const api = apiFromOpenApiDocument(await response.json(), candidate, origin, declaredDocsUrl, declaredStatusUrl);
			if (api !== undefined) return api;
		} catch {
			// No es JSON, no es OpenAPI o no respondio: se prueba el siguiente candidato.
		}
	}
	return undefined;
}

/**
 * Las preguntas reales de la marca: la biblioteca de prompts activa de la entidad, hasta cinco.
 *
 * Son las `representativeQueries` del `ai-catalog.json` (ARD). No se generan nuevas: si la entidad no
 * tiene biblioteca activa, o la biblioteca no tiene prompts habilitados, devuelve la lista vacia y el
 * `ai-catalog` no se emite, porque una entrada ARD sin consultas no describe como se llega al recurso.
 */
export async function activePromptQueries(brandId: string, entityId: string, limit = 5): Promise<string[]> {
	const [library] = await db
		.select({ id: agentApsPromptLibraries.id })
		.from(agentApsPromptLibraries)
		.where(
			and(
				eq(agentApsPromptLibraries.brandId, brandId),
				eq(agentApsPromptLibraries.entityId, entityId),
				eq(agentApsPromptLibraries.status, "active"),
			),
		)
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);
	if (library === undefined) return [];

	const rows = await db
		.select({ text: agentApsPrompts.text })
		.from(agentApsPrompts)
		.where(and(eq(agentApsPrompts.libraryId, library.id), eq(agentApsPrompts.enabled, true)))
		.limit(limit);

	return rows
		.map((row) => row.text.trim())
		.filter((text) => text.length > 0)
		.slice(0, limit);
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

	// Los cuatro descubrimientos corren en paralelo y cada uno tiene su propio techo: la pantalla que
	// aprieta "Generar assets" espera al mas lento, no a la suma de todos.
	const [mcp, securityContact, api, queries] = await Promise.all([
		declaredMcp(websiteUrl),
		declaredSecurityContact(websiteUrl),
		declaredApi(websiteUrl),
		activePromptQueries(brandId, entityId),
	]);

	// ARD: la entrada del perfil de marca se arma solo si hay al menos dos preguntas reales, porque el
	// generador exige entre 2 y 5 `representativeQueries` por entrada. Con una sola, o con la biblioteca
	// activa vacia, no se emite `ai-catalog`: inventar la segunda pregunta seria afirmar algo que la
	// marca no declara.
	const origin = (() => {
		if (websiteUrl === undefined) return undefined;
		try {
			return new URL(websiteUrl).origin;
		} catch {
			return undefined;
		}
	})();
	const name = String(dnaPayload?.brand_name ?? current.name);
	const ardEntries: DeclaredAgentResource[] =
		origin === undefined || queries.length < 2
			? []
			: [
					{
						name: "brand-profile",
						namespace: "brand",
						type: "application/json",
						displayName: `Perfil de marca de ${name}`,
						url: `${origin}/.well-known/brand.json`,
						representativeQueries: queries,
					},
				];

	const generated = generateAgentAssets({
		name,
		websiteUrl,
		mcpUrl: mcp?.url,
		mcpTools: mcp?.tools,
		securityContact,
		apiUrl: api?.apiUrl,
		openApiUrl: api?.openApiUrl,
		apiDocsUrl: api?.apiDocsUrl,
		apiStatusUrl: api?.apiStatusUrl,
		ardEntries,
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
