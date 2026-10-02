<?php
/**
 * BeAOS by Believe — la lógica que decide cosas, sin una sola función de WordPress.
 *
 * Vive separado de `beaos-aos.php` por una razón concreta: acá está todo lo que se puede probar con
 * `php` a secas, sin WordPress, sin base y sin red. La construcción y la lectura del JSON-RPC del MCP,
 * la ruta de una request, la verificación de un asset del kit, la decisión de si el kit está vencido y
 * el saneo de los ajustes son funciones puras: entran datos, salen datos.
 *
 * Las constantes viven acá y no en el archivo principal por lo mismo: son datos, no WordPress, así que
 * el test las lee sin levantar nada. El archivo principal las usa igual.
 *
 * Las convenciones son las del plugin de Autex (`autex-aos.php`): constantes `PREFIJO_AOS_*`, funciones
 * `prefijo_aos_*`, y la opción con el mismo prefijo que la constante. Los dos plugins se leen igual.
 */

defined( 'ABSPATH' ) || exit;

const BEAOS_AOS_OPTION = 'beaos_aos';                   // ajustes del plugin (sin autoload)
const BEAOS_AOS_BUNDLE = 'beaos_aos_bundle';            // copia local del kit (sin autoload)
const BEAOS_AOS_LOCK   = 'beaos_aos_lock';              // opción sin autoload: una corrida de sync por vez
const BEAOS_AOS_CRON   = 'beaos_aos_sync';              // el hook del cron

// El MCP de BeAOS. Es la única puerta que acepta un token por producto (el token de `agent_api_tokens`
// vale acá y NO en `/api/v1/*`, que exige una llave maestra): por eso el kit se sincroniza por acá.
const BEAOS_AOS_MCP = 'https://beaos.believe-global.com/mcp';
const BEAOS_AOS_API = 'https://beaos.believe-global.com'; // base de BeAOS, para los enlaces del panel

const BEAOS_AOS_TTL        = 3600;   // una hora: más nuevo que esto no se vuelve a sincronizar
const BEAOS_AOS_LOCK_TTL   = 300;    // cinco minutos: un sync colgado no traba el siguiente para siempre
const BEAOS_AOS_MAX_ASSETS = 200;    // tope de cordura de archivos bajados por corrida
const BEAOS_AOS_TIMEOUT    = 20;     // segundos por request al MCP (el mismo que usa Autex)

/**
 * Los ajustes con sus valores por defecto. `token` es una credencial: nunca se imprime, y el campo se
 * pinta vacío (vacío al guardar = conservar el que ya está).
 */
function beaos_aos_defaults() {
	return array(
		'enabled'   => 1,
		'token'     => '',
		'brand_id'  => '',
		'entity_id' => '',
		'name'      => '',
		'website'   => '',
		'category'  => '',
		'mcp'       => BEAOS_AOS_MCP,
		'api'       => BEAOS_AOS_API,
	);
}

// ── El protocolo del MCP ────────────────────────────────────────────────────────────────────────
//
// JSON-RPC 2.0 sobre POST, sin SSE y sin sesión. Nunca hace falta `initialize` ni
// `notifications/initialized`: el servidor no guarda estado y `tools/call` se llama directo.

/**
 * El sobre JSON-RPC. `params` se omite cuando no hay, que es lo que espera `tools/list`.
 */
function beaos_aos_rpc( $id, $method, array $params = array() ) {
	$message = array(
		'jsonrpc' => '2.0',
		'id'      => $id,
		'method'  => (string) $method,
	);
	if ( $params ) {
		$message['params'] = $params;
	}
	return $message;
}

/**
 * Un `tools/call`. `arguments` va como objeto **siempre**: `params.arguments` tiene que ser un registro,
 * y un array de PHP vacío serializa como `[]`, que el servidor rechaza con `-32602`. Por eso el
 * `stdClass` y no un `array()` pelado.
 */
function beaos_aos_rpc_tool( $id, $tool, array $args = array() ) {
	return beaos_aos_rpc(
		$id,
		'tools/call',
		array(
			'name'      => (string) $tool,
			'arguments' => $args ? $args : new stdClass(),
		)
	);
}

/** El texto de un código de error de protocolo. Los códigos son los del MCP de BeAOS. */
function beaos_aos_rpc_error_message( $code ) {
	switch ( (int) $code ) {
		case -32700:
			return 'El cuerpo no es JSON válido.';
		case -32600:
			return 'Se esperaba un mensaje JSON-RPC 2.0 con `method`.';
		case -32601:
			return 'El método no existe en el MCP.';
		case -32602:
			return 'Parámetros inválidos: el tool o sus argumentos no son los que el servidor espera.';
		case -32603:
			return 'Error interno del MCP.';
		default:
			return 'Error de protocolo del MCP.';
	}
}

/**
 * Lee una respuesta del MCP y la deja en una forma sola.
 *
 * Devuelve `{ ok, kind, code, error, text, data, result }`:
 *   - `kind: ok`       el tool respondió.
 *   - `kind: tool`     el tool falló (`isError: true`): es contenido, no un error de protocolo, y el
 *                      motivo viaja en `content[0].text`.
 *   - `kind: protocol` el sobre está mal (`error.code`): -32700, -32600, -32601, -32602, -32603.
 *
 * **Trampa del contrato**: un tool puede responder que "no" sin marcar `isError` —`publish_agent_assets`
 * bloqueado devuelve `ok: false`, `get_agent_bundle` de una entidad sin publicar devuelve
 * `published: false`, `get_agent_asset` de una ruta que no está devuelve `found: false`—. Eso llega acá
 * como `ok: true` con `data` puesto: **el llamador tiene que mirar `data`**, no `ok` a secas.
 */
function beaos_aos_rpc_read( $decoded ) {
	if ( ! is_array( $decoded ) ) {
		return beaos_aos_rpc_result( false, 'protocol', 0, 'La respuesta del MCP no es un objeto JSON-RPC.' );
	}
	if ( isset( $decoded['error'] ) && is_array( $decoded['error'] ) ) {
		$code = isset( $decoded['error']['code'] ) ? (int) $decoded['error']['code'] : 0;
		$text = isset( $decoded['error']['message'] ) && is_string( $decoded['error']['message'] )
			? trim( $decoded['error']['message'] )
			: '';
		// El mensaje del servidor manda: ya viene en castellano y dice qué hacer.
		$error = '' !== $text ? $text : beaos_aos_rpc_error_message( $code );
		return beaos_aos_rpc_result( false, 'protocol', $code, $error );
	}
	if ( ! array_key_exists( 'result', $decoded ) ) {
		return beaos_aos_rpc_result( false, 'protocol', 0, 'La respuesta no trae ni `result` ni `error`.' );
	}

	$result = is_array( $decoded['result'] ) ? $decoded['result'] : array();
	$text   = '';
	if ( isset( $result['content'][0]['text'] ) && is_string( $result['content'][0]['text'] ) ) {
		$text = $result['content'][0]['text'];
	}
	$data = array_key_exists( 'structuredContent', $result ) ? $result['structuredContent'] : null;

	if ( ! empty( $result['isError'] ) ) {
		return beaos_aos_rpc_result(
			false,
			'tool',
			0,
			'' !== trim( $text ) ? $text : 'El tool falló y no dijo por qué.',
			$text,
			$data,
			$result
		);
	}
	return beaos_aos_rpc_result( true, 'ok', 0, '', $text, $data, $result );
}

/** La forma de una lectura del MCP. Un solo lugar, para que el test compare una sola cosa. */
function beaos_aos_rpc_result( $ok, $kind, $code = 0, $error = '', $text = '', $data = null, $result = null ) {
	return array(
		'ok'     => (bool) $ok,
		'kind'   => (string) $kind,
		'code'   => (int) $code,
		'error'  => (string) $error,
		'text'   => (string) $text,
		'data'   => $data,
		'result' => $result,
	);
}

/**
 * El motivo, en castellano, de un status HTTP de error. Un `401` es token; un `429` es espera; un
 * cuerpo que no es JSON es un proxy en el medio (pasó de verdad: Cloudflare reescribiendo la
 * respuesta). Vacío cuando el status no es un error.
 */
function beaos_aos_http_error( $status, $body = '', $retry_after = 0 ) {
	$status = (int) $status;
	if ( $status < 400 ) {
		return '';
	}
	$decoded = is_string( $body ) && '' !== trim( $body ) ? json_decode( $body, true ) : null;
	$message = is_array( $decoded ) && isset( $decoded['message'] ) && is_string( $decoded['message'] )
		? trim( $decoded['message'] )
		: '';
	$extra = '' !== $message ? ' ' . $message : '';

	if ( 401 === $status ) {
		return 'El token no entra:' . ( '' !== $extra ? $extra : ' falta, es inválido o fue revocado.' );
	}
	if ( 403 === $status ) {
		return 'BeAOS rechazó el pedido (403).' . $extra;
	}
	if ( 404 === $status ) {
		return 'La ruta no existe en BeAOS (404).' . $extra;
	}
	if ( 405 === $status ) {
		return 'BeAOS no acepta ese método en esa ruta (405): el MCP sólo responde POST.';
	}
	if ( 429 === $status ) {
		$espera = (int) $retry_after;
		return 'BeAOS está limitando los pedidos (429).' . ( $espera > 0 ? ' Reintentá en ' . $espera . ' segundos.' : ' Reintentá en un rato.' );
	}
	if ( $status >= 500 ) {
		return 'BeAOS respondió ' . $status . ' (problema del servidor).' . $extra;
	}
	return 'BeAOS respondió ' . $status . '.' . $extra;
}

/**
 * El `Retry-After` de una respuesta, en segundos. Acepta las dos formas del estándar: los segundos
 * ("120") y la fecha HTTP ("Wed, 21 Oct 2026 07:28:00 GMT"). Sin dato utilizable, devuelve el respaldo.
 *
 * Hoy el MCP **no** emite 429: no hay rate limiting en esa ruta. Se maneja igual, por las dudas: el día
 * que exista, esto ya está.
 */
function beaos_aos_retry_after( $value, $fallback = 0 ) {
	$fallback = max( 0, (int) $fallback );
	$value    = is_string( $value ) ? trim( $value ) : '';
	if ( '' === $value ) {
		return $fallback;
	}
	if ( ctype_digit( $value ) ) {
		return (int) $value;
	}
	$when = strtotime( $value );
	if ( false === $when ) {
		return $fallback;
	}
	return max( 0, $when - time() );
}

// ── Rutas del kit ───────────────────────────────────────────────────────────────────────────────

/** El path de una request, sin query. `REQUEST_URI` puede venir como URL absoluta en algunos proxies. */
function beaos_aos_request_path( $request_uri ) {
	$path = parse_url( (string) $request_uri, PHP_URL_PATH );
	return is_string( $path ) && '' !== $path ? $path : '/';
}

/**
 * El path del kit, ya sin el prefijo de una instalación en subdirectorio.
 *
 * El kit vive en la **raíz del dominio** (`/.well-known/*`, `/llms.txt`): es donde lo buscan los
 * agentes. Un WordPress instalado en `/blog/` recibe la request como `/blog/llms.txt`, así que el
 * prefijo se descuenta; si no, un sitio en subdirectorio no puede servir su kit nunca.
 */
function beaos_aos_route_path( $request_uri, $home_path = '/' ) {
	$path      = beaos_aos_request_path( $request_uri );
	$home_path = '/' . trim( (string) $home_path, '/' );
	if ( '/' !== $home_path && 0 === strpos( $path, $home_path . '/' ) ) {
		$path = substr( $path, strlen( $home_path ) );
	}
	return $path;
}

// ── La lista blanca de rutas ────────────────────────────────────────────────────────────────────
//
// El manifiesto es la **única** fuente de verdad de qué sirve el plugin, así que sin lista blanca
// cualquier ruta del manifiesto se sirve. Y el enganche es `init` con prioridad 0: una entrada para
// `/wp-login.php` le gana al core y **tapa la pantalla de login** (probado en el WordPress local:
// 66 B del señuelo en lugar de los 10.098 B del login). No hace falta un atacante: un bug en el
// generador que emita una ruta de más deja al cliente sin poder entrar a su WordPress.
//
// La regla es la **forma del kit**, no la lista de los archivos de hoy:
//
//   1. los archivos fijos que el kit publica **en la raíz** —lista exacta, y por qué exacta: en la
//      raíz viven `wp-login.php`, `wp-config.php` e `index.php`, y ninguna forma (extensión,
//      cantidad de segmentos) distingue un asset del kit de un archivo del core salvo el nombre—;
//   2. **todo lo que cuelga de `/.well-known/`** (RFC 8615), que es donde el kit pone sus diez
//      archivos de descubrimiento; el prefijo es lo que hace que un asset nuevo (una spec nueva, una
//      firma nueva) se sirva **sin tocar el plugin**.
//
// Nada más. Ni `/wp-admin`, ni `/wp-login.php`, ni `/wp-config.php`, ni `/wp-json`, ni `/index.php`,
// ni ningún `.php`, ni ningún HTML suelto de la raíz.
//
// Segunda capa, a propósito y no porque la primera falle: `beaos_aos_denied_path()` rechaza de forma
// **explícita** lo peligroso conocido y todo `.php`, antes de mirar la forma. Si algún día alguien
// afloja la forma (por ejemplo "cualquier archivo de la raíz"), esto sigue en pie.
//
// La lista no puede desincronizarse del generador: `tests/pure.php` lee
// `packages/aos-aps/src/assets/generate.ts` y falla si el kit emite una ruta que esta lista blanca
// rechazaría. El día que el generador agregue un asset en la raíz, el test lo dice.

/** Los archivos fijos que el kit publica en la raíz. Es lo que el generador emite hoy, sin inventar. */
const BEAOS_AOS_ROOT_PATHS = array(
	'/llms.txt',
	'/llms-full.txt',
	'/AGENTS.md',
	'/robots.txt',
	'/sitemap.xml',
);

/** El prefijo del descubrimiento. Todo lo que cuelga de acá es del kit, por convención. */
const BEAOS_AOS_WELL_KNOWN = '/.well-known/';

/**
 * El tope de largo de una ruta del kit. Espejo de `KIT_PATH_MAX_LENGTH` de
 * `packages/aos-aps/src/assets/kit-routes.ts`: la sección 14 de `tests/pure.php` compara los dos números
 * y falla si se despegan.
 */
const BEAOS_AOS_PATH_MAX = 256;

/**
 * Las rutas peligrosas conocidas. La regla del `.php` ya las cubre casi todas; están igual porque una
 * lista explícita se lee y se audita, y porque es la capa que no depende de que la forma siga bien.
 */
const BEAOS_AOS_DENIED_PATHS = array(
	'/wp-admin',
	'/wp-login.php',
	'/wp-config.php',
	'/wp-config-sample.php',
	'/wp-json',
	'/wp-content',
	'/wp-includes',
	'/index.php',
	'/xmlrpc.php',
	'/wp-cron.php',
	'/wp-settings.php',
	'/wp-load.php',
	'/wp-blog-header.php',
	'/wp-signup.php',
	'/wp-activate.php',
	'/wp-mail.php',
	'/wp-trackback.php',
	'/wp-comments-post.php',
	'/wp-links-opml.php',
	'/readme.html',
	'/.htaccess',
	'/.env',
);

/**
 * ¿Esta ruta está en la lista explícita de lo prohibido? Sí para todo `.php` (sin importar dónde
 * cuelgue, incluido `/.well-known/`) y para las rutas del core y del panel, con o sin barra final.
 */
function beaos_aos_denied_path( $path ) {
	$path = strtolower( (string) $path );
	if ( '' === $path ) {
		return false;
	}
	if ( '.php' === substr( $path, -4 ) ) {
		return true;
	}
	foreach ( BEAOS_AOS_DENIED_PATHS as $denied ) {
		if ( $path === $denied || 0 === strpos( $path, $denied . '/' ) ) {
			return true;
		}
	}
	return false;
}

/**
 * Por qué una ruta **no** se puede reclamar, o `''` si sí se puede. Un solo lugar decide, y el motivo
 * es el que ven el panel y el log: el que rechaza una ruta tiene que poder decir cuál y por qué.
 *
 * El orden importa: primero las guardas de forma (absoluta, sin `..`, larga y con el juego de
 * caracteres que usa el kit), después lo prohibido explícito, y recién al final la forma del kit. Así
 * un `/.well-known/algo.php` no se salva por colgar de `.well-known/`.
 */
function beaos_aos_rejection_reason( $path ) {
	$path = (string) $path;

	if ( '' === $path || '/' === $path ) {
		return 'no es la ruta de un archivo';
	}
	if ( '/' !== substr( $path, 0, 1 ) ) {
		return 'no es una ruta absoluta';
	}
	if ( false !== strpos( $path, '..' ) ) {
		return 'tiene ..';
	}
	if ( strlen( $path ) > BEAOS_AOS_PATH_MAX ) {
		return 'es más larga que ' . BEAOS_AOS_PATH_MAX . ' caracteres';
	}
	if ( ! preg_match( '#^/[A-Za-z0-9._/-]+$#', $path ) ) {
		return 'tiene caracteres que ninguna ruta del kit usa';
	}
	if ( beaos_aos_denied_path( $path ) ) {
		return 'está en la lista de rutas prohibidas';
	}
	if ( in_array( $path, BEAOS_AOS_ROOT_PATHS, true ) ) {
		return '';
	}
	if ( 0 === strpos( $path, BEAOS_AOS_WELL_KNOWN ) && strlen( $path ) > strlen( BEAOS_AOS_WELL_KNOWN ) ) {
		return '';
	}
	return 'no tiene forma de kit';
}

/** ¿Esta ruta es de las que el kit puede reclamar? Sí sólo si tiene forma de kit y no está prohibida. */
function beaos_aos_claimable_path( $path ) {
	return '' === beaos_aos_rejection_reason( $path );
}

/**
 * Las rutas guardadas en la copia local que la lista blanca ya **no** acepta. Debería ser siempre
 * vacío; no lo es cuando la opción quedó envenenada (una versión vieja del plugin, o alguien que la
 * escribió a mano). Se calcula para poder decirlo en el panel: el plugin las ignora al servir, pero
 * que se vean es la mitad del arreglo.
 */
function beaos_aos_rejected_assets( $assets ) {
	$out = array();
	if ( ! is_array( $assets ) ) {
		return $out;
	}
	foreach ( array_keys( $assets ) as $path ) {
		if ( ! beaos_aos_claimable_path( $path ) ) {
			$out[] = (string) $path;
		}
	}
	return $out;
}

// ── El candado del sync ─────────────────────────────────────────────────────────────────────────
//
// Dos corridas del sync no pueden pisarse. La versión anterior lo intentaba con
// `get_transient()` + `set_transient()`, y **eso no es un candado**: entre el `get` y el `set` hay una
// ventana en la que las dos corridas leen "libre". Medido: con dos sync en paralelo, el MCP recibía 1
// llamada o 2, según el timing.
//
// Lo que se usa ahora: una **opción** (`wp_options`) tomada con un `INSERT IGNORE` y soltada con un
// `DELETE` condicional. Por qué eso sí es atómico: `wp_options.option_name` tiene **índice único** en
// el esquema de WordPress, así que de N `INSERT` simultáneos con el mismo nombre **uno solo** inserta
// una fila; los demás chocan con la restricción y `INSERT IGNORE` los convierte en "0 filas" en vez de
// un error. La decisión la toma el motor de la base, no el código PHP, y por eso no hay ventana.
//
// **`add_option()` no sirve para esto**, aunque el folclore diga que devuelve `false` si la opción ya
// existe. Medido en el WordPress de este repo (7.1.2): `add_option()` usa
// `INSERT ... ON DUPLICATE KEY UPDATE`, así que (a) el chequeo previo es TOCTOU igual que el transient
// y (b) el que llega segundo **sobrescribe** al primero y devuelve `true`. Diez procesos sincronizados
// con `add_option()` sobre la misma opción: **nueve** contestaron que sí.
//
// El valor guardado es el **vencimiento** (epoch en segundos), no un `1`. De ahí salen las dos
// propiedades que hacen falta:
//
//   - **Vence**: un proceso que murió (o un PHP colgado) deja la fila, pero la fila dice hasta cuándo
//     vale. Pasado ese instante, el siguiente que llega la borra y la vuelve a tomar. Un candado sin
//     vencimiento dejaría el cron muerto para siempre; por eso `BEAOS_AOS_LOCK_TTL` no es opcional.
//   - **Se puede soltar sin robar**: el `DELETE` dice `WHERE option_name = ... AND option_value = <el
//     vencimiento que yo escribí>`. Como cada toma escribe un vencimiento **estrictamente mayor** que
//     el anterior (una toma solo ocurre después de que el anterior venció, así que
//     `nuevo = ahora + ttl > viejo_vencimiento`), el que perdió el candado por vencimiento no puede
//     borrar el de otro al volver de un `finally` tardío.
//
// Acá van sólo las dos funciones puras: el valor y si venció. La parte que toca la base vive en
// `beaos-aos.php` (`beaos_aos_lock_acquire()` / `beaos_aos_lock_release()`), porque un archivo puro no
// puede hablar con la base: el test lo verifica y no se toca.

/**
 * El valor que se guarda en el candado: cuándo vence, en segundos epoch. Un TTL de 0 o negativo se
 * sube a 1 segundo: un candado que vence en el mismo instante en que se toma no es un candado.
 */
function beaos_aos_lock_value( $now, $ttl ) {
	return (string) ( (int) $now + max( 1, (int) $ttl ) );
}

/**
 * ¿El candado guardado ya venció? Un valor vacío, ilegible o no numérico cuenta como **vencido**: la
 * alternativa (tratarlo como vigente) dejaría el cron trabado para siempre por una fila corrupta, que
 * es exactamente el modo de falla que el vencimiento existe para evitar.
 */
function beaos_aos_lock_is_expired( $stored, $now ) {
	return (int) trim( (string) $stored ) <= (int) $now;
}

// ── La copia local del kit ──────────────────────────────────────────────────────────────────────
//
// Un asset guardado es `{ type, sha256, body }`, con el cuerpo en base64: la tabla de opciones de
// WordPress es texto y un `text/plain` con bytes altos se corrompería. Es el criterio de Autex, y el
// comentario de allá lo dice mejor: "base64: la base no toca un solo byte".

/** ¿El asset que ya está guardado es el mismo que declara el manifiesto? Se decide sin bajarlo. */
function beaos_aos_asset_is_unchanged( array $entry, $previous ) {
	$sha = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
	if ( '' === $sha || ! is_array( $previous ) ) {
		return false;
	}
	return isset( $previous['sha256'] ) && strtolower( (string) $previous['sha256'] ) === $sha;
}

/**
 * Qué hacer con un asset del manifiesto: `skip` (la entrada no sirve), `keep` (ya está y no cambió),
 * `reject` (llegó y no verifica) o `store`.
 *
 * Se llama dos veces en la misma corrida, y es a propósito:
 *   1. con `$body = null`, para saber si hay que bajarlo — `keep` = no bajar, `skip` = ignorar, y
 *      cualquier otra cosa = bajarlo;
 *   2. con el cuerpo ya bajado, para decidir si se guarda.
 *
 * Un asset que no da su sha256 o su largo **no se guarda**: mejor un 404 que servir algo que rompe la
 * firma Ed25519.
 */
function beaos_aos_asset_decision( array $entry, $body, $previous = null ) {
	$path = isset( $entry['path'] ) ? (string) $entry['path'] : '';
	$sha  = isset( $entry['sha256'] ) ? strtolower( (string) $entry['sha256'] ) : '';
	$type = isset( $entry['type'] ) ? trim( (string) $entry['type'] ) : '';

	if ( ! beaos_aos_claimable_path( $path ) ) {
		// `skip` = se ignora esa entrada y el resto del kit sigue: una ruta mala no puede tumbar el kit
		// entero. El motivo viaja al panel y al log (ver `beaos_aos_log_rejected_route()`).
		return beaos_aos_decision( 'skip', beaos_aos_rejection_reason( $path ) );
	}
	if ( ! preg_match( '/^[a-f0-9]{64}$/', $sha ) ) {
		return beaos_aos_decision( 'skip', 'el manifiesto no trae un sha256 legible' );
	}
	if ( '' === $type ) {
		return beaos_aos_decision( 'skip', 'el manifiesto no trae content-type' );
	}
	if ( beaos_aos_asset_is_unchanged( $entry, $previous ) ) {
		return beaos_aos_decision( 'keep', '' );
	}
	if ( null === $body ) {
		return beaos_aos_decision( 'reject', 'todavía no se bajó' );
	}
	if ( ! hash_equals( $sha, hash( 'sha256', $body ) ) ) {
		return beaos_aos_decision( 'reject', 'el sha256 no coincide' );
	}
	if ( isset( $entry['bytes'] ) && strlen( $body ) !== (int) $entry['bytes'] ) {
		return beaos_aos_decision( 'reject', 'el largo no coincide con el manifiesto' );
	}
	return beaos_aos_decision( 'store', '' );
}

function beaos_aos_decision( $action, $reason ) {
	return array(
		'action' => (string) $action,
		'reason' => (string) $reason,
	);
}

/**
 * Los bytes de un asset guardado, re-verificados contra su sha256, o `null`.
 *
 * Se re-verifica **en cada request** y no sólo al guardar: si la opción se corrompió en la base, el
 * plugin prefiere no servir nada (y dejar que WordPress haga lo suyo) antes que mandar bytes que ya no
 * son los firmados.
 */
function beaos_aos_stored_asset( $stored ) {
	if ( ! is_array( $stored ) ) {
		return null;
	}
	$type = isset( $stored['type'] ) ? trim( (string) $stored['type'] ) : '';
	$sha  = isset( $stored['sha256'] ) ? strtolower( (string) $stored['sha256'] ) : '';
	$raw  = isset( $stored['body'] ) ? (string) $stored['body'] : '';
	if ( '' === $type || '' === $sha || '' === $raw ) {
		return null;
	}
	$body = base64_decode( $raw, true );
	if ( false === $body || ! hash_equals( $sha, hash( 'sha256', $body ) ) ) {
		return null;
	}
	return array(
		'type'   => $type,
		'sha256' => $sha,
		'body'   => $body,
	);
}

/** Un asset del kit tal como se guarda: el tipo, el sha256 y los bytes en base64. */
function beaos_aos_stored_from_body( array $entry, $body ) {
	return array(
		'type'   => trim( (string) ( $entry['type'] ?? '' ) ),
		'sha256' => strtolower( (string) ( $entry['sha256'] ?? '' ) ),
		'body'   => base64_encode( (string) $body ),
	);
}

/**
 * La forma de la opción del kit. Un solo lugar, para que el que guarda y el que lee no se despeguen.
 *
 * `state` es la diferencia con Autex y vale la pena: "la entidad todavía no está publicada en BeAOS"
 * **no es un error**, es un estado, y el panel tiene que poder decir la verdad en vez de mostrar un
 * fallo rojo por algo que está bien.
 */
function beaos_aos_bundle( array $assets, $bundle_sha256, $synced_ts, $state, $error = '' ) {
	return array(
		'bundle_sha256' => (string) $bundle_sha256,
		'synced_at'     => $synced_ts > 0 ? gmdate( 'c', (int) $synced_ts ) : '',
		'synced_ts'     => (int) $synced_ts,
		'state'         => (string) $state,
		'error'         => (string) $error,
		'assets'        => $assets,
	);
}

/**
 * El mensaje de los archivos descartados en una corrida, acotado: un manifiesto con cientos de rutas
 * malas no puede inflar la opción del kit con un texto sin fin. Los primeros se nombran, el resto se
 * cuenta.
 */
function beaos_aos_discarded_message( array $bad, $max = 10 ) {
	$max = max( 1, (int) $max );
	if ( ! $bad ) {
		return '';
	}
	$shown = array_slice( $bad, 0, $max );
	$resto = count( $bad ) - count( $shown );
	return 'descartados: ' . implode( ', ', $shown ) . ( $resto > 0 ? ', y ' . $resto . ' más' : '' );
}

/**
 * ¿Hay que sincronizar? Sí cuando nunca se sincronizó, cuando lo último que hay no dice cuándo, o
 * cuando pasó el TTL. Sirve para no gastar un request al MCP justo después de un sync.
 */
function beaos_aos_bundle_is_stale( $bundle, $now, $ttl ) {
	if ( ! is_array( $bundle ) || ! isset( $bundle['synced_ts'] ) ) {
		return true;
	}
	$when = (int) $bundle['synced_ts'];
	if ( $when <= 0 ) {
		return true;
	}
	return ( (int) $now - $when ) >= max( 0, (int) $ttl );
}

// ── Ajustes ─────────────────────────────────────────────────────────────────────────────────────
//
// El saneo vive acá y no en el `sanitize_callback` para poder probarlo: el callback de WordPress sólo
// le pasa un `sanitize_text_field()` por encima a lo que sale de acá.

/** Fuerza https, deja el host en minúscula y no deja barra final. Sin host usable, vacío. */
function beaos_aos_normalize_https( $url ) {
	$url   = trim( (string) $url );
	$parts = '' === $url ? false : parse_url( $url );
	if ( ! is_array( $parts ) || empty( $parts['host'] ) ) {
		return '';
	}
	$host = strtolower( (string) $parts['host'] );
	$port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
	$path = isset( $parts['path'] ) ? rtrim( (string) $parts['path'], '/' ) : '';
	return 'https://' . $host . $port . $path;
}

/** La web de la marca: sin esquema se asume https, y se conserva la ruta. */
function beaos_aos_normalize_website( $website ) {
	$website = trim( (string) $website );
	if ( '' === $website ) {
		return '';
	}
	if ( ! preg_match( '#^https?://#i', $website ) ) {
		$website = 'https://' . ltrim( $website, '/' );
	}
	return beaos_aos_normalize_https( $website );
}

/**
 * El host de una web, sin `www.` y en minúscula. Es **el mismo criterio** que `hostOf` del servidor
 * (`apps/web/src/lib/report-agent.ts`), y no puede divergir: ese host es la clave de idempotencia de
 * `ensure_brand`, así que si el plugin normalizara distinto daría de alta dos marcas para la misma web.
 *
 * El orden importa: primero minúscula y después sacar el `www.`. Al revés, un `WWW.Acme.com` —que es lo
 * que escribe una persona— se quedaría con el `www.` puesto y daría un host distinto al del servidor.
 */
function beaos_aos_host_of( $website ) {
	$website = trim( (string) $website );
	if ( '' === $website ) {
		return '';
	}
	if ( ! preg_match( '#^https?://#i', $website ) ) {
		$website = 'https://' . ltrim( $website, '/' );
	}
	$host = parse_url( $website, PHP_URL_HOST );
	if ( ! is_string( $host ) || '' === $host ) {
		return '';
	}
	return preg_replace( '/^www\./', '', strtolower( $host ) );
}

/**
 * Los ajustes saneados: un array cerrado de claves, sin nada que no esté en la lista.
 *
 * El token se pinta vacío en la pantalla y **un vacío al guardar conserva el guardado**: es la única
 * forma de que la llave no viaje al navegador y siga siendo editable el resto. Es el criterio de Autex.
 */
function beaos_aos_settings( array $in, array $previous ) {
	$token = isset( $in['token'] ) ? trim( (string) $in['token'] ) : '';
	$mcp   = isset( $in['mcp'] ) ? beaos_aos_normalize_https( $in['mcp'] ) : '';
	$api   = isset( $in['api'] ) ? beaos_aos_normalize_https( $in['api'] ) : '';
	$d     = beaos_aos_defaults();

	return array(
		'enabled'   => empty( $in['enabled'] ) ? 0 : 1,
		'token'     => '' === $token ? (string) ( $previous['token'] ?? '' ) : $token,
		'brand_id'  => isset( $in['brand_id'] ) ? trim( (string) $in['brand_id'] ) : '',
		'entity_id' => isset( $in['entity_id'] ) ? trim( (string) $in['entity_id'] ) : '',
		'name'      => isset( $in['name'] ) ? trim( (string) $in['name'] ) : '',
		'website'   => beaos_aos_normalize_website( $in['website'] ?? '' ),
		'category'  => isset( $in['category'] ) ? trim( (string) $in['category'] ) : '',
		'mcp'       => '' !== $mcp ? $mcp : $d['mcp'],
		'api'       => '' !== $api ? $api : $d['api'],
	);
}

/**
 * ¿El asistente puede dar el paso 3? Faltan el token o la entidad, y sin esos dos no hay a quién
 * pedirle el kit. Devuelve la lista de lo que falta, vacía cuando está todo.
 */
function beaos_aos_missing( array $settings ) {
	$missing = array();
	if ( '' === trim( (string) ( $settings['token'] ?? '' ) ) ) {
		$missing[] = 'el token';
	}
	if ( '' === trim( (string) ( $settings['entity_id'] ?? '' ) ) ) {
		$missing[] = 'el entityId';
	}
	return $missing;
}
