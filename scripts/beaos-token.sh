#!/usr/bin/env bash
#
# Administración de las credenciales por producto del MCP de BeAOS — la versión que corre en el servidor.
#
# El script de node (`apps/web/scripts/beaos-tokens.mjs`) hace exactamente lo mismo, pero **no se puede
# correr en contabo-believe**: ese host no tiene `node` ni `psql`, y el contenedor `beaos-web-1`, que sí
# tiene node, es un build (`/app/.output`) sin `apps/web/scripts`. Este script hace el trabajo con lo que
# el servidor sí tiene: bash, openssl y docker —`psql` vive dentro del contenedor de la base—.
#
#   scripts/beaos-token.sh create autex
#   scripts/beaos-token.sh list
#   scripts/beaos-token.sh revoke beaos_ab
#
# El token en claro se imprime **una sola vez**. En la base queda su sha256: si se pierde, no se
# recupera — se revoca y se crea otro. Es a propósito.
#
# El formato es el contrato que valida `apps/web/src/lib/api-tokens.ts`, carácter por carácter:
#
#   token      = "beaos_" + base64url de 24 bytes aleatorios, sin padding (32 caracteres)
#   prefix     = los primeros 8 caracteres del token
#   token_hash = sha256 en hex (utf8) del token
#
# Si el formato cambia acá, tiene que cambiar también en el script de node y en el middleware:
# `apps/web/src/lib/__tests__/beaos-token-scripts.test.ts` corre las dos implementaciones y compara.
#
# Cómo llega a la base: mira la primera sección de código, más abajo.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$HERE/.." >/dev/null 2>&1 && pwd)"

read -r -d '' USAGE <<'TEXTO' || true
Uso:
  scripts/beaos-token.sh create <nombre>   Crea un token para un producto (lo imprime UNA vez)
  scripts/beaos-token.sh list              Lista prefijo, nombre, estado y último uso
  scripts/beaos-token.sh revoke <prefijo>  Revoca un token por su prefijo
  scripts/beaos-token.sh --help

Diagnóstico (no toca la base):
  scripts/beaos-token.sh new-token         Imprime un token con el formato exacto, sin guardarlo
  scripts/beaos-token.sh hash <token>      Imprime "prefijo sha256" de un token

Variables:
  DATABASE_URL        Si falta en el entorno, se lee de apps/web/.env o .env (mismo orden que el script
                      de node). En el servidor es postgres://…@beaos-postgres:5432/getcito.
  BEAOS_DB_CONTAINER  Contenedor donde correr psql, para cuando el host de DATABASE_URL no se llama
                      igual que el contenedor.
TEXTO

fail() {
	printf '%s\n' "$*" >&2
	exit 1
}

# ---------------------------------------------------------------------------------------------
# El token: base64url de 24 bytes, sin padding
# ---------------------------------------------------------------------------------------------
#
# base64 de 24 bytes son 32 caracteres exactos (24 es múltiplo de 3), así que no hay padding que
# sacar; el `tr -d '='` está por si alguna versión de openssl decide agregarlo igual. La verificación
# de largo no es decorativa: si openssl devolviera otra cosa, el token saldría con otro formato y el
# middleware no lo reconocería — mejor fallar acá que escribir una credencial inválida en la base.

generate_token() {
	local raw b64
	raw="$(openssl rand -base64 24 | tr -d '\r\n')"
	b64="$(printf '%s' "$raw" | tr '+/' '-_' | tr -d '=')"
	if [ "${#b64}" -ne 32 ]; then
		fail "generate_token: openssl devolvió ${#b64} caracteres base64url, se esperaban 32 (24 bytes)."
	fi
	printf 'beaos_%s\n' "$b64"
}

# sha256 hex del token, tal cual: `printf '%s'` y no `echo` para no hashear un salto de línea que el
# token no tiene. Es la diferencia entre un token que entra y uno que da 401 sin explicación.
hash_of_token() {
	local token="$1" digest
	digest="$(printf '%s' "$token" | openssl dgst -sha256 -hex | awk '{print $NF}')"
	case "$digest" in
	*[!0-9a-f]* | "") fail "hash_of_token: openssl no devolvió un sha256 en hex válido: $digest" ;;
	esac
	if [ "${#digest}" -ne 64 ]; then
		fail "hash_of_token: openssl devolvió un sha256 de ${#digest} caracteres: $digest"
	fi
	printf '%s\n' "$digest"
}

prefix_of_token() {
	printf '%s' "${1:0:8}"
}

# ---------------------------------------------------------------------------------------------
# Dónde está DATABASE_URL
# ---------------------------------------------------------------------------------------------

# El mismo orden y las mismas reglas que el lector de `.env` del script de node: se ignora lo que
# empieza con `#`, se acepta `export`, se sacan las comillas que envuelven el valor y, si la clave
# aparece dos veces, gana la última.
read_database_url_from() {
	local file="$1" value
	[ -f "$file" ] || return 1
	value="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?DATABASE_URL[[:space:]]*=[[:space:]]*(.*)$/\2/p' "$file" | tail -n 1)"
	[ -n "$value" ] || return 1
	value="${value%"${value##*[![:space:]]}"}"
	case "$value" in
	\"*\") value="${value#\"}" && value="${value%\"}" ;;
	\'*\') value="${value#\'}" && value="${value%\'}" ;;
	esac
	[ -n "$value" ] || return 1
	printf '%s' "$value"
}

resolve_database_url() {
	if [ -n "${DATABASE_URL:-}" ]; then
		printf '%s' "$DATABASE_URL"
		return 0
	fi
	local file value
	for file in "apps/web/.env" ".env" "apps/web/.env.local" ".env.local"; do
		if value="$(read_database_url_from "$REPO_ROOT/$file")"; then
			printf '%s' "$value"
			return 0
		fi
	done
	fail "Falta DATABASE_URL. Definila en el entorno o en apps/web/.env / .env (mirá: $REPO_ROOT/.env)."
}

# El nombre del host de la URL, que en este despliegue es el nombre del contenedor de la base
# (`beaos-postgres`). No se usa para conectarse: se usa para saber dónde está el `psql`.
host_of_url() {
	local url="$1"
	if [[ "$url" =~ ^[A-Za-z0-9+.-]+://([^@/?#]*@)?([^/:?]+) ]]; then
		printf '%s' "${BASH_REMATCH[2]}"
		return 0
	fi
	return 1
}

# ---------------------------------------------------------------------------------------------
# Cómo se llega a la base (esto es lo que la documentación del MCP no decía)
# ---------------------------------------------------------------------------------------------
#
# En el servidor, `node` y `psql` no existen en el host, así que la base se alcanza entrando al
# contenedor que la corre:
#
#   docker exec -i beaos-postgres psql "$DATABASE_URL"
#
# El contenedor no es un literal de este script: sale del host de `DATABASE_URL`, que en el despliegue
# es `beaos-postgres` (`postgres://postgres:postgres@beaos-postgres:5432/getcito`). Así, si la base
# cambia de nombre, la conexión sigue a la URL; y se usa la misma cadena que usa la app, sin traducirla.
#
# El primer intento es la URL tal cual, que es lo que funciona en el servidor: el nombre del contenedor
# se resuelve desde adentro del contenedor porque está en la red de compose. El segundo intento —sólo
# si el primero no conecta— reescribe el host al loopback del contenedor (`127.0.0.1:5432`), que dentro
# del contenedor de la base es la base. Eso cubre los dos casos que el nombre no cubre: un contenedor
# en la red `bridge` por defecto, donde docker no resuelve nombres de contenedor, y una URL que apunta
# al puerto publicado del host (`127.0.0.1:15433`, por ejemplo), que desde adentro no existe.
#
# Si algún día se corre desde una máquina que sí tiene `psql`, esa es la vía y no hace falta docker.
# Verificado en contabo-believe: `which node` y `which psql` vacíos (node no está en el host), `docker`,
# `openssl` 3.0.13 y bash 5.2 presentes, y `psql` 18.6 dentro del contenedor.

DB_TRANSPORT=""
DB_CONTAINER=""
DB_URL=""
DB_CONNECT_URL=""

# La URL con el host apuntado al loopback del contenedor. `sslmode` se cae: contra el servidor local de
# un contenedor no hay TLS que negociar, y dejarlo haría fallar el segundo intento por una razón que no
# tiene que ver con el problema que estamos resolviendo.
rewrite_url_for_container() {
	local url="$1"
	local re='^([A-Za-z0-9+.-]+)://(([^@/?#]*)@)?([^/:?]+)(:[0-9]+)?(/([^?]*))?(\?(.*))?$'
	[[ "$url" =~ $re ]] || return 1
	local scheme="${BASH_REMATCH[1]}" creds="${BASH_REMATCH[2]}" db="${BASH_REMATCH[7]:-}" query="${BASH_REMATCH[9]:-}"
	local filtered="" param
	if [ -n "$query" ]; then
		local IFS='&'
		set -f
		for param in $query; do
			case "$param" in sslmode=* | "") continue ;; esac
			filtered="${filtered:+$filtered&}$param"
		done
		set +f
	fi
	if [ -n "$filtered" ]; then
		printf '%s://%s127.0.0.1:5432/%s?%s' "$scheme" "$creds" "$db" "$filtered"
	else
		printf '%s://%s127.0.0.1:5432/%s' "$scheme" "$creds" "$db"
	fi
}

psql_raw() {
	local url="$1"
	shift
	if [ "$DB_TRANSPORT" = "docker" ]; then
		docker exec -i "$DB_CONTAINER" psql "$url" "$@"
	else
		psql "$url" "$@"
	fi
}

url_connects() {
	printf 'select 1;\n' | psql_raw "$1" -q -A -t >/dev/null 2>&1
}

resolve_connection() {
	DB_URL="$(resolve_database_url)"
	local host candidate
	host="$(host_of_url "$DB_URL" || true)"
	candidate="${BEAOS_DB_CONTAINER:-$host}"
	if [ -n "$candidate" ] && command -v docker >/dev/null 2>&1 &&
		[ "$(docker inspect --format '{{.State.Running}}' "$candidate" 2>/dev/null || true)" = "true" ]; then
		DB_TRANSPORT="docker"
		DB_CONTAINER="$candidate"
	elif command -v psql >/dev/null 2>&1; then
		DB_TRANSPORT="local"
	else
		fail "No hay forma de llegar a la base: en este host no hay psql y el host de DATABASE_URL ('${host:-?}') no es un contenedor docker en ejecución.
  Si la base vive en un contenedor con otro nombre, definí BEAOS_DB_CONTAINER=<contenedor>."
	fi

	DB_CONNECT_URL="$DB_URL"
	if [ "$DB_TRANSPORT" != "docker" ] || url_connects "$DB_CONNECT_URL"; then
		return 0
	fi

	local rewritten
	if rewritten="$(rewrite_url_for_container "$DB_URL")" && url_connects "$rewritten"; then
		DB_CONNECT_URL="$rewritten"
		printf 'Aviso: DATABASE_URL no conectó desde el contenedor "%s"; se usó su loopback (127.0.0.1:5432).\n' "$DB_CONTAINER" >&2
		return 0
	fi

	printf 'No se pudo conectar a la base desde el contenedor "%s", ni con DATABASE_URL ni apuntando el host a 127.0.0.1:5432. El error de psql:\n' "$DB_CONTAINER" >&2
	printf 'select 1;\n' | psql_raw "$DB_URL" -q -A -t >/dev/null || true
	exit 1
}

# El SQL entra por stdin; los valores, como variables de psql (`:'nombre'`), que cita psql. Nada de
# interpolar en la cadena de SQL: un nombre con una comilla no tiene que poder romper la consulta.
psql_run() {
	psql_raw "$DB_CONNECT_URL" -v ON_ERROR_STOP=1 "$@"
}

# ---------------------------------------------------------------------------------------------
# Comandos
# ---------------------------------------------------------------------------------------------

cmd_create() {
	local name="${1:-}"
	[ -n "$name" ] || fail "create necesita el nombre del producto, por ejemplo: create autex"
	resolve_connection

	local token hash prefix
	token="$(generate_token)"
	hash="$(hash_of_token "$token")"
	prefix="$(prefix_of_token "$token")"

	if ! printf '%s\n' "insert into agent_api_tokens (name, token_hash, prefix) values (:'name', :'hash', :'prefix');" |
		psql_run -q -A -t -v name="$name" -v hash="$hash" -v prefix="$prefix" >/dev/null; then
		fail "No se pudo guardar el token en agent_api_tokens: no se creó nada y el token generado se descartó."
	fi

	printf 'Token creado para "%s" (prefijo %s).\n\n' "$name" "$prefix"
	printf '  %s\n\n' "$token"
	printf 'Guardalo AHORA: se guardó sólo su sha256 y no se puede volver a mostrar.\n'
	printf 'Para revocarlo: scripts/beaos-token.sh revoke %s\n' "$prefix"
}

cmd_list() {
	resolve_connection
	local sql rows count
	# Mismo listado que el script de node: prefijo, nombre, estado y último uso. Las fechas salen en
	# ISO 8601 UTC con milisegundos, igual que el toISOString() de node.
	sql="$(cat <<'SQL'
select prefix,
       name,
       case
         when revoked_at is null then 'activo'
         else 'revocado ' || to_char(revoked_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       end,
       coalesce(to_char(last_used_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), '—')
from agent_api_tokens
order by created_at desc;
SQL
)"
	rows="$(printf '%s\n' "$sql" | psql_run -q -A -t -F '|')"
	if [ -z "$rows" ]; then
		printf 'No hay tokens creados. El MCP sigue aceptando ADMIN_API_KEYS.\n'
		return 0
	fi
	count="$(printf '%s\n' "$rows" | wc -l | tr -d ' ')"
	printf '%s token(s):\n' "$count"
	printf '%s\n' "$rows" | while IFS='|' read -r prefix name state last_used; do
		printf '  %s  %-12s  %-26s último uso: %s\n' "$prefix" "$name" "$state" "$last_used"
	done
}

cmd_revoke() {
	local prefix="${1:-}"
	[ -n "$prefix" ] || fail "revoke necesita el prefijo del token, por ejemplo: revoke beaos_ab"
	resolve_connection

	local revoked existing
	if ! revoked="$(printf '%s\n' "update agent_api_tokens set revoked_at = now() where prefix = :'p' and revoked_at is null returning name;" |
		psql_run -q -A -t -v p="$prefix")"; then
		fail "No se pudo revocar \"$prefix\"."
	fi

	if [ -n "$revoked" ]; then
		printf '%s\n' "$revoked" | while IFS= read -r name; do
			printf 'Revocado: %s (%s).\n' "$prefix" "$name"
		done
		return 0
	fi

	# Nada activo con ese prefijo. Puede no existir, o puede estar ya revocado: son cosas distintas
	# y conviene decir cuál de las dos es. El prefijo no es único en la tabla, así que puede haber
	# más de una fila.
	existing="$(printf '%s\n' "select name, case when revoked_at is null then 'activo' else 'revocado' end from agent_api_tokens where prefix = :'p';" |
		psql_run -q -A -t -F '|' -v p="$prefix")"
	if [ -z "$existing" ]; then
		fail "No existe ningún token con el prefijo \"$prefix\"."
	fi
	printf '%s\n' "$existing" | while IFS='|' read -r name state; do
		printf 'El token %s (%s) ya estaba %s: no se cambió nada.\n' "$prefix" "$name" "$state"
	done
}

# Diagnóstico para el test de equivalencia de formato: no lee DATABASE_URL ni toca la base.
cmd_hash() {
	local token="${1:-}" prefix hash
	[ -n "$token" ] || fail "hash necesita el token, por ejemplo: hash beaos_ab"
	prefix="$(prefix_of_token "$token")"
	hash="$(hash_of_token "$token")"
	printf '%s %s\n' "$prefix" "$hash"
}

cmd_new_token() {
	generate_token
}

command="${1:-}"
case "$command" in
create) cmd_create "${2:-}" ;;
list) cmd_list ;;
revoke) cmd_revoke "${2:-}" ;;
hash) cmd_hash "${2:-}" ;;
new-token) cmd_new_token ;;
--help | -h | help | "") printf '%s\n' "$USAGE" ;;
*)
	printf 'Comando desconocido: %s\n' "$command" >&2
	printf '%s\n' "$USAGE" >&2
	exit 1
	;;
esac
