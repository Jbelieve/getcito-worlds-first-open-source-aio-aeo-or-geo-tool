# Manual de uso — AOS y APS en BeAOS

> Para quien opera el marketing, no para quien programa. Explica qué mide cada cosa, en qué orden se
> usa, cómo se leen los números, cuánto cuesta y con qué te vas a chocar.
>
> Última actualización: 2026-09-23 · Estado del producto: en uso, con piezas pendientes bien marcadas.

---

## 0. Lo primero: qué cambió respecto de Maasy

Antes el trabajo se hacía desde Maasy. Ahora **el AOS y el APS se corren y se leen desde BeAOS**, que es
la aplicación web (`beaos.believe-global.com`). Maasy no desaparece: cambia de rol.

| | Dónde vive ahora | Nota |
|---|---|---|
| **Auditoría AOS** | BeAOS | Reporta **el mismo número** que la auditoría de Maasy. Si difieren, es un bug: avisar. |
| **APS del perfil declarado** | BeAOS | Sale de los claims y proofs del sitio. Se calcula, no se mide. Es gratis. |
| **APS medido** | BeAOS | Se mide contra modelos reales. Corre **a demanda**, no por barrido. |
| **Assets firmados** | BeAOS los genera y los sirve | La puerta de publicación está **cerrada por defecto**. |
| **Operador / MCP** | **Maasy sigue siendo la puerta MCP** | El snippet del operador todavía se pide a Maasy. En BeAOS está pendiente (§8). |

**Regla práctica:** si es medir o generar, se hace en BeAOS. Si es exponer el operador a un agente, eso
sigue pasando por Maasy.

---

## 1. Los cuatro conceptos, en una línea cada uno

- **AOS (Agent Operability Score)** — ¿puede un agente de IA *operar* tu sitio? Se audita el sitio real.
  Va de 0 a 100.
- **APS declarado** — ¿qué *declara* tu sitio sobre sí mismo? Sale de los `claims` y `proofs` del
  `brand.json`. Determinístico y gratis.
- **APS medido** — ¿los modelos te *prefieren* de verdad cuando un comprador pregunta sin nombrarte? Se
  mide con llamadas reales a los asistentes.
- **Assets / entidad** — los archivos que le entregás a un agente (`llms.txt`, `AGENTS.md`,
  `agent-card.json`, `brand.json` firmado), por entidad, con puerta de publicación.

**Los dos APS no son lo mismo y nunca se mezclan.** Uno es lo que decís; el otro es lo que pasa. La
diferencia entre los dos suele ser la historia más útil del tablero: podés declarar 94 y medir 34.

---

## 2. El orden en que se usa (el flujo mental)

```
1. Settings → Brand         poné mercado e idioma ANTES de generar nada
2. Settings → Prompts       cargá las preguntas que te importa ganar (en tu idioma)
3. Settings → Competitors   cargá contra quién competís de verdad
        ↓
4. AOS                      auditá el sitio: ¿te pueden operar?
5. APS                      medí si te prefieren (biblioteca → corrida → resultados)
6. Opportunities            leé qué hacer con eso
        ↓
7. Agent Entities           vinculá el proyecto de Maasy
8. Agent Assets             generá los archivos y publicalos
```

El orden importa por una razón concreta: **el idioma y el mercado se leen cuando se genera el
contenido**. Si generás prompts antes de configurarlos, salen en el idioma del modelo (inglés) y hay
que rehacerlos.

---

## 3. Las secciones, una por una

### 3.1 Overview — el tablero

Lo primero que ves al entrar. Arriba están **las dos tarjetas que importan**: AOS y APS, con su número
grande, su banda y lo que falta. Debajo, la visibilidad heredada de Getcito (visibilidad general, share
of voice) y los reportes.

**Cómo se lee una banda:**

| Banda AOS | Significa |
|---|---|
| **Operable** | Un agente puede encontrarte, entenderte y operarte. |
| **Intentable** | Te encuentra y te entiende, pero no puede hacer mucho con vos. |
| **Bloqueado** | Te ve a medias: falta lo mínimo para que pueda operar. |
| **Inerte** | Invisible. No hay nada que leer ni operar. |

| Banda APS | Significa |
|---|---|
| **Agent-Native** (85+) | Los modelos te prefieren y te recomiendan. |
| **Agent-Ready** (70–84) | Te recomiendan con matices. |
| **Agent-Visible** (50–69) | Te nombran, pero no te eligen. |
| **Agent-Opaque** (25–49) | Aparecés poco y sin recomendación. |
| **Agent-Blind** (0–24) | No existís para el asistente. |

### 3.2 AOS — auditar el sitio

Poné la URL y dale **Auditar AOS**. El resultado tiene cuatro partes:

1. **El anillo con el número** — 0 a 100. Es el mismo número que da Maasy.
2. **El diagnóstico en una frase** — escrito para que se entienda sin saber qué es un "rubric".
3. **El camino de un agente** — cuatro etapas: *te encuentran → te entienden → pueden actuar → te
   prefieren*. Cada una con sus puntos y **lo concreto que falta**, con la instrucción de cómo
   arreglarlo.
4. **El próximo paso** — la falla más pesada, con qué hacer. Es lo único marcado en cian: si mirás una
   sola cosa de la pantalla, mirá eso.

**Dos cosas que tenés que saber del número:**

- El puntaje son **11 requerimientos puntuados**. El estándar tiene 18; los otros 7 se muestran aparte
  como *diagnóstico* y **no mueven el número**. Si ves "fuera del puntaje", es eso.
- Si el sitio se evalúa como **producto/API** o como **marca**, cambia qué requerimientos aplican. Se
  detecta solo.

Abajo está el **historial** de auditorías. Corre cuando vos querés: apretá el botón.

### 3.3 APS — medir si te prefieren

Es la sección más larga y la que más cuidado necesita. Son **tres pasos numerados**, en orden.

#### Paso 1 · Biblioteca de prompts

Son **las preguntas que un comprador real le hace a un asistente sin nombrar tu marca** — por ejemplo
*"¿qué consultora me ayuda a que mi marca aparezca en ChatGPT?"*. Si el prompt nombrara tu marca, la
respuesta estaría contaminada y no mediría nada.

- **Generar 50 prompts de compra** → revisalos → **Guardar y bloquear 90 días**.
- La mezcla objetivo es **50% comparación / 30% caso de uso / 20% categoría**.
- Al guardar, la biblioteca queda **bloqueada 90 días**. Es a propósito: el instrumento de medición no
  puede cambiar entre mediciones, o dejás de poder comparar. Cambiarla antes requiere una acción
  explícita de reemplazo.
- Los prompts se generan **en el idioma de la marca** (configurado en Settings → Brand).

#### Paso 2 · Corrida

Primero **Estimar corrida**: te dice cuántas llamadas y cuánto va a costar **antes de gastar nada**.
Nada se ejecuta hasta que aprietes **Confirmar y ejecutar**.

- Corre **a demanda**. No hay barrido automático ni gasto de fondo.
- Arriba ves el presupuesto del gateway: gastado, tope y cuándo reinicia.

#### Paso 3 · Resultados

Un bloque **por modelo**. El APS **nunca mezcla respuestas de modelos distintos**, así que cada modelo
tiene su propio score, su banda y su distribución. Comparar un modelo contra otro no tiene sentido: se
comparan contra sí mismos en el tiempo.

Lo que vas a ver por modelo:

- **El número y la banda.**
- **La banda P10–P50–P90**: el rango donde probablemente está el valor real. Si el rango es ancho, la
  medición es inestable; si es angosto, es sólida.
- **De dónde sale el score** — cinco dimensiones con su peso:

| Dimensión | Peso | Qué mide |
|---|---|---|
| Descubrimiento | 25 | Cuántas veces te nombran en respuestas a prompts de compra. |
| Inteligencia estructurada | 20 | Si las respuestas que te mencionan citan fuentes verificables. |
| Capacidad de acción | 20 | Tu AOS: si un agente puede operar el sitio. |
| Autoridad de fuente | 20 | Posición en el ranking y cuántos competidores aparecen al lado. |
| Reputación agéntica | 15 | Si te recomiendan explícitamente y con qué sentimiento. |

- **La distribución** (histograma): la forma de la incertidumbre. Necesita **2 o más repeticiones** por
  prompt; con una sola, todas las remuestras dan el mismo valor y no hay forma que mostrar.
- **Las 6 sub-métricas medidas**: cobertura, recomendación, posición, sentimiento, grounding y amplitud
  competitiva.

**Una corrida parcial está permitida y se marca como tal.** Si un proveedor se cuelga o se corta el
presupuesto, el score se guarda igual pero dice **PARCIAL** y por qué. Un parcial **nunca** se presenta
como completo: no lo compares como si lo fuera.

### 3.4 Agent Entities — vincular Maasy

Acá se asocian **los proyectos de Maasy a la marca de BeAOS**. El APS se mide **por entidad**, con la
biblioteca de esa entidad. Si no hay entidad vinculada, no hay dónde medir.

### 3.5 Agent Assets — generar y publicar

1. Elegí la entidad y apretá **Generar assets**. Se generan los archivos base: `llms.txt`,
   `AGENTS.md`, `agent-card.json` y `brand.json` (firmado).
2. Abajo ves **última versión por archivo**, con su ruta, su tipo y el hash.
3. **La publicación está cerrada por defecto.** Nada se sirve hasta que aprietes **Publicar**, y podés
   **Despublicar** cuando quieras. Es un interruptor explícito a propósito: no querés que un archivo a
   medio hacer quede expuesto a los agentes.

### 3.6 Opportunities — qué hacer con todo esto

Un reporte escrito por IA sobre **dónde están las brechas**: qué prompts no ganás, quién te gana, qué
superficies (medios, directorios, foros) están alimentando las respuestas, y en qué orden atacarlas.
Viene con **riesgos** — cosas que no conviene intentar (editar Wikipedia, reseñas incentivadas).

**Nace en el idioma de la marca y se refresca solo cada ~6 días.** Si no lo ves actualizado, es que
todavía no venció el caché.

### 3.7 Settings — donde se configura lo que después se mide

- **Brand** — nombre, sitio, **mercado objetivo** e **idioma objetivo**. Esto último es crítico: define
  el idioma de todo lo que se genere (prompts, descripciones, reporte).
- **Competitors** — contra quién competís. **Revisalo seguido**: los competidores no cambian lo que
  responde el asistente, pero sí **qué marcas se detectan** en la respuesta. Si falta un competidor real,
  tu share of voice se ve mejor de lo que es.
- **Prompts** — las preguntas que seguís. Se pueden cargar y editar a mano; el APS usa su propia
  biblioteca bloqueada, esto es para la visibilidad general.
- **LLMs** — qué modelos se consultan.

---

## 4. Qué consume un agente (para el equipo técnico)

Cuando publicás, BeAOS sirve los archivos en dos vías:

- **Pública, sin credenciales:** `/agent/<entityId>/...` — incluye
  `/.well-known/brand.json` y el resto de los assets del bundle.
- **Con API key, para Maasy:** `GET /api/v1/agent-assets/<entityId>` devuelve el **manifiesto** (bytes
  exactos, `sha256` e identidad de firma), y `.../raw?path=...` entrega el contenido.

La firma es **Ed25519**. Las sub-marcas **heredan la llave canónica del umbrella** y apuntan su
`keys_uri` al umbrella, así que una firma de sub-marca se verifica contra la misma identidad.

---

## 5. Cuánto cuesta (medido, no estimado)

| Qué | Costo |
|---|---|
| Juez (por respuesta analizada) | **USD 0.0014** |
| Generar la biblioteca (50 prompts) | **USD 0.0077** |
| Corrida de humo completa (biblioteca + 24 mediciones + 10 juicios) | **≈ USD 0.03** |
| Gateway | Tope **USD 50 / 30 días**, reinicia el 2026-10-01 |

**Los modelos de medición (OpenAI, Anthropic, BrightData) no pasan por el gateway**, así que su costo
sale de la factura. Por eso hay una lista de precios configurada: **un modelo sin precio bloquea el
plan** — es a propósito, para que no se gaste a ciegas.

**No hay tope diario.** Las corridas son eventos a demanda, no un gasto continuo. El tope por corrida
existe y hoy es de USD 5.

---

## 6. Cosas que te van a morder (leé esto antes de frustrarte)

1. **El idioma se decide al generar, no al mostrar.** Si generás prompts con el mercado/idioma en
   blanco, salen en inglés y hay que rehacerlos. Configurá Brand primero, siempre.
2. **Un modelo sin saldo o caído se ve como "parcial", no como error.** Hoy: Anthropic ya tiene saldo
   (Claude corre), y **Perplexity está casi mudo** (2 de 32 respuestas en la última corrida). No es tu
   culpa ni del prompt.
3. **El reporte de Opportunities vence ~cada 6 días.** Si cambiaste algo grande y el reporte sigue
   viejo, esperá el refresh.
4. **La biblioteca de prompts queda bloqueada 90 días.** Es la garantía de comparabilidad. Si la
   cambiás, las mediciones anteriores dejan de ser comparables.
5. **La puerta de publicación arranca cerrada.** Si un agente "no ve nada", lo primero que hay que
   mirar es si el asset está publicado.
6. **Los precios de los modelos de medición son provisionales** hasta que llegue la factura real. Si el
   total estimado te parece raro, puede ser eso.
7. **El AOS depende de que el sitio sirva lo que dice servir.** Falla clásica: el sitio tiene
   `/agents.md` en minúscula y los scanners buscan `/AGENTS.md` en mayúscula. Se arregla con un alias.

---

## 7. Recetas rápidas

**"Quiero saber si mi sitio está listo para agentes"**
→ AOS → Auditar AOS. Mirá el anillo y leé **El próximo paso**. Nada más.

**"Quiero saber si la IA me recomienda"**
→ APS → Generar biblioteca → revisar → Guardar → Estimar → Confirmar. Después leé la banda y el
P10–P90 del modelo que te importa.

**"Quiero que un agente pueda leer mi marca"**
→ Agent Entities (vincular) → Agent Assets → Generar → **Publicar**.

**"Quiero saber contra quién pierdo"**
→ Settings → Competitors (revisá que estén los reales) → Opportunities.

**"Quiero entender por qué mi APS es bajo"**
→ APS → Resultados → **De dónde sale el score**. Mirá qué dimensión está floja: si es *Capacidad de
acción*, el problema es tu AOS, no tu narrativa.

---

## 8. Lo que todavía NO existe (no lo busques)

- **El snippet del operador desde BeAOS.** Hoy se pide a Maasy. La decisión es que BeAOS lo pida a
  Maasy por MCP, y cuando el sitio no está registrado, Maasy devuelve un aviso en vez de un snippet.
- **La tarjeta MCP propia.** El bundle no emite `/.well-known/mcp/server-card.json`.
- **El botón de regenerar la biblioteca** después del bloqueo de 90 días (existe la operación por
  debajo, falta el botón con confirmación).
- **El score legacy de Maasy (76).** Es otra escala; hoy BeAOS reporta la escala comparable (89 para
  `believe-global.com`). Falta decidir si se muestra al lado.

---

## 9. Glosario

- **AOS** — Agent Operability Score. Si un agente puede operar tu sitio.
- **APS** — Agent Preference Score. Si los modelos te prefieren. Hay dos: el declarado y el medido.
- **Banda** — el nivel en que cae un score (Operable, Agent-Ready, etc.).
- **Bootstrap / P10–P50–P90** — el rango donde probablemente está el valor real, calculado remuestreando
  las respuestas. Mide qué tan sólida es la medición, no qué tan buena es tu marca.
- **Claims y proofs** — lo que tu sitio declara sobre sí mismo y la evidencia que lo sostiene. Es la
  base del APS declarado.
- **Entidad** — la marca o producto concreto que se mide. En BeAOS se vincula a un proyecto de Maasy.
- **Prompt unaided** — pregunta de compra que **no nombra la marca**. Es la única forma de medir si te
  mencionan por mérito.
- **Rubric** — la lista de requerimientos que puntúan. Compartida con Maasy: mismos 11, mismos pesos.
- **Bundle** — el conjunto de assets publicados de una entidad.
- **Gate de publicación** — el interruptor que decide si el bundle se sirve. Cerrado por defecto.

---

## 10. Si algo no cuadra

| Síntoma | Qué mirar primero |
|---|---|
| AOS de BeAOS ≠ AOS de Maasy | Es un bug. Reportarlo: nunca deberían diferir. |
| APS sin resultados | ¿Hay entidad vinculada? ¿Hay biblioteca guardada? ¿La corrida terminó? |
| Un modelo no aparece | Puede estar sin saldo o caído: mirá si la corrida quedó **PARCIAL**. |
| Un agente no ve la marca | ¿Está **publicado**? ¿El sitio sirve los archivos en la ruta exacta? |
| Todo salió en inglés | El mercado/idioma estaba vacío **cuando se generó**. Configurá y regenerá. |
| El reporte no cambia | Caché de ~6 días. |
