# AOS-VISTA.md — el criterio canónico de la vista del audit

**Qué es esto.** La traducción de la respuesta de `POST /api/v1/aos/audit` al **modelo de vista** que
ven las personas: qué campos se muestran, con qué nombre, en qué orden y con qué reglas. Es el criterio
**único**: lo usan la extensión (`apps/aos-extension`) y el "mide tu web" de la landing
(`be-aos.believe-global.com`), que llaman al **mismo endpoint** y tienen que decir **lo mismo**.

**Por qué existe.** Si cada superficie traduce la respuesta a su manera, en dos meses dicen cosas
distintas: dos implementaciones del mismo criterio, y la segunda se separa de la primera sin que nadie
lo note. Este documento es la traducción; el código de la extensión
(`apps/aos-extension/lib.js` → `mapAuditResponse`, `mapRequirement`, `mapAps`, `mapSubScores`,
`mapBreakdown`, `mapBotBeacon`, `auditErrorText`, y los textos de `popup.html`) es la implementación
**de referencia** de este documento, no al revés.

**Es independiente del stack.** Nada de acá asume React, ni JavaScript, ni navegador. Todo se escribe
como *"a partir de la respuesta, mostrá esto así"*; cómo se pinte es una decisión de cada superficie.
El puerto a otra tecnología tiene que producir **los mismos textos y el mismo orden**, no los mismos
componentes.

---

## 1. El pedido (esto también es contrato)

| | |
|---|---|
| Método y ruta | `POST /api/v1/aos/audit` |
| Cabecera | `Content-Type: application/json` |
| Cuerpo | `{"url": "<URL completa>"}` — y **nada más** |
| Éxito | `200` con las **13 claves** de la sección 2 |

**La URL tiene que ir completa: con esquema y con path.** El endpoint tolera un dominio pelado
(`ejemplo.com`) y lo interpreta como `https://ejemplo.com/`, pero **la superficie no debe mandarlo
pelado**:

- el **path es parte de lo que se mide**: parado en `https://sitio.com/precios` hay que auditar esa
  página, no la home;
- un dominio pelado depende de una tolerancia del servidor que existe para no romper clientes viejos,
  no como contrato de entrada.

Lo que se manda es la URL de la pestaña / del campo tal como la escribió la persona, ya validada como
`http(s)`. **No** se manda el dominio, ni el `hostname`, ni una URL "normalizada" a mano.

> ⚠️ **Advertencia que costó una release.** Un stub que devuelve la respuesta **cocinada** esconde un
> pedido mal armado: si el test sólo verifica el mapeo de una respuesta guardada, el popup se ve
> perfecto y **todos** los pedidos reales pueden estar saliendo inválidos. Ya pasó exactamente eso: el
> popup renderizaba de maravilla y el endpoint respondía `400 invalid_url` a todo, porque se mandaba el
> dominio pelado sin esquema. Al portar esto: **verificá el pedido real**, contra el endpoint real (o
> contra un doble que valide el cuerpo de verdad), y comprobá que el cuerpo lleve `http(s)://` y el
> path. Un test del mapeo no reemplaza a un test del pedido.

---

## 2. El modelo de vista

Se construye **una vez** a partir de la respuesta y se pinta en este orden, con esta jerarquía. Los
nombres del modelo son los de la respuesta cuando existen; cuando el modelo agrega un campo derivado,
se dice de dónde sale.

### 2.1 La respuesta (13 claves, congeladas)

```jsonc
{
  "url": "https://sitio.com/precios",   // string
  "score": 0,                            // 0..100
  "band": "Agent-Inert",                 // Agent-Operable | Agent-Attemptable | Agent-Blocked | Agent-Inert
  "businessType": "brand",               // brand | product_api
  "requirements": [ /* ver 2.4 */ ],     // los que puntúan + los diagnostic, en el orden del estándar
  "aosStandards": 0,                     // sub-score por eje, medido por el motor
  "apsStandards": 0,                     // sub-score por eje, medido por el motor
  "breakdown": [ /* por eje: passed, failed, notApplicable, applicable, earnedWeight, maxWeight, percent */ ],
  "declaredAps": null,                   // APS que el SITIO declara en su brand.json, o null
  "claims": 0,                           // claims que declara su brand.json
  "signatureVerified": false,            // ¿la firma Ed25519 de su brand.json verifica?
  "botBeacon": null,                     // SIEMPRE null hoy (ver 3.6)
  "auditedAt": "2026-09-30T03:54:52.021Z"
}
```

`aosStandards`, `apsStandards`, `breakdown` y `botBeacon` son **aditivos de la 2.1.0**: una respuesta
vieja (contrato 2.0.0) no los trae. La vista tiene que funcionar igual sin ellos (ver 5.3).

### 2.2 Orden y jerarquía de los bloques

1. **El score y la banda, arriba.** El número grande `score` (`—` si no vino), `/100` como sufijo, y al
   lado la banda. La banda se muestra con su **nombre corto** y lleva su explicación en una línea.
   El número **no se colorea por lo que vale**: es un dato. La banda sí usa la rampa.
2. **Los puntajes por eje** (`breakdown`, o `aosStandards`/`apsStandards` si el desglose no vino), cada
   uno con su nombre, `percent/100`, su barra y una línea de detalle:
   `<pasados> de <aplicables> pasan · peso <ganado>/<máximo>`, más `· <n> no aplica` cuando hay alguno.
   **Sin denominador no hay barra**: si `maxWeight` es 0, no se dibuja la barra ni la línea de detalle
   (una barra al 50% de nada no significa nada).
3. **De qué se trata**: el tipo de negocio y cuándo se midió (`auditedAt`).
4. **El perfil firmado del sitio**: APS declarado, pruebas declaradas, y si la firma verifica. Con su
   badge, solo si corresponde (3.5).
5. **El próximo paso**: el arreglo de mayor ganancia del plan (3.3). Si no hay plan, el bloque no
   aparece.
6. **El checklist: los requisitos que puntúan** (`requirements` con `diagnostic !== true`), con su
   conteo.
7. **Los diagnósticos, aparte** (`diagnostic === true`), con su propio título y su conteo. Si no hay
   ninguno, el bloque no se muestra.
8. **El Bot Beacon**, siempre presente (3.6).
9. El formulario de contacto, si la superficie lo tiene. Es opcional y no es parte del criterio.

Los títulos de los bloques también son parte del criterio (son lo que hace que dos superficies se lean
igual):

| Bloque | Título | Acompañante |
|---|---|---|
| Puntajes por eje | `Puntajes por eje` | `Del motor` |
| De qué se trata | `Lo que ve un agente` | el tipo de negocio |
| Perfil firmado | `Perfil firmado del sitio` | `APS declarado` o `sin perfil` |
| Próximo paso | `Próximo paso` | — |
| Checklist | `Requisitos que puntúan` | `<n> · <m> en falta` |
| Diagnósticos | `Diagnóstico · no mueve el score` | `<n>` |
| Bot Beacon | `Bot Beacon` | `sin fuente` (hoy siempre) |

El "próximo paso" se compone así: `<id> · <title>` como título, y como detalle
`Arreglarlo devuelve 18.8 puntos. Quedan 10 requisitos que puntúan en falta.` (con `Queda 1 requisito…`
en singular). El conteo de "en falta" es el de los que **puntúan** y fallan, no el de todos los que
fallan: un diagnóstico en falta no se arregla para subir el número.

### 2.3 Los nombres y los textos

Estos son los textos canónicos. Traducirlos es traducir la interfaz, no el criterio; cambiarlos es
cambiar el criterio y hay que cambiarlo acá primero.

| Concepto | Valor en la respuesta | Cómo se muestra |
|---|---|---|
| Banda | `Agent-Operable` / `Agent-Attemptable` / `Agent-Blocked` / `Agent-Inert` | `Operable` / `Intentable` / `Bloqueado` / `Inerte` |
| Banda desconocida | cualquier otro string | el string tal cual; si viene vacío o ausente, `Sin dato` |
| Explicación de la banda | — | Operable: "Un agente puede operar este sitio casi sin fricción." · Intentable: "Un agente puede intentarlo, pero tropieza en partes." · Bloqueado: "Un agente choca contra muros: casi nada es ejecutable." · Inerte: "Invisible para agentes. No hay acciones operables." |
| Eje | `AOS` / `APS` | `AOS · operabilidad` / `APS · preferencia` |
| Tipo de negocio | `brand` / `product_api` | `marca / servicio` / `producto-API`; sin dato: `tipo de negocio sin dato` |
| Cuándo se midió | `auditedAt` (ISO 8601) | `Medido el 30/09/2026 a las 10:54`, en hora local y corta; si falta o no es una fecha, no se muestra nada |
| Estado del requisito | `pass` / `fail` / `n_a` | `Pasa` / `No pasa` / `No aplica` |
| Glifo del estado | — | `✓` / `✕` / `—` |
| Tono del estado | — | el que pasa usa el acento (`primary`); el que falla, tinta plena (`ink`); `n_a`, atenuado (`muted`) |
| Fuerza del requisito | `MUST` / `SHOULD` / `MAY` | `Obligatorio` / `Recomendado` / `Opcional`; otra: el valor tal cual |
| Ganancia | `gain` | `Arreglarlo devuelve 18.8 puntos.` (singular: `1 punto`) |
| Sin evidencia | `evidence` ausente | `Sin evidencia registrada.` |
| Sin perfil firmado | `declaredAps: null` | `Sin perfil firmado` + `El sitio no publica /.well-known/brand.json: no declara APS.` |
| APS declarado | `declaredAps: 94` | `APS declarado 94/100` |
| Pruebas declaradas | `claims: 6` | `6 pruebas declaradas` (singular: `1 prueba declarada`) |
| Firma que verifica | `signatureVerified: true` | `La firma Ed25519 verifica contra el keys.json que el sitio publica.` |
| Firma que no verifica | `signatureVerified: false` con perfil | `Publica perfil pero la firma Ed25519 no verifica.` |
| Badge | `signatureVerified: true` | `Agent-Preferred · perfil firmado verificado` |
| Bot Beacon sin fuente | `botBeacon: null` | `BeAOS mide el estándar de un sitio, no su tráfico.` y la etiqueta `sin fuente` |

**Ningún estado depende solo del color**: cada requisito lleva su glifo y su palabra, porque el color
no es accesible ni imprimible. La rampa **ordena, no juzga**: lo que falta se marca con tinta plena y
su glifo, no con un rojo nuevo.

### 2.4 Cada requisito (la fila del checklist)

| Campo del modelo | De dónde sale | Cómo se muestra |
|---|---|---|
| `id` | `requirements[].id` | literal, en tipografía menor (si falta: `—`) |
| `title` | `requirements[].title` | literal, es el enunciado del requisito (si falta: `—`) |
| `status`, `statusText`, `glyph`, `tone` | `requirements[].status` | ver 2.3 |
| `axis`, `strengthText`, `statusText` | `requirements[].axis`, `.strength` | una línea de metadatos: `AOS · Recomendado · No pasa` |
| `evidence` / `evidenceText` | `requirements[].evidence` | el texto de la evidencia **cuando está**; si no, `Sin evidencia registrada.` |
| `gain` | `requirements[].gain` | la línea de ganancia **solo si el campo viene**: un `gain` ausente no se rellena con `0` |
| `diagnostic` | `requirements[].diagnostic` | decide en qué lista va la fila; no se muestra como texto |

**El orden de las filas es el de la respuesta** (el orden del estándar). No se reordena para "quedar
mejor", no se agrupa por eje ni se ordena por gravedad: el checklist es la referencia y su orden es
parte del dato. Lo que sí se separa es lo que puntúa de lo que diagnostica (3.3).

---

## 3. Las reglas que NO se reinventan

Cada una con su porqué. Si una superficie "mejora" alguna de estas, deja de ser la misma medición.

### 3.1 `status`: `pass` / `fail` / `n_a` — y `n_a` se dice, no se esconde

`n_a` es **"no aplica"**: el requisito no corresponde a este tipo de negocio. Se muestra con su glifo,
su palabra (`No aplica`) y su evidencia si la hay.

*Por qué:* esconder los `n_a` haría que el conteo del checklist no cierre —el total no daría la suma
de lo que se ve— y dejaría al lector sin saber por qué un requisito obligatorio del estándar no
aparece. Y contarlos como "no pasa" sería mentir en la otra dirección: no es que el sitio falle, es que
no aplica.

Un `status` que no sea uno de los tres valores se trata como `n_a` (ver 6, observación 3).

### 3.2 `evidence` puede faltar, y cuando está **se muestra**

La evidencia es el texto que dice **qué se vio** ("`/llms.txt` responde 404.", "`robots.txt` responde
200 · `sitemap.xml` responde 200."). Se muestra siempre que venga. Cuando no viene, se dice
`Sin evidencia registrada.`

*Por qué:* la evidencia es lo que convierte el checklist en un listado **robusto** en vez de un sí/no
pelado. Un "No pasa" sin evidencia es una opinión; con "`/llms.txt` responde 404" es una medición que
la persona puede comprobar en su navegador. Y el campo **puede** faltar (una respuesta vieja, un probe
sin detalle), así que la vista tiene que tener un texto para ese hueco en lugar de un espacio en
blanco.

La evidencia la escribe el sitio auditado (nombres de archivo, cabeceras, títulos): es **texto de
datos**, se escapa/serializa como texto y nunca se interpreta como marcado.

### 3.3 `gain` solo existe en los que puntúan y fallan; los `diagnostic` no mueven el score

- Un requisito **puntúa** cuando `diagnostic !== true`. Solo los que puntúan entran al score.
- `gain` es "cuánto devolvería arreglar esto" y **solo lo mandan los que puntúan y hoy fallan**. Un
  `gain` ausente **no** se rellena con `0`: *"no gana puntos"* y *"no se midió"* no son lo mismo.
- Los `diagnostic: true` **se informan y no mueven el score**. Van en **su propio bloque**, con su
  propio título (`Diagnóstico · no mueve el score`), **sin puntos**: ni `gain` real ni inventado.
- El **plan** ("qué hacer ahora") son los que puntúan, fallan y tienen `gain`, de mayor a menor
  ganancia. El "próximo paso" es el primero del plan.

*Por qué:* mezclar diagnósticos con requisitos haría creer que arreglarlos **sube el número**. No lo
sube. Y ponerles puntos inventados sería peor que no mostrarlos: sería prometer una mejora que el
motor no va a reflejar. Que los `diagnostic` fallen cuenta como información, no como tarea puntuable.

### 3.4 `declaredAps` **no** es `apsStandards`

Son dos números distintos y van **etiquetados distinto**:

| Campo | Qué es | Cómo se etiqueta |
|---|---|---|
| `apsStandards` | el APS que **nosotros medimos** sobre los requisitos del estándar | dentro de "Puntajes por eje", `APS · preferencia` |
| `declaredAps` | el APS que el sitio **declara** en su `/.well-known/brand.json` | aparte, `APS declarado 94/100`, en "Perfil firmado del sitio" |

*Por qué:* uno es lo que el sitio **dice de sí mismo** y el otro lo que **medimos nosotros**. En una
respuesta real y verificada pueden diferir: en `audit-believe-global.json` el sitio declara **94** y
nuestro motor mide **100** sobre los requisitos del estándar. Si los dos se mostraran como "el APS" sin
decirlo, la vista estaría repitiendo la declaración del sitio como si fuera nuestra medición —justo lo
contrario del punto de AOS/APS—. Es la misma distinción que entre "lo que declarás" y "lo que
comprobamos".

Cuando el sitio no publica `brand.json`, `declaredAps` viene `null` y **se dice**: "Sin perfil firmado"
+ el texto de 2.3. **No** se rellena con *"APS 0 / 0 pruebas / firma inválida"*: nadie midió eso.

### 3.5 El badge, solo con la firma verificada

`Agent-Preferred` se muestra **únicamente** cuando `signatureVerified === true`. Publicar un perfil no
alcanza; **no hay una versión "apagada" del badge**, porque un badge apagado sigue diciendo
Agent-Preferred. Sin perfil publicado no hay badge.

*Por qué:* el badge **certifica** que el perfil firmado se pudo comprobar contra las claves que el sitio
mismo publica. Si no verifica, lo único honesto es decir que publica perfil y la firma no verifica.

### 3.6 `botBeacon` viene siempre `null`: se dice el hueco con palabras y **sin un solo dígito**

El endpoint devuelve `botBeacon: null` **siempre**, porque BeAOS no tiene ningún ingest de tráfico
agéntico: no hay tabla, ni middleware, ni clasificador de user-agents. Para una URL arbitraria no hay
nada que medir.

La vista lo dice con palabras (`BeAOS mide el estándar de un sitio, no su tráfico.`) y una etiqueta
(`sin fuente`), y **no muestra ningún número**, ni siquiera un `0`.

*Por qué:* un `0` se lee como *"no te visitó ningún agente"*, que es una afirmación sobre el mundo; el
hueco real es *"no lo sabemos"*. Son cosas distintas y sólo una es cierta. Si algún día aparece una
fuente real, el modelo de vista ya tiene el bloque y los campos
(`windowDays`, `crawlHits`, `distinctAgents`, `topAgents[].agentName`, `operationAttempts`,
`operationFailures`); hasta entonces el valor es `null` y se declara.

*Nota de implementación (referencia):* el mapeo de la extensión trata un beacon **presente pero con
todos los números en cero** igual que `null`, por el mismo motivo. Es la lectura conservadora: un
beacon con ceros no distingue "no hubo" de "no medimos".

### 3.7 Los errores

El texto del error **nunca** es un volcado técnico: dice qué pasó y qué puede hacer la persona. La
respuesta de error trae `error` (nombre), `message` (texto del servidor, para la consola) y, en el 400,
`code`. La vista decide por `status` + `code`, **no** por el `message`.

| Caso | Cómo se detecta | Qué se muestra |
|---|---|---|
| Dirección que no se pudo interpretar | `400` con `code: "invalid_url"` | Título: `No se pudo interpretar la dirección`. Detalle: `No pudimos leer esa dirección como una URL. Probá con una dirección completa, con su https:// (por ejemplo, https://ejemplo.com/precios).` |
| Dirección que queda afuera por seguridad | `400` con `code: "blocked_url"` | Título: `Esa dirección queda afuera por seguridad`. Detalle: **sólo** que el endpoint audita sitios `http(s)` públicos y que esa dirección queda afuera por seguridad. **Sin nombrar `localhost`, ni redes internas, ni metadatos de nube** (ver 6, observación 1). |
| `400` sin `code` | `400` con `code` ausente o desconocido | Título: `No se puede auditar esa dirección`. Detalle: el endpoint la rechazó y no dijo por qué; puede ser una dirección que no se pudo interpretar o un sitio público que no está permitido auditar, y el detalle está en la consola. **No se adivina el motivo.** |
| Cupo agotado | `429` | Título: `Se acabó el cupo por hoy`. Detalle: decir **cuándo** puede volver, leyendo `Retry-After`. Si la cabecera no vino: que el cupo se renueva a la medianoche UTC. |
| Tardó demasiado | `504` | Título: `La auditoría tardó demasiado`. Detalle: el sitio no respondió en el tiempo que el endpoint espera; probá de nuevo en un rato. |
| No se pudo llegar | fallo de red / DNS / permiso (no hay respuesta) | Título: `No se pudo llegar al servicio`. Detalle: revisá la conexión e intentá de nuevo; el detalle está en la consola. |
| Cualquier otro | otro `status` | Título: `No se pudo medir`. Detalle: `El servicio respondió <status>. El detalle está en la consola.` |

Reglas de los errores que no se reinventan:

- **`invalid_url` y `blocked_url` no son el mismo error** y no pueden compartir texto. El primero es un
  error de **forma** que la persona arregla escribiendo bien la dirección; el segundo es un **destino**
  que no se arregla reescribiéndolo. Confundirlos le muestra a un error de tipeo el texto de seguridad
  (pasó: la extensión 2.1.0 mapeaba *cualquier* 400 al texto del guardián, y un error de parseo se veía
  como si hubiera auditado una dirección interna).
- **El `code` se lee tal cual viene.** Si no viene, se dice que no se sabe. No se reinterpreta ni se
  adivina por el `message`.
- **El `429` dice cuándo**, no sólo que no se puede. `Retry-After` se lee aceptando **segundos**
  (`5400`) o **fecha HTTP**, y si no está se cae a `RateLimit-Reset` (segundos). Los segundos se
  humanizan (`en menos de un minuto`, `en 45 min`, `en 3 h 20 min`). Si no hay ninguna de las dos
  cabeceras, se dice que se renueva a la medianoche UTC.
- **El número del cupo no se hardcodea**: si la superficie quiere decir "son N por día", N sale de
  `RateLimit-Limit` de la respuesta, no de una constante del cliente (ver 6, observación 2). El texto
  canónico del 429 no necesita el número: alcanza con decir cuándo puede volver.

---

## 4. Los dos bloques de arriba: cómo se calculan sin recalcular nada

- **`score`**: `0..100`, entero. Si no vino, `—`. No se recalcula, no se pondera, no se redondea a otra
  cosa que lo que vino.
- **Los puntajes por eje** salen del motor, en este orden de preferencia:
  1. `breakdown[]` (con `percent`, `passed`, `failed`, `notApplicable`, `applicable`, `earnedWeight`,
     `maxWeight`). Se filtran los ejes `AOS` y `APS`; el resto se ignora.
  2. Si `breakdown` no vino (respuesta vieja), `aosStandards` / `apsStandards` como `percent`, sin
     barra de peso ni conteos.
  3. Si no vino ninguno de los dos, **el bloque no se muestra**. No se rellena con ceros ni se
     aproxima.

*Por qué:* los pesos del estándar viven en el motor. Una superficie que recalcule el AOS con sus
propias cuentas es la segunda implementación del AOS, y la segunda se separa de la primera. El endpoint
publica lo que el motor calculó y la vista lo muestra **tal cual**.

Lo mismo vale para las cinco etapas del rubric viejo (declaración N1, ejecutabilidad DOM N2, ejecución
programática N3, confiabilidad): **no se muestran**, porque este motor no las corre. Inventarlas sería
mentir con más precisión.

---

## 5. Los fixtures como vectores de prueba

`apps/aos-extension/test/fixtures/` tiene **respuestas reales**, capturadas del endpoint público
corriendo el motor de verdad contra el sitio de verdad. Son la mitad del valor de las pruebas: se prueba
contra lo que el endpoint devuelve, no contra lo que creemos que devuelve. Al portar el criterio, cada
fixture es un **vector**: entrada fija → vista esperada.

### 5.1 `audit-believe-global.json` — el caso completo (sitio que sí publica perfil firmado)

`https://believe-global.com/`, contrato 2.1.0 completo. Es el vector del **camino feliz y de todo lo
nuevo**.

Qué tiene que mostrar:

- `score 100`, banda `Agent-Operable` → `Operable` con "Un agente puede operar este sitio casi sin
  fricción."
- Puntajes por eje **presentes**: `AOS · operabilidad` 100/100, barra llena y detalle
  `7 de 7 pasan · peso 16/16 · 1 no aplica`; `APS · preferencia` 100/100 con detalle
  `3 de 3 pasan · peso 7/7` (sin la parte de "no aplica", porque no hay ninguno).
- `businessType: brand` → `marca / servicio`; `auditedAt` → `Medido el <día>/<mes>/<año> a las
  <hh>:<mm>` (en la hora local de quien mira, formato corto).
- **Perfil firmado**: `declaredAps 94` → `APS declarado 94/100`; `claims 6` → `6 pruebas declaradas`;
  `signatureVerified true` → el texto de firma que verifica **y el badge `Agent-Preferred`**.
- Checklist: **11 requisitos que puntúan**, 0 en falta, 1 `n_a` (`AOS-API-01`, con su evidencia: "No
  encontramos MCP ni OpenAPI por ninguna de las vías que probamos."). **Ningún `gain`** en toda la
  respuesta: no hay nada que arreglar, así que **no hay "próximo paso"** y el bloque no aparece.
- **8 diagnósticos** aparte, con su título y sin puntos: 6 pasan y 2 fallan (`AOS-CONT-02`, `APS-PROV-03`)
  con su evidencia. Que fallen **no** cambia el score.
- **Bot Beacon**: `null` → `BeAOS mide el estándar de un sitio, no su tráfico.`, etiqueta `sin fuente`,
  **ningún dígito**.

### 5.2 `audit-sin-perfil.json` — sin perfil firmado, todo en falta y con ganancias

`https://example.com/`, mismo contrato 2.1.0. Es el vector del **sitio que no declara nada** y del
**plan de trabajo**.

Qué tiene que mostrar:

- `score 0`, banda `Agent-Inert` → `Inerte` con "Invisible para agentes. No hay acciones operables."
- Puntajes por eje en **0/100** en los dos: `AOS · operabilidad` con detalle
  `0 de 7 pasan · peso 0/16 · 1 no aplica` y `APS · preferencia` con `0 de 3 pasan · peso 0/7`.
- **Sin perfil firmado**: `declaredAps null` → `Sin perfil firmado` + `El sitio no publica
  /.well-known/brand.json: no declara APS.`, **sin badge** y **sin** "APS 0 / 0 pruebas".
- Checklist: **11 que puntúan: 10 en falta y 1 `n_a`** (`AOS-API-01`, con su evidencia: "No encontramos
  MCP ni OpenAPI por ninguna de las vías que probamos."). Los **10 que fallan** traen `gain`: el plan se
  ordena por ganancia (`APS-CLAIM-01` 42.9 → `APS-PROV-02` 28.6 → `APS-PROV-01` 28.6 → `AOS-DISC-04`
  18.8 → `AOS-IDEN-01` 18.8 → cinco de 12.5) y el **próximo paso** es `APS-CLAIM-01 · brand.json Claims &
  Proofs` con "Arreglarlo devuelve 42.9 puntos." El `n_a` queda fuera del plan: no es una tarea.
- **8 diagnósticos**, todos en falta, aparte y **sin puntos** (ninguno trae `gain`, y no se les
  inventa).
- **Bot Beacon**: `null` → el mismo texto sin dígitos.

### 5.3 `audit-contrato-2.0.0.json` — la respuesta vieja sigue funcionando

La **misma** respuesta de `believe-global.com` capturada **antes** de extender el endpoint: contrato
2.0.0, **sin** `aosStandards`, `apsStandards`, `breakdown` ni `botBeacon`. Es el vector de
**compatibilidad hacia atrás**, y el que prueba que la vista no depende de los campos nuevos.

Qué tiene que mostrar:

- Todo lo de 5.1 en score, banda, tipo, perfil firmado, checklist y diagnósticos (son los mismos datos;
  los `requirements` son idénticos, byte por byte).
- **El bloque de puntajes por eje NO se muestra**: no hay `breakdown` ni sub-scores, así que no hay
  `percent` que mostrar. No se muestra un `0` ni un bloque vacío.
- **El Bot Beacon sí se muestra**, con el texto de "no hay fuente": el hueco es el mismo aunque el campo
  ni siquiera venga.

---

## 6. Diferencias conocidas con la implementación de referencia

Este documento manda. La extensión es la referencia **de la traducción**, y en estos tres puntos hace
algo distinto de lo que dice acá. Se dejan escritos —y **no** se cambió la extensión— para que quien
porte el criterio a la landing no copie la diferencia:

1. **El detalle del `blocked_url` nombra lo que el guardián bloquea.** La extensión dice *"El endpoint
   solo audita sitios http(s) públicos. Las direcciones internas, localhost y los metadatos de nube
   quedan afuera por seguridad."* Este documento pide **no** nombrar `localhost`, redes internas ni
   metadatos de nube: son detalles internos de la defensa y le dan a quien prueba un mapa de qué
   apuntar. El texto canónico dice sólo que la dirección **queda afuera por seguridad**.
2. **El `429` hardcodea el cupo en 20.** La extensión dice *"Son 20 auditorías por IP y por día"* con
   una constante propia (`AUDITS_PER_DAY = 20`), que es el **default** del servidor. El cupo efectivo lo
   define una env (`AOS_PUBLIC_AUDITS_PER_DAY`) y viaja en `RateLimit-Limit`: en el despliegue donde
   pasó el incidente valía **200**, así que el número que veía la persona era falso. Dicho así, la
   extensión acierta sólo mientras nadie toque la env. El texto canónico no necesita el número (basta
   con **cuándo** puede volver, leído de `Retry-After`); si una superficie lo quiere decir, tiene que
   salir de la respuesta.
3. **Un `status` desconocido se muestra como `n_a`.** La extensión mapea cualquier estado que no sea
   `pass`/`fail`/`n_a` a `n_a`, con su glifo y su `No aplica`. Este documento no define ese caso más
   allá de que **no se inventa** un "pasa" ni un "no pasa"; queda anotado que la lectura actual de la
   referencia es conservadora pero puede leerse como "no aplica" cuando en realidad es "no entendimos
   el estado".

Nada más: en todo lo demás (orden de los bloques, textos, `n_a` a la vista, evidencia, `gain` sin
rellenar, `declaredAps` separado de `apsStandards`, `diagnostic` aparte y sin puntos, `botBeacon` sin
dígitos, y los textos de error) la extensión implementa exactamente este documento.
