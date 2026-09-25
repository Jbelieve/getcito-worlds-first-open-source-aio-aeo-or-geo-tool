# Manual de BeAOS — para el equipo de Believe

**Versión:** 1.0 · 25 de septiembre de 2026
**Dónde vive:** `https://beaos.believe-global.com`
**Para quién es:** cualquier persona del equipo que necesite saber qué tan "agent-ready" es una marca y qué
hacer al respecto. **No hace falta saber programar** para usar la mayoría del producto.

---

## Índice

1. [Cómo usar este manual](#1-cómo-usar-este-manual)
2. [Qué es BeAOS, en humano](#2-qué-es-beaos-en-humano)
3. [Quién hace qué](#3-quién-hace-qué)
4. [El mapa del producto, y **qué es nuestro y qué viene de Getcito**](#4-el-mapa-del-producto)
5. [Sección por sección](#5-sección-por-sección)
6. [Resultado por resultado: cómo se lee cada número](#6-resultado-por-resultado-cómo-se-lee-cada-número)
7. [Integración por integración](#7-integración-por-integración)
8. [Recetas completas, de principio a fin](#8-recetas-completas-de-principio-a-fin)
9. [Cuando algo sale mal](#9-cuando-algo-sale-mal)
10. [Glosario](#10-glosario)
11. [**Cómo reportar feedback que sirva**](#11-cómo-reportar-feedback-que-sirva)
12. [Estado actual: qué funciona y qué falta](#12-estado-actual-qué-funciona-y-qué-falta)

---

## 1. Cómo usar este manual

- Si es tu **primera vez**: leé las secciones **2**, **3** y **4**. Con eso ya entendés todo el producto.
- Si vas a **usar una sección concreta**: andá directo al **5**.
- Si **no entendés un número** que estás viendo: sección **6**.
- Si algo **se rompe o te da un error**: sección **9**.
- Si vas a **probar el producto para darnos feedback**: sección **11**. Es la más importante para nosotros.

---

## 2. Qué es BeAOS, en humano

BeAOS mide y construye **la cara de una marca para los agentes de IA**.

La idea de fondo: hoy las personas entran a una web y compran. Mañana (y en parte ya hoy) **un agente entra
por vos**: lee, compara y recomienda. Si un agente no puede **entender** tu marca ni **verificar** lo que
decís, no te recomienda — recomienda a otro.

BeAOS responde **tres preguntas**:

| Pregunta | Cómo se llama | Sección |
|---|---|---|
| ¿Puede un agente **usar** esta web? | **AOS** | Menú **AOS** |
| ¿Los asistentes **prefieren** esta marca? | **APS** | Menú **APS** |
| ¿Qué archivos le faltan publicar para que todo eso sea cierto? | **El bundle** | Menú **Agent Assets** |

Y agrega una cuarta, que es la que más van a usar:

| ¿Qué hay que hacer, y quién lo hace? | **El Plan** | Menú **Plan** |

### Las dos cosas que BeAOS **no** hace

- **No inventa evidencia.** Si la marca no tiene una prueba, BeAOS no la escribe. Prefiere decir "falta" antes
  que publicar algo que un agente no pueda verificar.
- **No publica sin permiso.** Hay un candado: nada se entrega a un agente hasta que una persona lo aprueba,
  y si el perfil que se va a publicar es **peor** que el que la web ya muestra, **se niega**.

---

## 3. Quién hace qué

| Rol | Qué usa | Qué decide |
|---|---|---|
| **Marketing / cuenta** | Overview, Visibility, Share of Voice, Opportunities, Reports | Qué medir, qué reportar al cliente |
| **Especialista AOS/APS** | AOS, APS, Pruebas | Qué se publica y con qué pruebas |
| **Desarrollador** | Plan (los ítems "Lo hace tu desarrollador") | Cómo montar los archivos y las cabeceras en la web |
| **Admin** | Admin, Agent Entities | Marcas, credenciales, colas |

**La sección que se le pasa a un desarrollador es Plan.** Cada tarjeta se explica sola: qué es, por qué
existe, los pasos, el detalle exacto, el código para copiar y cómo comprobar que quedó.

---

## 4. El mapa del producto

El menú tiene cuatro bloques.

**Bloque de agentes** (lo nuevo, lo nuestro):

| Sección | Para qué |
|---|---|
| **AOS** | Auditar una web y obtener su puntaje de operabilidad |
| **Agent Entities** | Las "entidades" de la marca (la marca paraguas y sus productos) y su vínculo con Maasy |
| **Agent Assets** | Generar, descargar y **publicar** los archivos que un agente necesita |
| **Pruebas** | Confirmar las afirmaciones de la marca y con qué documento se prueban |
| **APS** | Medir lo que los asistentes responden realmente sobre la marca |
| **Plan** | Todo lo que hay que hacer, quién lo hace, y en qué orden |

**Bloque heredado** (visibilidad e IA en buscadores): Overview, Visibility, Share of Voice, Query Fan-Out,
Citations, Opportunities.

**Configuración:** Brand, Competitors, Prompts, LLMs.

**Admin** (solo administradores): Brands, Reports, Workflows, Queue, API Usage, Tools.

> Las direcciones son del tipo `/app/default/aos`. `default` es el id de la marca Believe.

---

### 4.1 · El origen: qué es nuestro y qué viene de Getcito

**Esto es importante que lo entienda todo el equipo, porque explica la mitad de las cosas raras que van a
ver.**

BeAOS **no se construyó desde cero**. Es un *fork* —una copia que sigue su propio camino— de **Getcito**, una
plataforma open source de visibilidad en buscadores con IA. Heredamos su motor, sus pantallas, su manejo de
marcas, su sistema de usuarios y su infraestructura. Sobre eso construimos la capa de agentes.

O sea que el producto tiene **dos mitades**:

| | **La mitad heredada (Getcito)** | **La mitad nuestra (BeAOS)** |
|---|---|---|
| **Qué pregunta responde** | ¿Cómo aparece la marca **hoy** en las respuestas de la IA? | ¿Puede un agente **usar** y **verificar** la marca? |
| **Qué mide** | Menciones, share of voice, citas, consultas | AOS, APS, pruebas, operabilidad |
| **Qué produce** | Monitoreo y reportes de visibilidad | Archivos firmados que la web publica |
| **Secciones** | Overview, Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities, Configuración, Admin | AOS, Agent Entities, Agent Assets, Pruebas, APS, Plan |
| **Cómo se ve** | Su propio lenguaje visual (verde/ámbar/rojo) | Los colores de Believe (azul/tinta/cian) |
| **De quién es el idioma** | El original | Español, y con la marca aplicada |

**Las dos mitades son válidas y se complementan.** Una dice cómo te ve la IA hoy; la otra hace que te pueda
usar y verificar mañana. Las dos terminan en el mismo reporte del cliente.

#### Por qué la mitad heredada se ve distinto (y no es un bug)

Decisión explícita, y conviene tenerla clara antes de reportar nada:

- **El código heredado se deja tal como viene.** Getcito sigue vivo y publica actualizaciones; cada línea
  nuestra ahí es un conflicto futuro. Así que las pantallas heredadas **conservan sus colores originales**
  (el semáforo verde/ámbar/rojo) y su vocabulario. **Es a propósito.**
- **Nuestras pantallas usan los colores de Believe.** La regla es: si la superficie es nuestra, habla el
  idioma de la marca.
- **La única excepción es el reporte**, que se repintó entero porque es un documento que ve el cliente. Esa
  excepción tiene un precio escrito: si Getcito toca el reporte, ese merge da conflicto. Se aceptó a
  sabiendas.

**Lo que esto significa para vos al probar:** que una pantalla heredada tenga verdes y rojos **no es un
hallazgo**, es la frontera. Pero **si te confunde, si no entendés un número, o si el texto está en inglés y
no debería — eso sí reportalo.** Confusión no es lo mismo que estilo.

#### Cosas heredadas que vas a notar

| Qué vas a ver | Por qué | Qué hacer |
|---|---|---|
| Colores verde/ámbar/rojo en las pantallas heredadas | Frontera del fork | Nada: es a propósito |
| **Opportunities** en español, pero con los colores viejos | El texto se arregló con un parche local; el estilo no se toca | Nada |
| Los **gráficos del reporte** en inglés | Son componentes compartidos con la mitad heredada | Reportalo si te molesta: es una decisión abierta |
| Vocabulario distinto ("menciones", "citas", "share of voice") | Es el vocabulario del monitoreo, no el de agentes | Usá el glosario (sección 10) |

#### Un detalle que conviene saber

El arreglo que hace que el contenido generado salga **en español** en vez de inglés es un **parche local**
nuestro, porque el proyecto original todavía no lo aceptó. El día que lo acepte, el parche se borra. Hasta
entonces, si ves contenido generado en inglés, avisá: puede ser que el parche se haya caído.

---

## 5. Sección por sección

### 5.1 · Overview (`/`)

El tablero general de la marca. Muestra el estado de visibilidad y, al final, las tarjetas de AOS y APS
resumidas.

**Cómo se usa:** es la pantalla de entrada. Si algo está en rojo o en cero, se investiga en su sección.

**Sirve para:** la foto rápida antes de una reunión.

---

### 5.2 · AOS (`/agent-ops`)

**Qué es:** el puntaje de **operabilidad**. Mide si un agente puede *usar* la web: si encuentra la
información, si entiende la identidad de la marca, si puede llamar a algo.

**Cómo se usa:**

1. Pegá la dirección de la web (por ejemplo `https://mi-marca.com`) en el campo.
2. Apretá **Auditar AOS**.
3. Esperá entre **20 y 60 segundos**: BeAOS recorre la web de verdad (pide archivos, mira cabeceras, prueba
   endpoints). No es una estimación.

**Qué devuelve:**

- Un **puntaje de 0 a 100** y una **banda** (ver sección 6.1).
- La lista de **requisitos**, cada uno con:
  - si **pasa**, **falla** o **no aplica** al tipo de negocio;
  - **qué se vio** al comprobarlo (la evidencia, en una línea);
  - y si falla, **cuántos puntos devolvería** arreglarlo (`+18.8 AOS` o `+9.4 APS`).
- Los requisitos que fallan están **ordenados por puntos**: arriba está lo que más mueve el número.

**Lo que hay que entender:** no todos los requisitos pesan igual, y **no todos puntúan**. Hay **11 que
puntúan** y **8 que solo se informan** (son diagnósticos: se muestran pero no mueven el número). La pantalla
los distingue.

**Errores típicos:**

| Mensaje | Qué significa | Qué hacer |
|---|---|---|
| "Brand not loaded" | No hay marca seleccionada | Elegí una marca arriba |
| "No se pudo iniciar la auditoría" | La web no respondió o la dirección está mal | Verificá que la dirección abra en el navegador |

---

### 5.3 · Agent Entities (`/agent-entities`)

**Qué es:** las **entidades** de la marca. Una marca puede tener una entidad paraguas y varias de producto
(por ejemplo, Believe y cada uno de sus productos). Cada entidad tiene su propia web, su propio perfil
firmado y su propia publicación.

**Dos conceptos que confunden y hay que separar:**

| Dónde | Qué es |
|---|---|
| La **marca** (en Configuración → Brand) | La marca como tal. Tiene su web. |
| La **entidad** (acá) | La superficie agéntica de esa marca. Tiene **su** web, que **es otro campo** |

**Cuidado: la web de la marca y la web de la entidad son dos campos distintos.** Si la de la entidad está
vacía, el sistema igual funciona (cae a la de la marca o a la que manda Maasy), pero conviene cargarla: es la
identidad de la entidad y evita que dos entidades con el mismo nombre se confundan.

**Conexión con Maasy:**

1. **Cargar marcas Maasy** → trae la lista de marcas que existen en Maasy (**solo las lista**, no importa
   nada).
2. **Vincular** una marca de Maasy con una entidad → guarda el vínculo.
3. **Sincronizar DNA** → baja el contexto de esa marca desde Maasy (identidad, tono, ICP, oferta, resultados).

**Si "Cargar marcas Maasy" da error de credencial:** la credencial de Maasy venció o falta. Ver sección 9.3.

---

### 5.4 · Agent Assets (`/agent-assets`)

**Qué es:** los archivos que la marca publica para que un agente la entienda y la verifique. BeAOS los
**genera**, los firma y los entrega.

**Cómo se usa:**

1. Elegí la **entidad**.
2. Apretá **Generar assets**. BeAOS arma los archivos con los datos de la marca.
3. Mirá la lista. Cada archivo tiene su ruta y un botón **Descargar**.
4. En la tarjeta **Publicación**, apretá **Publicar** cuando estés conforme.

**La tarjeta Publicación es un candado, y es importante entenderlo:**

- **Cerrado por defecto.** Hasta que no publiques, **nada** se entrega a ningún agente.
- Al publicar, BeAOS **compara**: cuántas pruebas declara tu perfil nuevo contra cuántas declara la web hoy.
- **Si el nuevo declara menos, se niega y te dice por qué.** Publicar un perfil con menos pruebas que el
  actual destruiría en silencio la evidencia de la marca.

**Los 15 archivos y para qué sirve cada uno:** ver sección 7.2.

---

### 5.5 · Pruebas (`/claims`)

**Qué es:** la pantalla donde una persona **confirma** qué afirmaciones hace la marca y **con qué documento
se prueba cada una**. Es la pieza que convierte "texto suelto" en evidencia que un agente puede verificar.

**Por qué existe:** Maasy manda la evidencia **en prosa** ("aumento promedio de 35% en conversión…"). Un
agente no puede leer un párrafo y confiar; necesita la estructura: *afirmación + número + prueba + cuándo
aplica y cuándo no*. BeAOS **no la convierte solo**, porque eso sería inventar evidencia: **la confirma una
persona**.

**Cómo se usa:**

1. Elegí la entidad.
2. Arriba vas a ver **el contador**: *"tu sitio sirve 6 pruebas · tu bundle declararía N"*.
3. Abajo, **"Lo que Maasy ya manda"**: los fragmentos originales, sin tocar, con la métrica que BeAOS
   detectó (si la hay) y el motivo por el que es candidato.
4. En el que quieras, apretá **Convertir en prueba**. Se abre el formulario **pre-cargado y editable**:
   - **Afirmación** — la frase que va a leer el agente.
   - **Número** — la métrica, tal como está en la fuente.
   - **Cuándo SÍ aplica / Cuándo NO aplica** — los límites. Esto es lo que separa una afirmación honesta de
     marketing vacío, y **es obligatorio en el estándar**.
   - **Id de la prueba** — el identificador. Viene pre-cargado con el formato que el validador exige;
     podés cambiarlo pero respetá el prefijo.
   - **Tipo de prueba**, **título**, **resumen**, **cliente**, **confidencialidad**.
   - **Cómo lo verifica un agente** — una de las opciones de la lista.
5. Guardá como **Borrador** o **Confirmar prueba**.

**Regla que hay que respetar:** **un borrador no entra al bundle.** Solo las confirmadas se publican. Es
deliberado: confirmar es el acto humano que hace que la marca se responsabilice de lo que afirma.

**El objetivo concreto:** el candado bloquea si el bundle declara **menos** pruebas que el sitio. Si tu web
sirve 6, necesitás **al menos 6 confirmadas** para poder publicar.

> **Atención, y es importante:** el candado **cuenta, no juzga**. Si confirmás 6 pruebas flojas y tu web hoy
> sirve 6 buenas, el candado te deja pasar y **reemplazarías 6 mejores por 6 peores**. Antes de confirmar en
> masa, compará con lo que la web ya publica.

---

### 5.6 · APS (`/agent-preference`)

**Qué es:** el puntaje de **preferencia**. Mide qué responden **modelos reales** cuando alguien pregunta por
la marca o su categoría. No es lo que la marca dice: es lo que los asistentes contestan.

**Se usa en tres pasos, en orden:**

**Paso 1 · Biblioteca de prompts.** Son las preguntas con las que se va a medir. Si la marca no tiene, se
generan (por ejemplo **"Generar 50 prompts de compra"**). Revisalos: la calidad de la medición depende de la
calidad de las preguntas.

**Paso 2 · Corrida.** Elegí entidad, apretá **Estimar corrida** y **mirá el costo antes de gastar**. La
estimación lista los modelos con sus nombres y avisa si falta el precio de alguno. Recién después corrés.
Tarda **10 a 20 minutos**.

**Paso 3 · Resultados.** El APS por modelo, con banda, rango P10–P90 y cantidad de respuestas.

**Cosas que vas a ver y que NO son errores:**

- **"Corrida parcial".** Respondió menos preguntas de las que planeó (por ejemplo, un proveedor no completó).
  Se muestra **como parcial, con el motivo**, en vez de fingir que está completa. Es correcto.
- **Modelos con bandas distintas.** Es un resultado, no un defecto: significa que el resultado **depende de a
  qué asistente le preguntes**.
- **P10–P90 ancho.** Con pocas repeticiones el rango es ancho. Es honesto.

---

### 5.7 · Plan (`/blueprint`)

**La sección más importante para pasar a un desarrollador.**

**Qué es:** **todo** lo que hay que hacer para que la marca sea operable y preferible por agentes, **incluido
lo que BeAOS no genera**. Cuatro grupos:

| Grupo | Qué contiene |
|---|---|
| **Lo que BeAOS ya genera** | Los archivos, y si están o no en el bundle |
| **Lo que hay que hacer en tu web** | Cosas que son **comportamiento del servidor**, no archivos: los twins Markdown, las cabeceras `Link`, una API con sus límites, el MCP, WebMCP |
| **Lo que hay que hacer fuera de tu web** | Wikidata y Wikipedia, publicar el SDK, el registro MCP, Search Console, el directorio de ChatGPT |
| **Lo que decidimos NO hacer** | Con el motivo, para que nadie lo "arregle" por error |

**Cada tarjeta trae:**

- **De quién es el trabajo**: *Lo hace BeAOS* / *Lo hace tu desarrollador* / *Lo hacés vos* / *No se hace*.
- **Por qué existe** (en una o dos frases).
- **Los pasos numerados**, ejecutables por alguien que no escribió esto.
- **El detalle exacto**: nombres de campo, cabeceras, valores.
- **El código para copiar**.
- **Cómo comprobar que quedó.**

**Los cuatro estados:**

| Estado | Significa |
|---|---|
| **Listo** | Está en el bundle generado |
| **Falta** | BeAOS lo genera y todavía no se generó |
| **Por verificar** | Está en la web o fuera de ella: **hay que medirlo desde afuera para saberlo** |
| **No se hace** | Decidido a propósito, con el motivo escrito |

> **"Por verificar" no es un error.** BeAOS prefiere decir "no sé" antes que pintar de verde algo que no
> comprobó.

---

### 5.8 · La mitad heredada, pantalla por pantalla

> **Todas estas pantallas vienen de Getcito**, no las construimos nosotros (ver 4.1). Conservan su estilo y su
> vocabulario a propósito. Solo aparecen si la marca está *onboarded*.

#### 5.8.1 · Visibility

**Qué responde:** dónde y cómo aparece la marca en las respuestas de cada motor de IA.

**Qué muestra:** las preguntas monitoreadas y, para cada una, si la marca fue mencionada y en qué motor.
Es la pantalla para ver el detalle crudo: no interpreta, muestra.

**Cómo se usa:** elegí el período y mirá prompt por prompt. Sirve para responder *"¿en qué preguntas
concretas no aparecemos?"*.

**Ojo:** que una marca **no** aparezca en una respuesta no significa que el motor la odie; significa que
**no la citó para esa pregunta**. La sección **Opportunities** es la que convierte eso en acción.

#### 5.8.2 · Share of Voice

**Qué responde:** qué porción de las menciones se lleva la marca **contra sus competidores**.

**Qué muestra:**
- **Leaderboard** — el ranking de marcas por menciones.
- **Trends** — cómo se mueve en el tiempo.

**Cómo se lee:** no importa solo el número propio, importa **la distancia con el que va primero** y **si la
tendencia sube o baja**. Un 11% que sube vale más que un 15% que cae.

**Cuidado con una trampa:** el share of voice depende de **qué competidores cargaste** y **qué preguntas
monitoreás**. Si cambia la lista de competidores, el porcentaje cambia sin que nada haya pasado en el
mercado. Anotá siempre contra qué set lo mediste.

#### 5.8.3 · Query Fan-Out

**Qué responde:** cuando un modelo responde una pregunta, **qué búsquedas dispara por dentro**.

**Qué muestra:** las consultas que se repiten entre tus preguntas y las que dispara cada pregunta, con las
palabras de cada consulta.

**Para qué sirve de verdad:** es la pantalla **más accionable** de la mitad heredada. Te dice **qué
términos** están buscando los modelos para responder sobre tu categoría. Eso es, literalmente, **de qué
escribir**. Si un competidor aparece y vos no, mirá acá: probablemente haya una consulta que él cubre y vos
no.

#### 5.8.4 · Citations

**Qué responde:** **de dónde saca la información** el modelo cuando habla de tu categoría.

**Qué muestra:** las fuentes citadas, con filtros por marca y por competidor.

**Para qué sirve:** si el modelo te cita desde un medio que no controlás, ahí hay una relación que cuidar.
Si cita a un competidor desde su propio sitio y a vos desde un tercero, ahí hay un hueco de contenido
propio.

#### 5.8.5 · Opportunities

**Qué responde:** **qué hacer**, priorizado.

**Qué muestra:** un informe con las oportunidades detectadas a partir de todo lo anterior.

**Lo que hay que saber:** este contenido **lo genera la IA**, y es el que más sufre el tema del idioma. Hoy
sale **en español** gracias a un parche nuestro (ver 4.1). Se regenera cada cierto tiempo; si lo ves en
inglés, avisá.

**Cómo se usa:** es la pantalla para llevarle al cliente. Cruzá lo que dice acá con **Plan**: lo de acá es
*"qué contenido falta"*, lo de Plan es *"qué le falta a la web para que un agente la use"*.

---

### 5.9 · Configuración (Brand, Competitors, Prompts, LLMs)

- **Brand** — nombre, web, dominios adicionales, alias, **mercado** e **idioma destino**. El idioma importa:
  todo lo que BeAOS genera con IA sale en ese idioma.
- **Competitors** — contra quién se compara.
- **Prompts** — las preguntas del monitoreo de visibilidad.
- **LLMs** — qué modelos están habilitados.

**Regla:** si el idioma destino está mal, **todo el contenido generado sale en el idioma equivocado**.

---

### 5.10 · Admin (Brands, Reports, Workflows, Queue, API Usage, Tools)

Solo para administradores.

- **Brands** — todas las marcas del sistema.
- **Reports** — generar y ver reportes de cliente (ver 5.10.1).
- **Workflows** — automatizaciones programadas.
- **Queue** — la cola de trabajos en segundo plano.
- **API Usage** — consumo.
- **Tools** — herramientas internas.

#### 5.10.1 · Reports (el documento para el cliente)

1. **Create New Report**: nombre y web de la marca.
2. Esperá a que termine y abrilo.
3. **Imprimilo o guardalo como PDF** desde el navegador.

**Qué trae:** el Share of Voice, todas las secciones **en español**, y al final una página
**Agent Readiness** con el **AOS** (puntaje, banda, requisitos) y el **APS** (declarado y medido, separados y
sin sumarse), más el cierre con los próximos pasos.

**Cada medición lleva su fecha**, porque el reporte es un documento fechado y el AOS/APS siguen moviéndose.
Y si una corrida fue parcial, lo dice.

---

## 6. Resultado por resultado: cómo se lee cada número

### 6.1 · El AOS

| Puntaje | Banda | Qué significa |
|---|---|---|
| **80 – 100** | **Agent-Operable** | Un agente puede usar la web |
| **60 – 79** | **Agent-Attemptable** | Puede intentarlo, con fricción |
| **35 – 59** | **Agent-Blocked** | Se traba |
| **0 – 34** | **Agent-Inert** | Es invisible para un agente |

**Cómo se compone:** 11 requisitos que puntúan, cada uno con un peso (obligatorio, recomendado, opcional) y
un eje. Los **8 diagnósticos** no mueven el número; se muestran porque son útiles.

**Regla de lectura:** **el número nunca se pinta por lo que vale.** Va en tinta de marca y el chip al lado
dice si está bien o mal. El color **ordena**, no juzga.

### 6.2 · El APS

**Hay dos APS y no se suman nunca:**

| | Qué es | De dónde sale |
|---|---|---|
| **Declarado** | Lo que la marca afirma, firmado | De las **Pruebas** publicadas en el perfil |
| **Medido** | Lo que los asistentes responden | De una **corrida real** contra modelos |

**Bandas del APS medido:**

| Puntaje | Banda |
|---|---|
| **85 – 100** | Agent-Native |
| **70 – 84** | Agent-Ready |
| **50 – 69** | Agent-Visible |
| **25 – 49** | Agent-Opaque |
| **0 – 24** | Agent-Blind |

**Los otros números de una corrida:**

- **Observaciones** — cuántas respuestas se consiguieron. Menos observaciones = menos confianza.
- **P10 – P90** — el rango donde cae el 80% de los casos. **Si es ancho, el resultado es inestable.**
- **Parcial** — la corrida no respondió todo lo que planeó. El motivo se muestra.
- **Distancia entre el mejor y el peor modelo** — si es grande, la marca **no es pareja** entre asistentes.
- **Bandas distintas** — más de una significa que **depende de a quién le preguntes**.

### 6.3 · El conteo de pruebas

En **Pruebas** y en el candado vas a ver dos números: **lo que tu sitio sirve** y **lo que tu bundle
declararía**.

- **Bundle ≥ sitio** → se puede publicar.
- **Bundle < sitio** → **se bloquea**. Regenerá o sumá pruebas.
- **No se pudo leer el sitio** → se publica **con un aviso**. BeAOS busca la web de la marca en tres lugares
  antes de rendirse.

### 6.4 · Los números de afuera (verificación externa)

- **Sonda de comportamiento** — 50 comprobaciones sobre la web. Se lee **"cuántas pasan de 50"**.
- **orank** — puntaje externo de 0 a 100 con grado. Lo importante **no es el total** sino el **reparto**: hay
  puntos que se arreglan con código (**CODE**), puntos que necesitan que alguien de afuera haga algo
  (**OFFSITE**), y puntos que se declinan a propósito (**DECLINE**). Decir "vamos a subir el score" sin mirar
  el reparto es trabajar donde no hay puntos.
- **Journey** — un agente **real** intentando una tarea en la web. Lo que importa: **pasos**, **errores 4xx**
  y **cuánto de la respuesta salió de la memoria del modelo en vez de la web**. El tiempo y el costo varían
  porque dependen del agente.

---

## 7. Integración por integración

### 7.1 · Maasy

**Qué es:** de dónde BeAOS saca los datos de la marca (identidad, tono, ICP, oferta, resultados y la
evidencia para las pruebas).

**Cómo se conecta:** BeAOS llama al *gateway* de Maasy con una **credencial**. Hay dos tipos, y **no son
equivalentes**:

| Credencial | ¿Expira? | Cuál usar |
|---|---|---|
| **API key del perfil** (`msy_…`) | **No** | **Esta.** Es la que usa BeAOS hoy |
| Token OAuth (`mcp_…`) | **Sí** | Solo como respaldo |

**Si la credencial vence, se rompen dos cosas:** la importación de marcas **y** la sincronización del DNA.
El síntoma es un error de credencial al apretar los botones.

**Las dos operaciones que BeAOS usa:** listar marcas, y traer el contexto de una marca.

**Lo que Maasy **no** manda hoy:** `claims` ni `proofs`. Esos campos no existen en su modelo, aunque el
contexto diga **"completo: 100%"**. La evidencia viene en **prosa**, y por eso existe la sección **Pruebas**.

### 7.2 · El bundle: los 15 archivos

| Archivo | Para qué sirve |
|---|---|
| `/llms.txt` | El índice para agentes. Lo primero que leen |
| `/llms-full.txt` | El contenido completo, para quien quiere todo junto |
| `/AGENTS.md` | Instrucciones para agentes que entran al sitio |
| `/robots.txt` | Qué puede crawlear cada bot, y con qué permiso (**Content-Signal**) |
| `/sitemap.xml` | El mapa del sitio |
| `/.well-known/agent-card.json` | La ficha del agente de la marca |
| `/.well-known/agent-permissions.json` | Qué permite y qué no |
| `/.well-known/brand.json` | **El perfil de marca**: identidad, claims y proofs |
| `/.well-known/security.txt` | A quién avisarle si alguien encuentra un problema de seguridad |
| `/.well-known/api-catalog` | Dónde está la API de la marca |
| `/.well-known/ai-catalog.json` | El catálogo de recursos para agentes |
| `/.well-known/mcp/server-card.json` | Dónde está el MCP de la marca |
| `/.well-known/brand.json.sig` | La firma del perfil |
| `/.well-known/keys.json` | La clave pública para verificar la firma |
| `/.well-known/http-message-signatures-directory` | La identidad para firmar mensajes |

**No todos se generan siempre.** Si falta el dato honesto para armar uno, **no se emite** en vez de emitirlo
vacío. Por eso el número puede ser 13, 14 o 15.

### 7.3 · La firma

Tres archivos trabajan juntos: `brand.json` (el contenido), `brand.json.sig` (la firma) y `keys.json` (la
clave pública).

**Por qué importa:** un agente que verifica la firma **no tiene que confiar en nosotros**. Cambia su lenguaje:
de *"la marca dice…"* a *"la afirmación firmada, verificada contra su clave…"*.

**Cómo se comprueba:** el `kid` de la firma tiene que ser **el mismo** que el de `keys.json`, y la clave
pública de BeAOS tiene que coincidir con la que publica la web.

### 7.4 · La entrega: dos caminos

**a) URL pública** (para webs que no pueden montar archivos):

```
https://beaos.believe-global.com/agent/<id-de-entidad>/.well-known/brand.json
```

Sin credencial. Y sin sufijo, esa misma dirección lista todo lo publicado con el hash de cada archivo.

**b) API con token** (para un agente de entrega, o para el *be agent* de la marca): el bundle completo, o un
archivo suelto con su hash, para poder probar que se escribió exactamente lo que se recibió.

> **Las dos dan 404 hasta que la entidad esté publicada.** Eso es correcto: el candado está cerrado por
> defecto.

### 7.5 · El MCP de BeAOS

**Qué es:** la puerta para que **otros productos** usen BeAOS sin programar una integración a medida.

**Dirección:** `https://beaos.believe-global.com/mcp`
**Credencial:** el mismo token de administración, en `Authorization: Bearer …` o `x-api-key`.

**Las 8 herramientas:**

| Herramienta | Qué hace |
|---|---|
| `list_brands` | Lista las marcas |
| `get_brand` | Una marca y sus entidades |
| `get_aos_audit` | El último AOS: puntaje, banda y requisito por requisito |
| `list_aps_runs` | Las corridas de APS con su banda y su P10–P90 |
| `get_agent_bundle` | El manifiesto del bundle publicado |
| `get_agent_asset` | Un archivo del bundle, byte a byte |
| `generate_agent_assets` | Genera o regenera el bundle |
| `publish_agent_assets` | Publica o despublica |

**Dos reglas que también rigen acá:** no se puede leer un bundle **sin publicar**, y publicar pasa por el
**mismo candado**. No hay una puerta más permisiva para los agentes.

### 7.6 · Los scanners de terceros

Herramientas **que no son nuestras**, para no creernos a nosotros mismos:

- **Sonda de comportamiento** — comprobaciones directas sobre la web.
- **orank** — puntaje externo, con el reparto por tipo de punto.
- **Journey** — un agente real intentando una tarea.

**Hoy, sobre `believe-global.com`:** sonda **50 de 50**, orank **86/100 grado A**, journey **3 pasos con 0
errores y 0% de memoria**.

**El reparto de lo que falta:** **CODE 0** · **OFFSITE 14,7** · **DECLINE 2,8**. O sea: **no queda nada que
construir en la web**; falta que alguien de afuera haga su parte.

---

## 8. Recetas completas, de principio a fin

### Receta A · Alta de una marca nueva

1. **Configuración → Brand**: nombre, web, **mercado** e **idioma destino**.
2. **Configuración → Competitors**: cargar los competidores.
3. **Agent Entities**: vincular la marca con su proyecto de Maasy y **sincronizar el DNA**.
4. **Configuración → Prompts** o **APS → Biblioteca**: las preguntas de monitoreo.

### Receta B · Saber cómo está una marca (30 minutos)

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
   - Si **se niega**: leer el motivo. Casi siempre es "el bundle declara menos pruebas que el sitio".

### Receta D · Entregar a una web

1. Publicá la entidad (receta C).
2. El desarrollador elige: **URL pública** o **API con token** (sección 7.4).
3. **Verificá** con la sonda externa que los archivos responden.

### Receta E · Un reporte para el cliente

1. **Reports → Create New Report**.
2. Esperá, abrilo, **guardá como PDF**.
3. Revisá que la página de Agent Readiness traiga el AOS y el APS con sus fechas.

---

## 9. Cuando algo sale mal

### 9.1 · "El candado bloqueó la publicación"

**Es el sistema funcionando**, no un error. Significa que tu bundle declara **menos** pruebas que tu web.
**Qué hacer:** confirmar pruebas en **Pruebas** hasta igualar o superar el número de la web, y **regenerar
los assets**. Recién ahí publicar.

### 9.2 · Un archivo no aparece en el bundle

Significa que **falta el dato honesto** para armarlo. Por ejemplo: no hay contacto de seguridad publicado, o
no hay preguntas reales para el catálogo. **BeAOS prefiere no emitirlo antes que emitirlo vacío.**
**Qué hacer:** mirar la tarjeta correspondiente en **Plan** y completar lo que pide.

### 9.3 · Error de credencial de Maasy

**Síntoma:** al apretar **Cargar marcas Maasy** o **Sincronizar DNA**, un error de credencial.
**Causa:** la credencial venció o falta. **Qué hacer:** avisar al admin — hay que cargar la **API key del
perfil** de Maasy (la que **no expira**).

### 9.4 · "Corrida parcial"

**No es un error.** Respondió menos preguntas de las que planeó. El motivo se muestra. El resultado se
publica **marcado como parcial**, nunca como si estuviera completo.

### 9.5 · Un modelo con banda distinta a los otros

**No es un error: es el resultado.** Significa que la marca no es pareja entre asistentes. Es información
valiosa.

### 9.6 · La entrega da 404

**Es correcto** mientras la entidad **no esté publicada**. Publicá (receta C).

### 9.7 · El reporte tiene partes en inglés

Solo los **gráficos** heredados del producto original. El resto está en español. Está anotado como decisión
pendiente: avisá si te molesta y se cambia.

### 9.8 · No me aparece una sección en el menú

- **Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities**: solo aparecen si la marca está
  *onboarded*.
- **Admin**: solo para administradores.

---

## 10. Glosario

| Palabra | Qué es, en humano |
|---|---|
| **AOS** | Agent Operability Score. Qué tan fácil es para un agente **usar** tu web. 0 a 100 |
| **APS** | Agent Preference Score. Qué tanto te **prefieren** los asistentes. Hay dos: **declarado** y **medido** |
| **Entidad** | La superficie agéntica de una marca. Una marca puede tener varias (paraguas y productos) |
| **Claim** | Una afirmación de la marca que se puede verificar: *"aumentamos la conversión 35%"* |
| **Proof** | La prueba de un claim: el documento que lo respalda |
| **Boundary** | Cuándo **sí** y cuándo **no** aplica un claim. Es lo que lo hace honesto |
| **Bundle** | El conjunto de archivos que la marca publica para los agentes |
| **Gate / candado** | La regla de que nada se publica sin aprobación humana, y nunca algo peor que lo publicado |
| **MCP** | La puerta para que **otros productos** usen BeAOS |
| **Maasy** | El sistema del que BeAOS saca los datos de la marca |
| **DNA** | El contexto de marca que manda Maasy: identidad, tono, ICP, oferta |
| **orank** | Un medidor externo (no nuestro) de qué tan listo está un sitio para agentes |
| **Journey** | Un agente real intentando una tarea en la web, medido paso a paso |
| **P10–P90** | El rango donde cae el 80% de los casos. Si es ancho, el resultado es inestable |
| **SoV** | Share of Voice: qué porción de las menciones se lleva la marca |

---

## 11 · Cómo reportar feedback que sirva

**Esta sección es la razón del manual.** Queremos feedback **real**, no un "anda bien" o un "no me gustó".

**Probá las dos mitades**: la nuestra (AOS, APS, Pruebas, Plan, Agent Assets) **y la heredada de Getcito**
(Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities, Configuración, Admin). De la heredada
no vamos a cambiar el estilo —eso es la frontera— pero sí nos importa si **no se entiende**, si **un número no
cierra** o si **el texto está en inglés cuando no debería**.

### Antes de probar: dos reglas

1. **Una tarea por prueba.** No "probé todo": *"di de alta la marca X y vinculé el proyecto de Maasy"*.
2. **Anotá lo que esperabas ver.** Sin eso, no podemos saber si el problema es el producto o la expectativa.

### La lista de tareas para probar

Cada una tiene un **resultado esperado**. Si lo que ves no coincide, **eso** es el reporte.

| # | Tarea | Resultado esperado |
|---|---|---|
| 1 | Alta de una marca nueva con su web, mercado e idioma | La marca queda creada y aparece en el menú |
| 2 | **AOS**: auditar `believe-global.com` | 100 · Agent-Operable · 11 requisitos en orden, con su evidencia |
| 3 | **AOS**: auditar una web propia que no sea la de Believe | Un puntaje distinto, con los requisitos que fallan **ordenados por puntos** |
| 4 | **APS**: estimar una corrida sin ejecutarla | Muestra el **costo** y los **nombres de los modelos** antes de gastar |
| 5 | **APS**: correr y leer los resultados | Un APS por modelo, con banda, P10–P90 y respuestas |
| 6 | **Agent Entities**: cargar marcas de Maasy | Lista marcas de Maasy |
| 7 | **Agent Entities**: sincronizar el DNA | Trae el contexto y se ve en pantalla |
| 8 | **Pruebas**: convertir un fragmento en prueba | El formulario viene pre-cargado y **todo es editable** |
| 9 | **Pruebas**: guardar como **borrador** | Avisa que un borrador **no** entra al bundle |
| 10 | **Pruebas**: **confirmar** una prueba con número | Se guarda y el contador de "cuántas declararía el bundle" sube |
| 11 | **Pruebas**: confirmar una **sin número** | Te deja, y **no inventa** una métrica |
| 12 | **Agent Assets**: generar | Aparecen los archivos, cada uno con su ruta y su botón de descarga |
| 13 | **Agent Assets**: descargar un archivo y abrirlo | El contenido es legible y coherente |
| 14 | **Agent Assets**: publicar **sin** las pruebas suficientes | **Se niega**, y explica por qué |
| 15 | **Agent Assets**: publicar con las pruebas suficientes | Publica, y la entrega deja de dar 404 |
| 16 | **Plan**: abrir una entidad | 4 grupos, resumen de estados, y cada tarjeta con pasos y código para copiar |
| 17 | **Plan**: leer una tarjeta de "tu desarrollador" | Un desarrollador **que no conoce el proyecto** puede ejecutarla sin preguntar nada |
| 18 | **Reports**: generar y abrir | Trae AOS y APS con sus fechas; se imprime bien en blanco y negro |
| 19 | **Configuración → Brand**: cambiar el idioma destino | El contenido generado después sale en ese idioma |
| 20 | Entrar desde el celular | Las pantallas se pueden leer y usar |
| 21 | **Visibility**: elegir un período y ver el detalle por pregunta | Se ve si la marca fue mencionada, motor por motor |
| 22 | **Share of Voice**: mirar leaderboard y tendencias | Ranking de marcas y su evolución |
| 23 | **Share of Voice**: cambiar la lista de competidores y volver | El porcentaje cambia: **anotá contra qué set lo mediste** |
| 24 | **Query Fan-Out**: buscar una pregunta y ver sus consultas | Las búsquedas que dispara esa pregunta |
| 25 | **Citations**: filtrar por competidor | Las fuentes citadas, filtradas |
| 26 | **Opportunities**: abrir el informe | El contenido generado está **en español** |
| 27 | **Configuración → Competitors / Prompts / LLMs**: revisar y guardar | Los cambios persisten y se usan en las mediciones |
| 28 | **Admin → Queue**: mirar los trabajos en curso | Se ve qué está corriendo y qué terminó |

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
- **"La sección Opportunities (o Visibility, o Citations) tiene colores verdes y rojos."** Es la frontera del
  fork: lo heredado se deja tal como viene (ver 4.1), documentado y a propósito.
- **"El vocabulario de la mitad heredada es distinto."** Habla de menciones, citas y share of voice, que es el
  vocabulario del monitoreo. Está en el glosario.

**Lo que SÍ queremos que reportes de la mitad heredada:** que un número **no se entienda**, que una pantalla
**no diga para qué sirve**, que el contenido generado salga **en inglés**, o que algo **no cargue**. Eso es
producto, no estilo.

### Y lo que más nos sirve

**La pregunta: "¿lo podrías hacer sin que yo te explique?"** Si la respuesta es no, el problema es el
producto, no la persona. Eso es exactamente lo que queremos saber antes de mostrárselo a un cliente.

---

## 12. Estado actual: qué funciona y qué falta

**Funciona hoy, verificado en producción:**

- AOS (100 · Agent-Operable sobre la web de Believe), APS (declarado 94 / medido 40-39-34), el bundle de
  archivos firmado, el candado de publicación, la entrega por API y por URL pública, el MCP de BeAOS con sus
  8 herramientas, la sección **Plan** completa, la sección **Pruebas** con los candidatos reales de Maasy, el
  reporte con AOS y APS en español, y las superficies públicas de BeAOS.

**La mitad heredada de Getcito** (Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities,
Configuración, Admin) **funciona y se prueba igual**, con dos cosas a tener presentes: conserva su estilo a
propósito (4.1), y su contenido generado depende de un parche de idioma que se borra cuando el proyecto
original acepte el arreglo.

**Falta, y por eso lo vas a ver incompleto:**

| Qué | Por qué | De quién |
|---|---|---|
| **Publicar la entidad de Believe** | El bundle declara 0 pruebas y la web sirve 6. Hay que confirmar las pruebas | **Vos, en Pruebas** |
| **Que Maasy mande `claims` y `proofs`** | No existen en su modelo, y su "completitud 100%" lo esconde | Maasy |
| **Los puntos de afuera (14,7)** | npm, el registro MCP, Wikidata, Search Console | Believe |
| **Los gráficos del reporte en inglés** | Son del producto original | Decisión pendiente |
| **Un token de MCP por producto** | Hoy todos comparten uno | Pendiente |

---

*Cualquier cosa de este manual que no se entienda es un problema del manual. Marcá la línea y decilo: se
corrige.*
