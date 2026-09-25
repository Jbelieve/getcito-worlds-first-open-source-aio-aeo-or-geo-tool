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

## 7. Autocrítica: tres cosas que este análisis destapó de nosotros

1. **Fallamos nuestro propio check.** `web-bot-auth-directory` (`/.well-known/http-message-signatures-directory`)
   es **nuestro APS-PROV-03**, y `believe-global.com` no lo tiene. Predicamos algo que no practicamos.
2. **Nuestro `llms.txt` tiene links muertos**: 2 de 4 apuntan a `.../functions/v1/aos-mcp?sit…` y no
   resuelven. Un archivo que existe para que los agentes nos lean, con links rotos.
3. **`brand-search-accuracy` falla por la colisión de marca**: buscar "Believe" devuelve 8 resultados y
   **ninguno es nuestro dominio**. Es el mismo problema que encontramos con el prompt de desambiguación y
   ScamAdviser, confirmado por un tercero independiente. Y `wikipedia-presence` falla con la misma raíz:
   **sin fuentes independientes, ningún agente puede verificarnos.**

## 8. Plan propuesto

1. **Cerrar las brechas de nuestra propia casa** (barato, y es la mejor demostración del producto):
   `serverUrl` en el server card, los links rotos del `llms.txt`, `/.well-known/http-message-signatures-directory`,
   `llms.txt` + 404 para agentes en BeAOS, `text/markdown` en la misma URL.
2. **`estScoreGain` en nuestro reporte AOS** + re-verificación de un check suelto. Cambia el reporte de
   "lista de fallas" a "plan priorizado" con poco trabajo.
3. **El cluster `ax-*` como diagnósticos** (empezando por `ax-tree-injection-safe`, que además es
   seguridad) + metadata de catálogo (`maturity`, `tier`, `specUrl`, `recommendation`) en los 18 ids.
4. **CLI + página pública por dominio** (canal y motor de crecimiento).
5. **La correlación AOS × APS** con los datos que ya tenemos: es la afirmación que ellos no pueden hacer.

**Pendiente de decisión de Jorge:** si vamos por AOS v2 (OR-scoring + pesos derivados) o mantenemos la
paridad con Maasy y crecemos solo por diagnósticos.
