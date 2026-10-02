#!/usr/bin/env bash
#
# Administración de los códigos de conexión de BeAOS — la versión que corre en el servidor.
#
# Un código de conexión es lo que viaja a un WordPress ajeno para que su plugin consiga **su** token
# de producto, sin que `ADMIN_API_KEYS` salga nunca de BeAOS. Es de un solo uso y vence: el plugin lo
# canjea una vez en `POST /api/v1/enroll` y guarda el token en `wp_options`.
#
#   scripts/beaos-enroll.sh create <brandId> <entityId> [etiqueta]
#   scripts/beaos-enroll.sh list [brandId]
#   scripts/beaos-enroll.sh revoke <prefijo>
#
# El código en claro se imprime **una sola vez**. En la base queda su sha256: si se pierde, se revoca
# y se genera otro. Es a propósito, igual que en `scripts/beaos-token.sh`.
#
# ## Por qué este script y no el de node
#
# El servidor (`contabo-believe`) **no tiene node ni psql**: tiene bash, openssl y docker, y `psql`
# vive dentro del contenedor de la base. Por eso este script reusa la misma maquinaria de conexión que
# `scripts/beaos-token.sh` —mismo lector de `DATABASE_URL`, mismo `docker exec`, mismos dos intentos de
# URL— y no la reinventa: la sección de abajo es la misma, a propósito, para que los dos scripts se
# lean igual y se arreglen juntos.
#
# ## El formato, que es el contrato
#
# Es el mismo que `apps/web/src/lib/enrollment.ts` y el mismo que el de los tokens:
#
#   código     = "beaos_" + base64url de 24 bytes aleatorios, sin padding (32 caracteres)
#   prefix     = los primeros 8 caracteres del código
#   code_hash  = sha256 en hex (utf8) del código
#
# `apps/web/src/lib/__tests__/beaos-enroll-scripts.test.ts` corre este script y compara su salida con
# la del servidor: si el formato se desincroniza, el test falla.

set -euo pipefail

HERE="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
REPO_ROOT="$(cd -- "$HERE/.." >/dev/null 2>&1 && pwd)"

read -r -d '' USAGE <<'TEXTO' || true
Uso:
  scripts/beaos-enroll.sh create <brandId> <entityId> [etiqueta]
                                            Genera un código de conexión (lo imprime UNA vez).
                                            Vence en 24 h y sirve para UNA marca y UNA entidad.
  scripts/beaos-enroll.sh list [brandId]    Lista prefijo, marca, etiqueta, estado y vencimiento
  scripts/beaos-enroll.sh revoke <prefijo>  Revoca un código que todavía no se canjeó
  scripts/beaos-enroll.sh --help

Diagnóstico (no toca la base):
  scripts/beaos-enroll.sh new-code         Imprime un código con el formato exacto, sin guardarlo
  scripts/beaos-enroll.sh hash <código>     Imprime "prefijo sha256" de un código

Variables:
  DATABASE_URL        Si falta en el entorno, se lee de apps/web/.env o .env (mismo orden que
                      scripts/beaos-token.sh). En el servidor es postgres://…@beaos-postgres:5432/getcito.
  BEAOS_DB_CONTAINER  Contenedor donde correr psql, para cuando el host de DATABASE_URL no se llama
                      igual que el contenedor.
TEXTO

fail() {
	printf '%s\n' "$*" >&2
	exit 1
}

# ---------------------------------------------------------------------------------------------
# El código: base64url de 24 bytes, sin padding
# ---------------------------------------------------------------------------------------------
#
# Idéntico a `generate_token` de beaos-token.sh: base64 de 24 bytes son 32 caracteres exactos (24 es
# múltiplo de 3), así que no hay padding que sacar; el `tr -d '='` está por si alguna versión de
# openssl decide agregarlo igual. La verificación de largo no es decorativa: si openssl devolviera otra
# cosa, el código saldría con otro formato y el endpoint no lo reconocería — mejor fallar acá que
# escribir un código inválido en la base.
#
# Los 24 bytes no son un detalle: son 192 bits de entropía, que es lo que hace que adivinar un código
# no sea viable. El límite por IP del endpoint frena la fuerza bruta; esto hace que no haya nada que
# frenar.

generate_code() {
	local raw b64
	raw="$(openssl rand -base64 24 | tr -d '\r\n')"
	b64="$(printf '%s' "$raw" | tr '+/' '-_' | tr -d '=')"
	if [ "${#b64}" -ne 32 ]; then
		fail "generate_code: openssl devolvió ${#b64} caracteres base64url, se esperaban 32 (24 bytes)."
	fi
	printf 'beaos_%s\n' "$b64"
}

# sha256 hex del código, tal cual: `printf '%s'` y no `echo` para no hashear un salto de línea que el
# código no tiene. Es la diferencia entre un código que canjea y uno que da 400 sin explicación.
hash_of_code() {
	local code="$1" digest
	digest="$(printf '%s' "$code" | openssl dgst -sha256 -hex | awk '{print $NF}')"
	case "$digest" in
	*[!0-9a-f]* | "") fail "hash_of_code: openssl no devolvió un sha256 en hex válido: $digest" ;;
	esac
	if [ "${#digest}" -ne 64 ]; then
		fail "hash_of_code: openssl devolvió un sha256 de ${#digest} caracteres: $digest"
	fi
	printf '%s\n' "$digest"
}

prefix_of_code() {
	printf '%s' "${1:0:8}"
}

# ---------------------------------------------------------------------------------------------
# Dónde está DATABASE_URL
# ---------------------------------------------------------------------------------------------
#
# La misma sección de `scripts/beaos-token.sh`, copiada a propósito: mismo orden de archivos, mismas
# reglas (se ignora lo que empieza con `#`, se acepta `export`, se sacan las comillas, gana la última).

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

host_of_url() {
	local url="$1"
	if [[ "$url" =~ ^[A-Za-z0-9+.-]+://([^@/?#]*@)?([^/:?]+) ]]; then
		printf '%s' "${BASH_REMATCH[2]}"
		return 0
	fi
	return 1
}

# ---------------------------------------------------------------------------------------------
# Cómo se llega a la base
# ---------------------------------------------------------------------------------------------
#
# Igual que en beaos-token.sh, y por la misma razón medida: en el servidor `node` y `psql` no existen
# en el host, así que la base se alcanza entrando al contenedor que la corre
# (`docker exec -i beaos-postgres psql "$DATABASE_URL"`). El contenedor sale del host de `DATABASE_URL`,
# no de un literal. El segundo intento —sólo si el primero no conecta— reescribe el host al loopback
# del contenedor, que cubre la red `bridge` por defecto y una URL que apunta al puerto publicado.

DB_TRANSPORT=""
DB_CONTAINER=""
DB_URL=""
DB_CONNECT_URL=""

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
# interpolar en la cadena de SQL: una etiqueta con una comilla no tiene que poder romper la consulta.
psql_run() {
	psql_raw "$DB_CONNECT_URL" -v ON_ERROR_STOP=1 "$@"
}

# ---------------------------------------------------------------------------------------------
# Comandos
# ---------------------------------------------------------------------------------------------

# Las 24 horas del vencimiento son el default del servidor (`ENROLLMENT_TTL_HOURS`). Se dejan acá como
# un literal y no como una variable de entorno a propósito: un vencimiento configurable por entorno es
# un vencimiento que alguien va a poner en 10 años un viernes.
cmd_create() {
	local brand="${1:-}" entity="${2:-}" label="${3:-}"
	[ -n "$brand" ] || fail "create necesita el brandId, por ejemplo: create beaos acme-com"
	[ -n "$entity" ] || fail "create necesita el entityId (el UUID de la entidad), por ejemplo: create beaos 8f1c…"
	resolve_connection

	local code hash prefix
	code="$(generate_code)"
	hash="$(hash_of_code "$code")"
	prefix="$(prefix_of_code "$code")"

	# La marca y la entidad tienen que existir: las claves foráneas lo garantizan, y el error de psql es
	# más claro que un código que se genera y no canjea nunca.
	if ! printf '%s\n' "insert into agent_enrollment_codes (code_hash, prefix, brand_id, entity_id, label, expires_at)
values (:'hash', :'prefix', :'brand', :'entity', nullif(:'label', ''), now() + interval '24 hours');" |
		psql_run -q -A -t -v hash="$hash" -v prefix="$prefix" -v brand="$brand" -v entity="$entity" -v label="$label" >/dev/null; then
		fail "No se pudo guardar el código: revisá que la marca \"$brand\" y la entidad \"$entity\" existan. No se guardó nada y el código generado se descartó."
	fi

	printf 'Código de conexión creado para la marca "%s" (prefijo %s).\n\n' "$brand" "$prefix"
	printf '  %s\n\n' "$code"
	printf 'Pegalo en el plugin de WordPress: Ajustes → BeAOS AOS, y después "Conectar".\n'
	printf 'Vence en 24 h, sirve UNA sola vez, y sólo para la marca "%s" y la entidad "%s".\n' "$brand" "$entity"
	printf 'Guardalo AHORA: se guardó sólo su sha256 y no se puede volver a mostrar.\n'
	printf 'Para revocarlo antes de que se use: scripts/beaos-enroll.sh revoke %s\n' "$prefix"
}

cmd_list() {
	local brand="${1:-}"
	resolve_connection
	local sql rows count
	# Mismo estilo que `beaos-token.sh list`: una línea por fila, campos separados por `|`, fechas ISO
	# 8601 UTC. El estado se calcula acá y no se guarda: "vencido" es una consecuencia de `expires_at`,
	# no un estado que haya que mantener sincronizado.
	sql="$(cat <<'SQL'
select prefix,
       brand_id,
       coalesce(label, '—'),
       case
         when used_at is not null then 'usado ' || to_char(used_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
         when expires_at <= now() then 'vencido'
         else 'disponible'
       end,
       to_char(expires_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
from agent_enrollment_codes
where (:'brand' = '' or brand_id = :'brand')
order by created_at desc;
SQL
)"
	rows="$(printf '%s\n' "$sql" | psql_run -q -A -t -F '|' -v brand="$brand")"
	if [ -z "$rows" ]; then
		if [ -n "$brand" ]; then
			printf 'No hay códigos de conexión para la marca "%s".\n' "$brand"
		else
			printf 'No hay códigos de conexión creados.\n'
		fi
		return 0
	fi
	count="$(printf '%s\n' "$rows" | wc -l | tr -d ' ')"
	printf '%s código(s):\n' "$count"
	printf '%s\n' "$rows" | while IFS='|' read -r prefix brand_id label state expires; do
		printf '  %s  %-14s  %-20s  %-26s vence: %s\n' "$prefix" "$brand_id" "$label" "$state" "$expires"
	done
}

cmd_revoke() {
	local prefix="${1:-}"
	[ -n "$prefix" ] || fail "revoke necesita el prefijo del código, por ejemplo: revoke beaos_ab"
	resolve_connection

	local revoked existing
	# Revocar es marcar como usado sin token: el `UPDATE ... WHERE used_at IS NULL RETURNING` es la
	# misma sentencia que usa el canje, así que un código revocado y uno canjeado compiten por el mismo
	# candado. No hay ventana entre "lo revoco" y "lo canjean": gana uno de los dos.
	if ! revoked="$(printf '%s\n' "update agent_enrollment_codes set used_at = now() where prefix = :'p' and used_at is null returning prefix;" |
		psql_run -q -A -t -v p="$prefix")"; then
		fail "No se pudo revocar \"$prefix\"."
	fi

	if [ -n "$revoked" ]; then
		printf '%s\n' "$revoked" | while IFS= read -r line; do
			printf 'Revocado: %s. Ya no canjea.\n' "$line"
		done
		return 0
	fi

	# Nada activo con ese prefijo. Puede no existir, estar ya usado o estar vencido: son cosas distintas
	# y conviene decir cuál. El prefijo no es único en la tabla, así que puede haber más de una fila.
	existing="$(printf '%s\n' "select prefix, case when used_at is not null then 'usado' when expires_at <= now() then 'vencido' else 'disponible' end from agent_enrollment_codes where prefix = :'p';" |
		psql_run -q -A -t -F '|' -v p="$prefix")"
	if [ -z "$existing" ]; then
		fail "No existe ningún código con el prefijo \"$prefix\"."
	fi
	printf '%s\n' "$existing" | while IFS='|' read -r line state; do
		printf 'El código %s ya estaba %s: no se cambió nada.\n' "$line" "$state"
	done
}

# Diagnóstico para el test de equivalencia de formato: no lee DATABASE_URL ni toca la base.
cmd_hash() {
	local code="${1:-}" prefix hash
	[ -n "$code" ] || fail "hash necesita el código, por ejemplo: hash beaos_ab"
	prefix="$(prefix_of_code "$code")"
	hash="$(hash_of_code "$code")"
	printf '%s %s\n' "$prefix" "$hash"
}

cmd_new_code() {
	generate_code
}

command="${1:-}"
case "$command" in
create) cmd_create "${2:-}" "${3:-}" "${4:-}" ;;
list) cmd_list "${2:-}" ;;
revoke) cmd_revoke "${2:-}" ;;
hash) cmd_hash "${2:-}" ;;
new-code) cmd_new_code ;;
--help | -h | help | "") printf '%s\n' "$USAGE" ;;
*)
	printf 'Comando desconocido: %s\n' "$command" >&2
	printf '%s\n' "$USAGE" >&2
	exit 1
	;;
esac
