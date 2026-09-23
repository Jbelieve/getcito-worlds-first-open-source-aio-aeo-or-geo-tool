# AOS / APS Integration Blueprint

> Estado: Fase 0 — scout + arquitectura.
> Branch: `feat/aos-aps`.
> No tocar producción hasta cerrar PRD.

## Objetivo

Integrar el ecosistema AOS/APS de Believe dentro de BeAOS/Getcito como un port espejo, sin perder:

- scores AOS y APS,
- bandas,
- IDs de requerimiento,
- claims & proofs,
- firma Ed25519 y provenance,
- Operator / Bot Beacon,
- MCP server,
- Brand DNA de Maasy vía MCP,
- generación de assets.

BeAOS aporta lo que Getcito ya tiene: prompts, visibilidad, citas, competidores, worker, reportes, auth y multi-brand.

## Fuentes de verdad

### Repos locales

- `aos-aps-standard/` — spec, scoring, claims, signing, badge.
- `MAASY/extensions-y-mcps/apps/aos-extension/` — extensión Chrome MV3.
- `MAASY/extensions-y-mcps/supabase/functions/aos-*` — auditoría AOS, brand.json, operator, MCP.
- `MAASY/extensions-y-mcps/supabase/functions/aps-*` — pipeline APS Fases 0-6.
- `MAASY/mcp-server/` — cliente MCP de Maasy y contrato del gateway.

### SiYuan

- Notebook `BELIEVE`, ruta `INFRAESTRUCTURA`.
- Extraer notas AOS/APS en Fase 0.

**Estado 2026-09-23:** el contenido está escrito y listo para esa nota, pero **todavía no se cargó en
SiYuan**. El texto es `MANUAL-AOS-APS.md` (manual de usuario, 314 líneas) más la parte de estado, runbook
y gotchas que vive en `AOS-APS-ESTADO.md`.

Por qué no se cargó: desde esta máquina **no se llega a SiYuan**. El kernel no está corriendo (el puerto
6806 no responde) y `~/Library/Application Support/SiYuan` está vacío, así que tampoco hay workspace
local del que sacar el id del cuaderno. Para empujarlo hace falta: SiYuan abierto, el token de API y el
id del cuaderno `BELIEVE` (endpoint `/api/filetree/createDocWithMd`).

### Maasy MCP

- Base: `https://esptwxlgdbblvnmdpoao.supabase.co`.
- Gateway: `/functions/v1/mcp-gateway`.
- Auth: `Authorization: Bearer $MAASY_MCP_TOKEN`.
- Token: `MAASY_MCP_TOKEN` en Infisical `Believe-Infra/prod`.
- Tools: `list_brands`, `get_brand_context`.
- Believe project ID: `fd41b157-f8d5-47a7-8e27-2035b86f8294`.

## Dos capas de LLM

### Capa 1 — Medicion real

Son las superficies que contestan los prompts APS. No se sustituyen.

- ChatGPT: OpenAI API `gpt-5.5`.
- Claude: Anthropic API `claude-sonnet-5` (fallback `claude-sonnet-4-6` si la key no lo habilita) cuando tenga saldo.
- Perplexity: BrightData.

### Capa 2 — Trabajo interno

Va por BeGateway/LiteLLM con DeepSeek Flash 4.1 en bandas.

- `believe-fast`: clasificar, extraer, normalizar.
- `believe-smart`: generar prompts, assets, recomendaciones.
- `believe-deep`: judge APS, razonamiento complejo, scoring.

Temporal: se usa `LLM_GATEWAY_KEY_BEADS` mientras se crea `LLM_GATEWAY_KEY_BEAOS`.
Verificado: `believe-fast`, `believe-smart` y `believe-deep` responden.

Regla: dentro de una ventana de scoring APS, el judge se mantiene en una sola banda/version.

## Arquitectura objetivo

```text
packages/aos-aps/
  src/standard/
  src/audit/
  src/preference/
  src/assets/
  src/provenance/
  src/maasy/
  src/db/
  src/worker/
  src/server/
  src/ui/
```

### Colas nuevas del worker

```text
aos-audit
aps-prompt-library
aps-query
aps-parse
aps-score
aps-robustness
agent-assets
```

### UI

- `/app/$brand/agent-ops`
- `/app/$brand/agent-preference`
- `/app/$brand/agent-assets`
- `/app/$brand/agent-graph`

### API

- `/api/v1/agent-ops/*`
- `/api/v1/agent-preference/*`
- `/api/v1/agent-assets/*`
- `.well-known/brand.json`, `llms.txt`, `agent.json`, MCP card.

## Modelo de entidades (revision post-review)

Decision: `brands.id` sigue siendo la unica identidad de marca/tenant de Getcito. No se crea una segunda nocion de marca. Las rutas `$brand` siguen siendo `brands.id`.

Se agrega una tabla de mapeo/entidad agentica:

```text
agent_brand_entities
  id uuid pk
  brand_id text not null references brands(id) on delete cascade
  parent_entity_id uuid null references agent_brand_entities(id) on delete cascade
  entity_type text not null check (umbrella | product)
  name text not null
  website_url text
  maasy_project_id uuid null
  is_primary boolean default false
  created_at, updated_at
```

Reglas:

- `brand_id` = `brands.id`. Es el eje de permisos, prompts, competidores y worker.
- `parent_entity_id` es solo jerarquia de entidades agenticas, no reemplaza `brands`.
- `maasy_project_id` mapea al proyecto de Maasy. Un `brand` puede tener N entidades/proyectos.
- `$brand` en rutas siempre es `brands.id`; la entidad se selecciona con `?entity=<id>` o ruta anidada.
- AOS/APS se guarda por `agent_brand_entities.id`.
- Rollup por `brand_id` y `parent_entity_id`.

Permisos:

- Acceso a `agent_brand_entities` hereda de `requireOrgAccess(userId, brands.id)`.
- Worker scoping por `brand_id` y `entity_id`.
- Sync Maasy server-side con `MAASY_MCP_TOKEN`, nunca browser.

Caso Believe:

- `brands.id` de Believe en Getcito = marca sombrilla.
- `agent_brand_entities`: Believe umbrella + subproductos.
- Cada subproducto tiene `website_url` y `maasy_project_id` propios.
- Getcito sigue siendo la fuente de verdad de brand/prompts/worker; la tabla agentica solo mapea jerarquia y proyectos Maasy.

## Contratos Maasy MCP

### `list_brands`

Devuelve marcas de Maasy con id, nombre y metadata basica.

### `get_brand_context`

Devuelve:

- brand_name, industry, brief, website_url,
- context_summary,
- dna: tone, ICP, value prop, colores, fonts, visual style, CTAs, prohibitions,
- logo_urls, product_images, references_summary,
- completeness y warnings.

Se sincroniza a BeAOS con `source: maasy-mcp`, `project_id`, `synced_at` y hash del payload.

## Pipeline AOS

1. Encargar `aos-audit`.
2. Resolver URL y aplicar SSRF guard.
3. Probe con render worker o fetch estatico.
4. Correr `aos-standards-check`.
5. Verificar firma si existe.
6. Guardar score, banda, breakdown y evidencia.
7. Mostrar gaps y fixes.

## Pipeline APS

1. `aps-prompt-library` — biblioteca unaided lockeada 90 dias.
2. `aps-query` — prompts x modelos reales x repeticiones.
3. `aps-parse` — judge interno via BeGateway.
4. `aps-score` — 5 dimensiones + Montecarlo.
5. `aps-robustness` — grounding real e inyeccion.
6. Rollup por marca sombrilla.

`capacidad_accion` se alimenta del AOS real.
Getcito alimenta autoridad y reputacion con citas, visibilidad y competidores.

## Provenance y Operator

Se portan y preservan:

- firma Ed25519,
- `keys.json`,
- HMAC del Operator,
- Bot Beacon,
- registro/health del operator,
- MCP server `aos-mcp`.

Claves privadas viven en Infisical. Nunca en cliente.

## Proteccion contra upstream de Getcito

Todo lo nuevo vive en `packages/aos-aps/`.
Parches minimos al upstream:

- agregar grupo en sidebar,
- registrar colas en worker,
- agregar env vars nuevas,
- montar rutas nuevas.

Reglas:

- no renombrar tablas ni columnas existentes,
- no tocar auth de Getcito,
- usar prefijos `aos_`, `aps_`, `agent_`,
- commits chicos y rebaseables,
- cada parche upstream debe poder aplicarse sobre una version nueva con minimo conflicto.

## Budget guard APS

Variables:

```text
APS_MAX_PROMPTS=50
APS_MAX_MODELS=3
APS_MAX_REPETITIONS=3
APS_MAX_CALLS_PER_RUN=450
APS_DAILY_BUDGET_USD=<definir>
APS_BUDGET_POLICY=stop | reduce_repetitions
```

Politica default: `stop`.

- Si el run proyectado excede el cap, se marca `budget_exceeded`.
- No se calcula score parcial como si fuera completo.
- Nunca se degrada la capa de medicion a un LLM barato.
- Opcion permitida: `reduce_repetitions` explicito y visible en el run.

## Versionado de judge y scoring

La capa interna puede cambiar de modelo/banda, pero la serie historica no debe corromperse.

`agent_aps_observations` guarda:

- `judge_model_alias`
- `judge_model_version`
- `judge_pipeline_version`
- `parsed_at`

`agent_aps_scores` guarda:

- `scoring_version`
- `measurement_version`
- `judge_model_alias`
- `judge_model_version`
- `prompt_library_version`

Cada corrida fija estos valores. Un cambio de judge o de algoritmo crea una nueva serie comparable, no una mezcla silenciosa.

## Fases

### Fase 0 - Scout + PRD
Estado: en curso.
Entregable: este blueprint + PRD final.

### Fase 1 - AOS
Auditoria, score, UI, reporte.

### Fase 2 - APS
Prompt library, query engine, parser, score, Montecarlo, robustness.

### Fase 3 - Assets + MCP
brand.json, llms.txt, agent.json, MCP card, badge, firma, sync Maasy.

### Fase 4 - Extensions
Sync de Chrome extension con BeAOS.

### Fase 5 - HPI + Getcito
AOS + APS + GEO + citas en un solo reporte.

## Riesgos residuales

1. Bridge de auth Maasy/BeAOS: se evita consumiendo MCP, pero hay que cuidar rate limits y rotacion del token.
2. Costo de APS: resuelto con budget guard explicito; queda definir el numero de USD del cap.
3. Judge APS: resuelto con `judge_model_alias`, `judge_model_version` y `judge_pipeline_version` persistidos por corrida.
4. Jerarquia de marcas: resuelta con `agent_brand_entities.brand_id -> brands.id`; `brands.id` es la unica identidad y la seguridad hereda de `organization`.
5. Assets publicos: decidir si se sirven desde BeAOS o se publican en el sitio del cliente.

## Credenciales necesarias

- `MAASY_MCP_TOKEN` (ya verificado).
- `LLM_GATEWAY_URL` (ya verificado).
- `LLM_GATEWAY_KEY_BEADS` temporal mientras se crea la dedicada.
- `LLM_GATEWAY_KEY_BEAOS` dedicada (pendiente).
- `ANTHROPIC_MEASUREMENT_MODEL=claude-sonnet-5` (fallback `claude-sonnet-4-6`).
- Llaves de medicion: OpenAI, Anthropic, BrightData (ya configuradas).
- Private key Ed25519 y HMAC del Operator en Infisical (pendiente de portar/verificar).

---

Documento generado en Fase 0 para review de Jorge y Claude.
