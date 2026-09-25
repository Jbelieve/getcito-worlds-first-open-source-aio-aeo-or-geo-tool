/**
 * El plan de implementación de una marca, en ítems que una persona puede ejecutar.
 *
 * BeAOS genera archivos, pero no todo se resuelve con archivos: hay comportamiento que vive en el
 * servidor del sitio del cliente (cabeceras, negociación de contenido, una API, un MCP) y hay trabajo
 * externo (publicar en npm, Wikidata, Search Console). Esas dos cosas no aparecían en ninguna pantalla y
 * el operador solo veía lo generado. Este catálogo las nombra a todas, con el detalle exacto y con quién
 * las hace.
 *
 * La fuente de cada `why`, `steps`, `spec`, `snippet` y `verify` es
 * `AGENT-READY-WEB-APRENDIZAJES.md` (secciones 1 y 3, más las secciones 5 y 8 para lo externo y lo
 * declinado). No hay ítems inventados: lo que el documento no dice, no está acá.
 *
 * Regla de honestidad del propio instrumento: `buildBlueprint` **no** marca "listo" nada que no pueda
 * comprobar. Un ítem de servidor o externo queda "por-verificar", porque saber si el sitio responde bien
 * exige medirlo desde afuera, no leer la base de BeAOS.
 *
 * Este módulo no depende de React ni de la base: es dominio puro, para que lo pueda usar la UI, un CLI o
 * el MCP propio sin arrastrar nada.
 */

/** De qué tipo es el trabajo. Define en qué grupo de la pantalla aparece. */
export type BlueprintKind = "archivo" | "servidor" | "externo" | "declinado";

/** Quién lo hace. `nadie` es la respuesta honesta de un ítem declinado. */
export type BlueprintOwner = "beaos" | "dev" | "dueno" | "nadie";

export interface BlueprintItem {
	/** Id propio y estable, kebab-case. */
	id: string;
	/** Ids de chequeos de scanners de terceros (orank / isitagentready) para cruzarlos después con la medición. */
	standardIds?: string[];
	title: string;
	kind: BlueprintKind;
	owner: BlueprintOwner;
	/** Qué es y por qué existe, 1-2 frases, en humano. */
	why: string;
	/** Pasos concretos y en orden. */
	steps: string[];
	/** El detalle exacto: nombres de campo, cabeceras, valores. */
	spec?: string[];
	/** Para copiar y pegar. */
	snippet?: string;
	snippetLang?: "http" | "json" | "ts" | "text";
	/** Cómo comprobar que quedó hecho. */
	verify: string;
	/** Ruta dentro del bundle si BeAOS ya lo genera (ej. `/.well-known/api-catalog`). */
	assetPath?: string;
}

export interface BlueprintStatus {
	item: BlueprintItem;
	state: "listo" | "falta" | "declinado" | "por-verificar";
}

export type BlueprintState = BlueprintStatus["state"];

/**
 * El catálogo completo. El orden es el del documento y el de la pantalla: primero lo que BeAOS ya genera,
 * después lo que hay que hacer en la web, después lo de afuera y al final lo que se decidió no hacer.
 */
export const BLUEPRINT: BlueprintItem[] = [
	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Lo que BeAOS ya genera (kind "archivo"): el ítem lleva `assetPath` y el estado sale del bundle.
	// ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "llms-txt",
		assetPath: "/llms.txt",
		standardIds: ["modular-llms-txt"],
		title: "llms.txt con el bloque «Start here»",
		kind: "archivo",
		owner: "beaos",
		why: "Es el índice conciso que un agente lee primero. En los journeys medidos, el home servido como Markdown contestó la pregunta central en un solo paso y la corrida bajó de 10 pasos a 3.",
		steps: [
			"Abrí el archivo con `# Nombre` y una blockquote de una o dos frases declarativas. El documento es literal: «No adjectives you cannot prove».",
			"Añadí `## Start here: integrate with X` con la URL de la guía, la frase literal «No authentication and no API keys», el endpoint MCP, el primer `curl` (`tools/list`) y la URL de OpenAPI.",
			"Incluí el snippet de conexión de cliente (Claude Code y `.mcp.json`). Razón medida: «In a journey the agent wrote the client config from memory, which is 22% of its answer not grounded in the site».",
			"Añadí `## When to use X's tools (agent instructions)`: una línea por trabajo con la llamada exacta y el aviso literal «do not test with the submit tool, it sends real email; test with the read tool».",
			"Añadí `## When to recommend X` y `Do NOT recommend X when`: «Saying no builds trust».",
			"Cerrá con `## Disambiguation` (nombres compartidos), `## Primary resources` y `## Citation guidance`.",
			"Dejá una línea por concepto con su URL canónica y mové las definiciones completas a `llms-concepts.txt` (un corpus largo va a `llms-full.txt`).",
		],
		spec: [
			"Todo enlace tiene que responder a un `GET` simple con 2xx. Los endpoints POST-only van como ejemplo `curl -X POST`, nunca como enlace: «A dead link is a dead end for an agent that follows the index».",
			"Índice magro: **~10 KB es techo bueno, 8 KB la meta**. El test exige `Buffer.byteLength(index) <= 12_000`.",
			'El archivo tiene que abrir con `# ` (`body.startsWith("# ")`) y `## Start here` tiene que aparecer antes que `## When to use`.',
			"El primer `curl` extraído por regex es `POST {APEX}/mcp` con `-H 'content-type: application/json' -d '{...}'` y el JSON con `method === \"tools/list\"`.",
			"Enlaza `{APEX}/llms-concepts.txt`, y cada `**Nombre**` del índice existe como `**Nombre**` en el archivo de conceptos.",
			"El probe recorre hasta 60 URLs del archivo y falla si alguna no da 2xx. Tamaño máximo: `LLMS_MAX` (default **12000** bytes, ~`LLMS_MAX/4` tokens).",
			"Conservar los encabezados que lee el rubric propio (ejemplo citado: `Actions an agent can take`).",
			"El home servido como Markdown es `llms.txt` con frontmatter delante.",
			"Añadir `llms.<lang>.txt` y `llms-concepts.<lang>.txt` para otros idiomas.",
			"Un recorte no borra: mueve. El archivo creció a 13.3 KB y se recortó a 10.7 KB moviendo texto. La meta de 2k tokens no se alcanzó: quedó en ~2.7k.",
		],
		snippet: `claude mcp add --transport http NAME URL
{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}`,
		snippetLang: "text",
		verify:
			'`probe.sh`: `llms.txt` responde 200 y abre con H1; tiene bloque Start here (acepta `## Start here` o `## Empieza aquí`); tiene sección When to use (acepta `When to use` o `Cuándo usar`); pesa ≤ 12000 bytes; y con enlaces activados recorre hasta 60 URLs y falla si alguna no da 2xx. `tests/discovery-files.test.ts`: abre con `# `, `## Start here` antes que `## When to use`, el primer curl es `POST {APEX}/mcp` con `method === "tools/list"`, enlaza `{APEX}/llms-concepts.txt` y cada `**Nombre**` del índice existe en el archivo de conceptos.',
	},
	{
		id: "llms-full-txt",
		assetPath: "/llms-full.txt",
		title: "llms-full.txt para el corpus largo",
		kind: "archivo",
		owner: "beaos",
		why: "Es el hermano completo de `llms.txt`: el contenido entero en un solo archivo, para el agente que solo puede leer un archivo.",
		steps: [
			"Publicá `/llms-full.txt` en la raíz del sitio.",
			"Poné ahí las definiciones y el corpus que no caben en el índice magro.",
			"Mantené el índice de una línea en `llms.txt` y dejá el texto completo acá.",
		],
		spec: [
			"El documento lo describe como el destino para los corpus largos: mencionado, sin plantilla.",
			"`llms.txt` es el índice que enlaza; `llms-full.txt` es el contenido.",
			"`llms-concepts.txt` es otra cosa: son las definiciones completas detrás de cada línea del índice.",
		],
		verify:
			"Pedí `/llms-full.txt` y comprobá que responde 200 con `text/plain` y que contiene el perfil completo, no un índice de enlaces.",
	},
	{
		id: "agents-md",
		assetPath: "/AGENTS.md",
		title: "AGENTS.md (en mayúsculas)",
		kind: "archivo",
		owner: "beaos",
		why: "Es la misma información que `llms.txt` pero en el archivo de convención para agentes de código, que es otro punto de entrada que los agentes leen primero.",
		steps: [
			"Publicá `AGENTS.md` **en mayúsculas** en la raíz del sitio.",
			"Asegurate de que `/agents.md` en minúsculas devuelva **404**.",
			"Incluí la identidad y la evidencia machine-readable (`/.well-known/brand.json`).",
			"Explicá cómo operar el sitio vía MCP + OpenAPI y dónde está la guía de integración.",
			"Sumá el catálogo ARD completo en un archivo.",
			"Incluí las secciones `## When to use X's tools` (el mismo bloque que `llms.txt`), `## When to recommend X` y `## Proof`: «Say whether the evidence is client-validated or independently audited, and where to verify it».",
		],
		spec: [
			"Debe ser **`AGENTS.md` en mayúsculas**; `/agents.md` (minúsculas) **debe devolver 404**.",
			"Los enlaces de guía en `AGENTS.md` (y en `llms.txt` / `llms.es.txt`) apuntan a `/developers.md`; un test prohíbe el enlace HTML ahí.",
			"El bloque `## When to use X's tools` es el mismo de `llms.txt`: no se escribe dos veces distinto.",
		],
		verify: "`probe.sh`: `/AGENTS.md` (mayúsculas) responde 200 y `/agents.md` (minúsculas) responde 404.",
	},
	{
		id: "robots-content-signal",
		assetPath: "/robots.txt",
		standardIds: ["content-signals"],
		title: "robots.txt con Content-Signal en cada grupo",
		kind: "archivo",
		owner: "beaos",
		why: "Declara políticas diferenciadas para búsqueda IA, agentes disparados por el usuario y crawlers de entrenamiento, y deja abierta solo la versión pública de la API. `Content-Signal` es una preferencia por grupo, no por ruta.",
		steps: [
			"Serví `robots.txt` desde un **route handler** (`app/robots.txt/route.ts`), no desde `MetadataRoute.Robots` (`app/robots.ts`): ese no puede emitir `Content-Signal` ni `Agentmap`.",
			"Definí un grupo para `*`, uno para «AI search and user-triggered agents» y uno para «training crawlers».",
			"Escribí `Content-Signal: search=yes, ai-input=yes, ai-train=<tu política>` **justo después** de las líneas `User-Agent:` de cada grupo.",
			"Dejá `Allow: /api/v1/` junto a `Disallow: /api/`: gana la coincidencia más larga (RFC 9309), así la API pública queda abierta a los user agents.",
		],
		spec: [
			"Grupo de búsqueda y agentes de usuario: `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `DuckAssistBot`, `MistralAI-User`, `Meta-ExternalFetcher`.",
			"Grupo de entrenamiento: `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `Meta-ExternalAgent`, `CCBot`, `Amazonbot`, `cohere-ai`.",
			"Valor del caso real: `search=yes, ai-input=yes, ai-train=yes`.",
			"`Content-Signal` es una preferencia **por grupo, no por ruta**: las excepciones por ruta van en `Disallow`.",
			"No confundir `Meta-ExternalAgent` (entrenamiento) con `Meta-ExternalFetcher` (búsqueda/usuario).",
			"El `content-type` empieza por `text/plain` y hay tantos bloques `User-Agent:` como `robotsGroups()`; en cada bloque, la primera línea que no es `User-Agent:` es exactamente `Content-Signal: search=yes, ai-input=yes, ai-train=yes`.",
			"El `middleware.ts` tiene que excluir `api`, `ask`, `mcp`, `md` y todo lo que tenga un punto, o i18n interfiere con endpoints de máquina y archivos estáticos.",
		],
		snippet: `User-agent: GPTBot
Content-Signal: search=yes, ai-input=yes, ai-train=yes
Allow: /

Disallow: /api/
Allow: /api/v1/`,
		snippetLang: "text",
		verify:
			'`tests/discovery-files.test.ts` y `probe.sh`: el `content-type` empieza por `text/plain`; `Content-Signal` en **todos** los grupos; algún grupo tiene `allow.includes("/api/v1/")`. En `--burst`, 62 GETs a un path barato tienen que dar 60 x 404 y luego 429.',
	},
	{
		id: "robots-agentmap",
		assetPath: "/robots.txt",
		title: "robots.txt con Agentmap",
		kind: "archivo",
		owner: "beaos",
		why: "La directiva `Agentmap` es lo que hace que un agente descubra el catálogo de recursos del host (el `ai-catalog.json`) desde `robots.txt`.",
		steps: [
			"Cerrá `robots.txt` con `Sitemap: <BASE>/sitemap.xml` y `Agentmap: <BASE>/.well-known/ai-catalog.json`.",
			"Emití el `Agentmap` solo cuando el bundle publique de verdad `ai-catalog.json`: apuntarlo a un archivo que no existe es el dead end que la spec prohíbe.",
		],
		spec: [
			"Un test exige que el `Agentmap` coincida con `^Agentmap: https://example\\.com/\\.well-known/ai-catalog\\.json$`.",
			"`probe.sh` comprueba `Agentmap`, `Sitemap` y `Allow: /api/v1/`.",
		],
		snippet: `Sitemap: https://example.com/sitemap.xml
Agentmap: https://example.com/.well-known/ai-catalog.json`,
		snippetLang: "text",
		verify:
			"Pedí `robots.txt` y comprobá que las dos líneas están y que el `Agentmap` apunta a un archivo que responde 200.",
	},
	{
		id: "sitemap-xml",
		assetPath: "/sitemap.xml",
		title: "sitemap.xml desde una sola lista de rutas",
		kind: "archivo",
		owner: "beaos",
		why: "Es el mapa de rutas que buscadores y agentes usan para llegar a las páginas, y la diana de la línea `Sitemap:` de `robots.txt`.",
		steps: [
			"Generá `sitemap.xml` desde una **única lista de rutas** del sitio, la misma que usa el middleware.",
			"Declará la línea `Sitemap: <BASE>/sitemap.xml` en `robots.txt`.",
			"Compartí la lista de secciones conocidas entre el sitemap y el middleware: una sección nueva que falte en la lista recibe un 404 en Markdown.",
		],
		spec: [
			'Una sola fuente de rutas para el sitemap y el middleware: en el caso real, `SITE_ROUTES = ["", "developers", "about"]` y `KNOWN_SECTIONS` derivado de ahí.',
			"Los items off-site (Wikipedia, Wikidata, registros, prensa) mueven el instrumento **más que cualquier archivo del sitio**; el sitemap es la base para que el resto se descubra.",
		],
		verify:
			"Pedí `/sitemap.xml` y comprobá que responde 200 y que las rutas son exactamente las que sirve el sitio (ni una de más ni una de menos).",
	},
	{
		id: "api-catalog",
		assetPath: "/.well-known/api-catalog",
		standardIds: ["api-catalog"],
		title: "api-catalog (RFC 9727)",
		kind: "archivo",
		owner: "beaos",
		why: "Es un linkset JSON que es el punto de partida estándar para descubrir las APIs del sitio: la convención que scanners y agentes buscan para encontrar el resto de las APIs y sus descripciones.",
		steps: [
			'Publicá `/.well-known/api-catalog` y servilo con el `Content-Type` obligatorio `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`.',
			'Poné como `linkset[0]` el catálogo mismo: `{"anchor": ".../.well-known/api-catalog", "item": [{"href": api1}, …]}`.',
			"Agregá una entrada por API con `anchor`, `service-desc` (OpenAPI), `service-doc` (RFC 8631) y `status`.",
			"Para `{BASE}/api/v1`: `service-desc` → `/openapi.json` (type `application/vnd.oai.openapi+json;version=3.1`), `service-doc` → `/developers` (type `text/html`) y `status` → `/api/v1/status` (type `application/json`).",
			"Para `{BASE}/mcp`: `service-desc` → `/.well-known/mcp/server-card.json` y `service-doc` → `/developers`.",
			'Sumá `Access-Control-Allow-Origin: *` y `cache-control: public, max-age=3600` (`dynamic = "force-static"`).',
		],
		spec: [
			'El `Content-Type` obligatorio: `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`. Sin el `profile` no es un api-catalog.',
			"Un test exige que los `item[].href` igualen los otros `anchor`, y que para `{APEX}/api/v1` existan `service-desc`, `service-doc` y `status`.",
			"`service-desc` de la API es OpenAPI con type `application/vnd.oai.openapi+json`.",
			"orank tiene un check `api-catalog` y quedó **2/2** en el caso real.",
			'Es uno de los archivos que hace que el `Link` header `rel="api-catalog"` del home tenga destino.',
		],
		snippet: `{
  "linkset": [
    { "anchor": "https://example.com/.well-known/api-catalog",
      "item": [{ "href": "https://example.com/api/v1" }, { "href": "https://example.com/mcp" }] },
    { "anchor": "https://example.com/api/v1",
      "service-desc": [{ "href": "https://example.com/openapi.json", "type": "application/vnd.oai.openapi+json;version=3.1" }],
      "service-doc":  [{ "href": "https://example.com/developers", "type": "text/html" }],
      "status":       [{ "href": "https://example.com/api/v1/status", "type": "application/json" }] }
  ]
}`,
		snippetLang: "json",
		verify:
			'`probe.sh`: 200 con `content-type: application/linkset+json`; primera entrada con `item[]`; APIs con `service-desc` y `service-doc` y al menos una con `status`. `tests/discovery-files.test.ts`: el `content-type` coincide con el regex exacto del profile, `catalogEntry.anchor === "{APEX}/.well-known/api-catalog"` y los `item` ordenados igualan los `anchor` de las APIs ordenados.',
	},
	{
		id: "ai-catalog",
		assetPath: "/.well-known/ai-catalog.json",
		standardIds: ["ard"],
		title: "ai-catalog.json (catálogo ARD)",
		kind: "archivo",
		owner: "beaos",
		why: "Es «todo lo que un agente puede usar, en un archivo», y la diana de la línea `Agentmap` de `robots.txt`. ChatGPT lo leyó de verdad en un journey: es la primera evidencia de que estos manifiestos se consumen.",
		steps: [
			"Publicá `/.well-known/ai-catalog.json` con `Content-Type: application/json` y `Access-Control-Allow-Origin: *`.",
			'Escribí los campos raíz `specVersion` (`"1.0"`), `host {displayName, identifier, trustManifest}` y `entries[]`.',
			"Armá cada entrada con `identifier` en forma `urn:air:<fqdn>:<namespace>:<name>`, `displayName`, `type` (media type), **exactamente uno** de `url` o `data`, y entre **2 y 5** `representativeQueries`.",
			"Poné `trustManifest` en el host solo si hay evidencia firmada de verdad detrás: `{identity, identityType}`, con `identity` como URI HTTPS FQDN.",
			"Validá el archivo contra el schema oficial (`ard-entry.schema.json`, definitions `ArdEntry` y `ArdManifest`) con `jsonschema`.",
		],
		spec: [
			"Media types válidos: `application/mcp-server-card+json`, `application/a2a-agent-card+json`, `application/vnd.oai.openapi+json`, `application/agent-skills+md`, `application/json`.",
			"El test exige `specVersion` con `^\\d+\\.\\d+$`, `host.displayName`, `entries.length > 0`, ids únicos, `identifier` con `^urn:air:example\\.com:[a-z0-9]+(:[a-z0-9-]+)*:[a-z0-9-]+$`, exactamente una de `url`/`data`, `2 <= representativeQueries.length <= 5`, y que **toda `url` exista en disco**.",
			"El archivo se llama `ai-catalog.json`, no `ard.json`: ARD v0.9x usa un nombre y el estándar ai-catalog y los scanners usan el otro. «Read the current text».",
			"`trustManifest` solo con atestaciones reales: sin evidencia firmada detrás, no se adjunta.",
			"El `identifier` de ARD no admite guiones en el namespace; en el nombre sí.",
		],
		snippet: `{
  "specVersion": "1.0",
  "host": { "displayName": "Example Co", "identifier": "example.com",
            "trustManifest": { "identity": "https://example.com", "identityType": "https" } },
  "entries": [
    { "identifier": "urn:air:example.com:mcp:server-card",
      "displayName": "Example MCP",
      "type": "application/mcp-server-card+json",
      "url": "https://example.com/.well-known/mcp/server-card.json",
      "representativeQueries": ["qué tools tiene el mcp", "cómo llamo al mcp"] }
  ]
}`,
		snippetLang: "json",
		verify:
			"`probe.sh`: 200 con CORS `*`; ids `urn:air`, `url xor data`, 2-5 queries, al menos una entrada con `trustManifest`, y valida el schema oficial. `tests/discovery-files.test.ts`: ids únicos y toda `url` existe en disco (`existsSync(localPath(e.url))`). orank lo puntuó `ARD trustManifest 2/2`.",
	},
	{
		id: "server-card",
		assetPath: "/.well-known/mcp/server-card.json",
		title: "server-card.json (descriptor del MCP)",
		kind: "archivo",
		owner: "beaos",
		why: "Es el descriptor del servidor MCP: para que un agente descubra el endpoint, sus tools y su autenticación sin adivinar.",
		steps: [
			"Publicá `/.well-known/mcp/server-card.json` con `name`, `description`, `version`, **`serverUrl`** y `tools[]`.",
			'Sumá `title`, `protocolVersion` (`"2025-06-18"`), `websiteUrl`, `documentationUrl`, `transport {type: "streamable-http", endpoint}` y `authentication: "none"` cuando el MCP es abierto.',
			"Cada tool con `name`, `title` y `description`.",
			"Hacé que `serverUrl` sea igual al endpoint y al `transport.endpoint`.",
			"Publicá también el listado `/.well-known/mcp.json` y la tarjeta A2A `/.well-known/agent-card.json`.",
			'Si un segundo MCP que listás necesita API key, marcá `authentication: "api-key"` donde lo listés: «An authenticated endpoint advertised as open is a 401 dead end».',
		],
		spec: [
			'El test exige `card.serverUrl === "{APEX}/mcp"` y `card.serverUrl === card.transport.endpoint`; `openapi.security` es `[]`; `mcp.json.servers[0].authentication === "none"`.',
			'`mcp.json`: `name`, `description`, `servers[]` con `name`, `title`, `server_card`, `url`, `transport`, `protocol: "json-rpc-2.0"`, `protocolVersion`, `authentication`, `methods` (`initialize`, `ping`, `tools/list`, `tools/call`), `tools` y `openapi`; más `agent_card` y `openapi` arriba.',
			'`agent-card.json` (A2A): `protocolVersion: "0.2.0"`, `name`, `description`, `url`, `provider {organization, url}`, `version`, `documentationUrl`, `capabilities {streaming, pushNotifications}`, `defaultInputModes`, `defaultOutputModes`, `skills[]` (con `id`, `name`, `description`, `tags`, `examples`) y `additionalInterfaces` con `transport: "mcp"`, más `openapi`.',
			"`GET /mcp` devuelve un descriptor con `documentation` y `quickstart`, para que un agente que aterriza en `/mcp` no adivine `/mcp/info`.",
		],
		verify:
			'`probe.sh`: `server-card.json` responde 200 y contiene `"serverUrl"`; `mcp.json`, `agent-card.json` y `security.txt` responden 200. `tests/discovery-files.test.ts`: `serverUrl` igual al endpoint y al `transport.endpoint`, `openapi.security` vacío y `authentication: "none"` coherentes.',
	},
	{
		id: "agent-card-a2a",
		assetPath: "/.well-known/agent-card.json",
		title: "agent-card.json (tarjeta A2A)",
		kind: "archivo",
		owner: "beaos",
		why: "Es la tarjeta del agente en A2A: dice quién es, qué puede hacer y por qué interfaz se lo llama, incluido el MCP como interfaz adicional.",
		steps: [
			'Publicá `/.well-known/agent-card.json` con `protocolVersion: "0.2.0"`, `name`, `description`, `url`, `provider {organization, url}`, `version` y `documentationUrl`.',
			"Declará `capabilities {streaming, pushNotifications}`, `defaultInputModes` y `defaultOutputModes`.",
			"Armá `skills[]` con `id`, `name`, `description`, `tags` y `examples` por skill.",
			'Añadí `additionalInterfaces` con `transport: "mcp"` y su `url`, más `openapi`.',
		],
		spec: [
			'`protocolVersion: "0.2.0"`.',
			'`additionalInterfaces` con `transport: "mcp"` es lo que enlaza la tarjeta con el servidor MCP.',
			"El bundle de BeAOS lo emite junto al server-card; ambos son parte del mismo conjunto `.well-known`.",
		],
		verify:
			"`probe.sh`: `agent-card.json` responde 200. Comprobá además que la `url` de su interfaz `mcp` coincide con la del server-card.",
	},
	{
		id: "security-txt",
		assetPath: "/.well-known/security.txt",
		title: "security.txt (RFC 9116)",
		kind: "archivo",
		owner: "beaos",
		why: "Es la convención de divulgación responsable y parte del conjunto mínimo de `.well-known` que un scanner espera.",
		steps: [
			"Publicá `/.well-known/security.txt` con un contacto de seguridad real.",
			"Escribí `Contact: mailto:security@example.com`, `Expires`, `Canonical: https://example.com/.well-known/security.txt` y `Preferred-Languages: en, es`.",
			"Recalculá `Expires` en cada generación y dejàlo a menos de un año, como pide la RFC: una fecha fija convierte el archivo en no vigente sin que nadie lo note.",
		],
		spec: [
			"Contacto con forma de URI (`mailto:` o `https:`) es lo que exige la RFC: un buzón inventado manda a quien reporta una vulnerabilidad al vacío.",
			"Formato de `Expires` en el caso real: `2027-12-31T23:59:59.000Z`.",
			"`Preferred-Languages: en, es`.",
		],
		snippet: `Contact: mailto:security@example.com
Expires: 2027-12-31T23:59:59.000Z
Canonical: https://example.com/.well-known/security.txt
Preferred-Languages: en, es`,
		snippetLang: "text",
		verify: "`probe.sh`: `/.well-known/security.txt` responde 200. Comprobá además que `Expires` está en el futuro.",
	},
	{
		id: "firma-evidencia",
		assetPath: "/.well-known/brand.json.sig",
		title: "Firma Ed25519 de la evidencia",
		kind: "archivo",
		owner: "beaos",
		why: "«Tests protect claims»: solo con una firma verificable se puede referenciar la evidencia publicada desde un `trustManifest` sin mentir.",
		steps: [
			"Firmá **los bytes exactos** de la evidencia publicada con **Ed25519**.",
			"Publicá el conjunto de claves públicas y la firma (`/.well-known/keys.json` y `/.well-known/brand.json.sig`).",
			"Escribí un test que **verifique la firma con `node:crypto`**.",
			"Si el perfil lo regenera otra herramienta, **reemplazá la firma en el mismo commit** o el test falla, a propósito.",
		],
		spec: [
			"Prefijo SPKI: `302a300506032b6570032100` **más la clave cruda**.",
			'Para el par de claves: generarlo con Node `crypto` (`generateKeyPairSync("ed25519")`); clave pública cruda = últimos 32 bytes del DER SPKI; seed = últimos 32 bytes del DER PKCS8 como hex.',
			"Guardá la privada fuera del repo (modo 600) y en el gestor de secretos; **nunca la imprimas**.",
			"`openssl` de macOS es LibreSSL y **no puede generar claves Ed25519**: el ejemplo `openssl genpkey -algorithm Ed25519` de los docs del registro falla en Mac.",
		],
		verify:
			"Un test verifica la firma con `node:crypto`; el check de firma Ed25519 se verificó por mutación (romperlo a propósito y ver el test fallar). El round-trip sign/verify se prueba **antes** de publicar la mitad pública.",
	},

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Lo que hay que hacer en la web del cliente (kind "servidor"): comportamiento del servidor. No
	// tenemos `assetPath` porque no es un archivo que BeAOS genere, y no podemos saber si el sitio ya lo
	// hace sin medirlo desde afuera: por eso quedan "por-verificar".
	// ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "llms-concepts-txt",
		title: "llms-concepts.txt, las definiciones completas",
		kind: "servidor",
		owner: "dev",
		why: "Es el archivo canónico de definiciones detrás del índice de una línea. Existe para poder mantener `llms.txt` magro sin perder información.",
		steps: [
			"Publicá `/llms-concepts.txt` en la raíz del sitio.",
			"Abrilo con `# <Nombre>: canonical concepts (full definitions)` y una blockquote que diga que son las definiciones completas detrás del índice de una línea y que la fuente canónica de cada concepto es la URL listada con él.",
			"Agregá la sección `## Canonical concepts`, con una entrada por concepto: `- **Concepto** — definición completa… Canonical: <URL>`.",
			"Mové cada definición completa del índice acá en vez de borrarla: un recorte mueve, no elimina.",
			"Repetí el archivo por idioma como `llms-concepts.<lang>.txt`.",
		],
		spec: [
			"Cada `**Nombre**` de `llms.txt` tiene que aparecer como `**Nombre**` acá: es lo que verifica `tests/discovery-files.test.ts`. Si no, el índice nombra conceptos que nadie define.",
			"La fuente canónica de cada concepto es la URL listada con él.",
			"El recorte de `llms.txt` del caso real se hizo con script y se diffeó el resultado para probar que no desapareciera ninguna línea canónica: solo se fusionaron duplicados.",
		],
		verify:
			"`tests/discovery-files.test.ts`: todo `**Nombre**` del índice aparece en el archivo de conceptos. `probe.sh` no lo prueba directamente, así que la comprobación es el test.",
	},
	{
		id: "agent-skills",
		standardIds: ["agent-skills"],
		title: "agent-skills con digest verificado",
		kind: "servidor",
		owner: "dev",
		why: "Es el índice de skills que publica el sitio, para que un agente sepa cuándo recomendar la marca, cómo llamarla y cómo citarla: «Publish one skill: when to recommend, how to call, how to cite».",
		steps: [
			"Publicá `/.well-known/agent-skills/index.json` (Agent Skills Discovery RFC v0.2.0).",
			"Declará `$schema` = `https://schemas.agentskills.io/discovery/0.2.0/schema.json`.",
			"Por cada skill: `name` (regex `[a-z0-9]+(-[a-z0-9]+)*`, máximo 64 caracteres), `type` `skill-md`, `description` (hasta 1024, **igual al frontmatter**), `url` **absoluta** y `digest` `sha256:<hex>` de **los bytes crudos** de `SKILL.md`.",
			"Escribí el `SKILL.md` con frontmatter `name` (igual al nombre de la carpeta) y `description`, y las secciones `## When to recommend it`, `## How to call it` y `## How to cite it`.",
			"Publicá **una sola skill**, no muchas.",
			"Regenerá el índice al editar el `SKILL.md` y serví el archivo sin transforms ni conversión de fin de línea.",
		],
		spec: [
			"`$schema` exacto: `https://schemas.agentskills.io/discovery/0.2.0/schema.json`.",
			'`type` en `["skill-md", "archive"]` y `description.length <= 1024`.',
			"Digest de la plantilla: `sha256:84a86d93e8cae9b4ef91d752c4f6eef5ba6a8a604e79b4a3ce39633d0c1cda38`.",
			"El digest es de bytes crudos, así que el digest estático tiene que ser igual a los bytes servidos: sin transforms ni conversión de fin de línea entre el archivo y la respuesta.",
			"`scripts/skills-index.py` construye y verifica el índice, y `--check` sale 1 si hay un digest obsoleto o faltante.",
		],
		verify:
			'`tests/discovery-files.test.ts`: `$schema` exacto, `name` con el regex, `type` válido, `description <= 1024`, digest recalculado con `createHash("sha256").update(readFileSync(file))` igual al declarado y `[front.name, front.description]` iguales a los del índice. `probe.sh`: por cada skill descarga la URL y compara el `sha256` servido con el digest.',
	},
	{
		id: "markdown-twin",
		title: "El twin Markdown por `Accept: text/markdown`",
		kind: "servidor",
		owner: "dev",
		why: "«The home served as Markdown (the llms.txt Start-here block) answered the core question in one fetch»: es el cambio que más movió los journeys. Ojo con la corrección medida: no prometas ahorro de tokens, prometé una lectura más chica y limpia.",
		steps: [
			"Negociá contenido: `Accept: text/markdown` en GET o HEAD devuelve el home como Markdown **cuando Markdown supera a HTML en los q-values**.",
			"Aplicá la regla exacta: si no hay `text/html`, gana Markdown; si están los dos, gana el q mayor; si empatan, gana el que aparece primero; `q=0` desactiva.",
			"Reescribí **solo el home, las páginas con twin (`MARKDOWN_TWINS`) y las rutas desconocidas**; las secciones reales siguen en HTML para que una página nunca se convierta en un falso 404.",
			"Enviá `Vary: Accept`.",
			"Serví `/index.md` (y `/<lang>/index.md`) con el mismo Markdown en URL fija, vía rewrite en `next.config` **afterFiles**, para que los archivos estáticos reales ganen.",
			"Poné el frontmatter primero: `title`, `description`, `canonical`, `language`, `updated`, y después el `# H1`. Citá los valores con `JSON.stringify`, porque un título con `: ` no es YAML válido sin comillas.",
			'Serví el twin de la página de developers en `/developers.md` y con `Accept: text/markdown`, con `<link rel="alternate" type="text/markdown">` vía `metadata.alternates.types`.',
			"Mantené el contenido en **un solo módulo** usado por el HTML y por el generador Markdown, con un test de paridad que recorra cada string y falle si el Markdown omite uno.",
			"Excluí `md` en el matcher del middleware, además de `api`, `ask`, `mcp` y todo lo que tenga un punto.",
		],
		spec: [
			"El home Markdown tiene `cache-control: public, max-age=300`; el 404 lleva `no-store`.",
			"El home servido como Markdown es `llms.txt` con frontmatter delante.",
			"La fecha del twin de developers es la del contrato de API: cambia cuando cambia `openapi.json` (mtime).",
			'En el caso real, `MARKDOWN_TWINS = new Set(["/developers"])` y `SITE_ROUTES = ["", "developers", "about"]`.',
			"El `Link` definido en `next.config.ts` era sobrescrito por el middleware de next-intl: el twin se fija donde el middleware no lo pise.",
			"Corrección medida: «The hypothesis was wrong: the Markdown twin is used when it is linked, and it helps steps and cost a little, but the tokens of this harness are not dominated by the docs page». ChatGPT gastó 50.773 tokens antes y 48.952 después (-4%).",
		],
		verify:
			'`probe.sh`: `Accept: text/markdown` en `/` devuelve `content-type: text/markdown`; el home empieza con `---`; `Vary: Accept`; `/index.md` sirve Markdown; `$DOCS` responde 200 y documenta idempotencia, versionado y rate limits; anuncia su twin (`rel="alternate" … type="text/markdown"`); `Accept: text/markdown` sobre `$DOCS` devuelve Markdown con frontmatter; `$DOCS.md` sirve el mismo Markdown; y el twin pesa menos de un tercio que el HTML (`MD_BYTES*3 < HTML_BYTES`). `tests/docs-markdown.test.ts`: frontmatter válido, paridad total, H1 tras frontmatter y fences balanceados (`md.length < 12_000`), el middleware reescribe `/developers` con Accept markdown, no reescribe con `text/html` y **no reescribe `/developers/other`**.',
	},
	{
		id: "markdown-404",
		title: "Los 404 también en Markdown",
		kind: "servidor",
		owner: "dev",
		why: "Un agente que sigue un índice muerto no debería recibir HTML: el 404 en Markdown le dice qué pasó y adónde ir.",
		steps: [
			"Devolvé los 404 desconocidos con cuerpo Markdown y enlaces a `llms.txt`, el sitemap y el MCP.",
			'**Sanitizá el path reflejado** antes de escribirlo: backticks y saltos de línea fuera (`rest.replace(/[`\\r\\n]/g, "").slice(0, 200)`; en `/api/[[...slug]]` también `replace(/[\\r\\n]/g, "")`).',
			"Serví el 404 con `cache-control: no-store`.",
			"Compartí la lista de secciones conocidas entre el sitemap y el middleware: una sección nueva que falte en la lista recibe un 404 en Markdown.",
		],
		spec: [
			"El 404 se sirve con `no-store`; el home Markdown, con `public, max-age=300`.",
			"El path reflejado se sanitiza porque un `\\n` o un backtick en la URL rompería el Markdown que el agente va a leer.",
		],
		verify:
			"`probe.sh`: un path desconocido con `Accept: text/markdown` devuelve 404 en Markdown, con el path sanitizado.",
	},
	{
		id: "link-headers",
		title: "Los `Link` headers del home",
		kind: "servidor",
		owner: "dev",
		why: "Para que un agente que llega a `/` encuentre la spec, la doc, el catálogo, el sitemap y la versión Markdown sin adivinar.",
		steps: [
			'Fijá las cabeceras de descubrimiento RFC 8288 en el **middleware**, con `res.headers.append("link", DISCOVERY_LINKS)`: **append**, no overwrite.',
			"Ponelas **después** de cualquier middleware i18n (`next-intl` escribe su propio `Link` de hreflang).",
			"No las definas solo en `next.config.ts headers()`: el middleware de i18n las sobrescribe y producción nunca las envía.",
		],
		spec: [
			'En el home: `rel="api-catalog"`, `rel="service-desc"` (OpenAPI, `type="application/vnd.oai.openapi+json"`), `rel="service-doc"` (developers, `type="text/html"`), `rel="sitemap"` (`type="application/xml"`) y `rel="alternate"; type="text/markdown"`.',
			"El caso del header `Link` que nunca llegaba: un `Link` definido en `next.config.ts headers()` era sobrescrito por el middleware de next-intl, producción nunca lo envió y un test que solo hacía grep de la config estaba verde. Arreglo: fijarlo en el middleware y probarlo llamando al middleware y leyendo la respuesta.",
			"Cada destino del header tiene que existir: el `api-catalog` es el archivo de RFC 9727 y el `service-desc` es `openapi.json`.",
		],
		snippet: `</.well-known/api-catalog>; rel="api-catalog",
</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json",
</developers>; rel="service-doc"; type="text/html",
</sitemap.xml>; rel="sitemap"; type="application/xml",
</index.md>; rel="alternate"; type="text/markdown"`,
		snippetLang: "http",
		verify:
			'`probe.sh`: por cada uno de `api-catalog`, `service-desc`, `service-doc` y `sitemap` comprueba el `rel` en el header `Link`, y `rel=alternate type="text/markdown"`. El mensaje de fallo dice literalmente «set it in middleware, next.config headers get overwritten by i18n middleware».',
	},
	{
		id: "api-v1",
		title: "`/api/v1` con rate limits, idempotencia y ciclo de vida",
		kind: "servidor",
		owner: "dev",
		why: "«Limits and retries are part of the API»: un agente que reintenta a ciegas desperdicia pasos y cuota, y un prefijo versionado permite cambios incompatibles sin romper clientes.",
		steps: [
			"Publicá el prefijo canónico `/api/v1/*`; las rutas sin versión quedan como **alias fijados a v1** que re-exportan exactamente los mismos handlers.",
			"Dejá `/ask` (convención NLWeb) y `/mcp` en la raíz, **fuera** de `Disallow: /api/` y **fuera** del middleware i18n.",
			"Poné `API-Version: 1` en **cada** respuesta.",
			"Emití en cada respuesta `RateLimit-Policy` y `RateLimit` (draft-ietf-httpapi-ratelimit-headers) **más** la tríada clásica `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`.",
			"En el 429 sumá `Retry-After` con los segundos exactos hasta que se libera un cupo.",
			"Exponé esas cabeceras en CORS (`Access-Control-Expose-Headers`), o los agentes en navegador no pueden leerlas.",
			"Aceptá `Idempotency-Key` opcional en toda operación que envíe correo, cobre o cree.",
			'Declará `Deprecation` (RFC 9745), `Sunset` (RFC 8594) y `Link: <notice>; rel="deprecation"`, con aviso mínimo de 180 días.',
			"Devolvé **todo** fallo como JSON, **nunca HTML**: un catch-all devuelve 404 JSON y los métodos no permitidos 405 JSON con `Allow`.",
		],
		spec: [
			"Políticas: default **60/min por cliente**; submissions **10/h por cliente**; en escrituras costosas **5/h por cliente** más un **tope global 20/h service-wide**.",
			'Ejemplos exactos de la plantilla: `ratelimit-policy: "default";q=60;w=60` y `ratelimit: "default";r=57;t=48`.',
			"En CORS se exponen: `ratelimit, ratelimit-policy, ratelimit-limit, ratelimit-remaining, ratelimit-reset, retry-after, api-version, idempotent-replayed`.",
			"`Retry-After` se emite **solo con el 429**, con los segundos exactos (`usage.resetSeconds`); en el 409 de idempotencia en curso se emite `Retry-After: 1` fijo.",
			"`Idempotency-Key`: **1 a 255 caracteres ASCII visibles**; si no cumple → **400 `invalid_idempotency_key`**. Misma llave + mismo cuerpo → reproduce la respuesta guardada con `Idempotent-Replayed: true`. Misma llave con otro cuerpo → **422 `idempotency_key_reused`**. Misma llave mientras la primera corre → **409 `idempotency_in_progress` con `Retry-After: 1`**.",
			"Se guardan **solo las respuestas 2xx** (24 h, 2000 entradas): un fallo de validación o de entrega puede reintentarse con la misma llave. Guardar un 400 o 500 bloquea el reintento que la llave existe para permitir.",
			`La llave se acota por endpoint y por cliente: \`id = \${scope}|\${clientKey(req)}|\${key}\`; fingerprint = \`sha256\` del cuerpo de la petición.`,
			"Parámetros: `PENDING_TTL_MS = 60_000`; TTL de respuesta `24 * 3_600_000`; `MAX_ENTRIES = 2000`; patrón `/^[\\x21-\\x7e]{1,255}$/`.",
			"Orden de wrappers: **`withRateLimit(withIdempotency(handler))`**. El limitador va **fuera**: el orden inverso da repeticiones sin headers o sin reembolso.",
			"Ventana deslizante: un 4xx de validación **devuelve el cupo** y una repetición idempotente **también** (un 5xx sí cuenta).",
			"`clientKey` usa el **último salto** de `x-forwarded-for` e **ignora `cf-connecting-ip`**: un límite solo por IP es forjable cuando nada delante sobrescribe el header, y el tope global es la cota real.",
			"Evicción de claves por cliente por **LRU (máximo 5000)**; los topes globales van en un **mapa pinneado separado**, para que inundar con claves falsas no los reinicie.",
			'`components.parameters.IdempotencyKey` con `schema {type: "string", minLength: 1, maxLength: 255, pattern: "^[\\\\x21-\\\\x7e]+$"}`.',
			"Códigos estables de `ApiError.code`: `validation_error`, `invalid_request`, `missing_query`, `not_found`, `method_not_allowed`, `delivery_failed`, `not_configured`, `rate_limited`, `invalid_idempotency_key`, `idempotency_in_progress`, `idempotency_key_reused`.",
			"`Deprecation` con formato de fecha `@<epoch>` (ejemplo del spec: `@1893456000`); `Sunset` como HTTP-date (ejemplo: `Wed, 01 Jul 2027 00:00:00 GMT`). Hoy están ausentes porque **nada está deprecado**: «Nothing is deprecated until you say so».",
			"**Sin respuestas 202**: los scanners las leen como APIs de jobs asíncronos y después exigen un patrón de polling.",
			"El estado del rate limit y de la idempotencia es memoria de proceso: **un reinicio la borra** (decirlo). Si el host corre varias instancias o reinicia seguido, se mueve a Redis o base de datos y se dice.",
			"Los límites en memoria pueden duplicarse por bundle de ruta: se verificó singleton con 60 GETs baratos y luego un 429.",
		],
		snippet: `{
  "ok": false,
  "error": "<mensaje legible>",
  "code": "rate_limited",
  "hint": "<cómo arreglarlo + enlace a la spec>",
  "issues": ["campo: regla"]
}`,
		snippetLang: "json",
		verify:
			'`probe.sh`: `API-Version` presente en `/api/v1/status`; los cinco headers de límite presentes; en `--burst`, 62 GETs a un path barato dan **60 x 404 y luego 429 con `Retry-After`**; el OpenAPI declara `/v1/` y `x-api-lifecycle`. `tests/rate-limit.core.test.ts`: `consume` cuenta cupos (`remaining [2,1,0]`), headers exactos `\'"t";q=3;w=60\'` y `\'"t";r=2;t=45\'`, `retry-after` **solo** cuando `allowed: false`, `clientKey` usa el último salto de `x-forwarded-for` e ignora `cf-connecting-ip`, y los topes globales no se desalojan tras inyectar 6000 claves de flood. `tests/idempotency.core.test.ts` (11 casos): llave ausente ejecuta siempre; misma llave y mismo cuerpo ejecuta una vez y la segunda trae `idempotent-replayed: true`; cuerpo distinto → 422 sin ejecutar; duplicado concurrente → 409 con `retry-after: 1` y luego replay; **400 y 500 no se guardan** y el reintento ejecuta; excepción libera la llave; llaves inválidas (`""`, `"con espacio"`, `"llave-ñ"`, 256 chars) → 400. Tests: el alias sin versión exporta **exactamente los mismos handlers** que el versionado (`alias[method] === leads[method]` para POST/GET/PUT/PATCH/DELETE).',
	},
	{
		id: "openapi-json",
		title: "openapi.json, el contrato legible por máquina",
		kind: "servidor",
		owner: "dev",
		why: "Es el contrato que los scanners y los agentes leen; su tamaño es parte de la API porque los agentes lo leen entero.",
		steps: [
			'Publicá `/openapi.json` con `openapi: "3.1.0"`, `servers` en el apex y `security: []` para API abierta.',
			"Usá `operationId`s únicos y ejemplos en cada request.",
			"Declará en `components.headers` los headers `RateLimit-*`, `API-Version`, `Retry-After`, `Idempotent-Replayed`, `Deprecation` y `Sunset`.",
			"Declará `Idempotency-Key` como header parameter en **cada** operación de escritura, más 409/422 y el header de respuesta `Idempotent-Replayed`.",
			"Declará las respuestas 400/409/422/429/500 en las operaciones de escritura, con `$ref` a los schemas de error.",
			"Escribí `x-api-lifecycle` con la versión actual, la estrategia de versionado, la política de deprecación y las políticas de rate limit.",
			"Deduplicá las hojas idénticas de respuesta a `components.responses` con `scripts/openapi-dedupe.py`.",
			"Linteá con `pnpm dlx --package=@redocly/cli redocly lint openapi.json`.",
		],
		spec: [
			'`x-api-lifecycle` con `current_version: "v1"`, `versioning {strategy: "url-path", pattern: "/api/v{major}/{resource}", response_header: "API-Version", aliases: {"/api/leads": "/api/v1/leads"}, protocol_versioned: {"/ask": "NLWeb", "/mcp": "MCP 2025-06-18"}}`, `deprecation {signals: ["Deprecation (RFC 9745)", "Sunset (RFC 8594)", "Link rel=\\"deprecation\\""], minimum_notice_days: 180, breaking_changes: "only in a new major version", currently_deprecated: []}` y `rate_limits {headers: [...], policies: {default, submissions, actions, actions-service}}`.',
			"Códigos de error estables y enum en `ApiError.code`, idénticos en OpenAPI, la página de developers y el `structuredContent` del MCP.",
			"El `$ref` de `ServerError`/`SimpleError` apunta a `ApiError` (los tres son alias).",
			"Tamaño: el archivo creció de **14.5 KB a 35.7 KB** al añadir headers, idempotencia y ejemplos de error. Minificar solo ahorró 16% y el dedupe 23%, así que quedó en 27.5 KB: **minificar no es la palanca, deduplicar sí**.",
			"`probe.sh` exige tamaño ≤ `OPENAPI_MAX` (default **40000** bytes).",
			"El warning de `license` es decisión del dueño.",
		],
		verify:
			"`probe.sh`: 200, OpenAPI 3.x, paths con `/v1/` y `security` declarado; declara `Idempotency-Key` y `x-api-lifecycle`. Un test exige que cada path tenga archivo de ruta y que todo `$ref` resuelva; **los tests que inspeccionan `op.responses[code]` tienen que resolver el `$ref` primero**. Validación contra la herramienta oficial Redocly.",
	},
	{
		id: "status-endpoint",
		title: "El endpoint de estado `/api/v1/status`",
		kind: "servidor",
		owner: "dev",
		why: "Es un endpoint de liveness barato: es el enlace `status` del api-catalog (RFC 9727) y una diana para monitores.",
		steps: [
			'Devolvé `GET /api/v1/status` → 200 JSON con `{ok: true, status: "ok", service, api_version: "1", time}`.',
			'Servilo con `Cache-Control: no-store` y `dynamic = "force-dynamic"`.',
			"Respondé 405 con `Allow` a los métodos que no sean GET.",
		],
		spec: [
			'Un test exige `[ok,status,api_version] === [true,"ok","1"]` y `ratelimit-policy === \'"default";q=60;w=60\'`.',
			"`probe.sh`: 200 JSON, los cinco headers de límite y `API-Version`.",
			"ChatGPT **llamó `/api/v1/status` de verdad** en el run 7.",
		],
		verify:
			'`tests/discovery-files.test.ts`: 200, `cache-control === "no-store"`, los tres valores del body y el `ratelimit-policy` exacto.',
	},
	{
		id: "mcp-origen",
		title: "El servidor MCP en tu propio origen",
		kind: "servidor",
		owner: "dev",
		why: "Es la superficie que un agente llama para operar el sitio. En los journeys medidos, ChatGPT llamó `/mcp` de verdad y usó `tools/list`.",
		steps: [
			"Serví `/mcp` como Streamable HTTP **en el propio origen**, con respuestas JSON y protocolo `2025-06-18`.",
			"Implementá los métodos `initialize`, `ping`, `tools/list` y `tools/call`.",
			"Tratá un mensaje **sin `id`** como notificación: respondé **202 sin cuerpo**.",
			"Invocá los mismos handlers REST **en proceso** (nada de self-fetch: falla tras algunos proxies) y **reenviá la IP del cliente**; si no, todas las llamadas MCP comparten una sola clave de rate-limit (`unknown`).",
			"Hacé que `GET /mcp` devuelva el descriptor JSON con `documentation` y `quickstart`, para que un agente que aterriza en `/mcp` no adivine `/mcp/info`.",
			"Devolvé **405** a un `GET` con `Accept: text/event-stream`.",
			"Sumá CORS `*` y exponé los headers de RateLimit.",
			"Exponé **una tool de lectura** (`readOnlyHint: true`, `idempotentHint: true`) y **como máximo una de escritura** (`readOnlyHint: false`), con la descripción literal «only call with details the person agreed to share».",
			"Escribí en cada descripción para qué **no** debe usarse la tool, y un `inputSchema` con `required`, `additionalProperties: false` y ejemplos.",
		],
		spec: [
			"Errores: `-32700` parse (HTTP 400), `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32000` rate limit (HTTP 429 con `Retry-After`).",
			"Los fallos de tool son `result.isError: true` con `structuredContent` igual al body REST.",
			"Las tools de escritura toman un argumento opcional `idempotency_key` que se reenvía como header. Una repetición devuelve el `structuredContent` original, no gasta un envío del MCP y **el indicador interno `replayed` no sale al cliente**.",
			'`WRITE_TOOLS = {"submit_lead"}`; policies `actions` 5/h y `actions-service` 20/h (global, clave `"write:all"`).',
			'Si el MCP es open, `authentication: "none"` tiene que ser coherente con `security: []` del OpenAPI.',
			"Un MCP autenticado devuelve 401 con `WWW-Authenticate: Bearer resource_metadata=...`: eso es lo que corresponde cuando la autenticación existe de verdad.",
		],
		verify:
			"`probe.sh`: headers de rate limit presentes en las respuestas MCP; un 429 en MCP trae `Retry-After >= 1`. `tests/leads-and-mcp.test.ts`: una repetición con la misma llave no consume envíos (`ratelimit-remaining` se queda en 9) y devuelve el mismo JSON; cuerpo distinto → 422. En MCP, un reintento con `idempotency_key` devuelve el `structuredContent` original y no gasta un envío del MCP.",
	},
	{
		id: "webmcp",
		standardIds: ["webmcp"],
		title: "WebMCP: la página declara sus propias tools",
		kind: "servidor",
		owner: "dev",
		why: "Para que la propia página declare acciones al agente del navegador. En el caso real fue un flip de orank a `WebMCP 5/5`.",
		steps: [
			"Registrá las tools con el draft W3C vigente: `document.modelContext.registerTool(tool, { signal })`, con `tool = {name, title, description, inputSchema, annotations, execute(input, {signal})}`.",
			"Soportá previews anteriores como fallback: `navigator.modelContext` y `provideContext({tools})`.",
			"Enviá el script como **`<script>` inline plano al inicio del `<body>`**, para que se registre en tiempo de parseo y la cadena `registerTool` quede visible en el HTML de servidor que leen los scanners. **No lo envuelvas en un client component.**",
			"Exponé **solo la tool de lectura**: las escrituras se quedan en el MCP con sus límites.",
			"Envolvé todo el script en un `try/catch` vacío para no romper la página.",
			"Sumá la vía declarativa: `toolname` y `tooldescription` en un `<form>` y `toolparamdescription` en sus controles, con el formulario revisado y enviado por una persona.",
			"**Nunca** añadas `toolautosubmit` a un formulario que envía correo o gasta dinero.",
		],
		spec: [
			'La tool `ask` de la plantilla: `name: "ask"`, `inputSchema` con `required: ["query"]`, `additionalProperties: false` y `annotations: { readOnlyHint: true }`.',
			'`execute` hace `fetch("/ask", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({query}), signal: options.signal})` y devuelve `{content:[{type:"text", text: JSON.stringify(body)}]}` con `isError: true` si `!res.ok`.',
			'Pregunta vacía → `{ok:false, error:"missing \'query\'", code:"missing_query"}` sin llamar a `fetch`.',
			"El mecanismo declarativo es la vía de confirmación humana: sin `toolautosubmit`, el agente rellena los campos y **la persona revisa y envía**.",
			"React 19 pasa atributos personalizados en minúscula y TypeScript necesita la augmentación de tipos (`FormHTMLAttributes` con `toolname`, `tooldescription`, `toolautosubmit`; `InputHTMLAttributes` con `toolparamdescription`).",
			"WebMCP se movió de `navigator` a `document`: leé el spec vigente antes de copiar el consejo de un scanner, porque el texto de arreglo de los scanners va por detrás.",
		],
		verify:
			"`tests/webmcp.script.test.ts` ejecuta **la cadena exacta** del script en un contexto `node:vm` con `document`/`navigator`/`fetch` falsos: registra exactamente una tool con el schema y `readOnlyHint: true`; **el script no menciona `submit|lead|contact`**; prefiere `document.modelContext` sobre `navigator.modelContext`; cae a `navigator.modelContext` y a `provideContext`; sin soporte no hace nada (incluso sin `document`); un rechazo o un throw de la API no rompe la página ni deja `unhandledRejection`; `execute` hace POST a `/ask`, reenvía la señal y devuelve el JSON como texto; marca `isError` si `/ask` falla y no consulta con pregunta vacía. `probe.sh`: el HTML del home contiene `registerTool` o `toolname=` — «the scanner reads server HTML, not only runtime».",
	},

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Lo que hay que hacer fuera de la web (kind "externo"): ninguna de estas la puede hacer el código,
	// y todas actúan bajo la identidad del dueño.
	// ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "wikidata-wikipedia",
		standardIds: ["wikipedia-presence"],
		title: "Wikidata (P856) y después Wikipedia",
		kind: "externo",
		owner: "dueno",
		why: "Los items off-site mueven el instrumento **más que cualquier archivo del sitio**. Wikipedia/Wikidata tienen una ganancia estimada registrada de **2.5**.",
		steps: [
			"Cargá el sitio web oficial en Wikidata con la propiedad **P856**.",
			"Recién después, sumá prensa independiente y andá por Wikipedia.",
			"Volvé a medir con el scanner cuando esté cargado: un score puede ser anterior a tu cambio.",
		],
		spec: [
			"Propiedad de Wikidata: **P856** (sitio web oficial).",
			"Ganancia estimada registrada antes de los últimos lotes: **2.5** (Wikipedia/Wikidata).",
			"Es un pozo de puntos off-site: el skill pide listarlo con su ganancia estimada en vez de fingir que el código lo arregla.",
		],
		verify:
			"Buscá la entidad en Wikidata y comprobá que **P856** apunta al host canónico del sitio. Después re-escaneá: el score viejo no vale.",
	},
	{
		id: "npm-sdk-cli",
		standardIds: ["npm-sdk-package", "rest-sdk-packages", "cli-tool"],
		title: "Publicar el SDK y el CLI en npm",
		kind: "externo",
		owner: "dueno",
		why: "Los checks de registro y paquete suman ~4-5 puntos y **necesitan que el dueño publique**. La ganancia estimada registrada del SDK de npm es **1.6**.",
		steps: [
			"Construí el paquete con cero dependencias de runtime (usa `fetch` global), métodos tipados, ESM + `.d.ts`, `bin` para el CLI y `files` limitado a `dist`, con README y LICENSE.",
			"Hacé que cada envío lleve un `Idempotency-Key` autogenerado que **se reutilice en los reintentos**.",
			"Reintentá fallos de red, 5xx, 409 (`Retry-After`) y 429 (`Retry-After` hasta un tope, **nunca dormir una hora**); **nunca reintentes un 4xx de validación**.",
			"Lanzá un error tipado con `status`, `code`, `hint`, `issues` y `retryAfter`, y exponé los últimos headers `RateLimit`.",
			"En el CLI: los comandos que envían correo real son dry-run salvo `--send`; un comando `mcp` imprime el endpoint y el snippet de conexión; usá `node:util` `parseArgs` y un `run(argv, io)` testeable para no lanzar procesos; exit codes **0**, **1** (API o red) y **2** (uso).",
			"Verificá el artefacto real: `npm pack`, instalá el tarball en un proyecto vacío, corré el CLI y un `import` ESM contra producción con llamadas de solo lectura, y mutá el reuso de la clave de retry y el guard de dry-run.",
			"**No menciones el SDK o el CLI en `llms.txt` ni en la doc hasta que el paquete exista en npm.**",
		],
		spec: [
			"En el caso real, el CLI `believe-global` quedó con **24 tests**, instalado desde el tarball empacado en un proyecto vacío y ejercitado contra producción: construido y testeado, **sin publicar**.",
			"Checks que cubre: `npm-sdk-package`, `rest-sdk-packages` y `cli-tool`.",
			"«No enlazar algo que todavía no existe»: un enlace a un paquete inexistente es un dead end para un agente.",
		],
		verify:
			"`npm view <paquete>` tiene que devolver el paquete publicado. Hasta entonces, `llms.txt` y la doc **no** pueden enlazarlo.",
	},
	{
		id: "mcp-registry",
		standardIds: ["mcp-registry-listed"],
		title: "Listar el MCP en el registro y enlazarlo de vuelta",
		kind: "externo",
		owner: "dueno",
		why: "`mcp-registry-listed` quiere una entrada **verificada bidireccionalmente**: en el registro bajo tu dominio (o un listado verificado de Smithery con uso) **y** un enlace de vuelta desde tu doc. Ganancia estimada registrada: **1.6**.",
		steps: [
			'Prepará `server.json` con `name` en reverse-DNS del apex más un slug (`com.example/site`, patrón `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`), `description` de **máximo 100 caracteres**, `version` igual a la del MCP, `websiteUrl`, `icons` y `remotes: [{"type":"streamable-http","url":"https://example.com/mcp"}]`.',
			"Validá `server.json` contra el schema oficial `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` con `jsonschema`.",
			"Serví `/.well-known/mcp-registry-auth` con **una línea**: `v=MCPv1; k=ed25519; p=<base64 de la clave pública cruda de 32 bytes>`, forzando `Content-Type: text/plain`.",
			"Publicá con `mcp-publisher login http --domain example.com --private-key <seed hex>` y después `mcp-publisher publish`.",
			"Verificá con `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>`: **la ruta `/v0/` no devuelve nada**.",
			"Enlazá la entrada del registro desde la doc **y** desde `llms.txt`: orank quiere el enlace en ambas direcciones.",
		],
		spec: [
			'El par de claves se genera con Node `crypto` (`generateKeyPairSync("ed25519")`): clave pública cruda = últimos 32 bytes del DER SPKI; seed = últimos 32 bytes del DER PKCS8 como hex. Guardá la privada fuera del repo (modo 600) y en el gestor de secretos; **nunca la imprimas**.',
			"`openssl` de macOS es LibreSSL y **no puede generar claves Ed25519**: el ejemplo `openssl genpkey -algorithm Ed25519` de los docs falla en Mac.",
			"Un test comprueba que `/.well-known/mcp-registry-auth` contiene `v=MCPv1; k=ed25519; p=<base64…>` con `Content-Type: text/plain` forzado, y que `server.json` obedece el schema y coincide con `GET /mcp` (versión y endpoint) y con el server card.",
			"En el caso real quedó **construido, testeado y sin publicar**, y su efecto en el score **no está medido todavía**.",
		],
		verify:
			"`GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>` devuelve la entrada, y la doc y `llms.txt` enlazan al registro. Si todavía no está publicado, el ítem sigue pendiente: no se enlaza lo que no existe.",
	},
	{
		id: "search-console",
		title: "Search Console con el sitemap",
		kind: "externo",
		owner: "dueno",
		why: "Es uno de los pozos de puntos más grandes y no lo arregla el código: el skill pide listarlos con su ganancia estimada en vez de fingir que el código los resuelve.",
		steps: [
			"Verificá la propiedad del host canónico en Search Console.",
			"Enviá el `sitemap.xml` del sitio (submission).",
			"Volvé a medir después, comparando la fecha de escaneo con la hora de tu deploy: «a push is not a deploy» y un score puede ser viejo.",
		],
		spec: [
			"Es el mismo `<BASE>/sitemap.xml` que declara `robots.txt`: una sola lista de rutas para el sitemap, el middleware y los buscadores.",
			"Ningún archivo del sitio reemplaza este paso: la submission la hace el dueño.",
		],
		verify:
			"Search Console muestra el sitemap enviado y sin errores de lectura. Compará la fecha del último escaneo con la hora de tu deploy antes de creer un score.",
	},
	{
		id: "chatgpt-app",
		standardIds: ["chatgpt-app-listed"],
		title: "Una app en el directorio de ChatGPT",
		kind: "externo",
		owner: "dueno",
		why: "Es otro de los items off-site que el código no puede resolver: en el caso real quedó abierto como `chatgpt-app-listed`.",
		steps: [
			"Es trabajo off-site: ninguna pieza del código lo resuelve.",
			"Publicala en el directorio de apps de ChatGPT (`chatgpt-app-listed`).",
			"Enlazá la ficha desde la doc cuando exista.",
		],
		spec: [
			"El check del scanner es `chatgpt-app-listed`.",
			"Los chats de los journeys trajeron `ai-catalog.json`, el índice `agent-skills`, ambos archivos MCP y `/api/v1/status`: la superficie que la app va a usar ya está descrita por el resto del plan.",
		],
		verify: "La ficha de la app aparece en el directorio de ChatGPT y el scanner deja de marcar `chatgpt-app-listed`.",
	},

	// ─────────────────────────────────────────────────────────────────────────────────────────────
	// Lo que decidimos NO hacer (kind "declinado"): cada uno con el motivo textual del documento. No
	// tiene `assetPath` a propósito: no se construye, así que no hay nada que generar ni que medir.
	// ─────────────────────────────────────────────────────────────────────────────────────────────
	{
		id: "oauth-oidc-discovery",
		standardIds: [
			"oauth-discovery",
			"oauth-protected-resource",
			"agent-auth-discovery-metadata",
			"agent-auth-www-authenticate",
			"agent-auth-endpoints-reachable",
			"mcp-auth-mechanism",
			"mcp-oauth-metadata",
			"mcp-pkce-s256",
		],
		title: "OAuth/OIDC discovery y protected-resource metadata",
		kind: "declinado",
		owner: "nadie",
		why: "Una API abierta no tiene issuer ni token endpoint que describir, y publicarlos le miente a los agentes. La decisión es no hacerlo.",
		steps: [
			"No publiques metadatos de OAuth/OIDC ni de protected-resource en un host de API abierta.",
			"Si algún día hay autenticación real, van **en el host que la requiere**: un MCP autenticado devuelve 401 con `WWW-Authenticate: Bearer resource_metadata=...`.",
		],
		spec: [
			"Motivo textual: «An open API has no issuer or token endpoint to describe; publishing them lies to agents, and orank already credits an open API (each of these checks is worth about 0.2 points). They belong on the host that really requires auth (an authenticated MCP returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`)».",
			"«Los seis checks de OAuth y `auth.md` valían ~0.2 cada uno y cayeron a 0.1 cuando el resto pasó.»",
			"orank tiene `oauth-support` y `scoped-permissions` que **pasan** para «an explicitly open API that needs no keys», y los checks de MCP OAuth son `na` cuando la autenticación está deshabilitada.",
			"Declinado en orank: `oauth-protected-resource`, `agent-auth-discovery-metadata`, `agent-auth-www-authenticate`, `agent-auth-endpoints-reachable`, `mcp-auth-mechanism`, `mcp-oauth-metadata`, `mcp-pkce-s256`. En isitagentready: `oauth-discovery`, `oauth-protected-resource`.",
		],
		verify:
			'El contrato de la API abierta afirma `openapi.security === []` y `authentication: "none"`: si alguien publica un issuer inexistente, esos tests fallan.',
	},
	{
		id: "auth-md",
		standardIds: ["auth-md", "auth-md-exists", "auth-md-structure", "auth-md-walkthrough-simulation"],
		title: "auth.md",
		kind: "declinado",
		owner: "nadie",
		why: "`auth.md` describe un flujo de autenticación. Sin autenticación real, escribirlo es describir algo que no existe.",
		steps: [
			"No publiques `auth.md` en un host de API abierta.",
			"Cuando exista autenticación de verdad, `auth.md` y los metadatos viven en ese host, no acá.",
		],
		spec: [
			"Motivo textual: «An open API has no issuer or token endpoint to describe; publishing them lies to agents».",
			"Declinado en orank: `auth-md-exists`, `auth-md-structure`, `auth-md-walkthrough-simulation`. En isitagentready: `auth-md`.",
			"«Los seis checks de OAuth y `auth.md` valían ~0.2 cada uno y cayeron a 0.1 cuando el resto pasó»: el costo de declinarlo está medido.",
		],
		verify:
			'`auth.md` no existe en el sitio y el contrato de la API abierta sigue afirmando `security: []` y `authentication: "none"`.',
	},
	{
		id: "web-bot-auth",
		standardIds: ["web-bot-auth", "web-bot-auth-directory"],
		title: "Web Bot Auth",
		kind: "declinado",
		owner: "nadie",
		why: "Web Bot Auth es para las peticiones que envían tus propios bots: se firman y después se publica el directorio de claves. Un directorio sin firma es una fachada.",
		steps: [
			"No publiques el directorio de claves de Web Bot Auth sin firmar tus peticiones salientes.",
			"Si algún día BeAOS o la marca firman sus propios bots, la decisión se revisa y se implementa el par completo (firma + directorio).",
		],
		spec: [
			"Motivo textual: «is for requests your own bots send: sign them, then publish the key directory. A directory without signing is a facade».",
			"Declinado en orank: `web-bot-auth-directory`. En isitagentready: `web-bot-auth`.",
			"El bundle de BeAOS puede emitir `/.well-known/http-message-signatures-directory` derivado de la misma clave que firma la evidencia; eso **no** cambia la decisión: sin firmar las peticiones salientes, el directorio no prueba nada.",
		],
		verify:
			"Si en algún momento se firman las peticiones salientes, esta decisión se revisa y este ítem se actualiza. Mientras tanto, no se anuncia cobertura de Web Bot Auth.",
	},
	{
		id: "dns-aid",
		standardIds: ["dns-aid"],
		title: "DNS-AID",
		kind: "declinado",
		owner: "nadie",
		why: "Es un draft individual, casi sin consumidores, y pide DNSSEC. El riesgo no tiene retorno medible.",
		steps: [
			"No habilites DNSSEC ni DNS-AID para satisfacer un check.",
			"Si el dominio ya tiene DNSSEC por otra razón, eso es una decisión de infraestructura, no de este plan.",
		],
		spec: [
			"Motivo textual: «An individual draft, almost no consumers, and it asks for DNSSEC. Enabling DNSSEC needs a DS record at the registrar; a mistake makes the domain unresolvable for validating resolvers, mail included. High risk, no measurable return».",
			"Declinado con el id `dns-aid` de isitagentready.",
		],
		verify: "El dominio sigue resolviendo para resolvers validantes, correo incluido, y el plan no anuncia DNS-AID.",
	},
	{
		id: "paginacion-falsa",
		standardIds: ["pagination-shape"],
		title: "Paginación falsa",
		kind: "declinado",
		owner: "nadie",
		why: "Inventar paginación para satisfacer un check es describir una API que no existe. Si la API no tiene lista, hay que decirlo.",
		steps: [
			"No inventes estructuras de paginación «to satisfy a check».",
			"Si la API no tiene lista, decilo en la doc y en el OpenAPI.",
		],
		spec: [
			"Motivo textual: «If the API has no list or job, say so».",
			"Declinado con el id `pagination-shape`.",
			"En el OpenAPI esto también significa **sin respuestas 202**: los scanners las leen como APIs de jobs asíncronos y después exigen un patrón de polling.",
		],
		verify: "El OpenAPI no declara estructuras de paginación que la API no tenga, y ninguna operación responde 202.",
	},
	{
		id: "jobs-asincronos",
		standardIds: ["async-job-pattern"],
		title: "Jobs asíncronos",
		kind: "declinado",
		owner: "nadie",
		why: "Un job asíncrono inventado obliga a inventar también el polling. Si la API no tiene job, hay que decirlo.",
		steps: [
			"No inventes jobs asíncronos ni patrones de polling.",
			"Devolvé el resultado en la misma respuesta cuando el trabajo es síncrono, y decilo así.",
		],
		spec: [
			"Motivo textual: «If the API has no list or job, say so».",
			"Declinado con el id `async-job-pattern`; en OpenAPI, **sin respuestas 202**.",
		],
		verify: "Ninguna operación del OpenAPI responde 202 y la doc no promete un patrón de polling.",
	},
	{
		id: "batch-sandbox",
		standardIds: ["batch-endpoints", "sandbox-environment"],
		title: "Endpoints batch y sandbox",
		kind: "declinado",
		owner: "nadie",
		why: "Un endpoint batch o un sandbox inventados son una API que no existe. La doc dice la verdad: no hay sandbox, y la tool de lectura es la forma segura de probar.",
		steps: [
			"No inventes endpoints batch «to satisfy a check».",
			"No anuncies un sandbox que no existe: la nota honesta de la doc dice que **no hay ninguno** y que la tool de lectura es la forma segura de probar.",
		],
		spec: [
			"Motivo textual: «If the API has no list or job, say so».",
			"Declinado con los ids `batch-endpoints` y `sandbox-environment`.",
			"La página de developers tiene que incluir esa nota honesta de sandbox.",
		],
		verify: "La página de developers declara que no hay sandbox y el OpenAPI no declara endpoints batch.",
	},
	{
		id: "markdown-por-user-agent",
		standardIds: ["agent-ua-markdown"],
		title: "Markdown según el User-Agent",
		kind: "declinado",
		owner: "nadie",
		why: "Servir contenido distinto a los bots que a las personas es cloaking. La negociación por `Accept` y `/index.md` ya cubren la necesidad.",
		steps: [
			"No sirvas contenido distinto por `User-Agent`.",
			"Usá la negociación por `Accept` y las URLs fijas `.md` para el mismo contenido.",
		],
		spec: [
			"Motivo textual: «Different content to bots than to people is cloaking; the Accept negotiation and `/index.md` cover the need».",
			"Declinado con el id `agent-ua-markdown`.",
		],
		verify:
			"El mismo path devuelve el mismo contenido a un bot y a una persona; lo único que cambia es lo que pide `Accept`.",
	},
	{
		id: "webmcp-write-tools",
		title: "Tools de escritura por WebMCP",
		kind: "declinado",
		owner: "nadie",
		why: "Todavía no hay confirmación humana estándar para tools imperativas. Las escrituras se quedan en el MCP, con sus límites, o pasan por un formulario declarativo que la persona envía.",
		steps: [
			"No expongas tools de escritura por WebMCP.",
			"Usá la vía declarativa (la persona confirma) o dejá la escritura en el MCP.",
		],
		spec: [
			"Motivo textual: «No standard human confirmation for imperative tools yet. Use declarative forms (person confirms) or keep writes in the MCP».",
			"En su lugar: la tool de lectura de WebMCP más el formulario declarativo con envío humano.",
		],
		verify:
			"El script de WebMCP del home no menciona `submit|lead|contact`: un test lo comprueba sobre la cadena exacta del script.",
	},
];

/**
 * El estado de cada ítem para un bundle concreto.
 *
 * Es honesto a propósito: lo que BeAOS genera se puede comprobar contra los archivos que existen; lo que
 * vive en el servidor del cliente o fuera de él **no se puede saber desde acá**, así que queda
 * "por-verificar" en vez de fingir un "listo" o un "falta". Y lo declinado nunca es una tarea.
 */
export function buildBlueprint(input: { assetPaths: string[] }): BlueprintStatus[] {
	const available = new Set(input.assetPaths);
	return BLUEPRINT.map((item) => ({ item, state: stateOf(item, available) }));
}

function stateOf(item: BlueprintItem, available: Set<string>): BlueprintState {
	if (item.kind === "declinado") return "declinado";
	if (item.assetPath !== undefined) return available.has(item.assetPath) ? "listo" : "falta";
	if (item.kind === "servidor" || item.kind === "externo") return "por-verificar";
	// Un ítem de archivo sin `assetPath` es trabajo que BeAOS todavía no genera: falta.
	return "falta";
}
