<?php
/**
 * El test de la parte pura del plugin de BeAOS.
 *
 * Sin WordPress, sin base y sin red: se corre con un `php` pelado.
 *
 *     php apps/beaos-wordpress/tests/pure.php
 *
 * Prueba lo que decide cosas: el sobre y la lectura del JSON-RPC del MCP, el motivo de un status HTTP,
 * el `Retry-After`, la ruta de una request, la verificación de un asset del kit, el vencimiento y el
 * saneo de los ajustes. Y dos guardas de contrato que son las que más van a servir con el tiempo:
 * que el archivo puro no llame a **ninguna** función de WordPress (si no, deja de ser probable), y que
 * todo tool que el plugin llame esté documentado en `MCP-BEAOS.md`.
 *
 * Sale 0 si pasa y 1 si falla. Es el estilo de los tests del plugin de Autex: `check()`, contador y
 * `exit( $fail )`.
 *
 * Definir `ABSPATH` es lo único que hace falta para incluir el archivo puro: la guarda de acceso
 * directo está en todos los archivos del plugin, y una constante no es WordPress.
 */

define( 'ABSPATH', __DIR__ );

$fail = 0;

function check( $ok, $what ) {
	global $fail;
	if ( $ok ) {
		echo "  ok    $what\n";
		return true;
	}
	$fail++;
	echo "  FALLA $what\n";
	return false;
}

/** Un valor en una línea, para que el mensaje de un fallo se lea. */
function beaos_aos_short( $value ) {
	if ( is_array( $value ) ) {
		return 'array(' . count( $value ) . ')';
	}
	if ( is_string( $value ) ) {
		$value = str_replace( "\n", '\n', $value );
		return "'" . ( strlen( $value ) > 60 ? substr( $value, 0, 57 ) . '…' : $value ) . "'";
	}
	return var_export( $value, true );
}

function check_same( $expected, $actual, $what ) {
	return check(
		$expected === $actual,
		$what . ' (esperado ' . beaos_aos_short( $expected ) . ', salió ' . beaos_aos_short( $actual ) . ')'
	);
}

require dirname( __DIR__ ) . '/beaos-aos-pure.php';

$pure = dirname( __DIR__ ) . '/beaos-aos-pure.php';
$main = dirname( __DIR__ ) . '/beaos-aos.php';

// ── 1 · Las constantes y la forma de los ajustes ────────────────────────────────────────────────
echo "1 · constantes y ajustes\n";

check_same( 'beaos_aos', BEAOS_AOS_OPTION, 'la opción de los ajustes' );
check_same( 'beaos_aos_bundle', BEAOS_AOS_BUNDLE, 'la opción de la copia del kit' );
check_same( 'beaos_aos_sync', BEAOS_AOS_CRON, 'el hook del cron' );
check_same( 'https://beaos.believe-global.com/mcp', BEAOS_AOS_MCP, 'el endpoint del MCP (el que documenta MCP-BEAOS.md)' );

$defaults = beaos_aos_defaults();
check_same(
	array( 'enabled', 'token', 'brand_id', 'entity_id', 'name', 'website', 'category', 'mcp', 'api' ),
	array_keys( $defaults ),
	'los ajustes tienen exactamente las claves que se guardan'
);
check_same( '', $defaults['token'], 'el token arranca vacío' );
check( BEAOS_AOS_TTL > 0 && BEAOS_AOS_LOCK_TTL > 0 && BEAOS_AOS_MAX_ASSETS > 0, 'los topes son números positivos' );

// ── 2 · El sobre JSON-RPC ───────────────────────────────────────────────────────────────────────
echo "2 · el sobre JSON-RPC\n";

check_same(
	array(
		'jsonrpc' => '2.0',
		'id'      => 7,
		'method'  => 'tools/list',
	),
	beaos_aos_rpc( 7, 'tools/list' ),
	'sin params, el sobre no lleva la clave params'
);

$con_args = json_encode( beaos_aos_rpc_tool( 2, 'get_agent_asset', array( 'entityId' => 'x', 'path' => '/llms.txt' ) ) );
check_same( true, false !== strpos( $con_args, '"method":"tools\/call"' ) || false !== strpos( $con_args, '"method":"tools/call"' ), 'un tools/call va con el método tools/call' );
check_same( true, false !== strpos( $con_args, '"name":"get_agent_asset"' ), 'el tools/call lleva el nombre del tool' );
check_same( true, false !== strpos( $con_args, '"arguments":{"entityId":"x","path":"\/llms.txt"}' ) || false !== strpos( $con_args, '"arguments":{"entityId":"x","path":"/llms.txt"}' ), 'los arguments viajan como objeto' );

// El caso que rompe de verdad: `arguments` vacío tiene que serializar `{}` y no `[]`, porque
// `params.arguments` es un registro y un array lo rechaza con -32602.
$sin_args = json_encode( beaos_aos_rpc_tool( 3, 'get_agent_bundle', array() ) );
check_same( true, false !== strpos( $sin_args, '"arguments":{}' ), 'un arguments vacío serializa {} y no []' );

// ── 3 · La lectura de la respuesta ──────────────────────────────────────────────────────────────
echo "3 · la lectura de la respuesta\n";

$ok = beaos_aos_rpc_read(
	array(
		'jsonrpc' => '2.0',
		'id'      => 2,
		'result'  => array(
			'content'           => array( array( 'type' => 'text', 'text' => "# llms.txt\n" ) ),
			'structuredContent' => array( 'path' => '/llms.txt', 'type' => 'text/plain', 'sha256' => 'ab' ),
		),
	)
);
check_same( true, $ok['ok'], 'una respuesta buena da ok' );
check_same( 'ok', $ok['kind'], 'y su kind es ok' );
check_same( "# llms.txt\n", $ok['text'], 'el texto sale de content[0].text' );
check_same( 'text/plain', $ok['data']['type'], 'el dato sale de structuredContent' );

$tool_error = beaos_aos_rpc_read(
	array( 'result' => array( 'content' => array( array( 'type' => 'text', 'text' => 'Falta "entityId".' ) ), 'isError' => true ) )
);
check_same( false, $tool_error['ok'], 'un tool que falla no da ok' );
check_same( 'tool', $tool_error['kind'], 'y su kind es tool, no protocol' );
check_same( 'Falta "entityId".', $tool_error['error'], 'el motivo del tool se muestra tal cual' );

$tool_error_mudo = beaos_aos_rpc_read( array( 'result' => array( 'content' => array(), 'isError' => true ) ) );
check_same( true, '' !== $tool_error_mudo['error'], 'un tool que falla sin texto igual dice algo' );

$protocolo = beaos_aos_rpc_read(
	array( 'error' => array( 'code' => -32602, 'message' => 'No existe el tool "x". Disponibles: a, b.' ) )
);
check_same( false, $protocolo['ok'], 'un error de protocolo no da ok' );
check_same( 'protocol', $protocolo['kind'], 'y su kind es protocol' );
check_same( -32602, $protocolo['code'], 'el code viaja' );
check_same( 'No existe el tool "x". Disponibles: a, b.', $protocolo['error'], 'el mensaje del servidor manda' );

$sin_mensaje = beaos_aos_rpc_read( array( 'error' => array( 'code' => -32700 ) ) );
check_same( beaos_aos_rpc_error_message( -32700 ), $sin_mensaje['error'], 'sin mensaje, se usa la tabla de códigos' );

check_same( 'protocol', beaos_aos_rpc_read( array( 'id' => 1, 'jsonrpc' => '2.0' ) )['kind'], 'una respuesta sin result ni error es un error de protocolo' );
check_same( 'protocol', beaos_aos_rpc_read( null )['kind'], 'una respuesta que no es un objeto es un error de protocolo' );

check_same( 'El cuerpo no es JSON válido.', beaos_aos_rpc_error_message( -32700 ), 'el texto del -32700' );
check_same( 'El método no existe en el MCP.', beaos_aos_rpc_error_message( -32601 ), 'el texto del -32601' );
check_same( true, '' !== beaos_aos_rpc_error_message( 12345 ), 'un código desconocido igual tiene texto' );

// ── 4 · El status HTTP y el Retry-After ─────────────────────────────────────────────────────────
echo "4 · el status HTTP y el Retry-After\n";

check_same( '', beaos_aos_http_error( 200 ), 'un 200 no es un error' );
check_same( true, false !== strpos( beaos_aos_http_error( 401, '{"error":"Unauthorized","message":"Invalid API key"}' ), 'Invalid API key' ), 'el 401 muestra el mensaje del servidor' );
check_same( true, false !== strpos( beaos_aos_http_error( 401, '' ), 'revocado' ), 'un 401 pelado habla de token faltante o revocado' );
check_same( true, false !== strpos( beaos_aos_http_error( 429, '', 120 ), '120 segundos' ), 'el 429 dice cuándo reintentar' );
check_same( true, false !== strpos( beaos_aos_http_error( 500, '' ), '500' ), 'el 5xx se nombra' );
check_same( true, false !== strpos( beaos_aos_http_error( 404, '' ), '404' ), 'el 404 se nombra' );
check_same( true, '' !== beaos_aos_http_error( 418, '' ), 'cualquier status de error tiene motivo' );

check_same( 120, beaos_aos_retry_after( '120' ), 'Retry-After en segundos' );
check_same( 45, beaos_aos_retry_after( '', 45 ), 'sin dato, el respaldo' );
check_same( 45, beaos_aos_retry_after( 'no es una fecha', 45 ), 'basura, el respaldo' );
$en_una_hora = time() + 60;
$fecha       = gmdate( 'D, d M Y H:i:s', $en_una_hora ) . ' GMT';
$leido       = beaos_aos_retry_after( $fecha, 0 );
check( $leido >= 55 && $leido <= 65, "Retry-After como fecha HTTP (salió $leido s, se esperaba ~60)" );

// ── 5 · Las rutas ───────────────────────────────────────────────────────────────────────────────
echo "5 · las rutas\n";

check_same( '/llms.txt', beaos_aos_request_path( '/llms.txt?v=2' ), 'la query se descarta' );
check_same( '/.well-known/brand.json', beaos_aos_request_path( 'https://x.com/.well-known/brand.json' ), 'una REQUEST_URI absoluta se resuelve igual' );
check_same( '/', beaos_aos_request_path( '' ), 'sin path, la raíz' );

check_same( '/llms.txt', beaos_aos_route_path( '/llms.txt', '/' ), 'en la raíz no se toca nada' );
check_same( '/llms.txt', beaos_aos_route_path( '/blog/llms.txt', '/blog' ), 'el prefijo de un WordPress en subdirectorio se descuenta' );
check_same( '/.well-known/brand.json', beaos_aos_route_path( '/blog/.well-known/brand.json', '/blog/' ), 'y también con la barra final' );
check_same( '/blog', beaos_aos_route_path( '/blog', '/blog' ), 'el prefijo pelado no se convierte en cadena vacía' );
check_same( '/', beaos_aos_route_path( '/blog/', '/blog' ), 'la raíz del subdirectorio queda en /' );

check_same( true, beaos_aos_claimable_path( '/llms.txt' ), 'una ruta absoluta es reclamable' );
check_same( true, beaos_aos_claimable_path( '/.well-known/brand.json' ), 'y una de .well-known también' );
check_same( false, beaos_aos_claimable_path( '/' ), 'la raíz no se reclama' );
check_same( false, beaos_aos_claimable_path( '' ), 'una ruta vacía tampoco' );
check_same( false, beaos_aos_claimable_path( 'llms.txt' ), 'una ruta relativa tampoco' );
check_same( false, beaos_aos_claimable_path( '/../wp-config.php' ), 'una ruta con .. tampoco' );
check_same( false, beaos_aos_claimable_path( '/' . str_repeat( 'a', 300 ) ), 'una ruta absurda tampoco' );

// ── 6 · La decisión sobre un asset ──────────────────────────────────────────────────────────────
echo "6 · la decisión sobre un asset\n";

$cuerpo = "# llms.txt\n\nHola.\n";
$bueno  = array(
	'path'   => '/llms.txt',
	'type'   => 'text/plain',
	'sha256' => hash( 'sha256', $cuerpo ),
	'bytes'  => strlen( $cuerpo ),
);

check_same( 'skip', beaos_aos_asset_decision( array_merge( $bueno, array( 'path' => 'llms.txt' ) ), $cuerpo )['action'], 'sin barra inicial se saltea' );
check_same( 'skip', beaos_aos_asset_decision( array_merge( $bueno, array( 'sha256' => 'corto' ) ), $cuerpo )['action'], 'un sha256 ilegible se saltea' );
check_same( 'skip', beaos_aos_asset_decision( array_merge( $bueno, array( 'type' => '' ) ), $cuerpo )['action'], 'sin content-type se saltea' );
check_same( 'store', beaos_aos_asset_decision( $bueno, $cuerpo )['action'], 'un asset que verifica se guarda' );

$guardado = array( 'type' => 'text/plain', 'sha256' => $bueno['sha256'], 'body' => base64_encode( $cuerpo ) );
check_same( 'keep', beaos_aos_asset_decision( $bueno, null, $guardado )['action'], 'sin cuerpo y con el mismo sha256, no hay que bajarlo' );
check_same( 'keep', beaos_aos_asset_decision( $bueno, $cuerpo, $guardado )['action'], 'y con el cuerpo, tampoco se vuelve a guardar' );
check_same( 'reject', beaos_aos_asset_decision( $bueno, null, null )['action'], 'sin cuerpo y sin copia previa, todavía no se puede guardar' );
check_same( 'reject', beaos_aos_asset_decision( $bueno, $cuerpo . 'x' )['action'], 'un sha256 que no coincide se descarta' );
check_same( 'reject', beaos_aos_asset_decision( array_merge( $bueno, array( 'bytes' => 999 ) ), $cuerpo )['action'], 'un largo que no coincide se descarta' );
check_same( 'el sha256 no coincide', beaos_aos_asset_decision( $bueno, 'otra cosa' )['reason'], 'y el motivo se dice' );

// ── 7 · El asset guardado, al servir ────────────────────────────────────────────────────────────
echo "7 · el asset guardado\n";

$servido = beaos_aos_stored_asset( $guardado );
check_same( $cuerpo, $servido['body'], 'el asset guardado se sirve byte a byte' );
check_same( 'text/plain', $servido['type'], 'con su content-type' );
check_same( $bueno['sha256'], $servido['sha256'], 'y con su sha256' );

check_same( null, beaos_aos_stored_asset( null ), 'sin copia no hay asset' );
check_same( null, beaos_aos_stored_asset( array( 'type' => '', 'sha256' => 'ab', 'body' => 'aa==' ) ), 'sin tipo no hay asset' );

// La copia que se corrompió en la base no se sirve: se re-verifica el sha256 en cada request.
$corrupto = array( 'type' => 'text/plain', 'sha256' => $bueno['sha256'], 'body' => base64_encode( $cuerpo . 'x' ) );
check_same( null, beaos_aos_stored_asset( $corrupto ), 'una copia que no verifica su sha256 no se sirve' );
check_same( null, beaos_aos_stored_asset( array( 'type' => 'text/plain', 'sha256' => $bueno['sha256'], 'body' => 'no es base64!!' ) ), 'un base64 roto no se sirve' );

$nuevo = beaos_aos_stored_from_body( $bueno, $cuerpo );
check_same( $guardado, $nuevo, 'lo que se guarda es lo que se vuelve a servir' );

// ── 8 · El vencimiento del kit ──────────────────────────────────────────────────────────────────
echo "8 · el vencimiento del kit\n";

$ahora = 1000000;
check_same( true, beaos_aos_bundle_is_stale( null, $ahora, 3600 ), 'sin copia, hay que sincronizar' );
check_same( true, beaos_aos_bundle_is_stale( array( 'assets' => array() ), $ahora, 3600 ), 'una copia sin fecha, también' );
check_same( true, beaos_aos_bundle_is_stale( beaos_aos_bundle( array(), '', 0, 'empty' ), $ahora, 3600 ), 'una copia nunca sincronizada, también' );
check_same( false, beaos_aos_bundle_is_stale( beaos_aos_bundle( array(), '', $ahora - 10, 'ok' ), $ahora, 3600 ), 'una copia de hace 10 s está fresca' );
check_same( true, beaos_aos_bundle_is_stale( beaos_aos_bundle( array(), '', $ahora - 4000, 'ok' ), $ahora, 3600 ), 'una de hace más del TTL está vencida' );
check_same( true, beaos_aos_bundle_is_stale( beaos_aos_bundle( array(), '', $ahora - 3600, 'ok' ), $ahora, 3600 ), 'justo en el TTL ya está vencida' );

$forma = beaos_aos_bundle( array( '/llms.txt' => $guardado ), 'abc', 1700000000, 'ok' );
check_same( 'abc', $forma['bundle_sha256'], 'la copia guarda el bundle_sha256' );
check_same( 1700000000, $forma['synced_ts'], 'la copia guarda el timestamp' );
check_same( gmdate( 'c', 1700000000 ), $forma['synced_at'], 'y su forma legible' );
check_same( '', $forma['error'], 'sin error por defecto' );

// ── 9 · Los ajustes ─────────────────────────────────────────────────────────────────────────────
echo "9 · los ajustes\n";

$previo = beaos_aos_defaults();
$previo['token'] = 'beaos_viejo';

$vacio = beaos_aos_settings( array(), $previo );
check_same( 'beaos_viejo', $vacio['token'], 'un token vacío al guardar conserva el guardado (no viaja al navegador)' );
check_same( BEAOS_AOS_MCP, $vacio['mcp'], 'sin endpoint, el MCP de BeAOS' );
check_same( BEAOS_AOS_API, $vacio['api'], 'sin base, la de BeAOS' );
check_same( 0, $vacio['enabled'], 'una casilla sin marcar deja el plugin apagado' );

$nuevo = beaos_aos_settings( array( 'token' => 'beaos_nuevo', 'token_extra' => 'x' ), $previo );
check_same( 'beaos_nuevo', $nuevo['token'], 'un token nuevo reemplaza al viejo' );
check_same( array_keys( beaos_aos_defaults() ), array_keys( $nuevo ), 'no entra ninguna clave que no esté en la lista' );

$limpio = beaos_aos_settings(
	array(
		'website'   => 'perez.com',
		'entity_id' => ' 8f1c-0000 ',
		'category'  => ' Automotriz ',
		'mcp'       => 'http://beaos.believe-global.com/mcp/',
		'enabled'   => '',
	),
	$previo
);
check_same( 'https://perez.com', $limpio['website'], 'sin esquema se asume https' );
check_same( '8f1c-0000', $limpio['entity_id'], 'el entityId se limpia de espacios' );
check_same( 'Automotriz', $limpio['category'], 'la categoría se limpia de espacios' );
check_same( 'https://beaos.believe-global.com/mcp', $limpio['mcp'], 'el endpoint se fuerza a https y sin barra final' );
check_same( 0, $limpio['enabled'], 'una casilla vacía apaga' );

check_same( 'acme.com', beaos_aos_host_of( 'https://WWW.Acme.com/algo' ), 'el host se normaliza como hostOf del servidor' );
check_same( 'acme.com', beaos_aos_host_of( 'acme.com' ), 'y sin esquema también' );
check_same( '', beaos_aos_host_of( '' ), 'sin web, sin host' );
check_same( '', beaos_aos_normalize_https( 'no es una url' ), 'una URL sin host no pasa' );

// ── 10 · Lo que falta para sincronizar ──────────────────────────────────────────────────────────
echo "10 · lo que falta\n";

check_same( 2, count( beaos_aos_missing( array( 'token' => '', 'entity_id' => '' ) ) ), 'sin token ni entityId faltan los dos' );
check_same( array( 'el entityId' ), beaos_aos_missing( array( 'token' => 'beaos_x', 'entity_id' => '' ) ), 'con token, sólo falta el entityId' );
check_same( array(), beaos_aos_missing( array( 'token' => 'beaos_x', 'entity_id' => '8f1c' ) ), 'con los dos, no falta nada' );

// ── 11 · La guarda que sostiene todo esto: el archivo puro es puro ──────────────────────────────
echo "11 · la separación de WordPress\n";

/**
 * Las funciones que llama un archivo PHP, leídas del tokenizador (los comentarios no cuentan: acá se
 * nombran funciones de WordPress todo el tiempo, y eso está bien).
 */
function beaos_aos_called_functions( $file ) {
	$source = file_get_contents( $file );
	if ( false === $source ) {
		return null;
	}
	$tokens = token_get_all( $source );
	$called = array();
	$total  = count( $tokens );
	for ( $i = 0; $i < $total; $i++ ) {
		$token = $tokens[ $i ];
		if ( ! is_array( $token ) || T_STRING !== $token[0] ) {
			continue;
		}
		$j = $i + 1;
		while ( $j < $total && is_array( $tokens[ $j ] ) && in_array( $tokens[ $j ][0], array( T_WHITESPACE, T_COMMENT, T_DOC_COMMENT ), true ) ) {
			$j++;
		}
		if ( $j < $total && '(' === $tokens[ $j ] ) {
			$called[] = $token[1];
		}
	}
	return array_values( array_unique( $called ) );
}

/** El código de un archivo sin comentarios ni espacios: para buscar contratos sin pisar la prosa. */
function beaos_aos_code( $file ) {
	$source = file_get_contents( $file );
	if ( false === $source ) {
		return null;
	}
	$code = '';
	foreach ( token_get_all( $source ) as $token ) {
		if ( is_array( $token ) ) {
			if ( in_array( $token[0], array( T_COMMENT, T_DOC_COMMENT, T_WHITESPACE ), true ) ) {
				continue;
			}
			$code .= $token[1];
			continue;
		}
		$code .= $token;
	}
	return $code;
}

$de_wordpress = array(
	'get_option', 'update_option', 'add_option', 'delete_option', 'get_transient', 'set_transient', 'delete_transient',
	'add_action', 'add_filter', 'apply_filters', 'do_action', 'remove_action',
	'esc_html', 'esc_attr', 'esc_url', 'esc_url_raw', 'esc_html__', 'sanitize_text_field', 'sanitize_title', 'sanitize_key',
	'home_url', 'site_url', 'admin_url', 'wp_parse_url', 'wp_json_encode', 'wp_remote_get', 'wp_remote_post',
	'is_wp_error', 'status_header', 'current_user_can', 'check_admin_referer', 'register_setting', 'add_options_page',
	'submit_button', 'settings_fields', 'checked', 'selected', 'wp_schedule_event', 'wp_next_scheduled', 'wp_clear_scheduled_hook',
	'__', '_e', 'esc_html_e', 'is_multisite', 'get_sites', 'switch_to_blog', 'restore_current_blog',
);

$llamadas = beaos_aos_called_functions( $pure );
if ( ! check( null !== $llamadas, 'se puede leer el archivo puro' ) ) {
	echo "pure: FALLA\n";
	exit( 1 );
}
$sospechosas = array();
foreach ( $llamadas as $nombre ) {
	if ( 0 === strpos( $nombre, 'wp_' ) || in_array( $nombre, $de_wordpress, true ) ) {
		$sospechosas[] = $nombre;
	}
}
check_same( array(), $sospechosas, 'el archivo puro no llama a ninguna función de WordPress' );
check_same( false, false !== strpos( file_get_contents( $pure ), '$wpdb' ), 'ni toca $wpdb' );

// ── 12 · El contrato con el repositorio ─────────────────────────────────────────────────────────
echo "12 · el contrato con el repositorio\n";

// El test no deriva el contrato de memoria: lo lee. Si MCP-BEAOS.md se mueve, esto falla y no se
// saltea en silencio (el bug que ya se comió el plugin de Autex: CHANGES.md, "la ruta ya estuvo mal").
$doc = @file_get_contents( dirname( __DIR__, 3 ) . '/MCP-BEAOS.md' );
if ( ! check( false !== $doc, 'encuentro MCP-BEAOS.md en la raíz del repo' ) ) {
	echo "pure: FALLA\n";
	exit( 1 );
}

// Sin comentarios: acá se nombran `/api/v1/*` y los tools en la prosa todo el tiempo, y eso no es
// código. Se comparan tokens, no texto.
$fuente = beaos_aos_code( $main );
if ( ! check( null !== $fuente, 'se puede leer el archivo principal' ) ) {
	echo "pure: FALLA\n";
	exit( 1 );
}
preg_match_all( "/->call\(\s*'([a-z_]+)'/", $fuente, $usados );
$tools = array_values( array_unique( $usados[1] ) );
check( count( $tools ) > 0, 'el plugin llama al menos a un tool del MCP (si no, el test no prueba nada)' );
foreach ( $tools as $tool ) {
	check( false !== strpos( $doc, '`' . $tool . '`' ), "el tool \"$tool\" que usa el plugin está documentado en MCP-BEAOS.md" );
}

// Y la decisión de seguridad, como invariante: el plugin NO usa la API de entrega de BeAOS, porque
// `/api/v1/*` valida sólo contra ADMIN_API_KEYS y eso obligaría a mandar una llave maestra al sitio.
check_same( false, false !== strpos( $fuente, '/api/v1/' ), 'el plugin no usa /api/v1/* (exigiría la llave maestra)' );

echo $fail ? "\npure: FALLA ($fail)\n" : "\npure: OK\n";
exit( $fail ? 1 : 0 );
