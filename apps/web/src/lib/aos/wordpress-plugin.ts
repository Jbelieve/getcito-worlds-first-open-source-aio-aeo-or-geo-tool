/**
 * El plugin de WordPress, del lado del panel: qué versión se muestra y de dónde se descarga.
 *
 * Son las dos cosas que ve el dueño de un sitio en **Configuración → Brand**, y las dos tienen que
 * apuntar a lo mismo que se empaqueta y se sirve:
 *
 *   - la **versión** no se escribe acá: llega horneada por Vite desde la cabecera del plugin
 *     (`__BEAOS_PLUGIN_VERSION__`, ver `packages/aos-aps/src/wp-plugin/version.ts`), así que el panel no
 *     puede mostrar una versión y ofrecer un ZIP de otra;
 *   - la **descarga** es una ruta **estable y sin versión** (`/beaos-aos.zip`): el panel no cambia de
 *     enlace en cada release. Los bytes los deja el build en `apps/web/public/`
 *     (`scripts/release-wordpress-plugin.mjs --public`), así que la copia servida es siempre la del
 *     código desplegado, y la versión que hay adentro se puede consultar en
 *     `/beaos-aos-version.json`.
 *
 * Las dos rutas son relativas al host que sirve el panel a propósito: funcionan igual en local, en la
 * demo y en un despliegue white-label, sin escribir el dominio en el código.
 */

/** Cómo se llama el plugin en la pantalla. Es el nombre de la cabecera, sin la parte de Believe. */
export const WP_PLUGIN_LABEL = "Plugin BeAOS para WordPress";

/** La versión de la cabecera del plugin, horneada en el build. */
export const WP_PLUGIN_VERSION = __BEAOS_PLUGIN_VERSION__;

/** La descarga: siempre la última versión, con el mismo enlace. */
export const WP_PLUGIN_DOWNLOAD_PATH = "/beaos-aos.zip";

/** El JSON que dice qué versión se está sirviendo y su `sha256` (para verificar la descarga). */
export const WP_PLUGIN_VERSION_PATH = "/beaos-aos-version.json";

/**
 * Los tres pasos, en el idioma de quien administra un sitio y no de quien programa.
 *
 * Van juntos a propósito: es **un** trabajo (descargar, instalar, pegar el código), no tres funciones
 * sueltas de la pantalla.
 */
export const WP_PLUGIN_STEPS: readonly string[] = [
	"Descargá el plugin y guardá el archivo.",
	"En tu WordPress: Plugins → Añadir nuevo → Subir plugin, elegí el archivo y activalo.",
	"Volvé acá, generá el código de conexión y pegalo en Ajustes → BeAOS by Believe.",
];
