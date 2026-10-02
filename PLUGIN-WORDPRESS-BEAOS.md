# BeAOS by Believe — el plugin de WordPress

Jorge quiere un plugin que, al instalarlo, **se conecte a BeAOS, cree la marca, genere los assets y los
sirva en el WordPress**. La mitad de eso ya está resuelta y en producción: el plugin de Autex
(`autex-aos`, v0.5.0) sirve el kit AOS byte a byte en un WordPress de verdad. Este documento es el
diseño del plugin de BeAOS: **qué se reusa, qué se tira, y qué decisión falta**.

Esta rama es **diseño + la parte que no depende del flujo de conexión**. El asistente y el canje de
credencial **no están implementados**: los tres flujos de conexión están abajo, con ventajas, riesgos y
lo que hay que construir en cada uno, para que Jorge elija. Nada de esto está publicado: la rama es
`feat/plugin-wordpress` y no hay push ni PR.

---

## Parte 1 · El plugin de Autex, leído entero

Fuente: `/Volumes/DEV/Developer/autex/autex-platform/integrations/wordpress/autex-aos/`
(`autex-aos.php`, 1032 líneas; `README.md`; `CHANGES.md`; `tests/`). Es **sólo lectura**: no se tocó ni
un byte.

### 1.1 Cómo sirve los archivos

El corazón es `autex_aos_asset()` (`autex-aos.php:394-402`) y un único `add_action` en `init` con
prioridad **0** (`autex-aos.php:406-436`).

| Pregunta | Respuesta, con la línea |
|---|---|
| Qué hook usa | `add_action( 'init', …, 0 )` — `autex-aos.php:406-436`. Prioridad 0: **antes** de que WordPress resuelva la request. |
| Cómo resuelve la ruta | `wp_parse_url( $_SERVER['REQUEST_URI'], PHP_URL_PATH )` y **coincidencia exacta** contra las claves del manifiesto guardado — `autex-aos.php:416`. Sin normalizar, sin `urldecode`, sin heurísticas. |
| Cómo evita que WordPress se apropie | Enganchando en `init`, que corre antes de `do_robots()`, de los sitemaps del core y del 404 de `/.well-known/*` (comentario explícito en `autex-aos.php:404-405`). Y sólo sirve **rutas que están en el manifiesto**: lo que no está queda para el core (`autex-aos.php:391-393`). |
| Solo GET y HEAD | `autex-aos.php:412-415`: cualquier otro método sale sin tocar nada. |
| Limpia buffers | `while ( ob_get_level() ) { ob_end_clean(); }` antes de escribir — `autex-aos.php:420-422`. Un plugin de caché o de minificado que abrió un buffer no puede inyectar bytes en el archivo firmado. |
| Cabeceras | `status_header( 200 )`; `Content-Type` **el del manifiesto**; `Content-Length`; `X-Autex-Sha256`; `Cache-Control: public, max-age=300, no-transform`; `X-Content-Type-Options: nosniff`; `Access-Control-Allow-Origin: *` — `autex-aos.php:423-429`. |
| Caché | `max-age=300`, cinco minutos: el kit cambia poco y una corrida del cron no queda invisible hasta una hora. `no-transform` es la defensa contra el minificador. |
| HEAD | Responde cabeceras y **no** el cuerpo — `autex-aos.php:430-433`. |
| Termina el request | `exit` explícito — `autex-aos.php:433`. |
| Verificación al servir | `autex_aos_asset()` **re-verifica el sha256** de la copia local en cada request y devuelve `null` si no da — `autex-aos.php:400-401`. Una opción corrupta en la base no se sirve: se cae al core. |

### 1.2 Cómo baja y guarda el kit

`autex_aos_sync()` (`autex-aos.php:338-388`) + `autex_aos_api_get()` (`autex-aos.php:317-331`) + la
opción `autex_aos_bundle` (`autex-aos.php:19`).

- **Qué guarda exactamente**: la opción es un array `{ bundle_sha256, synced_at, error, assets }` y
  cada asset es `{ type, sha256, body }` con el cuerpo en **base64** — `autex-aos.php:372-387`. El
  base64 no es decorativo: la columna de opciones de WordPress es texto y un `text/plain` con bytes
  altos se corrompería. El comentario lo dice: *"base64: la base no toca un solo byte"*
  (`autex-aos.php:375`).
- **Sin autoload**: el tercer argumento de `update_option()` es `false` en las dos escrituras —
  `autex-aos.php:350` y `autex-aos.php:386`. Un kit de decenas de KB no puede viajar en el
  `alloptions` que se carga en cada request.
- **Cómo versiona**: no inventa un número de versión propio. Guarda el `bundle_sha256` que declara el
  manifiesto (`autex-aos.php:381`) **y** el `sha256` por archivo, que es lo que decide si un archivo se
  vuelve a bajar: si el sha256 coincide con el guardado, **no se descarga** (`autex-aos.php:362-366`).
- **Verificación en la bajada**: descarta el asset si el sha256 no coincide **o** si el largo en bytes
  no es el declarado (`autex-aos.php:367-371`). Los descartados se listan en `error`
  (`autex-aos.php:383`) y no se guardan.
- **Qué pasa si la descarga falla**: si el **manifiesto** no llega, se reescribe la opción con la copia
  anterior **intacta** más el error — `autex-aos.php:348-352`. Se sigue sirviendo lo viejo. Si falla un
  asset suelto, ese asset no se guarda (mejor un 404 que romper la firma Ed25519 — `autex-aos.php:334-336`).
- **Autenticación**: `Authorization: Bearer <aos_key>`, `timeout` 20 s, y sólo acepta `200` —
  `autex-aos.php:319-330`.
- **Cómo evita que la llave salga al navegador**: el campo se pinta **siempre vacío** y un vacío al
  guardar **conserva** la llave guardada — `autex-aos.php:218-219` (sanitize) y `autex-aos.php:278-279`
  (el `<input type="password">` con el texto *"Hay una llave guardada. Déjelo vacío para conservarla."*).

### 1.3 El cron

- Se registra dentro del **mismo** hook `init` de prioridad 0: `if ( ! wp_next_scheduled( … ) )
  wp_schedule_event( time(), 'hourly', AUTEX_AOS_CRON )` — `autex-aos.php:409-411`.
- `add_action( AUTEX_AOS_CRON, 'autex_aos_sync' )` — `autex-aos.php:819`.
- Además sincroniza **al guardar los ajustes**, sin esperar al cron, enganchando
  `update_option_<opción>` y `add_option_<opción>` — `autex-aos.php:823-824`.
- **¿Y si ya hay una corrida en curso?** No hay candado: `autex_aos_sync()` no chequea nada antes de
  empezar (`autex-aos.php:338-352`). Lo único que serializa es el candado propio de wp-cron
  (`doing_cron`), que impide que dos **disparos de cron** corran a la vez. El agujero real es el otro
  camino: guardar los ajustes mientras corre el cron dispara una segunda corrida en paralelo. No
  corrompe —cada corrida escribe la opción entera una sola vez al final
  (`autex-aos.php:378-387`)— pero gasta el doble de requests y la última en escribir gana. **El plugin
  de BeAOS agrega un candado con transient** (§2.7).

### 1.4 Qué es específico de Autex y NO va al plugin de BeAOS

Todo esto está para que no se arrastre por inercia. **Nada de esto se copia**:

| Qué | Dónde |
|---|---|
| El CPT `modelos` y la taxonomía `categoria-modelos` | `autex-aos.php:15-16` |
| El precio desde el meta de JetEngine (`precio`, `price`, `_price`) y la moneda `COP` | `autex-aos.php:51-64`, `:99` |
| El nodo schema.org `Product`/`Vehicle` de un modelo | `autex-aos.php:70-106` |
| El `ItemList` de listados y el colector de "modelos que la página ya pintó" vía `the_post` | `autex-aos.php:109-124`, `:133-147` |
| El `wp_head`/`wp_footer` que imprimen JSON-LD | `autex-aos.php:149-196` |
| El widget concierge (`files.believe-global.com/autex/widget/v1/autex.js`), `site_key`, `endpoint` | `autex-aos.php:17`, `:186-193` |
| El REST `GET /wp-json/autex/v1/catalog` y su `featured image`/extracto | `autex-aos.php:438-522` |
| El **Dealer Brain**: `brain-ingest`, `autex_aos_edge_url`, los topics, la lista legal, el paseo de `_elementor_data`, el hash de idempotencia | `autex-aos.php:524-826` |
| El **pixel** y la lista de crawlers de IA (contrato con `edge/functions/pixel/bots.ts`) | `autex-aos.php:828-1032` |
| La API de distribución de Autex: `GET /v1/dealers/<slug>/aos?host=` | `autex-aos.php:317-331` |
| Los ajustes propios: `brand` con default `Volkswagen`, `aos_dealer`, `aos_api`, `aos_host` | `autex-aos.php:30-45` |
| El concierge por defecto como base para derivar URLs hermanas | `autex-aos.php:25`, `:532-546` |
| El plan de 5 archivos de test acoplados al edge de Autex | `tests/brain.php`, `tests/pixel.php` |

### 1.5 Qué es genérico y se lleva

Esto es lo que se reusa, tal cual, en `apps/beaos-wordpress/`:

1. **La forma de servir**: `init` con prioridad 0, coincidencia exacta de ruta, limpieza de buffers,
   `Content-Type`/`Content-Length`/`X-…-Sha256`/`no-transform`, `HEAD` sin cuerpo, `exit`
   (`autex-aos.php:406-436`).
2. **La separación "copio y verifico" de "sirvo y re-verifico"**: `autex_aos_sync()` guarda,
   `autex_aos_asset()` re-verifica al servir (`autex-aos.php:338-402`).
3. **El formato de la copia local**: opción sin autoload, cuerpos en base64, `sha256` por archivo,
   `bundle_sha256`, `synced_at`, `error` (`autex-aos.php:372-387`).
4. **El criterio de bajada**: manifiesto primero; por asset, saltear si el sha256 no cambió; descartar
   si el sha256 o el largo no coinciden; si el manifiesto no llega, conservar la copia anterior
   (`autex-aos.php:346-377`).
5. **El patrón del cron**: agendar si no está agendado, `hourly`, y sincronizar también al guardar
   (`autex-aos.php:409-411`, `:819-826`).
6. **La llave que nunca se imprime y el vacío que conserva** (`autex-aos.php:218-219`, `:278-279`).
7. **El estado al pie de la página de ajustes**: cuántos archivos, cuándo, último error
   (`autex-aos.php:289-304`).
8. **La página de ajustes como `add_options_page` + `register_setting`** con un `sanitize_callback`
   que devuelve un array cerrado de claves (`autex-aos.php:199-233`).
9. **Un solo archivo, cero dependencias, PHP 7.4+** (`README.md:18`, cabecera `Requires PHP: 7.4`).
10. **`defined( 'ABSPATH' ) || exit;`** en la primera línea útil de cada archivo PHP
    (`autex-aos.php:13`).
11. **La convención de nombres**: constantes `PREFIJO_AOS_*` en mayúsculas, funciones `prefijo_aos_*`,
    opciones con el mismo prefijo, y los hooks/opciones con nombre de acción explícito
    (`autex-aos.php:15-21`). El plugin de BeAOS usa `BEAOS_AOS_*` / `beaos_aos_*` para que los dos se
    lean igual.
12. **El estilo de test**: `check( $condición, $mensaje )`, contador `$fail`, `echo "…: OK"` /
    `"…: FALLA"`, `exit( $fail )` — `tests/brain.php` (cierre).

### 1.6 Los problemas ya resueltos: bugs de WordPress que ya se comieron

Esto es la parte más valiosa del plugin de Autex: son cosas que ya fallaron una vez.

| Bug | Dónde está contado | Qué hay que hacer en BeAOS |
|---|---|---|
| **WordPress se apropia de la ruta.** `robots.txt`, los sitemaps del core y especialmente el 404 de `/.well-known/*` ganan si el plugin se engancha tarde. | `CHANGES.md:21`, `README.md:101-104`, comentario en `autex-aos.php:404-405` | Enganchar en `init` con prioridad 0. La misma ruta, no "una parecida". |
| **Un asset corrupto rompe la firma Ed25519** (y romperla en silencio es peor que un 404). | `CHANGES.md:22`, `README.md:97-98`, `autex-aos.php:334-336` | Verificar sha256 **y** largo en la bajada, y **volver a verificar** al servir. |
| **Cloudflare Auto Minify reescribe los bytes** y `brand.json.sig` deja de validar. También Rocket Loader, Email Obfuscation, o un plugin de WordPress que minifique la salida. | `README.md:106-113` (bug real, con la Configuration Rule como remedio) | Mandar `Cache-Control: no-transform` **y** limpiar los buffers antes de escribir. Y documentarlo: el plugin no controla la zona de Cloudflare. |
| **La caché de página sirve bytes viejos.** Con caché de página completa el request no ejecuta PHP. | `README.md:76-77` (vaciar la caché después de guardar) y `CHANGES.md:7` (el caso del pixel) | Avisar en la pantalla: después de sincronizar, vaciar la caché. Y no prometer que el kit se actualiza al instante. |
| **Un test leyó el archivo un nivel más arriba y su verificación se saltaba en silencio.** | `CHANGES.md:9`: *"la ruta ya estuvo mal (un `../` de más) y esta guarda lo tapaba"* | Un test que no encuentra su fixture **falla**, no se saltea. `tests/pure.php` lo hace: si falta el archivo que lee, `check( false, … )`. |
| **Un contrato duplicado se despega.** La lista de bots del plugin se compara contra `bots.ts` del edge en el test. | `CHANGES.md:8`, `README.md:194-199` | El pedido JSON-RPC y las claves de las opciones se prueban contra el contrato real, no contra una copia de memoria. |
| **La llave de API en el navegador.** El campo se pinta vacío y el vacío conserva. | `autex-aos.php:218-219`, `:278-279`, `README.md:87-89` | Lo mismo, y además el token no entra nunca a un `printf` de HTML. |
| **Sin autoload en la opción del kit.** | `autex-aos.php:19`, `:350`, `:386` | Lo mismo. |
| **Un grid que carga por AJAX no está en el HTML inicial.** | `README.md:180-181` | No aplica al kit (los archivos son estáticos), pero la lección de "declarar el límite conocido" sí. |
| **No hay desinstalación.** El plugin de Autex no tiene `uninstall.php` ni `register_uninstall_hook`: al borrarlo quedan `autex_aos`, `autex_aos_bundle`, `autex_aos_brain` y el evento de cron agendado. | No está en `CHANGES.md`; se verifica por ausencia en el árbol de archivos | El plugin de BeAOS **sí** limpia (§2.8). |

---

## Parte 2 · El diseño del plugin de BeAOS

### 2.1 Archivos

```
apps/beaos-wordpress/
├── beaos-aos.php          # cabecera, constantes, ajustes, servido, cron, sync
├── beaos-aos-pure.php     # lógica pura: sin una sola función de WordPress (se prueba sola)
├── class-beaos-mcp.php    # el cliente JSON-RPC del MCP
├── uninstall.php          # lo que se borra al desinstalar
├── README.md
└── tests/
    └── pure.php           # el test, sin WordPress
```

La lógica que decide cosas —el sobre JSON-RPC, la lectura de la respuesta, la ruta de la request, la
verificación de un asset, el vencimiento del kit, el `Retry-After`, el saneo de los ajustes— vive en
`beaos-aos-pure.php` y **no llama a ninguna función de WordPress**. Por eso se prueba con `php` a
secas (§2.10). Es literalmente la única razón por la que ese archivo existe separado.

### 2.2 El asistente de 3 pasos

Tres pantallas, en orden. Ninguna promete lo que no hace.

#### Paso 1 · Conectar

**Campos**: la credencial (depende del flujo: un código, o el token y el `entityId` pegados a mano).
Nada más.

**Qué hace el plugin**:
1. Guarda la credencial en la opción `beaos_aos`, campo `token`, sin autoload, y la pinta siempre
   vacía.
2. **Verifica la credencial** con la llamada más barata que existe: `tools/list`. No toca la base,
   no escribe nada, no gasta una generación (`apps/web/src/server/mcp/jsonrpc.ts:173-174` es un
   `switch` puro sobre la lista de tools). Un `401` es "token inválido, revocado o ausente"
   (`apps/web/src/routes/mcp.ts:38-48`); un `200` con 27 tools es "el token entra".
3. Si el flujo conoce la marca, llama `get_brand` (`{ brandId }`) para traer el `entityId` y el estado
   de publicación. Si no, el `entityId` se pega en el paso 2.

**Lo que NO hace**: no crea nada todavía. Conectar no escribe en BeAOS.

#### Paso 2 · La marca

**Campos**: **nombre**, **web**, **categoría**.

| Campo | Obligatorio | Para qué |
|---|---|---|
| Nombre | sí | `ensure_brand.name` y `ensure_entity.name`. Es la entidad que firma. |
| Web | sí | `ensure_brand.website`. **Su host es la clave de idempotencia**: la misma web da la misma marca (`apps/web/src/lib/brand-id.ts:37-46`). |
| Categoría | **sí, y la pide en pantalla** — ver §2.3 | `ensure_brand.category`. Calibra la biblioteca de preguntas de compra del APS. |

**Qué hace el plugin**, con los argumentos reales leídos del código del MCP:

1. `tools/call` → **`ensure_brand`**
   (`apps/web/src/server/mcp/tools/actions.ts:53-157`)
   ```json
   { "name": "Automotriz Pérez", "website": "https://perez.com", "category": "Automotriz" }
   ```
   `required: ["name", "website"]` (`actions.ts:88`). Devuelve `{ brandId, created }`
   (`actions.ts:139`, `:154`). Idempotente por host: si la marca ya existe, la **actualiza** y
   devuelve `created: false` (`actions.ts:123-142`).
2. `tools/call` → **`ensure_entity`** (`actions.ts:159-223`)
   ```json
   { "brandId": "perez-com", "name": "Automotriz Pérez", "entityType": "umbrella",
     "websiteUrl": "https://perez.com", "isPrimary": true }
   ```
   `required: ["brandId", "name", "entityType"]` (`actions.ts:185`); `entityType` es
   `["umbrella","product"]` (`actions.ts:51`). Para un sitio de WordPress **la entidad es
   `umbrella`**: el sitio es la marca que firma, no un producto que cuelga de otra cosa.
   `parentEntityId` es un UUID y sólo hace falta para un `product` (`actions.ts:175-178`); no se manda.
   `maasyProjectId` es la otra clave de idempotencia y **no se manda** cuando la marca no está en
   Maasy (`actions.ts:179-182`). Devuelve `{ entityId, created }` (`actions.ts:217`).

   Después de esto el plugin guarda `brand_id` y `entity_id` en la opción.

#### Paso 3 · Generar y publicar

**Campos**: ninguno. Es un botón con el resultado a la vista.

1. `tools/call` → **`generate_agent_assets`** (`actions.ts:422-447`)
   ```json
   { "brandId": "perez-com", "entityId": "8f1c…-…" }
   ```
   `required: ["brandId","entityId"]` (`actions.ts:433`). Devuelve
   `{ entityId, count, assets:[{ path, type, sha256 }] }` (`actions.ts:440-444`). **Genera, no
   publica** (`actions.ts:426`).
2. `tools/call` → **`publish_agent_assets`** (`actions.ts:449-471`)
   ```json
   { "brandId": "perez-com", "entityId": "8f1c…-…", "published": true }
   ```
   `required: ["brandId","entityId","published"]` (`actions.ts:461`).

   **Ojo, y esto es una trampa real**: un rechazo del candado **no llega como `isError`**. El handler
   devuelve `textResult(json(result), result)` sin marcar error (`actions.ts:468-469`), así que un
   bloqueo es un `200` con `structuredContent.ok === false` y `reason`. El cliente tiene que mirar
   `ok`, no `isError`. Lo mismo con `{ published: false }` de `get_agent_bundle`
   (`apps/web/src/server/mcp/tools/agent.ts:496-501`) y con `{ found: false }` de `get_agent_asset`
   (`agent.ts:538-541`): son respuestas, no errores.
3. Si publicó, el plugin dispara `beaos_aos_sync()` de una vez (no espera al cron) y muestra el
   resultado: cuántos archivos, con qué rutas, y el `warning` si lo hubo.

**Fuera del asistente, y a propósito**: `ensure_prompt_library` y `start_aps_run` (las preguntas de
compra y la medición APS) no son parte de los 3 pasos. Son un botón aparte, y sólo tiene sentido
después de declarar la categoría. **El asistente no promete APS.**

### 2.3 La categoría

- **Dónde se guarda**: `brands.category`, `text("category")`, nullable —
  `packages/lib/src/db/schema.ts:54`, con el comentario de por qué existe en `:44-53`: *"Existe para
  romper la dependencia de Maasy […] una marca sin proyecto de Maasy […] no podía declarar su
  categoría y la biblioteca de preguntas de compra se calibraba con el marcador genérico."*
- **Cómo la escribe el MCP**: `ensure_brand` acepta `category` (`actions.ts:82-86`), la escribe en el
  alta (`actions.ts:152`) y en la actualización (`actions.ts:137`). También se edita a mano en
  Configuración → Brand (`apps/web/src/lib/brand-settings.ts:71-77`).
- **Qué pasa si no se declara**: la calibración cae al `industry` del DNA de Maasy y, si tampoco hay,
  al marcador **`marketing/software`** (`packages/aos-aps/src/aps/library.ts:28`). Y ahí está el
  detalle que importa: con el marcador, `ensure_prompt_library` **se corta antes de gastar la llamada**
  salvo que se mande `confirmMissingCategory: true` (`actions.ts:246-250`, `:335-339`, `:369-372`).
  O sea: **sin categoría, la biblioteca de preguntas de compra no se genera**. No sale mal: no sale.
- **Qué hace el plugin**: pide la categoría en el paso 2 y, si el campo queda vacío, lo **dice en la
  pantalla**, con el texto del marcador y la consecuencia:
  > *"Sin categoría declarada, BeAOS no puede calibrar la biblioteca de preguntas de compra y la corta
  > antes de generar: el APS sale sin medir. Si seguís igual, se calibra con el marcador genérico
  > «marketing/software» y los prompts salen generales."*

  Y no bloquea el paso 3, porque **la categoría no cambia los assets**: cambia el instrumento con el
  que se mide. Prometer lo contrario sería mentir.
- **Honestidad sobre el alcance**: la categoría hace que *las preguntas de compra salgan del producto*
  (APS). Los archivos del bundle (`llms.txt`, `brand.json`, …) se generan igual sin ella.

### 2.4 Los tres flujos de conexión

**Criterio de seguridad primero**: `authenticateMcpRequest` cae a `ADMIN_API_KEYS` si el token no está
en `agent_api_tokens` (`apps/web/src/lib/api-tokens.ts:20-26`, `:139-146`). `ADMIN_API_KEYS` es una
llave maestra compartida: abre **todas** las marcas, no se puede revocar por sitio y no tiene
identidad. **No puede viajar a un WordPress ajeno.** Los tres flujos tienen que terminar en un token de
`agent_api_tokens` (identidad por producto, revocación individual, sólo el sha256 en la base —
`MCP-BEAOS.md:106-111`).

Y un dato que condiciona todo: **`/api/v1/*` no acepta tokens de producto.** El middleware de
`/api/v1/` valida sólo contra `ADMIN_API_KEYS` (`apps/web/src/lib/auth/policies.ts:140-151` y
`evaluateApiKeyAuth`, `:181-193`), que compara el Bearer contra `ADMIN_API_KEYS` y nada más. La API de
entrega del bundle (`/api/v1/agent-assets/<entityId>`) es `/api/v1/*`. Por eso **el plugin de BeAOS
sincroniza el kit por el MCP** (`get_agent_bundle` + `get_agent_asset`), que sí acepta el token de
producto, y no por la API de entrega — que es el camino parecido al de Autex pero exigiría la llave
maestra en el WordPress del cliente. Es una diferencia con Autex y hay que decirla.

#### Flujo A · Código de canje (recomendado)

Un código de un solo uso, corto y con vencimiento, generado desde el panel de BeAOS. El operador lo pega
en el plugin; el plugin lo canjea por su token de producto, ya atado a la marca y la entidad.

- **Ventajas**: la llave maestra nunca sale de BeAOS. Lo que viaja es un secreto de vida corta, de un
  solo uso y **atado a una marca y una entidad**: si se filtra, el daño ya está acotado y se revoca
  solo. Fricción mínima: un copiar y pegar. Da identidad por sitio, así que se revoca de a uno.
- **Riesgos**: el token que se emite igual queda en `wp_options` en texto plano: **cualquier
  administrador del WordPress (o un dump de la base) lo lee**. Eso es inevitable en WordPress y hay que
  decirlo. El canje es un endpoint sin autenticación previa: si no se le pone límite de intentos, es
  una puerta a fuerza bruta (el código tiene que ser largo de verdad y el endpoint estar limitado por
  IP). Un código reusado tiene que fallar, y el segundo intento tiene que ser un evento visible.
- **Qué hay que construir en BeAOS**: (1) una tabla `agent_enrollment_codes`
  (`code_hash`, `brandId`, `entityId`, `expiresAt`, `usedAt`, `createdBy`) — sólo el hash, como
  `agent_api_tokens`; (2) `POST /api/v1/enroll` que valida el código, lo marca usado
  transaccionalmente y devuelve un token nuevo con `generateApiToken()`
  (`apps/web/src/lib/api-tokens.ts:34-36`) más el `entityId`; (3) límite de intentos por IP en ese
  endpoint — hoy `/mcp` **no tiene rate limiting** (no hay 429 en `apps/web/src/routes/mcp.ts` ni en
  `apps/web/src/server/mcp/`), así que hay que ponerlo; (4) el botón "generar código de conexión" en
  Configuración → Brand, y su equivalente en `scripts/beaos-token.sh`.

#### Flujo B · Token a mano

El operador crea el token con `scripts/beaos-token.sh create wordpress-perez-com` y pega el token y el
`entityId` en el plugin (`MCP-BEAOS.md:120-131`).

- **Ventajas**: **funciona hoy**, no hay una línea de código nueva en BeAOS. Revocación individual por
  prefijo (`scripts/beaos-token.sh revoke beaos_ab`). Es el camino que desbloquea el plugin mientras se
  decide.
- **Riesgos**: dos valores copiados a mano, y el `entityId` **no se puede adivinar**: hay que sacarlo
  con `list_brands` → `get_brand` desde el MCP o desde el panel. El nombre del token lo elige una
  persona: si dos sitios se crean con el mismo nombre no se distinguen, y revocar "wordpress" revoca a
  los dos. Y el token se imprime **una sola vez**: si se pierde, se crea otro (y el viejo queda
  huérfano si nadie lo revoca).
- **Qué hay que construir**: casi nada. Un botón **"Probar conexión"** en el plugin (que ya está
  cubierto por `tools/list`) y una convención de nombre de token por sitio. Es el flujo que la rama
  implementa de hecho (§2.7).

#### Flujo C · Registro automático por dominio

El plugin se anuncia solo: manda su dominio, BeAOS comprueba que el sitio es de quien dice (un TXT de
DNS, o un archivo en `/.well-known/`), crea la marca y emite el token sin que nadie copie nada.

- **Ventajas**: cero fricción. Es el único flujo que sirve para un producto autoservicio con miles de
  sitios, y el único que da de alta la marca sin que un operador la escriba.
- **Riesgos**: **es el más peligroso de los tres**. Le entrega una credencial a quien controle un
  hostname. Un TXT de DNS se puede poner en un subdominio, así que "el dominio verifica" no es lo mismo
  que "la marca es tuya": con el `host` como clave de idempotencia
  (`apps/web/src/lib/brand-id.ts:37-46`), un subdominio puede **reclamar la marca** que ya existe y
  quedarse con su token. Además: alta automática de marcas basura, y toda la superficie de abuso
  (límites, cola de revisión, verificación repetida).
- **Qué hay que construir**: lo más de los tres. Tabla de desafíos, resolución de DNS (o el archivo de
  verificación), un fetcher que salga a internet desde BeAOS, rate limiting serio, política de quién
  puede auto-alta una marca **existente** (probablemente: nadie; auto-alta sólo de marcas nuevas), y
  una pantalla de revisión.

#### Cuál recomiendo, y por qué

**Recomiendo A (código de canje)**, con **B como puente** mientras A se construye. El criterio es la
seguridad y después la fricción:

1. **Una llave maestra no debe viajar a un WordPress ajeno.** En A, lo que viaja es un código de un
   solo uso, con vencimiento y atado a marca y entidad. En C, lo que viaja es, en la práctica, la
   capacidad de reclamar una identidad de marca con un control de dominio débil. B evita la llave
   maestra (el token es de producto) pero deja todo el peso en una persona.
2. **Fricción**: A y B son un copiar y pegar. C es cero, pero es cero a cambio de un control de
   identidad que hoy no existe.
3. **Lo que ya está**: B no necesita nada nuevo y desbloquea el plugin hoy. A necesita una tabla y un
   endpoint, y es la inversión correcta porque es la que va a durar. C necesita un subsistema de
   verificación que ningún cliente está pidiendo todavía.
4. **Y el que no se negocia**: los tres terminan en un token de `agent_api_tokens`. Nunca en
   `ADMIN_API_KEYS`.

### 2.5 Qué pasa cuando la marca es nueva y no tiene nada

**Verificado en el código, no supuesto.** El candado de publicación es `claimsGuardDecision`
(`apps/web/src/lib/claims-guard.ts:173-212`) y su llamador es `setEntityPublished`
(`apps/web/src/server/agent-assets-core.ts:570-631`).

La regla, textual del código: **se bloquea sólo cuando el sitio sirve más pruebas _propias_ que el
bundle** (`claims-guard.ts:186-201`). Nada más. Todo lo demás avisa.

El flujo real de un sitio recién instalado, paso por paso:

1. **`ensure_brand`** → marca nueva, `category` si se declaró. Sin DNA de Maasy: no hay snapshot.
2. **`ensure_entity`** (`umbrella`) → `entityId`. **Sin `sync_brand_dna` no hay DNA**, y sin DNA no hay
   `industry`, ni `brief`, ni `website_url` del snapshot.
3. **`generate_agent_assets`** → **funciona igual** (`agent-assets-core.ts:416-535` no exige DNA: lee
   el snapshot "si hay"). Pero el bundle sale **mínimo**, y esto es lo que hay que decir en la pantalla:
   - **Sí se emiten** los siete fijos: `/llms.txt`, `/llms-full.txt`, `/AGENTS.md`, `/robots.txt`,
     `/.well-known/agent-card.json`, `/.well-known/agent-permissions.json`,
     `/.well-known/brand.json` (`packages/aos-aps/src/assets/generate.ts:758-782`).
   - **No se emite `/.well-known/mcp/server-card.json`**: sólo si el sitio declara su MCP
     (`generate.ts:795-802`, y `declaredMcp` sondea `https://<sitio>/.well-known/mcp/server-card.json`
     con timeout de 5 s — `agent-assets-core.ts:336-355`).
   - **No se emite `/.well-known/api-catalog`**: sólo con una API que la marca declare
     (`generate.ts:788-790`).
   - **No se emite `/.well-known/ai-catalog.json`** (ni el `Agentmap` en `robots.txt`): hacen falta al
     menos **2** `representativeQueries` reales, que salen de la biblioteca de prompts activa
     (`agent-assets-core.ts:497-519`). Sin biblioteca, no hay catálogo.
   - **No se emite `/.well-known/security.txt`**: hace falta un contacto declarado
     (`generate.ts:785-786`).
   - **No se emite la firma**: `/.well-known/brand.json.sig` y `/.well-known/keys.json` sólo si hay
     clave de firma en el entorno (`generate.ts:807-822`), y `signingKeyFromEnv` devuelve `null` sin
     `SIGNING_KEY_*` (`packages/aos-aps/src/provenance/keying.ts:34-45`). Un bundle sin firma sigue
     siendo válido, pero **no está firmado**, y el plugin no puede decir lo contrario.
   - `brand.json` declara **0 claims** (o los `confirmed` que existan: ninguno, si el sitio es nuevo).
4. **`publish_agent_assets`** con `published: true` → el candado:
   - `claimTally(bundle.content)` = **0 propias** (el archivo existe y parsea).
   - `liveClaimTallyFrom(...)` sale a buscar `https://<sitio>/.well-known/brand.json`. En un sitio
     nuevo **no existe**: `response.ok === false` → `null` (`agent-assets-core.ts:365-378`).
   - `claimsGuardDecision( {0,0,0}, null )` → `blocked: false` con
     `warning: "No pudimos leer el perfil del sitio para comparar claims. Se publica sin esa
     verificación."` (`claims-guard.ts:180-185`).
   - **Conclusión: el candado NO frena un sitio nuevo. Publica, con un aviso.**

**Entonces, ¿qué frena?** Exactamente un caso, que es el que el candado existe para atrapar: que el
sitio **ya sirva** un `brand.json` con más pruebas propias que el bundle que se está publicando
(`claims-guard.ts:186-201`). Los escenarios reales:

- El sitio ya estaba sirviendo un kit de otro generador o de otra entidad, con más claims.
- Se regeneró el bundle después de perder claims (una sincronización de DNA que llegó vacía, un claim
  borrado) y el sitio todavía sirve los viejos. **Ahí sí bloquea**, con el número y la instrucción de
  regenerar.
- Y una trampa: como el plugin **sirve** lo que BeAOS le baja, la comparación del siguiente publish es
  contra lo que el plugin mismo puso. Publicar dos veces seguidas con el mismo bundle no bloquea (0
  contra 0). Es un candado contra la **pérdida**, no un chequeo de calidad.

**Lo que hay que decir en la pantalla, sin adornos**: en un sitio nuevo el asistente **no genera todo**.
Genera los siete archivos base, sin sitemap declarado por BeAOS, sin server-card, sin `ai-catalog`, sin
firma y con 0 claims; y **el APS declarado queda en 0** hasta que un operador dé de alta pruebas
`confirmed` en BeAOS. El candado no lo va a frenar; lo que falta es evidencia, no permiso.
`BeAOS no inventa pruebas` (`MCP-BEAOS.md:80-81`), así que no hay atajo.

### 2.6 Cómo se sirve el kit en el sitio del cliente

Se reusa `autex_aos_asset` entero, con estos cambios:

| Autex | BeAOS | Por qué |
|---|---|---|
| Fuente: `GET <api>/v1/dealers/<slug>/aos?host=` | Fuente: `tools/call get_agent_bundle { entityId }` + `tools/call get_agent_asset { entityId, path }` | El token de producto no entra por `/api/v1/` (§2.4). |
| `site_key` del concesionario | `token` + `entity_id` | Identidad por producto en vez de por concesionario. |
| Manifiesto: `assets[].path / content_type / sha256 / bytes` | Manifiesto: `assets[].path / type / sha256 / bytes` (`agent.ts:505-510`) | Misma forma, casi los mismos nombres. **Buen reuso.** |
| Asset: bytes crudos por `GET` | Asset: `structuredContent.type` + `content[0].text` | **Cambia**: el MCP devuelve el contenido como texto JSON. Es exacto porque **todos los assets del bundle son texto hoy** (`text/plain`, `text/markdown`, `application/json`, `application/xml`). Un asset binario se rompería: hay que decirlo. |
| Cabecera `X-Autex-Sha256` | `X-BeAOS-Sha256` | Nombre. |
| — | **No se sirve nada si la entidad no está publicada** | `get_agent_bundle` responde `{ published: false }` (`agent.ts:496-501`): el gate está cerrado por defecto y el plugin no puede saltarlo. |
| Precedencia de rutas | Igual: `init` prioridad 0, rutas del manifiesto | El bug ya pagado (§1.6). |

**Lo que cambia de verdad, y hay que explicarlo en el plugin:**

1. **El `server-card` depende de que el sitio declare su MCP.** BeAOS sondea
   `https://<sitio>/.well-known/mcp/server-card.json` **antes** de generar
   (`agent-assets-core.ts:336-355`); si el sitio no declara un MCP, `mcpServerCard()` devuelve `null` y
   el archivo **no se emite** (`generate.ts:92-93`: *"Ausente => no se emite server-card: BeAOS no
   inventa endpoints"*). O sea: **si el sitio no declara su MCP, nuestro server-card no se emite**, y el
   plugin tiene que decirlo con esas palabras en vez de dejar que el archivo falte en silencio. Y
   aclarar de quién es el card: describe **el MCP del sitio**, no el de BeAOS. BeAOS todavía no publica
   el suyo (`MCP-BEAOS.md:203-205`).
   No hay bucle: como el card declara el MCP del sitio, regenerar lee el mismo `serverUrl` que BeAOS
   escribió, y el archivo es estable.
2. **Si el sitio ya tiene el plugin de Autex, los dos pelean por las mismas rutas.** Los dos enganchan
   `init` con prioridad 0 y los dos quieren `/llms.txt`, `/AGENTS.md` y `/.well-known/brand.json`. Gana
   el que se registra primero, y el resultado sería un kit mezclado sin que nadie se entere. **Decisión
   que falta** (no la tomo yo): o el plugin de BeAOS se niega a servir el kit mientras
   `autex_aos_asset` esté activo y lo dice en la pantalla —lo que hago en esta rama—, o se reparten las
   rutas. Mezclarlos en silencio es la única opción inaceptable.
3. **La caché de página.** Igual que en Autex: hay que vaciarla después de sincronizar
   (`README.md:76-77`), y `Cache-Control: no-transform` no controla Cloudflare (`README.md:106-113`).
4. **El cron de wp-cron necesita tráfico.** Sin visitas, el hook agendado no corre: es
   `wp-cron.php` disparado por una request. El plugin muestra la fecha del último sync para que se vea.

### 2.7 Las piezas que sí están implementadas en esta rama

Todo lo que **no** depende del flujo de conexión:

- **La copia local del kit**: `beaos_aos_bundle` con el criterio de Autex — sin autoload, cuerpos en
  base64, `sha256` por archivo, `bundle_sha256`, `synced_at`, `error`, y el asset sin cambios no se
  vuelve a bajar (`beaos-aos.php`, `beaos_aos_sync`).
- **El servido** de las rutas del manifiesto, en `init` prioridad 0, con re-verificación de sha256 al
  servir y `HEAD` sin cuerpo.
- **El cron** cada hora, más el sync al guardar los ajustes, **más un candado con transient** que
  Autex no tiene: dos corridas superpuestas no se pisan (el agujero de §1.3).
- **La página de ajustes** con nombre, web, **categoría**, token, `brand_id`, `entity_id`, endpoint, y
  el estado del kit al pie.
- **`class-beaos-mcp.php`**: el cliente JSON-RPC, con `tools/call` a
  `https://beaos.believe-global.com/mcp`, tiempos de espera y el manejo completo de errores (§2.9).
- **`uninstall.php`**, que Autex no tiene.

**Lo que NO está**: el asistente y el canje del código. El campo del token existe; **el flujo que lo
llena es lo que falta**. Mientras tanto, el flujo B (token a mano) es el que funciona: se pega el token
y el `entityId` en los ajustes y el kit se sincroniza.

### 2.8 La desinstalación

`uninstall.php`, con la guarda `defined( 'WP_UNINSTALL_PLUGIN' ) || exit;`.

**Se borra**:
- La opción `beaos_aos` — contiene **el token**: dejarla es dejar una credencial viva en el sitio.
- La opción `beaos_aos_bundle` — la copia del kit. Es basura de decenas de KB.
- El transient del candado.
- El evento de cron `beaos_aos_sync` (`wp_clear_scheduled_hook`), que también se limpia al
  **desactivar** (`register_deactivation_hook`): un plugin desactivado no debe seguir con trabajo
  agendado.

**No se borra**:
- **Nada del lado de BeAOS**. La marca, la entidad, los claims, el bundle publicado y el historial se
  quedan. Desinstalar un plugin de WordPress no puede borrar evidencia de una marca: sería destructivo,
  sorpresivo e irreversible. Lo que **no** hace solo es revocar el token: el plugin lo dice en la
  pantalla antes de desinstalar, y la revocación es del panel de BeAOS
  (`scripts/beaos-token.sh revoke <prefijo>`, `MCP-BEAOS.md:129-131`).
- Nada de otros plugins ni del core. Ni `robots.txt` ni los sitemaps: nunca fueron nuestros.

**Multisitio**: cada sitio tiene su propia opción, así que se limpia por sitio (`get_sites()` y
`switch_to_blog`). WordPress viejo, PHP 7.4+, sin dependencias.

### 2.9 El cliente del MCP: qué devuelve y qué hay que manejar

`class-beaos-mcp.php` implementa `tools/call` sobre JSON-RPC 2.0, en `POST`, **sin SSE y sin sesión**
(`apps/web/src/routes/mcp.ts:8-14`). Nunca manda `initialize` ni `notifications/initialized`: el
servidor es sin estado y `tools/call` se puede llamar directo.

Lo que hay que manejar, todo verificado en el código:

| Situación | Cómo se ve | Qué hace el plugin |
|---|---|---|
| Token ausente / inválido / revocado | `401` con `{ error, message }` y `www-authenticate: Bearer realm="beaos"` (`mcp.ts:38-48`), y el mensaje ya está en castellano (`api-tokens.ts:63-67`) | Muestra el mensaje tal cual. Un token **revocado no cae** al fallback de admin (`api-tokens.ts:22-26`). |
| `GET` | `405` (`mcp.ts:55-62`) | No pasa: el cliente sólo hace `POST`. |
| **`429` con `Retry-After`** | El MCP **hoy no lo emite**: no hay rate limiting en `apps/web/src/routes/mcp.ts` ni en `apps/web/src/server/mcp/` (verificado por grep). El `429` + `Retry-After` existe en la API pública de auditoría (`apps/web/src/lib/aos/public-audit.ts:403-433`) y en los endpoints de la extensión (`apps/web/src/lib/api/handler.ts:130-134`) | **Se maneja igual, defensivamente**: `beaos_aos_retry_after()` lee `Retry-After` en sus dos formas (segundos o fecha HTTP), el motivo del error lo nombra, y el cliente lo deja en `retry_after` para que el que reintenta sepa cuánto esperar. **No hay reintento automático**: un 429 no se reintenta solo, se le cuenta a la persona. Que hoy no exista no significa que no vaya a existir. |
| JSON roto | `error.code: -32700` (`jsonrpc.ts:103`) | Error de protocolo, con su `code`. |
| `method` o `id` mal formados | `-32600` (`jsonrpc.ts:108`, `:112`, `:116`) | Idem. |
| Método desconocido | `-32601` (`jsonrpc.ts:204`) | Idem. |
| Tool desconocido o `params` inválidos | `-32602`, y el mensaje **lista los tools que hay** (`jsonrpc.ts:179-189`) | Idem, y el mensaje se muestra. |
| Fallo interno | `-32603` | Idem. |
| **Un tool que falla** | `HTTP 200` con `result.isError: true` y el motivo en `content[0].text` (`jsonrpc.ts:190-200`) | Es contenido, no error de transporte: se muestra el texto. |
| **Un tool que responde "no"** | `HTTP 200`, **sin** `isError`, con `structuredContent.ok === false` (publish bloqueado, `actions.ts:468-469`), `{ published: false }` (`agent.ts:496-501`) o `{ found: false }` (`agent.ts:538-541`) | **Se mira `ok` / `published` / `found`**, no `isError`. Es la trampa del contrato. |
| Notificación (sin `id`) | `202` sin cuerpo (`mcp.ts:80`) | El cliente nunca manda una, pero si llega un `202` no se parsea el vacío. |
| Un proxy o WAF devuelve HTML | `200` con cuerpo no-JSON | Mensaje claro: "la respuesta no es JSON-RPC". Verificado en producción por el bug de Cloudflare de §1.6. |

Y los tiempos de espera: `timeout` 20 s por defecto, configurable por llamada (el de Autex era 20 —
`autex-aos.php:320`). El token viaja **sólo** en el header `Authorization`, nunca en el cuerpo, nunca en
un log, nunca impreso.

### 2.10 El test

`apps/beaos-wordpress/tests/pure.php`, sin WordPress, sin base y sin red:

```bash
php apps/beaos-wordpress/tests/pure.php
```

Sale `0` si pasa y `1` si falla (`exit( $fail )`, el estilo de Autex). Prueba la parte pura:
la construcción del pedido JSON-RPC y del `tools/call` (incluido el `arguments` vacío, que serializa
`{}` y no `[]` porque un array lo rechaza el servidor); la lectura de la respuesta en todos los casos de
la tabla de §2.9; la resolución de la ruta de una request (query, URL absoluta, instalación en
subdirectorio, rutas que no se reclaman); la decisión de guardar un asset (nuevo, sin cambios, sha256
que no da, largo que no da); la re-verificación al servir, con una copia corrupta a propósito; el
vencimiento del kit; el `Retry-After` en las dos formas; el saneo de los ajustes (el vacío que conserva
el token, el `https` forzado, el host normalizado como el del servidor); y dos guardas de contrato: que
el archivo puro no llame a ninguna función de WordPress —leído con el tokenizador de PHP, así que
nombrarlas en un comentario no cuenta— y que todo tool que el plugin llame esté documentado en
`MCP-BEAOS.md`, leído del repositorio.

Se corre con un `php` pelado, sin instalar nada. Sólo hay que definir `ABSPATH` antes de incluir el
archivo puro, porque la guarda de acceso directo está en todos los archivos del plugin.

**Ya se ganó el lugar**: en la primera corrida encontró dos cosas. Una era una expectativa mía mal
escrita (una casilla sin marcar **deja el plugin apagado**, que es lo correcto). La otra era un bug de
verdad: `beaos_aos_host_of()` sacaba el `www.` **antes** de pasar a minúscula, así que
`https://WWW.Acme.com` daba `www.acme.com` en vez de `acme.com` — un host distinto al del servidor, y ese
host es la clave de idempotencia de la marca. Se habrían dado de alta dos marcas para la misma web.

### 2.11 El límite honesto: qué NO va a hacer el plugin

1. **No inventa pruebas.** Sin claims `confirmed` en BeAOS, el perfil declara 0 y el APS declarado queda
   en 0. `BeAOS no inventa pruebas` (`MCP-BEAOS.md:80-81`). El plugin no convierte el contenido del
   sitio en evidencia.
2. **No firma lo que BeAOS no puede firmar.** Sin clave de firma provisionada para ese host, no hay
   `.sig` ni `keys.json` (`keying.ts:34-45`). El plugin lo muestra como "sin firmar", no como "listo".
3. **No le inventa un MCP al sitio.** Sin `/.well-known/mcp/server-card.json` propio, no hay
   server-card en el kit (`generate.ts:92-93`).
4. **No saltea el gate de publicación.** Si BeAOS no publicó la entidad, el MCP devuelve
   `{ published: false }` y el plugin no tiene nada que servir. No hay puerta lateral.
5. **No revierte el candado de claims.** Si BeAOS bloquea una publicación, el plugin muestra el motivo;
   no la reintenta por otra vía.
6. **No sirve binarios.** El MCP entrega el contenido como texto; hoy todo el bundle es texto. Una
   imagen o un `.zip` en el bundle no se puede servir por este camino.
7. **No mide APS ni escribe el DNA.** Eso es `ensure_prompt_library` / `start_aps_run` /
   `sync_brand_dna`, y son decisiones de un operador.
8. **No administra el resto de BeAOS.** Competidores, prompts, reportes, visibilidad: nada de eso.
9. **No hace magia con la caché.** Si el sitio tiene caché de página, hay que vaciarla. El plugin lo
   avisa, no la controla.
10. **No reemplaza al panel.** Revisar y confirmar pruebas es una decisión humana en BeAOS.

---

## Apéndice · Lo que hay que verificar de nuevo cuando se implemente el asistente

- Que el código de canje (flujo A) marque el código usado **en la misma transacción** que emite el
  token: si no, dos canjes en paralelo emiten dos tokens.
- Que el endpoint de canje tenga límite de intentos. Hoy **el MCP no tiene**: eso hay que construirlo, no
  heredarlo.
- Que el asistente **no** mande `confirmMissingCategory: true` sin que la persona lo haya leído.
- Que la pantalla del paso 3 muestre el `warning` del candado cuando existe: un aviso que no se ve es
  un aviso que no existe.
- Que el `uninstall.php` se pruebe en multisitio antes de publicar el plugin.

## Lo que no pude verificar

- **No corrí el plugin en un WordPress real.** No hay un WordPress en este checkout: el servido, el
  `init` de prioridad 0, el cron y la convivencia con el plugin de Autex están diseñados y probados en
  su parte pura, **no ejecutados contra un WordPress**. Es la verificación que falta y no la puedo hacer
  desde acá.
- **No probé contra el MCP en vivo** (`https://beaos.believe-global.com/mcp`): no tengo un token de
  producto y no lo voy a inventar. El contrato del cliente está leído del código del servidor
  (`jsonrpc.ts`, `mcp.ts`, `actions.ts`, `agent.ts`), no observado en una respuesta real.
- **No verifiqué el `429` del MCP** porque no existe hoy: el manejo es defensivo y está dicho así.
- **No verifiqué el comportamiento del candado con una publicación real**: leí `claimsGuardDecision`, su
  llamador y las dos entradas posibles (`null` y un conteo), y de ahí sale la conclusión de §2.5. No
  corrí una publicación contra la base.
- **No corrí los tests del monorepo** después de agregar `apps/beaos-wordpress/`: no toqué ni una línea
  de `apps/web`, `packages/aos-aps` ni `packages/lib`, y el directorio nuevo no está en el workspace de
  pnpm, así que no entra al grafo de Turborepo. Está pendiente correrlos igual.
- **No verifiqué la firma Ed25519 ni las claves de producción**: si el host de un cliente tiene o no
  clave provisionada es una decisión de despliegue que no está en este repo.
