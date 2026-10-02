<?php
/**
 * Plugin Name: BeAOS by Believe
 * Description: Conecta este WordPress con BeAOS, publica la marca como assets agénticos y sirve el kit (llms.txt, /.well-known/*) byte a byte, en su ruta.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 7.4
 * Author: Believe
 * License: Propietaria
 * Text Domain: beaos-aos
 *
 * El plugin de Autex (`autex-aos`, v0.5.0) ya resolvió lo difícil de servir un kit en WordPress: ganarle
 * a `do_robots()`, a los sitemaps del core y al 404 de `/.well-known/*` enganchando en `init` con
 * prioridad 0 y limpiando los buffers antes de escribir. Eso se reusa tal cual, con el mismo criterio de
 * copia local (opción sin autoload, cuerpos en base64, sha256 por archivo y re-verificación al servir).
 *
 * Lo que cambia es la fuente: Autex baja el kit de su API de distribución con `Bearer`; BeAOS lo pide por
 * su **MCP**, que es la única puerta que acepta un token por producto. `/api/v1/*` de BeAOS valida sólo
 * contra `ADMIN_API_KEYS` —la llave maestra compartida—, así que ese camino exigiría mandar una llave
 * maestra a un WordPress ajeno. No.
 *
 * Lo que NO está implementado todavía, a propósito: el asistente de 3 pasos y el canje de la credencial.
 * Jorge tiene que elegir entre tres flujos de conexión (ver `PLUGIN-WORDPRESS-BEAOS.md`). Mientras tanto
 * el flujo manual funciona: se pega el token y el `entityId` y el kit se sincroniza.
 */

defined( 'ABSPATH' ) || exit;

require_once __DIR__ . '/beaos-aos-pure.php';
require_once __DIR__ . '/class-beaos-mcp.php';

/** El slug de la pantalla de ajustes. */
const BEAOS_AOS_PAGE = 'beaos-aos';

/** Los ajustes guardados, con los valores por defecto puestos. */
function beaos_aos_opts() {
	$saved = get_option( BEAOS_AOS_OPTION, array() );
	return array_merge( beaos_aos_defaults(), is_array( $saved ) ? $saved : array() );
}

/** Un cliente del MCP con el token y el endpoint guardados. */
function beaos_aos_mcp() {
	$o = beaos_aos_opts();
	return new BeAOS_MCP( $o['token'], $o['mcp'] );
}

// ── El candado del sync ─────────────────────────────────────────────────────────────────────────
//
// La primitiva y el porqué están explicados en `beaos-aos-pure.php` (sección "El candado del sync"):
// una opción con `INSERT IGNORE` sobre el índice único de `wp_options.option_name`. Acá vive lo que
// necesita `$wpdb`, y una sola regla que no se puede olvidar: **todo lo que escribe el candado pasa
// por estas tres funciones**, porque escriben con SQL directo y WordPress no se entera.

/**
 * Vacía la caché de opciones para el candado.
 *
 * Hace falta y no es un detalle: WordPress cachea las opciones que **existen** (grupo `options`) y
 * también las que **no existen** (la lista `notoptions`). Como el candado se escribe con SQL directo,
 * las dos cachés quedan mintiendo: `get_option()` puede seguir contestando "no existe" con la fila ya
 * insertada, o devolver un valor viejo después de borrarla. Con una caché de objetos persistente
 * (Redis, Memcached) ese "no existe" sobrevive incluso entre procesos, que es la trampa de manual.
 *
 * Por eso `beaos_aos_lock_stored()` lee con SQL directo en vez de `get_option()`, y por eso acá se
 * limpian las dos entradas después de cada escritura.
 */
function beaos_aos_lock_forget_cache() {
	wp_cache_delete( BEAOS_AOS_LOCK, 'options' );
	$notoptions = wp_cache_get( 'notoptions', 'options' );
	if ( is_array( $notoptions ) && isset( $notoptions[ BEAOS_AOS_LOCK ] ) ) {
		unset( $notoptions[ BEAOS_AOS_LOCK ] );
		wp_cache_set( 'notoptions', $notoptions, 'options' );
	}
}

/** El vencimiento guardado en el candado, leído de la base (no de la caché). `''` si no hay. */
function beaos_aos_lock_stored() {
	global $wpdb;
	$value = $wpdb->get_var(
		$wpdb->prepare(
			"SELECT `option_value` FROM `{$wpdb->options}` WHERE `option_name` = %s",
			BEAOS_AOS_LOCK
		)
	);
	return null === $value ? '' : (string) $value;
}

/** ¿Hay una corrida en curso? El candado existe y todavía no venció. */
function beaos_aos_lock_is_locked() {
	$stored = beaos_aos_lock_stored();
	return '' !== $stored && ! beaos_aos_lock_is_expired( $stored, time() );
}

/**
 * Toma el candado. Devuelve el vencimiento que hay que devolverle a `beaos_aos_lock_release()`, o
 * `false` si ya hay una corrida en curso (o si la base no dejó tomarlo: en la duda, no se sincroniza).
 *
 * El único caso en el que una corrida que **no** consiguió el candado sigue adelante es el vencido: si
 * la fila está pero su vencimiento ya pasó, se borra con un `DELETE ... AND option_value = <el
 * vencimiento que se leyó>` — que es un compare-and-swap: si otro se lo llevó en el medio, el borrado
 * afecta 0 filas y este intento se rinde. Igual que la toma, lo decide la base.
 */
function beaos_aos_lock_acquire( $ttl = BEAOS_AOS_LOCK_TTL ) {
	global $wpdb;

	$now    = time();
	$expiry = beaos_aos_lock_value( $now, $ttl );

	// Dos intentos alcanzan: el primero toma el candado, el segundo lo reintenta después de limpiar uno
	// vencido. Un tercero no agregaría nada, porque el estado ya se conoce.
	for ( $intento = 0; $intento < 2; $intento++ ) {
		$got = $wpdb->query(
			$wpdb->prepare(
				"INSERT IGNORE INTO `{$wpdb->options}` (`option_name`, `option_value`, `autoload`) VALUES (%s, %s, 'off')",
				BEAOS_AOS_LOCK,
				$expiry
			)
		);

		if ( false === $got ) {
			// La base no contestó (no es un duplicado: eso da 0 filas). No se sincroniza: perder una
			// corrida es barato; pisar la que está corriendo, no.
			return false;
		}

		if ( 1 === (int) $got ) {
			beaos_aos_lock_forget_cache();
			return $expiry;
		}

		// 0 filas: el índice único rechazó el INSERT, así que la fila ya estaba. Puede estar vigente —hay
		// otra corrida— o vencida, que es el caso del proceso que se murió sin soltarla.
		$stored = beaos_aos_lock_stored();
		if ( '' === $stored || ! beaos_aos_lock_is_expired( $stored, $now ) ) {
			return false; // hay una corrida en curso
		}

		// Venció: se lo lleva el que gane el borrado condicional.
		$borrado = $wpdb->query(
			$wpdb->prepare(
				"DELETE FROM `{$wpdb->options}` WHERE `option_name` = %s AND `option_value` = %s",
				BEAOS_AOS_LOCK,
				$stored
			)
		);
		beaos_aos_lock_forget_cache();
		if ( 1 !== (int) $borrado ) {
			return false; // otro llegó primero
		}
	}

	return false;
}

/**
 * Suelta el candado **sólo si sigue siendo el nuestro**. Se llama desde el `finally` del sync, así que
 * corre pase lo que pase; el `AND option_value` es lo que impide que una corrida lenta borre el candado
 * de la corrida que la reemplazó.
 */
function beaos_aos_lock_release( $expiry ) {
	global $wpdb;

	$expiry = trim( (string) $expiry );
	if ( '' === $expiry ) {
		return;
	}
	$wpdb->query(
		$wpdb->prepare(
			"DELETE FROM `{$wpdb->options}` WHERE `option_name` = %s AND `option_value` = %s",
			BEAOS_AOS_LOCK,
			$expiry
		)
	);
	beaos_aos_lock_forget_cache();
}

/**
 * Suelta el candado sin importar de quién sea. Es lo que corre al desactivar el plugin: ahí no hay
 * corrida que respetar, y dejar una fila atrás trabaría la próxima activación por 5 minutos.
 *
 * También borra el transient con el mismo nombre que usaban las versiones anteriores al candado
 * atómico: un sitio que se actualiza no tiene por qué quedarse con basura de la primitiva vieja.
 */
function beaos_aos_lock_release_all() {
	global $wpdb;
	$wpdb->query( $wpdb->prepare( "DELETE FROM `{$wpdb->options}` WHERE `option_name` = %s", BEAOS_AOS_LOCK ) );
	beaos_aos_lock_forget_cache();
	delete_transient( BEAOS_AOS_LOCK );
}

// ── La sincronización del kit ───────────────────────────────────────────────────────────────────

/**
 * El manifiesto del bundle publicado: `get_agent_bundle` devuelve cada ruta con su `type`, su `sha256` y
 * su `bytes`, y nada de contenido. Es el equivalente del manifiesto de Autex, con otro nombre de campo.
 *
 * `{ published: false }` **no es un error**: es el gate de BeAOS, cerrado por defecto hasta que un
 * operador publique la entidad. Se devuelve como estado, no como fallo.
 */
function beaos_aos_fetch_manifest( BeAOS_MCP $mcp, $entity_id, &$error ) {
	$read = $mcp->call( 'get_agent_bundle', array( 'entityId' => $entity_id ) );
	if ( ! $read['ok'] ) {
		$error = $read['error'];
		return null;
	}
	$data = $read['data'];
	if ( ! is_array( $data ) ) {
		$error = 'El manifiesto no vino como datos estructurados.';
		return null;
	}
	if ( isset( $data['published'] ) && false === $data['published'] ) {
		return array( 'published' => false );
	}
	if ( ! isset( $data['assets'] ) || ! is_array( $data['assets'] ) ) {
		$error = 'El manifiesto no trae `assets`.';
		return null;
	}
	return array(
		'published'     => true,
		'bundle_sha256' => isset( $data['bundleSha256'] ) ? (string) $data['bundleSha256'] : '',
		'assets'        => $data['assets'],
	);
}

/**
 * El contenido de un asset: `get_agent_asset` devuelve el texto exacto en `content[0].text` y el tipo, el
 * sha256 y el `bundleSha256` en `structuredContent`.
 *
 * El contenido viaja como texto, y eso alcanza porque **todos los assets del bundle son texto hoy**
 * (`text/plain`, `text/markdown`, `application/json`, `application/xml`). Un asset binario no se podría
 * servir por este camino: está dicho en el README y en el límite honesto del diseño.
 */
function beaos_aos_fetch_asset( BeAOS_MCP $mcp, $entity_id, $path ) {
	$read = $mcp->call(
		'get_agent_asset',
		array(
			'entityId' => $entity_id,
			'path'     => $path,
		)
	);
	if ( ! $read['ok'] ) {
		return null;
	}
	$data = is_array( $read['data'] ) ? $read['data'] : array();
	if ( ( isset( $data['found'] ) && false === $data['found'] ) || ( isset( $data['published'] ) && false === $data['published'] ) ) {
		return null;
	}
	if ( '' === $read['text'] ) {
		return null;
	}
	return array(
		'type'   => isset( $data['type'] ) ? (string) $data['type'] : '',
		'sha256' => isset( $data['sha256'] ) ? (string) $data['sha256'] : '',
		'body'   => $read['text'],
	);
}

/**
 * Deja constancia, en el log de PHP, de una ruta que la lista blanca rechazó. Con `WP_DEBUG_LOG`
 * (lo normal en un sitio de pruebas) la línea cae en `wp-content/debug.log`.
 *
 * Se registra **una vez por ruta cada 12 horas** (un transient): el evento es raro y hay que verlo,
 * pero un pedido a `/wp-admin/` en un sitio con la opción envenenada no puede llenar el log.
 *
 * @param string $path           La ruta rechazada.
 * @param string $reason         El motivo, tal como lo da la parte pura.
 * @param bool   $only_if_stored Registrar sólo si la copia local tiene esa ruta. Lo usa el servido:
 *                               así un `/wp-admin/` normal (que no es noticia) no toca la base, y
 *                               una ruta que el plugin se niega a servir **sí** queda anotada.
 */
function beaos_aos_log_rejected_route( $path, $reason, $only_if_stored = false ) {
	$path = (string) $path;

	if ( $only_if_stored ) {
		$bundle = get_option( BEAOS_AOS_BUNDLE );
		if ( ! is_array( $bundle ) || ! isset( $bundle['assets'][ $path ] ) ) {
			return;
		}
	}

	$key = 'beaos_aos_rejected_' . md5( $path );
	if ( get_transient( $key ) ) {
		return;
	}
	set_transient( $key, 1, 12 * HOUR_IN_SECONDS );

	error_log(
		sprintf(
			'[beaos-aos] ruta del kit rechazada por la lista blanca: %s (%s). No se sirve.',
			$path,
			'' !== $reason ? $reason : 'sin motivo'
		)
	);
}

/**
 * Baja el manifiesto y cada archivo nuevo o cambiado, y guarda la copia local.
 *
 * Mismo criterio que `autex_aos_sync()`:
 *   - El manifiesto primero. Si no llega, **se conserva la copia anterior tal cual** y sólo se anota el
 *     error: el sitio sigue sirviendo lo que ya tenía.
 *   - Un archivo cuyo sha256 no cambió **no se vuelve a bajar**.
 *   - Un archivo que no da su sha256 o su largo **no se guarda**: mejor un 404 que romper la firma.
 *
 * Lo que agrega sobre Autex:
 *   - Un **candado atómico** para que dos corridas no se pisen. Autex no lo tiene: guardar los ajustes
 *     mientras corre el cron dispara una segunda corrida en paralelo. El candado es una opción tomada
 *     con `INSERT IGNORE` sobre el índice único de `wp_options.option_name` — ver `beaos_aos_lock_acquire()`
 *     y la sección "El candado del sync" de `beaos-aos-pure.php` para el porqué.
 *   - Un tope de archivos por corrida, para que un manifiesto raro no se lleve puesto el tiempo de PHP.
 *   - El estado `unpublished`, que no es un error.
 *
 * Se llama sin argumentos desde el cron y desde el guardado de ajustes; con `$force = true` desde el
 * botón "Sincronizar ahora".
 */
function beaos_aos_sync( $force = false ) {
	$o = beaos_aos_opts();
	if ( empty( $o['enabled'] ) ) {
		return false;
	}
	if ( beaos_aos_missing( $o ) ) {
		return false;
	}

	// El candado se toma **antes** de mirar si el kit está vencido: si se mirara primero, dos corridas
	// podrían decidir las dos que hay que sincronizar y recién después pelearse por el candado.
	$lock = beaos_aos_lock_acquire( BEAOS_AOS_LOCK_TTL );
	if ( false === $lock ) {
		return false; // ya hay una corrida en curso
	}

	try {
		$previous = get_option( BEAOS_AOS_BUNDLE );
		$previous = is_array( $previous ) ? $previous : beaos_aos_bundle( array(), '', 0, 'empty' );
		if ( ! $force && ! beaos_aos_bundle_is_stale( $previous, time(), BEAOS_AOS_TTL ) ) {
			return false; // recién sincronizado: no se gasta el request
		}

		$mcp   = beaos_aos_mcp();
		$error = '';
		$man   = beaos_aos_fetch_manifest( $mcp, $o['entity_id'], $error );

		if ( null === $man ) {
			// El manifiesto no llegó: la copia anterior queda intacta y sólo se anota el motivo.
			update_option(
				BEAOS_AOS_BUNDLE,
				beaos_aos_bundle(
					isset( $previous['assets'] ) && is_array( $previous['assets'] ) ? $previous['assets'] : array(),
					(string) ( $previous['bundle_sha256'] ?? '' ),
					(int) ( $previous['synced_ts'] ?? 0 ),
					'error',
					$error
				),
				false
			);
			return false;
		}

		if ( empty( $man['published'] ) ) {
			update_option(
				BEAOS_AOS_BUNDLE,
				beaos_aos_bundle( array(), '', time(), 'unpublished' ),
				false
			);
			return false;
		}

		$assets = array();
		$bad    = array();
		$down   = 0;
		foreach ( $man['assets'] as $entry ) {
			$entry = is_array( $entry ) ? $entry : array();
			$path  = isset( $entry['path'] ) ? (string) $entry['path'] : '';
			$old   = isset( $previous['assets'][ $path ] ) ? $previous['assets'][ $path ] : null;

			// Primera pasada, sin cuerpo: decide si hay que bajarlo.
			$decision = beaos_aos_asset_decision( $entry, null, $old );
			if ( 'skip' === $decision['action'] ) {
				// Una ruta que la lista blanca rechaza se ignora, se anota y **el resto del kit se
				// sigue sirviendo**: tirar el bundle entero por una entrada mala cambiaría un bug de
				// una ruta por una caída del kit completo.
				if ( ! beaos_aos_claimable_path( $path ) ) {
					$bad[] = $path . ' (' . $decision['reason'] . ')';
					beaos_aos_log_rejected_route( $path, $decision['reason'] );
				}
				continue;
			}
			if ( 'keep' === $decision['action'] ) {
				$assets[ $path ] = $old;
				continue;
			}
			if ( $down >= BEAOS_AOS_MAX_ASSETS ) {
				$bad[] = $path . ' (tope de la corrida)';
				continue;
			}
			$down++;

			$fetched = beaos_aos_fetch_asset( $mcp, $o['entity_id'], $path );
			if ( null === $fetched ) {
				$bad[] = $path . ' (no llegó)';
				continue;
			}
			$body = (string) $fetched['body'];

			// Segunda pasada, con el cuerpo: decide si se guarda.
			$decision = beaos_aos_asset_decision( $entry, $body, $old );
			if ( 'store' !== $decision['action'] ) {
				$bad[] = $path . ' (' . $decision['reason'] . ')';
				continue;
			}
			$assets[ $path ] = beaos_aos_stored_from_body( $entry, $body );
		}

		update_option(
			BEAOS_AOS_BUNDLE,
			beaos_aos_bundle(
				$assets,
				(string) $man['bundle_sha256'],
				time(),
				'ok',
				beaos_aos_discarded_message( $bad )
			),
			false
		);
		return true;
	} finally {
		// El `finally` no se toca: es lo que garantiza que el candado se suelte también cuando la corrida
		// falla, cuando el MCP tira una excepción o cuando un `return` temprano corta el camino.
		beaos_aos_lock_release( $lock );
	}
}

/** El asset de una ruta, re-verificado contra su sha256 al servir, o `null`. */
function beaos_aos_asset( $path ) {
	$b      = get_option( BEAOS_AOS_BUNDLE );
	$stored = is_array( $b ) && isset( $b['assets'][ $path ] ) ? $b['assets'][ $path ] : null;
	return beaos_aos_stored_asset( $stored );
}

// ── El servido ──────────────────────────────────────────────────────────────────────────────────
//
// Se engancha en `init`, antes de que WordPress resuelva la request: así gana a `do_robots()`, a los
// sitemaps del core y al 404 de `/.well-known/*`. Lo que no está en el manifiesto queda para el core.

add_action(
	'init',
	function () {
		beaos_aos_schedule();

		$method = isset( $_SERVER['REQUEST_METHOD'] ) ? (string) $_SERVER['REQUEST_METHOD'] : 'GET';
		if ( 'GET' !== $method && 'HEAD' !== $method ) {
			return;
		}
		$o = beaos_aos_opts();
		if ( empty( $o['enabled'] ) ) {
			return;
		}

		$uri  = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/';
		$path = beaos_aos_route_path( $uri, (string) wp_parse_url( home_url(), PHP_URL_PATH ) );

		// La lista blanca manda también acá, y no sólo al sincronizar: una copia local que ya tenía una
		// ruta peligrosa (una versión vieja del plugin, la opción escrita a mano) **no se sirve**.
		// Si esa ruta está guardada, además se anota: es el caso en el que alguien está golpeando una
		// puerta que el plugin se niega a abrir, y el log tiene que poder contarlo.
		if ( ! beaos_aos_claimable_path( $path ) ) {
			if ( beaos_aos_denied_path( $path ) ) {
				beaos_aos_log_rejected_route( $path, beaos_aos_rejection_reason( $path ), true );
			}
			return;
		}

		// Dos plugins no pueden ser dueños de `/llms.txt` a la vez. Si el plugin de Autex está activo,
		// su kit manda y el nuestro no toca nada: mezclar los dos archivos sería servir un kit que no
		// firmó nadie. El panel lo dice con todas las letras.
		if ( function_exists( 'autex_aos_asset' ) ) {
			return;
		}

		$asset = beaos_aos_asset( $path );
		if ( null === $asset ) {
			return;
		}

		// Un plugin de caché o de minificado que abrió un buffer no puede inyectar bytes en el archivo.
		while ( ob_get_level() ) {
			ob_end_clean();
		}
		status_header( 200 );
		header( 'Content-Type: ' . $asset['type'] );
		header( 'Content-Length: ' . strlen( $asset['body'] ) );
		header( 'X-BeAOS-Sha256: ' . $asset['sha256'] );
		header( 'Cache-Control: public, max-age=300, no-transform' );
		header( 'X-Content-Type-Options: nosniff' );
		header( 'Access-Control-Allow-Origin: *' );
		if ( 'HEAD' !== $method ) {
			echo $asset['body']; // phpcs:ignore WordPress.Security.EscapeOutput -- bytes verificados, tal cual
		}
		exit;
	},
	0
);

/** Agenda el cron del kit si no está agendado. Se llama en `init` y al activar. */
function beaos_aos_schedule() {
	if ( ! wp_next_scheduled( BEAOS_AOS_CRON ) ) {
		wp_schedule_event( time(), 'hourly', BEAOS_AOS_CRON );
	}
}

add_action( BEAOS_AOS_CRON, 'beaos_aos_sync' );

/**
 * Al guardar los ajustes se sincroniza de una vez, sin esperar al cron.
 *
 * El callback no recibe argumentos a propósito: `update_option_<opción>` pasa `($old, $new)` y
 * `beaos_aos_sync( $force = false )` tomaría el valor viejo como `$force`.
 */
function beaos_aos_sync_on_save() {
	beaos_aos_sync( true );
}

add_action( 'update_option_' . BEAOS_AOS_OPTION, 'beaos_aos_sync_on_save' );
add_action( 'add_option_' . BEAOS_AOS_OPTION, 'beaos_aos_sync_on_save' );

register_activation_hook(
	__FILE__,
	function () {
		beaos_aos_schedule();
	}
);

// Desactivar no puede dejar trabajo agendado dando vueltas, ni el candado tomado: un candado huérfano
// trabaría la próxima activación hasta que venza.
register_deactivation_hook(
	__FILE__,
	function () {
		wp_clear_scheduled_hook( BEAOS_AOS_CRON );
		beaos_aos_lock_release_all();
	}
);

// ── Los ajustes ─────────────────────────────────────────────────────────────────────────────────

add_action(
	'admin_init',
	function () {
		register_setting(
			'beaos_aos',
			BEAOS_AOS_OPTION,
			array(
				'type'              => 'array',
				// El saneo de verdad vive en `beaos_aos_settings()` (puro y probado); acá sólo se le pasa
				// un escapado de WordPress por encima a lo que sale.
				'sanitize_callback' => function ( $in ) {
					$clean = beaos_aos_settings( is_array( $in ) ? $in : array(), beaos_aos_opts() );
					foreach ( array( 'brand_id', 'entity_id', 'name', 'category', 'token' ) as $key ) {
						$clean[ $key ] = sanitize_text_field( $clean[ $key ] );
					}
					$clean['mcp'] = esc_url_raw( $clean['mcp'], array( 'https' ) );
					$clean['api'] = esc_url_raw( $clean['api'], array( 'https' ) );
					return $clean;
				},
			)
		);

		// "Sincronizar ahora": el cron de WordPress necesita tráfico, así que hace falta un botón.
		if ( isset( $_GET['beaos-aos-sync'] ) && current_user_can( 'manage_options' ) ) {
			check_admin_referer( 'beaos_aos_sync' );
			beaos_aos_sync( true );
			wp_safe_redirect( add_query_arg( array( 'page' => BEAOS_AOS_PAGE, 'beaos-aos-synced' => 1 ), admin_url( 'options-general.php' ) ) );
			exit;
		}
	}
);

add_action(
	'admin_menu',
	function () {
		add_options_page( 'BeAOS by Believe', 'BeAOS by Believe', 'manage_options', BEAOS_AOS_PAGE, 'beaos_aos_settings_page' );
	}
);

/** El estado del kit y de la conexión, en una línea, para el pie del panel. */
function beaos_aos_state_line() {
	$b = get_option( BEAOS_AOS_BUNDLE );
	if ( ! is_array( $b ) || ! isset( $b['state'] ) || 'empty' === $b['state'] ) {
		return 'Kit: sin sincronizar todavía.';
	}
	// Las rutas que la lista blanca ya no acepta pero que siguen guardadas. El plugin no las sirve, y
	// esto es lo que hace que se vean sin tener que leer el log.
	$rechazadas = beaos_aos_rejected_assets( isset( $b['assets'] ) ? $b['assets'] : array() );
	$aviso      = $rechazadas
		? ' ' . sprintf(
			'%d ruta(s) rechazadas por la lista blanca, que NO se sirven: %s.',
			count( $rechazadas ),
			implode( ', ', array_slice( $rechazadas, 0, 5 ) ) . ( count( $rechazadas ) > 5 ? ', …' : '' )
		)
		: '';

	switch ( $b['state'] ) {
		case 'unpublished':
			return 'Kit: la entidad no está publicada en BeAOS, así que no hay nada para servir. Se publica con el asistente o desde el panel de BeAOS.' . $aviso;
		case 'error':
			return 'Kit: no se pudo sincronizar. Se sigue sirviendo la copia anterior. Último error: ' . $b['error'] . $aviso;
		default:
			$n = is_array( $b['assets'] ) ? count( $b['assets'] ) : 0;
			return sprintf( 'Kit: %d archivos, sincronizado %s.', $n, $b['synced_at'] )
				. ( '' !== $b['error'] ? ' ' . ucfirst( $b['error'] ) : '' )
				. $aviso;
	}
}

function beaos_aos_settings_page() {
	$o = beaos_aos_opts();
	$n = BEAOS_AOS_OPTION;
	?>
	<div class="wrap">
		<h1>BeAOS by Believe</h1>

		<?php if ( isset( $_GET['beaos-aos-synced'] ) ) : ?>
			<div class="notice notice-info"><p><?php echo esc_html( beaos_aos_state_line() ); ?></p></div>
		<?php endif; ?>

		<?php if ( function_exists( 'autex_aos_asset' ) ) : ?>
			<div class="notice notice-warning">
				<p><strong>El plugin Autex AOS está activo.</strong> Los dos quieren servir las mismas rutas
				(<code>/llms.txt</code>, <code>/AGENTS.md</code>, <code>/.well-known/brand.json</code>).
				Mientras Autex esté activo, este plugin <strong>no sirve el kit</strong>: dos kits mezclados
				serían un kit que no firmó nadie. Desactivá uno de los dos.</p>
			</div>
		<?php endif; ?>

		<form method="post" action="options.php">
			<?php settings_fields( 'beaos_aos' ); ?>

			<h2>1 · Conexión</h2>
			<p class="description">El asistente de 3 pasos todavía no está: falta elegir el flujo con el que
			BeAOS le entrega la credencial al sitio. Mientras tanto, el camino manual funciona: creá un token
			por producto con <code>scripts/beaos-token.sh create wordpress-tu-sitio</code> en BeAOS, sacá el
			<code>entityId</code> con <code>get_brand</code> y pegá los dos acá.</p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="beaos-token">Token del producto</label></th>
					<td>
						<input id="beaos-token" class="regular-text" type="password" autocomplete="new-password" name="<?php echo esc_attr( $n ); ?>[token]" value="">
						<p class="description"><?php echo '' === $o['token'] ? 'Sin token guardado.' : 'Hay un token guardado. Dejalo vacío para conservarlo.'; ?>
						Nunca se imprime en el navegador. Tiene que ser un token <strong>por producto</strong> de
						BeAOS, no una llave maestra: una llave maestra abre todas las marcas y no se puede revocar
						por sitio.</p>
					</td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-brand-id">Id de la marca</label></th>
					<td><input id="beaos-brand-id" class="regular-text" name="<?php echo esc_attr( $n ); ?>[brand_id]" value="<?php echo esc_attr( $o['brand_id'] ); ?>">
						<p class="description">Lo devuelve <code>ensure_brand</code>. Ejemplo: <code>perez-com</code>.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-entity-id">Entity id</label></th>
					<td><input id="beaos-entity-id" class="regular-text" name="<?php echo esc_attr( $n ); ?>[entity_id]" value="<?php echo esc_attr( $o['entity_id'] ); ?>">
						<p class="description">El UUID de la entidad, que sale de <code>get_brand</code>. Sin esto
						no hay a quién pedirle el kit.</p></td>
				</tr>
			</table>

			<h2>2 · La marca</h2>
			<p class="description">Los completa el asistente cuando esté. Se guardan acá para que el alta no
			dependa de recordar qué se escribió.</p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="beaos-name">Nombre</label></th>
					<td><input id="beaos-name" class="regular-text" name="<?php echo esc_attr( $n ); ?>[name]" value="<?php echo esc_attr( $o['name'] ); ?>"></td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-website">Web</label></th>
					<td><input id="beaos-website" class="regular-text" type="url" name="<?php echo esc_attr( $n ); ?>[website]" value="<?php echo esc_attr( $o['website'] ); ?>" placeholder="<?php echo esc_attr( home_url() ); ?>">
						<p class="description">Su host es la clave de idempotencia de la marca: la misma web no
						crea una marca dos veces.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-category">Categoría</label></th>
					<td><input id="beaos-category" class="regular-text" name="<?php echo esc_attr( $n ); ?>[category]" value="<?php echo esc_attr( $o['category'] ); ?>" placeholder="Automotriz">
						<?php if ( '' === $o['category'] ) : ?>
							<p class="description"><strong>Sin categoría declarada</strong>, BeAOS no puede calibrar
							la biblioteca de preguntas de compra y la corta antes de generar: el APS queda sin
							medir. Si se fuerza igual, se calibra con el marcador genérico
							<code>marketing/software</code> y los prompts salen generales. La categoría no cambia
							los archivos del kit: cambia el instrumento con el que se mide.</p>
						<?php else : ?>
							<p class="description">Calibra la biblioteca de preguntas de compra del APS. Manda sobre
							el <code>industry</code> del DNA de Maasy.</p>
						<?php endif; ?>
					</td>
				</tr>
			</table>

			<h2>3 · El kit</h2>
			<?php
			$missing = beaos_aos_missing( $o );
			if ( $missing ) {
				printf(
					'<div class="notice notice-warning inline"><p>Conexión incompleta: falta %s. El kit no se puede sincronizar sin eso.</p></div>',
					esc_html( implode( ' y ', $missing ) )
				);
			}
			?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row">Activo</th>
					<td><label><input type="checkbox" name="<?php echo esc_attr( $n ); ?>[enabled]" value="1" <?php checked( $o['enabled'], 1 ); ?>> Sincronizar y servir el kit en este sitio</label></td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-mcp">Endpoint del MCP</label></th>
					<td><input id="beaos-mcp" class="regular-text" type="url" name="<?php echo esc_attr( $n ); ?>[mcp]" value="<?php echo esc_attr( $o['mcp'] ); ?>">
						<p class="description">Solo https. Vacío: el MCP de BeAOS.</p></td>
				</tr>
				<tr>
					<th scope="row"><label for="beaos-api">Base de BeAOS</label></th>
					<td><input id="beaos-api" class="regular-text" type="url" name="<?php echo esc_attr( $n ); ?>[api]" value="<?php echo esc_attr( $o['api'] ); ?>">
						<p class="description">Para los enlaces al panel. Solo https.</p></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<p><?php echo esc_html( beaos_aos_state_line() ); ?></p>
		<p><a class="button" href="<?php echo esc_url( wp_nonce_url( add_query_arg( array( 'page' => BEAOS_AOS_PAGE, 'beaos-aos-sync' => 1 ), admin_url( 'options-general.php' ) ), 'beaos_aos_sync' ) ); ?>">Sincronizar ahora</a></p>
		<p class="description">El cron de WordPress corre cada hora, pero sólo cuando alguien visita el sitio:
		sin tráfico, no hay sincronización. Después de sincronizar, vaciá la caché de página (WP Rocket,
		LiteSpeed, Cloudflare APO) o el kit viejo se sigue sirviendo desde la caché.</p>
	</div>
	<?php
}
