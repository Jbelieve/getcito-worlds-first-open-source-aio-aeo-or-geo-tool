# Manual de BeAOS

**Para quién es:** cualquier persona del equipo de Believe que vaya a usar BeAOS de verdad — marketing,
cuenta, especialista AOS/APS, desarrollo o administración. No hace falta saber programar para usar la
mayor parte del producto.

**Dónde vive:** la app es `https://beaos.believe-global.com` y la landing pública es
`https://be-aos.believe-global.com`. Son **dos hosts con dos papeles**: la landing es de marca; la app
tiene sesión y ahí vive también la API.

**Cómo está escrito, y esto importa:** **cada número, cada ruta, cada nombre de pantalla y cada límite de
este manual se leyó del código**, no de la memoria ni de un manual anterior. Al final hay una sección
(§16) que dice de qué archivo sale cada cosa. Lo que no se pudo leer del código está dicho como
**a confirmar**, nunca rellenado con un número plausible.

Este manual reemplaza a cinco documentos que se pisaban entre sí. Si algo de acá no se entiende, el
problema es el manual: marcá la línea y decilo.

---

## Índice

1. [Cómo usar este manual](#1-cómo-usar-este-manual)
2. [BeAOS en una frase](#2-beaos-en-una-frase)
3. [Diccionario: las palabras, y de dónde viene cada una](#3-diccionario-las-palabras-y-de-dónde-viene-cada-una)
4. [Las tres capas, sin mezclarlas](#4-las-tres-capas-sin-mezclarlas)
5. [El mapa: ¿dónde voy para qué?](#5-el-mapa-dónde-voy-para-qué)
6. [Sección por sección](#6-sección-por-sección)
7. [Resultado por resultado: cómo se lee cada número](#7-resultado-por-resultado-cómo-se-lee-cada-número)
8. [Integración por integración](#8-integración-por-integración)
9. [Lo que BeAOS NO hace](#9-lo-que-beaos-no-hace)
10. [Recetas completas, de principio a fin](#10-recetas-completas-de-principio-a-fin)
11. [Cadencias y trabajos de fondo](#11-cadencias-y-trabajos-de-fondo)
12. [Variables de entorno y operación](#12-variables-de-entorno-y-operación)
13. [Cuando algo sale mal](#13-cuando-algo-sale-mal)
14. [Cómo reportar feedback que sirva](#14-cómo-reportar-feedback-que-sirva)
15. [Estado actual y lo que sigue sin respuesta](#15-estado-actual-y-lo-que-sigue-sin-respuesta)
16. [De dónde sale cada número de este manual](#16-de-dónde-sale-cada-número-de-este-manual)

---

## 1. Cómo usar este manual

- **Primera vez:** leé **§2, §3 y §4**. Con eso ya entendés el producto y, sobre todo, el vocabulario.
- **Vas a usar una pantalla concreta:** andá al **§5** (el mapa) y de ahí a **§6**.
- **No entendés un número que estás viendo:** **§7**.
- **Se rompió algo:** **§13**.
- **Vas a probar el producto para darnos feedback:** **§14**. Es la sección más importante para nosotros.
- **Dudás de un dato:** **§16** dice de dónde salió.

---

## 2. BeAOS en una frase

**BeAOS mide y construye la cara de una marca para los agentes de IA.**

La idea de fondo: hoy una persona entra a una web y compra. Un agente entra **por vos**: lee, compara y
recomienda. Si un agente no puede **entender** tu marca ni **verificar** lo que decís, no te recomienda:
recomienda a otro.

BeAOS responde cuatro preguntas, y cada una tiene su pantalla:

| Pregunta | Se llama | Pantalla |
|---|---|---|
| ¿Puede un agente **usar** esta web? | **AOS** | AOS |
| ¿Los asistentes **prefieren** esta marca? | **APS** (medido) | APS |
| ¿Qué **declara** esta marca de sí misma, y con qué prueba? | **APS declarado** y **Pruebas** | Pruebas |
| ¿Qué **archivos** le faltan publicar para que todo eso sea cierto? | **El bundle** | Agent Assets |

Y una quinta, que es la que más se va a usar para pasarle trabajo a alguien:

| Pregunta | Se llama | Pantalla |
|---|---|---|
| ¿Qué hay que hacer, quién lo hace y en qué orden? | **El Plan** | Plan |

### 2.1 Quién hace qué

| Rol | Qué usa | Qué decide |
|---|---|---|
| **Marketing / cuenta** | Overview, Visibility, Share of Voice, Opportunities, Reports | Qué medir, qué reportar al cliente |
| **Especialista AOS/APS** | AOS, APS, Pruebas | Qué se publica y con qué pruebas |
| **Desarrollador** | Plan (las tarjetas "Lo hace tu desarrollador") | Cómo montar los archivos y las cabeceras en la web |
| **Admin** | Admin, Agent Entities | Marcas, credenciales, colas |

**La sección que se le pasa a un desarrollador es Plan.** Cada tarjeta se explica sola: qué es, por qué
existe, los pasos, el detalle exacto, el código para copiar y cómo comprobar que quedó.

---

## 3. Diccionario: las palabras, y de dónde viene cada una

**Esta sección va primero a propósito.** La causa número uno de confusión en BeAOS no es que falte una
pantalla: es que **conviven dos vocabularios de dos épocas distintas en la misma pantalla**. El monitoreo
heredado habla de *prompts*, *competidores*, *cadencias* y *runs*. La capa nueva habla de *claims*,
*entidades* y *bundles*. Son dos modelos mentales, y mezclarlos hace que nada cierre.

La columna **"de dónde viene"** es la que resuelve la confusión:

| Palabra | Qué es, en humano | De dónde viene |
|---|---|---|
| **Getcito** | La plataforma open source de visibilidad en buscadores con IA sobre la que está construido todo esto. Es la **mitad heredada**: monitoreo, menciones, citas, reportes. | Getcito |
| **BeAOS** | Esta instancia, más la **capa de agentes** que Believe construyó encima. | BeAOS |
| **Prompt** | La pregunta que BeAOS le hace a un motor de IA para ver si la marca aparece. Es del monitoreo. | Getcito |
| **Competidor** | Otra marca contra la que se compara en el monitoreo. Sirve para *share of voice*, no para el AOS. | Getcito |
| **Cadencia** | Cada cuánto se vuelve a correr. **Es por marca, no por prompt** (ver §11). | Getcito |
| **Run / corrida** | Una ejecución. Hay dos tipos y no se parecen: la corrida **de visibilidad** (monitoreo, automática) y la **corrida de APS** (medición contra modelos, a demanda y con costo). | Getcito (visibilidad) / BeAOS (APS) |
| **Snapshot** | El resultado guardado de una corrida de visibilidad, con fecha. | Getcito |
| **Citation** | Fuente que el motor citó al responder. | Getcito |
| **Share of Voice (SoV)** | Qué porción de las menciones se lleva la marca contra sus competidores. | Getcito |
| **AOS** | *Agent Operability Score.* ¿Puede un agente **usar** la web? 0 a 100. Auditado contra el sitio real. | BeAOS / estándar |
| **APS** | *Agent Preference Score.* Qué tanto te **prefieren** los asistentes. **Hay tres números distintos que se llaman APS** y hay que separarlos: ver el recuadro de abajo. | BeAOS / estándar |
| **APS declarado** | Lo que la marca **declara** de sí misma en su perfil firmado (`brand.json`). Se calcula desde los claims y proofs. Determinístico, gratis, sin llamadas a modelos. | BeAOS |
| **APS medido** | Lo que **modelos reales responden** cuando alguien pregunta por la categoría sin nombrar la marca. Se mide con llamadas reales y **cuesta plata**. | BeAOS |
| **APS del estándar** (`apsStandards`) | En el audit público y en la extensión: cuántos de los **requisitos del eje APS** del estándar cumple el sitio (claim/proofs publicados y firma verificable). Es un chequeo del sitio, **no** una medición contra modelos. | estándar (los mismos checks que audita Maasy) |
| **Claim / prueba** | Una afirmación de la marca que se puede verificar: *"aumentamos la conversión 35%"*. En la pantalla se llama **Prueba**. | BeAOS / estándar |
| **Proof** | La evidencia que sostiene un claim: el documento, el caso, el testimonio. Va **dentro** de la prueba, no es una pantalla aparte. | BeAOS / estándar |
| **Boundary / límite** | Cuándo **sí** y cuándo **no** aplica una prueba. Es lo que la vuelve honesta, y el estándar lo exige (`APS-CLAIM-02`). | estándar |
| **Entidad** | La **superficie agéntica** de una marca: el paraguas o un producto. Una marca puede tener varias, cada una con **su** web, su perfil y su publicación. | BeAOS |
| **Marca (brand)** | La marca como tal, en Configuración → Brand. Tiene su web. **No es lo mismo que la entidad.** | Getcito |
| **Bundle** | El conjunto de archivos que la entidad publica para los agentes. Hasta **15 archivos**, y no siempre salen todos (ver §8.2). | BeAOS |
| **Gate / candado** | La regla de que **nada se publica sin una persona**, y de que nunca se publica algo **peor** que lo que la web ya sirve. Cerrado por defecto. | BeAOS |
| **DNA** | El contexto de marca que BeAOS sincroniza desde Maasy: identidad, tono, ICP, oferta, resultados. | Maasy |
| **Maasy** | El sistema del que BeAOS saca los datos de la marca. En la capa de agentes, es una **fuente de datos**, no la puerta de publicación. | Maasy |
| **MCP** | La puerta para que **otros productos** (Maasy, BeAds, el agente de una marca) usen BeAOS sin programar una integración. No es una pantalla: es una conexión. | BeAOS |
| **Bot Beacon** | Tráfico agéntico real de un sitio. **BeAOS no tiene fuente para esto**: el campo existe y hoy vale `null` (ver §9). | Maasy (era su instrumento) |

### El recuadro que hay que leer: "APS" son tres cosas

| Nombre | Qué mide | Dónde se ve | ¿Cuesta? |
|---|---|---|---|
| **APS declarado** | Lo que el **sitio declara** (claims + proofs del `brand.json`) | Pantalla **Pruebas**, reporte (bloque "Declarado") | No |
| **APS del estándar** (`apsStandards`) | Cuántos requisitos del **eje APS del estándar** cumple el sitio | Audit público y popup de la extensión (puntajes por eje) | No |
| **APS medido** | Lo que **responden los modelos** de verdad | Pantalla **APS**, reporte (bloque "Medido") | **Sí** |

**Los tres se llaman "APS" y ninguno es el otro.** El declarado y el medido **nunca se suman**: uno es lo
que decís, el otro es lo que pasa. La diferencia entre los dos suele ser la historia más útil del tablero.

### La trampa que hay que evitar al probar

Si ves una pantalla heredada con verdes y rojos, o textos como *"menciones"* o *"share of voice"*, **no es
un bug**: es la frontera del producto (§4.4). Pero **si no entendés un número, si una pantalla no dice para
qué sirve, o si el contenido generado sale en otro idioma — eso sí es producto y se reporta.**

---

## 4. Las tres capas, sin mezclarlas

Una frase cada una. Si te quedás con esta sección, ya entendés por qué la plataforma se ve como se ve.

### 4.1 Getcito — la capa heredada: *cómo te ve la IA hoy*

Monitorea preguntas en motores de IA y cuenta menciones, **share of voice**, consultas derivadas y citas.
Produce **monitoreo y reportes**. Su vocabulario es *prompt, competidor, cadencia, run, snapshot*.

### 4.2 Maasy — la capa de datos: *de dónde salen los datos de marca*

Es el sistema donde vive la identidad de la marca. BeAOS le pide **dos cosas**: la lista de marcas y el
contexto de una marca (el **DNA**). Maasy manda la evidencia de resultados **en prosa**, no estructurada.
Sigue siendo el sistema de marca; lo que cambió es que en la capa de agentes **no es la puerta de
publicación**.

### 4.3 BeAOS — la capa de agentes: *si un agente puede usarte y verificarte*

Audita el sitio (**AOS**), mide lo que responden los modelos (**APS medido**), convierte la prosa de Maasy
en **pruebas** estructuradas que una persona confirma, **genera y firma** el bundle, y lo **publica** con
un candado. Expone todo eso por **MCP** y por **API**.

### 4.4 Por qué la mitad heredada se ve distinta (y no es un bug)

Es una decisión explícita:

- El código heredado se deja como viene: Getcito sigue vivo y cada línea nuestra ahí es un conflicto
  futuro. Las pantallas heredadas **conservan sus colores** (el semáforo verde/ámbar/rojo) y su
  vocabulario. **Es a propósito.**
- Las pantallas nuestras usan los colores de la marca Believe.
- El contenido generado sale en el **idioma objetivo de la marca**, configurado en Settings → Brand. Si
  generás antes de configurar el idioma, sale en el idioma del modelo.

**Traducción para quien prueba:** que una pantalla heredada tenga verdes y rojos no es un hallazgo. Que un
número no cierre, sí.

---

## 5. El mapa: ¿dónde voy para qué?

**Advertencia sobre las direcciones:** las pantallas de una marca viven debajo de
`/app/<id-de-marca>/…`. El id de la marca default es literalmente `default` (así se provisiona), así que
la forma canónica es `https://beaos.believe-global.com/app/default/<pantalla>`.

### 5.1 La tabla que se usa todos los días

| Quiero… | Voy a | Y obtengo |
|---|---|---|
| Ver el estado general de una marca | **Overview** (`/app/<marca>/`) | Resumen con visibilidad y las tarjetas de AOS y APS |
| Saber si un agente puede **usar** una web | **AOS** (`/agent-ops`) | Puntaje 0–100, banda, y requisito por requisito con evidencia y puntos que devolvería arreglarlo |
| Ligar una marca con su proyecto de Maasy | **Agent Entities** (`/agent-entities`) | El vínculo guardado y el DNA sincronizado |
| Generar, descargar y **publicar** los archivos | **Agent Assets** (`/agent-assets`) | Hasta 15 archivos con su ruta, su hash y su botón de descarga, más el interruptor de publicación |
| Confirmar qué afirma la marca y con qué se prueba | **Pruebas** (`/claims`) | Pruebas confirmadas + el contador "tu sitio sirve X · tu bundle declararía Y" |
| Saber si los asistentes te **prefieren** | **APS** (`/agent-preference`) | Biblioteca de prompts, estimación de costo, corrida y APS por modelo con banda y P10–P90 |
| Saber qué hacer y quién lo hace | **Plan** (`/blueprint`) | 36 tarjetas en 4 grupos, con pasos, detalle exacto y cómo verificar cada una |
| Generar el documento para el cliente | **Reports** (`/reports`) | Reporte con Share of Voice y una página **Agent Readiness** con AOS y APS |
| Configurar la marca | **Settings → Brand** (`/settings/brand`) | Nombre, web, dominios adicionales, alias, mercado objetivo e idioma objetivo |
| Elegir contra quién se compara | **Settings → Competitors** (`/settings/competitors`) | Lista de competidores |
| Cargar o editar las preguntas del monitoreo | **Settings → Prompts** (`/settings/prompts`) | Texto y habilitación de cada prompt |
| Elegir qué modelos se consultan | **Settings → LLMs** (`/settings/llms`) | Modelos habilitados por marca |
| Ver todas las marcas del sistema | **Admin → Brands** (`/admin`) | Listado global y el alta de marca. Solo admin. Además, desde acá se cambia la **cadencia** de una marca |
| Ver qué está corriendo | **Admin → Queue** (`/admin/queue`) | La cola de trabajos en segundo plano |
| Ver consumo y latencia | **Admin → API Usage** (`/admin/usage`) | Consumo por proveedor/modelo |
| Ver automatizaciones | **Admin → Workflows** (`/admin/workflows`) | Estado de los workflows |
| Herramientas internas | **Admin → Tools** (`/admin/tools`) | Diagnóstico |
| Que otro producto use BeAOS | **MCP** (`/mcp`) | 27 herramientas por JSON-RPC (§8.5) |
| Leer la especificación de la API | **`/api/v1/openapi.json`** y `/api/v1/docs` | El contrato OpenAPI servido por la app |
| Auditar una web sin entrar a la app | **Extensión de Chrome** o `POST /api/v1/aos/audit` | El mismo AOS, público y con cupo diario (§8.7) |
| Ver visibilidad, SoV, fan-out, citas, oportunidades | **Visibility / Share of Voice / Query Fan-Out / Citations / Opportunities** | Las pantallas heredadas de Getcito (§6.9) |

### 5.2 El menú real, con sus grupos y condiciones

El menú tiene **tres grupos**, y las pantallas de agentes y las heredadas conviven dentro de *Dashboard*:

- **Dashboard** — Overview, AOS, Agent Entities, Agent Assets, Pruebas, APS, Plan.
  Después, **solo si la marca está *onboarded***: Visibility, Share of Voice, Query Fan-Out, Citations,
  Opportunities.
- **Settings** — Brand, Competitors, Prompts, LLMs. Siempre visible.
- **Admin** — si sos admin: Brands, Nueva marca, Reports, Workflows, Queue, API Usage, Tools. Si tenés
  acceso a reportes pero no sos admin: **solo Reports**.

---

## 6. Sección por sección

### 6.0 Acceso y alta de una marca

**Acceso:** la app está en `https://beaos.believe-global.com` y el login en
`https://beaos.believe-global.com/auth/login`.

**El primer usuario de la instancia queda como admin global** (rol `admin`, con acceso a reportes) y como
admin de la organización `default`. **Los altas siguientes no están habilitadas**: el registro permite el
primer usuario y **rechaza todos los que vengan después**. Es a propósito: en modo local la instancia tiene
un dueño.

**Alta de una marca, paso a paso (y esto es lo que hace el código hoy):**

1. Iniciás sesión.
2. **Admin → Brands**: la tarjeta de alta está **arriba de la lista** de marcas. (El selector de marca
   también ofrece "+ Create new brand", que lleva a `/app/new`.)
3. Completás **nombre, web, mercado objetivo e idioma objetivo**. **El id de la marca sale del host** de la
   web (`acme.com` → `acme-com`): por eso la web no es opcional, de ahí sale la dirección.
4. Se crea la **organización** (con vos como admin) y la fila de la **marca**. Si esa web ya tenía marca, el
   alta es **idempotente**: la reutiliza y te lleva a ella en vez de duplicarla.
5. **La marca arranca sin prompts y sin competidores.** No hay siembra automática: las preguntas y los
   competidores se cargan después en **Settings** (§6.10).

**Si la marca existe en la autenticación pero todavía no en la base**, BeAOS te muestra una pantalla de
**Setup** que pide la **web** y nada más. Recién cuando hay marca en la base aparecen las pantallas de
monitoreo (Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities: solo con la marca
*onboarded*) y el worker empieza a programar corridas.

**Secretos:** viven en **Infisical** y en el `.env` del servidor, **no en Git**.

### 6.1 Overview (`/`)

El tablero general de la marca. Muestra el estado de visibilidad y, al final, las tarjetas de AOS y APS
resumidas. **Es la pantalla de entrada:** si algo está en rojo o en cero, se investiga en su sección.

### 6.2 AOS (`/agent-ops`)

**Qué es:** el puntaje de **operabilidad**. Mide si un agente puede *usar* la web.

**Cómo se usa:** pegás la dirección de la web y apretás **Auditar AOS**. BeAOS recorre el sitio de verdad
(pide archivos, mira cabeceras, prueba endpoints); **no es una estimación**.

**Qué devuelve:**

- El **puntaje de 0 a 100** y su **banda** (§7.1).
- El **diagnóstico en una frase**.
- **El camino de un agente**, en cuatro etapas: **Te encuentran → Te entienden → Pueden actuar → Te
  prefieren**. Cada etapa con sus puntos y **lo concreto que falta**.
- **El próximo paso**, que es lo único marcado en cian: si mirás una sola cosa de la pantalla, mirá eso.
- La lista de **requisitos**, cada uno con si **pasa**, **falla** o **no aplica** al tipo de negocio, **qué
  se vio** al comprobarlo (la evidencia, en una línea) y, si falla, **cuántos puntos devolvería** arreglarlo
  (`+18.8`). Los que fallan están **ordenados por puntos**.
- Abajo, el **historial** de auditorías. Corre cuando vos querés.

**Lo que hay que entender:** hay **11 requisitos que puntúan** y **8 que solo se informan** (diagnósticos:
se muestran y no mueven el número). La pantalla los distingue, y a los diagnósticos **no se les inventa una
ganancia**. Si el sitio se evalúa como **marca** o como **producto/API**, cambia qué requisitos aplican:
se detecta solo.

### 6.3 Agent Entities (`/agent-entities`)

**Qué es:** las **entidades** de la marca. Una marca puede tener una entidad paraguas y varias de producto.
Cada entidad tiene **su** web, **su** perfil firmado y **su** publicación.

**Los dos conceptos que hay que separar:**

| Dónde | Qué es |
|---|---|
| La **marca** (Settings → Brand) | La marca como tal. Tiene su web. |
| La **entidad** (acá) | La superficie agéntica. Tiene **su** web, que **es otro campo** |

**Ojo: la web de la marca y la web de la entidad son dos campos distintos.** Si la de la entidad está
vacía, el sistema funciona igual (busca la web del DNA o la de la marca), pero conviene cargarla: es la
identidad de la entidad. Y hay una regla fina: **si la web de la entidad está cargada, es *la* web** —no se
sustituye por otra—; las otras dos solo rellenan un campo vacío.

**Conexión con Maasy:**

1. **Cargar marcas Maasy** → lista las marcas que existen en Maasy. **Solo las lista**, no importa nada.
2. **Vincular** una marca de Maasy con una entidad → guarda el vínculo.
3. **Sincronizar DNA** → baja el contexto de esa marca (identidad, tono, ICP, oferta, resultados).

**Si "Cargar marcas Maasy" da error de credencial:** ver §13.3.

### 6.4 Agent Assets (`/agent-assets`)

**Qué es:** los archivos que la marca publica para que un agente la entienda y la verifique. BeAOS los
**genera**, los firma y los entrega.

**Cómo se usa:**

1. Elegí la **entidad**.
2. Apretá **Generar assets**.
3. Mirá la lista. Cada archivo tiene su ruta, su hash y un botón **Descargar**.
4. En la tarjeta **Publicación**, apretá **Publicar** (o **Despublicar**) cuando corresponda.

**La tarjeta Publicación es un candado, y hay que entenderlo:**

- **Cerrado por defecto.** Hasta que no publiques, **nada** se entrega a ningún agente: la entrega da 404.
- Al publicar, BeAOS **compara**: cuántas pruebas declara tu perfil nuevo contra cuántas declara la web hoy.
- **Si el bundle declara menos, se niega y te dice por qué.** Publicar un perfil con menos pruebas que el
  actual destruiría en silencio la evidencia de la marca.

**Los archivos y para qué sirve cada uno:** §8.2.

### 6.5 Pruebas (`/claims`)

**Qué es:** la pantalla donde una persona **confirma** qué afirmaciones hace la marca y **con qué documento
se prueba cada una**. Es la pieza que convierte "texto suelto" en evidencia que un agente puede verificar.

**Por qué existe:** Maasy manda la evidencia **en prosa** ("aumento promedio de 35% en conversión…"). Un
agente no puede leer un párrafo y confiar; necesita la estructura: *afirmación + número + prueba + cuándo
aplica y cuándo no*. BeAOS **no la convierte solo**, porque eso sería inventar evidencia: **la confirma una
persona**.

**Cómo se usa:**

1. Elegí la entidad.
2. Arriba vas a ver **el contador**: *"Tu sitio sirve X pruebas · tu bundle declararía Y"*.
3. Abajo, **"Lo que Maasy ya manda"**: los fragmentos originales, sin tocar, con la métrica que BeAOS
   detectó (si la hay) y el motivo por el que es candidato.
4. En el que quieras, apretá **Convertir en prueba**. Se abre el formulario **pre-cargado y editable**:
   - **Afirmación** — la frase que va a leer el agente.
   - **Número** — la métrica, tal como está en la fuente.
   - **Cuándo SÍ aplica / Cuándo NO aplica** — los límites. Esto es lo que separa una afirmación honesta
     de marketing vacío, y **el estándar lo exige** (si falta, el perfil se firma con el error
     `APS-CLAIM-02`).
   - **Id de la prueba** — tiene que cumplir el formato **`CLM-[A-Z0-9-]+`** (por ejemplo
     `CLM-MARCA-100-PROYECTOS`). Viene pre-cargado y es editable.
   - **Tipo de prueba**, **título**, **resumen**, **cliente**, **confidencialidad**.
   - **Cómo lo verifica un agente** — una opción de la lista: `public_url`, `third_party_platform`,
     `signed_client` o `internal`. Sin esto, el estándar marca la prueba como **no verificable**.
5. Guardá como **Borrador** o **Confirmar prueba**.

**Reglas que hay que respetar:**

- **Un borrador no entra al bundle.** Solo las confirmadas se publican. Es deliberado: confirmar es el acto
  humano que hace que la marca se responsabilice de lo que afirma.
- **La confianza no se declara a mano**: se deriva del tamaño de muestra (`1 − 1/√n`, entre 0.5 y 0.95). Si
  el perfil declara otro valor, el estándar lo marca (`APS-CLAIM-04`).
- **Heredable:** una prueba marcada como heredable se copia a las sub-entidades que la heredan, y solo si
  está **confirmada**; si una sub-entidad ya emite una prueba propia con el mismo id, gana la propia. La
  herencia se declara en el perfil (no depende de la memoria de quien lo armó).

**El objetivo concreto:** el candado bloquea si el bundle declara **menos** pruebas que el sitio. Si tu web
sirve 6, necesitás **al menos 6 confirmadas** para poder publicar.

> **Atención, y es importante:** el candado **cuenta, no juzga**. Si confirmás 6 pruebas flojas y tu web hoy
> sirve 6 buenas, el candado te deja pasar y **reemplazarías 6 mejores por 6 peores**. Antes de confirmar en
> masa, compará con lo que la web ya publica.

### 6.6 APS (`/agent-preference`)

**Qué es:** el puntaje de **preferencia**. Mide qué responden **modelos reales** cuando alguien pregunta por
la marca o su categoría. No es lo que la marca dice: es lo que los asistentes contestan.

**Se usa en tres pasos, en orden** — y todo esto es **por entidad**: la biblioteca es de la entidad, la
corrida es de la entidad y el resultado es de la entidad. Si no hay entidad, no hay dónde medir.

**Paso 1 · Biblioteca de prompts.** Son las preguntas con las que se va a medir, y **no pueden nombrar la
marca** (una pregunta que la nombra contamina la respuesta y se descarta antes de guardarse). Si la marca no
tiene, se generan con **Generar candidatos (hasta 50)**: el botón le pide 50 al gateway y el gateway devuelve
los que puede, así que puede volver una lista **más corta** — la pantalla dice cuántos volvieron, cuántos
quedaron usables y por qué se descartó el resto. Lo que vuelve son **candidatos: no se guardan hasta que
aprietes Guardar y bloquear 90 días**. Revisalos: la calidad de la medición depende de la calidad de las
preguntas.

**Paso 2 · Corrida.** Elegí entidad, apretá **Estimar corrida** y **mirá el costo antes de gastar**. Nada se
ejecuta hasta que aprietes **Confirmar y ejecutar**. Corre **a demanda**: no hay barrido automático.

**Paso 3 · Resultados.** Un bloque **por modelo**, con el APS, la banda, el rango P10–P50–P90 y la cantidad
de respuestas. El APS **nunca mezcla respuestas de modelos distintos**: comparar un modelo contra otro no
tiene sentido; se comparan contra sí mismos en el tiempo.

**Cosas que vas a ver y que NO son errores:**

- **"Parcial".** La corrida respondió menos de lo que planeó (por ejemplo, un proveedor no completó, o hubo
  que bajar las repeticiones para entrar en el presupuesto). Se muestra **como parcial, con el motivo**, en
  vez de fingir que está completa.
- **Modelos con bandas distintas.** Es un resultado, no un defecto: significa que el resultado **depende de
  a qué asistente le preguntes**.
- **P10–P90 ancho.** Con pocas repeticiones el rango es ancho. Es honesto.
- **Una sola repetición y el gráfico degenera.** La distribución se arma remuestreando las repeticiones: con
  **una sola**, todas las remuestras dan el mismo valor y no hay forma que mostrar. Se necesitan **2 o más**
  para que el rango informe de algo.

### 6.7 Plan (`/blueprint`)

**La sección más importante para pasarle a un desarrollador.**

**Qué es:** **todo** lo que hay que hacer para que la marca sea operable y preferible por agentes, **incluido
lo que BeAOS no genera**. Son **36 tarjetas** en cuatro grupos:

| Grupo | Cuántas | Qué contiene |
|---|---|---|
| **Lo que BeAOS ya genera** | 12 | Los archivos, y si están o no en el bundle |
| **Lo que hay que hacer en tu web** | 10 | Cosas que son **comportamiento del servidor**, no archivos: twins Markdown, cabeceras `Link`, una API con sus límites, el MCP en tu origen, WebMCP |
| **Lo que hay que hacer fuera de tu web** | 5 | Wikidata y Wikipedia, publicar el SDK/CLI en npm, el registro MCP, Search Console, el directorio de ChatGPT |
| **Lo que decidimos NO hacer** | 9 | Con el motivo, para que nadie lo "arregle" por error |

**Cada tarjeta trae:**

- **De quién es el trabajo**: *Lo hace BeAOS* / *Lo hace tu desarrollador* / *Lo hacés vos* / *No se hace*.
- **Por qué existe**, en una o dos frases.
- **Los pasos numerados**, ejecutables por alguien que no escribió esto.
- **El detalle exacto**: nombres de campo, cabeceras, valores.
- **El código para copiar**.
- **Cómo comprobar que quedó.**

**Los cuatro estados:**

| Estado en pantalla | Significa |
|---|---|
| **Listo** | Está en el bundle generado |
| **Falta** | BeAOS lo genera y todavía no se generó |
| **Por verificar** | Está en la web o fuera de ella: **hay que medirlo desde afuera para saberlo** |
| **No se hace** | Decidido a propósito, con el motivo escrito |

> **"Por verificar" no es un error.** BeAOS prefiere decir "no sé" antes que pintar de verde algo que no
> comprobó. Por eso todo ítem de servidor o externo queda en "por verificar": saber si el sitio responde
> bien exige medirlo desde afuera, no leer la base de BeAOS.

### 6.8 Reports (`/reports`)

1. **Create New Report**: nombre y web de la marca.
2. Esperá a que termine y abrilo.
3. **Imprimilo o guardalo como PDF** desde el navegador.

**Qué trae:** el Share of Voice y una página final **Agent Readiness** con el **AOS** (puntaje, banda,
requisitos) y el **APS** con **"Declarado"** y **"Medido" separados y sin sumarse**, más el cierre con los
próximos pasos.

**Cada medición lleva su fecha** — *"Auditado el …"* para el AOS y *"Medido el …"* para la corrida — porque
el reporte es un documento fechado y el AOS/APS siguen moviéndose. Y si una corrida fue parcial, **lo dice**.

### 6.9 Las pantallas heredadas de Getcito

> Todas estas vienen de Getcito, no las construimos nosotros (§4.1). Conservan su estilo y su vocabulario a
> propósito. Solo aparecen **si la marca está *onboarded***.

#### Visibility

**Qué responde:** dónde y cómo aparece la marca en las respuestas de cada motor de IA.
**Qué muestra:** las preguntas monitoreadas y, para cada una, si la marca fue mencionada y en qué motor.
**Ojo:** que una marca **no** aparezca no significa que el motor la odie: significa que **no la citó para
esa pregunta**. Opportunities es la que convierte eso en acción.

#### Share of Voice

**Qué responde:** qué porción de las menciones se lleva la marca contra sus competidores.
**Qué muestra:** leaderboard (ranking por menciones) y tendencias.
**Cómo se lee:** no importa solo el número propio, importa **la distancia con el que va primero** y **si la
tendencia sube o baja**. Un 11% que sube vale más que un 15% que cae.
**Trampa:** el SoV depende de **qué competidores cargaste** y **qué preguntas monitoreás**. Si cambia la
lista, el porcentaje cambia sin que nada haya pasado en el mercado. **Anotá siempre contra qué set lo
mediste**, y revisá seguido que estén los competidores reales: si falta uno, tu SoV se ve mejor de lo que es.

#### Query Fan-Out

**Qué responde:** cuando un modelo responde una pregunta, **qué búsquedas dispara por dentro**.
**Para qué sirve de verdad:** es la pantalla **más accionable** de la mitad heredada. Te dice **qué
términos** están buscando los modelos sobre tu categoría. Eso es, literalmente, **de qué escribir**.

#### Citations

**Qué responde:** **de dónde saca la información** el modelo cuando habla de tu categoría.
**Para qué sirve:** si el modelo te cita desde un medio que no controlás, hay una relación que cuidar. Si
cita a un competidor desde su propio sitio y a vos desde un tercero, hay un hueco de contenido propio.

#### Opportunities

**Qué responde:** **qué hacer**, priorizado. Es un informe **generado por IA** con las brechas y los riesgos
(cosas que no conviene intentar).
**Se refresca como máximo cada 6 días**; si lo cambiaste todo y el informe sigue viejo, es el caché.
**Nace en el idioma objetivo de la marca.** Si lo ves en otro idioma, avisá.

### 6.10 Settings

- **Brand** — nombre, web, dominios adicionales, alias, **mercado objetivo** e **idioma objetivo**,
  productos y servicios. **El idioma importa:** todo lo que BeAOS genera con IA sale en ese idioma.
- **Competitors** — contra quién se compara.
- **Prompts** — las preguntas del monitoreo de visibilidad. Cada prompt tiene su **página de detalle**
  (`/app/<marca>/prompts/<id>`) con sus estadísticas y su historial de corridas: ahí se ve qué respondió
  cada motor y cuándo. Lo que se edita es el **texto** y si está **habilitado**; **no hay frecuencia ni
  prioridad por prompt** (la cadencia es de la marca, §11).
- **LLMs** — qué modelos están habilitados para la marca. Los nombres canónicos que BeAOS reconoce vienen
  del código: **ChatGPT, Claude, Claude Opus, Claude Sonnet, Google AI Mode, Google AI Overview, Gemini,
  Copilot, Perplexity, Grok, Mistral y DeepSeek**. Cuáles están habilitados de verdad es configuración
  (Settings → LLMs por marca, más `SCRAPE_TARGETS` en el entorno), así que **la lista activa del
  despliegue está a confirmar**: se lee en esta pantalla.

**Regla dura:** si el idioma objetivo está vacío **cuando se genera**, el contenido sale en el idioma del
modelo y hay que rehacerlo. Configurá Brand primero, siempre.

### 6.11 Admin

Solo para administradores.

- **Brands** — todas las marcas del sistema, el alta de marca y el cambio de **cadencia** por marca (§11).
- **Reports** — generar y ver reportes de cliente.
- **Workflows** — automatizaciones programadas.
- **Queue** — la cola de trabajos en segundo plano.
- **API Usage** — consumo por proveedor/modelo.
- **Tools** — herramientas internas.

---

## 7. Resultado por resultado: cómo se lee cada número

### 7.1 El AOS

| Puntaje | Banda | Qué significa |
|---|---|---|
| **80 – 100** | **Agent-Operable** | Un agente puede usar la web |
| **60 – 79** | **Agent-Attemptable** | Puede intentarlo, con fricción |
| **35 – 59** | **Agent-Blocked** | Se traba |
| **0 – 34** | **Agent-Inert** | Es invisible para un agente |

**Cómo se compone:** **11 requisitos puntuados** — 8 del eje AOS y 3 del eje APS — y **8 diagnósticos** que
no mueven el número. Cada requisito puntuado tiene un peso según su fuerza: **MUST = 3, SHOULD = 2,
MAY = 1**, y el sub-score de cada eje es el peso ganado sobre el peso que aplica. El requisito
`AOS-API-01` (API pública / OpenAPI) **solo aplica si el negocio se clasifica como producto/API**; si no,
queda "no aplica" y sale del denominador.

**Regla de lectura:** **el número nunca se pinta por lo que vale.** Va en tinta de marca y el chip al lado
dice la banda. El color **ordena**, no juzga.

**El rubric es el mismo que audita Maasy**: mismos ids, mismas fuerzas y mismos pesos, a propósito. BeAOS y
la auditoría de Maasy **tienen que dar el mismo número para el mismo sitio**; si difieren, **es un bug**.
Cambiar el rubric (agregar los checks que faltan, pesar distinto) daría un número mejor y **dejaría de ser
comparable con lo que ya se vendió**: es una decisión de producto, no una mejora obvia.

**El camino de un agente** (de dónde salen los 4 tramos):

| Etapa | Qué agrupa |
|---|---|
| **Te encuentran** | Descubrimiento: `llms.txt`, `AGENTS.md`, `robots.txt` + sitemap, `llms-full.txt` |
| **Te entienden** | Identidad y contenido: JSON-LD, agent card, agent permissions, proof objects, negociación Markdown |
| **Pueden actuar** | Capacidades: MCP server card, NLWeb `/ask`, API pública/OpenAPI |
| **Te prefieren** | Evidencia: claims y proofs del `brand.json`, firma Ed25519, `keys.json`, Web Bot Auth |

### 7.2 El APS

**Bandas del APS medido** (la banda se le aplica al APS que sale de una **corrida**; el declarado y el del
estándar se muestran como número, sin banda):

| Puntaje | Banda |
|---|---|
| **85 – 100** | Agent-Native |
| **70 – 84** | Agent-Ready |
| **50 – 69** | Agent-Visible |
| **25 – 49** | Agent-Opaque |
| **0 – 24** | Agent-Blind |

**Primero: ¿cuál de los tres APS estás mirando?** Volvé al recuadro de §3. El **declarado** sale de los
claims y proofs publicados; el **del estándar** sale de los checks del eje APS del sitio; el **medido** sale
de una corrida real. **Nunca se suman.**

**De dónde sale el APS medido de una corrida — 5 dimensiones con su peso:**

| Dimensión | Peso | Qué mide |
|---|---|---|
| Descubrimiento agéntico | 25 | Cuántas veces te nombran en respuestas a prompts de compra |
| Inteligencia estructurada | 20 | Si las respuestas que te mencionan citan fuentes verificables |
| Capacidad de acción | 20 | Tu **AOS**: si un agente puede operar el sitio |
| Autoridad de fuente | 20 | Posición en el ranking y cuántos competidores aparecen al lado |
| Reputación agéntica | 15 | Si te recomiendan explícitamente y con qué sentimiento |

Si alguna dimensión falta, su peso **se reparte proporcionalmente** entre las que existen: no se inventa un
número. Las 6 sub-métricas medidas que alimentan esas dimensiones son: **cobertura, tasa de recomendación,
posición ponderada, sentimiento, grounding y amplitud competitiva**.

**Los topes de una corrida** (por defecto, y configurables por variables de entorno): la biblioteca no puede
pasar de **50 prompts**, la corrida de **3 modelos** ni de **3 repeticiones**, y el plan no puede pasar de
**450 llamadas**. Si algo de eso se excede, **la corrida no arranca** y te dice cuál es el máximo. La única
adaptación permitida es **bajar repeticiones** (y si eso pasa, la corrida queda marcada como **parcial**):
los modelos de medición **nunca** se cambian por uno más barato.

**Los otros números de una corrida:**

- **Observaciones** — cuántas respuestas se consiguieron. Menos observaciones = menos confianza.
- **P10 – P50 – P90** — el rango donde cae el 80% de los casos, calculado con **bootstrap de 500 remuestras**
  sobre una respuesta por prompt. **Si es ancho, el resultado es inestable.**
- **Parcial** — la corrida no respondió todo lo que planeó. El motivo se muestra.
- **Distancia entre el mejor y el peor modelo** — si es grande, la marca **no es pareja** entre asistentes.
- **Bandas distintas** — más de una significa que **depende de a quién le preguntes**.

> **Comparar modelos entre sí no tiene sentido.** Se comparan contra sí mismos en el tiempo. Un modelo con
> otra banda no es un error: es el resultado.

### 7.3 El conteo de pruebas y el candado

En **Pruebas** y en el candado vas a ver dos números: **lo que tu sitio sirve** y **lo que tu bundle
declararía**. La comparación es exactamente así:

- **Bundle ≥ sitio** → se puede publicar.
- **Bundle < sitio** → **se bloquea**, con el detalle: *"El perfil del sitio declara N claims y el bundle
  declara M"*.
- **No se pudo leer el sitio** → se publica **con un aviso**. BeAOS busca la web de la marca en tres
  lugares —entidad, DNA de Maasy, marca— antes de rendirse, y solo si **ninguna** responde avisa que no pudo
  verificar.
- **No hay `brand.json` generado** → no hay nada que comparar: **avisa y no bloquea**.

**El candado compara, no traduce.** Escribir claims a partir de la prosa sería inventar evidencia, y el
estándar lo prohíbe.

### 7.4 Los números de afuera (verificación externa)

El **Plan** cruza sus ítems con los identificadores de chequeo de scanners de terceros (`orank`,
`isitagentready`) para poder comparar después con una medición externa. La lista de ítems que se cruzan
sale del catálogo, no de este manual.

**Bot Beacon** — el tráfico agéntico real — **no tiene fuente en BeAOS**. El campo existe en el contrato
público y hoy vale `null` a propósito: **un cero se leería como "no te visitó ningún agente"**, que es una
afirmación falsa. Ver §9.

---

## 8. Integración por integración

### 8.1 Maasy

**Qué es:** de dónde BeAOS saca los datos de la marca (identidad, tono, ICP, oferta, resultados y el
material para las pruebas).

**Cómo se conecta:** BeAOS llama al gateway de Maasy con una **credencial**. Hay dos y **no son
equivalentes**:

| Variable de entorno | ¿Expira? | Cuál usar |
|---|---|---|
| `MAASY_MCP_API_KEY` | **No** | **Esta.** Es la que BeAOS prefiere |
| `MAASY_MCP_TOKEN` | **Sí** (OAuth) | Solo como respaldo |

**Si la credencial vence, se rompen dos cosas:** la importación de marcas **y** la sincronización del DNA.
El síntoma es un error de credencial al apretar los botones. Un token que expira no sirve para una
integración de servidor a servidor: no hay nadie mirando una pantalla que pueda volver a autorizar.

**Las dos operaciones que BeAOS usa:** listar marcas, y traer el contexto de una marca.

**Lo que Maasy NO manda hoy:** `claims` ni `proofs`. Su contexto viaja con `claims[]` **vacío** y la
evidencia como **texto libre** (resultados de cliente, testimonios, "referencias subidas sin analizar"). Por
eso existe la sección **Pruebas**: la estructura la pone una persona en BeAOS.

### 8.2 El bundle: los archivos

**Siempre salen 7:**

| Archivo | Para qué sirve |
|---|---|
| `/llms.txt` | El índice para agentes, con el bloque "Perfil verificable" |
| `/llms-full.txt` | El perfil completo en un solo archivo: identidad, cada claim con su límite, la evidencia y cómo verificar la firma |
| `/AGENTS.md` | Instrucciones para agentes que entran al sitio |
| `/robots.txt` | Qué puede crawlear cada bot y con qué permiso (**Content-Signal**) |
| `/.well-known/agent-card.json` | La ficha del agente de la marca (A2A) |
| `/.well-known/agent-permissions.json` | Qué permite y qué no, con los límites de cada prueba |
| `/.well-known/brand.json` | **El perfil de marca**: identidad, **claims y proofs** |

**Y estos 8 salen solo si existe el dato honesto para armarlos:**

| Archivo | Sale solo si… |
|---|---|
| `/sitemap.xml` | La entidad tiene web |
| `/.well-known/security.txt` | La marca declara un contacto de seguridad real (RFC 9116) |
| `/.well-known/api-catalog` | La marca declara una API o un MCP (RFC 9727) |
| `/.well-known/ai-catalog.json` | Hay recursos completos, con sus consultas representativas |
| `/.well-known/mcp/server-card.json` | La marca declara **su** MCP |
| `/.well-known/brand.json.sig` | Hay clave de firma |
| `/.well-known/keys.json` | Hay clave de firma |
| `/.well-known/http-message-signatures-directory` | Hay clave de firma (directorio de Web Bot Auth) |

**Total máximo: 15 archivos.** No todos se generan siempre, **y eso es correcto**: si falta el dato, BeAOS
**no emite el archivo** en vez de emitirlo vacío. Por eso el número que vas a ver puede ser menor.

**Los campos del `brand.json`** (el archivo que se firma): `$schema`, `version`,
`claims_proofs_version` (`claims-proofs/v1`), `brand` (nombre, web, industria, fecha de actualización),
`identity` (posicionamiento, descripción, diferencial, resultado principal, tono, CTAs aprobados, palabras
prohibidas), `agent_guidance.avoid_claims`, `claims[]`, `proofs[]` y `generated_by`.

### 8.3 La firma

Tres archivos trabajan juntos: `brand.json` (el contenido), `brand.json.sig` (la firma) y `keys.json` (la
clave pública).

**Por qué importa:** un agente que verifica la firma **no tiene que confiar en nosotros**. Cambia su
lenguaje: de *"la marca dice…"* a *"la afirmación firmada, verificada contra su clave…"*.

**Cómo funciona:** la firma es **Ed25519**, sobre los **bytes exactos** de `brand.json`. Las sub-marcas
**heredan la clave canónica del paraguas** y apuntan su `keys_uri` al paraguas, así que una firma de
sub-marca se verifica contra la misma identidad.

**Cómo se comprueba:** el `kid` de la firma tiene que ser **el mismo** que el de `keys.json`, y la clave
pública de BeAOS tiene que coincidir con la que publica la web.

### 8.4 La entrega: dos caminos

**a) URL pública, sin credencial** (para webs que no pueden montar archivos):

```
https://beaos.believe-global.com/agent/<id-de-entidad>/.well-known/brand.json
```

Sin sufijo, esa misma dirección es el **índice**: lista todo lo publicado con el hash de cada archivo.

**b) API con token** (para un agente de entrega, o para el *be agent* de la marca):

- `GET /api/v1/agent-assets/<entityId>` → el **manifiesto** (los bytes exactos, `sha256` e identidad de
  firma).
- `GET /api/v1/agent-assets/<entityId>/raw?path=/.well-known/brand.json` → **un archivo suelto**, con su
  hash en la cabecera `x-content-sha256` y el hash del bundle en `x-bundle-sha256`, para poder probar que se
  escribió exactamente lo que se recibió.

> **Las dos dan 404 hasta que la entidad esté publicada.** Eso es correcto: el candado está cerrado por
> defecto.

### 8.5 El MCP de BeAOS

**Qué es:** la puerta para que **otros productos** (Maasy, BeAds, el agente de una marca) usen BeAOS sin
programar una integración a medida.

- **Dirección:** `https://beaos.believe-global.com/mcp`
- **Protocolo:** JSON-RPC 2.0 sobre HTTP (`initialize`, `tools/list`, `tools/call`). **Sin SSE y sin
  sesión**; un `GET` responde 405 con una pista, que es lo que el protocolo espera.
- **Credencial:** `Authorization: Bearer …` o `x-api-key`. Acepta **dos** tipos:
  1. Un **token por producto** de la tabla `agent_api_tokens` (se guarda su `sha256`, no el token; es
     **revocable de a uno**; revocado es 401 y **no** cae al token compartido).
  2. Los `ADMIN_API_KEYS` de siempre, para no romper lo que ya funcionaba.

**Las 27 herramientas**, agrupadas por para qué sirven. (Los tokens por producto se administran hoy con un
script, no con una pantalla: ver §9.)

**Leer la capa propia (9):**

| Herramienta | Qué hace |
|---|---|
| `list_brands` | Lista las marcas |
| `get_brand` | Una marca y sus entidades |
| `get_aos_audit` | El último AOS: puntaje, banda y requisito por requisito |
| `list_aps_runs` | Las corridas de APS con su banda y su P10–P90 |
| `get_aps_score_detail` | El detalle competitivo de una corrida APS |
| `list_claims` | Las pruebas de una entidad |
| `get_claim` | Una prueba |
| `get_agent_bundle` | El manifiesto del bundle publicado |
| `get_agent_asset` | Un archivo del bundle, byte a byte |

**Leer la capa heredada (8):**

| Herramienta | Qué hace |
|---|---|
| `list_prompts` | Los prompts monitoreados |
| `list_competitors` | Los competidores |
| `get_visibility` | La visibilidad en motores de IA |
| `get_share_of_voice` | El share of voice |
| `list_citations` | Las fuentes citadas |
| `get_query_fanout` | Las búsquedas que disparan los prompts |
| `get_opportunities` | El informe de oportunidades |
| `list_reports` | Los reportes de una marca |

**Escribir (10):**

| Herramienta | Qué hace |
|---|---|
| `ensure_brand` | Asegura (crea o actualiza) una marca |
| `ensure_entity` | Asegura una entidad y devuelve el `entityId` que piden las demás |
| `ensure_prompt_library` | Asegura la biblioteca de prompts del APS |
| `start_aps_run` | Encola una corrida APS |
| `sync_brand_dna` | Sincroniza el DNA desde Maasy |
| `upsert_claim` | Da de alta o edita una prueba (con `status: draft` no entra al bundle) |
| `delete_claim` | Borra una prueba |
| `set_claim_inheritable` | Marca una prueba como heredable por las sub-entidades |
| `generate_agent_assets` | Genera o regenera el bundle (no lo publica) |
| `publish_agent_assets` | Publica o despublica |

**El ciclo completo, en orden:** `ensure_brand` → `ensure_entity` → `sync_brand_dna` → `upsert_claim` →
`generate_agent_assets` → `publish_agent_assets`.

**Las dos reglas que también rigen acá:** no se puede leer un bundle **sin publicar**, y publicar pasa por
el **mismo candado**. No hay una puerta más permisiva para los agentes.

### 8.6 La API v1

`/api/v1` con autenticación **Bearer** (`ADMIN_API_KEYS` o un token por producto).

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEYS" \
     https://beaos.believe-global.com/api/v1/brands
```

**La especificación** está en `/api/v1/openapi.json` (la sirve la app, sin credencial) y `/api/v1/docs`
redirige a la documentación del proyecto original.

**Las rutas que declara la especificación (12):**

| Ruta | Métodos |
|---|---|
| `/brands` | GET, POST |
| `/brands/{brandId}` | GET, PATCH |
| `/competitors` | GET, POST |
| `/competitors/{competitorId}` | GET, PATCH, DELETE |
| `/prompts` | GET, POST |
| `/prompts/{promptId}` | GET, PATCH, DELETE |
| `/prompts/{promptId}/snapshot` | GET |
| `/reports` | GET, POST |
| `/reports/{reportId}` | GET |
| `/tools/analyze` | POST |
| `/aos/audit` | POST (público, con cupo) |
| `/aos/lead` | POST (público, con cupo) |

> **A confirmar:** la entrega de assets (`/api/v1/agent-assets/…`) existe como ruta en el código pero **no
> está en la especificación OpenAPI**. No sé si es a propósito.

### 8.7 La extensión de Chrome y el audit público

**La extensión** (`apps/aos-extension`, Chrome MV3, versión **2.2.1**, se carga descomprimida y **no tiene
build**) hace tres cosas sobre cualquier web: el **score y la banda**, los **puntajes por eje**, el
**listado completo de requisitos** con su evidencia y sus diagnósticos aparte, el **perfil firmado** del
sitio (APS declarado, cuántas pruebas declara y si la firma verifica), el badge **Agent-Preferred** —
**solo** si la firma verifica; no hay versión "apagada" del badge, porque un badge apagado igual diría
Agent-Preferred —, el **Bot Beacon** (que hoy declara que no hay fuente) y el modo **"lo que ve un
agente"**, que anota sobre la página real qué acciones puede ejecutar un agente y cuáles no.

**Los dos endpoints públicos** (sin token, sin sesión) son `POST /api/v1/aos/audit` y
`POST /api/v1/aos/lead`. Lo que sostiene el servicio son los cupos:

| Cupo | Default | Variable |
|---|---|---|
| Auditorías por IP y por día | **20** | `AOS_PUBLIC_AUDITS_PER_DAY` |
| Tope diario de todo el servicio | **2000** | `AOS_PUBLIC_AUDITS_PER_DAY_GLOBAL` |
| Auditorías por IP con la credencial de verificación | **1000** | `AOS_PUBLIC_VERIFY_PER_DAY` |

**El cupo efectivo no es una constante del cliente:** viaja en la cabecera `RateLimit-Limit`, junto con
`RateLimit-Remaining`, `RateLimit-Reset`, `RateLimit-Policy` y `RateLimit`. Si un cliente **no** recibe la
cabecera, tiene que decir el cupo **sin la cifra**, no inventarla. Un 429 dice **cuándo** volver vía
`Retry-After`. Los techos de tiempo por defecto son 20 s para el pedido completo y 4 s por request interno.

**La credencial de verificación** es la cabecera `x-beaos-verify` con el valor de
`AOS_PUBLIC_VERIFY_SECRET`. No autentica ni da acceso a nada privado: **solo mueve el pedido a otra cuenta
de cupo**, para que verificar el despliegue no agote el cupo de los usuarios reales. Está apagada por
defecto: sin secreto configurado, la cabecera se ignora por completo.

---

## 9. Lo que BeAOS NO hace

Un manual que solo cuenta lo bueno obliga a descubrir los límites chocando. Estos son los límites, dichos
con la misma jerarquía que las capacidades.

1. **No inventa pruebas.** Si no hay una prueba confirmada, el claim no existe. BeAOS convierte, ordena y
   firma lo que una persona afirma; no deduce evidencia de un texto libre.
2. **No fabrica claims desde la prosa de Maasy.** Maasy manda la evidencia en prosa y su `claims[]` vacío.
   La estructura la pone una persona en **Pruebas**. Escribirla por vos sería inventar evidencia.
3. **El Bot Beacon no tiene fuente.** BeAOS no instrumenta el tráfico de sitios de terceros: no hay tabla,
   ni middleware, ni clasificador de user-agents. El campo existe y vale `null` a propósito. **Un cero se
   leería como "no te visitó ningún agente"**, que sería falso.
4. **El APS medido cuesta plata y se corre aparte.** Es un evento **a demanda**, no un barrido: no hay
   gasto continuo ni tope diario. Los topes son **por corrida** y **por mes**, y son configurables.
5. **Un modelo sin precio bloquea la corrida.** BeAOS no adivina el precio: la estimación dice qué modelos
   faltan, y la corrida no arranca hasta que estén configurados. Es a propósito: no se gasta a ciegas.
6. **No se publica por defecto.** El candado está cerrado: nada llega a un agente hasta que una persona
   publica.
7. **No se emite un archivo vacío.** Si falta el dato honesto para armar uno de los archivos del bundle,
   ese archivo no se genera.
8. **No bloquea cuando no puede verificar.** Si no puede leer el perfil del sitio, publica **con un aviso**.
   Es el comportamiento acordado, y es una decisión revisable.
9. **No juzga la calidad de las pruebas, solo las cuenta.** Si confirmás pruebas peores que las que el sitio
   ya sirve, el candado te deja pasar.
10. **No mide DOM, formularios ni ejecución programática.** Los cinco "niveles" de la auditoría vieja
    (inventario, declaración, ejecutabilidad DOM, ejecución programática, confiabilidad) **no se corren**:
    este motor no los calcula, y en vez de fabricar cinco números muestra el desglose por eje del estándar.
11. **No hay barrido automático de APS** ni gasto de fondo. Si querés un número nuevo, corrés una corrida.
12. **La biblioteca de prompts no se puede cambiar mientras está bloqueada.** 90 días, salvo una acción
    explícita de reemplazo: el instrumento de medición no puede moverse entre mediciones.
13. **No hay pantalla para crear credenciales MCP por producto.** El mecanismo existe (tabla
    `agent_api_tokens`, token `beaos_…`, revocable de a uno) pero se administra con un script
    (`apps/web/scripts/beaos-tokens.mjs`), no desde la UI.
14. **La extensión no publica nada.** Solo audita y muestra.
15. **Los archivos no se empujan: se sirven.** BeAOS **jala** por GET: la entrega es pública (`/agent/…`) o
    con token (`/api/v1/agent-assets/…`). **La web es la que tiene que ir a buscarlos** (o montar un rewrite
    a este origen). Que BeAOS los **empuje** a cada sitio necesitaría credenciales de cada web: **no existe
    hoy**.
16. **BeAOS publica solo una parte de su propio `/.well-known`.** Sí publica su
    `/.well-known/mcp/server-card.json` (con su endpoint real de MCP y sus herramientas reales, leídas del
    mismo registro) y su `/.well-known/security.txt` (con el contacto real de Believe). **No publica**
    `llms.txt`, `AGENTS.md` ni su propio `brand.json` firmado. Es una incoherencia parcial: predicamos más
    de lo que hacemos.
17. **No hay snippet de "operador" en el código de BeAOS.** No encontré en el repositorio la pieza del
    snippet que se pega en la web del cliente: **a confirmar** si vive en otro lado.

---

## 10. Recetas completas, de principio a fin

### Receta A · Alta de una marca nueva

1. **Admin → Brands → alta de marca**: nombre, web, **mercado** e **idioma objetivo**. Se crea la
   organización y la marca, **vacía de prompts y competidores**, con el id derivado del host.
2. **Settings → Brand**: completar alias, dominios adicionales, descripción y productos.
3. **Settings → Competitors**: cargar los competidores reales.
4. **Agent Entities**: vincular la marca con su proyecto de Maasy y **sincronizar el DNA**.
5. **Settings → Prompts** o **APS → Biblioteca**: las preguntas de cada medición.

### Receta B · Saber cómo está una marca

1. **AOS** → auditar la web → anotar puntaje y banda.
2. **APS** → estimar la corrida → correrla → anotar el resultado por modelo.
3. **Plan** → leer los cuatro grupos → anotar cuántos ítems faltan.

**Resultado:** el diagnóstico completo. Con eso ya se puede armar un reporte.

### Receta C · Publicar los archivos (el camino crítico)

1. **Agent Assets** → **Generar assets**.
2. **Pruebas** → confirmar las pruebas. **Mínimo igual al número que sirve la web.**
3. **Agent Assets** → **Generar assets** otra vez (para que las pruebas entren al bundle).
4. **Agent Assets → Publicación → Publicar**.
   - Si **pasa**: listo, la entrega funciona.
   - Si **se niega**: leer el motivo. Casi siempre es "el bundle declara menos claims que el sitio".

### Receta D · Entregar a una web

1. Publicá la entidad (receta C).
2. El desarrollador elige: **URL pública** o **API con token** (§8.4).
3. Verificá desde afuera que los archivos responden.

### Receta E · Un reporte para el cliente

1. **Reports → Create New Report**.
2. Esperá, abrilo, **guardalo como PDF**.
3. Revisá que la página **Agent Readiness** traiga el AOS y el APS con sus fechas.

### Receta F · Que otro producto use BeAOS

1. Creá una credencial por producto con el script de tokens.
2. Configurá el cliente MCP contra `https://beaos.believe-global.com/mcp` con esa credencial.
3. Empezá por `list_brands` → `get_brand` (ahí está el `entityId`) → y desde ahí lo que necesites.

---

## 11. Cadencias y trabajos de fondo

**Esto se lee del worker, y hay una corrección importante respecto de lo que decían los manuales viejos.**

| Qué | Valor | Dónde vive |
|---|---|---|
| Chequeo de mantenimiento | **cada 5 minutos** (`*/5 * * * *`, UTC) | `apps/worker/src/index.ts` |
| Cadencia de ejecución de prompts | **por marca**: `delay_override_hours` si está, si no `DEFAULT_DELAY_HOURS` | `apps/worker/src/jobs/process-prompt.ts` |
| Default de la cadencia | **24 horas** si la variable no está o no es válida | `packages/lib/src/constants.ts` |
| Backoff por fallas consecutivas | **0.25 h → 0.5 h → 1 h → 2 h → 4 h → 8 h**, y nunca más que la cadencia | `packages/lib/src/run-backoff.ts` |
| Reintentos de la cola de mantenimiento | 3, con 5 minutos entre intentos | `apps/worker/src/index.ts` |

**La corrección:** la cadencia **no es por prompt**. La tabla `prompts` no tiene ningún campo de frecuencia
ni de intervalo. El valor que viaja en el trabajo (`cadenceHours`) **se escribe pero ya no se lee**: se lee
**siempre la cadencia de la marca**. La razón está escrita en el código: si se leyera el valor del trabajo,
cambiar el override en el panel de admin movería lo que el dashboard considera "atrasado" mientras las
corridas reales seguirían al intervalo viejo.

**Dónde se cambia:** **Admin → Brands** → el diálogo de delay de la marca. Hay un mínimo de **1 hora**, y
se puede volver al default.

**Qué pasa si el worker se cae:** los jobs **se encolan, no se pierden**, pero **los trabajos de fondo se
detienen**. Hay que mirar los logs del worker y el `RestartCount`.

---

## 12. Variables de entorno y operación

El archivo que declara las variables es `packages/config/src/env-registry.ts`. **Hoy declara 61**, y cada
una dice si es de servidor o de cliente, en qué modos es obligatoria y para qué sirve.

**Las que más importan para operar BeAOS:**

| Variable | Para qué |
|---|---|
| `DATABASE_URL` | Conexión a PostgreSQL |
| `APP_URL` / `VITE_APP_URL` | URL pública de la app |
| `BETTER_AUTH_SECRET` | Secreto de sesión |
| `DEPLOYMENT_MODE` / `VITE_DEPLOYMENT_MODE` | Modo: `local`, `demo`, `whitelabel` o `cloud` |
| `ADMIN_API_KEYS` | Tokens Bearer de la API de administración |
| `SCRAPE_TARGETS` | Qué modelos y proveedores se consultan (`modelo:proveedor[:version][:online]`) |
| `ONBOARDING_LLM_TARGET` | Qué modelo corre el análisis de marca del onboarding |
| `DEFAULT_BRAND_DOMAINS` | Dominios que se agregan como marcas por defecto |
| `DEFAULT_DELAY_HOURS` | Cadencia por defecto de las marcas (**no está declarada en el registro**: ver abajo) |
| `AOS_PUBLIC_AUDITS_PER_DAY` / `_GLOBAL` / `_VERIFY_PER_DAY` | Cupos del audit público |
| `AOS_PUBLIC_CF_ONLY_INGRESS`, `AOS_PUBLIC_IP_SALT`, `AOS_PUBLIC_VERIFY_SECRET` | Endurecimiento del audit público |
| `AOS_PUBLIC_CORS_ORIGINS` | Orígenes que pueden leer los endpoints públicos desde un navegador |
| `MAASY_MCP_API_KEY` / `MAASY_MCP_TOKEN` / `MAASY_URL` | Integración con Maasy |
| `APS_*` | Precios, topes y modelos de la medición APS |
| `LLM_GATEWAY_URL` / `LLM_GATEWAY_KEY_BEAOS` | El gateway de costos de la medición |
| `SENTRY_DSN`, `VITE_SENTRY_DSN`, `DISABLE_TELEMETRY` | Observabilidad |

> **Hallazgo, y hay que arreglarlo:** el registro dice ser "el registro canónico de **todas** las variables
> de entorno que leen las apps", **y no lo es**. Hay **29 variables** que el código lee y que no están
> declaradas ahí, entre ellas **toda la familia que gobierna el costo del APS** (`APS_PRICES`,
> `APS_MAX_PROMPTS`, `APS_MAX_MODELS`, `APS_MAX_REPETITIONS`, `APS_MAX_CALLS_PER_RUN`, `APS_RUN_BUDGET_USD`,
> `APS_MONTH_BUDGET_USD`, `APS_BUDGET_POLICY`, `APS_CALL_TIMEOUTS`, `APS_JUDGE_MODEL`, `APS_JUDGE_VERSION`,
> `APS_JUDGE_MAX_TOKENS`, `APS_LIBRARY_MODEL`), las credenciales de Maasy y del gateway, y
> `DEFAULT_DELAY_HOURS`. Para el manual esto cambia una frase: **los topes de gasto del APS y la cadencia
> por defecto no se leen del registro; se leen del `.env` del servidor.**

**Operación del servidor** (esto es la instancia, no el código): servidor `contabo-believe`, carpeta
`/root/BeAos`, proyecto Compose `beaos`.

```bash
ssh contabo-believe
cd /root/BeAos

# estado
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml ps

# logs
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml logs -f web
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml logs -f worker

# levantar sin rebuild
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml up -d --no-build

# actualizar
git pull --ff-only
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml build
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml up -d --no-build
```

Tres cosas que ya fallaron una vez y conviene tener presentes:

- **Construir sin targets.** Si se construye solo `web worker`, la imagen de `db-migrate` queda vieja y
  **las migraciones nuevas no se aplican**, aunque el archivo esté en el repo: la app arranca y falla al
  escribir las columnas nuevas.
- Si `git pull` dice "already up to date" con código viejo, el clon está en modo single-branch:
  `git fetch origin master:refs/remotes/origin/master && git merge --ff-only origin/master`.
- Cambiar el `.env` no alcanza: hay que **recrear** los contenedores y mirar el `RestartCount` del worker.

**Backups recomendados:** `pg_dump` diario de la base, respaldo del volumen de Postgres, retención de 7 a
30 días.

**Estado, decisiones, runbook y pendientes de la integración AOS/APS:** viven en `AOS-APS-ESTADO.md`, en la
raíz del repositorio. Este manual es el de uso; ese es el de estado.

---

## 13. Cuando algo sale mal

### 13.1 "El candado bloqueó la publicación"

**Es el sistema funcionando**, no un error. Significa que tu bundle declara **menos** pruebas (claims) que
el perfil que tu web ya sirve. **Qué hacer:** confirmar pruebas en **Pruebas** hasta igualar o superar el
número de la web, y **regenerar los assets**. Recién ahí publicar.

### 13.2 Un archivo no aparece en el bundle

Significa que **falta el dato honesto** para armarlo (por ejemplo, no hay contacto de seguridad publicado o
no hay preguntas reales para el catálogo). **BeAOS prefiere no emitirlo antes que emitirlo vacío.**
**Qué hacer:** mirar la tarjeta correspondiente en **Plan** y completar lo que pide.

### 13.3 Error de credencial de Maasy

**Síntoma:** al apretar **Cargar marcas Maasy** o **Sincronizar DNA**, un error de credencial.
**Causa:** la credencial venció o falta. **Qué hacer:** avisar al admin — hay que cargar la **API key del
perfil** (`MAASY_MCP_API_KEY`), que **no expira**, en vez del token OAuth.

### 13.4 "Parcial" en una corrida de APS

**No es un error.** La corrida respondió menos de lo que planeó, o hubo que bajar las repeticiones para
entrar en el presupuesto. El motivo se muestra. **No la compares como si estuviera completa.**

**Dos causas conocidas, y ninguna es tu culpa:**

- **Un proveedor lento se queda sin tiempo.** Cada modelo tiene su techo de espera, y el que va por un
  proveedor que consulta una instantánea asíncrona (el camino de Perplexity por BrightData) necesita
  **minutos**, no segundos. Con un techo corto, ese modelo **no puede** terminar, no porque esté roto.
- **El presupuesto.** Si la corrida no entra en el tope, la única adaptación permitida es bajar
  repeticiones —y queda marcada como parcial—: los modelos de medición **nunca** se cambian por uno más
  barato.

### 13.5 El AOS no me ve un archivo que la web sí sirve

**Falla clásica y es de mayúsculas:** el motor pide la ruta **exacta** `/AGENTS.md`. Si el sitio sirve
`/agents.md` en minúscula, **no cuenta** aunque el archivo exista. Se arregla con un alias o un rewrite.
(Además, un 200 que devuelve la home —un SPA que responde todo— **tampoco cuenta**: el archivo tiene que ser
el archivo.)

### 13.6 Un modelo con banda distinta a los otros

**No es un error: es el resultado.** Significa que la marca no es pareja entre asistentes.

### 13.7 La entrega da 404

**Es correcto** mientras la entidad **no esté publicada**. Publicá (receta C).

### 13.8 El reporte o Opportunities tienen partes en inglés

El informe de **Opportunities** se genera en el **idioma objetivo** de la marca: si está vacío **cuando se
generó**, sale en inglés. **Qué hacer:** configurar el idioma en Settings → Brand y regenerar.

### 13.9 No me aparece una sección en el menú

- **Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities**: solo si la marca está
  *onboarded*.
- **Admin**: solo para administradores. Si tenés acceso a reportes pero no sos admin, solo vas a ver
  **Reports** dentro del grupo Admin.

### 13.10 Todo salió en el idioma equivocado

El mercado y el idioma **se leen cuando se genera** el contenido, no cuando se muestra. Configurá Brand
**primero** y regenerá.

### 13.11 La extensión me dice que me pasé del cupo

El cupo **real** es el que viene en la cabecera `RateLimit-Limit`, no un número fijo. Un 429 trae
`Retry-After` para decir **cuándo** podés volver. Si una pantalla te muestra un cupo distinto al de la
cabecera, **eso es un bug**: reportalo.

---

## 14. Cómo reportar feedback que sirva

**Esta sección es la razón del manual.** Queremos feedback **real**, no un "anda bien" o un "no me gustó".

**Probá las dos mitades**: la nuestra (AOS, APS, Pruebas, Plan, Agent Assets) **y la heredada de Getcito**
(Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities, Settings, Admin). De la heredada no
vamos a cambiar el estilo —eso es la frontera (§4.4)— pero sí nos importa si **no se entiende**, si **un
número no cierra** o si **el contenido generado sale en el idioma equivocado**.

### Antes de probar: dos reglas

1. **Una tarea por prueba.** No "probé todo": *"di de alta la marca X y vinculé el proyecto de Maasy"*.
2. **Anotá lo que esperabas ver.** Sin eso, no podemos saber si el problema es el producto o la expectativa.

### La lista de tareas para probar

Cada una tiene un **resultado esperado**. Si lo que ves no coincide, **eso** es el reporte.

| # | Tarea | Resultado esperado |
|---|---|---|
| 1 | Alta de una marca con su web, mercado e idioma | La marca queda creada y aparece en el menú |
| 2 | **AOS**: auditar una web | Un puntaje con su banda, las 4 etapas y los requisitos que fallan **ordenados por puntos** |
| 3 | **AOS**: auditar una web propia que no sea la de Believe | Un puntaje distinto, con la evidencia de cada requisito |
| 4 | **APS**: estimar una corrida sin ejecutarla | Muestra el **costo** y los **nombres de los modelos** antes de gastar |
| 5 | **APS**: correr y leer los resultados | Un APS por modelo, con banda, P10–P50–P90 y cantidad de respuestas |
| 6 | **Agent Entities**: cargar marcas de Maasy | Lista marcas de Maasy |
| 7 | **Agent Entities**: sincronizar el DNA | Trae el contexto y se ve en pantalla |
| 8 | **Pruebas**: convertir un fragmento en prueba | El formulario viene pre-cargado y **todo es editable** |
| 9 | **Pruebas**: guardar como **borrador** | Avisa que un borrador **no** entra al bundle |
| 10 | **Pruebas**: **confirmar** una prueba con número | Se guarda y el contador de "cuántas declararía el bundle" sube |
| 11 | **Pruebas**: confirmar una **sin número** | Te deja, y **no inventa** una métrica |
| 12 | **Pruebas**: confirmar una **sin los límites** | Te avisa que el estándar exige declarar el límite |
| 13 | **Agent Assets**: generar | Aparecen los archivos, cada uno con su ruta, su hash y su botón de descarga |
| 14 | **Agent Assets**: descargar un archivo y abrirlo | El contenido es legible y coherente |
| 15 | **Agent Assets**: publicar **sin** las pruebas suficientes | **Se niega**, y explica por qué |
| 16 | **Agent Assets**: publicar con las pruebas suficientes | Publica, y la entrega deja de dar 404 |
| 17 | **Plan**: abrir una entidad | 4 grupos, resumen de estados, y cada tarjeta con pasos y código para copiar |
| 18 | **Plan**: leer una tarjeta de "tu desarrollador" | Un desarrollador **que no conoce el proyecto** puede ejecutarla sin preguntar nada |
| 19 | **Reports**: generar y abrir | Trae AOS y APS con sus fechas, "Declarado" y "Medido" separados; se imprime bien en blanco y negro |
| 20 | **Settings → Brand**: cambiar el idioma objetivo | El contenido generado después sale en ese idioma |
| 21 | Entrar desde el celular | Las pantallas se pueden leer y usar |
| 22 | **Visibility**: elegir un período y ver el detalle por pregunta | Se ve si la marca fue mencionada, motor por motor |
| 23 | **Share of Voice**: mirar leaderboard y tendencias | Ranking de marcas y su evolución |
| 24 | **Share of Voice**: cambiar la lista de competidores y volver | El porcentaje cambia: **anotá contra qué set lo mediste** |
| 25 | **Query Fan-Out**: buscar una pregunta y ver sus consultas | Las búsquedas que dispara esa pregunta |
| 26 | **Citations**: filtrar por competidor | Las fuentes citadas, filtradas |
| 27 | **Opportunities**: abrir el informe | El contenido generado está en el **idioma objetivo** |
| 28 | **Settings → Competitors / Prompts / LLMs**: revisar y guardar | Los cambios persisten y se usan en las mediciones |
| 29 | **Admin → Queue**: mirar los trabajos en curso | Se ve qué está corriendo y qué terminó |
| 30 | **Admin → Brands**: cambiar la cadencia de una marca | La cadencia queda como "Custom" y el dashboard la respeta |
| 31 | **MCP**: llamar `list_brands` con una credencial | Devuelve las marcas; con una credencial revocada, 401 |
| 32 | **`/agent/<entidad>`**: abrir el índice de una entidad publicada | Lista los archivos con su hash |
| 33 | **`/agent/<entidad>`**: abrir una entidad sin publicar | 404, correcto |
| 34 | **Extensión**: auditar un sitio desde el popup | Score, banda, ejes, requisitos con evidencia y el perfil firmado |

### El formato del reporte

Copiá esto y completalo. **Corto y concreto vale más que largo y vago.**

```
TAREA:            (número de la lista, o qué estabas haciendo)
QUÉ ESPERABA:     (el resultado que preveías)
QUÉ PASÓ:         (lo que viste, literal si hay un mensaje de error)
DÓNDE:            (sección del menú y dirección)
CAPTURA:          (si se ve mal, una imagen)
SEVERIDAD:        (ver abajo)
```

### Los niveles de severidad

| Nivel | Qué significa | Ejemplo |
|---|---|---|
| **Bloqueante** | No puedo terminar la tarea | "Publicar no funciona ni con las pruebas confirmadas" |
| **Confuso** | Lo hice, pero no entendí lo que pasaba | "Dice 'por verificar' y no sé si es un error mío" |
| **Dato falso** | La pantalla afirma algo que no es cierto | "El cupo que muestra no coincide con el de la cabecera" |
| **Se ve mal** | Funciona pero se ve pobre o desprolijo | "El chip se superpone al texto en pantalla chica" |
| **Idea** | No está roto, pero faltaría algo | "Me gustaría poder exportar las pruebas a CSV" |

### Lo que **no** es un bug (por favor no lo reportes como tal)

- **"Publicar se negó."** Es el candado haciendo su trabajo. Reportalo solo si el bundle **sí** declara las
  mismas pruebas que el sitio y aun así se niega.
- **"Un archivo no se generó."** BeAOS no lo emite cuando falta el dato honesto. Es a propósito.
- **"Dice que no pudo leer el sitio y publicó igual."** Es el comportamiento acordado cuando no hay ninguna
  web legible. Reportalo igual si te parece riesgoso: es una decisión que se puede revisar.
- **"La corrida salió parcial."** Se muestra como parcial **a propósito**.
- **"Un modelo dio distinto que otro."** Ese **es** el resultado.
- **"El Plan dice 'por verificar'."** BeAOS no afirma lo que no midió.
- **"La sección Opportunities (o Visibility, o Citations) tiene colores verdes y rojos."** Es la frontera
  del fork: lo heredado se deja tal como viene (§4.4), documentado y a propósito.
- **"El vocabulario de la mitad heredada es distinto."** Habla de menciones, citas y share of voice, que es
  el vocabulario del monitoreo (§3).

**Lo que SÍ queremos que reportes de la mitad heredada:** que un número **no se entienda**, que una pantalla
**no diga para qué sirve**, que el contenido generado salga **en el idioma equivocado**, o que algo **no
cargue**. Eso es producto, no estilo.

### Y lo que más nos sirve

**La pregunta: "¿lo podrías hacer sin que yo te explique?"** Si la respuesta es no, el problema es el
producto, no la persona. Eso es exactamente lo que queremos saber antes de mostrárselo a un cliente.

---

## 15. Estado actual y lo que sigue sin respuesta

### 15.1 Lo que el código garantiza hoy

Verificado leyendo el código (no una corrida de producción): existen y están implementadas la auditoría
**AOS** con sus 11 requisitos puntuados y 8 diagnósticos, el **APS medido** con presupuesto y corridas
parciales marcadas como tales, el **APS declarado** desde claims y proofs, la pantalla de **Pruebas** con
candidatos desde Maasy, el **bundle** firmado con Ed25519, el **candado** de publicación con su guardián de
regresión, la **entrega** por URL pública y por API, la sección **Plan** con 36 tarjetas, el **MCP** con 27
herramientas, la **API v1** con su especificación, la **extensión** de Chrome y el **audit público** con
cupos.

### 15.2 Datos de producción — **a confirmar**

Los manuales viejos afirmaban números de producción (el AOS de `believe-global.com`, el APS declarado y
medido, un `orank`, un "journey", una sonda de comportamiento). **Esos valores no se pueden leer del
código, cambian con cada corrida, y no los voy a arrastrar como si fueran ciertos.** Se leen en su pantalla:

| Qué querés saber | Dónde se lee **hoy** |
|---|---|
| AOS actual de una web | Pantalla **AOS**, o el popup de la extensión |
| APS declarado | Pantalla **Pruebas** (el contador) y el reporte, bloque "Declarado" |
| APS medido por modelo | Pantalla **APS**, última corrida, y el reporte, bloque "Medido" |
| Cuántas pruebas sirve el sitio vs cuántas declararía el bundle | Pantalla **Pruebas** |
| Estado del Plan | Pantalla **Plan** (resumen de estados) |
| Escaneos externos (orank, journey, sonda de comportamiento) | **A confirmar:** no encontré en el código dónde se guardan esos resultados |
| Los gráficos del reporte, ¿siguen en inglés? | **A confirmar:** no encontré esa decisión en el código |
| La llave de firma, ¿se rotó? | **A confirmar:** es una acción de seguridad, no un dato del repositorio |
| El idioma de la mitad heredada, ¿depende de un parche local? | **A confirmar:** no encontré ese parche identificado en el código |
| La lista activa de modelos del despliegue | Settings → LLMs de cada marca, más `SCRAPE_TARGETS` |

### 15.3 Pendientes que el código sí muestra

| Qué | Por qué | De quién |
|---|---|---|
| **Que Maasy mande `claims` y `proofs`** | Hoy manda prosa y `claims[]` vacío: el bundle nace sin pruebas y el candado bloquea —hace bien— | Maasy |
| **Cargar la web en la entidad de Believe** | El candado prueba tres webs, pero si la entidad no la tiene cargada depende del respaldo | Quien administra (minutos) |
| **Declarar los `APS_*` y el resto en el registro de entorno** | Hay 29 variables leídas y no declaradas, incluidas las de costo | Ingeniería |
| **Sumar la entrega de assets a la especificación OpenAPI** | Existe como ruta y no está en el contrato | Ingeniería |
| **Una pantalla para las credenciales MCP por producto** | Hoy solo hay script | Ingeniería |
| **Completar el `/.well-known` propio de BeAOS** | Publica su server-card y su `security.txt`, pero **no** su `llms.txt`, su `AGENTS.md` ni su `brand.json` | Ingeniería |
| **Definir si la entrega queda en pull o se agrega push** | Hoy la web jala; empujar necesitaría credenciales de cada sitio | Decisión |
| **Verificar si el snippet del "operador" vive en BeAOS** | No lo encontré en el repositorio | A confirmar |

### 15.4 Lo que yo no pude responder al escribir este manual

Estas son las preguntas que quedaron abiertas. Sirven más que el manual, porque son exactamente lo que
todavía no está claro:

1. **¿Qué es "APS" para el equipo, cuando alguien dice "el APS"?** Hay tres números con ese nombre. El
   manual los separa, pero **la pantalla no**: el audit público llama `apsStandards` a un chequeo del
   estándar y el comentario del código lo describe como "el APS **medido** sobre los requisitos", que es una
   frase que confunde justo lo que hay que separar. ¿Se renombra en la UI?
2. **¿Cuál es el cupo real del audit público en producción?** El código tiene defaults (20 por IP, 2000
   globales), pero el valor efectivo es el del `.env` del servidor y no es legible desde el repositorio.
3. **¿Cuánto cuesta hoy una corrida de APS?** El precio por modelo vive en `APS_PRICES` (configuración, no
   código) y los topes por corrida y por mes también. El código garantiza que **no se gasta a ciegas**, pero
   no puede decir el número.
4. **¿La cadencia debería ser por prompt?** Hoy es **por marca**, y el payload que dice `cadenceHours` por
   prompt ya no se lee. Si la intención es que sea por prompt, eso es una decisión de producto, no un bug.
5. **¿Dónde se guardan los resultados de los escáneres externos?** No encontré en el código ni la sonda, ni
   `orank`, ni el "journey". ¿Son manuales? ¿Son de otro producto?
6. **¿El Bot Beacon va a tener fuente alguna vez?** Hoy el campo existe y vale `null` a propósito. Si Maasy
   lo tiene, ¿se integra o se saca del contrato?
7. **¿El candado debería bloquear cuando no puede leer el sitio?** Hoy avisa y publica. Es una decisión
   revisable, y es el agujero por el que se colaba una degradación silenciosa.
8. **¿"Publicar" la entidad de Believe es una tarea de una persona o de un proceso?** El manual lo deja como
   receta, pero depende de que existan las pruebas, y las pruebas dependen de Maasy.
9. **¿La mitad heredada va a seguir sin traducirse?** El vocabulario mezclado es la causa de confusión
   número uno. ¿Se unifica el idioma de las pantallas heredadas o se documenta y se convive?
10. **¿Qué pasa con el reporte?** Los manuales viejos decían que se repintó entero a propósito y que eso
    tiene un precio en conflictos de merge. No encontré esa decisión escrita en el código. **A confirmar.**

---

## 16. De dónde sale cada número de este manual

**Esta sección existe porque los tres bugs de esta semana vinieron de un dato recordado en vez de leído.**
Cada fila dice qué se afirmó y de qué archivo salió.

### Pantallas, rutas y menú

| Afirmación | Fuente |
|---|---|
| Grupos e ítems del menú, y sus condiciones (`onboarded`, admin) | `apps/web/src/components/app-sidebar.tsx:61-231` |
| Rutas `/app/<marca>/…` y sus nombres de archivo | `apps/web/src/routes/_authed/app/$brand/*.tsx` |
| Id de marca default = `default` | `packages/lib/src/db/provisioning.ts:42` |
| Reports en `/reports` y "Create New Report" | `apps/web/src/routes/_authed/reports/index.tsx:157` |
| Página "Agent Readiness" y los bloques "Declarado"/"Medido" | `apps/web/src/components/report-agent-page.tsx:138-145, 245` |
| Fechas del reporte ("Auditado el …", "Medido el …") | `apps/web/src/components/report-agent-page.tsx:72, 228` |
| Endpoints públicos del audit | `apps/web/src/lib/aos/public-audit.ts` (contrato) + `apps/aos-extension/README.md:93-94` |
| Dos hosts (landing vs app/API) | `apps/aos-extension/README.md:87-91` |
| El primer usuario queda admin global y el registro rechaza a los siguientes | `packages/lib/src/db/provisioning.ts:16-34, 60-74` y `apps/web/src/routes/auth/register.tsx:4` |
| El alta de marca pide nombre, web, mercado e idioma, deriva el id del host y **no** siembra prompts ni competidores | `apps/web/src/server/brands.ts:208-245, 282-300` y `apps/web/src/components/new-brand-card.tsx:55-78` |
| El "Setup" cuando falta la fila de la marca pide solo la web | `apps/web/src/components/brand-onboarding.tsx:19-45` |
| Página de detalle e historial de un prompt | `apps/web/src/routes/_authed/app/$brand/prompts/$promptId.tsx:2, 32-35` |
| Nombres canónicos de los modelos que BeAOS reconoce | `packages/lib/src/providers/models.ts:9-22` |
| BeAOS publica su propio server-card y su security.txt | `apps/web/src/routes/[.]well-known/mcp/server-card[.]json.ts:1-13` y `apps/web/src/routes/[.]well-known/security[.]txt.ts:1-13` |

### AOS

| Afirmación | Fuente |
|---|---|
| Bandas del AOS (80/60/35) | `packages/aos-aps/src/aos/audit.ts:237-242` |
| 11 requisitos puntuados | `packages/aos-aps/src/aos/requirements.ts:28-117` |
| 8 diagnósticos que no puntúan | `packages/aos-aps/src/aos/requirements.ts:123-188` |
| Pesos MUST=3 / SHOULD=2 / MAY=1 | `packages/aos-aps/src/aos/requirements.ts:190` |
| `AOS-API-01` solo aplica a `product_api` | `packages/aos-aps/src/aos/requirements.ts:86-92, 206-213` |
| Los puntos que devuelve arreglar (`gain`) | `packages/aos-aps/src/aos/requirements.ts:332-344` |
| Las 4 etapas del camino de un agente | `apps/web/src/components/aos-visual.tsx:87-111` |
| "El próximo paso" | `apps/web/src/components/aos-visual.tsx:220` |
| Techo de tiempo del motor AOS (8 s) y User-Agent | `packages/aos-aps/src/aos/audit.ts:58-63` |
| Los mismos 11 checks que Maasy (no divergen) | `packages/aos-aps/src/aos/requirements.ts:1-11` |
| La ruta exacta `/AGENTS.md` y el 200 con HTML que no cuenta | `packages/aos-aps/src/aos/audit.ts:256, 322-325, 362` |

**Comando para contar los requisitos:**

```console
$ grep -c 'id: "' packages/aos-aps/src/aos/requirements.ts
19
```

### APS

| Afirmación | Fuente |
|---|---|
| Bandas del APS (85/70/50/25) | `packages/aos-aps/src/preference/measurement.ts:171-177` |
| Pesos de las 5 dimensiones (25/20/20/20/15) | `packages/aos-aps/src/preference/measurement.ts:29-35` |
| Las 6 sub-métricas | `packages/aos-aps/src/preference/measurement.ts:52-59` |
| Peso redistribuido si falta una dimensión | `packages/aos-aps/src/preference/measurement.ts:161-169` |
| Bootstrap de 500 remuestras | `packages/aos-aps/src/preference/measurement.ts:18, 207` |
| P10/P50/P90 | `packages/aos-aps/src/preference/measurement.ts:236-238` |
| Un bloque por modelo, nunca mezclados | `packages/aos-aps/src/preference/measurement.ts:220, 243-246` |
| La biblioteca y la corrida son por entidad | `packages/aos-aps/src/db/schema.ts:180-187, 215-220` |
| Con una sola repetición el histograma degenera | `apps/web/src/components/aps-visual.tsx:82-85` |
| Los topes estructurales frenan la corrida antes de gastar | `packages/aos-aps/src/worker/budget.ts:211-226` |
| El proveedor asíncrono (Perplexity por BrightData) necesita minutos y su techo es por modelo | `packages/aos-aps/src/aps/targets.ts:68-85` |
| Cómo se marca una corrida parcial | `packages/aos-aps/src/db/schema.ts:231-239` y `apps/web/src/components/aps-visual.tsx:372-381` |
| Biblioteca: bloqueo 90 días | `packages/aos-aps/src/aps/library.ts:14` |
| Biblioteca: 50 prompts, rango 40–60 | `packages/aos-aps/src/aps/library.ts:15-16` |
| Mezcla 50/30/20 | `packages/aos-aps/src/aps/library.ts:18` |
| Un prompt que nombra la marca se descarta | `packages/aos-aps/src/aps/library.ts:1-11, 56-62` |
| Topes por defecto (50 prompts, 3 modelos, 3 repeticiones, 450 llamadas, política "stop") | `packages/aos-aps/src/worker/budget.ts:28-35` |
| Los topes salen de `APS_*` (env) | `packages/aos-aps/src/worker/budget.ts:50-60` |
| Precios en `APS_PRICES`, un modelo sin precio bloquea | `packages/aos-aps/src/worker/budget.ts:64-86, 110-140` |
| Juez por defecto `believe-deep`, biblioteca `believe-smart` | `packages/aos-aps/src/aps/gateway.ts:161-163, 243-244` |
| Refresh del informe de Opportunities (6 días) | `apps/web/src/server/opportunities.ts:450, 509` |
| Bot Beacon siempre `null` | `apps/web/src/lib/aos/public-audit.ts:545-565, 620` |

### Pruebas y candado

| Afirmación | Fuente |
|---|---|
| Formato del id `CLM-[A-Z0-9-]+` | `packages/aos-aps/src/preference/types.ts:29` |
| Tipos de prueba del estándar | `packages/aos-aps/src/preference/types.ts:18-25` |
| Métodos de verificación (`public_url`, `third_party_platform`, `signed_client`, `internal`) | `packages/aos-aps/src/preference/types.ts:26` |
| El límite (boundary) es obligatorio y su error es `APS-CLAIM-02` | `packages/aos-aps/src/preference/profile.ts:101-123` |
| La confianza se deriva del tamaño de muestra | `packages/aos-aps/src/preference/confidence.ts:29-33` y `profile.ts:128-135` |
| Un borrador no entra al bundle | `packages/aos-aps/src/claims/mapping.ts:66, 98, 158` |
| Reglas de herencia (4 reglas) | `packages/aos-aps/src/claims/mapping.ts:76-107` |
| El candado compara conteos de claims | `apps/web/src/lib/claims-guard.ts:22-31, 80-105` |
| Los tres desenlaces (bloquea / avisa sin bundle / avisa sin sitio) | `apps/web/src/lib/claims-guard.ts:88-104` |
| Las tres webs y su precedencia | `apps/web/src/lib/claims-guard.ts:52-76` y `apps/web/src/server/agent-assets-core.ts:386-406` |
| El candado se aplica al publicar | `apps/web/src/server/agent-assets-core.ts:569-630` |
| Texto del contador en Pruebas | `apps/web/src/routes/_authed/app/$brand/claims.tsx:324-355` |
| Textos "Borrador guardado…", "Convertir en prueba", "Lo que Maasy ya manda" | `apps/web/src/routes/_authed/app/$brand/claims.tsx:229, 624, 651` |

### Bundle, firma y entrega

| Afirmación | Fuente |
|---|---|
| Los 7 archivos que siempre salen y los 8 condicionales | `packages/aos-aps/src/assets/generate.ts:641-721` |
| Los campos del `brand.json` | `packages/aos-aps/src/assets/generate.ts:162-191` |
| Firma Ed25519 sobre los bytes exactos | `packages/aos-aps/src/provenance/sign.ts:5, 117-135` |
| La sub-marca hereda la clave del paraguas | `packages/aos-aps/src/provenance/sign.ts:145-160` |
| Índice público `/agent/<entityId>` con los hashes | `apps/web/src/routes/agent/$entityId/$.ts` |
| Manifiesto y `raw?path=` con `x-content-sha256` | `apps/web/src/routes/api/v1/agent-assets/$entityId/raw.ts` |
| 404 hasta publicar | `apps/web/src/routes/agent/$entityId/$.ts` y `apps/web/src/routes/api/v1/agent-assets/$entityId/raw.ts` |
| La entrega es solo por GET: la web jala, BeAOS no empuja | `apps/web/src/routes/agent/$entityId/$.ts` y `apps/web/src/routes/api/v1/agent-assets/$entityId/raw.ts` (solo handlers GET) |
| Tipos de entidad (`umbrella`/`product`) y el candado en el esquema | `packages/aos-aps/src/db/schema.ts:14-39` |

### MCP y API

| Afirmación | Fuente |
|---|---|
| Las 27 herramientas y su agrupación | `apps/web/src/server/mcp/tools/{agent,platform,actions}.ts` + `index.ts:19` |
| Nombre y versión del servidor MCP (`beaos`, `1.1.0`) | `apps/web/src/server/mcp/tools/index.ts:21-32` |
| Transporte: JSON-RPC, sin SSE, sin sesión, GET 405 | `apps/web/src/routes/mcp.ts:1-18, 53-85` |
| Credencial por producto (`agent_api_tokens`) + `ADMIN_API_KEYS` | `apps/web/src/lib/api-tokens.ts:1-20` |
| Token con prefijo `beaos_`, se guarda el sha256 | `apps/web/src/lib/api-tokens.ts:24-33` |
| El script de administración de tokens | `apps/web/scripts/beaos-tokens.mjs:1-25` |
| Las 12 rutas de la especificación OpenAPI | `packages/api-spec/src/openapi.json` |
| `/api/v1/openapi.json` se sirve sin credencial | `apps/web/src/middleware/deployment.ts:41-50` y `apps/web/src/lib/auth/policies.ts:129-133` |
| `/api/v1/docs` redirige | `apps/web/src/routes/api/v1/docs/index.tsx` |

**Comando para contar las herramientas del MCP:**

```console
$ node -e 'const fs=require("fs");let t=0;for(const f of ["agent","platform","actions"]){const s=fs.readFileSync(`apps/web/src/server/mcp/tools/${f}.ts`,"utf8");const n=[...s.matchAll(/^\tname: "([a-z_]+)",/gm)].length;console.log(f,n);t+=n}console.log("TOTAL",t)'
agent 9
platform 8
actions 10
TOTAL 27
```

### Cupos, cadencias y entorno

| Afirmación | Fuente |
|---|---|
| Cupo público por IP = 20, global = 2000, verificación = 1000 | `apps/web/src/lib/aos/public-audit.ts:22-40, 120-133` |
| Cabeceras de cupo (`RateLimit-Limit`, `-Remaining`, `-Reset`, `RateLimit-Policy`, `RateLimit`) | `apps/web/src/lib/aos/public-audit.ts:421-425` |
| Techos de tiempo del audit público (20 s / 4 s) | `apps/web/src/lib/aos/public-audit.ts:79-82` |
| `x-beaos-verify` y su semántica | `apps/web/src/lib/aos/public-audit.ts:42-87` |
| Mantenimiento cada 5 minutos | `apps/worker/src/index.ts:134-141` |
| Cadencia por marca (`delayOverrideHours` ?? default) | `apps/worker/src/jobs/process-prompt.ts:287-294` |
| El `cadenceHours` del trabajo ya no se lee | `apps/worker/src/jobs/process-prompt.ts:287-293` (comentario) |
| Default de cadencia = 24 h | `packages/lib/src/constants.ts:5, 15-19` |
| Backoff `[0.25, 0.5, 1, 2, 4, 8]` acotado a la cadencia | `packages/lib/src/run-backoff.ts:13, 26-32` |
| La cadencia se edita en Admin → Brands, mínimo 1 h | `apps/web/src/routes/_authed/admin/index.tsx:82-127` |
| La tabla `prompts` no tiene campo de frecuencia | `packages/lib/src/db/schema.ts:47-68` |
| El registro declara 61 variables | `packages/config/src/env-registry.ts` |
| 29 variables leídas que no están en el registro | ver el comando de abajo |
| Preferencia de `MAASY_MCP_API_KEY` sobre el token OAuth | `packages/aos-aps/src/maasy/client.ts:31-50` |

**Comando para ver las variables leídas que **no** están en el registro:**

```console
$ node -e '
const fs=require("fs");
const reg=fs.readFileSync("packages/config/src/env-registry.ts","utf8");
const names=new Set([...reg.matchAll(/^\t\tname: "([A-Z0-9_]+)",$/gm)].map(m=>m[1]));
console.log("registro:",names.size);
const {execSync}=require("child_process");
const files=execSync("grep -rl \"env\\.\" apps/web/src packages/*/src apps/worker/src 2>/dev/null | grep -v node_modules | grep -v \".test.\"",{encoding:"utf8"}).trim().split("\n");
const found=new Set();
for(const f of files){const s=fs.readFileSync(f,"utf8");
  for(const m of s.matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})/g))found.add(m[1]);
  for(const m of s.matchAll(/process\.env\.([A-Z][A-Z0-9_]{2,})/g))found.add(m[1]);}
const extra=[...found].filter(n=>!names.has(n)).sort();
console.log("fuera del registro:",extra.length);
console.log(extra.join("\n"));'
registro: 61
fuera del registro: 29
APP_PARENT_NAME
APP_PARENT_URL
APS_BUDGET_POLICY
APS_CALL_TIMEOUTS
APS_JUDGE_MAX_TOKENS
APS_JUDGE_MODEL
APS_JUDGE_VERSION
APS_LIBRARY_MODEL
APS_MAX_CALLS_PER_RUN
APS_MAX_MODELS
APS_MAX_PROMPTS
APS_MAX_REPETITIONS
APS_MONTH_BUDGET_USD
APS_PRICES
APS_RUN_BUDGET_USD
DEFAULT_DELAY_HOURS
LLM_GATEWAY_KEY_BEADS
LLM_GATEWAY_KEY_BEAOS
LLM_GATEWAY_URL
MAASY_MCP_API_KEY
MAASY_MCP_TOKEN
MAASY_SUPABASE_URL
MAASY_URL
MODE
NODE_ENV
PORT
READ_ONLY
VITE_DEMO_EMAIL
VITE_DEMO_PASSWORD
```

### La extensión y el Plan

| Afirmación | Fuente |
|---|---|
| Extensión MV3, versión 2.2.1, sin build, permisos mínimos | `apps/aos-extension/manifest.json:1-25` y `apps/aos-extension/README.md:12` |
| Qué muestra el popup (score, ejes, requisitos, badge, Bot Beacon, overlay) | `apps/aos-extension/README.md:114-137` |
| El badge Agent-Preferred solo si la firma verifica | `apps/aos-extension/README.md:127-129` |
| El Bot Beacon declara que no hay fuente | `apps/aos-extension/README.md:130-131, 148` |
| Los 4 grupos del Plan y sus títulos visibles | `apps/web/src/routes/_authed/app/$brand/blueprint.tsx:47-71` |
| Los 4 estados y sus etiquetas | `apps/web/src/routes/_authed/app/$brand/blueprint.tsx:25-45` |
| Los 4 responsables y sus etiquetas | `apps/web/src/routes/_authed/app/$brand/blueprint.tsx:33-38` |
| Cómo se decide el estado de cada ítem | `packages/aos-aps/src/blueprint/catalog.ts:950-961` |
| Los tipos de ítem y de responsable | `packages/aos-aps/src/blueprint/catalog.ts:23-26` |

**Comando para contar las tarjetas del Plan:**

```console
$ grep -c '^\t\tid: "' packages/aos-aps/src/blueprint/catalog.ts
36
$ grep -o 'kind: "[a-z]*"' packages/aos-aps/src/blueprint/catalog.ts | sort | uniq -c
  12 kind: "archivo"
   9 kind: "declinado"
   5 kind: "externo"
  10 kind: "servidor"
```

---

*Cualquier cosa de este manual que no se entienda es un problema del manual. Marcá la línea y decilo: se
corrige.*
