import type { Claim, Proof } from "../preference";
import { buildKeysJson, buildWebBotAuthDirectory, type SigningKey, signDetached } from "../provenance";

/**
 * Generates the agent-facing asset bundle for one brand entity.
 *
 * Shapes follow aos-aps-standard: llms.txt (AOS-DISC-01), llms-full.txt (AOS-DISC-02),
 * AGENTS.md (AOS-DISC-03), robots.txt + sitemap.xml (AOS-DISC-04), agent-card.json (AOS-IDEN-01),
 * agent-permissions.json (AOS-IDEN-02), brand.json + .sig + keys.json (APS-CLAIM/PROV), más las
 * superficies que la web de Believe ya publica y que el generador no emitía: `Content-Signal` y
 * `Agentmap` en robots.txt, security.txt (RFC 9116), api-catalog (RFC 9727) y ai-catalog (ARD v1.0).
 *
 * Hard rule from the standard: AOS links proofs, it does not create them. Claims and proofs are
 * only copied from the brand's own synced data; absent input yields empty arrays, never invented
 * evidence.
 */

export interface GeneratedAsset {
	path: string;
	type: string;
	content: string;
}

/**
 * Lo que el sitio ya declara sobre su MCP: la URL y, cuando la publica, la lista de tools.
 *
 * Los tools son opcionales a propósito. Un `tools: []` afirma "este servidor no tiene tools", que es
 * falso cuando en realidad no lo sabemos, y deja al agente peor que si no dijéramos nada: le dice que
 * no hay nada que llamar. Si no los conocemos, se omite la clave.
 */
export interface DeclaredMcpTool {
	name: string;
	title?: string;
	description?: string;
}

/** El MCP que el sitio declara: siempre la URL, los tools solo cuando los publica. */
export interface DeclaredMcp {
	url: string;
	tools?: DeclaredMcpTool[];
}

/**
 * Un recurso que la marca declara en su catálogo ARD (`/.well-known/ai-catalog.json`).
 *
 * Se pide completo a propósito. Una entrada sin media type, con los dos o ningún campo de `url`/`data`, o
 * con menos de dos consultas representativas no describe nada que un agente pueda usar, así que se
 * descarta la entrada entera en vez de publicar un recurso a medias: media entrada es peor que ninguna.
 */
export interface DeclaredAgentResource {
	/** Nombre corto del recurso. Cierra el `identifier`: `urn:air:<fqdn>:<namespace>:<name>`. */
	name: string;
	/** Espacio de nombres dentro del host. El `identifier` de ARD no admite guiones acá. */
	namespace: string;
	/** Media type del recurso, p. ej. `application/mcp-server-card+json` o `application/vnd.oai.openapi+json`. */
	type: string;
	displayName?: string;
	/** URL donde se sirve el recurso. Exactamente uno de `url` o `data`. */
	url?: string;
	/** El recurso inline, para lo que no tiene URL propia. Exactamente uno de `url` o `data`. */
	data?: Record<string, unknown>;
	/** 2 a 5 consultas representativas: sin ellas la entrada no dice cómo se llega al recurso. */
	representativeQueries?: string[];
}

export interface AgentAssetInput {
	name: string;
	websiteUrl?: string;
	industry?: string;
	brief?: string;
	dna?: Record<string, unknown>;
	/**
	 * Key that signs brand.json. A sub-brand passes its umbrella's key (see provenance/keying.ts),
	 * so the bundle carries the umbrella identity. Absent => no provenance assets are emitted.
	 */
	signing?: SigningKey;
	/**
	 * URL del MCP que la marca declara. Ausente => no se emite server-card: BeAOS no inventa
	 * endpoints, y un server-card sin `serverUrl` es exactamente el estado incompleto que hay que
	 * evitar. El llamador lo resuelve leyendo lo que el sitio ya publica.
	 */
	mcpUrl?: string;
	/** Tools que el MCP declara. Ausente => el card no afirma nada sobre tools. */
	mcpTools?: DeclaredMcpTool[];
	/**
	 * URL de la API pública que la marca declara (ej. `https://marca.com/api/v1`). Ausente => no se emite
	 * `api-catalog`: un catálogo RFC 9727 sin API real inventa un servicio, igual que un server-card sin
	 * `serverUrl` inventa un endpoint.
	 */
	apiUrl?: string;
	/** Descripción OpenAPI de esa API. Es el `service-desc` del catálogo: su razón de existir. */
	openApiUrl?: string;
	/** Documentación humana de la API. Es el `service-doc` (RFC 8631). */
	apiDocsUrl?: string;
	/** Endpoint de estado de la API. Es el enlace `status` del catálogo. */
	apiStatusUrl?: string;
	/**
	 * Contacto de seguridad con forma de URI (`mailto:` o `https:`) para `/.well-known/security.txt`.
	 * Ausente => no se emite: un `Contact:` inventado manda a quien reporta una vulnerabilidad al vacío.
	 */
	securityContact?: string;
	/**
	 * Recursos que la marca declara en su catálogo ARD. Ausente o sin entradas completas => no se emite
	 * `/.well-known/ai-catalog.json`, porque las `representativeQueries` no se pueden inventar.
	 */
	ardEntries?: DeclaredAgentResource[];
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function descriptionFrom(input: AgentAssetInput): string | undefined {
	const dna = input.dna ?? {};
	return (
		asString(dna.business_description) ??
		asString(dna.strategic_brief) ??
		asString(dna.differentiator) ??
		asString(input.brief)
	);
}

/** Claims pass through only when the brand's own data already carries them. */
function claimsFrom(dna: Record<string, unknown>): Claim[] {
	return Array.isArray(dna.claims) ? (dna.claims as Claim[]) : [];
}

function proofsFrom(dna: Record<string, unknown>): Proof[] {
	return Array.isArray(dna.proofs) ? (dna.proofs as Proof[]) : [];
}

function prohibitedTermsFrom(dna: Record<string, unknown>): string[] {
	const raw = asString(dna.prohibited_words);
	if (raw === undefined) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function normalizedOrigin(websiteUrl: string | undefined): string | undefined {
	if (websiteUrl === undefined) return undefined;
	try {
		const url = new URL(websiteUrl);
		return `${url.protocol}//${url.host}`;
	} catch {
		return undefined;
	}
}

/** Una URL absoluta declarada por la marca, normalizada, o `undefined`. Un valor relativo no publica nada. */
function absoluteUrl(value: string | undefined): string | undefined {
	const declared = asString(value);
	if (declared === undefined) return undefined;
	try {
		return new URL(declared).toString();
	} catch {
		return undefined;
	}
}

function brandJson(input: AgentAssetInput): string {
	const description = descriptionFrom(input);
	const dna = input.dna ?? {};
	const terms = prohibitedTermsFrom(dna);
	const profile = {
		$schema: "https://maasy.ai/schema/brand-profile/v1.json",
		version: 1,
		claims_proofs_version: "claims-proofs/v1",
		brand: {
			name: input.name,
			website_url: input.websiteUrl,
			industry: input.industry,
			updated_at: new Date().toISOString(),
		},
		identity: {
			positioning: asString(dna.strategic_brief) ?? description,
			business_description: description,
			differentiator: asString(dna.differentiator),
			main_result: asString(dna.main_result),
			voice_tone: dna.tone_tags ?? dna.tone,
			approved_ctas: asString(dna.approved_ctas),
			prohibited_words: asString(dna.prohibited_words),
		},
		agent_guidance: { avoid_claims: terms },
		claims: claimsFrom(dna),
		proofs: proofsFrom(dna),
		generated_by: "BeAOS",
	};
	return `${JSON.stringify(profile, null, 2)}\n`;
}

function boundariesFrom(claims: Claim[]): Record<string, { applicable_for?: string; not_applicable_for?: string }> {
	const boundaries: Record<string, { applicable_for?: string; not_applicable_for?: string }> = {};
	for (const claim of claims) {
		const id = asString(claim.claim_id);
		if (id === undefined || claim.boundary === null || claim.boundary === undefined) continue;
		boundaries[id] = {
			applicable_for: asString(claim.boundary.applicable_for),
			not_applicable_for: asString(claim.boundary.not_applicable_for),
		};
	}
	return boundaries;
}

function llmsTxt(input: AgentAssetInput): string {
	const description = descriptionFrom(input) ?? "Marca monitoreada por BeAOS.";
	const website = input.websiteUrl ?? "";
	return [
		`# ${input.name}`,
		"",
		`> ${description}`,
		"",
		"## Sitio",
		website.length > 0 ? `- [${input.name}](${website})` : "- Sitio oficial",
		"",
		"## Perfil verificable",
		"- [Brand Profile](/.well-known/brand.json)",
		"- [Firma Ed25519](/.well-known/brand.json.sig)",
		"- [Clave publica](/.well-known/keys.json)",
		"",
		"## Capacidades",
		"- [Agent Card](/.well-known/agent-card.json)",
		"- [Agent Permissions](/.well-known/agent-permissions.json)",
		"",
	].join("\n");
}

/**
 * `/llms-full.txt` (AOS-DISC-02): el perfil completo en un solo archivo.
 *
 * `llms.txt` es un índice que enlaza; éste es el contenido, para el agente que solo puede leer un
 * archivo. Incluye la identidad, cada claim con su boundary, la evidencia que lo sostiene y cómo
 * verificar la firma.
 *
 * La regla dura del estándar sigue valiendo: los claims y proofs se copian de los datos de la marca y
 * nunca se inventan — si no hay, el archivo lo dice con todas las letras en vez de rellenar.
 */
function llmsFullTxt(input: AgentAssetInput): string {
	const description = descriptionFrom(input) ?? "Marca monitoreada por BeAOS.";
	const dna = input.dna ?? {};
	const claims = claimsFrom(dna);
	const proofs = proofsFrom(dna);

	const proofsByClaim = new Map<string, Proof[]>();
	for (const proof of proofs) {
		for (const ref of proof.claim_refs ?? []) {
			if (typeof ref !== "string" || ref.length === 0) continue;
			proofsByClaim.set(ref, [...(proofsByClaim.get(ref) ?? []), proof]);
		}
	}

	const lines: string[] = [`# ${input.name} — perfil completo`, "", `> ${description}`, "", "## Identidad"];
	const identity: Array<string | undefined> = [
		`- Nombre: ${input.name}`,
		`- Sitio: ${asString(input.websiteUrl) ?? "sin declarar"}`,
		asString(input.industry) === undefined ? undefined : `- Industria: ${asString(input.industry)}`,
		asString(dna.differentiator) === undefined ? undefined : `- Diferencial: ${asString(dna.differentiator)}`,
		asString(dna.main_result) === undefined ? undefined : `- Resultado principal: ${asString(dna.main_result)}`,
	];
	for (const line of identity) if (line !== undefined) lines.push(line);

	lines.push("", "## Claims y su evidencia", "");
	if (claims.length === 0) {
		lines.push("Este perfil **no declara claims**. No hay nada que verificar y nada que citar.", "");
	}
	for (const claim of claims) {
		const id = asString(claim.claim_id) ?? "(sin claim_id)";
		lines.push(`### ${asString(claim.statement) ?? id}`, "");
		lines.push(`- \`claim_id\`: ${id}`);
		const category = asString(claim.category);
		if (category !== undefined) lines.push(`- Categoría: ${category}`);
		lines.push(`- Aplica a: ${asString(claim.boundary?.applicable_for) ?? "sin declarar"}`);
		lines.push(`- **No** aplica a: ${asString(claim.boundary?.not_applicable_for) ?? "sin declarar"}`);
		const linked = proofsByClaim.get(id) ?? [];
		if (linked.length === 0) {
			lines.push("- Evidencia: **sin proof que lo sostenga**. No lo trates como verificado.");
		} else {
			lines.push("- Evidencia:");
			for (const proof of linked) {
				const type = asString(proof.type);
				const title = asString(proof.title) ?? asString(proof.proof_id) ?? "proof sin título";
				const uri = asString(proof.verification?.source_uri);
				lines.push(`  - ${type === undefined ? "" : `[${type}] `}${title}${uri === undefined ? "" : ` — ${uri}`}`);
			}
		}
		lines.push("");
	}

	lines.push(
		"## Cómo verificar este perfil",
		"- El perfil servido es `/.well-known/brand.json`, y su firma Ed25519 `/.well-known/brand.json.sig` cubre **los bytes exactos** de ese archivo.",
		"- La clave pública está en `/.well-known/keys.json`.",
		"- Si la firma no verifica, trátalo como un perfil no verificado y dilo al responder.",
		"",
		"## Superficies del sitio",
		"- `/.well-known/agent-card.json` — qué es y qué puede hacer.",
		"- `/.well-known/agent-permissions.json` — qué está permitido y qué no.",
		"- `/AGENTS.md` — cuándo usar este perfil y cuándo no.",
		"",
		"## Límites",
		"- No extrapoles un claim fuera de su `applicable_for`.",
		"- Un claim sin `proofs` no es evidencia verificada.",
		"- Este archivo no agrega claims: refleja lo que la marca declara y firma.",
		"",
	);
	return lines.join("\n");
}

/**
 * `/.well-known/mcp/server-card.json` (AOS-CAPA-01), con `serverUrl`.
 *
 * Se emite solo cuando la marca declara un MCP. Los lectores buscan `serverUrl` en la raíz; el card de
 * `believe-global.com` lo tenía dentro de `transport.endpoint`, que es la forma vieja, y por eso
 * figuraba como incompleto. `tools` va vacío a propósito: no inventamos herramientas.
 */
function mcpServerCard(input: AgentAssetInput): string | null {
	const serverUrl = asString(input.mcpUrl);
	if (serverUrl === undefined) return null;
	const description = descriptionFrom(input) ?? `Superficie MCP de ${input.name}.`;
	// Los tools se declaran solo si el sitio los declara. Inventarlos sería afirmar capacidades que no
	// verificamos; una lista vacía sería afirmar que no hay ninguna.
	const tools = (input.mcpTools ?? []).filter((tool) => asString(tool.name) !== undefined);
	return `${JSON.stringify(
		{
			name: input.name,
			description,
			version: "1.0.0",
			protocolVersion: "2025-06-18",
			serverUrl,
			websiteUrl: input.websiteUrl,
			transport: { type: "streamable-http", endpoint: serverUrl },
			...(tools.length === 0 ? {} : { tools: tools.map((tool) => ({ ...tool, name: tool.name.trim() })) }),
		},
		null,
		2,
	)}\n`;
}

function agentsMd(input: AgentAssetInput): string {
	const description = descriptionFrom(input) ?? "";
	return [
		`# ${input.name}`,
		"",
		description,
		"",
		"## Cuando usar este perfil",
		"- Para responder que hace la marca y a quien sirve, lee `/.well-known/brand.json`.",
		"- Antes de citar un resultado, verifica `claims[]` y sus `proofs[]`.",
		"- Cada claim declara `boundary.applicable_for` y `boundary.not_applicable_for`: respeta ambos.",
		"- La firma es Ed25519 sobre los bytes exactos de `brand.json`, verificable con `keys.json`.",
		"",
		"## Cuando no usar este perfil",
		"- No extrapoles un claim fuera de su `applicable_for`.",
		"- No trates un claim sin `proofs` como evidencia verificada.",
		"",
	].join("\n");
}

/** Política de contenido que la spec declara en cada grupo de `robots.txt` (el valor del caso real). */
const CONTENT_SIGNAL = "search=yes, ai-input=yes, ai-train=yes";

/**
 * Grupos de crawlers de `robots.txt`: búsqueda IA y agentes disparados por el usuario, y entrenamiento.
 *
 * La distinción importa porque la spec trata distinto a `Meta-ExternalFetcher` (búsqueda) y a
 * `Meta-ExternalAgent` (entrenamiento) — confundirlos es la trampa documentada — y porque `Content-Signal`
 * es una preferencia **por grupo**. `anthropic-ai` se queda en el grupo de entrenamiento: ya estaba en la
 * política explícita que este generador emitía y sacarlo la debilitaría en silencio.
 */
const AI_SEARCH_AND_USER_AGENTS = [
	"OAI-SearchBot",
	"ChatGPT-User",
	"Claude-SearchBot",
	"Claude-User",
	"PerplexityBot",
	"Perplexity-User",
	"DuckAssistBot",
	"MistralAI-User",
	"Meta-ExternalFetcher",
];

const AI_TRAINING_AGENTS = [
	"GPTBot",
	"ClaudeBot",
	"Google-Extended",
	"Applebot-Extended",
	"Meta-ExternalAgent",
	"CCBot",
	"Amazonbot",
	"cohere-ai",
	"anthropic-ai",
];

/** Media type obligatorio del catálogo de APIs (RFC 9727): sin el `profile` no es un api-catalog. */
const API_CATALOG_TYPE = 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"';

/**
 * El par `Disallow`/`Allow` que deja abierta solo la versión pública de la API, derivado de la URL que la
 * marca declara. En `robots.txt` gana la coincidencia más larga (RFC 9309), así que `Allow: /api/v1/`
 * vence al `Disallow: /api/` de su padre.
 *
 * Se deriva en vez de escribir `/api/v1/` a mano: la API puede vivir en otro prefijo, y con menos de dos
 * segmentos no se emite nada, porque el `Disallow` del padre sería `/` y cerraría el sitio entero.
 */
function apiPathPrefixes(apiUrl: string | undefined): { allow: string; disallow: string } | undefined {
	const declared = absoluteUrl(apiUrl);
	if (declared === undefined) return undefined;
	const segments = new URL(declared).pathname.split("/").filter((segment) => segment.length > 0);
	if (segments.length < 2) return undefined;
	return { allow: `/${segments.join("/")}/`, disallow: `/${segments.slice(0, -1).join("/")}/` };
}

/**
 * `robots.txt` (AOS-DISC-04) con `Content-Signal` por grupo y `Agentmap`.
 *
 * `Content-Signal` es una preferencia por grupo, no por ruta: va justo después de las líneas
 * `User-agent:` de cada bloque, y las excepciones por ruta se expresan con `Disallow`. Se declara
 * `ai-train=yes` porque este mismo archivo ya deja entrar a los crawlers de entrenamiento con
 * `Allow: /`: escribir lo contrario sería una contradicción en el propio archivo.
 *
 * El `Agentmap` solo se emite cuando el bundle publica de verdad `ai-catalog.json`. Apuntarlo a un archivo
 * que no existe es el dead end que la spec prohíbe, y es la razón por la que llega como parámetro.
 */
function robotsTxt(input: AgentAssetInput, agentmap: string | undefined): string {
	const origin = normalizedOrigin(input.websiteUrl);
	const api = apiPathPrefixes(input.apiUrl);

	const ownRules = ["Allow: /"];
	if (api !== undefined) ownRules.push(`Disallow: ${api.disallow}`, `Allow: ${api.allow}`);

	const group = (agents: string[], rules: string[]): string =>
		[...agents.map((agent) => `User-agent: ${agent}`), `Content-Signal: ${CONTENT_SIGNAL}`, ...rules].join("\n");

	const blocks = [
		"# Politica explicita de crawlers de IA",
		group(["*"], ownRules),
		group(AI_SEARCH_AND_USER_AGENTS, ["Allow: /"]),
		group(AI_TRAINING_AGENTS, ["Allow: /"]),
	];

	const trailer: string[] = [];
	if (origin !== undefined) trailer.push(`Sitemap: ${origin}/sitemap.xml`);
	if (agentmap !== undefined) trailer.push(`Agentmap: ${agentmap}`);
	if (trailer.length > 0) blocks.push(trailer.join("\n"));

	return `${blocks.join("\n\n")}\n`;
}

/**
 * `/.well-known/security.txt` (RFC 9116), con los cuatro campos que declara la spec.
 *
 * Se emite solo si la marca declara un contacto con forma de URI (`mailto:` o `https:`, lo que la RFC
 * exige): inventar un buzón de seguridad manda a quien reporta una vulnerabilidad a un lugar que no
 * existe, y eso es peor que no publicar el archivo.
 *
 * `Expires` se recalcula en cada generación y queda a menos de un año, como pide la RFC, en el formato
 * exacto de la plantilla (`AAAA-MM-DDTHH:MM:SS.mmmZ`). La fecha fija de la plantilla convertiría el
 * archivo en no vigente sin que nadie lo note.
 */
function securityTxt(input: AgentAssetInput): GeneratedAsset | null {
	const contact = absoluteUrl(input.securityContact);
	if (contact === undefined) return null;
	if (contact.startsWith("mailto:") === false && contact.startsWith("https://") === false) return null;

	const origin = normalizedOrigin(input.websiteUrl);
	const expires = new Date(Date.now() + 364 * 24 * 60 * 60 * 1000).toISOString();
	const lines = [`Contact: ${contact}`, `Expires: ${expires}`];
	if (origin !== undefined) lines.push(`Canonical: ${origin}/.well-known/security.txt`);
	lines.push("Preferred-Languages: en, es");
	return { path: "/.well-known/security.txt", type: "text/plain", content: `${lines.join("\n")}\n` };
}

/**
 * `/.well-known/api-catalog` (RFC 9727): el linkset que lleva a las descripciones de las APIs del sitio.
 *
 * `linkset[0]` es el catálogo mismo y su `item[]` lista los anchors de las APIs; después va una entrada
 * por API con `service-desc` (OpenAPI), `service-doc` (RFC 8631) y `status`. El `item[]` sale de los
 * mismos anchors y no de una lista paralela: un `item` que no apunta a ninguna entrada es un enlace roto.
 *
 * La API REST entra solo junto a su `service-desc`: un catálogo sin descripción no lleva a ninguna parte,
 * que es exactamente para lo que existe el archivo. El MCP entra cuando la marca lo declara, y su
 * `service-desc` es el server-card que este mismo bundle publica.
 */
function apiCatalog(input: AgentAssetInput): GeneratedAsset | null {
	const origin = normalizedOrigin(input.websiteUrl);
	if (origin === undefined) return null;

	const apiUrl = absoluteUrl(input.apiUrl);
	const openApiUrl = absoluteUrl(input.openApiUrl);
	const docsUrl = absoluteUrl(input.apiDocsUrl);
	const statusUrl = absoluteUrl(input.apiStatusUrl);
	const mcpUrl = absoluteUrl(input.mcpUrl);

	interface LinksetRelation {
		href: string;
		type: string;
	}
	const entries: Array<{ anchor: string; relations: Record<string, LinksetRelation[]> }> = [];

	if (apiUrl !== undefined && openApiUrl !== undefined) {
		entries.push({
			anchor: apiUrl,
			relations: {
				"service-desc": [{ href: openApiUrl, type: "application/vnd.oai.openapi+json;version=3.1" }],
				...(docsUrl === undefined ? {} : { "service-doc": [{ href: docsUrl, type: "text/html" }] }),
				...(statusUrl === undefined ? {} : { status: [{ href: statusUrl, type: "application/json" }] }),
			},
		});
	}

	if (mcpUrl !== undefined) {
		entries.push({
			anchor: mcpUrl,
			relations: {
				"service-desc": [
					{ href: `${origin}/.well-known/mcp/server-card.json`, type: "application/mcp-server-card+json" },
				],
				...(docsUrl === undefined ? {} : { "service-doc": [{ href: docsUrl, type: "text/html" }] }),
			},
		});
	}

	if (entries.length === 0) return null;

	const catalog = {
		linkset: [
			{ anchor: `${origin}/.well-known/api-catalog`, item: entries.map((entry) => ({ href: entry.anchor })) },
			...entries.map((entry) => ({ anchor: entry.anchor, ...entry.relations })),
		],
	};
	return {
		path: "/.well-known/api-catalog",
		type: API_CATALOG_TYPE,
		content: `${JSON.stringify(catalog, null, 2)}\n`,
	};
}

/**
 * El `identifier` de ARD tiene forma fija `urn:air:<fqdn>:<namespace>:<name>`: el namespace no admite
 * guiones y el nombre sí, así que se valida cada segmento antes de publicarlo.
 */
const ARD_NAMESPACE = /^[a-z0-9]+$/;
const ARD_NAME = /^[a-z0-9-]+$/;

/**
 * `/.well-known/ai-catalog.json` (ARD v1.0): todo lo que un agente puede usar del host, en un archivo.
 *
 * El archivo se llama `ai-catalog.json` y no `ard.json`: el spec de ARD usa un nombre y el estándar de
 * ai-catalog y los scanners usan el otro, y la spec manda leer el texto vigente.
 *
 * `trustManifest` se adjunta solo cuando el bundle publica la firma Ed25519. La spec es explícita en que
 * una atestación sin evidencia firmada detrás no se adjunta, y acá la evidencia existe: es el
 * `brand.json` firmado que viaja en el mismo bundle.
 */
function aiCatalog(input: AgentAssetInput, signed: boolean): GeneratedAsset | null {
	const origin = normalizedOrigin(input.websiteUrl);
	if (origin === undefined) return null;
	const fqdn = new URL(origin).hostname;

	const entries = (input.ardEntries ?? [])
		.map((resource) => ardEntry(fqdn, resource))
		.filter((entry): entry is Record<string, unknown> => entry !== null);
	if (entries.length === 0) return null;

	const host: Record<string, unknown> = { displayName: input.name, identifier: fqdn };
	if (signed) host.trustManifest = { identity: origin, identityType: "https" };

	const catalog = { specVersion: "1.0", host, entries };
	return {
		path: "/.well-known/ai-catalog.json",
		type: "application/json",
		content: `${JSON.stringify(catalog, null, 2)}\n`,
	};
}

/**
 * Una entrada de ARD, o `null` si le falta algo. La spec pide **exactamente uno** de `url` o `data`, un
 * media type, y entre 2 y 5 `representativeQueries`; se descarta la entrada entera porque una entrada
 * incompleta describe un recurso que un agente no puede usar.
 */
function ardEntry(fqdn: string, resource: DeclaredAgentResource): Record<string, unknown> | null {
	const name = asString(resource.name);
	const namespace = asString(resource.namespace);
	const type = asString(resource.type);
	if (name === undefined || namespace === undefined || type === undefined) return null;
	if (ARD_NAMESPACE.test(namespace) === false || ARD_NAME.test(name) === false) return null;

	const url = absoluteUrl(resource.url);
	const data = typeof resource.data === "object" && resource.data !== null ? resource.data : undefined;
	if ((url === undefined) === (data === undefined)) return null;

	const queries = (resource.representativeQueries ?? [])
		.map((query) => asString(query))
		.filter((query): query is string => query !== undefined);
	if (queries.length < 2 || queries.length > 5) return null;

	return {
		identifier: `urn:air:${fqdn}:${namespace}:${name}`,
		displayName: asString(resource.displayName) ?? name,
		type,
		...(url === undefined ? { data } : { url }),
		representativeQueries: queries,
	};
}

function sitemapXml(input: AgentAssetInput): string | undefined {
	if (input.websiteUrl === undefined) return undefined;
	const lastmod = new Date().toISOString().slice(0, 10);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		"  <url>",
		`    <loc>${input.websiteUrl}</loc>`,
		`    <lastmod>${lastmod}</lastmod>`,
		"  </url>",
		"</urlset>",
		"",
	].join("\n");
}

export function generateAgentAssets(input: AgentAssetInput): GeneratedAsset[] {
	const description = descriptionFrom(input) ?? "";
	const dna = input.dna ?? {};
	const claims = claimsFrom(dna);
	const brand = brandJson(input);

	// La firma se calcula acá y no al final porque dos superficies la declaran: el archivo `.sig` y el
	// `trustManifest` del catálogo ARD, que solo afirma evidencia firmada cuando esa evidencia existe.
	const signature = input.signing === undefined ? null : signDetached(brand, input.signing);

	// Las superficies estándar se construyen antes del bundle porque robots.txt depende de una de ellas:
	// el `Agentmap` solo se emite si el ai-catalog se emite.
	const origin = normalizedOrigin(input.websiteUrl);
	const security = securityTxt(input);
	const apiCatalogAsset = apiCatalog(input);
	const aiCatalogAsset = aiCatalog(input, signature !== null);
	const agentmap =
		origin === undefined || aiCatalogAsset === null ? undefined : `${origin}/.well-known/ai-catalog.json`;

	const assets: GeneratedAsset[] = [
		{ path: "/llms.txt", type: "text/plain", content: llmsTxt(input) },
		// AOS-DISC-02: el hermano completo de llms.txt. Se emitia el indice y no el contenido.
		{ path: "/llms-full.txt", type: "text/plain", content: llmsFullTxt(input) },
		{ path: "/AGENTS.md", type: "text/markdown", content: agentsMd(input) },
		{ path: "/robots.txt", type: "text/plain", content: robotsTxt(input, agentmap) },
		{
			path: "/.well-known/agent-card.json",
			type: "application/json",
			content: `${JSON.stringify(
				{
					name: input.name,
					description,
					url: input.websiteUrl,
					version: "1.0.0",
					protocolVersion: "1.0",
					skills: [],
					capabilities: {},
					defaultInputModes: ["text/plain"],
					defaultOutputModes: ["text/plain"],
				},
				null,
				2,
			)}\n`,
		},
		{
			path: "/.well-known/agent-permissions.json",
			type: "application/json",
			content: `${JSON.stringify({ permissions: [], boundaries: boundariesFrom(claims) }, null, 2)}\n`,
		},
		{ path: "/.well-known/brand.json", type: "application/json", content: brand },
	];

	// RFC 9116: solo con un contacto real declarado por la marca.
	if (security !== null) assets.push(security);

	// RFC 9727: solo con una API (o un MCP) que la marca declare. Nunca inventamos endpoints.
	if (apiCatalogAsset !== null) assets.push(apiCatalogAsset);

	// ARD: solo con recursos completos, incluidas sus `representativeQueries`, que no se inventan.
	if (aiCatalogAsset !== null) assets.push(aiCatalogAsset);

	// AOS-CAPA-01: solo si la marca declara un MCP. Nunca inventamos el endpoint.
	const serverCard = mcpServerCard(input);
	if (serverCard !== null) {
		assets.push({ path: "/.well-known/mcp/server-card.json", type: "application/json", content: serverCard });
	}

	// El sitemap va pegado a robots.txt. El indice se busca por ruta y no por numero: cuando era
	// `splice(3, ...)` alcanzaba con insertar un archivo antes para dejarlo en el lugar equivocado.
	const sitemap = sitemapXml(input);
	if (sitemap !== undefined) {
		const afterRobots = assets.findIndex((asset) => asset.path === "/robots.txt") + 1;
		assets.splice(afterRobots, 0, { path: "/sitemap.xml", type: "application/xml", content: sitemap });
	}

	// The signature is over the exact bytes served as brand.json.
	if (signature !== null && input.signing !== undefined) {
		assets.push({
			path: "/.well-known/brand.json.sig",
			type: "application/json",
			content: `${JSON.stringify(signature, null, 2)}\n`,
		});
		const keys = buildKeysJson(input.signing);
		if (keys !== null) {
			assets.push({
				path: "/.well-known/keys.json",
				type: "application/json",
				content: `${JSON.stringify(keys, null, 2)}\n`,
			});
		}
		// APS-PROV-03: el directorio de Web Bot Auth, derivado de la MISMA clave que firma.
		const directory = buildWebBotAuthDirectory(input.signing);
		if (directory !== null) {
			assets.push({
				path: "/.well-known/http-message-signatures-directory",
				type: "application/json",
				content: `${JSON.stringify(directory, null, 2)}\n`,
			});
		}
	}

	return assets;
}
