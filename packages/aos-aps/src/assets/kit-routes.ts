/**
 * La forma de una ruta del kit: **la única definición** de qué rutas puede llevar un bundle.
 *
 * Por qué existe. El generador declara hoy 15 rutas, todas literales, y ninguna es peligrosa. Pero
 * nada lo impedía: `agent_assets.path` es `text NOT NULL` sin `CHECK`, y `buildBundle()` metía las
 * filas al bundle tal cual. Un refactor, un seed, un import o un `INSERT` a mano con
 * `/wp-login.php` viajaba al sitio del cliente y **tapaba la pantalla de login** (probado contra un
 * WordPress real: 66 B del señuelo en lugar de los 10.098 B del login). Arreglarlo en el plugin de
 * WordPress defiende a **un** integrador; arreglarlo acá defiende a todos.
 *
 * La regla, y de dónde sale. Es **la misma** que la lista blanca del plugin de WordPress
 * (`apps/beaos-wordpress/beaos-aos-pure.php`, sección "La lista blanca de rutas"), y no puede ser
 * otra: dos reglas parecidas se desincronizan el día que alguien agrega un asset. PHP y TypeScript no
 * comparten código, así que la atadura no es un import: es
 *
 *   1. esta lista —los cinco archivos fijos de la raíz, el prefijo de `/.well-known/`, las rutas
 *      prohibidas conocidas y el tope de largo—;
 *   2. `KIT_ROUTE_VECTORS`, un corpus de rutas con el veredicto esperado, que **los dos lados**
 *      consumen: `packages/aos-aps/src/assets/kit-routes.test.ts` lo corre contra `isKitRoute()` y
 *      `apps/beaos-wordpress/tests/pure.php` lo **lee de este archivo** y lo corre contra
 *      `beaos_aos_claimable_path()`. Un caso nuevo se agrega una sola vez, acá.
 *
 * Y hay un cuarto lugar que conoce la forma, pero **no la copia**: el `CHECK` de `agent_assets.path` se
 * genera desde estas mismas constantes (`packages/aos-aps/src/db/schema.ts`), y
 * `scripts/agent-assets-path-guard-check.sh` mide caso por caso, contra un Postgres real, que el SQL y
 * `isKitRoute()` coincidan. El plugin de WordPress no puede importar este archivo (es PHP), así que su
 * atadura es el test que lo lee.
 *
 * El día que las dos implementaciones discrepen en un solo vector, uno de los dos tests falla. Es el
 * mismo criterio con el que `pure.php` ya lee el generador y `MCP-BEAOS.md`.
 *
 * La forma, en orden (el orden importa: decide **cuál** es el motivo del rechazo, y el motivo es lo que
 * ven el panel y el log):
 *
 *   1. la ruta vacía o la raíz no son un archivo;
 *   2. tiene que ser absoluta;
 *   3. sin `..`;
 *   4. de 256 caracteres para abajo;
 *   5. sólo el juego de caracteres del kit: `A-Z a-z 0-9 . _ / -`;
 *   6. y no estar en la lista de prohibidas —que es explícita **a propósito**, aunque la regla 5 y la 7
 *      ya la cubran casi entera: es la capa que no depende de que la forma siga bien el día que alguien
 *      la afloje—;
 *   7. y recién ahí la forma del kit: **los cinco archivos fijos de la raíz** —lista exacta, porque en
 *      la raíz viven `wp-login.php`, `wp-config.php` e `index.php`, y ninguna forma distingue un asset
 *      del kit de un archivo del core salvo el nombre—, o **cualquier cosa que cuelgue de
 *      `/.well-known/`** con algo después del prefijo (RFC 8615), que es lo que hace que un asset nuevo
 *      se sirva sin tocar el plugin.
 */

/**
 * Los archivos fijos que el kit publica en la raíz. Es lo que el generador emite hoy, sin inventar.
 * Lista exacta: la comparte el plugin de WordPress, palabra por palabra.
 */
export const KIT_ROOT_PATHS: readonly string[] = [
	"/llms.txt",
	"/llms-full.txt",
	"/AGENTS.md",
	"/robots.txt",
	"/sitemap.xml",
];

/** El prefijo del descubrimiento. Todo lo que cuelga de acá es del kit, por convención. */
export const KIT_WELL_KNOWN_PREFIX = "/.well-known/";

/**
 * Las rutas peligrosas conocidas. La regla del `.php` ya las cubre casi todas; están igual porque una
 * lista explícita se lee y se audita, y porque es la capa que no depende de que la forma siga bien.
 */
export const KIT_DENIED_PATHS: readonly string[] = [
	"/wp-admin",
	"/wp-login.php",
	"/wp-config.php",
	"/wp-config-sample.php",
	"/wp-json",
	"/wp-content",
	"/wp-includes",
	"/index.php",
	"/xmlrpc.php",
	"/wp-cron.php",
	"/wp-settings.php",
	"/wp-load.php",
	"/wp-blog-header.php",
	"/wp-signup.php",
	"/wp-activate.php",
	"/wp-mail.php",
	"/wp-trackback.php",
	"/wp-comments-post.php",
	"/wp-links-opml.php",
	"/readme.html",
	"/.htaccess",
	"/.env",
];

/** El tope de largo de una ruta del kit. Más larga que esto es un absurdo, no un asset. */
export const KIT_PATH_MAX_LENGTH = 256;

/**
 * El juego de caracteres del kit y el sufijo prohibido, como **fuente** de expresión regular.
 *
 * Van como fuente y no como expresión ya armada porque el `CHECK` de `agent_assets.path`
 * (`packages/aos-aps/src/db/schema.ts`) los escribe en SQL: así la base y esta guarda usan la misma
 * regla y no dos parecidas. Ver `KIT_PATH_SHAPE` para el uso desde TypeScript.
 */
export const KIT_PATH_SHAPE_SOURCE = "^/[A-Za-z0-9._/-]+$";

/** Todo `.php`, sin importar dónde cuelgue (incluido `/.well-known/`). */
export const KIT_PHP_SUFFIX_SOURCE = "\\.php$";

/** El juego de caracteres del kit, ya compilado. Sale de `KIT_PATH_SHAPE_SOURCE`: una sola fuente. */
export const KIT_PATH_SHAPE = new RegExp(KIT_PATH_SHAPE_SOURCE);

/** El `.php` final, ya compilado. Sale de `KIT_PHP_SUFFIX_SOURCE`: una sola fuente. */
export const KIT_PHP_SUFFIX = new RegExp(KIT_PHP_SUFFIX_SOURCE, "i");

/** El motivo, en castellano, de cada rechazo. Los mismos textos que el plugin: el panel y el log los muestran. */
export const KIT_ROUTE_REASON = {
	notAFile: "no es la ruta de un archivo",
	notAbsolute: "no es una ruta absoluta",
	dotDot: "tiene ..",
	tooLong: `es más larga que ${KIT_PATH_MAX_LENGTH} caracteres`,
	charset: "tiene caracteres que ninguna ruta del kit usa",
	denied: "está en la lista de rutas prohibidas",
	notKit: "no tiene forma de kit",
} as const;

/**
 * ¿Está en la lista explícita de lo prohibido? Sí para todo `.php` (sin importar dónde cuelgue,
 * incluido `/.well-known/`) y para las rutas del core y del panel, con o sin barra final.
 */
export function isKitDeniedPath(path: string): boolean {
	const lower = path.toLowerCase();
	if (lower.length === 0) return false;
	if (lower.endsWith(".php")) return true;
	return KIT_DENIED_PATHS.some((denied) => lower === denied || lower.startsWith(`${denied}/`));
}

/**
 * Por qué una ruta **no** se puede reclamar, o `""` si sí se puede. Un solo lugar decide, y el motivo es
 * el que ven el panel y el log: el que rechaza una ruta tiene que poder decir cuál y por qué.
 */
export function kitRouteRejectionReason(path: string): string {
	if (path.length === 0 || path === "/") return KIT_ROUTE_REASON.notAFile;
	if (path.startsWith("/") === false) return KIT_ROUTE_REASON.notAbsolute;
	if (path.includes("..")) return KIT_ROUTE_REASON.dotDot;
	if (path.length > KIT_PATH_MAX_LENGTH) return KIT_ROUTE_REASON.tooLong;
	if (KIT_PATH_SHAPE.test(path) === false) return KIT_ROUTE_REASON.charset;
	if (isKitDeniedPath(path)) return KIT_ROUTE_REASON.denied;
	if (KIT_ROOT_PATHS.includes(path)) return "";
	if (path.startsWith(KIT_WELL_KNOWN_PREFIX) && path.length > KIT_WELL_KNOWN_PREFIX.length) return "";
	return KIT_ROUTE_REASON.notKit;
}

/** ¿Esta ruta es de las que el kit puede reclamar? Sí sólo si tiene forma de kit y no está prohibida. */
export function isKitRoute(path: unknown): path is string {
	return typeof path === "string" && kitRouteRejectionReason(path) === "";
}

/**
 * Una entrada del corpus: la ruta y el veredicto que **los dos lados** tienen que dar.
 *
 * El tipo va por alias y no escrito en la declaración del array a propósito: el test de PHP corta el
 * bloque en el `= [` y un `[` en la anotación de tipo lo desorientaría.
 */
export type KitRouteVector = readonly [string, boolean];

/**
 * El corpus compartido: rutas con el veredicto que **los dos lados** tienen que dar.
 *
 * Lo consumen `kit-routes.test.ts` (contra `isKitRoute()`) y `apps/beaos-wordpress/tests/pure.php`
 * (que lee este archivo y lo corre contra `beaos_aos_claimable_path()`). Es la atadura entre la
 * implementación de TypeScript y la de PHP: no comparten código, comparten estos casos.
 *
 * Cada entrada va en **una sola línea** y con literales —nada de expresiones ni plantillas—, porque el
 * test de PHP lee este archivo como texto. Una ruta que el parser de PHP no pueda leer se denuncia en
 * vez de ignorarse: un test que no puede leer un caso no puede garantizar nada sobre él.
 */
export const KIT_ROUTE_VECTORS: ReadonlyArray<KitRouteVector> = [
	// Lo que el kit publica hoy: los cinco fijos de la raíz y los diez de .well-known.
	["/llms.txt", true],
	["/llms-full.txt", true],
	["/AGENTS.md", true],
	["/robots.txt", true],
	["/sitemap.xml", true],
	["/.well-known/brand.json", true],
	["/.well-known/brand.json.sig", true],
	["/.well-known/keys.json", true],
	["/.well-known/agent-card.json", true],
	["/.well-known/agent-permissions.json", true],
	["/.well-known/mcp/server-card.json", true],
	["/.well-known/security.txt", true],
	["/.well-known/api-catalog", true],
	["/.well-known/ai-catalog.json", true],
	["/.well-known/http-message-signatures-directory", true],
	// La forma cubre lo que todavía no existe: un asset nuevo bajo .well-known/ no toca el código.
	["/.well-known/lo-que-venga.json", true],
	["/.well-known/mcp/otro.json", true],
	["/.well-known/a", true],
	// Las rutas del core que el manifiesto podía reclamar: el agujero que esto cierra.
	["/wp-login.php", false],
	["/WP-LOGIN.PHP", false],
	["/wp-admin", false],
	["/wp-admin/", false],
	["/wp-admin/options-general.php", false],
	["/wp-config.php", false],
	["/wp-config-sample.php", false],
	["/wp-json", false],
	["/wp-json/wp/v2/posts", false],
	["/index.php", false],
	["/xmlrpc.php", false],
	["/wp-content/uploads/x.txt", false],
	["/wp-includes/x.txt", false],
	["/readme.html", false],
	["/.htaccess", false],
	["/.env", false],
	// Un .php escondido en .well-known, y sin importar mayúsculas.
	["/.well-known/algo.php", false],
	["/.well-known/x.PHP", false],
	// El prefijo pelado no es un archivo.
	["/.well-known/", false],
	["/.well-known", false],
	// Un archivo de la raíz que el kit no publica.
	["/license.txt", false],
	["/wp-login", false],
	["/llms.txt/", false],
	// Guardas de forma.
	["/", false],
	["", false],
	["llms.txt", false],
	["/../wp-config.php", false],
	["/.well-known/../../../wp-config.php", false],
	["/.well-known/ñ.json", false],
	["/.well-known/a b.json", false],
	["/.well-known/a?b", false],
	["/.well-known/a#b", false],
	["//.well-known/brand.json", false],
];
