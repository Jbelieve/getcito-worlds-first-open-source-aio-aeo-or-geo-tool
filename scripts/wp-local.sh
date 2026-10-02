#!/usr/bin/env bash
#
# WordPress local de BeAOS — levantar, parar y usar el entorno de pruebas del plugin `beaos-aos`.
#
#   scripts/wp-local.sh start     # levanta `php -S` en el primer puerto libre desde 8080
#   scripts/wp-local.sh stop      # lo mata
#   scripts/wp-local.sh restart
#   scripts/wp-local.sh status    # puerto, PID, versiones y si el kit se sirve
#   scripts/wp-local.sh wp plugin list    # cualquier comando de wp-cli adentro del entorno
#
# El entorno vive en `.wp-local/`, que está en el `.gitignore`: es un WordPress completo (core, base
# SQLite, plugins, contenido) y no entra al repo.
#
# Credenciales del admin (es local, no son un secreto real):  beaos / beaos-local-2026
#
# WordPress 7.1.2 en es_ES, con el feature-plugin oficial `sqlite-database-integration` y el drop-in
# `wp-content/db.php`: no hay servidor de base, ni puerto, ni usuario que levantar.
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
WP="$REPO/.wp-local"
PID_FILE="$WP/.server.pid"
PORT_FILE="$WP/.server.port"
LOG_FILE="$WP/.server.log"
DEFAULT_PORT=8080

die() { printf 'error: %s\n' "$*" >&2; exit 1; }

# ── utilidades ──────────────────────────────────────────────────────────────────────────────────

port_free() {
	(echo > "/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1 && return 1 || return 0
}

servidor_pid() {
	[ -f "$PID_FILE" ] || return 1
	local pid
	pid="$(cat "$PID_FILE" 2>/dev/null || true)"
	[ -n "$pid" ] || return 1
	kill -0 "$pid" 2>/dev/null || return 1
	printf '%s' "$pid"
}

servidor_puerto() {
	[ -f "$PORT_FILE" ] && cat "$PORT_FILE" 2>/dev/null || printf '%s' "$DEFAULT_PORT"
}

check_php() {
	command -v php >/dev/null 2>&1 || die "no hay php en el PATH"

	# Ojo: `php -m | grep -q` con pipefail da un falso "falta" (grep -q corta y php -m muere por
	# SIGPIPE, así que la tubería entera falla). Por eso la lista se captura primero.
	local mods faltan=() sin_imagen=()
	mods="$(php -m | tr '[:upper:]' '[:lower:]')"

	# Las que el plugin necesita de verdad.
	for ext in pdo_sqlite sqlite3 mbstring curl; do
		grep -qx "$ext" <<<"$mods" || faltan+=("$ext")
	done
	if [ "${#faltan[@]}" -gt 0 ]; then
		die "faltan extensiones de PHP: ${faltan[*]}"
	fi

	# gd o imagick: el plugin de hoy sólo sirve texto y no usa ninguna, pero el entorno las pide por si
	# mañana el kit trae imágenes. Se avisa, no se corta.
	if ! grep -qx gd <<<"$mods" && ! grep -qx imagick <<<"$mods"; then
		printf 'aviso: no hay ni gd ni imagick. El plugin no las usa hoy (sólo sirve texto).\n' >&2
	fi
}

check_entorno() {
	[ -d "$WP" ] || die "no existe $WP. El entorno se arma una sola vez; ver PLUGIN-WORDPRESS-BEAOS.md."
	[ -f "$WP/wp-config.php" ] || die "no existe $WP/wp-config.php"
	[ -f "$WP/wp-content/db.php" ] || die "falta el drop-in $WP/wp-content/db.php (SQLite)"
}

# ── comandos ─────────────────────────────────────────────────────────────────────────────────────

cmd_start() {
	check_php
	check_entorno

	if pid="$(servidor_pid)"; then
		printf 'ya estaba corriendo: pid %s en http://127.0.0.1:%s\n' "$pid" "$(servidor_puerto)"
		return 0
	fi

	local port="$DEFAULT_PORT" intento=0
	while ! port_free "$port"; do
		intento=$((intento + 1))
		[ "$intento" -gt 40 ] && die "no encontre un puerto libre entre $DEFAULT_PORT y $((DEFAULT_PORT + 40))"
		port=$((port + 1))
	done

	# El comando exacto, tal cual: el server embebido de PHP cae a index.php cuando la ruta no es un
	# archivo, que es lo que hace falta para que /llms.txt y /.well-known/* lleguen a WordPress.
	nohup php -S "127.0.0.1:$port" -t "$WP" > "$LOG_FILE" 2>&1 &
	local pid=$!
	printf '%s' "$pid" > "$PID_FILE"
	printf '%s' "$port" > "$PORT_FILE"

	local i=0
	while [ "$i" -lt 40 ]; do
		if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:$port/"; then
			break
		fi
		sleep 0.25
		i=$((i + 1))
	done

	printf 'Levantado.  pid %s\n' "$pid"
	printf 'Sitio:      http://127.0.0.1:%s\n' "$port"
	printf 'Admin:      http://127.0.0.1:%s/wp-admin/  (beaos / beaos-local-2026)\n' "$port"
	printf 'Log:        %s\n' "$LOG_FILE"
	printf '\nComando exacto para levantarlo a mano:\n'
	printf '  php -S 127.0.0.1:%s -t .wp-local\n' "$port"
}

cmd_stop() {
	if pid="$(servidor_pid)"; then
		kill "$pid" 2>/dev/null || true
		local i=0
		while kill -0 "$pid" 2>/dev/null && [ "$i" -lt 20 ]; do
			sleep 0.25
			i=$((i + 1))
		done
		kill -9 "$pid" 2>/dev/null || true
		printf 'parado: pid %s\n' "$pid"
	else
		printf 'no habia ningun servidor del entorno corriendo\n'
	fi
	rm -f "$PID_FILE" "$PORT_FILE"
}

cmd_status() {
	check_entorno
	if pid="$(servidor_pid)"; then
		printf 'servidor : corriendo (pid %s)\n' "$pid"
	else
		printf 'servidor : parado\n'
	fi
	local port
	port="$(servidor_puerto)"
	printf 'puerto   : %s\n' "$port"
	printf 'php      : %s\n' "$(php -r 'echo PHP_VERSION;')"
	printf 'wordpress: %s\n' "$(php -r '
		$f = "'"$WP"'/wp-includes/version.php";
		$src = is_file($f) ? file_get_contents($f) : "";
		echo preg_match("/\\\$wp_version = '\''([^'\'']+)'\''/", $src, $m) ? $m[1] : "(desconocida)";
	')"
	printf 'entorno  : %s\n' "$WP"

	if [ -f "$WP/expected-manifest.json" ]; then
		printf 'kit      : %s\n' "$(
			python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["assets"]), "assets en el manifiesto sembrado")' \
				"$WP/expected-manifest.json" 2>/dev/null || echo "(no pude leer el manifiesto)"
		)"
	fi

	if pid="$(servidor_pid)"; then
		printf '\nultimas lineas del log:\n'
		tail -5 "$LOG_FILE" 2>/dev/null | sed 's/^/  /' || true
	fi
}

case "${1:-}" in
	start) shift; cmd_start "$@" ;;
	stop) shift; cmd_stop "$@" ;;
	restart) cmd_stop; cmd_start ;;
	status) shift; cmd_status "$@" ;;
	wp) shift; exec "$WP/bin/wp" "$@" ;;
	"")
		cat <<'AYUDA'
WordPress local de BeAOS — levantar, parar y usar el entorno de pruebas del plugin `beaos-aos`.

  scripts/wp-local.sh start     # levanta `php -S` en el primer puerto libre desde 8080
  scripts/wp-local.sh stop      # lo mata
  scripts/wp-local.sh restart
  scripts/wp-local.sh status    # puerto, PID, versiones y si el kit se sirve
  scripts/wp-local.sh wp plugin list    # cualquier comando de wp-cli adentro del entorno

El entorno vive en `.wp-local/`, que está en el `.gitignore`: es un WordPress completo (core, base
SQLite, plugins, contenido) y no entra al repo.

Credenciales del admin (es local, no son un secreto real):  beaos / beaos-local-2026

WordPress 7.1.2 en es_ES, con el feature-plugin oficial `sqlite-database-integration` y el drop-in
`wp-content/db.php`: no hay servidor de base, ni puerto, ni usuario que levantar.
AYUDA
		;;
	*) die "comando desconocido: $1 (usá start, stop, restart, status o wp)" ;;
esac
