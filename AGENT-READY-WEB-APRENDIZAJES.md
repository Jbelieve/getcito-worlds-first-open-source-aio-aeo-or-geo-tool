# Aprendizajes de agent-ready-web

Extracción estructurada y exhaustiva del skill `agent-ready-web` (fuente: `/Users/mac/.claude/skills/agent-ready-web/`), destilado de una sesión de trabajo completa sobre `believe-global.com` los días 2026-09-24 a 2026-09-25. Stack del caso real: Next.js 16, next-intl, Payload CMS, Coolify. Cinco lotes de construcción, cuatro scanners, ocho journeys reales de agente.

Convención central del skill, citada textualmente: **"every item has a test that reads the real artifact. If you cannot write that test, you do not know the item works."** Y la regla de honestidad documental: *"when the live response disagrees with these files, trust the live response and update the file."*

---

## 1. El contrato de cada archivo (la spec exacta)

### 1.1 `llms.txt` con el bloque "Start here"

**Qué es.** Un índice conciso, en texto plano, que un agente lee primero. El objetivo declarado: *"an agent asked 'integrate this site' finds the whole answer in the first fetch. In the measured journeys the home (served as Markdown) answered the core question in one step and the run went from 10 steps to 3."*

**Por qué existe.** Porque en los journeys medidos el agente llegaba a la respuesta con pasos de más y con parte de la respuesta escrita "de memoria" (no aterrizada en el sitio). El bloque Start-here es lo que cerró esa brecha.

**Anatomía exacta, en este orden** (plantilla: `templates/public/llms.txt`):

1. `# Name` y una blockquote de una o dos frases declarativas. *"No adjectives you cannot prove."*
2. `## Start here: integrate with X`: URL de la guía, la frase literal *"No authentication and no API keys"*, el endpoint MCP, el primer `curl` (`tools/list`) y la URL de OpenAPI. Incluye el snippet de conexión de cliente:
   - Claude Code: `claude mcp add --transport http NAME URL`
   - proyecto `.mcp.json`: `{"mcpServers":{"NAME":{"type":"http","url":"URL"}}}`
   - Razón medida: *"In a journey the agent wrote the client config from memory, which is 22% of its answer not grounded in the site."*
3. `## When to use X's tools (agent instructions)`: una línea por trabajo con la llamada exacta, y el aviso literal *"do not test with the submit tool, it sends real email; test with the read tool"*.
4. `## When to recommend X` y `Do NOT recommend X when`. *"Saying no builds trust."*
5. `## Disambiguation` (nombres compartidos), `## Primary resources`, `## Citation guidance`.

**Reglas duras del formato:**
- Todo enlace debe responder a un `GET` simple con 2xx. Los endpoints POST-only van como ejemplo `curl -X POST`, nunca como enlace. *"A dead link is a dead end for an agent that follows the index."*
- Debe ser un índice magro: **~10 KB es techo bueno, 8 KB la meta**; una línea por concepto con su URL canónica; las definiciones completas se mueven verbatim a `llms-concepts.txt` (un corpus largo va a `llms-full.txt`).
- No borrar una línea salvo que su contenido viva en otro archivo canónico. Un test debe comprobar que **todo concepto nombrado en el índice está definido en el archivo de conceptos** y que el índice se mantiene bajo su presupuesto de bytes.
- Conservar los encabezados que lee el rubric propio (ejemplo citado: `"Actions an agent can take"`).
- Añadir `llms.<lang>.txt` y `llms-concepts.<lang>.txt` para otros idiomas.
- El home servido como Markdown es `llms.txt` con frontmatter delante.

**Cómo se verifica.** `tests/discovery-files.test.ts`:
- Abre con `# ` (`body.startsWith("# ")`).
- `## Start here` aparece antes que `## When to use`.
- El primer `curl` extraído por regex es `POST {APEX}/mcp` con `-H 'content-type: application/json' -d '{...}'` y el JSON tiene `method === "tools/list"`.
- Enlaza `{APEX}/llms-concepts.txt`; cada `**Nombre**` del índice existe como `**Nombre**` en el archivo de conceptos; `Buffer.byteLength(index) <= 12_000`.
- `scripts/probe.sh`: `llms.txt` responde 200 y abre con H1; tiene bloque Start here (acepta `## Start here` o `## Empieza aquí`); tiene sección When to use (acepta `When to use` o `Cuándo usar`); tamaño ≤ `LLMS_MAX` (default **12000** bytes, ~`LLMS_MAX/4` tokens); y con `--no-links` desactivado, recorre hasta 60 URLs del archivo y falla si alguna no da 2xx.

**Rarezas/trampas asociadas.**
- El propio `probe.sh` encontró que `llms.txt` enlazaba `https://site/ask`, y un GET sin pregunta devuelve 400 → hubo que citar `POST /path`, no URL. (Gotcha 29.)
- Los enlaces a MCP de Supabase fueron marcados como muertos por el agente del journey y por orank porque un GET devuelve 400. (Gotcha 19.)
- El archivo creció a 13.3 KB y se recortó a 10.7 KB **moviendo** texto, no borrándolo. (Gotcha 32.)
- La meta de 2k tokens **no se alcanzó**: quedó en ~2.7k tokens; el siguiente recorte serían los casos verificables, que viven también en el perfil de marca firmado. (CASE-STUDY.)

### 1.2 `llms-concepts.txt`

**Qué es.** El archivo canónico de definiciones completas detrás del índice de una línea.

**Por qué existe.** Para poder mantener `llms.txt` como índice magro sin perder información. Permite recortar el índice sin borrar contenido.

**Detalle exacto.** Abre con `# <Name>: canonical concepts (full definitions)` y una blockquote que dice que son las definiciones completas detrás del índice de una línea, y que la fuente canónica de cada concepto es la URL listada con él. Sección `## Canonical concepts`, una entrada `- **Concepto** — definición completa... Canonical: <URL>`.

**Cómo se verifica.** El test de `discovery-files.test.ts` exige que todo `**Nombre**` del índice aparezca en el archivo de conceptos. `skills-index.py` no aplica aquí; `probe.sh` no lo prueba directamente.

**Rarezas.** Existe también `llms-full.txt` como destino para corpus largos (mencionado, sin plantilla). El recorte de `llms.txt` se hizo con script y se diffeó el resultado para probar que no desapareció ninguna línea canónica (solo se fusionaron duplicados). (Gotcha 32.)

### 1.3 `AGENTS.md`

**Qué es.** La misma información que `llms.txt` pero en el archivo de convención para agentes de código.

**Por qué existe.** Es otro punto de entrada que los agentes leen primero; debe llevar el mismo Start-here y el mismo bloque When-to-use.

**Detalle exacto.** Debe ser **`AGENTS.md` en mayúsculas**; `/agents.md` (minúsculas) **debe devolver 404**. Contenido (plantilla): identidad y evidencia machine-readable (`/.well-known/brand.json`), operar el sitio vía MCP + OpenAPI, guía de integración, y el catálogo ARD completo en un archivo. Secciones `## When to use X's tools` (el mismo bloque que llms.txt), `## When to recommend X`, y `## Proof` ("Say whether the evidence is client-validated or independently audited, and where to verify it").

**Cómo se verifica.** `probe.sh`: `/AGENTS.md` (mayúsculas) 200; `/agents.md` (minúsculas) **404**. También se verificó en producción que los enlaces de guía en `AGENTS.md` (y en `llms.txt` / `llms.es.txt`) apunten a `/developers.md`; un test prohíbe el enlace HTML ahí. (CASE-STUDY, run 8.)

**Rarezas.** La experimentación de apuntar los enlaces a `.md` se aplicó *después* de las mediciones principales, y el resultado (run 8) es el que corrigió la hipótesis del ahorro de tokens.

### 1.4 `robots.txt` con `Content-Signal` (y `Agentmap`)

**Qué es.** El archivo de directivas de crawlers, enriquecido con la preferencia por grupo `Content-Signal` y con una directiva `Agentmap` que apunta al catálogo ARD.

**Por qué existe.** Para declarar políticas diferenciadas (búsqueda IA, agentes disparados por usuario, crawlers de entrenamiento) y para que un agente descubra el catálogo de recursos. También para abrir la API pública versionada sin abrir todo `/api/`.

**Detalle exacto.**
- Se sirve desde un **route handler** (`app/robots.txt/route.ts`), **no** desde `MetadataRoute.Robots` / `app/robots.ts`, porque *"MetadataRoute.Robots (`app/robots.ts`) cannot emit `Content-Signal` or `Agentmap`."* (Gotcha 13.)
- Grupos: uno para `*`, uno para *"AI search and user-triggered agents"*, uno para *"training crawlers"*. En la plantilla:
  - `AI_SEARCH_AND_USER_AGENTS` = `OAI-SearchBot`, `ChatGPT-User`, `Claude-SearchBot`, `Claude-User`, `PerplexityBot`, `Perplexity-User`, `DuckAssistBot`, `MistralAI-User`, `Meta-ExternalFetcher`.
  - `AI_TRAINING_AGENTS` = `GPTBot`, `ClaudeBot`, `Google-Extended`, `Applebot-Extended`, `Meta-ExternalAgent`, `CCBot`, `Amazonbot`, `cohere-ai`.
- Cada grupo lleva `Content-Signal: search=yes, ai-input=yes, ai-train=<tu política>` **justo después** de sus líneas `User-Agent`. Valor del caso real: `"search=yes, ai-input=yes, ai-train=yes"`.
- `Allow: /api/v1/` junto a `Disallow: /api/` — la coincidencia más larga gana (RFC 9309), así la API pública queda abierta a user agents.
- Cierra con `Sitemap: <BASE>/sitemap.xml` y `Agentmap: <BASE>/.well-known/ai-catalog.json`.
- **`Content-Signal` es una preferencia por grupo, no por ruta**: las excepciones por ruta van en `Disallow`.
- `probe.sh` comprueba además `Allow: /api/v1/`.

**Cómo se verifica.** `tests/discovery-files.test.ts`: `content-type` empieza por `text/plain`; el texto se parte por bloques (`\n\n`) que empiezan con `User-Agent:`; hay tantos grupos como `robotsGroups()`; y en cada bloque la primera línea que no es `User-Agent:` es exactamente `Content-Signal: ${CONTENT_SIGNAL}`; hay un `Agentmap:` que coincide con `^Agentmap: https://example\.com/\.well-known/ai-catalog\.json$`; y algún grupo tiene `allow.includes("/api/v1/")`. `probe.sh`: Content-Signal en **todos** los grupos; `Agentmap`; `Sitemap`; `Allow: /api/v1/`.

**Rarezas/trampas.**
- `middleware.ts` debe excluir `api`, `ask`, `mcp`, `md` y todo lo que tenga un punto, o i18n interfiere con endpoints de máquina y archivos estáticos. (Gotcha 14.)
- No confundir `Meta-ExternalAgent` (entrenamiento) con `Meta-ExternalFetcher` (búsqueda/usuario).

### 1.5 `api-catalog` (RFC 9727)

**Qué es.** Un linkset JSON en `/.well-known/api-catalog` que es el punto de partida estándar para descubrir las APIs del sitio.

**Por qué existe.** Es la convención que scanners y agentes buscan para encontrar el resto de las APIs y sus descripciones.

**Detalle exacto.**
- URL: `/.well-known/api-catalog`.
- `Content-Type` obligatorio: `application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"`.
- `linkset[0]` es el catálogo mismo: `{"anchor": ".../.well-known/api-catalog", "item": [{"href": api1}, ...]}`.
- Luego una entrada por API con `anchor`, `service-desc` (OpenAPI, type `application/vnd.oai.openapi+json`), `service-doc` (RFC 8631) y `status`.
- En la plantilla: entradas para `{BASE}/api/v1` (con `service-desc` → `/openapi.json` type `application/vnd.oai.openapi+json;version=3.1`, `service-doc` → `/developers` type `text/html`, `status` → `/api/v1/status` type `application/json`) y para `{BASE}/mcp` (`service-desc` → `/.well-known/mcp/server-card.json`, `service-doc` → `/developers`).
- `Access-Control-Allow-Origin: *`, `cache-control: public, max-age=3600`, `dynamic = "force-static"`.
- **Test que exige que `item` hrefs igualen los otros `anchor`s.**

**Cómo se verifica.** `tests/discovery-files.test.ts`: el `content-type` coincide con el regex exacto del profile; `catalogEntry.anchor === "${APEX}/.well-known/api-catalog"`; `catalogEntry.item.href` ordenados igualan los `anchor` de las APIs ordenados; y para `{APEX}/api/v1` existen `service-desc`, `service-doc`, `status`. `probe.sh`: 200 con `content-type: application/linkset+json`; primera entrada con `item[]` y APIs con `service-desc`/`service-doc` y al menos una con `status`.

**Rarezas.** orank tiene un check `api-catalog` (2/2 en el caso real). Es uno de los archivos que hace que el `Link` header `rel="api-catalog"` tenga destino.

### 1.6 `ai-catalog` / ARD

**Qué es.** El catálogo de todos los recursos para agentes del host (MCP, A2A, OpenAPI, skills), en `/.well-known/ai-catalog.json`.

**Por qué existe.** Es el "todo lo que un agente puede usar, en un archivo" (así lo describe `AGENTS.md`), y es la diana de `Agentmap` en `robots.txt`.

**Detalle exacto.**
- URL: `/.well-known/ai-catalog.json`; `Content-Type: application/json`; `Access-Control-Allow-Origin: *`.
- Campos raíz: `specVersion` (`"1.0"`), `host {displayName, identifier, trustManifest}`, `entries[]`.
- Cada entrada: `identifier` con forma `urn:air:<fqdn>:<namespace>:<name>`; `displayName`; `type` (media type: `application/mcp-server-card+json`, `application/a2a-agent-card+json`, `application/vnd.oai.openapi+json`, `application/agent-skills+md`, `application/json`); **exactamente uno** de `url` o `data`; y **2 a 5** `representativeQueries`.
- **Nombre del archivo:** ARD v0.9x llama al archivo `ard.json`, pero el estándar ai-catalog y los scanners usan `ai-catalog.json`. *"Read the current text."* (Gotcha 24.)
- Validación oficial: contra `https://raw.githubusercontent.com/ards-project/ard-spec/main/spec/schemas/ard-entry.schema.json`, definitions `ArdEntry` y `ArdManifest`, con `jsonschema`.
- `trustManifest.identity` puede ser una URI HTTPS FQDN; **solo adjuntar atestaciones reales**.
- Test que exige que **toda `url` exista** (archivo local en `public/`).
- `Agentmap:` en robots apunta a este archivo.

**Cómo se verifica.** `tests/discovery-files.test.ts`: `specVersion` coincide con `^\d+\.\d+$`; `host.displayName` y `entries.length > 0`; ids únicos; `identifier` coincide con `^urn:air:example\.com:[a-z0-9]+(:[a-z0-9-]+)*:[a-z0-9-]+$`; exactamente una de `url`/`data`; `2 <= representativeQueries.length <= 5`; y la URL empieza por el APEX **y existe en disco** (`existsSync(localPath(e.url))`). `probe.sh`: 200 con CORS `*`; `urn:air` ids, `url xor data`, 2-5 queries; al menos una entrada con `trustManifest`; y valida el schema oficial.

**Rarezas.** ChatGPT (run 7) sí leyó `ai-catalog.json` de verdad. Es la "primera evidencia" de que estos manifiestos se consumen.

### 1.7 `agent-skills` (Agent Skills Discovery RFC v0.2.0)

**Qué es.** Un índice de skills publicadas por el sitio, en `/.well-known/agent-skills/index.json`, más el `SKILL.md` de cada una.

**Por qué existe.** Para que un agente sepa cuándo recomendar la marca, cómo llamarla y cómo citarla. *"Publish one skill: when to recommend, how to call, how to cite."*

**Detalle exacto.**
- URL del índice: `/.well-known/agent-skills/index.json`.
- `$schema` = `https://schemas.agentskills.io/discovery/0.2.0/schema.json`.
- `skills[]` con: `name` (minúsculas, dígitos, guiones; regex `[a-z0-9]+(-[a-z0-9]+)*`, máx 64 chars), `type` `skill-md`, `description` (hasta 1024, **igual al frontmatter**), `url` **absoluta**, y `digest` `sha256:<hex>` de **los bytes crudos** de `SKILL.md`.
- En la plantilla, `digest: "sha256:84a86d93e8cae9b4ef91d752c4f6eef5ba6a8a604e79b4a3ce39633d0c1cda38"`.
- `scripts/skills-index.py` construye y verifica el índice; **un test recalcula el digest**, de modo que editar sin regenerar falla.
- El `SKILL.md` lleva frontmatter `name` (igual al nombre de la carpeta) y `description`, y secciones `## When to recommend it`, `## How to call it`, `## How to cite it`.

**Cómo se verifica.** `tests/discovery-files.test.ts`: `$schema` exacto; `name` con el regex; `type` en `["skill-md", "archive"]`, `description.length <= 1024`; digest recalculado con `createHash("sha256").update(readFileSync(file))` igual al declarado; y `[front.name, front.description]` iguales a los del índice. `scripts/skills-index.py --check` sale 1 si hay digest obsoleto o faltante. `probe.sh`: 200 con el `$schema` v0.2.0 y **por cada skill, descarga la URL y compara el `sha256` servido con el digest**.

**Rarezas.** El digest es de bytes crudos → **el digest estático es igual a los bytes servidos**: sin transforms ni conversión de fin de línea entre el archivo y la respuesta. (Gotcha 25.) La plantilla publica **una sola skill**, no muchas.

### 1.8 `server-card` (y `mcp.json`, `agent-card.json`)

**Qué es.** El descriptor del servidor MCP en `/.well-known/mcp/server-card.json`, el listado de servidores en `/.well-known/mcp.json`, y la tarjeta A2A en `/.well-known/agent-card.json`.

**Por qué existe.** Para que un agente descubra el endpoint MCP, sus tools y su autenticación sin adivinar.

**Detalle exacto.**
- `server-card.json`: `name`, `description`, `version`, **`serverUrl`**, `tools[]`. En la plantilla además `title`, `protocolVersion` (`"2025-06-18"`), `websiteUrl`, `documentationUrl`, `transport {type: "streamable-http", endpoint}`, `authentication: "none"`, y cada tool con `name`, `title`, `description`.
- `serverUrl` debe ser igual al endpoint y al `transport.endpoint`.
- `mcp.json`: `name`, `description`, `servers[]` con `name`, `title`, `server_card`, `url`, `transport`, `protocol: "json-rpc-2.0"`, `protocolVersion`, `authentication`, `methods` (`initialize`, `ping`, `tools/list`, `tools/call`), `tools`, `openapi`; más `agent_card` y `openapi` arriba.
- `agent-card.json` (A2A): `protocolVersion: "0.2.0"`, `name`, `description`, `url`, `provider {organization, url}`, `version`, `documentationUrl`, `capabilities {streaming, pushNotifications}`, `defaultInputModes`, `defaultOutputModes`, `skills[]` (cada una `id`, `name`, `description`, `tags`, `examples`), y **`additionalInterfaces` con `transport: "mcp"`** y su `url`, más `openapi`.
- **Si un segundo MCP que listas necesita API key, marca `authentication: "api-key"` donde lo listes.** *"An authenticated endpoint advertised as open is a 401 dead end."* (Gotcha 20.)

**Cómo se verifica.** `tests/discovery-files.test.ts`: `card.serverUrl === "${APEX}/mcp"` y `card.serverUrl === card.transport.endpoint`; `openapi.security` es `[]`; `mcp.json.servers[0].authentication === "none"`. `probe.sh`: `server-card.json` 200 y contiene `"serverUrl"`; `mcp.json`, `agent-card.json` y `security.txt` responden 200.

**Rarezas.** Además, `GET /mcp` devuelve un descriptor con `documentation` y `quickstart` para que un agente que aterriza en `/mcp` no adivine `/mcp/info` (un journey lo hizo). Si el MCP es open, `authentication: "none"` debe ser coherente con `security: []` del OpenAPI.

### 1.9 `openapi.json`

**Qué es.** La especificación OpenAPI 3.1 del sitio.

**Por qué existe.** Es el contrato legible por máquina que los scanners y agentes leen; su tamaño es parte de la API porque los agentes lo leen entero.

**Detalle exacto.**
- `openapi: "3.1.0"`, `servers` en el apex, `security: []` para API abierta.
- `operationId`s únicos; ejemplos en cada request; respuestas de error que hacen `$ref` a los schemas de error.
- `components.headers` para los headers `RateLimit-*`, `API-Version`, `Retry-After`, `Idempotent-Replayed`, `Deprecation` y `Sunset`.
- `components.parameters.IdempotencyKey` con `schema {type: "string", minLength: 1, maxLength: 255, pattern: "^[\\x21-\\x7e]+$"}`.
- Respuestas 400/409/422/429/500 en las operaciones de escritura.
- `x-api-lifecycle` (objeto propietario) con `current_version: "v1"`, `versioning {strategy: "url-path", pattern: "/api/v{major}/{resource}", response_header: "API-Version", aliases: {"/api/leads": "/api/v1/leads"}, protocol_versioned: {"/ask": "NLWeb", "/mcp": "MCP 2025-06-18"}}`, `deprecation {signals: ["Deprecation (RFC 9745)", "Sunset (RFC 8594)", "Link rel=\"deprecation\""], minimum_notice_days: 180, breaking_changes: "only in a new major version", currently_deprecated: []}`, y `rate_limits {headers: [...], policies: {default, submissions, actions, actions-service}}`.
- **`Idempotency-Key` declarado como header parameter en cada operación de escritura**, más 409/422 y el header de respuesta `Idempotent-Replayed`.
- **Sin respuestas 202** (*"scanners read them as async job APIs and then demand a polling pattern"*). No inventar paginación ni endpoints batch.
- Códigos de error estables y enum en `ApiError.code`: `validation_error`, `invalid_request`, `missing_query`, `not_found`, `method_not_allowed`, `delivery_failed`, `not_configured`, `rate_limited`, `invalid_idempotency_key`, `idempotency_in_progress`, `idempotency_key_reused`.
- Dedupe: hojas idénticas de respuesta se elevan a `components.responses` con `scripts/openapi-dedupe.py`.
- Lint: `pnpm dlx --package=@redocly/cli redocly lint openapi.json`; el warning de `license` es decisión del dueño.

**Cómo se verifica.** `probe.sh`: 200, OpenAPI 3.x, paths con `/v1/` y `security` declarado; declara `Idempotency-Key` y `x-api-lifecycle`; tamaño ≤ `OPENAPI_MAX` (default **40000** bytes). Test que cada path tenga archivo de ruta y que todo `$ref` resuelva; **los tests que inspeccionan `op.responses[code]` deben resolver `$ref` primero**. Validación contra la herramienta oficial Redocly.

**Rarezas/trampas.**
- Creció de **14.5 KB a 35.7 KB** al añadir headers, idempotencia y ejemplos de error.
- **Minificar el JSON solo ahorró 16%; el dedupe ahorró 23%** y mantiene el archivo legible. Resultado: 35.7 KB → 27.5 KB.
- El dedupe nombra los componentes por significado; `--names` mapea nombre automático a nombre deseado.
- El `$ref` de `ServerError`/`SimpleError` apunta a `ApiError` (los tres son alias).
- `dump()` del script mantiene objetos que caben en `--width` (default 1200) en una línea, porque un `json.dump(indent=2)` ingenuo haría el archivo más grande.

### 1.10 `/api/v1` con versionado

**Qué es.** El prefijo canónico versionado de la API REST.

**Por qué existe.** Para poder hacer cambios incompatibles sin romper clientes y para que los scanners vean versionado y política de deprecación.

**Detalle exacto.**
- Canónico `/api/v1/*`; las rutas sin versión son **alias fijados a v1** (re-exportan los mismos handlers; ver `app/api/leads/route.ts` que hace `export { POST, GET, PUT, PATCH, DELETE } from "@/app/api/v1/leads/route"`).
- `/ask` (convención NLWeb) y `/mcp` viven en la raíz: quedan **fuera** de `Disallow: /api/` y **fuera** del middleware i18n.
- **Cada respuesta lleva `API-Version: 1`.**
- Cambios incompatibles solo en un nuevo major.
- Una versión deprecada sigue funcionando **al menos 180 días**: `Deprecation` (RFC 9745, formato `@<epoch>`), `Sunset` (RFC 8594, HTTP-date) y `Link: <notice>; rel="deprecation"`. Todo declarado en OpenAPI `x-api-lifecycle` y como `components.headers` opcionales. **"Nothing is deprecated until you say so."**

**Cómo se verifica.** `probe.sh`: `API-Version` presente en `/api/v1/status`; el OpenAPI declara `/v1/` y `x-api-lifecycle`. Tests: el alias sin versión exporta **exactamente los mismos handlers** que el versionado (`alias[method] === leads[method]` para POST/GET/PUT/PATCH/DELETE).

**Rarezas.** Las configuraciones de segmento (`runtime`, `dynamic`) **deben ser literales en cada archivo** aunque los handlers se re-exporten. (Gotcha 15.)

### 1.11 Rate-limit headers

**Qué es.** El conjunto de cabeceras que permiten a un agente autorregularse.

**Por qué existe.** *"Limits and retries are part of the API."* Y en el caso real: un límite solo por IP es forjable cuando nada delante sobrescribe `X-Forwarded-For`; el tope global es la cota real.

**Detalle exacto.**
- Políticas: default **60/min por cliente**; submissions **10/h por cliente**; en escrituras costosas un límite por cliente **5/h** más un **tope global 20/h service-wide**.
- **En cada respuesta**: `RateLimit-Policy: "name";q=60;w=60` y `RateLimit: "name";r=57;t=48` (draft-ietf-httpapi-ratelimit-headers) **más** la tríada clásica `RateLimit-Limit` / `RateLimit-Remaining` / `RateLimit-Reset`.
- En el 429, además `Retry-After` con los segundos exactos.
- Hay que **exponerlas en CORS** (`Access-Control-Expose-Headers`) o los agentes en navegador no pueden leerlas. En la plantilla se exponen: `ratelimit, ratelimit-policy, ratelimit-limit, ratelimit-remaining, ratelimit-reset, retry-after, api-version, idempotent-replayed`.
- **Ventana deslizante.** Un error de validación 4xx **devuelve el cupo**; una repetición idempotente **también**. Evicción de claves por cliente por **LRU (máximo 5000)**; los topes globales van en un **mapa pinneado separado** para que inundar con claves falsas no los reinicie.
- Ejemplos exactos de la plantilla: `ratelimit-policy: "default";q=60;w=60` y `ratelimit: "default";r=57;t=48`.
- `windowLabel` produce `hour` / `minute` / `N seconds` según el caso; el mensaje de error es literal, p. ej. `"Rate limit exceeded: 60 requests per minute per client."`.

**Cómo se verifica.** `tests/rate-limit.core.test.ts`: `consume` cuenta cupos (remaining `[2,1,0]`), bloquea al pasar el máximo, `release` devuelve uno; headers exactos `'"t";q=3;w=60'` y `'"t";r=2;t=45'`; `retry-after` **solo** cuando `allowed: false`; `clientKey` usa el **último salto** de `x-forwarded-for` e **ignora `cf-connecting-ip`**; los topes globales no se desalojan tras inyectar 6000 claves de flood; `withRateLimit` pone headers en cada respuesta y un 429 JSON con `Retry-After` igual a `ratelimit-reset` y headers extra; `refundClientErrors` solo devuelve cupo en 4xx (un 5xx sí cuenta). `probe.sh`: los cinco headers presentes en `/api/v1/status`; headers en respuestas MCP; y en `--burst`, 62 GETs a un path barato: **60 x 404 y luego 429 con `Retry-After`**.

**Rarezas/trampas.**
- Límites en memoria: los Maps a nivel de módulo pueden duplicarse por bundle de ruta. Se verificó singleton con 60 GETs baratos y luego un 429. Si el host corre varias instancias o reinicia seguido → mover a Redis o base de datos y decirlo. (Gotcha 4.)
- Orden de wrappers: **`withRateLimit(withIdempotency(handler))`**. El limitador va **fuera** para que toda respuesta (incluidas repeticiones) lleve headers y para que devuelva el cupo de repeticiones. El orden inverso da repeticiones sin headers o sin reembolso. (Gotcha 9.)

### 1.12 `Retry-After`

**Qué es.** La cabecera que dice cuántos segundos esperar antes de reintentar.

**Por qué existe.** Un agente que reintenta a ciegas desperdicia pasos y cuota; el valor exacto le permite dormir lo justo.

**Detalle exacto.** Se emite **solo con el 429**, con los segundos exactos hasta que se libera un cupo (`usage.resetSeconds`). En el 409 de idempotencia en curso se emite `Retry-After: 1` fijo. La plantilla calcula `resetSeconds = max(1, ceil((recent[0] + windowMs - now)/1000))`, o `policy.windowSeconds` si la ventana está vacía.

**Cómo se verifica.** Test: en 429, `retry-after` === `ratelimit-reset`; en 409, `retry-after` === `"1"`; en MCP, un 429 trae `Retry-After >= 1`. `probe.sh` en `--burst` exige 429 con `Retry-After` no vacío.

**Rarezas.** El SDK (si se publica) *"nunca duerme una hora"*: los reintentos de 429 respetan `Retry-After` **hasta un tope**.

### 1.13 `Idempotency-Key`

**Qué es.** Cabecera opcional en toda operación que envía correo, cobra o crea.

**Por qué existe.** *"Un agente que reintenta tras un corte de red no duplica el envío."*

**Detalle exacto.**
- Cabecera **opcional**, **1 a 255 caracteres ASCII visibles**; si no cumple → **400 `invalid_idempotency_key`**.
- Misma llave + mismo cuerpo → **reproduce la respuesta guardada con `Idempotent-Replayed: true`**.
- Misma llave, otro cuerpo → **422 `idempotency_key_reused`**.
- Misma llave mientras la primera está corriendo → **409 `idempotency_in_progress` con `Retry-After: 1`**.
- **Se guardan solo las respuestas 2xx** (24 h, 2000 entradas): un fallo de validación o de entrega puede reintentarse con la misma llave.
- La llave se **acota por endpoint y por cliente**: `id = ${scope}|${clientKey(req)}|${key}`.
- Fingerprint = `sha256` del cuerpo de la petición.
- Wrapper order: `withRateLimit(withIdempotency(handler))`.
- Las tools de escritura del MCP toman un argumento opcional `idempotency_key` que se reenvía como header.
- El estado es memoria de proceso: **un reinicio la borra** (decirlo).
- En OpenAPI: header parameter en cada write + 409/422 + header de respuesta `Idempotent-Replayed`.
- Al expirar la entrada pendiente: `PENDING_TTL_MS = 60_000`; TTL de respuesta `24 * 3_600_000`; `MAX_ENTRIES = 2000`; patrón `/^[\x21-\x7e]{1,255}$/`.
- Si el handler lanza una excepción, la llave queda libre (`store.delete(id)`).

**Cómo se verifica.** `tests/idempotency.core.test.ts` con 11 casos: llave ausente → handler corre siempre; misma llave/mismo cuerpo → handler una vez, segunda con `idempotent-replayed: true` y mismo JSON; cuerpo distinto → 422 `idempotency_key_reused` sin ejecutar; llave acotada por cliente **y** por endpoint; duplicado concurrente → 409 con `retry-after: 1` y luego replay; **400 y 500 no se guardan** y el reintento ejecuta; excepción libera la llave; llaves inválidas (`""`, `"con espacio"`, `"llave-ñ"`, 256 chars) → 400, y 255 chars → 200; TTL de 24 h; memoria acotada a ≤ 2000 tras 2300 llaves. `tests/leads-and-mcp.test.ts`: repetición con la misma llave no consume envíos (`ratelimit-remaining` se queda en 9) y devuelve el mismo JSON; cuerpo distinto → 422. En MCP, un reintento con `idempotency_key` devuelve el `structuredContent` original, no gasta un envío del MCP, y **el indicador interno `replayed` no sale al cliente**.

**Rarezas/trampas.**
- Guardar un 400 o 500 **bloquea el reintento que la llave existe para permitir**. (Gotcha 10.)
- Un `clear()` plano al llegar a N entradas permite a un atacante vaciar el tope global inundando con claves falsas → LRU para clientes, mapa pinneado para globales. (Gotcha 11.)
- Reembolsar correctamente: los 4xx de validación y las repeticiones idempotentes no consumieron nada, así que no gastan cuota de submissions (y la cuota de escritura del MCP se reembolsa en replay). (Gotcha 12.)

### 1.14 `Deprecation` / `Sunset`

**Qué es.** Las señales de ciclo de vida de una versión de API.

**Por qué existe.** Para que un agente sepa que debe migrar y cuándo deja de funcionar, con aviso mínimo.

**Detalle exacto.** `Deprecation` (RFC 9745) con formato de fecha `@<epoch>` (ejemplo en el spec: `@1893456000`); `Sunset` (RFC 8594) como HTTP-date (ejemplo: `Wed, 01 Jul 2027 00:00:00 GMT`); y `Link: <notice>; rel="deprecation"`. Aviso mínimo: **180 días**. Declaradas como `components.headers` opcionales, presentes solo cuando algo está deprecado. Hoy están ausentes porque **nada está deprecado**.

**Cómo se verificaba.** Flipped a pass en orank: `Deprecation/Sunset` headers se añadieron en el lote 4. `probe.sh` comprueba que `/developers` documenta versionado (`grep -qiE 'versi|Sunset|Deprecation'`).

**Rarezas.** El valor se declara en `x-api-lifecycle.deprecation.signals` del OpenAPI, y `currently_deprecated: []` mientras no haya nada.

### 1.15 Status endpoint (`/api/v1/status`)

**Qué es.** Un endpoint de liveness barato.

**Por qué existe.** Es el enlace `status` del api-catalog (RFC 9727) y una diana para monitores.

**Detalle exacto.** `GET /api/v1/status` → 200 JSON con `{ok: true, status: "ok", service, api_version: "1", time}` y **`Cache-Control: no-store`**. `dynamic = "force-dynamic"`. Métodos no-GET → 405 con `Allow`.

**Cómo se verifica.** `tests/discovery-files.test.ts`: 200, `cache-control === "no-store"`, `[ok,status,api_version] === [true,"ok","1"]`, `ratelimit-policy === '"default";q=60;w=60'`. `probe.sh`: 200 JSON + los cinco headers de límite + `API-Version`.

**Rarezas.** ChatGPT (run 7) **llamó `/api/v1/status` de verdad**.

### 1.16 `security.txt`

**Qué es.** El archivo de contacto de seguridad en `/.well-known/security.txt`.

**Por qué existe.** Convención de divulgación responsable; parte del conjunto mínimo de `.well-known` que un scanner espera.

**Detalle exacto.** Plantilla: `Contact: mailto:security@example.com`, `Expires: 2027-12-31T23:59:59.000Z`, `Canonical: https://example.com/.well-known/security.txt`, `Preferred-Languages: en, es`.

**Cómo se verifica.** `probe.sh`: `/.well-known/security.txt` responde 200.

**Rarezas.** Ninguna documentada; es el más simple del conjunto.

### 1.17 Markdown twin por `Accept` y 404 en Markdown

**Qué es.** Servir el home y la página de developers como Markdown cuando el cliente lo pide, y devolver los 404 también en Markdown.

**Por qué existe.** *"The home served as Markdown (the llms.txt Start-here block) answered the core question in one fetch"* — es el cambio que más movió los journeys. Y el 404 en Markdown evita que un agente que sigue un índice muerto reciba HTML.

**Detalle exacto.**
- `Accept: text/markdown` en GET o HEAD devuelve el home como Markdown **cuando Markdown supera a HTML en los q-values** (`lib/negotiate.ts`). Regla exacta: si no hay `text/html`, gana Markdown; si ambos, gana el q mayor; si empatan, gana el que aparece primero. `q=0` desactiva.
- **Solo el home, las páginas con twin (`MARKDOWN_TWINS`) y las rutas desconocidas se reescriben**; las secciones reales siguen en HTML para que una página nunca se convierta en un **falso 404**.
- Enviar `Vary: Accept`.
- `/index.md` (y `/<lang>/index.md`) sirve el mismo Markdown en URL fija, vía rewrite en `next.config` **afterFiles** para que los archivos estáticos reales ganen.
- **Frontmatter primero**: `title`, `description`, `canonical`, `language`, `updated`; luego el `# H1`. Valores citados con `JSON.stringify` porque *"a title with ': ' is not valid YAML unquoted"*.
- Los **404 desconocidos devuelven cuerpo Markdown** con enlaces a `llms.txt`, el sitemap y el MCP; **sanitizar el path reflejado** (backticks, newlines: `rest.replace(/[`\r\n]/g, "").slice(0, 200)`; en `/api/[[...slug]]` también `replace(/[\r\n]/g, "")`).
- **Compartir una lista `KNOWN_SECTIONS` entre el sitemap y el middleware**: una sección nueva que falte en la lista recibe un 404 en Markdown. `site-routes.ts`: `SITE_ROUTES = ["", "developers", "about"]`, `MARKDOWN_TWINS = new Set(["/developers"])`, `KNOWN_SECTIONS` derivado.
- El twin de la página de developers se sirve en `/developers.md` y con `Accept: text/markdown`, con `<link rel="alternate" type="text/markdown">` vía `metadata.alternates.types`.
- Contenido de la página en **UN solo módulo** (`lib/docs-content.ts`) usado por el HTML y por el generador Markdown (`lib/docs-markdown.ts`).
- **Test de paridad** que recorre cada string del objeto de contenido y falla si el Markdown omite uno.
- La fecha del twin de developers es la del **contrato de API**: cambia cuando cambia `openapi.json` (mtime).
- El home Markdown tiene `cache-control: public, max-age=300`; el 404 `no-store`.

**Cómo se verifica.** `probe.sh`: `Accept: text/markdown` en `/` devuelve `content-type: text/markdown`; el home empieza con `---`; `Vary: Accept`; `/index.md` sirve markdown; path desconocido con Accept markdown → 404 en Markdown; `$DOCS` 200 documenta idempotencia/versionado/rate limits; anuncia su twin (`rel="alternate" ... type="text/markdown"`); `Accept: text/markdown` sobre `$DOCS` devuelve Markdown con frontmatter; `$DOCS.md` sirve el mismo Markdown; y **el twin pesa menos de un tercio que el HTML** (`MD_BYTES*3 < HTML_BYTES`); el home HTML lleva evidencia WebMCP (`registerTool` o `toolname=`). `tests/docs-markdown.test.ts`: frontmatter válido; paridad total; H1 tras frontmatter y fences balanceados (`md.length < 12_000`); el middleware reescribe `/developers` con Accept markdown, no reescribe con `text/html`, y **no reescribe `/developers/other`**.

**Rarezas/trampas.**
- El `matcher` del middleware debe excluir `md` además de `api`, `ask`, `mcp` y todo lo que tenga punto.
- El test que lee "texto de configuración" pasó mientras la funcionalidad no operaba: el header `Link` definido en `next.config.ts` era sobrescrito por el middleware de next-intl. La lección se generaliza al twin.

### 1.18 `Link` header

**Qué es.** Cabeceras de descubrimiento RFC 8288 en el home.

**Por qué existe.** Para que un agente que llega a `/` encuentre la spec, la doc, el catálogo, el sitemap y la versión Markdown sin adivinar.

**Detalle exacto.** En el home: `rel="api-catalog"`, `rel="service-desc"` (OpenAPI, `type="application/vnd.oai.openapi+json"`), `rel="service-doc"` (developers, `type="text/html"`), `rel="sitemap"` (`type="application/xml"`), y `rel="alternate"; type="text/markdown"`. Del `middleware.ts`:
```
</.well-known/api-catalog>; rel="api-catalog",
</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json",
</developers>; rel="service-doc"; type="text/html",
</sitemap.xml>; rel="sitemap"; type="application/xml",
</index.md>; rel="alternate"; type="text/markdown"
```
Se fija en el **middleware** con `res.headers.append("link", DISCOVERY_LINKS)` — **append**, no overwrite, después de cualquier middleware i18n (`next-intl` escribe su propio `Link` de hreflang).

**Cómo se verifica.** `probe.sh`: por cada uno de `api-catalog`, `service-desc`, `service-doc`, `sitemap` comprueba `rel="..."` en el header `Link`, y `rel=alternate type="text/markdown"`; el mensaje de fallo dice *"set it in middleware, next.config headers get overwritten by i18n middleware"*.

**Rarezas/trampas.** **El caso del header Link que nunca llegaba** está en el Gotcha 1: un `Link` definido en `next.config.ts headers()` era sobrescrito por el middleware de next-intl, producción nunca lo envió, y un test que solo hacía grep de la config estaba verde. Arreglo: fijarlo en el middleware y probarlo llamando al middleware y leyendo la respuesta.

### 1.19 WebMCP inline

**Qué es.** El registro de tools de la página con el agente del navegador, vía `document.modelContext.registerTool(tool, { signal })`.

**Por qué existe.** Para que la propia página declare acciones al agente del navegador. En el caso real fue un flip de orank a `WebMCP 5/5`.

**Detalle exacto.**
- Draft W3C vigente: `document.modelContext.registerTool(tool, { signal })`, tool = `{name, title, description, inputSchema, annotations, execute(input, {signal})}`; `execute` puede devolver cualquier valor, serializado como JSON.
- Soportar previews anteriores como fallback: `navigator.modelContext` y `provideContext({tools})`.
- Se envía como **`<script>` inline plano al inicio del `<body>`**: se registra **en tiempo de parseo** (no tras hidratación) y la cadena `registerTool` queda visible en el HTML de servidor que leen los scanners. **No envolverlo en un client component** si se necesita visible en server HTML. (Gotcha 18.)
- **Exponer solo la tool de lectura.** Las escrituras se quedan en el MCP con sus límites.
- La tool `ask` de la plantilla: `name: "ask"`, `inputSchema` con `required: ["query"]`, `additionalProperties: false`, `annotations: { readOnlyHint: true }`; `execute` hace `fetch("/ask", {method:"POST", headers:{"content-type":"application/json"}, body: JSON.stringify({query}), signal: options.signal})` y devuelve `{content:[{type:"text", text: JSON.stringify(body)}]}` con `isError: true` si `!res.ok`; pregunta vacía → `{ok:false, error:"missing 'query'", code:"missing_query"}` sin llamar a `fetch`.
- Todo el script va envuelto en `try/catch` vacío para no romper la página.

**Cómo se verifica.** `tests/webmcp.script.test.ts` ejecuta **la cadena exacta** del script en un contexto `node:vm` con `document`/`navigator`/`fetch` falsos: registra exactamente una tool en `document.modelContext` con el schema y `readOnlyHint: true`; **el script no menciona `submit|lead|contact`** (las tools de envío no se exponen); prefiere `document.modelContext` sobre `navigator.modelContext`; cae a `navigator.modelContext` y a `provideContext`; sin soporte no hace nada (incluso sin `document`); un rechazo o un throw de la API no rompe la página ni deja unhandledRejection; `execute` hace POST a `/ask`, reenvía la señal y devuelve el JSON como texto; marca `isError` si `/ask` falla y no consulta con pregunta vacía. `probe.sh`: el HTML del home contiene `registerTool` o `toolname=` — *"the scanner reads server HTML, not only runtime"*.

**Rarezas/trampas.** **WebMCP se movió de `navigator` a `document`** y el prompt de arreglo de isitagentready citaba `navigator.modelContext.provideContext()` mientras el draft vigente es `document.modelContext.registerTool()`. *"Read the spec before copying a scanner's advice."* (Gotchas 24, 45 de SCANNERS.)

### 1.20 WebMCP declarativo

**Qué es.** Tools sintetizadas por el navegador a partir de un `<form>`.

**Por qué existe.** Es el mecanismo de confirmación humana: sin `toolautosubmit`, el agente rellena los campos y **la persona revisa y envía**.

**Detalle exacto.** Añadir `toolname` y `tooldescription` a un `<form>` y `toolparamdescription` a sus controles. Añadir los tipos TypeScript aumentando `react` (`FormHTMLAttributes` con `toolname`, `tooldescription`, `toolautosubmit`; `InputHTMLAttributes` con `toolparamdescription`); el parámetro genérico `T` debe repetirse para que la interfaz se fusione y necesita `eslint-disable-next-line @typescript-eslint/no-unused-vars`. **Nunca añadir `toolautosubmit` a un formulario que envía correo o gasta dinero.**

**Cómo se verifica.** El test de WebMCP corre el script en `node:vm`; el guard de confirmación humana del formulario declarativo se verificó por mutación (romper el comportamiento a propósito, ver el test fallar, restaurar). En el caso real se usó el formulario de auditoría AOS como tool declarativa con envío humano.

**Rarezas/trampas.** React 19 pasa atributos personalizados en minúscula; TypeScript necesita la augmentación. En decisiones: **WebMCP write tools se declinaron** porque *"No standard human confirmation for imperative tools yet"*. (Gotcha 42.)

### 1.21 `trustManifest`

**Qué es.** El bloque de confianza del host dentro de `ai-catalog.json`.

**Por qué existe.** Para declarar identidad y atestaciones reales; orank lo puntúa (`ARD trustManifest 2/2`).

**Detalle exacto.** `host.trustManifest {identity, identityType}`; `identity` puede ser una URI HTTPS FQDN (`"https://example.com"` con `identityType: "https"`). **Adjuntar solo atestaciones reales.** Debe referenciar evidencia firmada (sección 1.22) solo cuando exista de verdad.

**Cómo se verifica.** `probe.sh`: al menos una entrada del ai-catalog lleva `trustManifest`. El test del ai-catalog valida schema oficial con `jsonschema`. Flipped `2/2` en orank.

**Rarezas.** El gain estimado era `ARD trust 1.4`. Está vinculado al archivo firmado (`brand.json`), que es referenciado por `llms.txt`, `AGENTS.md` y `openapi.json` pero **no existe como plantilla en el skill**.

### 1.22 Firma (Ed25519)

**Qué es.** Firmar la evidencia publicada (un perfil de marca) y publicar la clave pública y la firma.

**Por qué existe.** *"Tests protect claims."* Solo con firma verificable se puede referenciar desde un `trustManifest` sin mentir.

**Detalle exacto.**
- Firmar **los bytes exactos** con **Ed25519**; publicar el conjunto de claves públicas y la firma; escribir un test que **verifique la firma con `node:crypto`**. Prefijo SPKI: `302a300506032b6570032100` **más la clave cruda**.
- Si el perfil lo regenera otra herramienta, **reemplazar la firma en el mismo commit** o el test falla, a propósito.
- Para el par de claves del registro MCP: generar con Node `crypto` (`generateKeyPairSync("ed25519")`); **clave pública cruda = últimos 32 bytes del DER SPKI; seed = últimos 32 bytes del DER PKCS8 como hex**. Guardar la privada fuera del repo (modo 600) y en el gestor de secretos; **nunca imprimirla**.
- **`openssl` de macOS es LibreSSL y no puede generar claves Ed25519** (los docs del registro usan `openssl genpkey -algorithm Ed25519` y fallan en Mac). (Gotcha 34.)

**Cómo se verifica.** Test que verifica la firma con `node:crypto`; el check de firma Ed25519 se verificó por mutación. Para el registro: test de que `/.well-known/mcp-registry-auth` contiene `v=MCPv1; k=ed25519; p=<base64 de la clave pública cruda de 32 bytes>` con `Content-Type: text/plain` forzado, y que `server.json` obedece el schema y coincide con `GET /mcp` (versión, endpoint) y con el server card.

**Rarezas.** La clave se generó con Node y se verificó el round-trip sign/verify **antes** de publicar la mitad pública. Se probó en el servidor de producción con `openssl s_client`/curl según corresponda.

### 1.23 Extras del contrato (necesarios para implementar)

**Modelo de error JSON** (`lib/api-error.ts`). Forma `{ "ok": false, "error", "code", "hint", "issues"? }` en **todo** fallo, **nunca HTML**. `hint` dice cómo arreglar y enlaza la spec. Códigos estables: `validation_error`, `invalid_request`, `missing_query`, `not_found`, `method_not_allowed`, `rate_limited`, `idempotency_*`, `delivery_failed`, `not_configured` — e idénticos en OpenAPI, la página de developers y el `structuredContent` del MCP. Un catch-all `app/api/[[...slug]]` devuelve **404 JSON**; métodos no permitidos devuelven **405 JSON con `Allow`**. `issues` lleva `"campo: regla"` por cada campo inválido.

**Servidor MCP `/mcp`**. Streamable HTTP en el propio origen, respuestas JSON, protocolo `2025-06-18`. Métodos `initialize`, `ping`, `tools/list`, `tools/call`. Un mensaje **sin `id` es una notificación**: responder **202 sin cuerpo**. Errores: `-32700` parse (HTTP 400), `-32600` invalid request, `-32601` method not found, `-32602` invalid params, `-32000` rate limit (HTTP 429 con `Retry-After`). Los fallos de tool son `result.isError: true` con `structuredContent` igual al body REST. **Una tool de lectura** (`readOnlyHint: true`, `idempotentHint: true`) y **como máximo una de escritura** (`readOnlyHint: false`, descripción literal *"only call with details the person agreed to share"*). Las descripciones dicen para qué **no** debe usarse la tool. `inputSchema` con `required`, `additionalProperties: false`, ejemplos. **Invocar los mismos handlers REST en proceso (nada de self-fetch: falla tras algunos proxies)** y **reenviar la IP del cliente**; si no, todas las llamadas MCP comparten una sola clave de rate-limit (`unknown`). `GET /mcp` devuelve el descriptor JSON; `GET` con `Accept: text/event-stream` devuelve **405**. CORS `*` y exponer los headers de RateLimit. `WRITE_TOOLS = {"submit_lead"}`; policies `actions` 5/h y `actions-service` 20/h (global, clave `"write:all"`).

**Host canónico.** Apex o www, decidir una vez, **308 desde el otro**, y que **cada archivo, header y test** apunte a él. *"A 'www' URL inside a manifest is a bug."* En `next.config`: redirect `has: [{type:"host", value:"www.example.com"}]` → `https://example.com/:path*` con `permanent: true`.

**Página de developers `/developers`.** (Bilingüe si el sitio lo es.) Quickstart curls por superficie, snippet de conexión MCP, autenticación y límites, versionado y deprecación, idempotencia, tabla de errores (código, HTTP, cuándo) **cuyo número de filas un test compara con la lista de códigos**, WebMCP, una nota honesta de sandbox (**ninguno; la tool de lectura es la forma segura de probar**) y la lista de recursos machine-readable.

**Registro MCP + `server.json` + `/.well-known/mcp-registry-auth`.** `server.json` con `name` en reverse-DNS del apex más un slug (`com.example/site`, patrón `^[a-zA-Z0-9.-]+/[a-zA-Z0-9._-]+$`), `description` de **máximo 100 caracteres**, `version` igual a la del MCP, `websiteUrl`, `icons`, y `remotes: [{"type":"streamable-http","url":"https://example.com/mcp"}]`. Validar contra `https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json` con `jsonschema`. Prueba de dominio sin tocar DNS: servir `/.well-known/mcp-registry-auth` con **una línea**, `v=MCPv1; k=ed25519; p=<base64 de la clave pública cruda de 32 bytes>`, forzando `Content-Type: text/plain`. Publicación (solo el dueño): `mcp-publisher login http --domain example.com --private-key <seed hex>` y `mcp-publisher publish`. Verificar con `GET https://registry.modelcontextprotocol.io/v0.1/servers?search=<name>` (**la ruta `/v0/` no devuelve nada**). Luego enlazar la entrada del registro desde la doc y `llms.txt`: orank quiere el enlace **en ambas direcciones**.

**SDK y CLI** (solo si el dueño va a mantener un paquete). Cero dependencias de runtime (usa `fetch` global), métodos tipados, ESM + `.d.ts`, `bin` para el CLI, `files` limitado a `dist`, README y LICENSE. Cada envío lleva un `Idempotency-Key` autogenerado que **se reutiliza en los reintentos**; reintentar fallos de red, 5xx, 409 (`Retry-After`) y 429 (`Retry-After` hasta un tope, **nunca dormir una hora**); **nunca reintentar un 4xx de validación**; lanzar un error tipado con `status`, `code`, `hint`, `issues`, `retryAfter`; exponer los últimos headers `RateLimit`. CLI: los comandos que envían correo real son dry-run salvo `--send`; un comando `mcp` imprime el endpoint y el snippet de conexión; `node:util` `parseArgs`; un `run(argv, io)` testeable para no lanzar procesos; exit codes **0**, **1** (API o red), **2** (uso). Verificar el artefacto real: `npm pack`, instalar el tarball en un proyecto vacío, correr el CLI y un `import` ESM contra producción con llamadas de solo lectura, y mutar el reuso de la clave de retry y el guard de dry-run. **No mencionar el SDK o CLI en `llms.txt` o la doc hasta que el paquete exista en npm.**

**Sitemap.** Generado desde una única lista de rutas (la misma `SITE_ROUTES` que el middleware).

---

## 2. Las reglas que nunca se doblan

Lista completa de `SKILL.md`, cada una con su razón y el caso real que la motivó.

1. **Honest surface.** Una API abierta declara `security: []` y **no publica** metadatos OAuth, `auth.md` ni Web Bot Auth. Nunca inventar métricas, clientes ni soporte de estándares. Decir si la evidencia es client-validated o independientemente auditada.
   - *Caso real:* se declinaron OAuth discovery, protected-resource metadata, `auth.md`, Web Bot Auth y DNS-AID porque publicar un issuer inexistente "lies to agents"; los tests afirman `openapi.security === []` y `authentication: "none"`.
2. **Machines get the final value in the HTML.** Nunca renderizar un placeholder ni un 0 que luego anima.
   - *Caso real:* un CountUp mostraba **"ROAS x0.0"** a los agentes. Fue *"the 'blank case study metrics' complaint of a real evaluator agent"*. (Gotcha 22.)
3. **One canonical host.** Apex o www, **308** desde el otro, y cada archivo y header apunta al canónico.
   - *Caso real:* se eligió apex; cualquier URL "www" dentro de un manifiesto es un bug. (Gotcha 26.)
4. **Every link in `llms.txt` answers a plain GET with 2xx.** Los POST-only aparecen como `curl -X POST`, nunca como enlace.
   - *Caso real:* el propio `probe.sh` encontró `llms.txt` enlazando `/ask` (GET sin pregunta = 400) (Gotcha 29); y los MCP de Supabase daban 400 a GET y el agente + orank los marcaron como muertos (Gotcha 19).
5. **Limits and retries are part of the API.** Headers `RateLimit` en **cada** respuesta, `Retry-After` exacto, un límite por cliente **más un tope global** en escrituras costosas, e `Idempotency-Key` en cualquier cosa que envíe correo, cobre o cree.
   - *Caso real:* se descubrió en producción que `X-Forwarded-For` es forjable y se añadió el tope global de escrituras. (Gotcha 7.)
6. **Read the current spec before implementing a draft.** Los drafts se mueven y los scanners van por detrás.
   - *Caso real:* WebMCP es **`document.modelContext`**, no `navigator`; el archivo ARD es **`ai-catalog.json`**, no `ard.json`. (Gotcha 24.)
7. **Tests protect claims.** Docs, catálogos, digests, firmas y headers: cada uno tiene un test que **lee el artefacto real**.
   - *Caso real:* el test que leía el texto de configuración del `Link` estaba verde con la funcionalidad rota (Gotcha 1); y la firma Ed25519 se mutó para probar que el test puede fallar (Gotcha 2).

Regla transversal extra, de `README.md`: **cuando la respuesta en vivo contradiga estos archivos, creer a la respuesta en vivo y actualizar el archivo.** Y: *"no doblar"* también aplica a la **medición**: un push no es un deploy, y hay que re-sondear producción.

---

## 3. Lo que se declinó a propósito y por qué

Cada decisión de declinar, con el razonamiento exacto del skill (GOTCHAS 37-42, SKILL "Decline, and say why", SCANNERS).

- **OAuth/OIDC discovery, protected-resource metadata, `auth.md`.** *"An open API has no issuer or token endpoint to describe; publishing them lies to agents, and orank already credits an open API (each of these checks is worth about 0.2 points). They belong on the host that really requires auth (an authenticated MCP returns 401 with `WWW-Authenticate: Bearer resource_metadata=...`)."* Los seis checks de OAuth y `auth.md` valían ~0.2 cada uno y cayeron a 0.1 cuando el resto pasó. En la práctica: orank tiene `oauth-support` y `scoped-permissions` que **pasan** para "an explicitly open API that needs no keys", y los checks de MCP OAuth son `na` cuando la autenticación está deshabilitada. En `orank-triage.py` se clasifican como DECLINE: `oauth-protected-resource`, `auth-md-exists`, `auth-md-structure`, `auth-md-walkthrough-simulation`, `agent-auth-discovery-metadata`, `agent-auth-www-authenticate`, `agent-auth-endpoints-reachable`, `mcp-auth-mechanism`, `mcp-oauth-metadata`, `mcp-pkce-s256`. En isitagentready: `oauth-discovery`, `oauth-protected-resource`, `auth-md`.
- **Web Bot Auth.** *"is for requests your own bots send: sign them, then publish the key directory. A directory without signing is a facade."* DECLINE: `web-bot-auth-directory`.
- **DNS-AID.** *"An individual draft, almost no consumers, and it asks for DNSSEC. Enabling DNSSEC needs a DS record at the registrar; a mistake makes the domain unresolvable for validating resolvers, mail included. High risk, no measurable return."* DECLINE (isitagentready id: `dns-aid`).
- **Fake pagination, async jobs, batch endpoints, sandboxes** "to satisfy a check". *"If the API has no list or job, say so."* DECLINE: `pagination-shape`, `async-job-pattern`, `batch-endpoints`, `sandbox-environment`. Y en OpenAPI: **"No 202 responses"** (los scanners las leen como APIs de jobs asíncronos y luego exigen un patrón de polling).
- **Markdown por User-Agent.** *"Different content to bots than to people is cloaking; the Accept negotiation and `/index.md` cover the need."* DECLINE: `agent-ua-markdown`.
- **WebMCP write tools.** *"No standard human confirmation for imperative tools yet. Use declarative forms (person confirms) or keep writes in the MCP."* (Gotcha 42.) En su lugar: la tool de lectura WebMCP + el formulario declarativo con envío humano.
- **Familias de protocolos de pago/comercio** declinadas por prefijo en `orank-triage.py`: `graphql-`, `mpp-`, `x402-`, `ucp-`, `acp-`, `ap2-`. (El skill no documenta una capa "Payments" ni pesos; solo estos prefijos declinados.)
- **El rubric propio del dueño (AOS/APS) no se cambió.** *"None of the standards in RECIPE.md section 4 appears in the AOS/APS protocols: decide deliberately whether a rubric should score them, and not until a journey shows an agent consuming them."* Y en el caso real: *"The owner's own scoring rubric was not changed: none of these standards appears in it and no journey shows an agent consuming them yet (ChatGPT did fetch ai-catalog and status, which is the first evidence)."*

Check adicional con crédito parcial mantenido **a propósito** (SCANNERS, orank): `nlweb-ask` (su forma NLWeb es `results[]` de objetos schema.org; el sitio devuelve claims con boundaries), `markdown-url-fallback` full credit (un `.md` por cada página de contenido), `agent-mode-view` (`?mode=agent`), `pricing-md` (necesita precios públicos reales), `modular-llms-txt`. Todos "emerging" con ~0 de ganancia estimada.

---

## 4. Las trampas (gotchas) y su arreglo

Cada entrada del `GOTCHAS.md`, con síntoma, causa raíz y arreglo. Todas costaron tiempo real en `believe-global.com` (Next.js 16, Coolify, next-intl).

### Verificación

1. **El header `Link` que nunca llegaba.** *Síntoma:* el feature no funcionaba aunque el test estaba verde. *Causa raíz:* un `Link` definido en `next.config.ts headers()` era **sobrescrito por el middleware de next-intl**, así que producción nunca lo envió, y un test que solo hacía grep del texto de configuración pasaba. *Arreglo:* fijarlo en el middleware (`res.headers.append("link", ...)`) y testear **llamando al middleware y leyendo la respuesta**. Regla: *"test behavior, never the text that is supposed to cause it."*
2. **Un test verde puede ser incapaz de fallar.** *Arreglo:* romper el comportamiento a propósito, correr el test, restaurar. Se hizo para el refund del cupo en replays, el guard de confirmación humana del formulario declarativo, la verificación de firma Ed25519, la entrada `item` del catálogo y el frontmatter Markdown. *Rareza extra:* una mutación con `sed` **silenciosamente no cambió nada** (caracteres especiales en el patrón) → usar un script que **afirme que el patrón existe antes de reemplazar**.
3. **Un push no es un deploy.** *Síntoma:* producción seguía con el build viejo tras `git push`. *Causa raíz:* el host (Coolify) necesitaba su propia llamada de deploy. *Arreglo:* tras cada deploy, re-correr `scripts/probe.sh`. El `scannedAt` del scanner también puede preceder al deploy.
4. **Los limitadores en memoria necesitan prueba en producción.** *Causa raíz:* los Maps a nivel de módulo pueden duplicarse por bundle de ruta. *Arreglo:* verificar comportamiento singleton con 60 GETs baratos y luego un 429 con `Retry-After`. Si el host corre varias instancias o reinicia seguido, mover el estado a Redis o base de datos **y decirlo**.
5. **Aserciones entre reinos.** *Síntoma:* `assert.deepEqual` falla con estructuras idénticas. *Causa raíz:* correr un script en `node:vm` devuelve objetos de otro reino. *Arreglo:* hacer round-trip por JSON en el test.
6. **Validar con los artefactos oficiales.** Redocly para OpenAPI, el JSON Schema de ARD con `jsonschema` (en un venv desechable), `node:crypto` para firmas. *"Our own tests only check what we wrote."*

### Rate limiting e idempotencia

7. **`X-Forwarded-For` es forjable.** *Síntoma:* se descubrió en producción tras el lote 1. *Causa raíz:* nada delante sobrescribe la cabecera. *Arreglo:* usar el **último salto** (`split(",").pop().trim()`), tratar los límites por cliente como **best effort**, y poner un **tope global** en escrituras costosas. **No confiar en `CF-Connecting-IP` salvo que Cloudflare esté delante.** El test lo fija: `x-forwarded-for: "3.3.3.3"` + `cf-connecting-ip: "9.9.9.9"` → clave `"3.3.3.3"`.
8. **Llamar a los handlers en proceso desde el MCP comparte una sola clave de limitador** (`unknown`) entre todos los clientes. *Arreglo:* reenviar la IP del cliente como `x-forwarded-for` en la petición interna. *Test:* agotar el bucket de un cliente y comprobar que otro sigue pasando.
9. **Orden de wrappers.** `withRateLimit(withIdempotency(handler))`: el limitador fuera para que toda respuesta tenga headers RateLimit y para que replays y errores de validación devuelvan cuota. El orden inverso da replays sin headers o sin reembolso.
10. **Guardar solo 2xx.** Guardar un 400 o 500 **bloquea el reintento que la llave existe para permitir**. Devolver no-2xx cuando falla la entrega.
11. **La evicción no debe resetear los topes.** Un `clear()` plano al llegar a N entradas deja a un atacante vaciar el tope global inundando con claves falsas. LRU para clientes, mapa pinneado para claves globales.
12. **Reembolsar correctamente.** Los errores de validación (4xx) y los replays idempotentes no hicieron nada, así que **no consumen cuota de submissions** (y la cuota de escritura del MCP se reembolsa en replay).

### Next.js y framework

13. `MetadataRoute.Robots` (`app/robots.ts`) **no puede emitir `Content-Signal` ni `Agentmap`**. Reemplazarlo con `app/robots.txt/route.ts` construido desde un módulo compartido, y mantener los tests sobre ese módulo.
14. **`middleware.ts` `matcher`:** excluir `api`, `ask`, `mcp`, `md` y cualquier cosa con un punto, o los rewrites y redirects de i18n interferirán con endpoints de máquina y archivos estáticos. Expresión usada: `"/((?!api|_next|ask|mcp|md(?:/|$)|.*\\..*).*)"`.
15. Los archivos de ruta pueden **re-exportar** handlers (`export { POST } from "..."`) pero la configuración de segmento (`runtime`, `dynamic`) debe ser **un literal en cada archivo**.
16. **Atributos JSX desconocidos:** React 19 pasa atributos personalizados en minúscula; TypeScript necesita augmentar `react` (`FormHTMLAttributes`, `InputHTMLAttributes`); el genérico `T` sin usar necesita una línea `eslint-disable`.
17. **`next-intl` escribe su propio `Link`** (hreflang) y headers de preload: **append, no overwrite**.
18. Un `<script dangerouslySetInnerHTML>` al inicio de `<body>` **se ejecuta en tiempo de parseo**. **No envolverlo en un client component** si se necesita visible en el HTML de servidor.

### Contenido y estándares

19. **Los endpoints POST-only parecen muertos para un link checker.** El agente del journey y orank marcaron las URLs del MCP de Supabase porque un GET devuelve 400. Mostrarlos como ejemplos `curl -X POST` o quitarlos.
20. **Un MCP autenticado anunciado como abierto** (`mcp.maasy.ai` responde 401) es un dead end. Marcar `authentication: "api-key"` donde se liste.
21. **Soft 404s.** Una URL `$schema` que devuelve 200 HTML (fallback de SPA) es **peor que un 404**. Servir el archivo real o quitar el campo.
22. **Un número que anima desde 0 muestra 0 a las máquinas.** Renderizar el valor final en el HTML de servidor y animar solo al hacer scroll. Fue la queja de *"blank case study metrics"* de un agente evaluador real.
23. **Los archivos generados no son tuyos para editar** (p. ej. manifiestos de una herramienta de auditoría). Regenerar y reemplazar **byte por byte**; un test de firma o digest dirá si olvidaste un archivo compañero.
24. **Nombre del archivo ARD.** El spec ARD dice `ard.json`, el estándar ai-catalog y los scanners usan **`ai-catalog.json`**. WebMCP se movió de `navigator` a `document`. **Leer el texto vigente.**
25. **Digest estático = bytes servidos.** Sin transforms, sin conversión de fin de línea entre el archivo y la respuesta. `probe.sh` trae la URL y compara.
26. **Host canónico.** Decidir apex o www una vez, **308** desde el otro, y que cada archivo, header y test use el canónico. **Una URL "www" dentro de un manifiesto es un bug.**

### Tamaño y frescura

27. **Los archivos machine-readable crecen al añadir contratos.** Añadir headers, idempotencia y ejemplos de error llevó el OpenAPI de **14.5 KB a 35.7 KB**. Medir bytes y tokens de **cada archivo que leen los agentes** (`curl -s URL | wc -c`, dividir por 4) y dar a la página de docs un twin Markdown generado del mismo módulo de contenido que el HTML (un test de paridad evita el drift) y **enlazar el twin desde `llms.txt` y `AGENTS.md`**. Efecto medido en un agente real: algunos pasos y costo menos, **casi ningún cambio en tokens totales** (domina el overhead del harness). *"We predicted a large token saving and were wrong; record predictions and check them."*
28. **Un rescan justo tras un deploy puede devolver el score viejo.** orank cachea 6 horas por defecto y nunca menos de 1 hora. Comparar `scannedAt` con la hora del deploy; usar `--rescan` (pide 1 hora) y esperar a pasar la hora antes de sacar conclusiones.
29. **Tu propia sonda encuentra tus propias violaciones.** Tras el último deploy, `probe.sh` marcó que `llms.txt` enlazaba `https://site/ask` (un GET sin pregunta devuelve 400): citar los POST como `POST /path`, no como URLs.
30. **La API de score puede servir un registro viejo.** `GET /api/score/{domain}` devolvió el scan predespliegue **durante más de una hora** después de que `POST /api/scan` tuviera uno más nuevo. Leer el estado con el POST (`maxAgeSeconds=86400`) e **imprimir siempre `scannedAt`**.
31. **Deduplicar respuestas OpenAPI repetidas.** Documentar headers en cada respuesta multiplica el mismo bloque. Elevar los idénticos a `components.responses` (`scripts/openapi-dedupe.py`), nombrarlos por significado, y hacer que **los tests resuelvan `$ref`**. **Minificar el JSON solo ahorró 16%; el dedupe ahorró 23%** y mantiene el archivo legible.
32. **Recortar un índice moviendo texto, no borrándolo.** `llms.txt` pasó de **13.3 KB a 10.7 KB** moviendo las definiciones completas verbatim a `llms-concepts.txt` y dejando una línea por concepto. Scriptear el movimiento, diffear el resultado para probar que ninguna línea canónica desapareció (solo se fusionaron duplicados), y añadir un **test de presupuesto de bytes** para que el archivo no vuelva a crecer sin que nadie lo note.
33. **Los adjuntos guardados bajo `public/` se publican.** Un builder que guarda capturas pegadas en `public/uploads/` las commitea y las publica con el siguiente deploy: una captura interna de Ora respondió 200 en el sitio público, y un leaderboard de competidores estuvo a punto. Mantener material interno fuera de `public/` (gitignorear la carpeta o mover el archivo) y comprobar `curl -I https://site/uploads/<file>` tras un deploy.
34. **`openssl` de macOS es LibreSSL y no puede generar claves Ed25519.** Los docs del registro usan `openssl genpkey -algorithm Ed25519` y fallan en Mac. Generar el par con `crypto` de Node y verificar el round-trip sign/verify **antes** de publicar la mitad pública.
35. **La búsqueda del registro MCP vive en `/v0.1/servers?search=`.** La ruta `/v0/` no devolvía nada e hizo parecer que faltaba una entrada.
36. **Algunos pasos solo los puede hacer el dueño.** Publicar en un registro o en npm actúa bajo la identidad del dueño: preparar, testear y documentar (un archivo paso a paso en la doc del proyecto), **no hacerlo**, y **nunca enlazar algo que todavía no existe**.

### Decisiones de declinar (y por qué)

37-42. Ver Sección 3 (OAuth/`auth.md`, Web Bot Auth, DNS-AID, paginación falsa/jobs/batch/sandbox, Markdown por User-Agent, WebMCP write tools).

### Proceso

43. **Preguntar poco, con recomendaciones.** El usuario delega ("you choose"): decidir, decir qué se decidió y por qué. (Máximo cuatro decisiones: política Content-Signal, qué skill única publicar y su texto, si WebMCP expone write tools —default no—, y si el rubric propio debe adoptar estos estándares —default no hasta que un journey real los consuma.)
44. **Reportar lo que no funcionó.** Decir al usuario cuándo un scanner quita puntos por algo que decidiste no construir, cuándo una afirmación no está verificada (**WebMCP en un navegador real**) y cuándo un check es off-site.
45. **Registrar las mediciones con sus advertencias** (runs únicos, agentes no deterministas, scans cacheados). **Nunca presentar un journey como benchmark.**

---

## 5. Los scanners de terceros

Dos tipos de instrumento, y la regla de oro:

| Tipo | Herramientas | Qué mide | Para qué sirve |
|---|---|---|---|
| **Outcome** | Ora journeys | Un agente real intenta una tarea: pasos, segundos, costo, tokens, de dónde salió la respuesta | La única evidencia de lo que los agentes **hacen**. Correr antes y después. |
| **Presence** | orank, Is Agentic, isitagentready, AOS/APS | Qué archivos, headers y estándares existen y pasan checks de estructura | Cobertura. Muchos checks premian estándares que ningún agente consume todavía. |

*"A presence score can reach 100 while a journey still wastes steps. Chase the journey, use the scanners as a checklist filtered by triage."* Los scanners cambian sus checks y APIs: **cuando algo contradiga el archivo, creer la respuesta en vivo.**

### 5.1 orank (Ora)

**Qué mide realmente.** Presencia + puntuación de estándares. Cada check trae `estScoreGain`, `tier` (`required`, `recommended`, `emerging`), `maturity`, `status` (`pass`, `warning`, `fail`, `na`) y `details`.

**API / cómo se invoca.**
- `POST /api/scan {"url": "domain", "maxAgeSeconds": N}`: devuelve el scan almacenado más reciente **no más viejo que N segundos**, o escanea de nuevo.
  - `maxAgeSeconds` default **6 h**, y se **clampea a [3600, 86400]**.
  - Usar `86400` para leer el estado más reciente y `3600` para forzar un scan fresco (un scan más joven de una hora se devuelve de caché **incluso con `--rescan`**).
  - Cuotas: **10/min burst, 30/day**.
- `GET /api/score/{domain}`: **puede ir por detrás del resultado del POST.**
- `GET /api/checks`: catálogo completo con guía de arreglo por check id (**ids estables**).
- El script `scripts/orank-triage.py` hace el POST por defecto y etiqueta el GET como `--cached`.

**Categorías y pesos.** El skill documenta capas (`layers`) con `score`/`maxScore`; en el caso real aparecen **Discovery, Access y Usability**:
- Antes: **Discovery 7/14, Access 63/65, Usability 76/92** → total **80/100, grade B**.
- Después: **Discovery 9/16, Access 67/67, Usability 85/93** → total **86/100, grade A**.

**Aviso de honestidad:** los archivos del skill **no documentan una categoría "Payments" ni pesos porcentuales por categoría**; solo aparecen los prefijos de checks declinados `mpp-`, `x402-`, `ucp-`, `acp-`, `ap2-` (familias de pago/comercio) en `orank-triage.py`. No se debe inventar una capa ni un peso que la fuente no da. Los `maxScore` de las capas (14, 65, 92) no suman 100, así que **no hay pesos normalizados publicados** en el skill.

**`estScoreGain`.** Es el campo clave: ordena **cada** check fallido o en warning por puntos estimados de mejora. El resumen humano de orank lista "gaps" en **orden de reporte**; el ranking por `estScoreGain` es lo que dice dónde están los puntos. *"Scanner summaries list gaps worth 0.2 points while the 10-point items are off-site."* `orank-triage.py` ordena por `(-estScoreGain, class != CODE, -maxScore)` e imprime el total estimado por clase (CODE/OFFSITE/DECLINE).

**Qué NO mide.** No mide si un agente real completa la tarea (eso es Ora journeys). Muchos de sus checks premian estándares sin consumidores. Los grandes pozos de puntos son **off-site** y no los arregla el código.

**Rarezas.**
- `GET /api/score` puede devolver un registro viejo más de una hora después de que el POST tenga uno nuevo (80/B de las 05:54 vs 86/A de las 06:56).
- `scannedAt` importa: un score puede ser anterior a tu deploy.
- **Acredita una API abierta:** `oauth-support` y `scoped-permissions` **pasan** para "an explicitly open API that needs no keys", y los checks OAuth del MCP son `na` cuando la autenticación está deshabilitada.
- Checks dejados a 0 o parciales **a propósito**: `nlweb-ask`, `markdown-url-fallback` full credit, `agent-mode-view`, `pricing-md`, `modular-llms-txt` (todos emerging, ~0 de ganancia).
- Checks de registro y paquete (`mcp-registry-listed`, `npm-sdk-package`, `rest-sdk-packages`, `cli-tool`) suman ~4-5 puntos y **necesitan que el dueño publique**. `mcp-registry-listed` quiere una entrada **verificada bidireccionalmente**: en el registro bajo tu dominio (o un listado verificado de Smithery con uso) **Y** un enlace de vuelta desde tu doc.

**Cómo se cachea.** Ver arriba: default 6 h, mínimo 1 h. Tras un deploy hay que comparar `scannedAt` con la hora del deploy y esperar a pasar la hora.

**Cómo se interpreta.** Rankear por `estScoreGain` y clasificar: **CODE** (construible y honesto: hazlo), **OFFSITE** (necesita al dueño, una cuenta o el mundo exterior), **DECLINE** (necesitaría una afirmación falsa en un sitio abierto/simple). Solo leer el estado con POST.

Conjuntos exactos de clasificación del script:
- **OFFSITE:** `brand-search-accuracy`, `agentic-search-usecase`, `agentic-search-specific`, `wikipedia-presence`, `mcp-registry-listed`, `npm-sdk-package`, `rest-sdk-packages`, `cli-tool`, `chatgpt-app-listed`, `skills-sh-listed`, `skills-sh-quality`, `agent-plugins-repo`, `mcp-app-registry`.
- **DECLINE:** `oauth-protected-resource`, `auth-md-exists`, `auth-md-structure`, `auth-md-walkthrough-simulation`, `agent-auth-discovery-metadata`, `agent-auth-www-authenticate`, `agent-auth-endpoints-reachable`, `web-bot-auth-directory`, `mcp-auth-mechanism`, `mcp-oauth-metadata`, `mcp-pkce-s256`, `pagination-shape`, `async-job-pattern`, `batch-endpoints`, `sandbox-environment`, `agent-ua-markdown`, `mcp-multi-surface-coverage`.
- **DECLINE por prefijo:** `graphql-`, `mpp-`, `x402-`, `ucp-`, `acp-`, `ap2-`.
- Todo lo demás → CODE.

### 5.2 Is Agentic (is-agentic.com)

- **Cómo se invoca:** `https://is-agentic.com/scan/{domain}` o `npx is-agentic {domain}`.
- **Qué mide:** un score de "readiness" 0-100 más un "Prompt to improve" que lista hallazgos por prioridad (fallos primero, luego warnings). **El score puede llegar a 100 mientras los hallazgos recomendados siguen listados: no cuentan.**
- **Qué NO mide:** los hallazgos recomendados no afectan el score.
- **Rarezas:** **re-escanear el mismo código desplegado movió 89 a 100 sin ningún commit**: el primer reporte tenía evidencia obsoleta o pre-deploy. *"Always re-scan before acting on an old report."*
- **Hallazgos que se encontraron:** respuestas de error JSON, discoverability del nombre de marca (off-site), portal de desarrolladores, docs de API pública enlazadas desde el home, guía when-to-use, versionado/deprecación REST, headers de rate-limit, discoverability de recursos para desarrolladores (off-site), API alcanzable, CLI (necesita un paquete real).
- **Cómo se interpreta:** de los seis hallazgos recomendados que siguieron listados pero sin puntuar (brand-name search, when-to-use, versioning, rate-limit headers, developer discoverability, CLI), tres se construyeron después (lote 3), dos son off-site y uno necesita un paquete publicado.

### 5.3 isitagentready.com

- **Cómo se invoca:** `POST https://isitagentready.com/api/scan {"url": "https://example.com"}`.
- **Cada check tiene un how-to skill** en `https://isitagentready.com/.well-known/agent-skills/{id}/SKILL.md`; ids: `dns-aid`, `web-bot-auth`, `content-signals`, `api-catalog`, `oauth-discovery`, `oauth-protected-resource`, `auth-md`, `agent-skills`, `webmcp`, `ard`.
- **Qué mide:** *"It is a checklist of presence."*
- **Qué NO mide:** no mide outcome ni consumo real.
- **Rarezas:** **su texto de arreglo va por detrás de los specs**: citaba `navigator.modelContext.provideContext()` para WebMCP mientras el draft W3C vigente es `document.modelContext.registerTool()`. *"Read the spec before copying a scanner's advice."*
- **Veredictos tomados:** construir Content Signals, api-catalog, ARD ai-catalog, agent-skills index y WebMCP; declinar OAuth discovery, protected-resource metadata, `auth.md`, Web Bot Auth y DNS-AID.
- **Cómo se interpreta:** como checklist de presencia, no como benchmark; verificar los arreglos contra el spec vigente.

### 5.4 Ora journeys (ora.ai)

- **API:** abierta, sin key: `https://ora.ai/api/openapi.json`. Límites por IP.
- **Intents** (`GET /api/journey/intents`): `integrate` = *"I want to integrate {domain}. Find the setup and getting-started guide."* Otros: `api-docs`, `pricing`, `evaluate`, `signup`, `support`, `agent-access`, `authenticate`, `operate-site`, `transact`, `production-readiness`.
- **Agentes** (`GET /api/journey/agents`): `cas-sonnet` (Claude Code, harness `claude-agent-sdk`, `claude-sonnet-4-6`), `chatgpt` (harness `ash`, `gpt-5.4`), `ash-claude` (eve).
- **Cómo se invoca:** `POST /api/journey/runs` con body `{"intent":{"intent_id":"integrate","domain":"example.com"},"harness":"claude-agent-sdk","model":"claude-sonnet-4-6"}`. **201** despacha un run (cuesta a Ora unos centavos). **200 con `rate_limited: true`** devuelve el run almacenado para el mismo target (no cuesta nada).
- **Qué mide:** *"A real agent tries a task: steps, seconds, cost, tokens, where the answer came from."* Es el único instrumento de outcome.
- **Métricas en `result.run_signals`:** `steps_count`, `answer_efficiency` (proporción de pasos que contribuyeron), `answer_grounding.on_site_ratio`, `answer_basis.site_share` / `memory_share`, `link_following_rate`, `prior_knowledge_ratio`, `status_profile` (`count_4xx` es una URL adivinada o muerta), `friction_outcome`, más `insight.key_observations` en prosa. Costo y tokens son **top-level** (`cost_usd`, `*_tokens`).
- **Qué NO mide:** no mide calidad de contenido ni share of voice; mide ejecución de tarea.
- **Rarezas.**
  - **El endpoint de registro va con retraso.** `GET /api/journey/runs/{id}` seguía diciendo `running` después de que el run terminara. La fuente de verdad es el **stream SSE** (`stream_url`): su evento `result` es autoritativo, y un run terminado se puede **reproducir** desde la misma URL.
  - **Los runs son no deterministas.** Dos runs de Claude Code en el mismo sitio dieron eficiencia **100% y 60%**. *"Treat one run as an anecdote; compare medians of 3 or more, or compare steps and 4xx counts, not one percentage."*
  - Los callers anónimos solo tienen intents curados, **20 requests/minuto**; un run cuesta unos centavos, **no hacer loop**.
  - Un run cuesta dinero real: no repetir alegremente.
- **Cómo se cachea:** el mismo target repetido devuelve el run almacenado con 200 y `rate_limited: true` (coste cero).
- **Cómo se interpreta:** señales estables = **pasos, conteo de 4xx y `memory_share`**; tiempo y costo se mueven con lo verboso que sea el agente. Un 404 o un origen `prior_knowledge` en la trayectoria es un paso que el sitio pudo haber ahorrado.

### 5.5 AOS y APS (rubrics propios de Believe)

- **AOS** = ¿puede un agente **operar** el sitio? (acciones declaradas, MCP/OpenAPI, operabilidad del DOM).
- **APS** = ¿**elegiría** un agente la marca? (invocabilidad, eficiencia de tokens, claridad de claim, reputación verificable, discovery).
- **Rareza clave:** *"None of the standards in RECIPE.md section 4 appears in the AOS/APS protocols: decide deliberately whether a rubric should score them, and not until a journey shows an agent consuming them."*
- El APS empírico depende de cuán bien conocen los modelos la marca, **cosa que el código no cambia**.

### 5.6 Share of voice (el resultado comercial)

Es un **tercer instrumento**, el que le importa a un negocio: cuántas veces los motores de IA mencionan la marca frente a competidores para un set fijo de prompts (leaderboard de menciones, share y número de prompts por marca).

- Fijar el set de prompts, los motores y la lista de competidores **antes** de cambiar nada, y re-ejecutar en un calendario (semanal). *"A single snapshot is a baseline, not a result."*
- Muestras pequeñas: un leaderboard con ~80 menciones se mueve un puesto con dos o tres menciones. **Leer shares, no ranks**, y decir cuántos prompts y runs hay detrás.
- Ser mencionado no es ser recomendado, y el set de prompts de la propia herramienta puede favorecerte. No atribuir un cambio a un fix concreto sin una baseline tomada antes; los motores que responden con búsqueda en vivo reaccionan en días, los que responden de entrenamiento tardan mucho más.
- Los items off-site (Wikipedia, Wikidata, registros, prensa) mueven este instrumento **más que cualquier archivo del sitio**.

### 5.7 Qué leen de verdad los agentes (de los journeys)

El home servido como Markdown (`llms.txt`), `/openapi.json`, la página de docs, `/.well-known/agent.json|brand.json|mcp.json`. Los runs de ChatGPT además trajeron `ai-catalog.json`, `agent-skills/index.json`, ambos archivos MCP y `/api/v1/status`; siguieron `/developers.md` cuando `llms.txt` lo enlazó; y hasta llamaron `/mcp`, `/ask` y el status endpoint de verdad. *"A crawl of real bot traffic had shown almost only Meta-ExternalAgent and Bytespider: do not assume the manifests are consumed until a journey or a log shows it."*

---

## 6. Los scripts

Todos viven en `scripts/`. Dependencias: **solo stdlib de Python 3** y `curl` (`probe.sh` también usa `python3`, `shasum`, `wc`, `mktemp`).

### 6.1 `probe.sh` — sonda de producción de solo lectura

- **Invocación:** `probe.sh DOMAIN [--burst PATH] [--no-links] [--docs PATH]`
  - `DOMAIN`: apex sin esquema, p. ej. `example.com`.
  - `--docs PATH`: la página de developers que debe tener twin Markdown (default `/developers`).
  - `--burst PATH`: además envía **62 GETs** a PATH (un 404 barato, p. ej. `/api/v1/__nope`) para probar el 429 y `Retry-After`.
  - `--no-links`: se salta traer cada URL listada en `llms.txt` (más lento: un GET por enlace).
- **Presupuestos de tamaño** (bytes, override por env): `LLMS_MAX=12000`, `OPENAPI_MAX=40000`.
- **Salida:** lista de checks con `✓`/`✗` y al final `PASS n   FAIL n`; **exit code 0 solo si `FAIL == 0`**.
- **Nunca envía un POST que escriba:** las llamadas MCP son `initialize` y `tools/list` solamente.
- **Qué comprueba** (orden): host canónico (www → apex permanente); Link header del home (`api-catalog`, `service-desc`, `service-doc`, `sitemap`, `alternate type=text/markdown`); `Accept: text/markdown` en `/` y frontmatter `---` y `Vary: Accept`; `/index.md`; 404 en Markdown; `llms.txt` (200, H1, Start here, When to use, presupuesto de bytes); `AGENTS.md` 200 y `agents.md` 404; todos los enlaces de `llms.txt` con GET 2xx (hasta 60); robots.txt (Content-Signal en cada grupo, Agentmap, Sitemap, `Allow: /api/v1/`); api-catalog (200 + linkset + `item`/relaciones); ai-catalog (200 + CORS + urn:air + url xor data + 2-5 queries + trustManifest); agent-skills (200 + schema v0.2.0 + **digest recalculado por cada skill**); server-card con `serverUrl`; `mcp.json`, `agent-card.json`, `security.txt` 200; openapi.json (200, 3.x, `/v1/`, `security`, `Idempotency-Key`, `x-api-lifecycle`, presupuesto); `/api/v1/status` (200 + los 5 headers de rate limit + `API-Version`); `/api/v1/__nope` 404 JSON con `code` y `hint`; MCP `initialize` y `tools/list` (200, `protocolVersion`, tools con `inputSchema` y `annotations`) + headers RateLimit; página de developers (200, documenta idempotencia/versionado/rate limits, anuncia twin, `Accept` devuelve Markdown con frontmatter, `.md` sirve lo mismo, el twin pesa < 1/3 del HTML); y home HTML con evidencia WebMCP (`registerTool|toolname=`). Con `--burst`: distribución de 62 códigos y 429 con `Retry-After`.
- **Uso recomendado:** correr **ANTES (baseline) y DESPUÉS de cada deploy**: *"a push is not a deploy, and config text is not behavior."*
- **Rarezas:** los mensajes de fallo traen el arreglo embebido (p. ej. *"set it in middleware, next.config headers get overwritten by i18n middleware"*). Los `--burst` cuentan con 60 permitidos antes del 429.

### 6.2 `orank-triage.py` — rankear hallazgos de orank por ganancia

- **Invocación:** `orank-triage.py DOMAIN [--rescan | --cached] [--all] [--json]`
  - Default: `POST /api/scan` con `maxAgeSeconds=86400` (el scan almacenado **más reciente**, sin escanear de nuevo salvo que el último tenga más de un día).
  - `--rescan`: `POST /api/scan` con `maxAgeSeconds=3600`, el mínimo que acepta orank.
  - `--cached`: `GET /api/score/DOMAIN` (**puede devolver un registro más viejo**; evitar tras un rescan).
  - `--all`: incluye también checks `na`.
  - `--json`: imprime el JSON crudo.
- **Salida:** línea de score (`domain: score/maxScore grade X · scanned FECHA`), summary, capas con `score/maxScore`, y una tabla de checks fallidos/warning con columnas `gain | class | layer | check | pts | tier | details`, más `estimated gain by class: {CODE, OFFSITE, DECLINE}` redondeado a 1 decimal.
- **Clasificación:** CODE / OFFSITE / DECLINE según los conjuntos de la sección 5.1; prefijos declinados `graphql-`, `mpp-`, `x402-`, `ucp-`, `acp-`, `ap2-`.
- **Dependencias:** stdlib (`json`, `sys`, `urllib.request`, `urllib.error`). Timeout 90 s. `user-agent: agent-ready-web-skill`. Sale con mensaje si hay `HTTPError`.
- **Rarezas:** *"Only stdlib. --rescan calls POST /api/scan first (orank allows 10/min burst and 30/day; a scan younger than 1 hour is returned from cache even with --rescan, so compare `scannedAt` with your deploy time)."* Ordena por `(-gain, class != CODE, -maxScore)`.

### 6.3 `ora-journey.py` — correr un journey real

- **Invocación:** `ora-journey.py DOMAIN [--intent integrate] [--agent cas-sonnet] [--all-agents] [--timeout 300] [--json]`
  - `--intent`: id curado (ver sección 5.4). Útiles: `integrate` (setup y getting-started), `api-docs`, `pricing`, `evaluate`, `agent-access`, `operate-site`.
  - `--agent`: `cas-sonnet` (Claude Code), `chatgpt` (ChatGPT), `ash-claude` (eve).
  - `--all-agents`: corre todos los agentes públicos e imprime tabla comparativa.
  - `--json`: imprime el evento `result` crudo en vez del resumen.
- **Salida (un solo agente):** JSON con `outcome`, `steps`, `seconds`, `cost_usd`, `tokens`, `efficiency`, `answer_from_site`, `site_share`, `memory_share`, `link_following`, `prior_knowledge`, `friction`, `errors_4xx`; luego la trayectoria (id, turno, acción, estado, duración, path, `[origin]`) y `insight.summary` + `key_observations`. Con `--all-agents`: tabla con `outcome, steps, seconds, cost_usd, tokens, efficiency, answer_from_site, friction`.
- **Dependencias:** stdlib (`json`, `sys`, `time`, `urllib.error`, `urllib.request`).
- **Rarezas documentadas en el propio docstring:**
  - `POST /api/journey/runs` inicia (201) o devuelve el último run almacenado para el mismo (domain, intent, agent) (200, `"rate_limited": true`, coste cero).
  - `GET /api/journey/runs/{id}` puede seguir diciendo `"running"` tras terminar. **La fuente de verdad es el stream SSE**: esperar su evento `result`. Un run terminado puede reproducirse desde la misma `stream_url`.
  - Callers anónimos: solo intents curados, 20 req/min. Un run cuesta unos centavos: **no hacer loop**.
  - `summarize()` calcula tokens como suma de `input_tokens + output_tokens + cache_read_tokens + cache_write_tokens`.

### 6.4 `skills-index.py` — construir/verificar el índice de agent-skills

- **Invocación:**
  - `skills-index.py SKILLS_DIR BASE_URL` → imprime el índice de cada `SKILLS_DIR/<name>/SKILL.md`.
  - `skills-index.py SKILLS_DIR BASE_URL --write F` → lo escribe en F (imprime `wrote N skill(s)`).
  - `skills-index.py SKILLS_DIR BASE_URL --check F` → **exit 1** si F tiene un digest obsoleto o faltante (`stale or missing in index: ...`); si no, `index is up to date`.
- **`BASE_URL`** es donde se sirve `SKILLS_DIR`, p. ej. `https://example.com/.well-known/agent-skills`.
- **Qué hace:** por cada carpeta con `SKILL.md`, lee los **bytes crudos**, parsea el frontmatter, y **asserta**: `name` del frontmatter == nombre de carpeta; nombre contra `[a-z0-9]+(-[a-z0-9]+)*` y `len <= 64`; `0 < len(description) <= 1024`. Emite `$schema` (v0.2.0) y `skills[]` con `name`, `type: "skill-md"`, `description`, `url` absoluta y `digest: "sha256:" + sha256(raw).hexdigest()`.
- **Dependencias:** stdlib (`hashlib`, `json`, `os`, `re`, `sys`).
- **Rarezas:** *"The digest is sha256 of the RAW BYTES of SKILL.md: recompute it after ANY edit (a test should enforce it)."* El `--check` compara por pertenencia (`s not in current["skills"]`), no por igualdad exacta de orden.

### 6.5 `openapi-dedupe.py` — elevar respuestas idénticas a `components.responses`

- **Invocación:** `openapi-dedupe.py SPEC.json [--write] [--width 1200] [--names names.json]`
  - **Dry run por defecto**: imprime cada grupo duplicado, sus usos, los bytes ahorrados y el nombre de componente propuesto; termina con `dry run: nothing written (use --write)`.
  - `--write` reescribe el archivo.
  - `--width` mantiene en una línea los objetos que caben en N caracteres (default 1200) para conservar el look compacto (*"a plain json.dump(indent=2) would make it bigger, not smaller"*).
  - `--names` mapea un nombre automático al deseado: `{"RateLimitExceeded2": "RateLimitedSubmissions"}`.
- **Qué hace:** agrupa por `json.dumps(response, sort_keys=True, separators=(",",":"))` sobre `paths.*.*.responses.*`; solo grupos con **≥2 usos**; genera nombres Pascal desde `description` (`pascal()`, hasta 4 palabras) y desambigua añadiendo número; escribe el componente y reemplaza cada uso por `{"$ref": "#/components/responses/Nombre"}`; reordena `components` como `headers, parameters, responses, schemas` y el resto después; **hace `json.loads(out)` antes de escribir para no escribir nunca JSON inválido**; imprime `wrote {path}: {bytes} to {bytes} bytes`.
- **Dependencias:** stdlib (`collections`, `json`, `re`, `sys`).
- **Rarezas:** *"Run your OpenAPI linter and your tests afterwards: tests that read `op.responses[code].headers` must resolve `$ref` first."* No toca respuestas que ya son `$ref`.

---

## 7. Los templates

`templates/` es una implementación de referencia en Next.js 16 + TypeScript extraída de código de producción y re-testeada en un proyecto aislado: `tsc` limpio, **43 tests pasan**, el OpenAPI linta válido. `example.com`, `Example Co` y `TODO(site)` marcan lo que hay que reemplazar. Los tests importan `@/...`; el proyecto necesita el alias `paths` `@/* -> ./*` y `tsx`:

```
node --import tsx --test tests/*.test.ts
```

### Wiring (7 pasos exactos)

1. Copiar los archivos que se necesiten, arreglar los imports, reemplazar `example.com`, `Example Co` y cada `TODO(site)`.
2. Apuntar `lib/answer.ts` a la recuperación real, y `submit` en `app/api/v1/leads/route.ts` a la entrega real (**devolver no-2xx si falla**).
3. Mantener el orden de wrappers `withRateLimit(withIdempotency(handler))`.
4. Si ya existe un middleware (next-intl), usar su respuesta y **solo `append`** el header `Link`.
5. Tras editar `SKILL.md`, correr `scripts/skills-index.py DIR BASE_URL --write index.json` (**un test falla si se olvida**).
6. Desplegar, luego `scripts/probe.sh yourdomain.com --burst /api/v1/__nope`.
7. `public/openapi.json` avisa de `license` y del dominio placeholder: ambos son del dueño. Las respuestas repetidas ya se elevaron con `openapi-dedupe.py`; correrlo de nuevo tras añadir operaciones.

### 7.1 Tabla de templates, patrón que resuelve y test que lo cubre

| Archivo | Qué es / qué aporta | Patrón que resuelve | Test que lo cubre |
|---|---|---|---|
| `lib/rate-limit.ts` | Limitador de ventana deslizante, headers RateLimit y Retry-After, `withRateLimit`, topes globales pinneados, LRU; exporta `DEFAULT_POLICY` (60/60s), `SUBMISSIONS_POLICY` (10/3600s), `API_VERSION = "1"`, `RATE_LIMIT_HEADER_NAMES` y `clientKey` | Un agente se autorregula; cabeceras y semántica portables a cualquier framework | `rate-limit.core.test.ts` (consume/release, headers exactos, clientKey con último salto e ignorando `cf-connecting-ip`, no-eviction de globales, withRateLimit, refund de 4xx) |
| `lib/idempotency.ts` | `withIdempotency`: replay, 409, 422, store solo de 2xx, TTL 24 h, memoria acotada (2000), fingerprint sha256, scoping por endpoint+cliente | Un reintento tras corte de red no duplica. *"Same semantics; swap the Map for Redis when you have several instances"* | `idempotency.core.test.ts` (11 casos) y `leads-and-mcp.test.ts` |
| `lib/api-error.ts` | El modelo de error JSON (`ok, error, code, hint, issues`), `API_SPEC_URL` y `methodNotAllowed(allow)` que emite 405 con `Allow` | Errores legibles por máquina en vez de HTML | `leads-and-mcp.test.ts` (400 con issues/code/hint, 404, 405 con Allow) y `rate-limit.core.test.ts` (429) |
| `lib/robots.ts` + `app/robots.txt/route.ts` | robots.txt con Content-Signal y Agentmap desde **un módulo**, route handler porque `MetadataRoute.Robots` no puede emitirlos | Directivas que el generador nativo no soporta | `discovery-files.test.ts` |
| `lib/negotiate.ts`, `middleware.ts`, `lib/site-routes.ts` | Negociación `Accept: text/markdown`, home Markdown y 404 Markdown, header `Link` de descubrimiento; `KNOWN_SECTIONS`/`MARKDOWN_TWINS` compartidos | Reglas de negociación y **la trampa de "append después de i18n"** | `docs-markdown.test.ts` (rewrite con Accept, no rewrite con HTML, no rewrite de subrutas) |
| `app/md/[[...slug]]/route.ts` | Home Markdown con frontmatter (`title`, `description`, `canonical`, `updated` desde el mtime de `llms.txt`), twin de developers (fecha desde `openapi.json`), 404 Markdown con path saneado | Formato | `docs-markdown.test.ts` y `probe.sh` |
| `lib/docs-content.ts`, `lib/docs-markdown.ts`, `tests/docs-markdown.test.ts` | Contenido de la página de developers en **UN módulo**, su twin Markdown (`/developers.md` y `Accept`) y el test de paridad que falla si el twin omite algo | Fuente única + test de paridad | `docs-markdown.test.ts` |
| `app/api/v1/leads/route.ts`, `app/api/leads/route.ts` | Endpoint de escritura con validación zod, límites, idempotencia y alias fijado a v1 | **Orden de composición** `withRateLimit(withIdempotency(submit,"leads"), SUBMISSIONS_POLICY, {refundClientErrors:true})` | `leads-and-mcp.test.ts` |
| `app/api/v1/status/route.ts`, `app/api/[[...slug]]/route.ts` | Status endpoint (el enlace `status` del catálogo) y catch-all JSON 404/405 | Contrato | `discovery-files.test.ts` (status) y `leads-and-mcp.test.ts` (catch-all) |
| `app/ask/route.ts`, `lib/answer.ts` | Endpoint de lectura estilo NLWeb; **`answer()` es el punto de enchufe de la recuperación** (read-only, sin efectos; devuelve claim + boundary + proof) | Recuperación de solo lectura | `leads-and-mcp.test.ts` (/ask con matches, 400 sin query, CORS expone retry-after) |
| `app/mcp/route.ts` | Servidor MCP: una tool de lectura, una de escritura, límites (60/min, 5/h cliente, 20/h global), idempotencia, handlers en proceso **con IP reenviada**, descriptor GET con `documentation` y `quickstart` | Comportamiento de protocolo | `leads-and-mcp.test.ts` (5 casos MCP) |
| `app/.well-known/api-catalog/route.ts` | Catálogo RFC 9727 con `item`, `service-desc`, `service-doc`, `status` | Shape | `discovery-files.test.ts` |
| `lib/webmcp.ts`, `types/webmcp.d.ts` | Script inline WebMCP (solo lectura) y tipos JSX para el formulario declarativo | Texto del script + tipos | `webmcp.script.test.ts` (5 casos en `node:vm`) |
| `next.config.snippet.ts` | www → apex **308**, rewrite de `/index.md` y `/developers.md` (afterFiles), CORS para `ai-catalog.json` | Config | `probe.sh` (host canónico, `/index.md`) |
| `public/` | `llms.txt` (índice magro) + `llms-concepts.txt` (definiciones), `AGENTS.md`, `ai-catalog.json`, `agent-skills/index.json` y su `SKILL.md`, `mcp/server-card.json`, `mcp.json`, `agent-card.json`, `security.txt`, OpenAPI 3.1 válido | File shapes | `discovery-files.test.ts` |
| `tests/` | Núcleo de rate-limit e idempotencia, script WebMCP en `node:vm`, integración de leads y MCP, archivos de descubrimiento | **Qué asertar** | — |

### 7.2 Detalles de los templates que importan para implementar

- **`rate-limit.ts`**: `release()` hace `pop()` del array; `peek()` no consume y se usa para poner el header final tras ejecutar el handler; `withHeaders(res, headers, {override})` clona headers porque las respuestas de `fetch` son inmutables; en el 429 devuelve `apiError(429, "rate_limited", ...)` con `extraHeaders` + headers de límite.
- **`idempotency.ts`**: la clave se compone `${scope}|${clientKey(req)}|${key}`; el fingerprint se calcula con `await req.clone().text()`; el replay responde con `content-type` guardado, `idempotent-replayed: "true"` y `api-version: "1"`; el wrapper **no** copia headers de rate-limit (eso lo hace el limitador externo).
- **`api-error.ts`**: el `hint` de `methodNotAllowed` incluye `Spec: ${API_SPEC_URL}`.
- **`negotiate.ts`**: parsea `Accept` por comas, extrae `q=` por parámetro, tolera `q` no numérico (default 1).
- **`docs-markdown.ts`**: cita los valores con `JSON.stringify` (YAML válido si el título contiene `": "`); fences por sección; tabla de errores con `| --- | --- | --- |`; recursos como `- [label](BASE+path)`.
- **`mcp/route.ts`**: `withHeaders(res, ctx.headers, {override:false})` para no pisar los headers del 429; en escrituras, el cupo que se reporta es el de envíos por hora, no el de requests por minuto; una repetición o un error devuelven ambos cupos (por cliente y global); el `replayed` interno se descarta antes de responder (`const { replayed, ...result }`).
- **`ask/route.ts`**: CORS con `access-control-expose-headers` que lista `RATE_LIMIT_HEADER_NAMES` ("agents in a browser need RateLimit and Retry-After"); acepta `query` o `q` en el body y `q` o `query` en query string; `OPTIONS` devuelve 204.
- **`api/[[...slug]]/route.ts`**: el 404 lista los endpoints públicos reales y enlaza la spec; el path se sanea con `replace(/[\r\n]/g,"").slice(0,200)`; se exportan GET/POST/PUT/PATCH/DELETE/OPTIONS todos envueltos.
- **`site-routes.ts`**: `SITE_ROUTES = ["", "developers", "about"]`; `MARKDOWN_TWINS = new Set(["/developers"])`; `KNOWN_SECTIONS` derivado. *"a section missing here gets a Markdown 404."*

---

## 8. Lo que quedó abierto

### (a) Trabajo off-site que solo puede hacer el dueño

Estos eran **los pozos de puntos más grandes** (~10 puntos estimados en total, "the biggest point pools"). El skill pide **listarlos con su ganancia estimada en vez de fingir que el código los arregla**:

- **Search Console con el sitemap** (submission).
- **Wikidata** con el sitio web oficial (**P856**) y **después Wikipedia** con prensa independiente.
- **Listar el MCP en un registro y enlazarlo desde la doc** (`mcp-registry-listed`; quiere verificación bidireccional). Preparación: `server.json`, archivo de prueba de dominio y par de claves — **construidos y testeados, pendientes de publicación**.
- **Publicación del SDK/CLI en npm** (`npm-sdk-package`, `rest-sdk-packages`, `cli-tool`). CLI `believe-global`, **24 tests**, instalado desde el tarball empacado en un proyecto vacío y ejercitado contra producción — construido y testeado, **sin publicar**.
- **Un repositorio en skills.sh** (`skills-sh-listed`, `skills-sh-quality`).
- **Una app de ChatGPT** (`chatgpt-app-listed`).
- En `AGENTS.md` / `llms.txt`, los enlaces a paquetes no deben existir hasta que el paquete exista: *"Do not mention the SDK or CLI in llms.txt or the docs until the package exists on npm."*

Ganancias estimadas registradas **antes de los últimos lotes**: brand search **4.8**, agentic search **3.2**, Wikipedia/Wikidata **2.5**, WebMCP **1.9**, MCP registry **1.6**, npm SDK **1.6**, ARD trust **1.4**, idempotency **1.4**.

### (b) Decisiones del dueño

- **La licencia del repositorio del skill:** `README.md` dice literalmente `## License` → *"TODO: choose one before making this repository public."*
- **El warning de `license` del OpenAPI**: `templates/README.md` dice *"`public/openapi.json` warns about `license` and the placeholder domain: both are yours to set."*
- **El dominio placeholder** (`example.com`) y `Example Co`/`TODO(site)`.
- **Preguntas que el skill permite hacer (máximo cuatro, cada una con recomendación):** la política de Content-Signal (`ai-train`; en el caso real se eligió `ai-train=yes`), **cuál skill única publicar y su texto**, **si WebMCP expone write tools (default: no)**, y **si el rubric propio del usuario debe adoptar estos estándares (default: no hasta que un journey real los consuma)**. *"If they say 'you choose', choose and say so."*
- **Decisión tomada en el caso real:** `ai-train=yes` porque el objetivo de la marca es ser conocida por los modelos y su APS empírico depende de eso; la excepción del corpus de entrenamiento se quedó en `Disallow`.

### (c) Cosas construidas pero no publicadas

- **Entrada del registro MCP**: `server.json`, archivo de prueba de dominio (`/.well-known/mcp-registry-auth`) y su par de claves — **construidos, testeados, sin publicar**. **Efecto en el score: no medido todavía.**
- **SDK + CLI sin dependencias** (`believe-global`, 24 tests) — **construido y testeado, no publicado**.
- **Archivo paso a paso** en la doc del proyecto para las partes que necesitan las cuentas del dueño.
- **`/.well-known/brand.json`**: referenciado por `llms.txt`, `AGENTS.md` y `openapi.json` como la identidad/evidencia firmada, pero **no existe como archivo en `templates/`**; la firma Ed25519 y el `trustManifest` se describen, no se materializan en una plantilla. Queda como pieza a construir por el dueño.
- **Pendiente funcional explícito**: *"Add the MCP client connect snippet and a documentation pointer to the `GET /mcp` descriptor."* — aunque `app/mcp/route.ts` ya lo implementa en la plantilla, en el caso real se listó como abierto en el lote final.
- **Recorte extra de `llms.txt`**: la meta de 2k tokens no se alcanzó (~2.7k); el siguiente recorte serían los casos verificables, que viven también en el perfil de marca firmado.

---

## 9. Los números medidos

### 9.1 Journeys (intent `integrate`: "find the setup and getting-started guide")

| Run | Agente | Steps | Time | Cost | Tokens | Efficiency | Answer from site | Notas |
|---|---|---|---|---|---|---|---|---|
| 1 (before) | Claude Code | 10 | 85.3 s | $0.1201 | 34,654 | 80% | 100% | 1 failed fetch (GET sobre un endpoint POST-only), 1 guessed URL |
| 2 | ChatGPT | 9 | 20.3 s | $0.0840 | 50,762 | 67% | 100% | Usó ai-catalog, `/api/v1/status`, MCP `tools/list`; trajo `.well-known/mcp` dos veces |
| 3 (after) | Claude Code | 3 | 55.7 s | $0.0679 | 14,417 | 100% | 86% | 14% de memoria: config del cliente MCP escrita sin fuente |
| 4 | Claude Code | 5 | 53.7 s | $0.0683 | 14,921 | 60% | 100% | Adivinó `/mcp/info` (404); 22% de las secciones de la respuesta desde memoria |
| 5 (todos los lotes live) | Claude Code | 4 | 80.3 s | $0.0983 | 19,881 | 100% | 100% | 0 errores (4xx), 0% de memoria, friction `succeeded_natively`. Más lento solo porque dos fetches de página fueron lentos (`/openapi.json` 28.8 s) |
| 6 (final: twin, OpenAPI y llms.txt magros live) | Claude Code | 5 | 56.4 s | $0.0759 | 15,848 | 100% | 100% | 0 errores, 0% de memoria, `succeeded_natively`; llegó a los archivos MCP por enlaces de la página de docs |
| 7 (final) | ChatGPT | 11 | 29.3 s | $0.0822 | 50,773 | 45% | 100% | 0 errores, 0% de memoria. Leyó ai-catalog, agent-skills index, ambos archivos MCP y luego llamó `/mcp`, `/ask` y `/api/v1/status` de verdad: la eficiencia es baja porque **verificó** la integración, no porque se perdiera |
| 8 (guía enlazada como `.md`) | ChatGPT | 9 | 25.0 s | $0.0747 | 48,952 | 67% | 100% | 0 errores, 0% de memoria. Trajo `/developers.md` (no el HTML), luego el catálogo, ambos archivos MCP y `/mcp`. Tokens sin cambio (-4%) |

**Run 1 → Run 5 (todo desplegado):** steps **10 → 4**, tokens **-43%**, cost **-18%**, time **-6%**, y el failed fetch, la URL adivinada y la respuesta escrita de memoria **desaparecieron**.

**Run 7 → Run 8 (efecto de enlazar el twin `.md`):** steps **11 → 9**, time **29.3 s → 25.0 s**, cost **$0.0822 → $0.0747**, efficiency **45% → 67%**, tokens **50,773 → 48,952 (-4%)**.

**Ruido:** runs 3 y 4 son el mismo agente en el mismo sitio con efficiency **100%** y **60%**. *"Noise is large, so steps, 4xx counts and memory share are the stable signals; time and cost move with how verbose the agent is."*

**Estado final (runs 6 y 7):** ambos agentes tuvieron éxito con 0 errores y 0% de la respuesta de memoria. ChatGPT usó **50.8k tokens antes y 50.8k después** del twin Markdown.

**Brecha entre harnesses:** ChatGPT (que lee páginas en crudo) gastó **50.8k tokens**; Claude Code (que resume páginas primero) gastó **15 a 20k**. *"The 3x gap against Claude Code (15 to 20k) is the harness, not our page sizes."*

### 9.2 Scores de scanners

- **Is Agentic: 76, luego 89, luego 100/100.** Seis hallazgos recomendados siguieron listados pero sin puntuar (brand-name search, when-to-use, versioning, rate-limit headers, developer discoverability, CLI): **tres se construyeron después (lote 3), dos son off-site, uno necesita un paquete publicado**. *Re-scan del mismo código desplegado movió 89 → 100 sin commit.*
- **orank:**
  - Antes de los últimos lotes: **80/100, grade B** — **Discovery 7/14, Access 63/65, Usability 76/92**.
  - Después de desplegarlos: **86/100, grade A** — **Discovery 9/16, Access 67/67, Usability 85/93**.
  - **Flipped a pass:** WebMCP **5/5**, Idempotency-Key **3/3**, ARD trustManifest **2/2**, llms.txt links **2/2**, Link header **1/1**, api-catalog **2/2**, server card **2/2**, Markdown frontmatter **1/1**.
  - **Lo que queda es off-site o declinado a propósito.**
  - Los seis checks de OAuth y `auth.md` valían **~0.2 cada uno** y cayeron a **0.1** cuando el resto pasó.
  - Ganancias estimadas antes de los últimos lotes (repetidas de la sección 8a): brand search **4.8**, agentic search **3.2**, Wikipedia/Wikidata **2.5**, WebMCP **1.9**, MCP registry **1.6**, npm SDK **1.6**, ARD trust **1.4**, idempotency **1.4**.
- **Tests:** **80** y luego **164** en el sitio; **43** en `templates/`. El lote 4 reportó **150 tests**.

### 9.3 Tamaños de archivos

| Archivo | Antes | Después | Mecanismo |
|---|---|---|---|
| `openapi.json` | 14.5 KB | 35.7 KB al añadir headers/idempotencia/ejemplos → **27.5 KB** con dedupe | 6 grupos de respuestas idénticas elevados a `components.responses`; **minificar solo ahorraba 16%, el dedupe 23%** |
| `llms.txt` | 13.3 KB | **10.7 KB** (~2.7k tokens; meta 2k no alcanzada) | Definiciones completas movidas verbatim a `llms-concepts.txt` |
| `/developers` HTML | — | ~**120 KB** (~30k tokens en crudo) | — |
| `/developers.md` (twin) | — | ~**2k tokens** | Generado del mismo módulo de contenido; test exige `md.length < 12_000` y `MD_BYTES*3 < HTML_BYTES` |
| Presupuestos de `probe.sh` | — | `LLMS_MAX=12000`, `OPENAPI_MAX=40000` | — |

### 9.4 Share of voice (herramienta propia del dueño, 2026-09-25 09:27, tomada después de que la mayoría de cambios estuviera live)

Leaderboard del set de prompts del dueño:

| Marca | Menciones | Share | Prompts |
|---|---|---|---|
| HubSpot | 16 | 20% | 12 |
| Profound | 12 | 15% | — |
| Peec AI | 10 | 12% | — |
| **la marca** | **9** | **11%** | **5 (rank 4)** |
| Semrush | 7 | 9% | — |
| Otterly.AI | 6 | 7% | — |
| Scrunch AI | 3 | 4% | — |
| cola | 2 cada una | 2% | — |

**~80 menciones en total.** Reportado por el dueño desde una herramienta **que no auditamos**: prompts, motores y número de runs **desconocidos**, **sin baseline de antes de los cambios**, así que dice **dónde está la marca, no qué lo causó**. Es la baseline para los siguientes runs.

### 9.5 Timeline de lotes (qué se construyó y qué expuso)

| Lote | Qué se construyó | Qué expuso |
|---|---|---|
| 1 | MCP propio en `/mcp` (3 tools), `openapi.json`, robots por tipo de crawler, security.txt | `X-Forwarded-For` es forjable en producción: se añadió el tope global de escrituras |
| 2 | Markdown por `Accept`, 404 Markdown, errores JSON de API, `/developers`, primera suite (80 tests) | Un scanner de la competencia pasó de 76 a 89 tras el primer deploy; un re-scan tras el deploy de errores JSON dio **100 sin commit nuevo** (el reporte de 89 tenía evidencia obsoleta) |
| 3 | Construido después por las seis recomendaciones que Is Agentic seguía listando pero no puntuaba: `/api/v1`, headers RateLimit, Retry-After, política de versionado, api-catalog, "When to use" en llms.txt, robots `Allow /api/v1/` | La verificación en prod mostró un 429 tras 60 requests; **el header `Link` del home nunca llegaba** (Gotcha 1) |
| journey 1 | Leer el primer journey: 10 pasos, un fetch fallido, una URL adivinada | Dead ends: URLs POST-only de Supabase (400 a GET), un `$schema` soft-404, un MCP autenticado anunciado como abierto. Arreglo: bloque "Start here", `authentication: api-key`, enlaces eliminados |
| isitagentready | 10 hallazgos: se construyeron Content Signals, api-catalog, ARD ai-catalog, agent skills, WebMCP; se declinaron OAuth discovery, protected-resource metadata, auth.md, Web Bot Auth, DNS-AID | El texto del scanner iba por detrás del spec de WebMCP; verificar producción encontró el bug del header `Link` |
| 4 (orank) | Idempotency-Key, WebMCP inline + formulario declarativo, `item` del api-catalog, `serverUrl`, `/index.md` y frontmatter, `trustManifest`, headers Deprecation/Sunset, enlaces muertos de llms.txt eliminados (150 tests) | orank rankeado por `estScoreGain`: los pozos más grandes (**~10 puntos**) son **off-site** |

---

## 10. Contradicciones y correcciones

Esta sección recoge cada lugar donde el skill dice "la hipótesis estaba mal", "esto no era cierto" o se corrige a sí mismo.

1. **La hipótesis del Markdown twin y los tokens estaba MAL.** Creían que servir un twin Markdown de `/developers` ahorraría muchos tokens. Resultado medido: *"**The hypothesis was wrong:** the Markdown twin is used when it is linked, and it helps steps and cost a little, but the tokens of this harness are not dominated by the docs page."* ChatGPT gastó **50,773 tokens antes y 48,952 después (-4%)**; su harness probablemente trae `/developers` sin `Accept: text/markdown` y nunca se entera de `/developers.md`. La corrección normativa: **"Do not promise token savings from a Markdown twin; promise a smaller, cleaner read."** Y la regla de proceso: *"record predictions and check them."*
2. **La página de docs no domina los tokens de ChatGPT; el harness sí.** El twin son ~2k tokens contra ~30k del HTML, y aun así el total no se movió. La brecha 3x contra Claude Code (15-20k vs 50.8k) es **del harness, no de nuestros tamaños de página**. Consecuencia: no atribuir a la página lo que decide el cliente.
3. **Is Agentic: 89 no era un veredicto; era evidencia obsoleta.** *"Re-scanning the same deployed code moved 89 to 100 with no commit: the first report had stale or pre-deploy evidence."* Corrección: **re-escanear siempre antes de actuar sobre un reporte viejo.**
4. **El test del header `Link` era verde y la funcionalidad no existía.** Creían tener el header (definido en `next.config.ts headers()`); la verdad es que **next-intl lo sobrescribía** y producción nunca lo envió. Corrección de método: **testear comportamiento, nunca el texto que se supone lo causa.**
5. **Una mutación con `sed` no cambió nada y el test "pasó".** La verificación por mutación parecía correcta pero el patrón no coincidía (caracteres especiales). Corrección: **usar un script que afirme que el patrón existe antes de reemplazar.**
6. **WebMCP: `navigator` ya no es la API vigente.** El prompt de isitagentready citaba `navigator.modelContext.provideContext()`; el draft W3C vigente es **`document.modelContext.registerTool()`**. Corrección: **leer el spec antes de copiar el consejo de un scanner**; soportar `navigator`/`provideContext` solo como fallback. (Gotchas 24 y SCANNERS.)
7. **El archivo ARD se llama distinto según quién lo mire.** El spec ARD dice `ard.json`; el estándar ai-catalog y los scanners usan **`ai-catalog.json`**. Corrección: usar `ai-catalog.json` y leer el texto vigente.
8. **`GET /api/score/{domain}` puede mentir por antigüedad.** Devolvió el registro de las **05:54 (80/B)** más de una hora después de que el POST ya tuviera el de las **06:56 (86/A)**. Corrección: **leer el estado con el POST** (`maxAgeSeconds=86400`) y **siempre imprimir `scannedAt`**; compararlo con la hora del deploy antes de creer un fallo.
9. **`GET /api/journey/runs/{id}` puede quedarse en `running` para siempre.** El endpoint de registro va con retraso; **la fuente de verdad es el stream SSE**, evento `result`. Corrección incorporada en `ora-journey.py`.
10. **orank cachea más de lo que parece.** Default **6 h** y **nunca menos de 1 h**, incluso con `--rescan`. Corrección: comparar `scannedAt` con el deploy y esperar a pasar la hora antes de concluir.
11. **`X-Forwarded-For` es forjable.** No era una suposición teórica: **se descubrió en producción** en el lote 1. Corrección: último salto + límites por cliente como best effort + **tope global** como cota real; no confiar en `CF-Connecting-IP` sin Cloudflare delante.
12. **Llamar handlers en proceso desde el MCP comparte un solo cupo** (`unknown`) entre todos los clientes. Corrección: reenviar la IP del cliente en la petición interna y probarlo agotando un bucket y viendo que otro pasa.
13. **Minificar el OpenAPI no era la solución.** *"Minifying the JSON only saved 16%; the dedupe saved 23%."* Creían que el tamaño era por formato; era por **bloques de respuesta repetidos**.
14. **Recortar `llms.txt` borrando no era la solución.** Se movió el texto (13.3 KB → 10.7 KB) en vez de eliminarlo; se diffó para probar que solo se fusionaron duplicados. Pero **la meta de 2k tokens no se alcanzó** (quedó en ~2.7k): la expectativa también se corrigió.
15. **El propio `probe.sh` encontró una violación de la propia regla.** `llms.txt` enlazaba `https://site/ask`, que da 400 a un GET sin pregunta. Corrección: **citar POST endpoints como `POST /path`, nunca como URLs**. (Gotcha 29.)
16. **Los POST-only parecen muertos para un link checker** (no era solo el agente: orank también lo marcó). Corrección: `curl -X POST` o quitar el enlace.
17. **Un soft-404 es peor que un 404.** Una URL `$schema` que devolvía 200 HTML por el fallback de SPA fue tratada como un fallo real. Corrección: servir el archivo real o quitar el campo.
18. **Un número animado desde 0 se lee como 0.** No era un problema de percepción humana: un **agente evaluador real** se quejó de "blank case study metrics". Corrección: renderizar el valor final en el HTML de servidor.
19. **`openssl` de macOS no puede hacer Ed25519.** Los docs del registro asumen OpenSSL completo; en Mac es LibreSSL y falla. Corrección: generar con Node `crypto` y verificar el round-trip antes de publicar la clave pública.
20. **La ruta de búsqueda del registro MCP no es `/v0/`.** Usar **`/v0.1/servers?search=`**; la otra ruta hacía parecer que faltaba una entrada.
21. **`MetadataRoute.Robots` no puede emitir `Content-Signal` ni `Agentmap`.** La expectativa era que el generador nativo bastara; la verdad es que hay que usar un route handler construido desde un módulo compartido.
22. **Un `clear()` al llegar a N entradas resetea los topes globales.** La evicción "razonable" era un agujero de seguridad. Corrección: LRU para clientes y mapa pinneado para globales, con test de flood de 6000 claves.
23. **El digest de agent-skills es de bytes crudos, no de contenido lógico.** Cualquier transformación (fin de línea, formato) entre el archivo y la respuesta invalida el digest. Corrección: **digest estático = bytes servidos** y `probe.sh` recalcula contra la respuesta real.
24. **Un `push` no es un `deploy`.** Creían haber desplegado; Coolify necesitaba su propia llamada y producción seguía con el build viejo. Corrección: re-sondear tras cada deploy.
25. **Los limitadores en memoria pueden no ser singleton.** Los Maps a nivel de módulo pueden duplicarse por bundle de ruta; hubo que **probar en producción** con 60 GETs y un 429. Si hay varias instancias o reinicios frecuentes, hay que decirlo y mover el estado.
26. **Guardar un error en idempotencia rompe el propósito de la llave.** La intuición de "guardar todo" era incorrecta: un 400/500 guardado **bloquea el reintento que la llave existe para permitir**.
27. **El rubric propio (AOS/APS) no incluía ninguno de estos estándares.** El skill lo dice explícitamente y la decisión registrada fue **no cambiarlo** hasta que un journey muestre a un agente consumiéndolos; la primera evidencia fue ChatGPT trayendo `ai-catalog` y `status`.
28. **Los manifiestos no se consumen solo porque existan.** Un crawl de tráfico bot real mostraba casi solo **Meta-ExternalAgent y Bytespider**: *"do not assume the manifests are consumed until a journey or a log shows it."* Corrección de expectativa frente a los scanners de presencia.
29. **Un presence score de 100 no implica que un journey sea eficiente.** *"A presence score can reach 100 while a journey still wastes steps. Chase the journey, use the scanners as a checklist filtered by triage."* Los gaps de 0.2 puntos distraen de los de ~10 puntos que son off-site.
30. **La eficiencia de un solo run no es una medida.** Dos runs de Claude Code en el mismo sitio dieron **100% y 60%**. Corrección: comparar medianas de 3+ runs, o comparar **pasos y conteos de 4xx**, no un porcentaje suelto. *"Never present one journey as a benchmark."*
31. **El propio texto de arreglo de los scanners puede estar desactualizado.** isitagentready citaba la API vieja de WebMCP. Corrección general: **leer el spec antes de implementar un draft**, y tratar el texto del scanner como pista, no como verdad.

---

### Anexo: estado exacto de la evidencia

- Fecha de verificación de `RECIPE.md`: **2026-09-25, contra producción.**
- Fecha de verificación de `SCANNERS.md`: **2026-09-25.**
- Sesión del caso: **2026-09-24 a 25**, un día largo de trabajo, cinco lotes de construcción, cuatro scanners, cuatro (y hasta ocho) journeys reales.
- Los números son **mediciones únicas**: los agentes son no deterministas y los scans están cacheados → **leerlos como dirección, no como benchmark.**
- `README.md` declara que los estándares son en su mayoría drafts y los scanners cambian sus checks: **cuando la respuesta en vivo contradiga los archivos, creer a la respuesta en vivo y actualizar el archivo.**
- Commit único del repositorio del skill: `c2f4b8b agent-ready-web: receta, escáneres, trampas, caso de estudio, scripts y plantillas probadas`.
