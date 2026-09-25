# BeAOS: qué quedó, qué falta y cómo se usa

> Para Jorge. Sin lenguaje técnico. Si algo acá no se entiende, el documento está mal, no tú.

---

## 1. BeAOS en una frase

**BeAOS mide y construye la cara de una marca para los agentes.** Dos cosas distintas:

- **Mide** cómo la ven: si un agente puede *usar* la web (**AOS**) y si los asistentes *prefieren* la marca (**APS**).
- **Construye** los archivos que la marca necesita publicar para que un agente la entienda y la pueda verificar
  (`llms.txt`, `AGENTS.md`, `/.well-known/…`), firmados.

---

## 2. Lo que YA funciona

Todo esto está en producción, en `https://beaos.believe-global.com`, y verificado con datos reales.

| # | Qué hace | Dónde se usa | Estado con Believe |
|---|---|---|---|
| 1 | **Auditar una web (AOS)** — score de 0 a 100, banda, y requisito por requisito qué pasa y qué no | Menú **AOS** | **100 · Agent-Operable**. Los 11 requisitos que puntúan pasan |
| 2 | **Medir lo que dicen los asistentes (APS medido)** — se les pregunta de verdad y se puntúa la respuesta | Menú **APS** | chatgpt **39**, google-ai-mode **40**, claude **34** |
| 3 | **Leer lo que la marca declara (APS declarado)** — sale de las pruebas que el sitio firma | Menú **AOS** y **APS** | **94** |
| 4 | **Generar los archivos de una marca y firmarlos** — 12 archivos, con firma Ed25519 | Menú **Agent Assets** | Genera los 12 |
| 5 | **Candado de publicación** — nada se entrega hasta que tú lo publicas, y no te deja publicar algo peor que lo que la web ya muestra | Menú **Agent Assets** → Publicación | Bloquea correctamente |
| 6 | **Entregar los archivos a una web** — otro producto o la web misma los puede leer y montar | Puerta de entrega | Lista |
| 7 | **Que tus otros productos usen BeAOS** — el MCP, sin programar nada nuevo | `https://beaos.believe-global.com/mcp` | **Funcionando**, 8 herramientas |
| 8 | **Reporte con AOS y APS, y con la cara de Believe** | Menú **Reports** | Página nueva + repintado |

**Lo que NO está roto:** el reporte nunca había tenido AOS ni APS. No se rompió: nunca se conectó. Ya está.

---

## 3. Cómo se usa (recetas)

### A. Medir el AOS de una web

1. Menú **AOS**.
2. Pegas la web (`https://mi-marca.com`) y aprietas **Auditar AOS**.
3. Te devuelve el **score**, la **banda** y la lista de requisitos: los que pasan, los que no, y **qué hacer
   ahora** ordenado por los puntos que devuelve cada arreglo (`+18.8 APS`).
4. Cada requisito dice **qué se vio** al comprobarlo. No es una opinión: es lo que respondió la web.

### B. Medir el APS (lo que los asistentes responden de la marca)

Son **tres pasos, en orden**, en el menú **APS**:

1. **Biblioteca de prompts** — de dónde salen las preguntas. Si la marca no tiene, se generan
   (**Generar 50 prompts de compra**).
2. **Corrida** — eliges la entidad, aprietas **Estimar corrida** (te dice **cuánto va a costar** antes de
   gastar) y después la corres.
3. **Resultados** — el APS por modelo, con su banda y su rango P10–P90.

> **Ojo con dos cosas:** si una corrida dice **parcial**, es que respondió menos preguntas de las que
> planeó — se muestra así a propósito, no como si estuviera completa. Y **AOS y APS no se suman**: son dos
> respuestas a dos preguntas distintas.

### C. Generar los archivos de una marca

1. Menú **Agent Assets**.
2. Eliges la **entidad** (la marca o uno de sus productos).
3. **Generar assets** → aparecen los 12 archivos, cada uno con **Descargar**.
4. En **Publicación** aprietas **Publicar**. Hasta que no lo hagas, **nada se entrega**.
5. Si el candado te frena, te dice por qué en el momento.

### D. Ver el reporte

1. Menú **Reports** → **Create New Report** (nombre y web de la marca).
2. Cuando termine, lo abres y lo **imprimes o guardas como PDF** desde el navegador.
3. Trae el Share of Voice **más** la página nueva de AOS y APS.

### D2. Ver el plan de implementación (la pantalla para tu equipo)

1. Menú **Plan** → *Plan de implementación*.
2. Es **todo lo que hay que hacer** para que los agentes puedan usar la marca, no solo los archivos que
   BeAOS genera. Está en cuatro grupos: **lo que BeAOS ya genera**, **lo que hay que hacer en la web**,
   **lo que hay que hacer fuera de la web**, y **lo que decidimos NO hacer** (con el motivo, para que nadie
   lo "arregle" por error).
3. Cada tarjeta dice **de quién es el trabajo** (*lo hace BeAOS* / *tu desarrollador* / *vos* / *no se
   hace*), **por qué** existe, los **pasos numerados**, **el detalle exacto** de la especificación, el
   **snippet para copiar**, y **cómo comprobar que quedó**.
4. Es la pantalla que se le pasa a un desarrollador cuando pregunta "¿y ahora qué hago?". No hace falta
   que nadie explique nada: la tarjeta se explica sola.
5. Los estados: **Listo** (está en el bundle), **Falta** (lo genera BeAOS y todavía no existe), **Por
   verificar** (está en la web o fuera de ella: hay que medirlo desde afuera) y **No se hace**.

### E. Que otro producto tuyo use BeAOS (el MCP)

Esto es para Maasy, BeAds, o el agente de una marca. Se conecta así:

```
Dirección:  https://beaos.believe-global.com/mcp
Clave:      Authorization: Bearer <la clave de administración>
```

Y ya puede pedirle a BeAOS, sin que nadie programe: **listar marcas**, **leer una marca**, **leer el AOS**,
**listar las mediciones de APS**, **leer los archivos generados**, **leer un archivo suelto**, **generar** y
**publicar**. El detalle técnico está en `MCP-BEAOS.md`.

---

## 4. Lo que FALTA

Ordenado por lo que más te traba.

| # | Qué falta | Por qué importa | De quién es |
|---|---|---|---|
| 1 | 🔴 **Las pruebas (claims) llegan vacías desde Maasy** | Es **el** bloqueo. El DNA que BeAOS recibe trae `claims[]` vacío y la evidencia como texto suelto. Resultado: BeAOS genera un bundle con **0 pruebas** mientras tu web ya sirve **6** y su APS declarado es **94**. El candado lo bloquea —hace bien— pero **no se puede publicar**. Se arregla **en la fuente**, en Maasy: convertir ese texto en claims con su prueba | Maasy |
| 2 | **La entidad Believe no tiene la web cargada en BeAOS** | Hoy el reporte se conecta con el AOS **por nombre**. Funciona, pero si mañana hay dos "Believe" se rompe. Es cargar un dato | Tú (5 minutos) |
| 3 | **El snippet del operador** (el `operator.js` que se pega en la web del cliente) | Decidiste que BeAOS lo **sirva** y que el código viva privado, para no publicarlo en el repo abierto. Falta que me digas **dónde está el código** | Tú → yo |
| 4 | **Mandar los archivos a las webs** | Hoy la web los **jala** (ya funciona). Que BeAOS los **empuje** a cada sitio necesita las credenciales de cada web. Decisión tuya si lo querés | Decisión |
| 5 | **BeAOS no publica su propio `/.well-known`** | Predicamos que las marcas lo publiquen y nosotros no lo hacemos. Es incoherente y es fácil de arreglar | Yo |
| 6 | **Una clave por producto** | Hoy todos comparten la misma clave. No se le puede quitar el acceso a uno sin cambiársela a todos | Yo |
| 7 | **APS con más repeticiones** | Hoy P10/P50/P90 casi no informan porque hay pocas repeticiones. Subirlo hace la medición más sólida | Yo (falta tu ok al costo) |
| 8 | **Perplexity vía BrightData nunca termina** | Es una de las 4 fuentes y **siempre** sale parcial. No es nuestro: el proveedor no completa. Hay que escalarlo con la evidencia que ya tenemos | Ticket a BrightData |
| 9 | **Rotar la llave de firma** | La llave actual quedó expuesta en un chat. Hay que rotarla | Yo, con tu ok |
| 10 | **Fama de la marca en IA** | ScamAdviser marca el dominio con "caution", no hay reseñas independientes ni Wikipedia, y buscar "Believe" no devuelve el dominio. Esto **no es software**: es lo que los asistentes citan al recomendarte | Marketing |

---

## 5. Lo que falta decidir (tuyo)

1. **El snippet del operador:** ¿dónde está el código para servirlo desde BeAOS?
2. **Entrega:** ¿la web jala los archivos, o BeAOS se los empuja?
3. **El AOS v2:** hoy BeAOS da **el mismo número que Maasy** a propósito. Se puede hacer uno mejor
   (mezclar requisitos alternativos, pesar según el APS), pero deja de ser comparable con lo que ya vendiste.
4. **El score viejo de Maasy (76):** ¿se muestra al lado del actual o se olvida?

---

## 6. Seis palabras, traducidas

| Palabra | Qué es, en humano |
|---|---|
| **AOS** | Qué tan fácil es para un agente **usar** tu web. De 0 a 100 |
| **APS** | Qué tanto te **prefieren** los asistentes. Dos números: lo que **declaras** (94) y lo que **responden** (34–40) |
| **Claims y proofs** | Las afirmaciones de la marca y la prueba de cada una. Sin esto, un agente solo tiene tu palabra |
| **Bundle / assets** | Los 12 archivos que la marca publica para que un agente la entienda y la verifique |
| **MCP** | La puerta para que **otros productos** usen BeAOS. No es una pantalla: es una conexión |
| **Gate / candado** | La regla de que nada se publica hasta que un humano lo aprueba, y nunca algo peor que lo que ya está publicado |

---

## 7. Si solo te llevas una frase

**Lo que falta no es software: es que Maasy mande las pruebas.** BeAOS ya mide, ya genera, ya firma, ya
entrega, ya reporta y ya puede ser consumido por tus otros productos. Lo único que impide cerrar el
círculo en la web de Believe es que el DNA llega sin las pruebas que la web ya tiene.
