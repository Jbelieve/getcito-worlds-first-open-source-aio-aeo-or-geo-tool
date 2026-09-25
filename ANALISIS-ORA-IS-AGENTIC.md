# Análisis competitivo — ora.ai / is-agentic.com

> Fecha: 2026-09-23. Fuentes consultadas: `https://ora.ai/methodology`, `https://ora.ai/llms.txt`,
> `https://ora.ai/api/checks`, `https://ora.ai/api/score/believe-global.com`, `https://is-agentic.com/`.
> Todos los datos de este documento salen de esas respuestas, no de una estimación.

## 1. Qué son, y por qué importan

**ora** (era labs) se presenta como *"the standard for agent experience"*. **is-agentic.com** es su
producto público: un score 0–100 de "qué tan agéntico es tu sitio", **respaldado por Vercel** ("Made with
love by Vercel", "Every scan is run by Ora").

Traducido: **es un competidor directo de nuestro AOS**, con más superficie, más distribución y una
narrativa más fuerte. Lo que nosotros llamamos AOS (Agent Operability Score) ellos lo llaman "agent
experience" y lo empujan como *estándar*, con leaderboard, directorio, API pública, MCP server, skills
para agentes de código y un CLI.

También es una **validación**: el estándar que venimos construyendo (spec.json, claims/proofs, assets
firmados, `/.well-known/*`, legibilidad para agentes) va en la misma dirección. Varios de nuestros checks
existen en su catálogo, con otro nombre.

## 2. Su modelo de scoring — lo que hacen distinto

`GET https://ora.ai/api/checks` devuelve **el catálogo completo, versionado** (`contractVersion: 1.25.0`).

**Cuatro capas con peso fijo:** Discovery 20 · Access 30 · **Usability 40** · Payments 10.

**125 checks**, cada uno con metadata rica:

| Dimensión | Cómo se distribuye |
|---|---|
| Capas | discovery 15 · accessibility 42 · usability 62 · payments 6 |
| `tier` (visual) | required 29 · recommended 76 · emerging 20 |
| `maturity` (**decide si puntúa**) | verified 105 · emerging 20 |
| `bonus` | 55 checks que **suman pero nunca restan** |
| `applicability` | domain-only 81 · api 16 · mcp 14 · all 10 · mcp-app 4 |

Y cada check trae `id`, `name`, `description`, `maxScore`, `tier`, `maturity`, `bonus`, `appliesTo`,
`draft`, `beta`, `specUrl` y **`recommendation`** (el arreglo concreto, copiable).

### Las cinco decisiones de diseño que valen oro

1. **`maturity` decide, `tier` solo muestra.** "Verified checks (behaviours we have empirically confirmed
   agents rely on) count toward the score, while emerging checks are **shown but excluded until adoption
   proves them out**." El tier es cosmético; lo que puntúa es la madurez.
2. **Bonus nunca resta.** 55 de 125 checks son upside-only: "emerging formats can earn limited bonus
   credit, but **their absence never lowers a score**."
3. **Exclusión del denominador.** "Checks that do not apply, and bonus checks that are not earned, are
   **excluded from the denominator**, so a product is never punished for what it does not need." En el
   scan de `believe-global.com`: **30 de 125 checks quedaron N/A**, y la capa Payments entera puntuó
   `0/0` porque el sitio no vende.
4. **OR-scoring para protocolos alternativos.** Los cinco protocolos de pago (x402, MPP, ACP, UCP, AP2)
   se puntúan en OR: "supporting any one is sufficient and the rest are marked N/A rather than counted as
   failures". Lo mismo con interfaces de máquina.
5. **Pesos revisados con auditoría y fecha, y lo dicen.** Ejemplos textuales del catálogo:
   *"Weighted at 1 point while ecosystem adoption is early (2026-08 audit; was 3)"*,
   *"was 6, requiring 2 types"*. **Re-weightear es un acto documentado, no un ajuste silencioso.**

### Y algo que es producto, no rubric

Cada check que falla trae **`estScoreGain`**: los puntos que ganarías si lo arreglás. El reporte se
ordena por eso. Es una lista de tareas priorizada por impacto, no una lista de fallas.

## 3. Cómo puntúa nuestro propio sitio (los datos)

`GET https://ora.ai/api/score/believe-global.com` → **59/100 · grado C** · `scannedAt 2026-09-25T02:17:42`
· 12.2 segundos · resumen suyo: *"offers good access and usability, but lacks a developer portal."*

| Capa | Score | pass | fail | warn | n/a |
|---|---|---|---|---|---|
| Discovery | **3/11** | 3 | 7 | 1 | 4 |
| Access | 48/64 | 25 | 16 | 0 | 1 |
| Usability | 52/82 | 19 | 20 | 4 | 19 |
| Payments | 0/0 | 0 | 0 | 0 | 6 |
| **Total** | **59/100** | 47 | 43 | 5 | 30 |

⚠️ **Frescura:** la página humana `https://ora.ai/score/believe-global.com` mostraba **88** mientras la
API devolvía **59** con un escaneo más nuevo. Dos snapshots distintos del mismo dominio. Es exactamente
el problema que documentan como propio (mantener el último resultado completo y refrescar en background)
— y nos pasa a nosotros también con el caché de 6 días de Opportunities.

### Las brechas, ordenadas por ganancia estimada (`estScoreGain`)

| +pts | Check | Qué dice el detalle |
|---|---|---|
| **+6.1** | `brand-search-accuracy` | *"«Believe» search returned 8 results but domain did not appear"* |
| **+4.3** | `wikipedia-presence` | Sin artículo ni entidad Wikidata. *"Wikipedia es la mayor fuente de citas en respuestas de IA (~48% de las citas de ChatGPT)"* |
| **+4.0** | `agentic-search-specific` | Los recursos de developer no aparecen en búsquedas por nombre |
| **+3.1** | `developer-portal` | No hay portal de developer |
| **+2.7** | `webmcp` | Sin soporte WebMCP (`document.modelContext`) |
| **+2.5** | `chatgpt-app-listed` | No está en el directorio de apps de ChatGPT (bonus) |
| **+2.2** | `json-error-responses` | La API no devuelve errores en JSON |
| **+2.2** | `public-api` | `openapi.json` existe pero sin superficie verificable (warning 3/7) |
| **+2.0** | `mcp-registry-listed` | Sin entrada verificada en Smithery / mcp.so |
| **+2.0** | `ard-catalog` | Sin `/.well-known/ard.json` |
| **+1.6** | `idempotency-key-support`, `api-versioning-policy`, `rest-sdk-packages`, `public-api-docs`, `agent-instruction` | |
| **+1.0** | `llms-txt-links-resolve` | **"2 de 4 links probados de llms.txt no resuelven"** → apunta a `.../functions/v1/aos-mcp?sit…` |
| **+0.2** | `mcp-server-card` | **El server card EXISTE pero le falta `serverUrl`** |
| +0 | `web-bot-auth-directory` | Falta `/.well-known/http-message-signatures-directory` ← **es nuestro propio APS-PROV-03** |

**Lo que ya pasa bien** (y conviene saber): `agent-friendly-404` (*"el contrato de 404 más fuerte"*),
`content-no-js` (25.148 chars, 1 H1 + 27 H2 + 28 H3), `robots-ai-policy-quality` (12/12 training,
18/18 search), y **todo el cluster `ax-*`**: estructura de documento, controles nativos (92/92),
nombres accesibles (92/92), labels de formularios (3/3) y **`ax-tree-injection-safe`**.

## 4. Las diez cosas que deberíamos copiar (priorizadas)

### Ahora — barato y de impacto inmediato

1. **Ordenar "lo que falta" por ganancia estimada.** Nosotros ordenamos por fuerza (MUST/SHOULD/MAY).
   Ellos calculan `estScoreGain` por check y ordenan por eso. Es la diferencia entre una lista de fallas y
   un plan.
2. **Re-verificar UN check sin repetir la auditoría completa** (`POST /api/scan/checks` con `checkIds`).
   Hoy, arreglar `DISC-03` obliga a correr todo el AOS. Nuestro `aos-audit` puede aceptar un filtro.
3. **404 para agentes.** El 404 de ora dice: *"If you are an AI agent or LLM: this URL does not exist.
   Visit /llms.txt for the full list of valid endpoints"*. Nosotros ya lo tenemos en
   `believe-global.com` (pasa el check) — falta en BeAOS.
4. **`llms.txt` propio de BeAOS** + `/llms-full.txt` + `/agents.md` + `/skill.md`, y **verificar que los
   links resuelvan** (nuestro propio `llms.txt` de la marca tiene 2 de 4 roto).
5. **CLI como canal**: `npx ax@0.7 audit <url> --min-score` para CI, y `--tunnel-cmd` para auditar
   localhost. Nuestro equivalente sería `npx beaos audit <url> --min-score`. Tenemos el motor y la API; es
   empaquetado. Su CTA principal en la home **es el comando `npx`**.
6. **Página pública y estable por dominio** (`/score/<domain>`, `/scan/<domain>`) + leaderboard +
   "recent scores" que rota. Es TODO su motor de crecimiento: cada scan es una página indexable que
   enlaza de vuelta. Nuestro gate de publicación es para los assets del cliente; para nuestros propios
   reportes públicos es otra cosa.

### Producto — lo que cambia la conversación

7. **La "journey" observada como evidencia, no como score.** *"Each report also includes an observed
   agent journey showing how one agent navigated the site and where it encountered friction. That run is
   supporting evidence rather than part of the numeric score, because **one task cannot represent every
   agent**."* Es la misma disciplina que ya aplicamos ("un modelo no representa a todos", "nunca mezclar
   denominadores"). Nuestra infra (pg-boss, captura con techos y carriles) ya lo soporta.
8. **El reporte como interfaz de máquina**: HTML inicial sin JS, **`text/markdown` en la misma URL
   canónica** con `Vary`, JSON API aparte, y **MCP server que expone el reporte como tool read-only** con
   input schema declarado, sin credencial y **sin iniciar un scan**. Nosotros exigimos `text/markdown`
   (AOS-CONT-03) pero no lo practicamos en BeAOS.
9. **`maturity` + `tier` + `bonus` en nuestro catálogo.** Nuestros 7 checks de diagnóstico ya existen;
   darles `maturity`, `tier`, `specUrl`, `recommendation` y `appliesTo` los convierte en un catálogo
   versionado en vez de "7 fallas extra". Es además el camino natural a un AOS v2.
10. **El cluster `ax-*` (accesibilidad = usabilidad para agentes).** Los agentes navegan por el árbol de
    accesibilidad: landmarks, orden de headings, controles nativos, nombres accesibles, labels. Nosotros
    no tenemos **nada** de esto, y es literalmente operabilidad. Incluye
    **`ax-tree-injection-safe`**: instrucciones escondidas en `aria-label`, `alt` o contenido off-screen
    — el ángulo de seguridad que le falta a nuestro estándar (y que conecta con el trabajo de injection
    que acabamos de hacer en la cuarentena de APS).

## 5. Lo que NO hay que copiar

- **La amplitud por la amplitud.** 62 checks de Usability incluyen `graphql-batch-mutations`,
  `mcp-view-csp`, `idempotency-key-support`. Eso es para plataformas de developer. Nuestra posición es
  marketing y legibilidad de marca: copiar el catálogo nos volvería irrelevantes para un CMO.
- **La promesa de "el estándar".** Ellos pueden decirlo con Vercel atrás. Nuestro activo es distinto.
- **Su scoring es observacional y estático**: mira lo que el sitio *expone*. Nuestro APS **mide lo que los
  modelos realmente hacen**, con varianza y bootstrap. Eso no lo tienen: su acercamiento es
  `agentic-search-usecase` (share of voice, en beta, N/A en nuestro scan) y la journey.

**La jugada que ellos no pueden hacer y nosotros sí:** correlacionar el AOS con el APS y derivar los
pesos **de los datos**, no del criterio. Ya tenemos el material: `believe-global.com` tiene **AOS 100 y
APS 34–40**. "Operable pero no preferido" es un titular publicable y es, exactamente, el tipo de
afirmación que su metodología dice perseguir (*"We don't guess these checks. We measure them"*) pero que
solo nosotros podemos sostener con números propios.

## 6. El choque con la paridad de Maasy

Nuestra regla dura dice: **el rubric puntuado son los 11 ids de Maasy; agregar uno cambia todos los
scores.** Adoptar las ideas de arriba choca con eso, y la salida no es romperlo en silencio:

| Idea | Cómo entra sin romper la paridad |
|---|---|
| `ax-*`, 404 para agentes, `text/markdown`, `llms.txt` más fino | A `EXTENDED_REQUIREMENTS` (diagnóstico). **Ya tenemos el mecanismo.** |
| `maturity`/`tier`/`bonus`/`specUrl`/`recommendation` | Metadata del catálogo, para los 18 ids. No cambia puntajes. |
| OR-scoring (MCP **o** OpenAPI **o** /ask alcanza) | **Sí cambia el número.** Es AOS v2, con migración documentada y decisión explícita. |
| Capa Payments | Emergente/diagnóstico hasta que haya señales de comercio. |
| Pesos derivados del APS | AOS v2. Requiere N corridas para tener muestra. |

## 7. Lo que esto dice de BeAOS (el producto), no del sitio

Jorge está ajustando `believe-global.com` por su lado. Lo que importa acá es qué le falta **a la
plataforma**, y el hallazgo es incómodo y muy concreto:

### 7.1 Su checklist es una especificación de lo que nuestro generador de assets debería emitir

Verificado contra `packages/aos-aps/src/assets/generate.ts` (lo que **emitimos**) y contra
`packages/aos-aps/src/aos/requirements.ts` (lo que **puntuamos**):

**Emitimos 7 archivos:** `/llms.txt`, `/AGENTS.md`, `/robots.txt`, `/sitemap.xml`,
`/.well-known/agent-card.json`, `/.well-known/agent-permissions.json`, `/.well-known/brand.json`
(+ `.sig` y `keys.json` cuando está firmado).

| Artefacto | Su rubric | Nuestra rubric | ¿Lo emitimos? |
|---|---|---|---|
| `/llms.txt` | 1pt | **AOS-DISC-01** (SHOULD) | ✅ |
| `/AGENTS.md` | — | **AOS-DISC-03** | ✅ |
| `/robots.txt` + `/sitemap.xml` | 2pt + 1pt | **AOS-DISC-04** | ✅ |
| `/.well-known/agent-card.json` (A2A) | 2pt (bonus) | **AOS-IDEN-01** | ✅ |
| `/.well-known/agent-permissions.json` | — | **AOS-IDEN-02** | ✅ |
| **`/llms-full.txt`** | — | **AOS-DISC-02** (MAY, **puntuado**) | 🔴 **NO — generamos todo menos esto** |
| `/.well-known/mcp/server-card.json` (con `serverUrl`) | 2pt (bonus) | **AOS-CAPA-01** (declarar MCP) | 🔴 **NO** — pendiente conocido; su rubric además exige `serverUrl`, que es justo lo que le falta al de la marca |
| `/.well-known/http-message-signatures-directory` | 2pt (bonus) | **APS-PROV-03** (puntuado) | 🔴 **NO** — exigimos un artefacto que no producimos |
| `.md` gemelos + `text/markdown` en la misma URL | 2pt | **AOS-CONT-03** (puntuado) | 🔴 **NO** — exigimos el comportamiento pero no publicamos la versión `.md` |
| `/.well-known/agent-skills/index.json` | 2pt | — | No |
| `/.well-known/ard.json` (ARD) | 1pt | — | No |
| `/pricing.md`, manual legible por máquina | 2pt | — | No |
| 404 para agentes (con body markdown) | 2pt | — | No |
| Headers `Link:` (RFC 8288) | 1pt (bonus) | — | No |

**El hallazgo incómodo, y el más accionable de todo el análisis:** `AOS-DISC-02` (`/llms-full.txt`) es
un requerimiento **puntuado** de nuestro propio rubric, nuestro auditor **lo busca**, y **nuestro
generador de assets no lo produce**. Un cliente que genera y publica con BeAOS **sigue fallando un check
nuestro**. Igual con `APS-PROV-03` y `AOS-CONT-03`.

**La lección de producto:** no hay que inventar qué publicar. La vara del mercado subió y es explícita
(con peso y con recomendación por check), y **nuestra propia rubric coincide en la mitad de la lista**.
La otra mitad es trabajo acotado y ya está priorizada por dos fuentes independientes: la competencia y
nosotros mismos.

### 7.2 Nuestro reporte comunica menos de lo que sabe

El AOS ya calcula muchísimo (los 18 ids, los archivos de descubrimiento que encontró, si hay MCP u
OpenAPI, los tipos de JSON-LD, la verificación de firma) y el reporte muestra **✓/✕ + id + título**. La
competencia muestra, por check: **la evidencia observada** (*"92 controles nativos, 0 div-soup"*,
*"2 de 4 links probados no resuelven: <url>"*, *"25.148 chars, 1 H1 + 27 H2 + 28 H3"*) y **los puntos
que ganás si lo arreglás**. Nosotros tenemos el dato y no lo mostramos, ni lo ordenamos por impacto.

### 7.3 Lo que ya hacemos mejor, y hay que defender

- **Medimos comportamiento, no exposición.** El APS corre modelos reales, con repeticiones, bootstrap y
  banda P10–P90. Su acercamiento equivalente (`agentic-search-usecase`) está **en beta y N/A** en nuestro
  scan. La frase *"AOS 100 con APS 34–40"* es nuestra y no la pueden hacer.
- **Assets firmados con gate de publicación.** Ellos puntúan carpetas y archivos; nosotros firmamos
  Ed25519 y no servimos nada hasta que el operador publica.
- **Disciplina de N/A y de medición parcial.** Es la misma que ellos predican, pero ya la tenemos
  implementada y probada.

## 8. Backlog para BeAOS (propuesto, sin el sitio — eso lo lleva Jorge)

### Paquete 1 — El reporte que compite (contenido, sin riesgo de puntaje)

1. **Evidencia por check.** Mostrar lo que el audit ya observó: qué archivos de descubrimiento encontró,
   por qué vía detectó MCP/OpenAPI, qué tipos de JSON-LD vio, estado de la firma. Convierte el checklist
   en algo verificable en vez de una lista de tildes.
2. **`estScoreGain` y orden por impacto.** Con nuestros pesos (MUST 3 / SHOULD 2 / MAY 1) es calculable:
   puntos del check / puntos aplicables × 100. "Lo que falta" pasa de lista a plan.
3. **Re-verificar un check suelto.** `aos-audit` acepta un filtro de ids: arreglás `DISC-03` y
   verificás eso, sin repetir la auditoría entera.

### Paquete 2 — El generador de assets a la altura del mercado

4. **Cerrar la brecha entre lo que puntuamos y lo que generamos.** En orden:
   **(a) `/llms-full.txt`** — nuestro propio `AOS-DISC-02` puntuado, que el auditor busca y el generador
   no produce; es el arreglo más barato y más vergonzoso de todos.
   **(b) `/.well-known/mcp/server-card.json` con `serverUrl`** — nos falta y además su rubric lo exige
   completo (el de la marca ya existe pero sin `serverUrl`).
   **(c) `/.well-known/http-message-signatures-directory`** — es nuestro `APS-PROV-03`, puntuado.
   **(d) `.md` gemelos + `text/markdown` en la misma URL** — nuestro `AOS-CONT-03` puntuado.
5. **Validar los links del `llms.txt` al generarlo** — que no vuelva a salir un archivo con links muertos.
6. 404 para agentes en las superficies que servimos.

### Paquete 3 — La plataforma consumible por agentes

7. **Exponer el catálogo** (los 18 ids con `tier`, `maturity`, `specUrl`, `recommendation`, `appliesTo`)
   como API y en la superficie pública. Es nuestra propia tesis aplicada a nosotros.
8. **El reporte como interfaz de máquina**: `text/markdown` en la misma URL canónica con `Vary`, JSON
   API, y un tool MCP read-only que **no dispare un scan**.
9. **CLI** (`npx beaos audit <url> --min-score`) + contrato de CI (`?format=audit`, `maxAgeSeconds`,
   `force`) para que AOS sea un gate de CI del cliente.
10. **Página pública estable por entidad** + leaderboard. Motor de crecimiento.

### Paquete 4 — Ampliar lo que detectamos (diagnósticos, sin tocar la paridad)

11. **Cluster `ax-*`**: estructura de documento, controles nativos, nombres accesibles, labels, y
    **`ax-tree-injection-safe`** (instrucciones escondidas en `aria-label`/`alt`). Es operabilidad real y
    además seguridad; conecta con la cuarentena de APS.
12. **Crédito parcial** donde tiene sentido (por ejemplo 404: estado correcto = parcial, con body
    markdown = total). Primero como diagnóstico.
13. **Metadata de catálogo** (`tier`/`maturity`/`bonus`/`specUrl`) en los 18 ids del spec.

### La decisión de fondo (sigue abierta)

**AOS v2 con OR-scoring y pesos derivados del APS** rompe la paridad con Maasy, y es la única forma de
que dos interfaces equivalentes (MCP **o** OpenAPI **o** `/ask`) no se cuenten como tres fallas. Requiere
decisión explícita y migración documentada; hasta entonces, todo entra como diagnóstico.

**Recomendación de orden:** Paquete 1 (el reporte compite, y sale con datos que ya tenemos) → Paquete 2
(los tres artefactos que ya eran pendientes) → Paquete 3. El Paquete 4 suma detección pero no cambia la
percepción del producto.
