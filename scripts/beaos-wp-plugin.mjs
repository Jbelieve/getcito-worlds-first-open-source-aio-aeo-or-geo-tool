/**
 * El contrato del plugin de WordPress de BeAOS: **su versión, su slug y qué archivos se instalan**.
 *
 * La versión vive en **un solo lugar**: la cabecera del plugin (`Version: x.y.z` en
 * `apps/beaos-wordpress/beaos-aos.php`), que es la que WordPress muestra en la lista de plugins y la que
 * ve quien lo instala. Este módulo **la lee de ahí**; no la guarda ni la copia.
 *
 * Por qué existe y por qué está en `.mjs`. Tres consumidores que no comparten build necesitan el mismo
 * dato, y ninguno puede ser la fuente:
 *
 *   1. la configuración de Vite del panel (`apps/web/vite.config.ts`), que hornea la versión con `define`
 *      para que Configuración → Brand la muestre sin pedirla por red;
 *   2. el empaquetador (`scripts/release-wordpress-plugin.mjs`), que le pone el número al nombre del ZIP y
 *      al JSON que se sirve;
 *   3. los tests, que comparan lo que muestra el panel contra la cabecera.
 *
 * El 1 y el 2 no pueden importarse entre sí (uno es configuración de Vite, el otro un script de Node) y
 * los dos corren en Node pelado, que carga este archivo tal cual: por eso es JavaScript con extensión
 * explícita y sus tipos van al lado, en `beaos-wp-plugin.d.mts`. Así la regla de lectura está **una sola
 * vez**, en vez de una copia en cada lado que se desincroniza el día que alguien cambie la cabecera.
 *
 * La lista de archivos es explícita a propósito, con el criterio de `scripts/release-extension.sh`: si
 * mañana alguien agrega un archivo al directorio del plugin, no entra al ZIP por accidente.
 */

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** El slug del plugin: el nombre de la carpeta de adentro del ZIP y el de los archivos que se sirven. */
export const WP_PLUGIN_SLUG = "beaos-aos";

/** El archivo de la cabecera, relativo a la raíz del repositorio. La única fuente de la versión. */
export const WP_PLUGIN_HEADER = "apps/beaos-wordpress/beaos-aos.php";

/**
 * Lo que se instala, y nada más.
 *
 * `uninstall.php` va aunque no se "use" al instalar: WordPress lo busca en la raíz del plugin cuando
 * alguien desinstala, y sin él la opción con el token se queda en la base del sitio.
 *
 * No entran `tests/` (leen archivos del repositorio —`MCP-BEAOS.md`,
 * `packages/aos-aps/src/assets/generate.ts`— así que adentro de un WordPress no pueden correr, y
 * instalarlos sería dejar un test roto en el sitio de un cliente) ni nada de `.wp-local/`.
 */
export const WP_PLUGIN_FILES = [
	"beaos-aos.php",
	"beaos-aos-pure.php",
	"class-beaos-mcp.php",
	"uninstall.php",
	"README.md",
];

/**
 * La línea `Version:` de la cabecera de un plugin de WordPress.
 *
 * La cabecera es un bloque de comentario al principio del archivo con una línea por campo. La expresión
 * es deliberadamente estricta: exige el `*` del comentario y el nombre exacto del campo, así que
 * `Requires at least:` no se confunde con la versión y una línea `* Version:` sin valor no pasa en
 * silencio.
 */
const VERSION_HEADER = /^[ \t]*\*[ \t]*Version:[ \t]*(\S+)[ \t]*$/m;

/** El formato que WordPress (y el nombre del ZIP) esperan: `x.y.z`, sin `v` y sin sufijos. */
const SEMVER = /^\d+\.\d+\.\d+$/;

/** La raíz del repositorio, resuelta desde la ubicación de este archivo (`scripts/`). */
export function wpPluginRepoRoot() {
	return fileURLToPath(new URL("..", import.meta.url));
}

/**
 * Lee la versión de la cabecera a partir del **texto** del archivo.
 *
 * Tira si no la encuentra o si no tiene forma de versión, en vez de devolver un valor vacío: el nombre
 * del ZIP y la versión que muestra el panel salen de acá, así que una cabecera ilegible tiene que romper
 * el build, no publicar un `beaos-aos-.zip`.
 */
export function parseWpPluginVersion(header) {
	const found = VERSION_HEADER.exec(header);
	const version = found?.[1];
	if (version === undefined) {
		throw new Error(`no encontré la línea "Version: x.y.z" en la cabecera del plugin (${WP_PLUGIN_HEADER})`);
	}
	if (!SEMVER.test(version)) {
		throw new Error(`la versión del plugin ("${version}") no tiene la forma x.y.z que exige WordPress`);
	}
	return version;
}

/**
 * La versión del plugin, leída de la cabecera del repositorio.
 *
 * `repoRoot` existe para los tests (un repositorio de mentira), no para producción: el default es la
 * raíz del repositorio donde vive este archivo.
 */
export function readWpPluginVersion(repoRoot = wpPluginRepoRoot()) {
	return parseWpPluginVersion(readFileSync(resolve(repoRoot, WP_PLUGIN_HEADER), "utf8"));
}

/** El nombre del ZIP versionado: `beaos-aos-<version>.zip`. */
export function wpPluginZipName(version) {
	return `${WP_PLUGIN_SLUG}-${version}.zip`;
}
