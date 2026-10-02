/**
 * Las dos piezas de `withBrand()` que se pueden probar **sin** base de datos, y que son
 * justamente las que evitan el modo de falla silencioso.
 *
 * El resto —que el aislamiento funcione de verdad— se prueba contra un Postgres real en
 * `./rls-isolation.test.ts`, que necesita `RLS_TEST_DATABASE_URL`.
 */

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { BRAND_SETTING } from "./brand-isolation";
import { setBrandStatement, withBrand } from "./brand-scope";

const dialect = new PgDialect();

describe("withBrand()", () => {
	/**
	 * Un scope sin marca **no** se degrada a "sin marca": se tira.
	 *
	 * Si se degradara, la transacción evaluaría `brand_id = ''`, que da cero filas igual que no
	 * tener variable — y el síntoma en producción sería un producto vacío en vez de un error. El
	 * fail-closed silencioso está bien para la base (es lo que hace segura la política) y mal
	 * para el código, que puede y debe avisar.
	 */
	it("rechaza un brand_id vacío en vez de degradar a 'sin marca'", async () => {
		await expect(withBrand("", async () => "nunca")).rejects.toThrow(/no vacío/);
		await expect(withBrand("   ", async () => "nunca")).rejects.toThrow(/no vacío/);
		await expect(withBrand(undefined as unknown as string, async () => "nunca")).rejects.toThrow(/no vacío/);
	});

	/**
	 * `is_local = true` es **la** diferencia entre dos comportamientos opuestos:
	 *
	 *   - `true` → la variable muere con la transacción. Es lo que evita que la marca B herede la
	 *     conexión que usó la marca A.
	 *   - `false` → la variable queda pegada a la conexión. Con un pool, el request siguiente la
	 *     hereda y ve los datos de la marca anterior.
	 *
	 * El caso 5 de `rls-isolation.test.ts` mide la diferencia contra Postgres; acá se fija que el
	 * helper no pueda cambiar de bando sin que alguien lo note.
	 */
	it("fija la variable con is_local = true, no a nivel de conexión", () => {
		const { sql: texto, params } = dialect.sqlToQuery(setBrandStatement("marca-a"));

		expect(texto).toBe("select set_config($1, $2, true)");
		expect(params).toEqual([BRAND_SETTING, "marca-a"]);
		// El `true` literal, para que un cambio a `false` rompa acá y no en producción.
		expect(texto).toMatch(/set_config\(\$1, \$2, true\)/);
	});

	/** El nombre del parámetro es un contrato entre la política (SQL) y el helper (TS). */
	it("el parámetro de sesión sigue siendo el que leen las políticas", () => {
		expect(BRAND_SETTING).toBe("beaos.brand_id");
	});
});
