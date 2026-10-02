# El aislamiento por fila, el rol y por qué **no está activado**

Este documento es el estado medido del aislamiento por fila (RLS) después de `feat/rls-real`.
Existe porque la parte peligrosa de este cambio no es el SQL: es **cuándo** se activa.

## El hallazgo, en una línea

`ENABLE ROW LEVEL SECURITY` estaba puesto en **22 tablas** y no había **ni una política** en las 28
migraciones. La app conectaba como `postgres`: superusuario y dueño de todas las tablas. Con dueño o
con `BYPASSRLS`, `ENABLE ROW LEVEL SECURITY` **no cambia ninguna consulta**. El aislamiento entre
marcas lo sostenía —y lo sigue sosteniendo hoy— el filtro por `brand_id` de la aplicación.

## El modo de falla que hace que esto sea peligroso

Con un rol sin `BYPASSRLS` y **sin** la variable de sesión seteada:

| operación | resultado |
| --- | --- |
| `SELECT` | **cero filas, sin error** |
| `INSERT` | `new row violates row-level security policy` |

El `SELECT` no falla: filtra todo en silencio. Si se cambia el rol con el cableado incompleto, la
app cree que la base está vacía y el producto **se ve vacío sin un solo error en el log**.

**Por eso el rol no se activa en esta rama.** Ver *Estado* al final.

## Lo que quedó hecho

### 1. Las políticas — 14 tablas con `brand_id` propio

Una política por tabla, `beaos_brand_isolation`, `FOR ALL`, con `USING` y `WITH CHECK`:

```sql
USING ("prompts"."brand_id" = current_setting('beaos.brand_id', true))
WITH CHECK ("prompts"."brand_id" = current_setting('beaos.brand_id', true))
```

Se declaran en el esquema drizzle (`brandIsolationPolicy`, en `packages/lib/src/db/brand-isolation.ts`)
y `drizzle-kit generate` las emite a `0029_beaos_rls_policies.sql`, así que el esquema sigue siendo
la fuente de verdad y un `generate` posterior da "no schema changes".

Las 14: `agent_aos_audits`, `agent_aps_prompt_libraries`, `agent_aps_runs`, `agent_assets`,
`agent_brand_claims`, `agent_brand_dna_snapshots`, `agent_brand_entities`, `brand_opportunities`,
`citations`, `competitors`, `prompt_run_attempts`, `prompt_runs`, `prompts`, `provider_calls`.

#### Por qué `current_setting(..., true)` y no `current_setting(...)`

El `true` es `missing_ok`. Sin la variable, `current_setting('beaos.brand_id', true)` devuelve
**NULL**; `brand_id = NULL` no es falso, es **NULL**, y una política que evalúa a NULL no deja pasar
la fila. Resultado: **cero filas**. Eso es *fail-closed*, y es lo que queremos.

Sin el `true`, Postgres tiraría `unrecognized configuration parameter`. Se ve mejor en un log y es
peor como contrato: convierte el modo de falla en un error de configuración y tienta a "arreglarlo"
con un valor por defecto — que es exactamente cómo se termina con una sesión sin marca viendo los
datos de todos. El silencio es el precio, y es deliberado.

#### `provider_calls` tiene el `brand_id` **nullable**

Es la única de las 14 donde `brand_id` acepta `NULL` (log append-only que sobrevive a la marca). Con
la política puesta, una fila con `brand_id IS NULL` —investigación de onboarding, corridas de
reporte— **no la ve ninguna marca y no la puede escribir ninguna marca**. Solo la alcanza el rol de
dueño. Es correcto para el aislamiento y es una regresión funcional para la conciliación de costos,
que hoy lee todo. Está en la lista de motivos por los que el rol no se activa.

### 2. Las 8 tablas que **no** llevan política, y por qué

Una política sobre una tabla **sin** `brand_id` no protege: **vacía la tabla**. Por eso estas quedan
afuera, con el motivo escrito, en vez de con una política "por las dudas".

La última fila es la excepción que confirma la regla y va acá a propósito, porque el problema que tiene
es el mismo que el de estas: una tabla que **sí tiene `brand_id` y sí lleva política**, pero a la que una
de sus rutas (el canje público, que corre sin marca) no le puede dar contexto. Con el rol dedicado no se
vacía para el panel: se vacía para el canje.

| tabla | qué es | qué necesitaría |
| --- | --- | --- |
| `brands` | la identidad: su clave primaria **es** el `brand_id` | una política `id = current_setting(...)`. **No se puede**: se lee antes de que exista un contexto de marca (onboarding, selector de organizaciones, listado del admin). Ver abajo el efecto medido. |
| `reports` | reportes públicos (`brand_name` / `brand_website`, sin FK a `brands`) | no hay nada por lo que filtrar. Necesitaría una columna `brand_id` — un cambio de esquema, no una política. |
| `aos_public_usage` | contador diario del audit público (cupo por IP / credencial / global) | no es dato de una marca: es un contador de servicio. |
| `aos_public_leads` | leads del formulario de la extensión pública | no tiene marca: el lead llega antes de que exista una. |
| `agent_api_tokens` | credencial **por producto** para el MCP (`autex`, `maasy`) | no es dato de una marca; necesitaría un alcance por producto, que es otra cosa. |
| `agent_enrollment_codes` | el código de conexión de un sitio: **sí tiene `brand_id` y `entity_id`**, y **sí lleva política** (`beaos_brand_isolation`, en `0032_agent_enrollment_codes.sql`) | nada de esquema: le falta **contexto**. El canje de `POST /api/v1/enroll` corre **sin sesión y sin marca a propósito** —el que llama todavía no tiene credencial—, así que con el rol dedicado el `UPDATE ... WHERE used_at IS NULL RETURNING` no vería la fila y **el canje daría 400 para todo código válido**. La marca sale de la fila del código, o sea que hay que leerla para poder fijar la variable: es un huevo y la gallina que hay que decidir, no un `set_config` más. |
| `agent_aps_prompts` | **sí es de producto** | no tiene `brand_id`: cuelga de `library_id` → `agent_aps_prompt_libraries.brand_id`. Necesita una **política por join**. |
| `agent_aps_observations` | **sí es de producto** | no tiene `brand_id`: cuelga de `run_id` → `agent_aps_runs.brand_id`. Necesita una **política por join**. |
| `agent_aps_scores` | **sí es de producto** | no tiene `brand_id`: cuelga de `run_id` / `entity_id`. Necesita una **política por join**. |

Las tres últimas son el hallazgo que había que nombrar: **tablas de producto, con RLS habilitado,
sin `brand_id`, que hoy se vaciarían** con el rol dedicado. Una política por join es otra cosa —más
compleja y con su propia prueba— y queda fuera de esta rama a propósito. Es la razón número uno por
la que el rol no se puede activar todavía.

### 3. El rol dedicado — creado y **sin poder conectarse**

`0030_beaos_app_role.sql` crea `beaos_app` con `NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB
NOCREATEROLE`, dueño de **0 tablas**, con `SELECT/INSERT/UPDATE/DELETE` sobre todas las tablas de
`public`, `USAGE/SELECT` sobre las secuencias, `ALTER DEFAULT PRIVILEGES` para las tablas que creen
las migraciones siguientes, y los permisos de `pgboss` si ese esquema ya existe. Es idempotente.

`NOLOGIN` es el punto: **existe, tiene los permisos, y nadie se puede conectar con él.** El rol se
crea por migración; activarlo es un paso aparte y deliberado.

### 4. El cableado — `withBrand()`

`packages/lib/src/db/brand-scope.ts`:

```ts
export async function withBrand<T>(brandId: string, fn: (tx: BrandTransaction) => Promise<T>): Promise<T>
```

Abre **él mismo** la transacción y fija la variable con `set_config('beaos.brand_id', $1, true)`.

Las dos decisiones que importan:

- **`is_local = true`**, no un `SET` pelado. `SET beaos.brand_id = 'x'` queda pegado a **la
  conexión**; con un pool, la conexión sobrevive al request y se le entrega al siguiente, así que la
  marca B corre sobre una conexión que todavía tiene la marca A y **ve los datos de A**. Es el
  aislamiento al revés de como se pidió, y sin un solo error. `withBrand` además abre la transacción
  él mismo, que es lo único que hace que `is_local` signifique algo: fuera de una transacción,
  `set_config(..., true)` avisa por `WARNING` y aplica el valor al resto de la sesión.
- **Rechaza un `brand_id` vacío** en vez de degradar a "sin marca". Un scope vacío daría cero filas
  igual que no tener variable, y el síntoma sería un producto vacío en vez de un error. Fail-closed
  está bien para la base; el código puede y debe avisar.

No existe un `withBrand(null)` a propósito: los caminos que no son de una marca van con el rol de
dueño, que saltea RLS.

## Estado: **el rol NO está activado**

`DATABASE_URL` sigue apuntando al rol de dueño. No se cambió ni un archivo de entorno, ni
`docker-compose`, ni `.env.example`. El caso 6 de `rls-isolation.test.ts` lo mide: con el rol de
dueño, y con la variable puesta en la marca A, se sigue viendo **todo**.

### El inventario de caminos de acceso a datos

Medido, no supuesto.

| camino | dónde | ¿es de una marca? | estado |
| --- | --- | --- | --- |
| `db` compartido | `packages/lib/src/db/db.ts` (Pool, `max: 20`) | mixto | **sin cablear** — 147 llamadas `db.*` en **58 módulos** |
| cliente drizzle propio | `apps/web/src/lib/postgres-read.ts` | sí (analítica de `prompt_runs` / `citations`) | **sin cablear** — instancia propia, necesita su propio `setBrandStatement` |
| cliente `pg` crudo | `apps/web/src/server/admin.ts` (`withPgClient`, ~20 `client.query`) | no (admin: todas las marcas) | **sin cablear** — necesita rol de dueño |
| pg-boss (web) | `apps/web/src/lib/boss-client.ts`, esquema `pgboss` | **no** (cola de trabajos) | **sin cablear** — sin políticas, ver abajo |
| pg-boss (worker) | `apps/worker/src/boss.ts`, esquema `pgboss` | **no** (cola de trabajos) | **sin cablear** |
| worker: trabajos de una marca | `apps/worker/src/jobs/*` (13 archivos) | sí | **sin cablear** |
| worker: barridos de todas las marcas | `schedule-maintenance`, `aps-cost`, `report-worker` | **no** | necesita rol de dueño |
| worker: cron | `apps/worker/src/index.ts` → `boss.schedule("schedule-maintenance", "*/5 * * * *")` y `"sync-auth0-memberships"` cada 15 min en modo whitelabel (ambos por pg-boss) | **no** | **sin cablear** |
| worker: arranque | `apps/worker/src/index.ts`, `db.execute` crudo sobre `pgboss.queue` | **no** | **sin cablear** — es el `db` compartido escribiendo fuera de todo request |
| migraciones | `drizzle-kit` (`packages/lib/drizzle.config.ts`) | **no** | **debe** seguir con el rol de dueño |
| scripts | `apps/web/scripts/benchmark-postgres-analytics.ts`, `apps/web/scripts/beaos-tokens.mjs`, `apps/worker/scripts/verify-aps-cost.ts` | mixto | **sin cablear** |
| better-auth | `user`, `session`, `account`, `member`, `organization`, `invitation`, `sso_provider`, `verification` | **no** (identidad, no marca); no tienen RLS | **sin cablear**, y no llevan política |
| audit público | `/api/v1/aos/lead`, `aos/public-limit.server.ts` → `aos_public_usage`, `aos_public_leads` | **no** | **sin cablear** — sin política, con el rol dedicado devolverían **cero filas** |
| reportes públicos | `apps/web/src/server/reports.ts` → `reports` | **no** (no hay por qué filtrar) | **sin cablear** |

### Lo que falta, concreto

1. **Las 3 tablas de APS sin `brand_id`** (`agent_aps_prompts`, `agent_aps_observations`,
   `agent_aps_scores`) necesitan política por join. Sin eso, con el rol dedicado el APS **se ve
   vacío**.
2. **Las 8 tablas sin política** (arriba) devuelven **cero filas** con el rol dedicado. Entre ellas
   `brands` y las dos tablas del audit público, que rompen el selector de organizaciones, el
   listado de marcas del admin y el endpoint público. Eso solo hace imposible activar el rol hoy.
3. **Cablear los 147 `db.*` de los 58 módulos de web y worker** detrás de `withBrand`, más el
   cliente propio de `postgres-read.ts` y `withPgClient` del admin. Hay **8 transacciones** ya
   abiertas (`db.transaction`) que tendrían que anidarse dentro del scope.
4. **Decidir pg-boss**: sus tablas no llevan política, así que con el rol dedicado la cola devuelve
   cero filas y la app no encola ni procesa nada. Necesita el rol de dueño, o `BYPASSRLS` sobre su
   esquema (que es una excepción deliberada y hay que poder justificarla).
5. **`provider_calls` con `brand_id IS NULL`**: decidir si la conciliación de costos pasa al rol de
   dueño o si esos caminos declaran una marca.

### Activación (cuando el punto anterior esté cerrado)

Son tres pasos, y el tercero es el único que cambia el comportamiento:

```bash
# 1. Darle al rol la posibilidad de conectarse, con una contraseña real.
psql "$DATABASE_URL_DE_DUENO" -c "ALTER ROLE beaos_app LOGIN PASSWORD '<contraseña>'"

# 2. (si el esquema pgboss no existía cuando corrió la migración) alcanzarlo.
psql "$DATABASE_URL_DE_DUENO" -c "GRANT USAGE ON SCHEMA pgboss TO beaos_app" \
  -c "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO beaos_app" \
  -c "GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO beaos_app"

# 3. Recién ahora, y con el cableado completo verificado:
#    DATABASE_URL=postgres://beaos_app:<contraseña>@<host>:5432/<base>
```

Antes del paso 3, correr la prueba que decide contra una copia migrada de la base de producción:

```bash
bash scripts/rls-postgres-check.sh
```

### Rollback

Volver a la URL de dueño revierte en un minuto, porque **el rol nunca fue el que sostiene el
producto**: mientras `DATABASE_URL` apunte al dueño, RLS no cambia ninguna consulta.

```bash
# 1. DATABASE_URL=postgres://postgres:<contraseña>@<host>:5432/<base>   (y reiniciar web y worker)
# 2. Opcional, para volver al estado exacto que deja la migración:
psql "$DATABASE_URL_DE_DUENO" -c "ALTER ROLE beaos_app NOLOGIN"
```

Las políticas y el rol pueden quedarse: con el rol de dueño son inertes, así que no hay ninguna
prisa por revertir la migración. El rollback de datos **no aplica**: las migraciones 0029 y 0030 no
tocan una sola fila.

## La prueba que decide

`scripts/rls-postgres-check.sh` levanta un Postgres descartable, aplica las 30 migraciones, corre
`rls-isolation.test.ts` (los seis casos) y `db-smoke.test.ts`, muestra el estado medido y **borra el
contenedor** al salir, incluso si algo falla. Los seis casos:

1. Variable en la marca A → solo las filas de A.
2. Variable en la marca B → ni una fila de A.
3. **Sin** variable → **cero filas y ningún error**.
4. `INSERT` de una fila de B con la variable en A → **rechazado**.
5. Dos requests seguidos con marcas distintas sobre **la misma conexión** (mismo
   `pg_backend_pid()`): el segundo no ve lo del primero. Y al lado, un `set_config(..., false)` —el
   equivalente a `SET` sin `LOCAL`— que **sí** se filtra, para que la diferencia esté medida.
6. El rol con el que la app conecta hoy sigue leyendo y escribiendo.

Más dos casos de estado: las 14 tablas con `brand_id` llevan política y las 8 sin `brand_id` siguen
sin ninguna; y `brands` devuelve **cero filas** con el rol dedicado, que es el efecto colateral
medido que impide activarlo.
