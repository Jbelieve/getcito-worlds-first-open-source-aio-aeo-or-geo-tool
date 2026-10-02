#!/usr/bin/env bash
#
# Verificación del RLS de AOS/APS contra un Postgres **real y descartable**.
#
# Levanta un contenedor, aplica TODAS las migraciones, corre el test de aislamiento y
# borra el contenedor. Es el camino que prueba que activar RLS no rompe el producto: sin
# la política correcta, `ENABLE ROW LEVEL SECURITY` deja todo afuera y un arreglo de
# seguridad rompería la app.
#
# Uso:  bash scripts/rls-postgres-check.sh
#
set -euo pipefail

CONTAINER="${RLS_CHECK_CONTAINER:-beaos-rls-check}"
PORT="${RLS_CHECK_PORT:-55433}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATABASE_URL="postgres://postgres:postgres@localhost:${PORT}/getcito"

cleanup() {
  echo "--- borrando el contenedor ${CONTAINER}"
  docker rm -f "${CONTAINER}" >/dev/null 2>&1 || true
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

echo "--- aplicando migraciones"
(cd "${REPO_ROOT}/packages/lib" && DATABASE_URL="${DATABASE_URL}" ./node_modules/.bin/drizzle-kit migrate)

echo "--- estado del RLS tras migrar"
docker exec "${CONTAINER}" psql -U postgres -d getcito -c "
SELECT c.relname AS tabla, c.relrowsecurity AS rls,
       (SELECT count(*) FROM pg_policy p WHERE p.polrelid = c.oid) AS politicas
FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
ORDER BY c.relname;"

echo "--- corriendo el test de aislamiento contra esta base"
(cd "${REPO_ROOT}/packages/lib" && RLS_TEST_DATABASE_URL="${DATABASE_URL}" \
  ./node_modules/.bin/vitest run src/db/rls-isolation.test.ts src/db/db-smoke.test.ts)

echo "--- listo"
