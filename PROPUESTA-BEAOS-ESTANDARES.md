# La web de Believe está al máximo. BeAOS no.

Medición de hoy (2026-09-25) contra el skill `agent-ready-web`, más lo que propongo.
Los aprendizajes completos están en `AGENT-READY-WEB-APRENDIZAJES.md` (930 líneas).

---

## 1. Lo que medí hoy, con las herramientas de terceros

| Medición | Resultado | Antes (caso de estudio) |
|---|---|---|
| **Sonda de comportamiento** (`probe.sh`, 50 chequeos) | **50 pasan / 0 fallan** | — |
| **orank** (ora.ai) | **86/100 · grado A** · Discovery 9/16 · Access **67/67** · Usability 85/93 · Payments 0/0 | 80/100 · grado B |
| **Journey real** (Claude Code, intención "integrar") | **3 pasos · 46,8 s · $0,0655 · 10.907 tokens · eficiencia 100% · 0 errores · 0% de memoria · `succeeded_natively`** | 10 pasos · 85,3 s · $0,1201 · 34.654 tokens · 80% · 1 fetch fallido · 1 URL adivinada |

De 10 pasos a 3. De 34.654 tokens a 10.907 (−69%). De un fetch fallido a cero. De escribir la respuesta de
memoria a escribirla de la web. **Aguantó.**

Lo verificado en vivo: host canónico con 308, los cinco `Link` headers, los twins Markdown (`/developers.md`
son 7.974 bytes contra 119.965 del HTML: **15 veces menos**), `llms.txt` como índice corto con bloque
"Start here" y los **37 enlaces responden 2xx**, `/AGENTS.md` en mayúscula servido y el minúscula **no**,
`robots.txt` con Content-Signal + Agentmap + Sitemap + `Allow: /api/v1/`, api-catalog, ai-catalog con
`trustManifest`, agent-skills con digest, server-card con `serverUrl`, `mcp.json`, `agent-card.json`,
`security.txt`, OpenAPI 3.x con `Idempotency-Key` y `x-api-lifecycle`, `/api/v1/status` con las cuatro
familias `RateLimit-*` y `API-Version`, 404 JSON con código y pista, MCP con `tools/list` y anotaciones, y
WebMCP en el HTML.

## 2. Lo que queda: 14,7 puntos, y son todos de fuera del código

orank rankea cada fallo por puntos. El reparto de hoy:

```
CODE     0,0 puntos   ← no queda nada que construir
OFFSITE 14,7 puntos   ← necesita tu cuenta, tu nombre o el mundo exterior
DECLINE  2,8 puntos   ← se declinó a propósito (ver abajo)
```

| Puntos | Qué | Qué hace falta |
|---|---|---|
| 4,2 | `brand-search-accuracy` — buscar "Believe" no devuelve el dominio | Ser encontrable por el nombre de marca |
| 2,8 | `agentic-search-specific` | Que la búsqueda por nombre encuentre los recursos de desarrollador |
| 1,9 | `wikipedia-presence` | Wikidata con **P856** y después Wikipedia con prensa independiente |
| 1,4 | `rest-sdk-packages` | Publicar el SDK |
| 1,4 | `mcp-registry-listed` | Publicar la entrada del registro MCP con verificación de dominio |
| 1,4 | `npm-sdk-package` | Publicar en npm |
| 1,1 | `chatgpt-app-listed` | Directorio de apps de ChatGPT |
| 0,5 | `cli-tool` | Publicar el CLI (ya está escrito y probado) |

**El SDK, el CLI y la entrada del registro ya están construidos y probados** según el caso de estudio: están
esperando que los publiques. Son los puntos más baratos que vas a conseguir nunca, y no dependen de código.

Los 2,8 puntos declinados son correctos y hay que dejarlos: OAuth discovery, `auth.md` y
`oauth-protected-resource` pedirían **aparentar** una autenticación que la API no tiene, y el skill es
explícito en que una superficie abierta declara `security: []` y no publica metadata de OAuth. Son puntos que
se compran mintiendo.

## 3. Lo incómodo: la web está al máximo y nuestro producto está lejos

La web de Believe pasó los 50 chequeos. **BeAOS genera 12 archivos y puntúa 11 requisitos, y casi nada de
esto está entre ellos.**

| Superficie que la web ya tiene | ¿BeAOS la genera o la mide? |
|---|---|
| `llms.txt` con "Start here" y "When to use" | Sí, pero **sin las dos secciones** |
| `/AGENTS.md` (mayúscula) | Sí |
| `robots.txt` con **Content-Signal** y **Agentmap** | **No** — generamos robots sin ninguna de las dos |
| `/.well-known/api-catalog` (RFC 9727) | **No** |
| `/.well-known/ai-catalog.json` (ARD) con `trustManifest` | **No** |
| `/.well-known/agent-skills/index.json` con digest | **No** |
| `/.well-known/security.txt` | **No** |
| Twin Markdown por `Accept: text/markdown` + 404 en Markdown | **No** (sí `llms-full.txt`, que es otra cosa) |
| Los cinco `Link` headers en el home | **No** |
| `/api/v1` con `RateLimit-*`, `Retry-After`, `Idempotency-Key`, `API-Version`, `Deprecation`/`Sunset` | **No** |
| Modelo de error JSON con `code` y pista | **No** |
| WebMCP (inline + formulario declarativo) | **No** |
| Firma de la evidencia | Sí (Ed25519) |

Y el propio caso de estudio deja anotada la razón, en la decisión 27 de las contradicciones:

> **"El rubric propio (AOS/APS) no incluía ninguno de estos estándares."** La decisión registrada fue **no
> cambiarlo** hasta que un journey mostrara a un agente consumiéndolos.

**Esa condición ya se cumplió.** Los journeys de anoche muestran a ChatGPT trayendo `ai-catalog` y
`/api/v1/status`, y al agente final navegando por `agent-skills`. La razón para no tocar el rubric expiró.

## 4. Lo que opino

**1. Lo de anoche está bien hecho y está bien medido.** No es una opinión: 50/50 en la sonda, cero errores en
el journey, y el skill se corrige a sí mismo 31 veces, incluida una hipótesis propia que resultó falsa (el
twin Markdown **no** ahorra tokens: 50.773 → 48.952, −4%). Un documento que se desmiente a sí mismo es un
documento en el que se puede confiar.

**2. El techo del código ya se tocó.** Cero puntos CODE. Todo lo que queda en la web es off-site. Seguir
"optimizando la web" ya no da puntos: da la ilusión de trabajo.

**3. El valor no está en la web: está en convertir esto en el producto.** Tenés la receta probada, con
números, y el producto que debería ejecutarla para cada marca va por la mitad. **La web de Believe es el
escaparate; BeAOS debería ser la fábrica.**

**4. Dos cosas que no hay que romper al hacerlo:**
- **La paridad con Maasy.** El AOS tiene que seguir dando el mismo número que Maasy, y Maasy no incluye estos
  estándares. Por eso los de terceros **no** pueden entrar en los 11 puntuados: van aparte, como medición.
- **La honestidad de la superficie.** Las declinaciones de orank están bien y son parte del valor: vender
  "agent-ready" no es aparentar OAuth.

## 5. Lo que propongo, en orden

### P1 · Medir a terceros dentro de BeAOS (lo que pediste, y lo más barato)
Un panel nuevo al lado del AOS que muestre **orank, isitagentready y el journey real**, con el triage por
`estScoreGain` ya clasificado en **CODE / OFFSITE / DECLINE**. Hoy BeAOS solo se cree a sí mismo; los
scanners son el juez externo y el skill demuestra que ahí están los puntos que importan (los de ~10, no los
de 0,2). *No toca el AOS: es medición, no puntaje.*

### P2 · Que el generador emita lo que la web ya tiene
Cada superficie que falta es un archivo o una cabecera. En orden de valor: **Content-Signal + Agentmap** en
`robots.txt` (es una línea y hoy no está), **api-catalog**, **ai-catalog con trustManifest**,
**agent-skills con digest**, **security.txt**, **twins Markdown con su 404**, y la receta de los **`Link`
headers**. Después, el contrato de `/api/v1` (límites, idempotencia, versionado) que es más trabajo pero es
el que hace que una API sea operable de verdad.

### P3 · Los estándares entran al AOS como diagnósticos, nunca como puntaje
Las ~23 superficies se suman a `EXTENDED_REQUIREMENTS`, que **nunca mueve el número**. BeAOS reporta
"tenés 12 de 23" sin romper la paridad con Maasy. Cuando quieras decidir el AOS v2, ese es el material.

### P4 · Verificar, no afirmar
`probe.sh` ya es un verificador de comportamiento de 50 chequeos. BeAOS debería correr eso como paso
**antes/después** de cada entrega, para que el cliente vea qué cambió de verdad y no un "listo" nuestro.

### P5 · Los puntos off-site, que son tuyos
- Publicar **npm + el CLI + la entrada del registro MCP** (ya construidos y probados).
- **Wikidata (P856)** y después Wikipedia con prensa independiente.
- **Search Console** con el sitemap.
- Y del lado de BeAOS: **publicar nuestro propio `/.well-known`**, que sigue pendiente desde hace días.

### P6 · Lo que viene, que hoy vale 0 puntos
orank ya lista como "emerging": `pricing.md`, `?mode=agent`, fallback Markdown en las páginas de contenido
(hoy 3 de 3 fallan), `schemamap:` en robots, y **NLWeb** (`/ask` conforme y con streaming). Valen **cero**
hoy, y es exactamente donde va el espacio. No los construiría por puntos: los construiría porque el
`/ask` de Believe ya existe y hacerlo NLWeb-conforme es la diferencia entre un endpoint propio y un estándar.

---

## 6. La frase

**La web ya está al máximo de lo que el código puede dar: cero puntos pendientes por construir.** Lo que
falta son cuentas y publicaciones tuyas. Y el trabajo de verdad es llevar todo esto a BeAOS, que hoy genera
la mitad de lo que su propia web demuestra.
