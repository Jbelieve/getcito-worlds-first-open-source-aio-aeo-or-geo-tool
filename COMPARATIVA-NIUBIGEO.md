# Comparativa: NiubiGEO contra BeAOS

**Fecha:** 2026-10-01 · **Rama:** `docs/comparativa-niubigeo` · **Autor:** agente de documentación

## Fuentes y método

Leí **completas** las cuatro fuentes, tal como se pidió. Las dos primeras son las que Jorge nombró y las cuatro respondieron `200`, así que **no hubo que buscar nombres alternativos**:

| Archivo | URL | Estado |
| --- | --- | --- |
| `measurement-methodology.md` | `https://raw.githubusercontent.com/Albert-Weasker/niubigeo/main/docs/measurement-methodology.md` | 200 · 15.676 bytes |
| `evidence-model.md` | `https://raw.githubusercontent.com/Albert-Weasker/niubigeo/main/docs/evidence-model.md` | 200 · 13.553 bytes |
| `limitations.md` | `https://raw.githubusercontent.com/Albert-Weasker/niubigeo/main/docs/limitations.md` | 200 · 12.115 bytes |
| `known-issues.md` | `https://raw.githubusercontent.com/Albert-Weasker/niubigeo/main/docs/known-issues.md` | 200 · 14.666 bytes |

Licencia verificada contra el repo (no contra el comentario de nadie): `LICENSE` del repositorio = **Apache-2.0**, confirmado también por la API de GitHub (`spdx_id: "Apache-2.0"`). `docs/` tiene **36 entradas**; yo leí 4. Lo digo porque más abajo hay cosas que declaro "no lo pude verificar" precisamente por eso.

**Los documentos de NiubiGEO están en chino.** Cada cita va **literal** entre comillas y con el archivo:línea; mi traducción va aparte, marcada `[trad.: …]`, para que nunca se confunda con el original.

**Convención de citas:** las citas de sus documentos van entre `「」` y son **byte a byte** el texto bajado. Las citas de **nuestro** código van entre `«»`; como los comentarios ocupan varias líneas, los saltos de línea se unieron con un espacio y las decoraciones de comentario (`*`, `//`) se quitaron — es la única alteración, y `[…]` marca cualquier corte. Verifiqué las 33 citas de ellos y las 33 de nuestro código con un script contra los archivos originales: **cero diferencias**. Donde parafraseo, no hay comillas.

**Regla de la casa, aplicada a rajatabla:** cada afirmación sobre BeAOS lleva `archivo:línea` **leído en este checkout**. Donde no pude verificar, dice **"no lo pude verificar"**. No comparo contra el manual (`MANUAL-BEAOS.md`) ni contra lo que recuerdo: comparo contra el código.

---

## 1 · Qué es cada uno, en dos párrafos

**NiubiGEO** es una plataforma open source (Apache-2.0, self-hosted, ~4.9k estrellas) de **visibilidad de marca en motores de IA y reportes de competencia**. Su disciplina de medición está documentada con una honestidad poco común: define dos protocolos (`domain-recognition/v1` y `keyword-discovery/v1`), la unidad de observación (`ProbeRun` / `ProbeAttempt`), la fórmula explícita de numerador, denominador, `failed`, `complete` y `pointState`, y publica —en el mismo repositorio— siete conflictos de "primer nombre único", dieciocho fallos de análisis y una lista de veinte limitaciones propias (`L01`–`L20`) con la versión declarada como **`v0.2.0-rc.1, UNPUBLISHED`** y el release, en sus palabras, `blocked`. Miden **lo que el modelo contesta** sobre una marca y sus competidores; no emiten nada sobre la web de la marca ni firman un perfil que un agente consuma. Y son **gratis y self-hosted**: eso es un hecho comercial, no un detalle — la descripción de su repositorio en GitHub dice `Open-source AI brand visibility and competitor reports`.

**BeAOS** mide **tres cosas que NiubiGEO no mide juntas**: visibilidad (los prompts trackeados y su Share of Voice), **operabilidad** (el rubric AOS: 19 requisitos sobre lo que la web declara y lo que un agente puede hacer con ella, `packages/aos-aps/src/aos/requirements.ts:28-188`) y **preferencia** (APS: lo que modelos reales responden sobre la marca, más el APS declarado que sale del `brand.json` firmado y servido). La diferencia de fondo no es de features sino de **qué se publica**: BeAOS produce un bundle firmado con Ed25519 que un agente verifica antes de montarlo (`packages/aos-aps/src/provenance/sign.ts:124-137`, `packages/aos-aps/src/aos/signature.ts:90-143`), detrás de un candado de publicación cerrado por defecto (`packages/aos-aps/src/db/schema.ts:33`, `apps/web/src/server/agent-assets-core.ts:561-570`). Ellos publican un método para medir respuestas; nosotros publicamos un perfil que una máquina puede consumir y verificar.

---

## 2 · Dónde coincide el criterio (y por qué eso nos da confianza)

Coincidir con un competidor que documenta sus números hasta el denominador no es casualidad: son los mismos problemas, resueltos por separado. Los seis puntos de abajo son criterio compartido, no funciones copiadas.

### 2.1 · Un fallo no es "la marca no apareció"

> 「`failed` 是“失败或排除”，可能包括不适用的离线引用样本、未知或缺失，不仅是 Provider 请求错误。」 — `measurement-methodology.md:47`
> `[trad.: failed es "falló o quedó excluido", y puede incluir muestras offline no aplicables, desconocidas o faltantes; no es solo un error de request al Provider.]`

> 「失败和缺失不作品牌未出现。有效分母下的 0% 是真实未命中；null 表示不能计算。」 — `measurement-methodology.md:49`
> `[trad.: los fallos y lo faltante no se toman como que la marca no apareció. Bajo un denominador válido, 0% es un no-acierto real; null significa que no se puede calcular.]`

En BeAOS la misma regla está escrita en el módulo de consumo y repetida en cada capa:

- `packages/lib/src/providers/token-usage.ts:9-11` — «**Nunca convierte "no vino" en `0`.** Un campo ausente queda `undefined`, y quien persiste lo guarda como `null`. Es la misma regla que el costo: `0` es un dato, `null` es "no lo sé".»
- `packages/lib/src/providers/usage.ts:16-21` — «`costUsd` es el precio **real** de la llamada, no una estimación. […] Cuando no se puede obtener, queda `null` — **nunca `0`**».
- `packages/lib/src/db/schema.ts:257-260` — «Null significa "no lo sé", nunca "fue gratis": `0` es un costo conocido de cero […] y `null` es un costo que no se pudo obtener. Confundirlos es lo que hace que un total parezca completo y mienta.»
- `apps/web/src/lib/claims-guard.ts:66-67` — «Devuelve `null` — y no ceros — cuando no hay archivo o no es JSON parseable. La diferencia importa: "no pude leerlo" no es "no declara nada"».

### 2.2 · "No lo sé" y "cero" son estados distintos, y el gráfico lo dice

> 「value = denominator > 0 ? 100 × numerator / denominator : null」 — `measurement-methodology.md:42`

> 「complete = planned > 0 且 failed=0」 / 「pointState = denominator=0 时 no_data，否则 complete 或 partial」 — `measurement-methodology.md:43-44`

Nuestro equivalente exacto, en la agregación de visibilidad:

- `packages/lib/src/report-metrics.ts:80` — `const sov = denominator === 0 ? null : Math.round(…)`.
- `packages/lib/src/report-metrics.ts:531` — `getSoVLevel(null)` → `label: "No Data"`, y `packages/lib/src/report-metrics.ts:518` pinta el `null` distinto de un cero.
- `apps/web/src/lib/visibility-stats.ts:73-75` — con menos de dos días de datos devuelve `setVolatility: null, weightedVolatility: null`, no `0`.
- `apps/web/src/lib/visibility-stats.ts:159` — `brandShare: total === 0 ? null : …`.
- `apps/web/src/lib/visibility-stats.ts:211-213` — día sin datos ⇒ `share: null`, no una línea en cero.

Y en el APS, el mismo criterio con nombre propio: `packages/aos-aps/src/aps/runPlan.ts:130-141` lleva `attempted`, `observations` y `empty` por separado («Only non-empty answers become observations»), y `packages/aos-aps/src/aps/runPlan.ts:144-149` define `isRunComplete` para que una corrida con menos respuestas que las planeadas **nunca** puntúe como completa. El worker lo escribe: `apps/worker/src/jobs/aps-score.ts:62-63` calcula `partial` y `partialReason`, y `apps/worker/src/jobs/aps-score.ts:107` los persiste junto al estado `done`.

### 2.3 · Un denominador por modelo, nunca promediado

> 「对象可以包含目标与多个竞品。一个 K 回答可同时用于多个对象指标，各对象仍共享这一个回答样本。」 — `measurement-methodology.md:31`
> `[trad.: un objeto puede incluir al target y a varios competidores. Una respuesta K puede usarse para métricas de varios objetos, y los objetos siguen compartiendo esa única muestra de respuesta.]`

- `packages/aos-aps/src/db/schema.ts:314` — «One row per model: a denominator never mixes models.» (la tabla `agent_aps_scores` lleva `model` como columna propia, `packages/aos-aps/src/db/schema.ts:323`).
- `packages/lib/src/report-metrics.ts:378-389` — `analyzeByEngine` agrupa por `run.model` antes de calcular cualquier tasa: no hay un porcentaje único que mezcle motores.

### 2.4 · De pocas mediciones no se infiere crecimiento

> 「只有范围一致且证据完整的至少两次观察才描述变化；三次观察也不自动产生统计显著性。」 — `measurement-methodology.md:131`
> `[trad.: solo al menos dos observaciones con alcance consistente y evidencia completa describen un cambio; tres observaciones tampoco producen significancia estadística automáticamente.]`

> 「三次短期观察不保证统计显著、长期稳定或优化有效；temperature=0 不保证完全相同输出。」 — `limitations.md:21`
> `[trad.: tres observaciones de corto plazo no garantizan significancia estadística, estabilidad de largo plazo ni efectividad de la optimización; temperature=0 no garantiza una salida idéntica.]`

En BeAOS está como regla de dominio, no como advertencia de manual:

- `packages/aos-aps/src/preference/confidence.ts:1-6` — «confidence = clamp(1 - 1/sqrt(n), 0.5, 0.95) for n >= 2, else null. Confidence is never self-assigned: a single named case is not a sample.»
- `packages/aos-aps/src/preference/confidence.ts:29-33` — `n < 2` ⇒ `null`.
- `packages/aos-aps/src/claims/mapping.ts:17-20` — la confianza que declara un humano **no** se emite: «derivar una muestra de la nada sería exactamente el dato inventado que todo esto evita».
- `packages/lib/src/db/schema.ts:230-231` (`provider_calls`) — el comentario del esquema insiste en lo mismo para el gasto: una llamada fallida también se factura, así que también se registra.

### 2.5 · *Mencionado*, *descrito* y *recomendado* no son lo mismo

> 「匹配对象且 recommendation=positive」 — `measurement-methodology.md:76` (la celda de `positive_recommendation` en la tabla de K)
> `[trad.: ¿es una recomendación positiva? positive_recommendation: coincide el objeto y recommendation=positive.]`

> 「证据限制：正面推荐和先后指标直接采用模型给出的结构化标签」 — `measurement-methodology.md:85`
> `[trad.: límite de evidencia: la recomendación positiva y los indicadores de orden toman directamente las etiquetas estructuradas que da el modelo.]`

Nuestro APS separa esos estados en columnas distintas, y además los audita:

- `packages/aos-aps/src/db/schema.ts:298-301` — `appeared`, `recommended`, `position`, `sentiment0to100` como campos independientes (la tabla `agent_aps_observations`).
- `packages/aos-aps/src/db/schema.ts:302-305` — `grounded` (lo que dijo el juez) y `sourceVerified` (chequeo independiente del texto) son **dos** columnas, no una.
- `packages/aos-aps/src/preference/types.ts:117-121` — el validador del estándar exige que cada claim declare `applicable_for` y `not_applicable_for` y que su confianza coincida con la derivada de `metric.n`.

### 2.6 · Las condiciones de ejecución quedan registradas

> 「需要保存和披露：原始输入、规范化输入、Provider 与完整模型路由、已返回的模型版本、请求搜索配置与实际搜索执行、语言、D/K 协议版本、Prompt/Schema Hash、temperature、输出上限、匹配规则、范围版本、repetitions、实际时间和尝试选择规则。模型路由相同不能证明上游权重或搜索索引未变。」 — `measurement-methodology.md:21`
> `[trad.: hay que guardar y declarar: input original, input normalizado, Provider y ruta completa del modelo, versión del modelo devuelta, configuración de búsqueda pedida y ejecución real de la búsqueda, idioma, versión del protocolo D/K, hash de prompt/schema, temperature, tope de salida, reglas de match, versión del alcance, repetitions, tiempo real y reglas de selección de intentos. Que la ruta del modelo sea la misma no prueba que los pesos de arriba o el índice de búsqueda no hayan cambiado.]`

Lo que **sí** registramos hoy (verificado, con la lista de lo que falta en §3.3 y §3.4):

- `packages/lib/src/db/schema.ts:109-117` — `prompt_runs` guarda `model`, `provider`, `version`, `webSearchEnabled`, `rawOutput`, `webQueries`, `brandMentioned`, `competitorsMentioned`, `createdAt`.
- `packages/aos-aps/src/db/schema.ts:270-275` — la corrida APS fija por versión `scoring_version`, `measurement_version`, `judge_model_alias`, `judge_model_version`, `judge_pipeline_version`, `prompt_library_version`.
- `packages/aos-aps/src/db/schema.ts:228-230` — `models`, `requested_repetitions`, `effective_repetitions`.
- `packages/lib/src/db/schema.ts:241-255` y `:266-283` — por llamada: `provider`, `model`, `kind`, `success`, `error_message`, `duration_ms`, `cost_usd` con su `pricing_source`.
- `packages/aos-aps/src/aps/capture.ts:1-10` — captura y análisis separados: «It does not parse anything: analysis is Fase 1 over the stored text, so the formula can be recomputed without paying for the queries again.» Es la misma decisión que `evidence-model.md:3` de ellos.

### 2.7 · El registro original se conserva; no se elige el intento más favorable

> 「出现不一致时标为待复核，保留原始记录，不选择更有利的一次。」 — `measurement-methodology.md:108`
> `[trad.: cuando aparece una inconsistencia se marca como pendiente de revisión, se conserva el registro original y no se elige el intento más favorable.]`

> 「该指标存在一致性冲突，暂不用于排名比较。不是已证明目标不在第一位，也不解释为并列第一。」 — `known-issues.md:11`
> `[trad.: ese indicador tiene un conflicto de consistencia y no se usa por ahora para comparar rankings. No es que esté probado que el objetivo no está primero, ni se interpreta como empate en el primer puesto.]`

En BeAOS: `packages/aos-aps/src/db/schema.ts:282-284` guarda la respuesta cruda una vez y **re-analiza en el lugar** («the raw answer is stored once and re-analysed in place, so a formula change never pays for the queries again»); `packages/aos-aps/src/aps/judge.ts:7-8` («The judge is an LLM, so its output is untrusted input: `normalizeVerdict` validates and clamps every field before anything is persisted. A malformed verdict is dropped, never guessed at.»). Y para el dinero, `packages/lib/src/db/schema.ts:229-231` registra también la llamada fallida porque se factura igual.

---

## 3 · Qué tienen ellos y nosotros NO — con lo que costaría cerrarlo

Ordenado por lo que más nos cuesta hoy, no por lo que más suena.

### 3.1 · Qué modelo contestó cuando el target va por scraper (el caso que Jorge ya conocía, verificado)

**Qué es.** Cada intento conserva el **modelo solicitado** y, cuando el proveedor lo informa, la **versión devuelta**; y el pedido de búsqueda va separado de la ejecución real.

> 「providerId、providerModel、providerModelVersion | 记录 OpenRouter 与返回模型信息；字段值不保证披露不可变模型权重版本」 — `evidence-model.md:33`
> `[trad.: providerId, providerModel, providerModelVersion: registran OpenRouter y la información del modelo devuelto; el valor del campo no garantiza que se revele una versión inmutable de los pesos del modelo.]`

**Cómo está hoy en BeAOS (leído, no recordado).** En el APS **no se guarda**: el invocador devuelve solo el texto —

- `apps/worker/src/jobs/aps-query.ts:107-117` — el `invoke` llama al provider y termina en `return typeof result.textContent === "string" ? result.textContent : "";`: `result.modelVersion` existe (`packages/lib/src/providers/types.ts:33`) y **se descarta**.
- `apps/worker/src/jobs/aps-query.ts:140` — `model: answer.job.model`: se persiste **el que pedimos**, no el que contestó.
- `packages/aos-aps/src/db/schema.ts:294` — la columna se llama `model` y **no hay** columna de versión del modelo medido. Sí hay `judgeModelVersion` (`packages/aos-aps/src/db/schema.ts:309`): la versión del **juez**, que es otra cosa.

En la capa de visibilidad sí se guarda, pero **coalescido en una sola columna**:

- `apps/worker/src/jobs/process-prompt.ts:249` — `const recordedVersion = modelVersion ?? config.version ?? config.provider;` escrito en `prompt_runs.version` (`packages/lib/src/db/schema.ts:111`). Una columna, dos hechos distintos: "lo que pidió el proveedor" y "lo que dijo el proveedor" caen en el mismo lugar y después no se pueden separar.
- `packages/lib/src/providers/registry/openrouter.ts:124-127` — y en el camino de research se descarta a propósito la versión resuelta: «Report the alias we sent, not OpenRouter's resolved version (e.g. "openai/gpt-5-mini" vs "openai/gpt-5-mini-2025-08-07")».

**El matiz que hay que decir, sin adornos.** El scraper **no siempre informa**: `packages/lib/src/providers/registry/brightdata.ts:233` devuelve `modelVersion: record?.model ?? undefined`, `packages/lib/src/providers/registry/cloro.ts:236` lo deja en `undefined` si no viene, `packages/lib/src/providers/registry/dataforseo.ts:244` cae al nombre pedido (`result.model_name ?? modelName`) y `packages/lib/src/providers/registry/dataforseo.ts:137` devuelve lisa y llanamente `modelVersion: "dataforseo"`. O sea: lo que nos falta no es solo una columna — es **persistir lo que venga y declarar `unknown` cuando no venga**, en vez de escribir el nombre pedido como si fuera el que contestó.

**Por qué nos importa.** Es la misma familia del bug que nos comió la semana: un dato que **parece** el dato. Un APS por scraper hoy afirma implícitamente que contestó el modelo que pedimos, sin haberlo comprobado. Si un dataset cambia de motor por detrás, nuestra serie histórica lo va a mostrar como estable.

**Qué costaría.** Un campo nuevo en `agent_aps_observations` + ensanchar `ProviderInvoker` (`packages/aos-aps/src/aps/targets.ts:28`, hoy `=> Promise<string>`) para que devuelva `{ text, modelVersion }`, + decidir si `prompt_runs.version` se parte en dos (`requested` / `reported`). Es una migración chica, tipos y UI. **Una mañana, no una semana** — y sin inventar nada donde el proveedor calla.

### 3.2 · El estado del punto y el `failed` en el denominador — en la capa de visibilidad

**Qué es.** Ellos declaran, para cada punto, cuántos probes se planearon, cuántos entraron al denominador, cuántos fallaron o se excluyeron, y si el punto es `complete`, `partial` o `no_data`.

> 「`planned` 来自已经落盘并读到的 Probe，不一定等于整个 Run 的 plannedProbeCount；执行中尚未写出的 Probe 不会自动出现在这里。运行未结束时构建统计存在不完整性风险。」 — `measurement-methodology.md:47`
> `[trad.: planned viene de los Probe ya escritos y leídos, no necesariamente equivale al plannedProbeCount de todo el Run; un Probe que todavía no se escribió no aparece acá automáticamente. Construir estadísticas con la corrida sin terminar tiene riesgo de incompletitud.]`

**Cómo está hoy en BeAOS.** El **APS ya lo tiene** — y por eso este hueco es solo de la mitad heredada del producto:

- `packages/aos-aps/src/aps/runPlan.ts:138-141` — `captureSummary` devuelve `attempted`, `observations` y `empty`.
- `apps/worker/src/jobs/aps-score.ts:62-63` y `:107` — `partial` + `partialReason` persistidos en la corrida, con el comentario «What it never does is pass for a complete measurement — the gap travels with it.»

La **capa de visibilidad no lo tiene**, y la consecuencia está escrita en su propio esquema:

- `packages/lib/src/db/schema.ts:229-231` — «Failed calls are recorded too: a provider that errors after the upstream work has started is still billed, and a run that fails stores no prompt_runs row, so this table is the only place that count exists.»
- `apps/worker/src/jobs/process-prompt.ts:339-356` — los fallos se cuentan, se loguean y se mandan a telemetría (`failed_runs`), pero **no se persisten como filas**: el único rastro durable del fallo es `provider_calls.success = false` (`packages/lib/src/providers/usage.ts:159-164`).
- Efecto medible: `computePromptSoV` (`packages/lib/src/report-metrics.ts:56-60`) divide por `promptRuns.length`, o sea **por las corridas que salieron bien**. Una caída de proveedor no aparece como `failed`: aparece como un denominador más chico. `packages/lib/src/report-metrics.ts` no recibe `planned` ni `failed` en su tipo de entrada (`packages/lib/src/report-metrics.ts:10-14`).

**Por qué nos importa.** Es exactamente el argumento que ya escribimos para el costo, y vale igual acá: `packages/aos-aps/src/aps/cost.ts:10-14` — «**un total incompleto se declara incompleto**. […] Mostrar la suma de las que sí sabemos como si fuera el total es la misma mentira de siempre —un número que parece terminado— con otro nombre.» Un SoV calculado sobre 6 de 9 corridas es un número que parece terminado.

**Qué costaría.** Es más diseño que código: una tabla de intentos por ciclo (o dos contadores `planned`/`failed` en el ciclo) y llevar `complete | partial | no_data` a la superficie, igual que ya hace el APS. La decisión fina —qué hace un punto parcial con el promedio— es la parte cara.

### 3.3 · La ejecución **real** de la búsqueda, separada del pedido

**Qué es.** Ellos distinguen cuatro modos de ejecución y **prohíben** deducir la ejecución del pedido.

> 「请求 native 不能证明最终确实由模型原生执行。」 — `evidence-model.md:91`
> `[trad.: pedir native no prueba que al final lo haya ejecutado realmente el modelo de forma nativa.]`

> 「| native | OpenRouter 元数据确认原生路径 |」
> 「| sdk | OpenRouter 元数据确认服务端工具的 SDK 路径，**不声称模型内建搜索** |」
> 「| unverified | 未得到对应路径确认，不得仅凭请求模式推定实际执行 |」 — `evidence-model.md:95-97`
> `[trad.: native = los metadatos de OpenRouter confirman la ruta nativa. sdk = los metadatos confirman la ruta SDK de la herramienta de servidor, sin afirmar búsqueda incorporada en el modelo. unverified = no se obtuvo confirmación de esa ruta, no se puede inferir la ejecución real solo por el modo pedido.]`

> 「当前 SDK 和 native 都可能在 SearchExecution 中归为 usedMode=provider_native，报告简短标签也可能都显示“Provider 原生联网”。应同时披露 executionMode、note 和原始元数据」 — `evidence-model.md:100`
> `[trad.: hoy SDK y native pueden caer los dos en usedMode=provider_native dentro de SearchExecution, y la etiqueta corta del reporte puede mostrar en ambos "Provider nativo conectado". Hay que declarar a la vez executionMode, note y los metadatos crudos.]`

**Cómo está hoy en BeAOS.** Guardamos **el pedido**, no la ejecución:

- `packages/lib/src/db/schema.ts:112` — `webSearchEnabled`, escrito desde `config.webSearch` (`apps/worker/src/jobs/process-prompt.ts:257`): es la configuración **solicitada**.
- El único rastro de lo que pasó de verdad son las queries observadas, y cuando el proveedor no las expone se escribe un centinela, no una invención: `packages/lib/src/constants.ts:34` (`WEB_QUERIES_UNAVAILABLE = "unavailable"`) y `packages/lib/src/providers/registry/openrouter.ts:165-170` — «OpenRouter doesn't expose what search queries the model made internally. Only mark as "unavailable" when citations prove a web search happened.»
- Busqué un equivalente de `executionMode` en nuestra capa de proveedores (grep de `executionMode`, `openrouter_metadata`, `server_tool` sobre `packages/lib/src` y `packages/aos-aps/src`): **no lo encontré**. El único `server_tool_use` que aparece es `packages/lib/src/providers/registry/anthropic-api.ts:115`, y se usa para extraer queries, no para clasificar el modo.

**Por qué nos importa.** Su límite `L20` es literalmente nuestro hueco: dos caminos distintos de búsqueda que se muestran con la misma etiqueta hacen incomparables dos series que parecen iguales. Y en un reporte de visibilidad, "el modelo buscó" es la diferencia entre una respuesta de entrenamiento y una respuesta con fuentes actuales.

**Qué costaría.** Leer `openrouter_metadata.pipeline` en `packages/lib/src/providers/registry/openrouter.ts` y persistir uno o dos campos. Para los scrapers no hay nada que leer: el valor correcto es `unverified`, que es uno de los cuatro modos de ellos — declararlo es barato; **fingir que se midió, no**.

### 3.4 · Condiciones de generación por llamada: temperature, maxTokens y hash del prompt

**Qué es.** `requestParameters` por intento: modelo, temperature, maxTokens, nombre/hash del schema, transporte de salida estructurada y configuración de búsqueda (`evidence-model.md:30`), más `promptHash` (`evidence-model.md:29`).

**Cómo está hoy en BeAOS.** No hay columna: ni en `provider_calls` (`packages/lib/src/db/schema.ts:236-304`) ni en `prompt_runs` (`packages/lib/src/db/schema.ts:99-118`). Los valores viven en el código: `packages/aos-aps/src/aps/gateway.ts:254-255` (`temperature: 0`, `max_tokens: config.maxTokens ?? JUDGE_MAX_TOKENS`) y `packages/aos-aps/src/aps/gateway.ts:425-426` (`temperature: 0.7` para el generador de biblioteca). Un grep de `temperature|maxTokens|top_p` sobre el esquema no devuelve nada.

Lo que **sí** tenemos y es más fuerte que un hash, para el caso de los prompts: el texto se guarda **entero** — `prompts.value` (`packages/lib/src/db/schema.ts:68`) y `agentApsObservations.promptText` (`packages/aos-aps/src/db/schema.ts:296`). Lo que no se guarda es el prompt **ensamblado del juez** (`packages/aos-aps/src/aps/judge.ts:32-38`), así que hoy no se puede reconstruir byte a byte qué se le mandó al juez.

**Por qué nos importa.** Sin temperature y maxTokens no se puede responder "¿este cambio de serie es del modelo o nuestro?" — que es la pregunta que hace un cliente cuando el número se mueve. La regla que ya citamos en §2.6 (que la misma ruta de modelo no prueba que los pesos de arriba no cambiaron) corta para los dos lados.

**Qué costaría.** Lo más barato de esta lista: dos columnas numéricas en `provider_calls` y el hash del prompt del juez. Una migración y un par de asignaciones.

### 3.5 · El hueco del gráfico se muestra como hueco

**Qué es.** Ellos tratan el punto faltante como **corte**, no como continuidad.

> 「**L03：图表缺失点和关键词分组修订。**」 / 「现已将关联图限定到当前 keywordId、把 keywordId 纳入序列身份，并保留 null 点作为断点；图表明细也保留缺失行。」 — `limitations.md:30`
> `[trad.: L03: revisión de puntos faltantes y agrupación por keyword. […] ahora el gráfico de asociación se limita al keywordId actual, el keywordId entra en la identidad de la serie y los puntos null se conservan como cortes; el detalle del gráfico también conserva las filas faltantes.]`

**Cómo está hoy en BeAOS.** Nuestra serie de Share of Voice **arrastra el último valor** a los días en que el prompt no corrió:

- `apps/web/src/lib/visibility-stats.ts:169-215` — `shareOfVoiceTimeSeriesLVCF`; el comentario del propio código (`:170-175`) explica que la serie se suaviza arrastrando el último valor de cada prompt por los días que no corrió, y cierra con «so staggered prompt schedules don't scallop the line». El mismo criterio en `:217-232` para el leaderboard.
- Está decidido y documentado, y tiene motivo (no castigar una línea por calendarios escalonados). Pero el efecto es que **un día sin medición se dibuja con el valor del día anterior**, y el hueco no se ve.

**Por qué nos importa.** No es un error: es una decisión de presentación con costo. Un cliente que mira la línea plana no puede saber si hubo nueve mediciones iguales o tres mediciones y seis días de silencio. Ellos, que empezaron con el problema simétrico (`measurement-methodology.md:122`: 「但 null 点先被过滤，前后有效点可能跨过缺失连接」 `[trad.: pero los puntos null se filtran primero y los puntos válidos de antes y después pueden conectar cruzando el tramo faltante]`), terminaron declarando el corte.

**Qué costaría.** Decisión de producto + un flag de presentación: dibujar el tramo arrastrado punteado y exponer los días sin medición. Sin migración.

### 3.6 · El paquete de evidencia reproducible de una medición

**Qué es.** Una lista explícita de lo que un número publicado debe llevar para que un tercero lo pueda reproducir: hashes por archivo, planeado contra ejecutado, costos —incluidos los desconocidos—, y las capturas con su hora de corrida, viewport y digest.

> 「全部 Run/ModelRun/Probe/Attempt ID、计划/实际时间、状态、请求参数、实际搜索信息。」
> 「逐文件相对路径、字节 Hash、原文与引用路径、组成指标的样本与排除原因。」
> 「全部尝试的费用、未知费用及重试说明，不能只累计最后成功尝试。」 — `evidence-model.md:133-135`
> `[trad.: todos los IDs de Run/ModelRun/Probe/Attempt, tiempos planeados/reales, estado, parámetros de request, información real de búsqueda. / ruta relativa de cada archivo, hash de bytes, texto original y rutas de citas, muestras y motivos de exclusión de cada indicador. / el costo de **todos** los intentos, los costos desconocidos y la explicación de los reintentos: no se puede acumular solo el último intento exitoso.]`

**Cómo está hoy en BeAOS.** Del lado producto tenemos una pieza real de esto: el bundle lleva `sha256` por asset, un hash de conjunto, y un comparador byte a byte — `packages/aos-aps/src/server/bundle.ts:55-57` (`sha256Hex`), `:72-75` (`bundleHash`) y `:164-169` (`assetMatches`). Lo que **no** tenemos es el formato de **caso de medición**: cómo se publica un número del APS o de visibilidad junto a sus respuestas crudas, hashes de archivo, planeado contra ejecutado y costos desconocidos.

**Por qué nos importa.** Es lo que convierte un reporte en algo auditable, y es justo lo que ellos todavía **no** tienen publicado (ver §4.1: su release sigue `blocked`). Es una ventaja latente para nosotros, no una derrota.

**Qué costaría.** Un documento primero (qué debe llevar una medición publicada) y recién después código. Es una decisión, no un sprint.

---

## 4 · Qué hacemos MEJOR que ellos — con la cita y el `archivo:línea`

No todo lo de abajo es una competencia directa: en varios casos es una capa que ellos no tienen. Lo digo en cada punto.

### 4.1 · Bundle firmado con Ed25519 y verificación del lado del agente

> 「报告的 `safeProviderResponse()` 目前只是 JSON 序列化检查，并不执行秘密或个人信息脱敏。」 — `evidence-model.md:140`
> `[trad.: el safeProviderResponse() del reporte hoy es solo una comprobación de serialización JSON y no hace desidentificación de secretos ni de datos personales.]`

> 「record Hash 使用 `sha256(JSON.stringify(value))`，**不是含缩进和末尾换行的文件字节 Hash**；公开证据包应另外计算文件 SHA-256。报告创建时的稳定性检查比较 Run/ModelRun 状态和当前 Attempt ID，不是跨文件事务或持续防篡改检测。」 — `evidence-model.md:121`
> `[trad.: el hash del record usa sha256(JSON.stringify(value)); no es el hash de los bytes del archivo con indentación y salto final. El paquete de evidencia público debe calcular aparte el SHA-256 del archivo. La comprobación de estabilidad al crear el reporte compara el estado de Run/ModelRun y el Attempt actual; no es una transacción entre archivos ni una detección de manipulación continua.]`

Lo nuestro, en código:

- `packages/aos-aps/src/provenance/sign.ts:124-137` — `signDetached` firma los bytes UTF-8 exactos del documento y publica `kid` + `public_key_url`.
- `packages/aos-aps/src/server/bundle.ts:8-10` — «The Ed25519 signature covers the exact bytes of brand.json […] A consumer that re-serializes the JSON breaks the signature; the hash is there to catch that before the file reaches a website.»
- `packages/aos-aps/src/server/bundle.ts:164-169` — `assetMatches` verifica el hash de lo que el consumidor está por montar.
- `packages/aos-aps/src/aos/signature.ts:90-143` — verificador completo, incluida la regla dura de `:122-126`: «A signature whose kid matches no published key cannot be attributed: never fall back to an unrelated key, or a rotated/retired signature would read as valid.»
- `packages/aos-aps/src/provenance/sign.ts:104-110` y `:148-169` — `keys.json` y el directorio de Web Bot Auth salen de la misma clave.

Ellos declaran las dos debilidades de su propio paquete de evidencia: el hash **no** es de bytes de archivo ni detección de manipulación continua, y su saneador de respuestas solo comprueba que el JSON se pueda serializar. Nuestro candado sí ata el contenido a una clave publicada. Es una ventaja real y verificable.

### 4.2 · El candado de publicación no es un compromiso: es una invariante del producto

> 「**状态：未修复，发布仍为 blocked / Unresolved; release remains blocked.**」 — `known-issues.md:3` · «Release commits, permanent public evidence and actual GitHub theme acceptance remain pending. Local rendering is not GitHub acceptance.» — `known-issues.md:147`

Su "gate" es un estado de proceso declarado en un documento. El nuestro devuelve **404** y se comprueba en cada llamada:

- `packages/aos-aps/src/db/schema.ts:28-33` — «Publication gate. Nothing is served or handed to a delivery agent until an operator publishes the entity explicitly: closed by default».
- `packages/aos-aps/src/server/bundle.ts:133-134` — `if (entity.isPublished !== true) return null;` y `:143` — sin `brand.json`, tampoco hay bundle parcial: «the caller answers 404, never a partial bundle».
- `apps/web/src/server/agent-assets-core.ts:561-570` — el gate, y `:609` — `if (decision.blocked) return { ok: false, … }`, apoyado en `apps/web/src/lib/claims-guard.ts:173-211`, que además distingue pruebas **propias** de **prestadas** (`:186-201`) para no bloquear un cambio honesto. Y `apps/web/src/lib/claims-guard.ts:170-171` fija el criterio: «Cuando falta información para comparar, **no bloquea y avisa**: el guardián protege de una regresión, no reemplaza la decisión del operador.»

### 4.3 · El juez no se cree a sí mismo: el *grounding* se verifica contra el texto

> 「**L06：K 推荐与首位尚未强制验证文字证据。** 判断直接采用模型的 recommendation 与 unique/tied 等结构化标签；null/无效 evidence 不会自动排除该样本，first offset 也未用于独立重排。」 — `limitations.md:36`
> `[trad.: L06: la recomendación y el primer puesto de K todavía no obligan a verificar la evidencia textual. El juicio toma directamente las etiquetas estructuradas recommendation y unique/tied del modelo; una evidencia nula o inválida no excluye automáticamente la muestra, y el offset del primero tampoco se usa para reordenar de forma independiente.]`

Eso es exactamente lo que nosotros construimos al revés:

- `packages/aos-aps/src/aps/robustness.ts:1-8` — «The Fase 1 judge reports `grounded` on its own word, and 50-90% of LLM answers are not actually backed by the sources they cite. So grounding is checked independently here, with a regex over the raw text rather than another model trusting itself».
- `packages/aos-aps/src/aps/robustness.ts:67` — `hasVerifiableSource` y `:76` — `RobustnessKind = "unsupported_grounding" | "injection"`.
- `packages/aos-aps/src/db/schema.ts:302-305` — `grounded` (lo que dijo el juez) y `sourceVerified` (el chequeo independiente) se guardan **separados**.
- `packages/aos-aps/src/aps/robustness.ts:22-30` — el detector de inyección está anotado con un caso real medido («a correct answer to a question about brand consulting was quarantined […] because a bullet read `- System prompts.`»): la lección de ajustar el falso positivo está en el código.

### 4.4 · La confianza se deriva del tamaño de muestra y está prohibido asignarla a mano

- `packages/aos-aps/src/preference/confidence.ts:1-6` — «Confidence is never self-assigned: a single named case is not a sample.»
- `packages/aos-aps/src/preference/confidence.ts:29-33` — `n < 2` ⇒ `null`; techo 0.95.
- `packages/aos-aps/src/claims/mapping.ts:17-20` — la confianza que escribió el operador **no se emite** al perfil.
- `packages/aos-aps/src/db/schema.ts:132-137` — y el esquema explica por qué: «el estándar deriva la confianza del tamaño de muestra (`metric.n`) y prohíbe asignarla a mano, así que un número propio sería un dato inventado».
- `packages/aos-aps/src/aos/requirements.ts:172-179` — el requisito `APS-CLAIM-04` ("Derived confidence", `MUST`) existe en el rubric.

**No lo pude verificar en ellos**: en las cuatro fuentes que leí no hay ningún requisito de confianza derivada. No digo que no exista en su producto — digo que no está en lo que leí.

### 4.5 · Costo real reconciliado contra el estimado, y el total incompleto declarado

> 「tokenLimit/costLimitUsd 在核心执行中未形成逐请求强制闸门」 / 「调度对账只累加每个 Probe 最新一次费用，可能遗漏之前重试的费用。」 — `limitations.md:52`
> `[trad.: el servicio de medición central principalmente comprueba que el número planeado inicial no supere requestLimit; dailyRequestLimit se revisa contra el libro de la tarea al vencer; tokenLimit/costLimitUsd no forman una compuerta forzada por request en la ejecución central. […] La conciliación del scheduler solo suma el último costo de cada Probe, así que puede omitir el costo de reintentos anteriores.]`

Nosotros sí lo tenemos en el producto:

- `packages/aos-aps/src/worker/budget.ts:1-14` — «estimate before spending, and refuse rather than degrade» + «A missing price is never guessed […] and the run does not start until they are configured.»
- `packages/aos-aps/src/aps/cost.ts:53-68` — `sumProviderCallCosts`: un costo `0` es una llamada conocida y gratis; `null` es faltante; el total es `null` si falta alguno.
- `packages/aos-aps/src/aps/cost.ts:121-141` — `compareEstimatedToActual` con el veredicto `incomplete` que **no afirma nada sobre el precio**.
- `packages/aos-aps/src/db/schema.ts:248-267` — `actual_measurement_usd`, `actual_judge_usd`, `unpriced_calls`, `costed_calls`, con el comentario: «**Null cuando el costo está incompleto**, y ahí es donde está el cuidado: si alguna llamada quedó sin costo, un total parcial no se guarda como si fuera el total.»
- `apps/worker/src/jobs/aps-query.ts:153-157` — el worker escribe esas columnas al cerrar la captura.

### 4.6 · AOS: un rubric de 19 requisitos con evidencia por señal, y los diagnósticos fuera del score

Ellos miden lo que el modelo dice. El AOS mide **qué declara la web y qué puede hacer un agente con ella**, y está partido en dos mitades explícitas:

- `packages/aos-aps/src/aos/requirements.ts:28-117` — 11 requisitos **puntuados** (`REQUIREMENTS`).
- `packages/aos-aps/src/aos/requirements.ts:123-188` — 8 **diagnósticos** (`EXTENDED_REQUIREMENTS`), con la regla en `:119-121`: «checked for the report but excluded from the score. A fail here is a real gap against the published standard; it is simply not part of the number Maasy also produces.»
- Total: **19** (`grep` de `id:` en el archivo: 11 + 8).
- `packages/aos-aps/src/aos/requirements.ts:196-203` — la evidencia por señal es presentación y **no** toca el score: «No participa de ningún puntaje — el score sigue saliendo solo de `probes`».
- `packages/aos-aps/src/aos/requirements.ts:281-302` — el desglose por eje sale de la **misma** cuenta que el número (`:346-359`), para que el número y su explicación no puedan discrepar; y `:332-344` calcula los puntos que devolvería cada check que hoy falla, con un test que verifica que suman `100 - score`.

### 4.7 · MCP para operar la marca: 27 herramientas, con el ciclo completo y sus dos reglas duras

Ellos ofrecen API JSON de lectura y lo dicen:

> 「当前产品提供 JSON 读取 API，没有通用的 PDF/CSV/公开证据包导出端点。」 — `evidence-model.md:127`
> `[trad.: el producto actual ofrece una API de lectura JSON; no hay un endpoint general de exportación a PDF/CSV ni de paquete de evidencia público.]`

Nuestro MCP tiene 27 herramientas (contadas con `grep` sobre `name:` en los tres archivos: 10 + 9 + 8):

- `apps/web/src/server/mcp/tools/index.ts:19` — `BEAOS_MCP_TOOLS = [...agentTools, ...platformTools, ...actionTools]`.
- `apps/web/src/server/mcp/tools/index.ts:31-32` — las `instructions` del servidor describen el ciclo entero (crear marca → entidad → sync DNA → `upsert_claim` → generar bundle → publicar) y las dos reglas que no se doblan: un perfil con menos pruebas que el sitio **se rechaza**, y BeAOS **no inventa pruebas**.
- `apps/web/src/server/mcp/tools/actions.ts:226` (`start_aps_run`), `:450` (`publish_agent_assets`), `:646` (`set_claim_inheritable`); `apps/web/src/server/mcp/tools/agent.ts:483` (`get_agent_bundle`), `:126` (`get_aos_audit`).

### 4.8 · Identidad por producto e aislamiento por fila (con una salvedad que también verifico)

> 「当前没有登录、访问控制、TLS、多租户授权或完整路径安全审计；项目 ID/父级检查是组织数据的校验，不是公开部署的租户隔离。」 — `limitations.md:70`
> `[trad.: hoy no hay login, control de acceso, TLS, autorización multi-tenant ni auditoría completa de seguridad de rutas; la comprobación de ID/padre de proyecto es una validación para organizar datos, no aislamiento de inquilinos para un despliegue público.]`

Lo nuestro:

- `packages/aos-aps/src/db/schema.ts:359-374` — `agent_api_tokens`: token **por producto**, guardado como `sha256` («El token en claro nunca se guarda»), con `prefix` para listarlo y `revokedAt` que no borra la fila.
- `packages/lib/src/db/schema.ts` — 10 tablas con `.enableRLS()`: líneas `59, 82, 97, 134, 173, 194, 215, 315, 349, 372`.
- **Salvedad medida, no supuesta:** `packages/aos-aps/src/db/schema.ts` tiene **cero** ocurrencias de `enableRLS`. El aislamiento por fila cubre el esquema de producto, no las tablas AOS/APS. Lo digo porque este documento no sirve si infla.

---

## 5 · Qué NO copiaríamos, y por qué

**5.1 · Su capa de proveedores, no.** Ellos van por OpenRouter:

> 「当前产品走 OpenRouter，实际采用哪类字段以该 Attempt 响应与适配器为准。」 — `evidence-model.md:79`
> `[trad.: el producto actual va por OpenRouter; qué tipo de campo se usa en la práctica depende de la respuesta de ese Attempt y del adaptador.]`

Nosotros ya tenemos una capa propia con un adaptador por proveedor (`packages/lib/src/providers/index.ts`, `packages/lib/src/providers/registry/*.ts`) y un parser de configuración único (`packages/config/src/scrape-targets.ts:1-9`). Meter una segunda capa al lado es duplicar exactamente el problema que venimos curando: dos lugares que dicen qué modelo contestó y con qué proveedor. **Leemos las ideas; no vendorizamos el transporte.**

**5.2 · Su código, tampoco — por licencia.** El `LICENSE` del repo es **Apache-2.0** (verificado en el repositorio, no de oído). Leer ideas es gratis; copiar archivos a un fork público obliga a conservar `NOTICE` y atribución, y a arrastrar el aviso a los derivados. **Este documento no copia texto suyo**: cita entre comillas, con archivo:línea y traducción marcada, y parafrasea el resto. Es la misma disciplina que el resto del repo.

**5.3 · Su esquema de hash como si fuera "evidencia inmutable".** Ellos mismos avisan que su record hash es `sha256(JSON.stringify(value))` y **no** un hash de bytes de archivo, y que la comprobación de estabilidad no es detección de manipulación continua (`evidence-model.md:121`). Copiarlo tal cual nos daría una garantía **más débil** que la firma que ya emitimos.

**5.4 · Su caso de 20 dominios como benchmark de mercado.** Ellos lo aclaran dos veces:

> 「Phase 6 的 20 域名是定向的软件/互联网产品集合，不是随机市场样本，不支持全行业结论。」 — `measurement-methodology.md:133`
> `[trad.: los 20 dominios de la Phase 6 son un conjunto dirigido de productos de software/internet, no una muestra de mercado aleatoria, y no sostienen conclusiones de toda la industria.]`

Tomar ese número como referencia de industria sería convertir un caso en un claim. Justo lo que el resto de este documento evita.

**5.5 · Su UI.** Su `L16` declara la UI no del todo bilingüe y las fechas de medición fijas a `zh-CN` (`limitations.md:66`). No es un problema para ellos, pero nuestras rutas ya resuelven locale (`apps/web/src/lib/app-locale.ts`); importar su capa de presentación sería adoptar un límite ajeno sin necesidad.

**5.6 · Sus supuestos de despliegue, nunca.** `limitations.md:70` — sin login, sin control de acceso, sin TLS, sin multi-tenant. Nuestro candado de publicación y nuestro bundle firmado **dependen** de que haya identidad y aislamiento; adoptar ese supuesto desarmaría lo mejor que tenemos.

---

## 6 · Tres recomendaciones concretas, en orden

Las tres se pueden empezar mañana y ninguna necesita reescribir nada.

### R1 — Persistir el modelo que contestó, y llamar `unknown` a lo que no se sabe

**Qué:** que `agent_aps_observations` tenga `model_version_reported` (nullable) separado de `model` (el pedido), y que el `invoke` del APS deje de tirar `result.modelVersion` a la basura.

**Dónde:** `apps/worker/src/jobs/aps-query.ts:107-117` (hoy devuelve solo texto), `apps/worker/src/jobs/aps-query.ts:140` (hoy persiste el pedido), `packages/aos-aps/src/aps/targets.ts:28` (`ProviderInvoker`), `packages/aos-aps/src/db/schema.ts:286-312` (columnas nuevas). En la misma pasada, partir `prompt_runs.version` (`packages/lib/src/db/schema.ts:111`, escrito en `apps/worker/src/jobs/process-prompt.ts:249`) en pedido y reportado.

**Criterio de aceptación:** un target por `brightdata`/`dataforseo` muestra `model_version_reported = null` y la UI dice **"el proveedor no lo informó"**; nunca el nombre que pedimos haciéndose pasar por el que contestó. Y un `openrouter` guarda la versión resuelta (`data.model`, `packages/lib/src/providers/registry/openrouter.ts:183`) además del alias.

### R2 — Que el fallo se vea como fallo en la capa de visibilidad

**Qué:** planeado, ejecutado y fallido por ciclo, y un estado de punto `complete | partial | no_data` en la visibilidad, igual que el APS ya lo hace.

**Dónde:** el APS es el modelo a copiar de nosotros mismos — `packages/aos-aps/src/aps/runPlan.ts:138-149` y `apps/worker/src/jobs/aps-score.ts:62-63` y `:107`. Falta del lado de prompts: `apps/worker/src/jobs/process-prompt.ts:339-356` (hoy los fallos solo se loguean y van a telemetría) y `packages/lib/src/report-metrics.ts:10-14` (el tipo de entrada no tiene `planned` ni `failed`).

**Criterio de aceptación:** un ciclo con 9 corridas planeadas y 6 exitosas se muestra como **parcial 6/9**, no como un SoV calculado sobre 6.

### R3 — Guardar las condiciones de la llamada

**Qué:** `temperature`, `max_tokens` y el modo real de búsqueda (`native | sdk | unverified`) por llamada, más el hash del prompt del juez.

**Dónde:** columnas nuevas en `provider_calls` (`packages/lib/src/db/schema.ts:236-304`), que hoy no tiene ninguna; los valores ya existen en el código (`packages/aos-aps/src/aps/gateway.ts:254-255` y `:425-426`); el modo de búsqueda se lee de `openrouter_metadata.pipeline` en `packages/lib/src/providers/registry/openrouter.ts` — hoy no se lee en ningún lado (verificado por grep).

**Criterio de aceptación:** ante un salto de serie, la primera pantalla que se mira responde si cambió el modelo, la temperature o el modo de búsqueda, sin abrir el código.

---

## Lo que NO pude verificar (y por eso no lo afirmo)

Esta sección es parte del entregable, no un apéndice.

1. **Que BeAOS no tenga ningún registro del modo de ejecución de búsqueda en otra parte del repo.** Verifiqué que no hay columna y que un grep de `executionMode`, `openrouter_metadata` y `server_tool` sobre `packages/lib/src` y `packages/aos-aps/src` no encuentra un clasificador. Digo **"no lo encontré"**, no "no existe".
2. **El estado de punto en la UI de visibilidad.** Leí los módulos de estadística (`apps/web/src/lib/visibility-stats.ts`, `packages/lib/src/report-metrics.ts`), no todas las rutas y componentes. Puede haber una etiqueta de "parcial" en pantalla que no vi.
3. **Que `provider_calls` registre el 100% de los fallos.** El registro es *best-effort* a propósito: `packages/lib/src/providers/usage.ts:105-107` se traga su propio error con un `console.warn`. Verifiqué el `try/catch`; **no medí** cuántos fallos se pierden en la práctica.
4. **Que NiubiGEO no tenga bundle firmado.** Leí 4 de las 36 entradas de `docs/` y no audité su código. `APS-PROV-01` ("Ed25519 signature verifies") es un requisito de **nuestro** rubric; que sea también una capacidad suya **no lo pude verificar**.
5. **Si su conflicto de "primer nombre único" está resuelto.** Sus propios documentos se contradicen: `known-issues.md:3` dice que sigue sin resolver y `limitations.md:30` describe una corrección ya aplicada. Reporto la contradicción y **no** la resuelvo.
6. **Su licencia en dependencias.** Verifiqué el `LICENSE` del repo (Apache-2.0) y el `spdx_id` de GitHub. No audité su árbol de dependencias ni los avisos de terceros.
7. **Nada de esto se probó ejecutando.** No corrí la suite de BeAOS, ni su código, ni ningún test end-to-end. Todo lo afirmado sobre BeAOS sale de leer archivos en este checkout.
