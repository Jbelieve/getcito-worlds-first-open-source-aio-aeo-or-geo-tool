#!/usr/bin/env bash
#
# La prueba que decide: RLS **de verdad** contra un Postgres real y descartable.
#
# Levanta un contenedor, aplica las 30 migraciones (incluidas las 14 políticas y el rol
# dedicado), corre los seis casos de aislamiento, muestra el estado medido y **borra el
# contenedor** al salir — incluso si algo falla.
#
# Es el único camino que responde la pregunta que importa: ¿el aislamiento por fila existe, o
# `ENABLE ROW LEVEL SECURITY` sigue sin cambiar ninguna consulta?
#
# Uso:  bash scripts/rls-postgres-check.sh
#
# Variables: RLS_CHECK_CONTAINER (nombre, por defecto beaos-rls-check),
#            RLS_CHECK_PORT (puerto del host, por defecto 55433).
#
# Nunca toca una base que no sea la descartable: la URL se arma acá adentro.
set -euo pipefail

CONTAINER="${RLS_CHECK_CONTAINER:-beaos-rls-check}"
PORT="${RLS_CHECK_PORT:-55433}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL="postgres://postgres:postgres@localhost:${PORT}/getcito"

cleanup() {
  echo
  echo "--- borrando el contenedor ${CONTAINER} (y con él la base de prueba)"
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
  echo "--- contenedor borrado: ${CONTAINER}"
}
trap cleanup EXIT

echo "--- levantando Postgres descartable en el puerto ${PORT}"
docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
docker run -d --name "${CONTAINER}" \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=getcito \
  -p "${PORT}:5432" postgres:16-alpine >/dev/null

for _ in $(seq 1 30); do
  if docker exec "${CONTAINER}" pg_isready -U postgres >/dev/null 2>&1; then break; fi
  sleep 1
done
docker exec "${CONTAINER}" pg_isready -U postgres

echo
echo "--- aplicando migraciones"
(cd "${REPO_ROOT}/packages/lib" && DATABASE_URL="${DATABASE_URL}" ./node_modules/.bin/drizzle-kit migrate)

echo
echo "--- CASO 0: qué tablas tienen RLS y cuántas políticas"
docker exec "${CONTAINER}" psql -U postgres -d getcito -c "
SELECT c.relname AS tabla,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas,
       COALESCE((SELECT string_agg(a.attname, ',') FROM pg_attribute a
                  WHERE a.attrelid = c.oid AND a.attname = 'brand_id'
                    AND a.attnum > 0 AND NOT a.attisdropped), '-') AS tiene_brand_id
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
ORDER BY politicas DESC, c.relname;"

echo "--- resumen: tablas con política / tablas con RLS y sin política"
docker exec "${CONTAINER}" psql -U postgres -d getcito -tAc "
SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity) || ' tablas con RLS, ' ||
       (SELECT count(DISTINCT polrelid) FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname='public') || ' con política';"

echo
echo "--- el rol dedicado: creado, sin BYPASSRLS y SIN poder conectarse"
docker exec "${CONTAINER}" psql -U postgres -d getcito -c "
SELECT rolname, rolsuper, rolbypassrls, rolcanlogin,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = r.rolname) AS tablas_propias
FROM pg_roles r WHERE rolname = 'beaos_app';"

echo
echo "--- los seis casos, contra esta base (el test activa beaos_app y lo vuelve a NOLOGIN)"
(cd "${REPO_ROOT}/packages/lib" && RLS_TEST_DATABASE_URL="${DATABASE_URL}" DATABASE_URL="${DATABASE_URL}" \
  ./node_modules/.bin/vitest run --no-file-parallelism --reporter=verbose src/db/rls-isolation.test.ts src/db/db-smoke.test.ts)

echo
echo "--- el rol volvió a NOLOGIN (la migración no activa nada)"
docker exec "${CONTAINER}" psql -U postgres -d getcito -tAc "SELECT rolname || ' rolcanlogin=' || rolcanlogin FROM pg_roles WHERE rolname='beaos_app';"

echo
echo "--- listo"
