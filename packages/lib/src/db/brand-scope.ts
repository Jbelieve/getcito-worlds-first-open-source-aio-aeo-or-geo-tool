/**
 * `withBrand()` — el único camino por el que una consulta de una marca debería llegar a la base.
 *
 * ## El bug que este archivo existe para no introducir
 *
 * La variable que leen las políticas (`beaos.brand_id`) se puede fijar de dos maneras:
 *
 *   - `SET beaos.brand_id = 'x'` → queda pegada a **la conexión**.
 *   - `set_config('beaos.brand_id', 'x', true)` → vale solo hasta que termina **la transacción**.
 *
 * Con un pool, la conexión sobrevive al request y se le entrega al siguiente. Un `SET` sin
 * `LOCAL` es entonces una fuga con esteroides: la marca B corre sobre una conexión que todavía
 * tiene la marca A, y **ve los datos de A** — el aislamiento al revés de como se pidió, y sin un
 * solo error. `withBrand()` usa `is_local = true` y además **abre la transacción él mismo**, que
 * es lo único que hace que `is_local` signifique algo: fuera de una transacción, `set_config(...,
 * true)` avisa por `WARNING` y aplica el valor al resto de la sesión.
 *
 * La prueba explícita de esto vive en `./rls-scope.test.ts` (caso 5): dos transacciones seguidas
 * sobre **la misma conexión** —mismo `pg_backend_pid()`— con marcas distintas, y la segunda no ve
 * nada de la primera. Y al lado, un `SET` a mano que sí se filtra, para que la diferencia esté
 * medida y no afirmada.
 *
 * ## Lo que este helper NO resuelve
 *
 * No alcanza con llamarlo: hay que llamarlo en **todos** los caminos que tocan datos de una
 * marca. Hoy hay ~147 llamadas a `db.*` en ~55 módulos, más un segundo cliente de drizzle
 * (`apps/web/src/lib/postgres-read.ts`), más `pg-boss`, más las tablas de better-auth. Por eso
 * el rol dedicado **no está activado**: ver `RLS-ROL-Y-ACTIVACION.md`, que lista camino por
 * camino qué falta.
 */

import { sql } from "drizzle-orm";
import { BRAND_SETTING } from "./brand-isolation";
import { db } from "./db";

/**
 * La transacción de drizzle, tal como la entrega el callback de `db.transaction`.
 *
 * Se deriva del propio `db` en vez de importar el tipo de `drizzle-orm/pg-core` para que no se
 * desincronice si el driver o el esquema cambian.
 */
export type BrandTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * El `set_config` que fija la marca **para la transacción en curso**.
 *
 * Se expone aparte para que un cliente de drizzle distinto del compartido (el caso de
 * `apps/web/src/lib/postgres-read.ts`) pueda armar su propio `withBrand` sin duplicar la semántica
 * ni el nombre del parámetro.
 */
export function setBrandStatement(brandId: string) {
	// `true` = is_local: la variable muere con la transacción y no viaja a la conexión que el
	// pool le entregue al próximo request.
	return sql`select set_config(${BRAND_SETTING}, ${brandId}, true)`;
}

/**
 * Ejecuta `fn` dentro de una transacción que primero declara **de qué marca** son las filas que
 * se van a leer y escribir.
 *
 * El id se valida antes de tocar la base. Un id vacío o en blanco no se degrada a "sin marca":
 * eso dejaría la transacción evaluando `brand_id = ''`, que devuelve cero filas igual que no
 * tener variable, y el síntoma sería un producto vacío en vez de un error. Un scope sin marca es
 * un bug de programación, y se tira como tal.
 *
 * Los caminos que **no** son de una marca (migraciones, `pg-boss`, el barrido del worker, las
 * tablas de better-auth, los contadores públicos del audit) no tienen que usar esto: van con el
 * rol de dueño, que saltea RLS. Tampoco existe un `withBrand(null)` a propósito.
 */
export async function withBrand<T>(brandId: string, fn: (tx: BrandTransaction) => Promise<T>): Promise<T> {
	if (typeof brandId !== "string" || brandId.trim().length === 0) {
		throw new Error(
			"withBrand() necesita un brand_id no vacío: una transacción sin marca no ve ninguna fila y el producto se vería vacío.",
		);
	}

	return db.transaction(async (tx) => {
		await tx.execute(setBrandStatement(brandId));
		return fn(tx);
	});
}
