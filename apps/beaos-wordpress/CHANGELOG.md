# Changelog — BeAOS by Believe (plugin de WordPress)

Qué cambió en cada versión del plugin, en el orden en que se publicó.

La versión **vive en la cabecera** de [`beaos-aos.php`](./beaos-aos.php) (`Version: x.y.z`) y este archivo
la sigue: acá no hay una versión que la cabecera no declare. Los tres consumidores de ese número —el
nombre del ZIP de la release (`beaos-aos-<version>.zip`), la versión que muestra el panel de BeAOS en
Configuración → Brand y el `beaos-aos-version.json` que se sirve— lo leen de ahí, y un test lo verifica
(`apps/web/src/lib/aos/__tests__/wordpress-plugin.test.ts`).

## 0.1.0

Publicado el 2 de octubre de 2026. Es la **primera versión instalable**: hasta acá el plugin vivía en el
repositorio y se probaba contra un WordPress local, pero no había un ZIP que un dueño de sitio pudiera
subir desde su panel. Todo lo de abajo ya estaba en el código antes de este número.

### Lo que hace

- **Conecta el sitio con un código de un solo uso.** En BeAOS se genera el código (Configuración →
  Brand), se pega en el plugin y el plugin lo canjea en `POST /api/v1/enroll`: recibe **su** token, atado
  a una marca y a una entidad, y lo guarda. El código vence en 24 horas, se canjea una sola vez y se
  revoca por sitio; `ADMIN_API_KEYS` —la llave maestra de BeAOS— nunca sale de BeAOS. Un canje fallido no
  toca la credencial que ya estuviera guardada, y si el sitio no tiene salida a internet el aviso dice
  que no hubo respuesta, en vez de mandar a buscar un proxy o un WAF que no existen.
- **Baja el kit por el MCP** (`get_agent_bundle` + `get_agent_asset`), no por `/api/v1/*`: esa puerta
  valida sólo contra la llave maestra y usarla obligaría a mandarla a un WordPress ajeno. Es el único
  `/api/v1/*` que el plugin usa y puede usarlo porque es público.
- **Sirve el kit byte a byte en su ruta** (`/llms.txt`, `/llms-full.txt`, `/AGENTS.md`, `/robots.txt`,
  `/sitemap.xml` y lo que cuelga de `/.well-known/`), con el `Content-Type` que declaró BeAOS, `sha256`
  re-verificado en cada request y `HEAD` sin cuerpo. Lo que no está en el manifiesto sigue siendo de
  WordPress: `robots.txt` y los sitemaps del core no se tocan.
- **Sincroniza solo**: al guardar los ajustes y cada hora por cron, sin volver a bajar un archivo cuyo
  `sha256` no cambió, y sin guardar uno que no dé su hash y su largo. Si el MCP no responde, sigue
  sirviendo la copia anterior.
- **Sabe quedarse callado si el plugin de Autex está activo**: los dos quieren las mismas rutas y dos kits
  mezclados serían un kit que no firmó nadie.
- **Se desinstala limpio**: `uninstall.php` borra la opción con el token, la copia del kit, el candado y
  el cron. No toca nada del lado de BeAOS —desinstalar un plugin no puede borrar la evidencia de una
  marca—, así que el token se revoca aparte.

### Lo que se arregló antes de publicar esta versión

- **El kit ya no puede tapar la pantalla de login.** El manifiesto era la única fuente de verdad, así que
  cualquier ruta se podía reclamar, y como el enganche es `init` con prioridad 0 una entrada para
  `/wp-login.php` le gana al core (medido en el WordPress de prueba: 66 B del señuelo en lugar de los
  10.098 B del login). Ahora sólo se reclaman rutas con forma de kit —los cinco archivos fijos de la raíz
  en lista exacta y todo lo que cuelga de `/.well-known/`— con un rechazo explícito de `.php` y de las
  rutas conocidas del core antes de mirar la forma. Una ruta que no pasa la lista blanca **se ignora**
  —no se baja, no se guarda y no se sirve—, el resto del kit sigue sirviéndose, y el motivo queda en el
  panel y en el log. La lista no puede desincronizarse del generador: un test lee las rutas que el kit
  emite y falla si alguna no pasaría; del lado de BeAOS la misma forma se aplica al escribir, al leer y
  en un `CHECK` de la base (migración `0031`).
- **El candado de la sincronización es atómico.** Antes era `get_transient()` + `set_transient()`, que no
  es un candado: entre el `get` y el `set` entran las dos corridas. Ahora es una opción tomada con
  `INSERT IGNORE` sobre el índice único de `wp_options.option_name` —la decisión la toma la base, no el
  código— con vencimiento a los 300 s, liberación por compare-and-swap y limpieza de la caché de
  opciones, que es la trampa cuando hay caché persistente. Medido con 10 procesos sincronizados: al MCP
  llega **una** llamada.
- **El host de la marca ya no se confunde.** `beaos_aos_host_of()` sacaba el `www.` antes de pasar a
  minúscula, así que `https://WWW.Acme.com` daba `www.acme.com` en vez de `acme.com`. Ese host es la
  clave de idempotencia de la marca: se habrían dado de alta dos marcas para la misma web.

### Empaquetado y entrega

- **El ZIP de la release lo arma `scripts/release-wordpress-plugin.mjs`** y trae sólo lo que se instala:
  los cuatro `.php` y el `README.md`, adentro de la carpeta `beaos-aos/` que WordPress exige. No entran
  los tests (leen archivos del repositorio que adentro de un WordPress no existen) ni `.wp-local/`.
- **Se descarga desde el panel de BeAOS**, en Configuración → Brand, al lado de la versión y con los tres
  pasos de la conexión. El enlace es estable (`/beaos-aos.zip`, sin número de versión) y los bytes los
  genera el build, así que la copia servida es la del código desplegado; la versión que se está sirviendo
  se puede consultar en `/beaos-aos-version.json`.
- **Cada release se corta en GitHub** con el ZIP adjunto (`bash scripts/release-wordpress-plugin.sh
  <version>`: sube la versión de la cabecera, arma el ZIP, etiqueta y publica).
