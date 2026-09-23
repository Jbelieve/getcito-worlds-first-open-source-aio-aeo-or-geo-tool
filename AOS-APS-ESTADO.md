# BeAOS — estado de AOS/APS, runbook y pendientes

> Documento de traspaso. Existe para que cualquier sesión nueva (o cualquier persona) retome el
> trabajo **leyendo el repo**, sin depender del contexto de un chat.
>
> Última actualización: 2026-09-23 · `master` = `8251e92` · desplegado en `beaos.believe-global.com`.

---

## 1. Qué es esto

BeAOS es la instancia self-hosted de GetCito para Believe. Sobre ese fork se integró el ecosistema
**AOS/APS** en un paquete propio, `packages/aos-aps/`, para no tocar el upstream más de lo necesario
(ver `AOS-APS-INTEGRATION-BLUEPRINT.md`).

**Fuentes de verdad, en orden:**

1. `aos-aps-standard/` (repo local, MIT) — `spec.json`, `spec/scoring.md`, `spec/signing.md`,
   `spec/claims-proofs.md`. Define AOS, APS, claims & proofs y la firma.
2. `MAASY/extensions-y-mcps/supabase/functions/` — la implementación que **ya corre en producción**
   (`aos-audit-url`, `aos-standards-check.ts`, `aps-*`, `aos-sign.ts`). BeAOS **porta** esto, no lo
   reinventa: cuando hay duda, manda Maasy.
3. Este repo.

Regla que costó un número equivocado: **si BeAOS y Maasy reportan distinto para el mismo sitio, es un
bug de BeAOS.** Ver §3.

---

## 2. Estado actual

**Desplegado:** `master` = `8251e92`, servidor `contabo-believe` (`vmi2938446`), `/root/BeAos`,
proyecto compose `beaos`. Migraciones `0014`–`0020` aplicadas.

### Paquete `packages/aos-aps/`

| Módulo | Qué es |
|---|---|
| `aos/` | auditoría AOS: `requirements.ts` (rubric), `probe.ts` (probes puros), `audit.ts` (I/O), `signature.ts` (verificación Ed25519) |
| `preference/` | `score.ts` = **APS del spec** sobre claims & proofs (determinístico, gratis); `measurement.ts` = **APS medido** (Fase 2/3, cuesta plata); `profile.ts` (validación de brand.json) |
| `aps/` | pipeline operativo: `library.ts` (Fase 4), `capture.ts` (Fase 0), `judge.ts` + `gateway.ts` (Fase 1), `robustness.ts` (Fase 6), `runPlan.ts`, `startRun.ts`, `targets.ts` |
| `provenance/` | `sign.ts` (firma), `keying.ts` (herencia de llave del umbrella) |
| `assets/` | generador del bundle (llms.txt, AGENTS.md, robots, sitemap, agent-card, brand.json, .sig, keys.json) |
| `worker/` | `budget.ts` (estimador y guardas de costo) |
| `server/` | `bundle.ts` (bundle publicable, byte-exacto, gate) |
| `db/schema.ts` | 9 tablas `agent_*` |

### Tablas y colas

Tablas: `agent_brand_entities`, `agent_aos_audits`, `agent_brand_dna_snapshots`, `agent_assets`,
`agent_aps_prompt_libraries`, `agent_aps_prompts`, `agent_aps_runs`, `agent_aps_observations`,
`agent_aps_scores`.

Colas del worker: `aos-audit`, `aps-prompt-library`, `aps-query`, `aps-parse`, `aps-score`.
`aps-query` y `aps-parse` **no reintentan a propósito** (reintentar una llamada paga la vuelve a pagar).

### Superficies

- **Panel** `/app/$brand/agent-preference`: biblioteca (generar/revisar/guardar), estimación antes de
  correr, corridas con banda/P10-P50-P90/dimensiones. Hermano: `/agent-ops` (AOS) y `/agent-assets`.
- **API de entrega** (para Maasy, con API key): `GET /api/v1/agent-assets/:entityId` (manifiesto con
  bytes exactos + sha256 + identidad de firma) y `.../raw?path=...`.
- **Superficie pública** (sin key): `/agent/:entityId/.well-known/brand.json` y cualquier asset del
  bundle, más un índice en `/agent/:entityId/`.
- **Gate de publicación**: cerrado por defecto (`agent_brand_entities.is_published`). Nada se sirve
  hasta que se publique explícitamente.

### El color: cómo se dice "bien / a medias / falta"

Jorge lo marcó: "muchos verdes, rojos, amarillos… choca con el design system de Believe". Tenía razón y
la causa era concreta: **el mapeo banda→color estaba copiado en cuatro archivos** (`aos-visual`,
`aps-visual`, `agent-score-cards`, `agent-preference`), así que cada pantalla derivó por su cuenta, y
las cuatro usaban el semáforo (verde/ámbar/naranja/rojo), que son **cuatro hues que no existen en la
marca**. El brandbook es explícito: *"Never invent new hex values. Always derive from the 6 tokens"*.

Lo que rige ahora, en un solo módulo: **`apps/web/src/components/status-tone.tsx`**.

| Canal | Qué significa | Cómo |
|---|---|---|
| **Azul** | cuánto hay | Rampa ordinal: `full` azul pleno → `high` 72% → `mid` 45% → `low` 22% → `none` **sin azul**. El color ordena, no juzga. |
| **Tinta** | qué tan grave | Peso, no tono. Lo que bloquea va en tinta plena; el resto en tinta mute. Sobrevive a daltonismo. |
| **Cian** | qué hacer ahora | La única señal. Dos apariciones por composición: el **próximo paso** (AOS) y el **subrayado del número** (APS). |

Dos reglas que hay que respetar al tocar esto:

1. **Un número nunca se pinta por lo que vale.** El número es un dato y va en tinta de marca
   (`text-believe-900`, que es el color de KPI del brandbook); el chip al lado dice si está bien o mal.
   El mismo componente sirve para un 34 y para un 94.
2. **Un estado nunca depende solo del color.** Cada estado lleva su palabra y su glifo (`✓` azul, `✕` en
   tinta, `—` mute), y la marca es llena o hueca según el nivel.

El peor estado no es el más ruidoso: es el **vacío** (gris). Lo que llama la atención es lo que hay que
hacer, no el diagnóstico. Eso es "calma sobre euforia" aplicado a un tablero.

Los tokens viven en `styles.css` (`--believe-700`, `--believe-900`, `--signal`, mapeados en `@theme`), y
`status-tone.test.ts` falla si alguien vuelve a escribir un color de la familia del semáforo o un hex
que no sea uno de los seis de marca. Los cortes de banda sí son reglas de negocio y viven donde se usan
(AOS: 80/60/35; visibilidad heredada de Getcito: 75/45).

Queda pendiente, si Jorge quiere, la **segunda pasada** sobre las pantallas heredadas de Getcito
(citations, prompts, admin): 67 archivos siguen con el semáforo. No se tocaron porque son de Getcito y
el cambio es más grande y más riesgoso que el de AOS/APS.

---

## 3. La auditoría AOS tiene que dar EL MISMO número que Maasy

Esto ya causó confusión una vez (BeAOS decía 63 donde Maasy dice 89 para `believe-global.com`). Las
reglas que hay que respetar en `requirements.ts` y `audit.ts`:

1. **Rubric puntuado = los 11 ids de Maasy**, con sus fuerzas y señales. Los 7 requerimientos
   restantes de `spec.json` viven en `EXTENDED_REQUIREMENTS` y son **diagnóstico**: se reportan y no
   puntúan. Agregar uno al rubric cambia todos los scores.
2. **JSON-LD = presencia del tag**, no parseo con exigencia de tipos.
3. **MCP/OpenAPI se busca por 4 vías**, en este orden: el HTML (`application/vnd.mcp`, `"openapi":"3`),
   los descriptores `/.well-known/mcp`, `/.well-known/openapi.json`, `/.well-known/ai-plugin.json`; el
   subdominio `mcp.<dominio>` con `tools/list` JSON-RPC; y **el endpoint declarado en el `llms.txt` del
   propio sitio** (`extractMcpEndpoint`). Esa última vía no es un atajo: es cómo una marca cuyo MCP
   vive en otro dominio recibe crédito.
4. **El tipo de negocio** (`brand` vs `product_api`) sale de esa misma señal, y decide si el requisito
   de API pública aplica (n/a vs puntuado).
5. Los probes **no siguen redirects**: un catch-all de SPA que devuelve 200 con `index.html` no puede
   pasar por archivo.
6. 🚨 **`/AGENTS.md` se prueba en mayúscula.** `believe-global.com` lo sirve en minúscula
   (`/agents.md` → 200), así que falla ese requisito en ambos scanners. Es el único fail real del sitio.

**Ojo con el "otro" número.** La UI de Maasy muestra un score **legacy** de 100 puntos
(inventory + declaration + DOM + ejecución + reliability; para este sitio: 15+6+20+35+0 = **76**). Eso
es **otra escala**. El comparable con BeAOS es `standards.aos_standards` (**89**). Si algún día se
quiere mostrar el 76 en BeAOS hay que portar ese breakdown aparte (necesita render worker, forms y
probe de confiabilidad).

---

## 4. Pipeline APS: cómo se corre y qué cuesta

### Fases

| Fase | Módulo | Nota |
|---|---|---|
| 0 captura | `aps/capture.ts` | fan-out prompt × modelo × repetición; **timeout de 90s por llamada** |
| 1 juez | `aps/judge.ts` + `gateway.ts` | JSON-mode sobre el gateway; valida y acota el veredicto |
| 2/3 score | `preference/measurement.ts` | 6 sub-métricas → 5 dimensiones → APS + banda; bootstrap P10/P50/P90 |
| 4 biblioteca | `aps/library.ts` | 40-60 prompts unaided, mix 50/30/20, **lockeada 90 días** |
| 6 robustez | `aps/robustness.ts` | verifica el grounding contra el texto, no contra el juez; inyección → cuarentena |
| plan | `aps/runPlan.ts` + `worker/budget.ts` | estimación antes de gastar; falla cerrado |

### Reglas duras (no romper)

- **Nunca mezclar modelos en un denominador común**: se puntúa y persiste **por modelo**; el rollup
  promedia valores ya normalizados.
- **Nunca remuestrear repeticiones entre prompts distintos.**
- **Un parcial nunca se presenta como completo**: `agent_aps_runs.partial` + `partial_reason`, y cada
  score lleva `partial`. Un run sin nada puntuable sigue siendo fallo.
- **Nunca degradar la capa de medición** a un modelo barato. La única adaptación permitida es
  `APS_BUDGET_POLICY=reduce_repetitions`.
- **`capacidad_accion` = el AOS real**; si no hay auditoría, su peso se redistribuye.
- Versionado por corrida: `scoringVersion`, `measurementVersion`, `judgeModelAlias`,
  `judgeModelVersion`, `judgePipelineVersion`, `promptLibraryVersion`.

### Costos y modelos (medidos, no estimados)

| Dato | Valor |
|---|---|
| Bandas del gateway | `believe-fast`, `believe-smart`, `believe-deep` → **todas `deepseek/deepseek-flash`** (`/model/info`) |
| Juez (Fase 1) | **USD 0.0014** por llamada (10 llamadas = 0.01423) |
| Biblioteca (50 prompts) | **USD 0.0077** por generación |
| Gateway | `/key/info` da `spend` y `max_budget` (**USD 50 / 30d**, reinicia el 2026-10-01) |
| Smoke completo (biblioteca + 24 mediciones + 10 juicios) | **≈ USD 0.03** en el gateway |

**Tokens: el modelo razona antes de escribir y esos tokens cuentan contra `max_tokens`.** Con 700 el
juez devolvía **contenido vacío el 100% de las veces**; con 3000 responde. La biblioteca con 4000 se
truncaba; con 8000 da 50 prompts con el mix exacto. Configurable: `APS_JUDGE_MAX_TOKENS`.

**Los precios se leen, no se inventan**: `gatewaySpendFromHeaders` (header `x-litellm-response-cost`)
y `readGatewayBudget` (`/key/info`, sin llamada de inferencia). Los modelos de **medición**
(OpenAI/Anthropic/BrightData) **no pasan por el gateway**, así que ahí el precio sale de la factura
(`APS_PRICES`). Un target sin precio **bloquea** el plan.

### Estado de la última medición real

Run `518eeea9` sobre `believe-global.com`, 6 prompts × 4 modelos × 1 repetición:

| Modelo | APS | Banda | Respuestas |
|---|---|---|---|
| chatgpt | 27 | Agent-Opaque | 6 |
| google-ai-mode | 24 | Agent-Blind | 4 |

Corrida **parcial** (10 de 24). **P10 = P50 = P90 porque hubo 1 repetición**: la banda de varianza solo
informa con ≥2. Lectura: el sitio es **muy operable** (AOS 89) pero los modelos **casi no lo prefieren**
en prompts de compra unaided (APS 24-27).

---

## 5. Runbook

### Deploy (⚠️ incluye el error que ya cometí)

```bash
ssh contabo-believe
cd /root/BeAos
git pull --ff-only

# 🔴 Construir SIN targets. Si construís solo `web worker`, la imagen de db-migrate queda vieja y
#    las migraciones nuevas NO se aplican (el archivo está en el repo, pero la imagen no lo tiene).
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml build

docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml up -d --no-build
```

Verificar:

```bash
DC="docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml"
$DC ps --format "{{.Service}} {{.Status}}"
$DC logs worker --tail 60 | grep -E "Queues created|Registered handler"
curl -s -o /dev/null -w "%{http_code}\n" https://beaos.believe-global.com/auth/login
```

Notas de operación:
- El repo del servidor es **single-branch**: si `git pull` dice "already up to date" con código viejo,
  correr `git fetch origin master:refs/remotes/origin/master && git merge --ff-only origin/master`.
- Cambiar `.env` **no** alcanza: hay que recrear los contenedores (`up -d --no-build`).
- Backups del `.env` en el servidor: `.env.bak-*` (hay 3, incluidos los de la rotación de llave y de
  precios).
- El worker es `restart: unless-stopped`: si crashea, se ve como crash-loop y **los jobs de fondo se
  detienen** (se encolan, no se pierden). Mirar `$DC logs worker` y el `RestartCount`.

### Correr una medición APS

Desde el panel (`Agent Preference`): generar biblioteca → revisar → guardar (lockea 90 días) → estimar
→ confirmar. La estimación y el run usan la misma preparación, así que el número que se ve es el que
se ejecuta.

Antes de una corrida grande: la biblioteca completa (50 prompts × 4 modelos × 3 reps = 600 llamadas)
**supera** `APS_MAX_CALLS_PER_RUN=450`. Subir el cap o bajar prompts.

### Consultas útiles

```sql
-- estado de un run
select status, planned_calls, completed_calls, partial, partial_reason
from agent_aps_runs order by created_at desc limit 3;

-- scores por modelo
select model, aps, band, p10, p50, p90, recommendation_probability, observations, partial
from agent_aps_scores order by created_at desc limit 10;

-- costo real del juez y sellos de versión
select estimation, scoring_version, measurement_version, judge_model_alias, judge_model_version
from agent_aps_runs order by created_at desc limit 1;

-- llamadas a proveedores (incluye fallas y latencia)
select provider, model, count(*), sum(case when success then 1 else 0 end),
       max(duration_ms), left(max(error_message), 80)
from provider_calls where created_at > now() - interval '1 hour' group by 1,2;
```

---

## 6. Firma Ed25519: estado y por qué es raro

El material en `BELIEVE_SIGNING_KEY_ED25519` es un blob **PKCS#8 de 48 bytes**. Hay que saber esto:

- Leído **correctamente** (últimos 32 bytes) deriva `eu6UCfSC5/…` (kid `ea8df48ae4094207`).
- Leído **al revés** (primeros 32 bytes) deriva **`XUb4VuHSOw1+lr1ehep0qgdqejGqLS4gpWLDZHpHMzc=`**
  (kid `71952e93b97ac2b8`), que es **la llave publicada** y con la que verifica el `brand.json` de
  `believe-global.com`.
- O sea: **la identidad publicada de Believe salió de la lectura "al revés"** (`out.slice(0, 32)` en el
  `seedBytes()` de Maasy).

Decisión tomada: **normalizar el valor a la seed efectiva de 32 bytes** (hex
`302e020100300506032b6570042204209c64f9fb9171949e6db23cddf544c11a`) para que BeAOS derive la llave
publicada. **Sin cambios de código y sin tocar believe-global.com.** Verificado en producción: `kid
71952e93b97ac2b8` y firma válida.

⚠️ **No "arreglar" `seedBytes()` en Maasy** con el mismo criterio: empezaría a firmar con `eu6U…` y
**rompería su propia identidad publicada**. Eso tiene que ser una **rotación** deliberada: llave nueva,
`keys.json` nuevo, re-firmar el `brand.json`, y la vieja con `status: "retired"`.

🔐 El material de la seed pasó por un chat durante el diagnóstico: tratarlo como **expuesto** y
rotarlo cuando se pueda.

---

## 7. Pendientes

### De Jorge / infraestructura

| # | Pendiente | Detalle |
|---|---|---|
| 1 | **Saldo de Anthropic** | `400 — "Your credit balance is too low to access the Anthropic API"`. Claude dio 0/6 en la última medición. |
| 2 | **Perplexity se cuelga** | 0/6, timeout a los 90s. BrightData tardó 151s en `google-ai-mode`, así que parece config de zona/endpoint de Perplexity. |
| 3 | **`/AGENTS.md` en mayúscula** | Hoy se sirve `/agents.md` (200) y `/AGENTS.md` (404). Es el único requisito AOS que falla: con el alias, el sitio da 100. |
| 4 | **Precios de la capa de medición** | `APS_PRICES` hoy tiene provisionales (`chatgpt=0.05`, `claude=0.05`, `perplexity=0.05`, `google-ai-mode=0.05`, `believe-deep=0.0013`). Los reales salen de la factura de OpenAI/Anthropic/BrightData. |
| 5 | **`APS_MAX_CALLS_PER_RUN`** | Subir de 450 para permitir 50 prompts × 4 modelos × 3 reps (600). |
| 6 | **Rotación de la llave de firma** | Ver §6. |

### Técnicos (siguiente trabajo)

- **Repeticiones ≥ 2** para que P10/P50/P90 informen de verdad (hoy colapsan al punto).
- **Banda por prompt en la captura**: hoy un modelo lento (BrightData, 151s) hace esperar a todo su
  lote, así que la captura tarda 6 × 151s. Una cola con concurrencia acotada en vez de lotes fijos lo
  arregla.
- **Score legacy de Maasy (76)**: decidir si BeAOS lo porta y lo muestra al lado del 89.
- **Generación de prompts desde la UI**: hoy se puede generar y revisar; falta el botón de regenerar
  tras el lock con confirmación explícita (ya existe `supersede`).
- **MCP card propio**: el bundle no emite `/.well-known/mcp/server-card.json`.

---

## 8. Cómo trabajar en esto (protocolo anti-sesión-muerta)

Lo que falló en una sesión anterior fue **contexto**: la sesión se congeló y se perdió el hilo. Lo que
funciona:

1. **Todo a git, en commits chicos y un PR por pieza.** Lo único que peligra si una sesión muere es lo
   que está sin commitear. Los cuerpos de los PR tienen la verificación y el porqué de cada decisión.
2. **Cortar por PR cuando la sesión se pone larga**: cerrar el chunk, mergear, y dejar un resumen de 5
   líneas con el próximo paso. La sesión siguiente arranca con *"retomá desde master, leé
   `docs/AOS-APS-ESTADO.md`"*.
3. **Actualizar este documento** cuando cambie el estado, se tome una decisión o aparezca un pendiente.
4. **El harness tiene compactación** (eventos `compaction/start|end|summary`, resumen por LLM,
   reintentos, y un botón en la GUI), pero compactar es **resumir**: pierde detalle y no corre si la
   sesión se cuelga. No reemplaza a los puntos 1-3.
5. Para objetivos largos, el **goal con rondas** continúa solo (en esta sesión se disparó la ronda 2).
   Los **subagentes** sirven para leer y resumir sin llenar el contexto principal.

### PRs de esta integración (orden cronológico)

`#1` blueprint + AOS/APS · `#2` llaves del umbrella · `#3` estimador de costo · `#4` gate + bundle
byte-exacto · `#5` API de entrega · `#6` superficie pública · `#7` núcleo de medición · `#8` dominio del
run (biblioteca/plan/robustez) · `#9` captura y juez · `#10` cadena del worker · `#11` disparador
on-demand · `#12` panel Agent Preference · `#13` key de gateway · `#14` costo y presupuesto reales ·
`#15` tokens del juez/generador + fix del reconcile de colas · `#16` paridad del AOS con Maasy ·
`#17` timeout por llamada + corridas parciales.
