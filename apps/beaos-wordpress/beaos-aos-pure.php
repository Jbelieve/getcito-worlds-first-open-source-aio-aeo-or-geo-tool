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
const BEAOS_AOS_LOCK   = 'beaos_aos_lock';              // transient: una corrida de sync por vez
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

/**
 * ¿Esta ruta es de las que el kit puede reclamar? La raíz no, una ruta relativa tampoco, y una con `..`
 * menos: el manifiesto sólo trae rutas absolutas y esa es la única fuente de verdad.
 */
function beaos_aos_claimable_path( $path ) {
	$path = (string) $path;
	if ( '' === $path || '/' === $path ) {
		return false;
	}
	if ( '/' !== substr( $path, 0, 1 ) ) {
		return false;
	}
	if ( false !== strpos( $path, '..' ) ) {
		return false;
	}
	return strlen( $path ) <= 256;
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
		return beaos_aos_decision( 'skip', 'la ruta no es servible' );
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
