#!/usr/bin/env bash
#
# La guarda de forma de `agent_assets.path` contra un Postgres **real**: la migración, el `CHECK` y el
# corpus compartido.
#
# Lo que responde, y ninguna de estas preguntas se puede contestar con un mock:
#
#   1 · ¿La migración 0031 se aplica? (y ¿cuántas filas existentes había, y si pasan?)
#   2 · ¿El `CHECK` acepta las 15 rutas legítimas del kit, enteras?
#   3 · ¿El `CHECK` rechaza **todo** el corpus compartido que `kit-routes.ts` marca como inválido?
#       El corpus es el mismo que corren `kit-routes.test.ts` (TypeScript) y `pure.php` (PHP): una sola
#       lista de casos, tres implementaciones obligadas a coincidir.
#   4 · ¿Qué pasa si la base YA tiene basura? Se dropea el `CHECK`, se inserta un `/wp-login.php` a
#       mano, se vuelve a aplicar la migración: tiene que **aplicarse igual**, avisar por `WARNING`, no
#       validar retroactivamente, y bloquear toda escritura nueva.
#
# Levanta un contenedor descartable y lo borra al salir. Nunca toca una base que no sea la descartable.
#
# Uso:  bash scripts/agent-assets-path-guard-check.sh
#
# Variables: PATH_GUARD_CONTAINER (nombre, por defecto beaos-path-guard-check),
#            PATH_GUARD_PORT (puerto del host, por defecto 55434).
set -euo pipefail

CONTAINER="${PATH_GUARD_CONTAINER:-beaos-path-guard-check}"
PORT="${PATH_GUARD_PORT:-55434}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL="postgres://postgres:postgres@localhost:${PORT}/getcito"
KIT_ROUTES="$REPO_ROOT/packages/aos-aps/src/assets/kit-routes.ts"
MIGRACION="$REPO_ROOT/packages/lib/src/db/migrations/0031_agent_assets_path_guard.sql"

fallos=0
malo() { printf '\n  FALLA %s\n' "$*"; fallos=$((fallos + 1)); }
bueno() { printf '  ok    %s\n' "$*"; }

# Sin `-i` a propósito: `docker exec -i` se queda con el stdin de quien lo llama, y adentro de un
# `while read` sobre un here-string eso se come las líneas siguientes (el bucle correría una sola vez).
# El único lugar que necesita stdin es el `psql` que carga la migración, y ahí va explícito.
psql_docker() { docker exec "${CONTAINER}" psql -U postgres -d getcito -v ON_ERROR_STOP=1 "$@"; }

cleanup() {
  echo
  echo "--- borrando el contenedor ${CONTAINER} (y con él la base de prueba)"
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

# ── El corpus compartido, leído de su única definición ───────────────────────────────────────────
#
# Se lee `kit-routes.ts` como texto, con la misma expresión regular que usa `pure.php`: si el corpus
# cambia de forma, esto se rompe en vez de verificar menos de lo que cree.

CORPUS="$(python3 - "$KIT_ROUTES" <<'PY'
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text()
i = src.index("export const KIT_ROUTE_VECTORS")
start = src.index("= [", i) + 3
end = src.index("\n];", start)
out = []
for line in src[start:end].splitlines():
    s = line.strip()
    if not s or s.startswith(("//", "/*", "*")):
        continue
    m = re.match(r'^\["([^"]*)",\s*(true|false)\],$', s)
    if not m:
        sys.exit(f"el corpus tiene una entrada que este script no sabe leer: {s}")
    out.append((m.group(1), "true" == m.group(2)))
if len(out) < 30:
    sys.exit(f"el corpus trae muy pocos casos: {len(out)}")
# El separador es `|` y no un tabulador a propósito: `read` con IFS de tabulador **se come los tabs del
# principio** (es un carácter de IFS whitespace), así que la ruta vacía del corpus se salteaba en silencio
# y el test verificaba 32 de 33 casos creyendo que verificaba todos. `|` no es IFS whitespace y, además,
# ninguna ruta del kit puede tenerlo (el juego de caracteres lo excluye).
for path, ok in out:
    print(f"{path}|{'true' if ok else 'false'}")
PY
)"

TOTAL="$(printf '%s\n' "$CORPUS" | wc -l | tr -d ' ')"
VALIDOS="$(printf '%s\n' "$CORPUS" | awk -F'|' '$2=="true"' | wc -l | tr -d ' ')"
INVALIDOS="$(printf '%s\n' "$CORPUS" | awk -F'|' '$2=="false"' | wc -l | tr -d ' ')"

echo "--- corpus compartido: $TOTAL casos ($VALIDOS válidos, $INVALIDOS inválidos), leídos de kit-routes.ts"

echo
echo "--- levantando Postgres descartable en el puerto ${PORT}"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=getcito \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

# La espera no puede ser `pg_isready` a secas, y esto costó una corrida entenderlo: la imagen oficial
# levanta un servidor **temporal** durante el `initdb`, lo baja, y recién ahí arranca el definitivo.
# `pg_isready` contesta que sí en las dos fases, así que una migración que empieza en el hueco muere con
# "the database system is shutting down". Primero se espera a que el init haya terminado (el log lo
# dice), y después a que el servidor definitivo conteste de verdad.
for _ in $(seq 1 60); do
  if docker logs "${CONTAINER}" 2>&1 | grep "PostgreSQL init process complete" >/dev/null; then break; fi
  sleep 1
done
for _ in $(seq 1 60); do
  if docker exec "${CONTAINER}" psql -U postgres -d getcito -tAc 'SELECT 1' >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "${CONTAINER}" psql -U postgres -d getcito -tAc 'SELECT version();' | head -1

# ── 1 · La migración ─────────────────────────────────────────────────────────────────────────────

echo
echo "--- aplicando las migraciones (incluida 0031_agent_assets_path_guard)"
(cd "${REPO_ROOT}/packages/lib" && DATABASE_URL="${DATABASE_URL}" ./node_modules/.bin/drizzle-kit migrate) >/tmp/path-guard-migrate.log 2>&1 || {
  cat /tmp/path-guard-migrate.log
  malo "la migración no se aplicó"
}
grep -E "0031|VALIDADO|WARNING" /tmp/path-guard-migrate.log || true

echo
echo "--- 1a · las filas que había ANTES del CHECK (una base recién migrada)"
FILAS="$(psql_docker -tAc 'SELECT count(*) FROM "agent_assets";')"
printf '  filas en agent_assets: %s\n' "$FILAS"

echo
echo "--- 1b · el CHECK quedó validado (el VALIDATE CONSTRAINT del propio archivo)"
# `convalidated = t` es la respuesta autoritativa a "¿las filas existentes pasan?": Postgres lo pone en
# `t` sólo si el `VALIDATE CONSTRAINT` recorrió la tabla entera y no encontró ni una violación.
CONVALIDADO="$(psql_docker -tAc "SELECT convalidated FROM pg_constraint WHERE conname = 'agent_assets_path_shape';")"
printf '  convalidated = %s\n' "$CONVALIDADO"
if [ "$CONVALIDADO" = "t" ]; then
  bueno "las $FILAS filas existentes pasan la guarda: el CHECK quedó VALIDADO"
else
  malo "el CHECK quedó NOT VALID: hay filas que no pasan la guarda"
fi

echo
echo "--- 1c · la definición que quedó en la base"
psql_docker -tAc "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'agent_assets_path_shape';"

# ── Padres para las FK ───────────────────────────────────────────────────────────────────────────

psql_docker -q -c "
INSERT INTO \"brands\" (id, name, website) VALUES ('path-guard', 'Path guard', 'https://path-guard.test');
INSERT INTO \"agent_brand_entities\" (id, brand_id, entity_type, name)
VALUES ('00000000-0000-4000-8000-0000000000aa', 'path-guard', 'umbrella', 'Path guard');
" >/dev/null

# ── 2 y 3 · El corpus entero, por el camino real: el INSERT ──────────────────────────────────────

echo
echo "--- 2 · las rutas válidas del corpus tienen que ENTRAR"

while IFS='|' read -r path ok; do
  [ "$ok" = "true" ] || continue
  if psql_docker -q -c "INSERT INTO \"agent_assets\" (brand_id, entity_id, path, type, content, hash) VALUES ('path-guard', '00000000-0000-4000-8000-0000000000aa', '$path', 'text/plain', 'x', 'h');" >/dev/null 2>&1; then
    :
  else
    malo "una ruta que el corpus marca como válida fue RECHAZADA por el CHECK: $path"
  fi
done <<< "$CORPUS"
ACEPTADAS="$(psql_docker -tAc 'SELECT count(*) FROM "agent_assets";')"
printf '  rutas válidas del corpus: %s, filas insertadas: %s\n' "$VALIDOS" "$ACEPTADAS"
if [ "$ACEPTADAS" = "$VALIDOS" ]; then
  bueno "entraron las $VALIDOS rutas válidas, y ninguna más"
else
  malo "entraron $ACEPTADAS y se esperaban $VALIDOS"
fi

echo
echo "--- 3 · las rutas inválidas del corpus tienen que ser RECHAZADAS"

rechazadas=0
while IFS='|' read -r path ok; do
  [ "$ok" = "false" ] || continue
  if salida="$(psql_docker -q -c "INSERT INTO \"agent_assets\" (brand_id, entity_id, path, type, content, hash) VALUES ('path-guard', '00000000-0000-4000-8000-0000000000aa', '$path', 'text/plain', 'x', 'h');" 2>&1)"; then
    malo "una ruta que el corpus marca como inválida ENTRÓ a la base: $path"
    continue
  fi
  case "$salida" in
    *agent_assets_path_shape*) rechazadas=$((rechazadas + 1)) ;;
    *) malo "una ruta inválida fue rechazada por otra cosa que no es el CHECK ($path): $(printf '%s' "$salida" | head -1)" ;;
  esac
done <<< "$CORPUS"
printf '  rutas inválidas rechazadas por el CHECK: %s de %s\n' "$rechazadas" "$INVALIDOS"
if [ "$rechazadas" = "$INVALIDOS" ]; then
  bueno "el CHECK rechaza las $INVALIDOS rutas inválidas del corpus (y ninguna por otro motivo)"
else
  malo "el CHECK dejó pasar $((INVALIDOS - rechazadas)) rutas inválidas"
fi

# ── 4 · La base que YA tenía basura ──────────────────────────────────────────────────────────────

echo
echo "--- 4 · la base que ya tenía basura: la migración tiene que aplicarse IGUAL"

psql_docker -q -c "ALTER TABLE \"agent_assets\" DROP CONSTRAINT \"agent_assets_path_shape\";" >/dev/null
psql_docker -q -c "DELETE FROM \"agent_assets\";" >/dev/null
psql_docker -q -c "INSERT INTO \"agent_assets\" (brand_id, entity_id, path, type, content, hash) VALUES ('path-guard', '00000000-0000-4000-8000-0000000000aa', '/wp-login.php', 'text/html', '<form>señuelo</form>', 'h');" >/dev/null
printf '  fila envenenada insertada a mano: %s\n' "$(psql_docker -tAc 'SELECT path FROM "agent_assets";')"

if docker exec -i "${CONTAINER}" psql -U postgres -d getcito -v ON_ERROR_STOP=1 < "$MIGRACION" >/tmp/path-guard-redo.log 2>&1; then
  bueno "la migración se volvió a aplicar sobre una base con una fila mala (no rompió el despliegue)"
else
  malo "la migración falló sobre una base con una fila mala:"; cat /tmp/path-guard-redo.log
fi
grep -E "WARNING|NOTICE" /tmp/path-guard-redo.log | sed 's/^/    /' || true
printf '  convalidated después: %s (tiene que ser f = NOT VALID)\n' "$(psql_docker -tAc "SELECT convalidated FROM pg_constraint WHERE conname = 'agent_assets_path_shape';")"

if psql_docker -q -c "INSERT INTO \"agent_assets\" (brand_id, entity_id, path, type, content, hash) VALUES ('path-guard', '00000000-0000-4000-8000-0000000000aa', '/wp-admin', 'text/html', 'x', 'h');" >/dev/null 2>&1; then
  malo "con el CHECK NOT VALID, una escritura NUEVA con /wp-admin entró igual"
else
  bueno "con el CHECK NOT VALID, una escritura NUEVA con /wp-admin sigue bloqueada"
fi
printf '  la fila mala vieja sigue ahí: %s\n' "$(psql_docker -tAc "SELECT count(*) FROM \"agent_assets\" WHERE path = '/wp-login.php';")"

echo
if [ "$fallos" -eq 0 ]; then
  echo "guarda de rutas en la base: OK ($TOTAL casos del corpus, $VALIDOS válidos, $INVALIDOS rechazados)"
  exit 0
fi
echo "guarda de rutas en la base: FALLA ($fallos)"
exit 1
