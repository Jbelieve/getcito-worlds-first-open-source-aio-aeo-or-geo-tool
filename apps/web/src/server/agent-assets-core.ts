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
import {
	type DeclaredAgentResource,
	type DeclaredMcp,
	declaredMcpFromCard,
	generateAgentAssets,
	isKitRoute,
	kitRouteRejectionReason,
} from "@workspace/aos-aps/assets";
import { resolveBundleClaims } from "@workspace/aos-aps/claims";
import {
	agentApsPromptLibraries,
	agentApsPrompts,
	agentAssets,
	agentBrandClaims,
	agentBrandDnaSnapshots,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyFromEnv } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { type ClaimTally, claimsGuardDecision, claimTally, websiteSourcesForClaims } from "@/lib/claims-guard";

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

/**
 * Resuelve una URL declarada contra una base. Un valor relativo vale; uno inventado no.
 *
 * La base la elige el contrato del campo que la declara: un `Link` del home (RFC 8288) se resuelve
 * contra el propio home, y un `servers[].url` de OpenAPI contra la URL del documento.
 */
function resolveUrl(value: unknown, base: string): string | undefined {
	if (typeof value !== "string" || value.trim().length === 0) return undefined;
	try {
		return new URL(value.trim(), base).toString();
	} catch {
		return undefined;
	}
}

/**
 * La API que la marca declara en su descripcion OpenAPI, ya derivada.
 *
 * `apiUrl` sale de `servers[0].url` —la raiz que la propia API declara— y por eso es obligatorio: sin esa
 * declaracion el documento describe una API pero no dice donde vive, y el `api-catalog` no emite la
 * entrada. Antes se caia a `${origin}/api/v1`, un prefijo que elegia BeAOS a partir del dominio: un
 * catalogo que promete una API en una direccion que nadie declaro manda al agente a llamar un endpoint
 * que puede no existir.
 *
 * `apiDocsUrl` y `apiStatusUrl` solo viajan si el sitio los declaro en un `Link` de su home: `/developers`
 * era la misma convencion inventada, no una declaracion. El generador ya sabe omitir campos que faltan.
 *
 * Un `servers[0].url` relativo se resuelve contra la URL del documento, no contra el origen: la spec de
 * OpenAPI lo define asi, y con el origen un `v2` servido bajo `/api/` publicaba `/v2`.
 */
export interface DeclaredApi {
	apiUrl: string;
	openApiUrl: string;
	apiDocsUrl?: string;
	apiStatusUrl?: string;
}

/**
 * Deriva el catalogo de API del documento OpenAPI que el sitio YA sirve.
 *
 * Devolver `undefined` cuando el JSON no trae `openapi` es la regla del bundle: un documento que
 * responde 200 pero no es una descripcion de API no declara ninguna API, y el `api-catalog` (RFC 9727)
 * no puede emitirse por el solo hecho de que exista una URL. Lo mismo vale cuando el documento es
 * OpenAPI pero no declara su raiz en `servers`.
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

	// `servers[0].url` es la raiz que la propia API declara, y la unica fuente posible del endpoint: si no
	// la declara, se omite la entrada en vez de completarla con el prefijo convencional del origen. Un
	// valor relativo se resuelve contra la URL del documento, que es lo que manda la spec de OpenAPI:
	// resolverlo contra el origen publicaba otra direccion que tampoco nadie declaro.
	const servers = Array.isArray(record.servers) ? record.servers : [];
	const firstServer = servers.find(
		(server): server is Record<string, unknown> => typeof server === "object" && server !== null,
	);
	const apiUrl = resolveUrl(firstServer?.url, openApiUrl);
	if (apiUrl === undefined) return undefined;

	// El `Link` del home sí se resuelve contra el origen: la RFC 8288 resuelve sus destinos contra la URI
	// del pedido, que es el home.
	const docsUrl = resolveUrl(declaredDocsUrl, origin);
	const statusUrl = resolveUrl(declaredStatusUrl, origin);
	return {
		apiUrl,
		openApiUrl,
		...(docsUrl === undefined ? {} : { apiDocsUrl: docsUrl }),
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
 * Las tres ubicaciones son candidatos que se **piden**: solo cuenta el documento que responde con una
 * descripcion OpenAPI, y aun asi la entrada se emite unicamente si ese documento declara su raiz en
 * `servers`. El generador exige `apiUrl` y `openApiUrl` juntos —un catalogo sin descripcion no lleva a
 * ninguna parte— y `apiUrl` nunca se completa con una convencion.
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
 * Lo que el sitio YA declara sobre su MCP: el endpoint y, cuando los publica, el transporte, sus tools y
 * la identidad del servidor (nombre, versión y versión de protocolo).
 *
 * BeAOS no inventa endpoints, capacidades ni protocolos: la única fuente es el
 * `/.well-known/mcp/server-card.json` que el sitio sirve. Si no lo declara —o lo declara sin endpoint— no
 * se emite server-card, y eso es un resultado, no un fallo.
 *
 * El campo `url` del card **no** se lee como endpoint: es la identidad del documento, o sea la URL de la
 * landing. Tomarlo como endpoint fue el bug que le declaraba a cada marca su propio sitio como su MCP
 * (`https://be-aos.believe-global.com`, que contesta 405), y un agente lo seguía. `url` tampoco se lee
 * para el transporte ni para la identidad del servidor.
 *
 * Los tools se copian del card en vivo, que es lo que hace útil al server-card: sin ellos el agente sabe
 * dónde está el MCP pero no qué puede pedirle. Si el card no los declara se omite la clave, en vez de
 * emitir una lista vacía que afirmaría que el servidor no tiene ninguno.
 *
 * Lo mismo vale para la versión de protocolo y la identidad del servidor: el card las declara y se copian;
 * si no las declara, se omiten en vez de completarlas con la versión del template o con el nombre de la
 * marca.
 *
 * El pedido tiene timeout corto: esto corre al apretar "Generar assets", no en un job.
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
		if (response.ok === false) return undefined;
		return declaredMcpFromCard(await response.json());
	} catch {
		return undefined;
	}
}

/**
 * El desglose de claims del brand.json que el sitio sirve HOY: total, prestadas y propias. `null` si no
 * se puede leer.
 *
 * Se devuelve el desglose y no un número porque el gate necesita distinguir las propias de las prestadas
 * del paraguas: perder una prestada al sacarle el padre a un producto no es una regresión. La decisión
 * es pura y vive en @/lib/claims-guard, que lee la misma marca que escribe el generador.
 */
export async function liveClaimTally(websiteUrl: string | undefined): Promise<ClaimTally | null> {
	if (websiteUrl === undefined) return null;
	try {
		const origin = new URL(websiteUrl).origin;
		const response = await fetch(`${origin}/.well-known/brand.json`, {
			signal: AbortSignal.timeout(5000),
			headers: { accept: "application/json" },
		});
		if (response.ok === false) return null;
		return claimTally(await response.text());
	} catch {
		return null;
	}
}

/**
 * El desglose que el sitio declara hoy, probando **varias** fuentes de web y quedándose con la primera
 * que responda.
 *
 * El agujero que esto cierra: el candado miraba un solo campo, `agent_brand_entities.website_url`, y ese
 * campo puede estar vacío —de hecho **estaba vacío** en la entidad de Believe—. Con la web vacía,
 * `liveClaimTally(undefined)` devolvía `null`, y `claimsGuardDecision` con `fromLive: null` **no bloquea**:
 * publica con un aviso. O sea que el candado que existe para impedir una degradación silenciosa era, él
 * mismo, silencioso: un clic en "Publicar" habría reemplazado las 6 pruebas que el sitio sirve por las 0
 * que el bundle declara.
 *
 * La web de una marca vive en tres lugares y ninguno es obligatorio. Se prueban todos en orden en vez de
 * confiar en uno: si una está mal escrita o el sitio no responde, se intenta la siguiente. Solo si
 * **ninguna** responde se devuelve `null`, y ahí el aviso dice la verdad: no pudimos verificar.
 */
export async function liveClaimTallyFrom(urls: Array<string | null | undefined>): Promise<ClaimTally | null> {
	for (const url of urls) {
		const tally = await liveClaimTally(url ?? undefined);
		if (tally !== null) return tally;
	}
	return null;
}

export interface GeneratedAsset {
	path: string;
	type: string;
	content: string;
	hash: string;
}

/**
 * La guarda de forma, en la escritura: separa lo que tiene forma de kit de lo que no, **lo grita** y
 * devuelve las dos listas.
 *
 * Las tres cosas juntas a propósito. Una ruta sin forma de kit es, de este lado, un bug nuestro (un
 * refactor del generador, una plantilla mal armada), no un dato del cliente: se saltea —tirar la
 * generación entera por una ruta mala cambiaría un bug por una pantalla rota— pero no puede desaparecer
 * en silencio, así que queda el `console.error` (el log del servidor) y queda el reporte que devuelve
 * `generateAssetsForEntity()`, que es lo que la UI y el MCP muestran.
 *
 * Es una función aparte —y no un `filter` adentro de `generateAssetsForEntity()`— para poder probar las
 * tres cosas sin base, sin red y sin un generador de por medio. La regla es la de
 * `@workspace/aos-aps/assets`, la misma que mira `buildBundle()` al salir y el `CHECK` de la base.
 */
export function splitKitAssets<T extends { path: string }>(assets: T[]): { accept: T[]; rejected: string[] } {
	const accept: T[] = [];
	const rejected: string[] = [];
	for (const asset of assets) {
		if (isKitRoute(asset.path)) {
			accept.push(asset);
			continue;
		}
		rejected.push(`${asset.path} (${kitRouteRejectionReason(asset.path)})`);
	}
	if (rejected.length > 0) {
		console.error(
			`[agent-assets] el generador emitió ${rejected.length} ruta(s) que el kit no acepta y que NO se guardan (bug nuestro, revisar el generador): ${rejected.join(", ")}`,
		);
	}
	return { accept, rejected };
}

/**
 * El resultado de una generación: lo que se guardó **y** lo que la guarda de forma rechazó.
 *
 * El reporte existe porque una ruta que el kit no acepta es, de este lado, **un bug nuestro** (un
 * refactor del generador, una plantilla mal armada), no un dato del cliente que se pueda saltear en
 * silencio. Va vacío siempre; cuando no lo está, las dos puertas —la UI y el MCP— lo muestran, y el
 * log del servidor lo dice. Es la mitad de "no puede desaparecer en silencio"; la otra mitad es que la
 * ruta no llega a la base.
 */
export interface GenerationReport {
	/** Los assets que sí quedaron guardados, y por lo tanto los únicos que el bundle puede llevar. */
	assets: GeneratedAsset[];
	/** Las rutas rechazadas con su motivo, tal como las da la guarda: `path (motivo)`. */
	rejected: string[];
}

/**
 * Genera el bundle de una entidad y lo persiste.
 *
 * Sub-marcas heredan la llave canónica del umbrella: se firma con la identidad de la raíz de la
 * jerarquía, nunca con una llave propia de la entidad.
 *
 * La guarda de forma corre **antes del insert**: una ruta que no tiene forma de kit no entra a la base.
 * Es la mitad del arreglo; la otra mitad está en `buildBundle()` (`@workspace/aos-aps/server`), que la
 * vuelve a mirar al salir — así una fila que ya estaba envenenada tampoco llega al sitio del cliente.
 * Dos guardas con **la misma** definición (`isKitRoute`, en `@workspace/aos-aps/assets`), no dos
 * reglas parecidas.
 */
export async function generateAssetsForEntity(brandId: string, entityId: string): Promise<GenerationReport> {
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
			name: agentBrandEntities.name,
			websiteUrl: agentBrandEntities.websiteUrl,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.brandId, brandId));
	const umbrella = findUmbrellaEntity(hierarchy, entityId);
	if (umbrella === null) throw new Error("Entity hierarchy is incomplete: no umbrella found");
	const signing = signingKeyFromEnv(process.env, keysUriForWebsite(umbrella.websiteUrl));

	/**
	 * De dónde salen los claims del bundle. La regla de precedencia, y el porqué:
	 *
	 *   1. Si el DNA que manda Maasy **ya trae** `claims` con elementos, se usan esos y no se sustituyen. El
	 *      día que Maasy mande claims de verdad, BeAOS deja de sustituir: es un espejo, no una fuente.
	 *   2. Si no trae, se usan las **confirmadas en BeAOS** —las que un operador revisó y firmó con su
	 *      criterio en la pantalla de Pruebas—. Los borradores no entran: un borrador es trabajo en curso,
	 *      no una declaración.
	 *   3. Y si la entidad **no es** el paraguas, hereda las pruebas que el operador marcó `inheritable` en
	 *      la raíz de la jerarquía. Heredar no es copiar en silencio: la prueba viaja marcada como heredada
	 *      en su `evidence.summary`, porque si no la sub-entidad estaría afirmando algo que no hizo.
	 *
	 * BeAOS no convierte la prosa de Maasy en claims por su cuenta. El estándar lo dice —*"AOS links proofs,
	 * it does not create them"*— y un dato inventado en la capa de confianza es peor que su ausencia.
	 * La decisión es pura y vive en `@workspace/aos-aps/claims`; acá solo se leen las filas.
	 */
	const savedClaims = await db
		.select()
		.from(agentBrandClaims)
		.where(and(eq(agentBrandClaims.brandId, brandId), eq(agentBrandClaims.entityId, entityId)));
	// El paraguas no hereda de nadie: heredar de sí mismo duplicaría sus propias pruebas. Los productos
	// heredan solo lo que esté marcado; el filtro fino lo hace `resolveBundleClaims`.
	const umbrellaClaims =
		umbrella.id === entityId
			? []
			: await db
					.select()
					.from(agentBrandClaims)
					.where(and(eq(agentBrandClaims.brandId, brandId), eq(agentBrandClaims.entityId, umbrella.id)));
	const claimsForBundle = resolveBundleClaims({
		dna,
		saved: savedClaims,
		umbrella: umbrella.id === entityId ? undefined : { claims: umbrellaClaims, entityName: umbrella.name },
	});

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
		mcpTransport: mcp?.transport,
		mcpProtocolVersion: mcp?.protocolVersion,
		mcpServerName: mcp?.serverName,
		mcpServerVersion: mcp?.serverVersion,
		securityContact,
		apiUrl: api?.apiUrl,
		openApiUrl: api?.openApiUrl,
		apiDocsUrl: api?.apiDocsUrl,
		apiStatusUrl: api?.apiStatusUrl,
		ardEntries,
		industry: typeof dnaPayload?.industry === "string" ? dnaPayload.industry : undefined,
		brief: typeof dnaPayload?.brief === "string" ? dnaPayload.brief : undefined,
		dna: { ...(dna ?? {}), ...claimsForBundle },
		signing: signing ?? undefined,
	});

	// La guarda de forma, en la escritura: saltea la ruta mala, la grita en el log y la cuenta en el
	// reporte. Ver `splitKitAssets()`.
	const { accept, rejected } = splitKitAssets(generated);

	// Sin rutas aceptadas no hay nada que insertar, y un `values([])` de Drizzle es una consulta inválida.
	if (accept.length > 0) {
		await db.insert(agentAssets).values(
			accept.map((asset) => ({
				brandId,
				entityId,
				path: asset.path,
				type: asset.type,
				content: asset.content,
				hash: hashContent(asset.content),
			})),
		);
	}

	return {
		assets: accept.map((asset) => ({ ...asset, hash: hashContent(asset.content) })),
		rejected,
	};
}

export type PublishResult =
	| { ok: true; id: string; isPublished: boolean; publishedAt: string | null; warning?: string }
	| { ok: false; reason: string };

/**
 * Publication gate. Closed by default: nothing is handed to a delivery agent until an operator
 * publishes the entity explicitly, so a profile signed with a wrong key never reaches a site.
 *
 * Guardián de regresión: publicar un perfil con MENOS pruebas **propias** que el que el sitio sirve hoy
 * degrada la evidencia verificable de la marca en silencio, y el gate lo dejaba pasar porque solo miraba
 * que el archivo existiera. Solo bloquea cuando el bundle pierde pruebas propias; las prestadas del
 * paraguas que el bundle deja de usar se avisan pero no bloquean (ver `claimsGuardDecision`), y si no
 * puede comparar, avisa.
 */
export async function setEntityPublished(
	brandId: string,
	entityId: string,
	published: boolean,
): Promise<PublishResult> {
	let warning: string | undefined;
	if (published) {
		// Las tres fuentes de la web de la marca. La entidad primero (es la más específica), después el
		// DNA que sincroniza Maasy, y por último la marca. Ver `liveClaimTallyFrom` para el porqué.
		const [entity] = await db
			.select({ websiteUrl: agentBrandEntities.websiteUrl })
			.from(agentBrandEntities)
			.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
			.limit(1);
		const [snapshot] = await db
			.select({ payload: agentBrandDnaSnapshots.payload })
			.from(agentBrandDnaSnapshots)
			.where(and(eq(agentBrandDnaSnapshots.entityId, entityId), eq(agentBrandDnaSnapshots.brandId, brandId)))
			.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
			.limit(1);
		const [brand] = await db.select({ website: brands.website }).from(brands).where(eq(brands.id, brandId)).limit(1);
		const dnaWebsite = (snapshot?.payload as Record<string, unknown> | undefined)?.website_url;

		const [bundle] = await db
			.select({ content: agentAssets.content })
			.from(agentAssets)
			.where(and(eq(agentAssets.entityId, entityId), eq(agentAssets.path, "/.well-known/brand.json")))
			.orderBy(desc(agentAssets.createdAt))
			.limit(1);
		const decision = claimsGuardDecision(
			claimTally(bundle?.content),
			await liveClaimTallyFrom(
				websiteSourcesForClaims({
					entityWebsite: entity?.websiteUrl,
					dnaWebsite,
					brandWebsite: brand?.website,
				}),
			),
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
