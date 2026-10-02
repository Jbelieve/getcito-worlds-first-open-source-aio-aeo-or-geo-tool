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

// ── 5b · LA LISTA BLANCA: sólo las rutas con forma de kit ───────────────────────────────────────
echo "5b · la lista blanca\n";

// Lo que el kit publica hoy. Los cinco fijos de la raíz y los diez de .well-known. No se inventan:
// salen del generador, y la sección 13 verifica que no se despeguen.
$del_kit = array(
	'/llms.txt',
	'/llms-full.txt',
	'/AGENTS.md',
	'/robots.txt',
	'/sitemap.xml',
	'/.well-known/brand.json',
	'/.well-known/brand.json.sig',
	'/.well-known/keys.json',
	'/.well-known/agent-card.json',
	'/.well-known/agent-permissions.json',
	'/.well-known/mcp/server-card.json',
	'/.well-known/security.txt',
	'/.well-known/api-catalog',
	'/.well-known/ai-catalog.json',
	'/.well-known/http-message-signatures-directory',
);
foreach ( $del_kit as $ruta ) {
	check_same( true, beaos_aos_claimable_path( $ruta ), "el kit puede reclamar $ruta" );
}

// La forma cubre lo que todavía no existe: un asset nuevo bajo .well-known/ se sirve sin tocar el
// plugin. Es la razón de elegir forma y no una lista cerrada.
check_same( true, beaos_aos_claimable_path( '/.well-known/lo-que-venga.json' ), 'un asset nuevo de .well-known/ pasa sin tocar el plugin' );
check_same( true, beaos_aos_claimable_path( '/.well-known/mcp/otro.json' ), 'y uno anidado también' );

// Y esto es el agujero que se cierra: las rutas del core que el manifiesto podía reclamar.
$prohibidas = array(
	'/wp-login.php'            => 'la pantalla de login',
	'/wp-admin/'               => 'el panel',
	'/wp-admin'                => 'el panel sin barra',
	'/wp-admin/options-general.php' => 'una pantalla del panel',
	'/wp-config.php'           => 'la configuración',
	'/wp-json/wp/v2/posts'     => 'la API REST',
	'/index.php'               => 'el índice',
	'/xmlrpc.php'              => 'xmlrpc',
	'/wp-content/uploads/x.txt' => 'los archivos subidos',
	'/readme.html'             => 'el readme del core',
	'/.htaccess'               => 'el .htaccess',
	'/.well-known/algo.php'    => 'un .php escondido en .well-known',
	'/.well-known/../../../wp-config.php' => 'un .. con forma de .well-known',
	'/WP-LOGIN.PHP'            => 'el login en mayúsculas',
	'/.well-known/'            => 'el prefijo pelado, que no es un archivo',
	'/.well-known'             => 'el prefijo sin barra',
	'/license.txt'             => 'un archivo de la raíz que el kit no publica',
	'/wp-login'                => 'una ruta que el kit no publica',
);
foreach ( $prohibidas as $ruta => $que ) {
	check_same( false, beaos_aos_claimable_path( $ruta ), "NO se puede reclamar $ruta ($que)" );
}

// El motivo se dice, y distingue "prohibida" de "no tiene forma de kit": el panel y el log lo muestran.
check_same( 'está en la lista de rutas prohibidas', beaos_aos_rejection_reason( '/wp-login.php' ), 'el motivo de una ruta prohibida' );
check_same( 'no tiene forma de kit', beaos_aos_rejection_reason( '/una-pagina/' ), 'el motivo de una que no es del kit' );
check_same( '', beaos_aos_rejection_reason( '/llms.txt' ), 'una del kit no tiene motivo de rechazo' );
check_same( true, beaos_aos_denied_path( '/wp-config.php' ), 'el .php se rechaza aunque esté en .well-known' );
check_same( true, beaos_aos_denied_path( '/.well-known/x.PHP' ), 'y sin importar mayúsculas' );
check_same( false, beaos_aos_denied_path( '/llms.txt' ), 'una del kit no está prohibida' );

// Las rutas guardadas que ya no se aceptan: debería ser vacío, y esto es lo que lo dice en el panel.
check_same( array(), beaos_aos_rejected_assets( array( '/llms.txt' => array(), '/.well-known/brand.json' => array() ) ), 'un kit sano no tiene rutas rechazadas' );
check_same( array( '/wp-login.php' ), beaos_aos_rejected_assets( array( '/llms.txt' => array(), '/wp-login.php' => array() ) ), 'y una opción envenenada se ve' );
check_same( array(), beaos_aos_rejected_assets( null ), 'sin copia, ninguna rechazada' );

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

// Una ruta que la lista blanca rechaza se ignora, con su motivo, y el resto del kit sigue.
$mala = array_merge( $bueno, array( 'path' => '/wp-login.php' ) );
check_same( 'skip', beaos_aos_asset_decision( $mala, $cuerpo )['action'], 'una ruta del core se ignora' );
check_same( 'está en la lista de rutas prohibidas', beaos_aos_asset_decision( $mala, $cuerpo )['reason'], 'y se dice por qué' );
check_same( 'skip', beaos_aos_asset_decision( array_merge( $bueno, array( 'path' => '/cualquier-cosa' ) ), $cuerpo )['action'], 'y una que no tiene forma de kit también' );
check_same( 'store', beaos_aos_asset_decision( $bueno, $cuerpo )['action'], 'la buena de al lado se sigue guardando' );

// El mensaje de los descartados: acotado, para que un manifiesto con cientos de rutas malas no infle
// la opción del kit.
check_same( '', beaos_aos_discarded_message( array() ), 'sin descartados no hay mensaje' );
check_same( 'descartados: /a (x)', beaos_aos_discarded_message( array( '/a (x)' ) ), 'un descartado se nombra' );
check_same(
	'descartados: /1, /2, y 3 más',
	beaos_aos_discarded_message( array( '/1', '/2', '/3', '/4', '/5' ), 2 ),
	'y muchos se cuentan en vez de listarse todos'
);

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

// ── 8b · El candado del sync ────────────────────────────────────────────────────────────────────
echo "8b · el candado del sync\n";

// El valor guardado es el vencimiento, no un `1`. Un candado que no dice cuándo vence deja el cron
// muerto para siempre si el proceso que lo tomó se murió.
check_same( '1300', beaos_aos_lock_value( 1000, 300 ), 'el valor del candado es su vencimiento' );
check_same( '1001', beaos_aos_lock_value( 1000, 0 ), 'un TTL de 0 no da un candado que vence al nacer' );
check_same( '1001', beaos_aos_lock_value( 1000, -50 ), 'ni uno negativo' );
check_same( '1001', beaos_aos_lock_value( 1000, 1 ), 'un TTL de 1 segundo se respeta' );

check_same( false, beaos_aos_lock_is_expired( '1300', 1299 ), 'un candado que vence en el futuro está vigente' );
check_same( true, beaos_aos_lock_is_expired( '1300', 1300 ), 'justo en el vencimiento ya venció' );
check_same( true, beaos_aos_lock_is_expired( '1300', 1301 ), 'y después, también' );
check_same( true, beaos_aos_lock_is_expired( '', 1300 ), 'un candado vacío cuenta como vencido' );
check_same( true, beaos_aos_lock_is_expired( 'no es un número', 1300 ), 'uno ilegible también (si no, traba el cron para siempre)' );
check_same( false, beaos_aos_lock_is_expired( '9999999999', 1300 ), 'uno lejano sigue vigente' );

// El ciclo completo, con el TTL real del plugin: se toma en `$ahora`, y mientras no pase el TTL sigue
// vigente. Es la propiedad que hace que un proceso muerto no deje el cron trabado más que el TTL.
$toma = beaos_aos_lock_value( $ahora, BEAOS_AOS_LOCK_TTL );
check_same( false, beaos_aos_lock_is_expired( $toma, $ahora ), 'recién tomado, el candado está vigente' );
check_same( false, beaos_aos_lock_is_expired( $toma, $ahora + BEAOS_AOS_LOCK_TTL - 1 ), 'y sigue vigente un segundo antes del TTL' );
check_same( true, beaos_aos_lock_is_expired( $toma, $ahora + BEAOS_AOS_LOCK_TTL ), 'y vence exactamente en el TTL' );
check_same( true, BEAOS_AOS_LOCK_TTL <= 3600, 'el vencimiento no pasa de una hora: un candado huérfano no puede trabar el cron un día' );

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

/**
 * El contenido del `= [ … ];` de un `export const NOMBRE` de un archivo TypeScript.
 *
 * El `new Set([ … ])` de `PUBLIC_AOS_PATHS` también entra: lo que interesa son los literales, no el
 * envoltorio. Si el envoltorio cambia otra vez y esto no lo puede leer, devuelve `null` y el llamador
 * lo denuncia — un test que no puede leer el contrato no puede garantizar nada sobre él.
 */
function beaos_aos_ts_block( $source, $name ) {
	$i = strpos( (string) $source, 'export const ' . $name );
	$i = false === $i ? strpos( (string) $source, 'const ' . $name ) : $i;
	if ( false === $i ) {
		return null;
	}
	$start = strpos( (string) $source, '[', $i );
	$end   = false === $start ? false : strpos( (string) $source, "\n];", (int) $start );
	if ( false === $start || false === $end ) {
		// Los `new Set([ … ]);` cierran con `]);` en la misma línea.
		$end = false === $start ? false : strpos( (string) $source, "]);", (int) $start );
		if ( false === $end ) {
			return null;
		}
	}
	return substr( (string) $source, $start + 1, $end - $start - 1 );
}

// ── 10b · El canje del código de conexión ────────────────────────────────────────────────────────
echo "10b · el canje del código de conexión\n";

check_same( '/api/v1/enroll', BEAOS_AOS_ENROLL_PATH, 'la ruta del canje es la que documenta PLUGIN-WORDPRESS-BEAOS.md' );
check_same(
	'https://beaos.believe-global.com/api/v1/enroll',
	beaos_aos_enroll_url( 'https://beaos.believe-global.com' ),
	'la URL del canje sale de la base de BeAOS'
);
check_same(
	'https://beaos.test/api/v1/enroll',
	beaos_aos_enroll_url( 'http://beaos.test/' ),
	'y se normaliza a https, sin barra doble'
);
check_same( '', beaos_aos_enroll_url( '' ), 'sin base configurada no hay URL: mejor no mandar el pedido a cualquier lado' );

check_same( '{"code":"beaos_abc"}', beaos_aos_enroll_body( ' beaos_abc ' ), 'el cuerpo recorta el código copiado con espacios' );
check_same( '', beaos_aos_enroll_body( '' ), 'sin código no hay cuerpo' );

// El 200, con los tres valores.
$ok = beaos_aos_enroll_read( 200, '{"token":"beaos_t","brandId":"acme-com","entityId":"8f1c-0000"}' );
check_same( true, $ok['ok'], 'un 200 con token, marca y entidad es un canje exitoso' );
check_same( 'beaos_t', $ok['token'], 'y trae el token' );
check_same( 'acme-com', $ok['brandId'], 'la marca' );
check_same( '8f1c-0000', $ok['entityId'], 'y la entidad' );
check_same( '', $ok['error'], 'sin error' );

// Los rechazos. El 400 es UNO solo para los tres motivos —inexistente, vencido, ya usado—, así que el
// plugin no puede inventar el motivo: muestra el texto del servidor tal cual.
$rechazo = beaos_aos_enroll_read( 400, '{"error":"Bad Request","message":"El código no sirve: no existe, ya venció o ya se usó."}' );
check_same( false, $rechazo['ok'], 'un 400 no canjea' );
check_same( true, false !== strpos( $rechazo['error'], 'no existe, ya venció o ya se usó' ), 'y el mensaje del servidor llega entero' );
check_same( '', $rechazo['token'], 'sin token' );

$sin_mensaje = beaos_aos_enroll_read( 400, '' );
check_same( false, $sin_mensaje['ok'], 'un 400 pelado tampoco canjea' );
check( false !== strpos( $sin_mensaje['error'], 'no existe, ya venció o ya se usó' ), 'y se explica con el texto del contrato, no con un "error 400"' );

$limitado = beaos_aos_enroll_read( 429, '{}', 3600 );
check_same( false, $limitado['ok'], 'un 429 no canjea' );
check( false !== strpos( $limitado['error'], 'límite de intentos' ), 'y habla del límite, que es lo único accionable' );
check( false !== strpos( $limitado['error'], '3600' ), 'con el Retry-After del servidor' );

$roto = beaos_aos_enroll_read( 200, '<html>un WAF</html>' );
check_same( false, $roto['ok'], 'un 200 que no es JSON no canjea' );
check( false !== strpos( $roto['error'], 'no es JSON' ), 'y lo dice, en vez de guardar basura como token' );

// Un status 0 no es un status: es que **no hubo respuesta** (DNS, TLS, timeout). Es el caso que más va a
// pasar en un WordPress real y el que encontró la prueba del camino real: devolvía el mensaje **vacío**,
// así que la pantalla decía "No se pudo conectar." sin decir por qué. Un stub siempre devuelve un código
// HTTP, así que esto sólo se ve corriendo el camino de verdad contra un servidor que no contesta.
$sin_respuesta = beaos_aos_enroll_read( false, false );
check_same( false, $sin_respuesta['ok'], 'un fallo de transporte (status 0) no canjea' );
check( '' !== $sin_respuesta['error'], 'y el mensaje NO queda vacío (era el bug: ok=false con error="")' );
check( false !== strpos( $sin_respuesta['error'], 'No hubo respuesta' ), 'dice que no hubo respuesta' );
check( false !== strpos( $sin_respuesta['error'], 'DNS' ), 'y por dónde buscar (DNS, TLS, timeout), en vez de mandar al proxy' );
check_same( '', beaos_aos_enroll_http_error( 200, '{"token":"x"}' ), 'un 200 sigue sin ser un error' );

// Dos respuestas que se pueden usar mal: un 200 sin token, y uno sin entityId. La segunda además avisa
// que el código ya se consumió, que es lo que el operador necesita saber para generar otro.
$sin_token = beaos_aos_enroll_read( 200, '{"brandId":"acme-com","entityId":"e1"}' );
check_same( false, $sin_token['ok'], 'un 200 sin token no es una conexión' );
check( false !== strpos( $sin_token['error'], 'ya se consumió' ), 'y avisa que el código ya se gastó' );

$sin_entidad = beaos_aos_enroll_read( 200, '{"token":"beaos_t","brandId":"acme-com"}' );
check_same( false, $sin_entidad['ok'], 'un 200 sin entityId tampoco: sin eso no hay a quién pedirle el kit' );
check_same( 'beaos_t', $sin_entidad['token'], 'aunque el token sí haya llegado' );

// El contrato con la guarda de BeAOS: la ruta tiene que estar en el allowlist EXACTO de rutas públicas.
// Si alguien la saca de `PUBLIC_AOS_PATHS`, el middleware le exige `ADMIN_API_KEYS` y el canje deja de
// funcionar en silencio (401 en el WordPress del cliente). Esto lo hace fallar acá.
$fuente_auth = @file_get_contents( dirname( __DIR__, 3 ) . '/apps/web/src/lib/auth/policies.ts' );
if ( check( false !== $fuente_auth, 'encuentro la guarda de rutas de BeAOS (apps/web/src/lib/auth/policies.ts)' ) ) {
	$publicas = beaos_aos_ts_strings( beaos_aos_ts_block( $fuente_auth, 'PUBLIC_AOS_PATHS' ) );
	check(
		in_array( BEAOS_AOS_ENROLL_PATH, $publicas, true ),
		'la ruta del canje está en el allowlist público de BeAOS (si no, el middleware le pide la llave maestra)'
	);
	// Y la guarda es exacta: el allowlist no puede haberse vuelto un prefijo.
	check_same( array( '/api/v1/aos/audit', '/api/v1/aos/lead', '/api/v1/enroll' ), $publicas, 'y el allowlist sigue siendo de rutas exactas, con las tres y nada más' );
}

check_same(
	array(),
	array_values( array_filter( beaos_aos_called_functions( $pure ), function ( $n ) { return 0 === strpos( $n, 'wp_' ); } ) ),
	'las funciones del canje viven en el archivo puro y no llaman a WordPress'
);

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

// El candado no puede volver a la primitiva flaky. Estas tres líneas son la guarda contra la regresión
// más probable de todo el archivo: `get_transient()` + `set_transient()` **no es un candado** (entre el
// `get` y el `set` entran dos corridas), y `add_option()` tampoco —en el WordPress de este repo usa
// `INSERT ... ON DUPLICATE KEY UPDATE`, así que el que llega segundo sobrescribe y contesta que sí—.
// La única primitiva con la que se toma el candado es el `INSERT IGNORE` sobre el índice único de
// `wp_options.option_name`.
$codigo_main = beaos_aos_code( $main );
if ( check( null !== $codigo_main, 'se puede leer el código del archivo principal' ) ) {
	check_same( false, false !== strpos( $codigo_main, 'get_transient(BEAOS_AOS_LOCK' ), 'el candado no se lee con get_transient' );
	check_same( false, false !== strpos( $codigo_main, 'set_transient(BEAOS_AOS_LOCK' ), 'ni se escribe con set_transient' );
	check_same( false, false !== strpos( $codigo_main, 'add_option(BEAOS_AOS_LOCK' ), 'ni se toma con add_option (sobrescribe y contesta que sí)' );
	check( false !== strpos( $codigo_main, 'INSERT IGNORE INTO' ), 'el candado se toma con INSERT IGNORE sobre option_name' );
	check( false !== strpos( $codigo_main, 'DELETE FROM' ), 'y se suelta con un DELETE (condicional al vencimiento que escribió)' );
	check( false !== strpos( $codigo_main, 'finally' ), 'el finally que suelta el candado sigue ahí' );
}

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

// Y la decisión de seguridad, como invariante: el plugin usa **exactamente un** `/api/v1/*`, el del
// canje del código de conexión, y puede usarlo porque es **público**.
//
// Antes esta guarda prohibía cualquier `/api/v1/*` y estaba bien: todos validan contra `ADMIN_API_KEYS`
// —la llave maestra compartida que abre todas las marcas y no se revoca por sitio—, así que usarlos
// exigiría mandar esa llave a un WordPress ajeno. `POST /api/v1/enroll` es la excepción y la única:
// está en el allowlist exacto de `apps/web/src/lib/auth/policies.ts` (`PUBLIC_AOS_PATHS`) justamente
// porque **no pide credencial previa** —el código *es* la credencial— y su cota es un cupo por IP.
//
// La lista blanca es de rutas completas, no de prefijos: `aos/audit` es público por otro motivo (la
// herramienta es anónima) y el plugin no tiene por qué usarlo. Sigue mordiendo para cualquier otro
// `/api/v1/*`, que es lo que esta guarda existe para atrapar.
//
// Se leen los literales del **código tokenizado**, no el texto: en la prosa se nombran `/api/v1/*` todo
// el tiempo y eso no es una llamada. Y se leen los dos archivos, porque el path y la URL viven en el
// puro y el `wp_remote_post` en el principal.
$api_v1_permitidos = array( 'https://beaos.believe-global.com/api/v1/enroll', '/api/v1/enroll' );
$api_v1_usados     = array();
foreach ( array( $pure, $main ) as $archivo ) {
	$fuente_archivo = beaos_aos_code( $archivo );
	if ( ! check( null !== $fuente_archivo, 'se puede leer ' . basename( $archivo ) . ' sin comentarios' ) ) {
		continue;
	}
	foreach ( token_get_all( (string) file_get_contents( $archivo ) ) as $token ) {
		if ( ! is_array( $token ) || T_CONSTANT_ENCAPSED_STRING !== $token[0] ) {
			continue;
		}
		$literal = trim( $token[1], "'\"" );
		if ( false !== strpos( $literal, '/api/v1/' ) ) {
			$api_v1_usados[] = $literal;
		}
	}
}
$api_v1_usados = array_values( array_unique( $api_v1_usados ) );
check( count( $api_v1_usados ) > 0, 'el plugin nombra la ruta del canje (si no, esta guarda no prueba nada)' );
foreach ( $api_v1_usados as $literal ) {
	check(
		in_array( $literal, $api_v1_permitidos, true ),
		"el único /api/v1/* que el plugin usa es el canje público: \"$literal\" (los demás exigirían la llave maestra)"
	);
}

// ── 13 · La lista blanca no se puede desincronizar del generador ─────────────────────────────────
echo "13 · el contrato con el generador del kit\n";

/**
 * Las rutas que un archivo declara en un `path:`, leídas línea por línea del código fuente. Un valor
 * literal se devuelve para poder verificarlo contra la lista blanca; uno que no se puede verificar
 * (una plantilla, una expresión) se denuncia en vez de ignorarse: **un test que no puede leer una
 * ruta no puede garantizar nada sobre ella**, y una ruta nueva que se cuele sin verificar es
 * exactamente el silencio que este test existe para romper.
 *
 * Las líneas de comentario se saltean (en estos archivos se habla de rutas en la prosa todo el
 * tiempo). `path: string` es la declaración del tipo de un asset, no una ruta.
 */
function beaos_aos_generator_paths( $source ) {
	$paths = array();
	$no    = array();
	foreach ( preg_split( '/\R/', (string) $source ) as $linea ) {
		if ( preg_match( '#^\s*(\*|//|/\*)#', $linea ) ) {
			continue;
		}
		if ( ! preg_match( '/\bpath:\s*(.+)$/', $linea, $m ) ) {
			continue;
		}
		$resto = trim( $m[1] );
		$c     = substr( $resto, 0, 1 );
		if ( '"' === $c || "'" === $c ) {
			$fin = strpos( $resto, $c, 1 );
			$val = false === $fin ? substr( $resto, 1 ) : substr( $resto, 1, $fin - 1 );
			if ( false !== strpos( $val, '$' ) ) {
				$no[] = trim( $linea );
				continue;
			}
			$paths[] = $val;
			continue;
		}
		if ( preg_match( '/^(string|int|number)\b/', $resto ) ) {
			continue;
		}
		$no[] = trim( $linea );
	}
	return array(
		'paths'           => array_values( array_unique( $paths ) ),
		'no_verificables' => $no,
	);
}

// El test **lee el generador**, no una copia de la lista: si mañana emite una ruta de más, esto falla
// y dice cuál. Es la misma regla que la sección 12 con MCP-BEAOS.md.
$generador = dirname( __DIR__, 3 ) . '/packages/aos-aps/src/assets/generate.ts';
$gen_src   = @file_get_contents( $generador );
if ( ! check( false !== $gen_src, 'encuentro el generador del kit (packages/aos-aps/src/assets/generate.ts)' ) ) {
	echo "pure: FALLA\n";
	exit( 1 );
}

$gen = beaos_aos_generator_paths( $gen_src );
check_same( array(), $gen['no_verificables'], 'todas las rutas del generador son literales que este test puede verificar' );
check(
	count( $gen['paths'] ) >= 15,
	'el generador declara las rutas del kit como literales (encontré ' . count( $gen['paths'] ) . ', esperaba 15 o más)'
);
check_same( true, in_array( '/llms.txt', $gen['paths'], true ), 'y está el ancla /llms.txt' );
check_same( true, in_array( '/.well-known/brand.json', $gen['paths'], true ), 'y el ancla /.well-known/brand.json' );

foreach ( $gen['paths'] as $ruta ) {
	check_same( true, beaos_aos_claimable_path( $ruta ), "el kit emite $ruta y la lista blanca del plugin lo acepta" );
}

// El otro archivo que arma el bundle. No declara rutas (las reenvía: `path: asset.path`), pero si
// alguien escribiera una a mano, tiene que pasar la lista blanca igual.
$core_src = @file_get_contents( dirname( __DIR__, 3 ) . '/apps/web/src/server/agent-assets-core.ts' );
if ( check( false !== $core_src, 'encuentro agent-assets-core.ts' ) ) {
	foreach ( beaos_aos_generator_paths( $core_src )['paths'] as $ruta ) {
		check_same( true, beaos_aos_claimable_path( $ruta ), "agent-assets-core.ts declara $ruta y la lista blanca lo acepta" );
	}
}

// ── 14 · El contrato con la guarda de rutas de BeAOS ────────────────────────────────────────────
//
// La forma de una ruta del kit la conocen **tres** lugares: el generador (`generate.ts`), la lista
// blanca de este plugin (`beaos-aos-pure.php`) y la guarda de BeAOS
// (`packages/aos-aps/src/assets/kit-routes.ts`), que es la que usan la escritura, la lectura del bundle
// y el `CHECK` de la base. PHP y TypeScript no comparten código, así que la atadura no puede ser un
// import: es este test, que **lee la definición de BeAOS** y la compara, lista por lista y caso por caso.
//
// Lo que se compara:
//   - los cinco archivos fijos de la raíz, el prefijo de `/.well-known/`, la lista de prohibidas y el
//     tope de largo: **iguales**, en el mismo orden;
//   - y el corpus compartido (`KIT_ROUTE_VECTORS`): cada caso tiene que dar el mismo veredicto acá que
//     allá. Un caso nuevo se agrega una sola vez, en `kit-routes.ts`, y los dos tests lo exigen.
echo "14 · el contrato con la guarda de rutas de BeAOS\n";

/** Los literales de texto de un bloque, en orden de aparición. */
function beaos_aos_ts_strings( $block ) {
	preg_match_all( '/"([^"]*)"/', (string) $block, $matches );
	return $matches[1];
}

/**
 * Las entradas del corpus: `["/ruta", true],` una por línea. Una línea que no se pueda leer y no sea un
 * comentario ni un espacio se devuelve en `no_verificables`: un caso que el test no puede leer es un
 * caso sobre el que no puede garantizar nada, y eso se denuncia.
 */
function beaos_aos_ts_vectors( $block ) {
	$vectors = array();
	$no      = array();
	foreach ( preg_split( '/\R/', (string) $block ) as $linea ) {
		if ( preg_match( '#^\s*(//|/\*|\*)#', $linea ) ) {
			continue;
		}
		if ( '' === trim( $linea ) ) {
			continue;
		}
		if ( preg_match( '/^\s*\["([^"]*)",\s*(true|false)\],\s*$/', $linea, $m ) ) {
			$vectors[] = array(
				'path' => $m[1],
				'ok'   => 'true' === $m[2],
			);
			continue;
		}
		$no[] = trim( $linea );
	}
	return array(
		'vectors'         => $vectors,
		'no_verificables' => $no,
	);
}

$rutas_ts = dirname( __DIR__, 3 ) . '/packages/aos-aps/src/assets/kit-routes.ts';
$rutas    = @file_get_contents( $rutas_ts );
if ( ! check( false !== $rutas, 'encuentro la guarda de rutas de BeAOS (packages/aos-aps/src/assets/kit-routes.ts)' ) ) {
	echo "pure: FALLA\n";
	exit( 1 );
}

check_same(
	BEAOS_AOS_ROOT_PATHS,
	beaos_aos_ts_strings( beaos_aos_ts_block( $rutas, 'KIT_ROOT_PATHS' ) ),
	'los cinco archivos fijos de la raíz son los mismos que los de BeAOS'
);
check_same(
	BEAOS_AOS_DENIED_PATHS,
	beaos_aos_ts_strings( beaos_aos_ts_block( $rutas, 'KIT_DENIED_PATHS' ) ),
	'la lista de rutas prohibidas es la misma que la de BeAOS'
);

preg_match( '/KIT_WELL_KNOWN_PREFIX\s*=\s*"([^"]*)"/', $rutas, $prefijo_ts );
check_same( BEAOS_AOS_WELL_KNOWN, $prefijo_ts[1] ?? '', 'el prefijo de .well-known es el mismo' );

preg_match( '/KIT_PATH_MAX_LENGTH\s*=\s*(\d+)/', $rutas, $max_ts );
check_same( BEAOS_AOS_PATH_MAX, (int) ( $max_ts[1] ?? 0 ), 'el tope de largo es el mismo' );

$corpus = beaos_aos_ts_vectors( beaos_aos_ts_block( $rutas, 'KIT_ROUTE_VECTORS' ) );
check_same( array(), $corpus['no_verificables'], 'el corpus compartido se puede leer entero (ninguna entrada rara)' );
check(
	count( $corpus['vectors'] ) >= 30,
	'el corpus compartido trae casos de sobra (encontré ' . count( $corpus['vectors'] ) . ', esperaba 30 o más)'
);

$discrepancias = array();
foreach ( $corpus['vectors'] as $caso ) {
	if ( beaos_aos_claimable_path( $caso['path'] ) !== $caso['ok'] ) {
		$discrepancias[] = $caso['path'] . ' (esperado ' . var_export( $caso['ok'], true ) . ', la lista blanca dice ' . var_export( beaos_aos_claimable_path( $caso['path'] ), true ) . ')';
	}
}
check_same( array(), $discrepancias, 'la lista blanca del plugin y la guarda de BeAOS dan el mismo veredicto en todo el corpus' );

// Y las anclas: el test no puede pasar por tener un corpus vacío o mal leído.
check( in_array( array( 'path' => '/wp-login.php', 'ok' => false ), $corpus['vectors'], true ), 'el corpus trae /wp-login.php como prohibida' );
check( in_array( array( 'path' => '/llms.txt', 'ok' => true ), $corpus['vectors'], true ), 'y /llms.txt como legítima' );

echo $fail ? "\npure: FALLA ($fail)\n" : "\npure: OK\n";
exit( $fail ? 1 : 0 );
