<?php
/**
 * La desinstalación: lo que un plugin deja atrás cuando alguien lo borra.
 *
 * Un plugin que deja basura es basura, y acá hay dos cosas que no se pueden quedar:
 *   - `beaos_aos` guarda **el token**: dejarlo es dejar una credencial viva en el sitio.
 *   - `beaos_aos_bundle` guarda la copia del kit: decenas de KB de archivos que ya no sirve nadie.
 * Y el evento de cron agendado, que también se limpia al desactivar.
 *
 * Lo que **no** se toca, a propósito: nada del lado de BeAOS. La marca, la entidad, las pruebas, el
 * bundle publicado y el historial se quedan donde están. Desinstalar un plugin de WordPress no puede
 * borrar la evidencia de una marca: sería destructivo y sorpresivo. Lo único que la persona tiene que
 * hacer a mano es **revocar el token** en BeAOS (`scripts/beaos-token.sh revoke <prefijo>`), y eso está
 * dicho en la pantalla de ajustes del plugin.
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

require_once __DIR__ . '/beaos-aos-pure.php';

/** Lo que se borra en un sitio. En multisitio, una vez por sitio: cada uno tiene su propia opción. */
function beaos_aos_uninstall_site() {
	delete_option( BEAOS_AOS_OPTION );
	delete_option( BEAOS_AOS_BUNDLE );
	delete_transient( BEAOS_AOS_LOCK );
	wp_clear_scheduled_hook( BEAOS_AOS_CRON );
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids' ) ) as $beaos_aos_site ) {
		switch_to_blog( (int) $beaos_aos_site );
		beaos_aos_uninstall_site();
		restore_current_blog();
	}
} else {
	beaos_aos_uninstall_site();
}
