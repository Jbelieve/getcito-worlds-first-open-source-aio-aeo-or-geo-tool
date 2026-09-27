# Handoff: lo que hay que hacer en BeAOS para que Autex lo consuma

> Para George (o quien trabaje el repo BeAOS, `/Volumes/DEV/Developer/beaos`, rama `feat/aos-aps`).
> Autex va a **consumir** el motor AOS/APS de BeAOS por su MCP: no reimplementa nada. Esta es la lista
> de cambios del lado de BeAOS que la integración necesita, ordenada por dependencia.
> Base verificada: `MCP-BEAOS.md`, `apps/web/src/server/mcp/tools.ts`, `packages/aos-aps/src/`.
> Contexto completo en el repo Autex: `docs/specs/operable/BEAOS-MAPA-Y-CAPACIDADES.md`.
> Fecha: 2026-09-27.

Cada ítem: **Qué** hay que construir, **Por qué** (dependencia de Autex), **Dónde** (archivo), **Aceptación**.

---

## 1. Crear/asegurar entidades desde el MCP  (`ensure_entity`, quizás `ensure_brand`) - BLOQUEANTE

- **Por qué**: Autex da de alta dealers y marcas de forma programática. El modelo de contrato es flexible:
  Autex se contrata a nivel importador (toda la red), grupo de dealers, o un concesionario solo. Cada
  **sitio medible** (brandsite del importador, o dealer x marca) es una `agent_brand_entity`. El MCP hoy
  solo **lee** entidades (`get_brand`); no hay forma de crearlas. Sin esto Autex no puede registrar lo que
  va a medir. Caso Porsche: ~7 brandsites + 30-40 sitios de dealer, todos entidades.
- **Qué**: tool `ensure_entity` idempotente (por `brandId` + `websiteUrl`, o un `external_id` que mande
  Autex) que crea/actualiza un `agent_brand_entity`: `brandId`, `parentEntityId?`, `entityType`
  (umbrella | product), `name`, `websiteUrl`, `maasyProjectId`, `isPrimary`. Devuelve `entityId`.
  Probable acompañante `ensure_brand` para el caso "dealer independiente" que aún no existe como `brand`
  en Getcito (el tenant se ancla en el nivel que contrató).
- **Dónde**: `apps/web/src/server/mcp/tools.ts` (nuevo tool) + la lógica de alta de entidad/brand
  (`agent-assets-core` o donde la UI crea entidades). `db/schema.ts` ya tiene `agentBrandEntities`.
- **Aceptación**: por MCP se crea una entidad bajo un brand; `get_brand` la devuelve con su `entityId`;
  reintentar con los mismos datos no duplica.

## 2. Disparar una medición APS desde el MCP  (`start_aps_run`) - BLOQUEANTE

- **Por qué**: la medición se dispara desde Autex (decisión de George). El MCP hoy **lee** corridas
  (`list_aps_runs`) pero no puede iniciar una. Sin esto Autex solo ve mediciones corridas desde el panel
  de BeAOS.
- **Qué**: tool `start_aps_run(brandId, entityId, models?, repetitions?)` que encola una corrida
  (`status: planned`) con la prompt library activa/lockeada de la entidad y el worker existente
  (`aps-query` -> `aps-parse` -> `aps-score`). Respeta el budget guard (`APS_MAX_*`, política `stop` ->
  `budget_exceeded`). Devuelve `runId` + `status` para que Autex haga polling con `list_aps_runs`. Si la
  entidad no tiene prompt library activa: o la crea (cola `aps-prompt-library`) o falla claro pidiéndola.
- **Dónde**: `tools.ts` + `apps/worker` (las colas ya existen: `aos-audit`, `aps-prompt-library`,
  `aps-query`, `aps-parse`, `aps-score`).
- **Aceptación**: por MCP se dispara un run; `list_aps_runs` lo muestra pasando `planned` -> `done`; quedan
  los scores por modelo.

## 3. Exponer Share of Voice, competidores y dimensiones  (extender `list_aps_runs` o `get_aps_score_detail`)

- **Por qué**: Autex necesita mostrar SoV y el detalle competitivo, no solo el APS de titular. El dato **ya
  se mide** (`preference/measurement.ts`: submetrics `sovPosWeight`, `competitorBreadth`; dimensión
  `autoridad_fuente = (sovPosWeight + competitorBreadth)/2`; `competitorsMentioned` crudo por respuesta),
  pero `list_aps_runs` no lo devuelve (solo `aps, band, p10/p50/p90, recommendationProbability, observations`).
- **Qué**: devolver por modelo las 5 `dimensions`, los `subMetrics` (incl. `sovPosWeight`,
  `competitorBreadth`, `recommendationRate`, `sentimentAvg`) y un agregado de `competitorsMentioned`
  (top marcas + conteo) desde `agent_aps_observations`. Como campos nuevos en `list_aps_runs` o un tool
  `get_aps_score_detail(entityId, runId?)`.
- **Dónde**: `tools.ts` (datos en `agent_aps_scores.dimensions`/`.subMetrics` y
  `agent_aps_observations.competitorsMentioned`).
- **Aceptación**: por MCP se ve el SoV y la lista de competidores de una corrida.

## 4. Token dedicado por producto  (`BEAOS_TOKEN` para Autex) - seguridad

- **Por qué**: hoy todos los productos comparten `ADMIN_API_KEYS`; no hay identidad por producto ni forma
  de revocarle la clave a uno solo. Autex necesita su propia clave (regla de infra: UI/APIs con su
  credencial, revocable).
- **Qué**: identidad por producto (una API key por consumidor, revocable) o, mínimo, una clave separada
  para Autex. La generas y yo la subo a Infisical (`Believe-Infra/prod`) como `BEAOS_TOKEN`. El ops-server
  de Autex la usa **server-side**, nunca en el browser.
- **Dónde**: el middleware de auth del MCP (donde valida `ADMIN_API_KEYS`).
- **Aceptación**: Autex llama el MCP con su propia clave; revocarla no afecta a Maasy/BeAds.

## 5. Confirmar el flujo de Brand DNA para entidades de Autex

- **Por qué**: el bundle se genera del Brand DNA que BeAOS sincroniza de Maasy. Autex creará el proyecto
  Maasy al arrancar el contrato (decisión de George). Hay que confirmar que `generate_agent_assets`
  sincroniza el DNA (`agent_brand_dna_snapshots`) desde el `maasyProjectId` de la entidad **antes** de
  generar, o si el sync es un paso aparte.
- **Qué**: garantizar que setear `maasyProjectId` en la entidad + llamar `generate_agent_assets` produce
  assets con el DNA fresco. Si el sync es aparte, exponerlo (tool `sync_brand_dna` o que `generate` lo haga
  solo).
- **Dónde**: `agent-assets-core`, `packages/aos-aps/src/maasy/client.ts`.
- **Aceptación**: entidad con `maasyProjectId` -> `generate` -> `brand.json` refleja el DNA de ese proyecto.

## 6. Claims (workflow, no bloquea el AOS técnico)

- **Por qué**: el bundle sale con 0 claims hasta que un humano confirma (`agent_brand_claims`; BeAOS no
  inventa claims desde prosa de Maasy). Para dealers de Autex hay que definir **quién** confirma los claims
  y **cuándo** (parte del onboarding).
- **Nota**: el kit AOS se genera igual sin claims; pero el APS declarado y la robustez dependen de claims
  reales. Definir el paso humano en el PRD.

## 7. (Menor) Server-card propio de BeAOS

- Dogfooding ya marcado como deuda en `MCP-BEAOS.md` (BeAOS no publica su propio
  `/.well-known/mcp/server-card.json`). No bloquea a Autex.

---

## Preguntas para ti (afectan el orden del PRD)

1. **Dealer independiente**: ¿el `brand/tenant` de un dealer que contrata solo lo crea Autex por MCP
   (ítem 1, `ensure_brand`), o lo pre-creas en BeAOS?
2. **Prompt library**: ¿la genera BeAOS sola en el primer `start_aps_run` (unaided, lockeada 90 días), o
   prefieres revisarla/aprobarla antes de medir?
3. **Presupuesto APS**: `APS_DAILY_BUDGET_USD` está sin definir en el blueprint. ¿Qué cap ponemos? Define
   cuántas mediciones puede disparar Autex por día.
4. **`start_aps_run` asincrónico**: Autex hace polling con `list_aps_runs` (correr una medición real tarda:
   llamadas a modelos + judge). ¿De acuerdo con ese modelo?

## Lo que hace Autex de su lado (la otra mitad)

- Modelo de contrato (quién contrató y a qué nivel) que deriva el árbol de entidades BeAOS.
- ops-server llama el MCP server-side con `BEAOS_TOKEN`; mapea cada dealer/marca a un `entityId`.
- `generate_agent_assets` en BeAOS -> `get_agent_bundle`/`get_agent_asset` desde Autex -> servir el kit en
  el sitio del dealer vía `worker-l2`.
- `get_aos_audit` + `list_aps_runs` (con el detalle del ítem 3) -> panel de Autex (dealer ve lo suyo,
  importador ve el rollup).
- Al arrancar el contrato: crear el/los proyecto(s) Maasy con Brand DNA (para que BeAOS sincronice).
