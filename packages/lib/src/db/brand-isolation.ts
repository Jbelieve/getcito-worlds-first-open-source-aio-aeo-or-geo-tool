/**
 * El aislamiento por fila (RLS) **de verdad**: la política que ata cada fila a la marca que
 * la está mirando, leída de una variable de sesión.
 *
 * Antes de este archivo había `ENABLE ROW LEVEL SECURITY` en 22 tablas y **cero**
 * `CREATE POLICY` en las 28 migraciones. Con RLS habilitado y sin políticas, Postgres no
 * filtra nada: la tabla se comporta como si RLS no estuviera. Faltaba la mitad que decide.
 *
 * ## Por qué `current_setting(..., true)` y no `current_setting(...)`
 *
 * El segundo argumento (`missing_ok = true`) es la pieza que hace que esto **falle cerrado**:
 *
 *   - Sin la variable, `current_setting('beaos.brand_id', true)` devuelve **NULL**.
 *   - `brand_id = NULL` no es falso: es **NULL**, y una política que evalúa a NULL **no deja
 *     pasar la fila**.
 *   - Resultado: **cero filas**, en silencio.
 *
 * Si se omitiera el `true`, Postgres tiraría `unrecognized configuration parameter` en vez de
 * devolver NULL. Eso se ve mejor en un log, pero es peor como contrato: convierte el modo de
 * falla en un error de configuración y tienta a "arreglarlo" con un valor por defecto, que es
 * exactamente cómo se termina con una sesión sin marca viendo datos de todos.
 *
 * **El silencio es el precio y es deliberado**: cero filas es la respuesta correcta cuando
 * nadie dijo qué marca. Por eso la aplicación nunca debe llegar a la base sin marca, y por eso
 * `withBrand()` (`./brand-scope.ts`) exige un id no vacío en vez de degradar a "sin marca".
 *
 * ## Por qué esta política no alcanza sola
 *
 * Una política no hace nada contra el **dueño de la tabla** ni contra un rol con `BYPASSRLS`
 * (ver `RLS-ROL-Y-ACTIVACION.md`). O sea: las políticas de acá son necesarias y **no
 * suficientes** — el rol de la app tiene que cambiar, y eso está deliberadamente **sin
 * activar**.
 */

import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, pgPolicy } from "drizzle-orm/pg-core";

/**
 * El parámetro de sesión que declara **qué marca** está mirando la transacción en curso.
 *
 * El prefijo `beaos.` lo vuelve un parámetro *custom*: no hace falta declararlo, y
 * `set_config(..., is_local => true)` lo deja atado a la transacción, no a la conexión.
 */
export const BRAND_SETTING = "beaos.brand_id";

/** Nombre único de la política, para que `pg_policy` tenga una fila reconocible por tabla. */
export const BRAND_POLICY_NAME = "beaos_brand_isolation";

/**
 * `columna = current_setting('beaos.brand_id', true)`.
 *
 * El nombre del parámetro se inyecta con `sql.raw` y no como parámetro ligado: **una política
 * no se puede parametrizar** — es DDL, y `drizzle-kit` la escribe literal en el archivo de
 * migración. Con `sql.raw` el literal sale del mismo `BRAND_SETTING` que usa `set_config` en
 * tiempo de ejecución, así que no hay dos strings que se puedan desincronizar.
 */
export function brandIsolationPredicate(column: AnyPgColumn): SQL {
	return sql`${column} = current_setting(${sql.raw(`'${BRAND_SETTING}'`)}, true)`;
}

/**
 * La política de una tabla que tiene `brand_id` **propio**.
 *
 * `for: "all"` cubre SELECT/INSERT/UPDATE/DELETE. `using` filtra lo que se puede leer, tocar o
 * borrar; `withCheck` valida lo que se escribe. Los dos son necesarios: con `USING` solo, un
 * `INSERT` de otra marca entraría y recién después quedaría invisible — un dato envenenado que
 * nadie ve.
 *
 * Solo se aplica a tablas con `brand_id` **de verdad**. Una tabla sin esa columna no lleva una
 * política "por las dudas": la política no compilaría, y una política mal escrita **vacía la
 * tabla** en vez de protegerla. Ver `RLS-ROL-Y-ACTIVACION.md` para la lista de las que
 * quedan afuera y por qué.
 */
export function brandIsolationPolicy(column: AnyPgColumn) {
	return pgPolicy(BRAND_POLICY_NAME, {
		as: "permissive",
		for: "all",
		using: brandIsolationPredicate(column),
		withCheck: brandIsolationPredicate(column),
	});
}
