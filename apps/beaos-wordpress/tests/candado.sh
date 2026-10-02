#!/usr/bin/env bash
#
# El candado del sync, como ASERCIÓN.
#
# La medición anterior de esto era una moneda al aire: corría dos sync en paralelo y **contaba** las
# llamadas al MCP ("1 o 2"), sin afirmar nada. Un diagnóstico, no un test. Acá el conteo es una
# aserción y el script sale distinto de cero cuando el candado no encierra.
#
# Qué mide, y por qué cada cosa:
#
#   1 · CONCURRENCIA: N=10 procesos pegándole al mismo candado en el MISMO instante (una barrera de
#       reloj compartida), contra un MCP mockeado que tarda 4 s. Se afirma que al MCP llegó
#       **exactamente 1** llamada. Con el candado viejo (`get_transient` + `set_transient`) esto falla.
#       La barrera es lo que hace que el test pruebe el candado y no el tiempo de arranque de `wp`:
#       sin ella, el candado viejo podría pasar por suerte de timing, que es exactamente el bug.
#   2 · LIBRE AL TERMINAR: después de la ronda, el candado no puede quedar tomado (el `finally`).
#   3 · CONTROL NEGATIVO: con el candado tomado a mano, un sync llega 0 veces al MCP.
#   4 · VENCIDO: un candado de un proceso que se murió (nadie lo suelta) vence y el sync siguiente lo
#       vuelve a tomar. Sin vencimiento, el cron quedaría muerto para siempre.
#
# Se corre N_RONDAS veces (por defecto 20) y se informa **cuántas fallaron**. Un candado que pasa 19 de
# 20 no es atómico, y el reporte lo dice.
#
# Uso:
#   apps/beaos-wordpress/tests/candado.sh [WP_DIR] [N_PROCESOS] [N_RONDAS]
#
#   WP_DIR      el WordPress real, con su `wp` de wp-cli. Por defecto <repo>/.wp-local, que NO está en
#               el repo (es un WordPress completo, ver PLUGIN-WORDPRESS-BEAOS.md). Sin él este test no
#               se puede correr: la atomicidad de un candado no se prueba con un mock de la base.
#   N_PROCESOS  corridas en paralelo por ronda. Por defecto 10.
#   N_RONDAS    rondas. Por defecto 20.
#
# El plugin que se instala sale de $BEAOS_PLUGIN_SRC (por defecto, el del repo). Eso es lo que permite
# mostrar el ROJO con el candado viejo, sin tocar el working tree:
#
#   mkdir -p /tmp/beaos-plugin-viejo
#   for f in beaos-aos.php beaos-aos-pure.php class-beaos-mcp.php uninstall.php; do
#       git show master:apps/beaos-wordpress/$f > /tmp/beaos-plugin-viejo/$f
#   done
#   BEAOS_PLUGIN_SRC=/tmp/beaos-plugin-viejo apps/beaos-wordpress/tests/candado.sh .wp-local 10 20
#
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
REPO="$(cd "$APP/../.." && pwd)"

WP="${1:-$REPO/.wp-local}"
N_PROCESOS="${2:-10}"
N_RONDAS="${3:-20}"
SRC="${BEAOS_PLUGIN_SRC:-$APP}"

WPCLI="$WP/bin/wp"
[ -x "$WPCLI" ] || { printf 'error: no existe %s. El WordPress local se arma una sola vez: ver PLUGIN-WORDPRESS-BEAOS.md\n' "$WPCLI" >&2; exit 1; }
[ -f "$SRC/beaos-aos.php" ] || { printf 'error: no encuentro el plugin en %s\n' "$SRC" >&2; exit 1; }

DEST="$WP/wp-content/plugins/beaos-aos"
MU="$WP/wp-content/mu-plugins"
MOCK="$MU/beaos-mock-candado.php"
LOG="$WP/.mock-mcp.log"
SALIDA="$WP/checks-candado"
mkdir -p "$SALIDA"

# ── El MCP mockeado ─────────────────────────────────────────────────────────────────────────────
#
# Devuelve un manifiesto VACÍO (`assets: []`) a propósito: así cada corrida que pasa el candado hace
# exactamente UNA llamada al MCP, y contar llamadas es contar corridas que entraron. El `sleep` es lo
# que mantiene la ventana de concurrencia abierta de verdad.

mkdir -p "$MU"
sed "s|__BEAOS_LOG__|$LOG|" > "$MOCK" <<'PHP'
<?php
/**
 * MU-PLUGIN DE PRUEBA del test del candado. No es parte del plugin.
 * Lo escribe `apps/beaos-wordpress/tests/candado.sh` y lo borra al terminar.
 */
defined( 'ABSPATH' ) || exit;

const BEAOS_MOCK_DELAY = 4;

add_filter(
	'pre_http_request',
	function ( $preempt, $parsed_args, $url ) {
		if ( ! is_string( $url ) || ! str_contains( $url, 'beaos.believe-global.com' ) ) {
			return $preempt;
		}
		file_put_contents( '__BEAOS_LOG__', getmypid() . "\n", FILE_APPEND );
		sleep( BEAOS_MOCK_DELAY );

		return array(
			'headers'  => array(),
			'body'     => wp_json_encode(
				array(
					'jsonrpc' => '2.0',
					'id'      => 1,
					'result'  => array(
						'content'           => array( array( 'type' => 'text', 'text' => '{"published":true,"assets":[]}' ) ),
						'structuredContent' => array(
							'published'    => true,
							'bundleSha256' => 'mock',
							'assets'       => array(),
						),
					),
				)
			),
			'response' => array(
				'code'    => 200,
				'message' => 'OK',
			),
			'cookies'  => array(),
			'filename' => null,
		);
	},
	10,
	3
);
PHP

limpiar() {
	rm -f "$MOCK"
	rmdir "$MU" 2>/dev/null || true
	rm -f "$LOG"
	"$WPCLI" eval 'beaos_aos_lock_release_all();' >/dev/null 2>&1 || true
	"$WPCLI" option delete beaos_aos >/dev/null 2>&1 || true
	"$WPCLI" option delete beaos_aos_bundle >/dev/null 2>&1 || true
	[ -f "$WP/seed-kit.php" ] && "$WPCLI" eval-file "$WP/seed-kit.php" >/dev/null 2>&1
	return 0
}
trap limpiar EXIT

# ── El plugin, de la fuente que se pida ──────────────────────────────────────────────────────────

mkdir -p "$DEST/tests"
for f in beaos-aos.php beaos-aos-pure.php class-beaos-mcp.php uninstall.php; do
	cp "$SRC/$f" "$DEST/$f"
done
printf 'plugin instalado desde %s\n' "$SRC"
printf '  beaos-aos.php      sha256=%s\n' "$(shasum -a 256 < "$DEST/beaos-aos.php" | cut -d' ' -f1)"
printf '  beaos-aos-pure.php sha256=%s\n' "$(shasum -a 256 < "$DEST/beaos-aos-pure.php" | cut -d' ' -f1)"

# El candado viejo no tiene estas funciones: el test lo dice y saltea los casos 2-4 en vez de romperse.
tiene_api=0
if "$WPCLI" eval 'echo function_exists("beaos_aos_lock_acquire") ? "si" : "no";' 2>/dev/null | grep -q si; then
	tiene_api=1
fi

# ── Arnés ───────────────────────────────────────────────────────────────────────────────────────
#
# El plugin se desactiva para escribir los ajustes: `update_option(BEAOS_AOS_OPTION)` dispara un sync,
# y con el mock ya puesto esa corrida de más ensuciaría el primer conteo.

"$WPCLI" plugin deactivate beaos-aos >/dev/null 2>&1 || true
"$WPCLI" option update beaos_aos \
	'{"enabled":1,"token":"token-de-prueba","entity_id":"00000000-0000-4000-8000-000000000001","mcp":"https://beaos.believe-global.com/mcp","api":"https://beaos.believe-global.com"}' \
	--format=json >/dev/null
"$WPCLI" plugin activate beaos-aos >/dev/null

printf 'candado atómico disponible: %s\n' "$( [ "$tiene_api" -eq 1 ] && echo 'sí' || echo 'NO (candado viejo: se corren sólo los casos de concurrencia)' )"
printf 'MCP mockeado en %s (cada corrida que entra tarda %s s)\n' "$MOCK" 4
printf 'concurrencia: %s procesos × %s rondas\n\n' "$N_PROCESOS" "$N_RONDAS"

fallos_concurrencia=0
fallos_candado_suelto=0

# El código que corre cada proceso: espera la barrera y sincroniza.
SYNC_CODE='$b=getenv("BEAOS_CANDADO_BARRERA"); if($b){ while(microtime(true) < (float)$b){ usleep(200); } } beaos_aos_sync(true);'

for ronda in $(seq 1 "$N_RONDAS"); do
	"$WPCLI" option delete beaos_aos_bundle >/dev/null 2>&1 || true
	if [ "$tiene_api" -eq 1 ]; then
		"$WPCLI" eval 'beaos_aos_lock_release_all();' >/dev/null 2>&1 || true
	else
		"$WPCLI" eval 'delete_transient("beaos_aos_lock");' >/dev/null 2>&1 || true
	fi
	: > "$LOG"

	# La barrera: todos los procesos pegan en la toma del candado en el mismo instante.
	barrera="$(php -r 'printf("%.6f", microtime(true) + 2.5);')"

	for _ in $(seq 1 "$N_PROCESOS"); do
		BEAOS_CANDADO_BARRERA="$barrera" "$WPCLI" eval "$SYNC_CODE" > "$SALIDA/ronda-$ronda-proceso.log" 2>&1 &
	done
	wait

	llamadas="$(wc -l < "$LOG" | tr -d ' ')"
	if [ "$llamadas" = "1" ]; then
		printf '  ronda %2s: llamadas al MCP = %s  ok\n' "$ronda" "$llamadas"
	else
		printf '  ronda %2s: llamadas al MCP = %s  FALLA (el candado dejó entrar %s corridas)\n' "$ronda" "$llamadas" "$llamadas"
		fallos_concurrencia=$((fallos_concurrencia + 1))
	fi

	# 2 · El candado queda libre al terminar la ronda.
	if [ "$tiene_api" -eq 1 ]; then
		estado="$("$WPCLI" eval 'echo beaos_aos_lock_is_locked() ? "TOMADO" : "LIBRE";' 2>/dev/null | tr -d '[:space:]')"
		if [ "$estado" != "LIBRE" ]; then
			printf '        y el candado quedó %s después de la ronda: FALLA (el finally)\n' "$estado"
			fallos_candado_suelto=$((fallos_candado_suelto + 1))
		fi
	fi
done

printf '\n'
printf '══════════════════════════════════════════════════════════════════════\n'
printf 'CONCURRENCIA: %s rondas, %s fallaron\n' "$N_RONDAS" "$fallos_concurrencia"
printf 'LIBRE AL TERMINAR: %s rondas con el candado tomado al cerrar\n' "$fallos_candado_suelto"
printf '══════════════════════════════════════════════════════════════════════\n'

fallos=0
[ "$fallos_concurrencia" -ne 0 ] && fallos=$((fallos + fallos_concurrencia))
[ "$fallos_candado_suelto" -ne 0 ] && fallos=$((fallos + fallos_candado_suelto))

if [ "$tiene_api" -eq 1 ]; then
	printf '\n3 · CONTROL NEGATIVO: con el candado tomado, un sync no puede llegar al MCP\n'
	"$WPCLI" eval 'beaos_aos_lock_release_all(); $e = beaos_aos_lock_acquire( 60 ); var_dump( false !== $e );'
	: > "$LOG"
	"$WPCLI" eval 'beaos_aos_sync( true );' >/dev/null 2>&1
	con_tomado="$(wc -l < "$LOG" | tr -d ' ')"
	printf '  llamadas al MCP con el candado tomado: %s (tiene que ser 0)\n' "$con_tomado"
	[ "$con_tomado" = "0" ] || fallos=$((fallos + 1))
	"$WPCLI" eval 'beaos_aos_lock_release_all();' >/dev/null 2>&1

	printf '\n4 · VENCIDO: el candado de un proceso que se murió se puede volver a tomar\n'
	# Un candado de 1 s que nadie suelta es exactamente el de un proceso muerto: queda la fila.
	"$WPCLI" eval '$e = beaos_aos_lock_acquire( 1 ); echo "candado tomado con vencimiento a 1 s: "; var_export( $e ); echo "\n"; echo "tomado ahora? "; var_dump( beaos_aos_lock_is_locked() );'
	sleep 2
	"$WPCLI" eval 'echo "vencido? "; var_dump( ! beaos_aos_lock_is_locked() );'
	"$WPCLI" option delete beaos_aos_bundle >/dev/null 2>&1 || true
	: > "$LOG"
	"$WPCLI" eval 'beaos_aos_sync( true );' >/dev/null 2>&1
	tras_vencer="$(wc -l < "$LOG" | tr -d ' ')"
	printf '  llamadas al MCP después del vencimiento: %s (tiene que ser 1)\n' "$tras_vencer"
	[ "$tras_vencer" = "1" ] || fallos=$((fallos + 1))
	estado_final="$("$WPCLI" eval 'echo beaos_aos_lock_is_locked() ? "TOMADO" : "LIBRE";' 2>/dev/null | tr -d '[:space:]')"
	printf '  y después de esa corrida el candado quedó: %s (tiene que ser LIBRE)\n' "$estado_final"
	[ "$estado_final" = "LIBRE" ] || fallos=$((fallos + 1))
fi

printf '\n'
if [ "$fallos" -eq 0 ]; then
	printf 'candado: OK (%s rondas de %s procesos, y el candado encierra)\n' "$N_RONDAS" "$N_PROCESOS"
	exit 0
fi
printf 'candado: FALLA (%s)\n' "$fallos"
exit 1
