# BeAOS by Believe (plugin de WordPress)

Conecta un sitio de WordPress con **BeAOS**: publica la marca como assets agénticos y sirve el kit
(`/llms.txt`, `/AGENTS.md`, `/.well-known/*`) **byte a byte** en su ruta, con el `Content-Type` que
declaró BeAOS.

Reusa el criterio del plugin de Autex (`autex-aos`, v0.5.0), que ya sirve un kit así en producción:

- La copia local vive en la opción `beaos_aos_bundle`, **sin autoload** y con los cuerpos en **base64**:
  la tabla de opciones de WordPress es texto y no puede tocar un solo byte.
- Un archivo cuyo `sha256` no cambió **no se vuelve a bajar**.
- Un archivo que no da su `sha256` o su largo **no se guarda**: mejor un 404 que servir algo que rompió
  la firma.
- Al servir, el `sha256` **se vuelve a verificar** en cada request.
- Lo que no está en el manifiesto queda para WordPress: `robots.txt` y los sitemaps del core siguen
  siendo del core.

Sin dependencias: PHP 7.4+, WordPress 6.0+, ningún paquete de Composer ni de npm.

## Estado: lo que está y lo que falta

| | |
|---|---|
| Sincronización y servido del kit | **Listo** |
| Cron y candado de corrida | **Listo** |
| Página de ajustes (con categoría y token) | **Lista** |
| Cliente del MCP (`class-beaos-mcp.php`) | **Listo** |
| **Canje del código de conexión** (paso 1, flujo A) | **Listo** |
| Desinstalación limpia | **Lista** |
| Asistente de 3 pasos completo (conectar → la marca → generar y publicar) | **Falta**: los pasos 2 y 3 |

## Instalar

1. **Desde BeAOS**: en Configuración → Brand, al lado de la versión, está **Descargar el plugin**. Es el
   ZIP de la última release, con la versión en el nombre (`beaos-aos-<version>.zip`), y se sube desde
   Plugins → Añadir nuevo → Subir plugin → Activar.
2. **Desde el repositorio**, para desarrollar: copiar la carpeta `beaos-wordpress` a
   `wp-content/plugins/`.

El ZIP de la release lo arma `scripts/release-wordpress-plugin.mjs` con lo que se instala (los cuatro
`.php` y este README, adentro de `beaos-aos/`): los tests y `.wp-local/` no entran. La versión vive en la
cabecera de este plugin y el detalle de cada una está en [`CHANGELOG.md`](./CHANGELOG.md).

## Configurar

**Ajustes → BeAOS by Believe.**

### Conexión: el código de un solo uso

1. En BeAOS, **Configuración → Brand → "Generar código de conexión"** (o, en el servidor,
   `scripts/beaos-enroll.sh create <brandId> <entityId> wordpress-tu-sitio`). El código se muestra
   **una sola vez**: en BeAOS queda sólo su hash.
2. Pegarlo acá y tocar **Conectar**. El plugin lo canjea en `POST /api/v1/enroll` y guarda lo que BeAOS
   devuelve: el token **de este sitio**, su `brandId` y su `entityId`.

El código sirve **una sola vez**, vence en **24 horas** y está atado a **una marca y una entidad**. Lo que
viaja a este WordPress es un secreto corto y revocable por sitio, nunca `ADMIN_API_KEYS`.

**Es el único `/api/v1/*` que el plugin usa, y puede usarlo porque es público**: no pide credencial previa
—el código *es* la credencial— y su cota es un cupo de intentos por IP. Cualquier otro `/api/v1/*` valida
sólo contra la llave maestra, así que no se usa: el test puro tiene la guarda que lo exige.

Los cuatro campos de abajo (token, marca, entidad) los llena la conexión sola; quedan a la vista para
revisar o corregir a mano. El token nunca se imprime en el navegador: un vacío al guardar **conserva** el
que ya está.

Si el canje falla, el aviso dice por qué: **código vencido o ya usado**, o **límite de intentos
alcanzado**. Un canje fallido no toca la credencial que ya estuviera guardada.

### La marca

Nombre, web y **categoría**. Los completa el asistente cuando esté; hoy se guardan acá para que el alta
no dependa de recordar qué se escribió.

**La categoría no es decorativa**: es lo que calibra la biblioteca de preguntas de compra del APS. Sin
categoría declarada, BeAOS corta la generación **antes de gastar la llamada**; si se fuerza, se calibra
con el marcador genérico `marketing/software` y los prompts salen generales. La categoría **no cambia
los archivos del kit**: cambia el instrumento con el que se mide.

### El kit

- **Activo**: sincroniza y sirve el kit en este sitio.
- **Endpoint del MCP**: por defecto `https://beaos.believe-global.com/mcp`. Sólo https.
- **Base de BeAOS**: para los enlaces al panel.
- **Sincronizar ahora**: el cron de WordPress sólo corre cuando alguien visita el sitio; este botón no
  espera.

## Cómo funciona

1. Al guardar los ajustes y después cada hora (wp-cron), el plugin llama por el MCP a
   `get_agent_bundle` y recibe el manifiesto: cada ruta con su `type`, su `sha256` y su `bytes`.
2. Por cada archivo nuevo o cambiado llama a `get_agent_asset` y lo guarda **sólo si** el `sha256` y el
   largo coinciden con el manifiesto.
3. En cada request, en `init` con prioridad **0**, si la ruta es una del manifiesto se responde con los
   bytes exactos, el `Content-Type` del manifiesto, `Content-Length`, `X-BeAOS-Sha256`,
   `Cache-Control: public, max-age=300, no-transform` y `X-Content-Type-Options: nosniff`, y se corta
   ahí. Así gana a `do_robots()`, a los sitemaps del core y al 404 de `/.well-known/*`.
4. Si el manifiesto no llega, **se sigue sirviendo la copia anterior** y sólo se anota el error.
5. Si la entidad **no está publicada** en BeAOS, el MCP responde `{ published: false }`: no es un error,
   es un estado, y el panel lo dice así.

**¿Por qué por el MCP y no por la API de entrega de BeAOS?** Porque `/api/v1/*` de BeAOS valida **sólo**
contra `ADMIN_API_KEYS`, la llave maestra compartida: usarla obligaría a mandar una llave maestra a un
WordPress ajeno. El MCP es la única puerta que acepta un token por producto, revocable de a uno.

## La lista blanca de rutas (por qué el kit no puede tapar el login)

El manifiesto es la **única** fuente de verdad de qué sirve el plugin. Sin lista blanca, **cualquier**
ruta del manifiesto se sirve, y como el enganche es `init` con prioridad 0, una entrada para
`/wp-login.php` le gana al core y **tapa la pantalla de login** (y `/wp-admin/` tapa el panel). No hace
falta un atacante: un bug en el generador que emita una ruta de más deja al cliente sin poder entrar a su
WordPress.

El plugin sólo reclama rutas **con forma de kit**:

1. los archivos fijos que el kit publica **en la raíz** —`/llms.txt`, `/llms-full.txt`, `/AGENTS.md`,
   `/robots.txt`, `/sitemap.xml`—: lista exacta, porque en la raíz viven `wp-login.php`,
   `wp-config.php` e `index.php` y ninguna forma distingue un asset del kit de un archivo del core
   salvo el nombre;
2. **todo lo que cuelga de `/.well-known/`** (RFC 8615): es donde el kit pone sus diez archivos de
   descubrimiento, y el prefijo hace que un asset nuevo se sirva **sin tocar el plugin**.

Nada más: ni `/wp-admin`, ni `/wp-login.php`, ni `/wp-config.php`, ni `/wp-json`, ni `/index.php`, ni
ningún `.php`. La segunda capa es un rechazo **explícito** de esas rutas y de todo `.php`, antes de
mirar la forma: si algún día alguien afloja la forma, esa capa sigue en pie.

Qué pasa con una ruta del manifiesto que no pasa la lista blanca: **se ignora** (no se descarga, no se
guarda y, si ya estaba guardada de una versión anterior, no se sirve), **el resto del kit sigue
sirviéndose** —tirar el bundle entero cambiaría un bug de una ruta por una caída del kit completo— y
**queda registrada**: el motivo viaja al pie de la página de ajustes y a `error_log` (con
`WP_DEBUG_LOG`, a `wp-content/debug.log`), una vez por ruta cada 12 horas.

La lista **no se puede desincronizar del generador**: `tests/pure.php` lee
`packages/aos-aps/src/assets/generate.ts` y falla si el kit emite una ruta que la lista blanca
rechazaría, o si una ruta dejó de ser un literal verificable. El día que el generador agregue un asset,
el test lo dice en vez de que el asset no se sirva en silencio.

## Verificar

Por el camino real, contra el sitio publicado:

1. `curl -sI https://SITIO/llms.txt` muestra el `Content-Type` y el `X-BeAOS-Sha256`.
2. El mismo hash contra el `sha256` de la ruta en el manifiesto que devuelve `get_agent_bundle` por el
   MCP.
3. `curl -s https://SITIO/AGENTS.md` y `curl -s https://SITIO/.well-known/brand.json` deben dar el
   contenido, no el 404 de WordPress.
4. `curl -sI https://SITIO/robots.txt` debe seguir siendo el de WordPress, si el manifiesto no lo trae.
5. El estado al pie de Ajustes → BeAOS by Believe: cuántos archivos, cuándo y el último error.

**Si el hash no coincide y el sitio está en Cloudflare**, revisar Auto Minify, Rocket Loader y Email
Obfuscation: reescriben los bytes y la firma deja de validar. El plugin manda `no-transform`, pero no
controla la zona: hay que excluir `/.well-known/*`, `/llms.txt`, `/llms-full.txt` y `/AGENTS.md` con una
Configuration Rule. Lo mismo con un plugin de WordPress que minifique la salida. Y si el sitio tiene
caché de página (WP Rocket, LiteSpeed, Cloudflare APO), **vaciarla después de sincronizar**.

## Test

Sin WordPress, sin base y sin red:

```bash
php apps/beaos-wordpress/tests/pure.php
```

Sale `0` si pasa y `1` si falla. Prueba la parte pura —el sobre y la lectura del JSON-RPC, el motivo de
un status HTTP, el `Retry-After`, la ruta de una request, la lista blanca de rutas del kit, la
verificación de un asset, el vencimiento y el saneo de los ajustes— y tres guardas de contrato:

- que `beaos-aos-pure.php` **no llame a ninguna función de WordPress** (si no, deja de ser probable);
- que **todo tool que el plugin llame esté documentado** en `MCP-BEAOS.md`, leído del repositorio y no
  de memoria;
- que **el generador del kit no emita una ruta que la lista blanca rechace**: lee
  `packages/aos-aps/src/assets/generate.ts` y también falla si una ruta dejó de ser un literal
  verificable.

Se corre con un `php` pelado. Lo único que hace falta es que exista la constante `ABSPATH`, que el test
define: la guarda de acceso directo está en todos los archivos del plugin, y una constante no es
WordPress.

## Desinstalar

`uninstall.php` borra la opción `beaos_aos` (que guarda el token), la copia del kit, el transient del
candado y el evento de cron. En multisitio, una vez por sitio.

**No** toca nada del lado de BeAOS: la marca, la entidad, las pruebas y el bundle publicado se quedan.
Desinstalar un plugin de WordPress no puede borrar la evidencia de una marca. Lo único que queda a mano
es **revocar el token** en BeAOS (`scripts/beaos-token.sh revoke <prefijo>`).

## Límites conocidos

- **No sirve binarios.** El MCP entrega el contenido como texto; hoy todo el bundle es texto
  (`text/plain`, `text/markdown`, `application/json`, `application/xml`).
- **No inventa un MCP para el sitio.** El `/.well-known/mcp/server-card.json` sólo existe en el kit si
  el sitio declara su propio MCP: BeAOS no inventa endpoints.
- **No saltea el gate de publicación de BeAOS.** Si la entidad no está publicada, no hay nada que servir.
- **No revierte el candado de claims.** Si BeAOS rechaza una publicación, el plugin muestra el motivo.
- **No firma.** La firma y `keys.json` dependen de una clave provisionada en BeAOS para ese host.
- **No mide APS ni escribe el DNA.** Eso es del panel de BeAOS.
- **Un plugin de caché de página puede servir bytes viejos.** Hay que vaciarla.
- **Si el plugin Autex AOS está activo, este plugin no sirve el kit**: los dos quieren las mismas rutas y
  dos kits mezclados serían un kit que no firmó nadie. El panel lo avisa.

El diseño completo, con el porqué de cada decisión y los tres flujos de conexión, está en
[`PLUGIN-WORDPRESS-BEAOS.md`](../../PLUGIN-WORDPRESS-BEAOS.md).
