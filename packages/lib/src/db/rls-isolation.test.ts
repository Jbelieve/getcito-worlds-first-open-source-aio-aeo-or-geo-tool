/**
 * RLS **de verdad**, medido contra un Postgres real: las políticas, el rol dedicado y los seis
 * casos que deciden si el aislamiento por fila existe o es una promesa.
 *
 * Este archivo reemplaza a la versión anterior, que medía lo contrario: que había RLS habilitado
 * en 22 tablas y **cero políticas**, que el rol de la app era el dueño y que por lo tanto
 * `ENABLE ROW LEVEL SECURITY` no cambiaba **ninguna** consulta. Ese hallazgo sigue siendo cierto
 * para el despliegue actual — el rol dedicado existe pero **no está activado** — y por eso el
 * caso 6 lo vuelve a medir: no alcanza con escribir políticas, hay que cambiar la identidad.
 *
 * No corre en la suite normal: sin `RLS_TEST_DATABASE_URL` se saltea, para no exigir
 * infraestructura a quien solo quiere correr los unitarios. El camino reproducible es
 * `scripts/rls-postgres-check.sh`, que levanta un contenedor descartable, aplica las 30
 * migraciones, corre esto y borra el contenedor.
 *
 * ## Los seis casos
 *
 *   1. Variable en la marca A → **solo** las filas de A.
 *   2. Variable en la marca B → **ni una** fila de A.
 *   3. **Sin** variable → **cero filas y ningún error** (fail-closed, silencioso a propósito).
 *   4. `INSERT` de una fila de B con la variable en A → **rechazado**.
 *   5. **La trampa**: dos "requests" seguidos con marcas distintas sobre **la misma conexión**
 *      (mismo `pg_backend_pid()`). El segundo no ve lo del primero — y al lado, un
 *      `set_config(..., false)` (el equivalente a `SET` sin `LOCAL`) que **sí** se filtra, para
 *      que la diferencia esté medida y no afirmada.
 *   6. El rol con el que la app conecta **hoy** sigue leyendo y escribiendo: RLS no lo alcanza.
 *
 * ## Lo que este test hace con la base
 *
 * Activa `beaos_app` (`ALTER ROLE ... LOGIN`) **dentro de la base descartable** para poder medir
 * el rol real que la migración crea, y lo vuelve a dejar en `NOLOGIN` al terminar. Nunca se
 * apunta a una base que no sea la descartable: la única entrada es `RLS_TEST_DATABASE_URL`.
 */

import { sql } from "drizzle-orm";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prompts } from "./schema";

const ADMIN_URL = process.env.RLS_TEST_DATABASE_URL;

/** Las dos marcas del test. El sufijo las hace reconocibles si algo queda sin limpiar. */
const BRAND_A = "rls-check-marca-a";
const BRAND_B = "rls-check-marca-b";

/** El rol que crea `0030_beaos_app_role.sql`. Se activa solo acá. */
const APP_ROLE = "beaos_app";

/** Cuántas entidades siembra el test por marca: distintos a propósito, para que un 0 sea un 0. */
const ENTIDADES_A = 1;
const ENTIDADES_B = 2;

/**
 * Las 14 tablas con `brand_id` propio: son las que llevan política directa. La lista está escrita
 * a mano y el test la compara contra el catálogo, así que agregar una tabla con `brand_id` y
 * olvidarse la política **rompe el test** en vez de pasar desapercibido.
 */
const TABLAS_CON_POLITICA = [
	"agent_aos_audits",
	"agent_aps_prompt_libraries",
	"agent_aps_runs",
	"agent_assets",
	"agent_brand_claims",
	"agent_brand_dna_snapshots",
	"agent_brand_entities",
	"brand_opportunities",
	"citations",
	"competitors",
	"prompt_run_attempts",
	"prompt_runs",
	"prompts",
	"provider_calls",
];

/**
 * Las tablas con RLS habilitado y **sin** `brand_id`: quedan sin política a propósito. Una
 * política acá no protege, **vacía la tabla**. El motivo de cada una está en
 * `RLS-ROL-Y-ACTIVACION.md`; el test solo exige que sigan sin política, para que nadie las
 * "arregle" con una política rota.
 */
const TABLAS_SIN_POLITICA = [
	"agent_api_tokens",
	"agent_aps_observations",
	"agent_aps_prompts",
	"agent_aps_scores",
	"aos_public_leads",
	"aos_public_usage",
	"brands",
	"reports",
];

const d = ADMIN_URL ? describe : describe.skip;

/**
 * La primera fila de un resultado, o un error claro.
 *
 * Evita repartir aserciones de no-nulo por todo el archivo: si una consulta no devuelve nada, el
 * síntoma tiene que ser "la consulta no devolvió ninguna fila" y no un `TypeError` sobre
 * `undefined` tres líneas más abajo, que es lo que hace difícil leer un test que falla.
 */
function primera<T>(filas: readonly T[]): T {
	const fila = filas[0];
	if (fila === undefined) throw new Error("la consulta no devolvió ninguna fila");
	return fila;
}

/** Una variable de entorno obligatoria, con un mensaje que dice cuál falta. */
function requerida(valor: string | undefined, nombre: string): string {
	if (!valor) throw new Error(`Falta ${nombre}: es la URL de la base descartable.`);
	return valor;
}

/**
 * El mensaje de un error **con su cadena de causas**.
 *
 * Drizzle envuelve el error de Postgres (`Failed query: ...`) y deja el original en `cause`, así
 * que quedarse con `error.message` haría pasar por "rechazado" cualquier fallo —incluso uno que
 * no tenga nada que ver con RLS—. Acá se exige que el mensaje de Postgres esté ahí.
 */
function mensajeConCausas(error: unknown): string {
	const partes: string[] = [];
	let actual: unknown = error;
	for (let i = 0; i < 5 && actual instanceof Error; i++) {
		partes.push(actual.message);
		actual = actual.cause;
	}
	return partes.join(" | ");
}

d("RLS real: políticas, rol dedicado y los seis casos", () => {
	/** El rol de dueño: el que migra y el que la app usa hoy. */
	let owner: Pool;
	/** El rol dedicado, con la misma conexión que tendría la app si se activara. */
	let app: Pool;
	/** `withBrand` real, importado después de apuntar `DATABASE_URL` al rol dedicado. */
	let withBrand: typeof import("./brand-scope").withBrand;
	let appUrl: string;

	/** Limpia las semillas en orden por las foreign keys. */
	const limpiar = async (pool: Pool) => {
		await pool.query(`DELETE FROM agent_brand_entities WHERE brand_id = ANY($1)`, [[BRAND_A, BRAND_B]]);
		await pool.query(`DELETE FROM prompts WHERE brand_id = ANY($1)`, [[BRAND_A, BRAND_B]]);
		await pool.query(`DELETE FROM brands WHERE id = ANY($1)`, [[BRAND_A, BRAND_B]]);
	};

	beforeAll(async () => {
		const ownerUrl = requerida(ADMIN_URL, "RLS_TEST_DATABASE_URL");
		owner = new Pool({ connectionString: ownerUrl });
		await limpiar(owner);

		await owner.query(
			`INSERT INTO brands (id, name, website) VALUES ($1, 'Marca A', 'a.test'), ($2, 'Marca B', 'b.test')`,
			[BRAND_A, BRAND_B],
		);
		for (let i = 0; i < ENTIDADES_A; i++) {
			await owner.query(`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES ($1, 'product', $2)`, [
				BRAND_A,
				`Entidad A${i}`,
			]);
		}
		for (let i = 0; i < ENTIDADES_B; i++) {
			await owner.query(`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES ($1, 'product', $2)`, [
				BRAND_B,
				`Entidad B${i}`,
			]);
		}
		await owner.query(`INSERT INTO prompts (brand_id, value) VALUES ($1, 'prompt de A'), ($2, 'prompt de B')`, [
			BRAND_A,
			BRAND_B,
		]);

		// Activar el rol dedicado SOLO en esta base descartable, para poder medir el rol real
		// que crea la migración. `NOLOGIN` es el estado que deja la migración y al que se vuelve
		// en `afterAll`.
		const password = `probe_${Math.random().toString(36).slice(2)}`;
		await owner.query(`ALTER ROLE ${APP_ROLE} LOGIN PASSWORD '${password}'`);
		const url = new URL(ownerUrl);
		url.username = APP_ROLE;
		url.password = password;
		appUrl = url.toString();

		app = new Pool({ connectionString: appUrl });

		process.env.DATABASE_URL = appUrl;
		({ withBrand } = await import("./brand-scope"));
	}, 60_000);

	afterAll(async () => {
		// Dejar el rol como lo deja la migración: creado y **sin poder conectarse**.
		if (owner) {
			await owner.query(`ALTER ROLE ${APP_ROLE} NOLOGIN`).catch(() => {});
			await limpiar(owner);
			await owner.end();
		}
		if (app) await app.end();
	});

	it("las 14 tablas con brand_id llevan política y las 8 sin brand_id siguen sin ninguna", async () => {
		const { rows } = await owner.query<{ tabla: string; politicas: string }>(
			`SELECT c.relname AS tabla, count(p.polname)::text AS politicas
			 FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 LEFT JOIN pg_policy p ON p.polrelid = c.oid
			 WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
			 GROUP BY c.relname ORDER BY c.relname`,
		);
		const porTabla = Object.fromEntries(rows.map((row) => [row.tabla, Number(row.politicas)]));

		for (const tabla of TABLAS_CON_POLITICA) {
			expect(`${tabla}:${porTabla[tabla]}`).toBe(`${tabla}:1`);
		}
		for (const tabla of TABLAS_SIN_POLITICA) {
			expect(`${tabla}:${porTabla[tabla]}`).toBe(`${tabla}:0`);
		}
		// Ni una tabla de más: las dos listas cubren las 22 con RLS habilitado.
		expect(Object.keys(porTabla).sort()).toEqual([...TABLAS_CON_POLITICA, ...TABLAS_SIN_POLITICA].sort());
	}, 30_000);

	it("el rol dedicado existe, no es dueño y no puede conectarse hasta que se lo active", async () => {
		const { rows } = await owner.query<{
			rolsuper: boolean;
			rolbypassrls: boolean;
			rolcreatedb: boolean;
			rolcreaterole: boolean;
			tablas_propias: string;
		}>(
			`SELECT r.rolsuper, r.rolbypassrls, r.rolcreatedb, r.rolcreaterole,
			        (SELECT count(*)::text FROM pg_class c
			           JOIN pg_namespace n ON n.oid = c.relnamespace
			          WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = r.rolname) AS tablas_propias
			   FROM pg_roles r WHERE r.rolname = $1`,
			[APP_ROLE],
		);
		const rol = primera(rows);
		expect(rol.rolsuper).toBe(false);
		expect(rol.rolbypassrls).toBe(false);
		expect(rol.rolcreatedb).toBe(false);
		expect(rol.rolcreaterole).toBe(false);
		// No es dueño de NI UNA tabla: es la condición para que las políticas lo alcancen.
		expect(rol.tablas_propias).toBe("0");
	}, 30_000);

	it("caso 1 — con la variable en la marca A se ven solo las filas de A", async () => {
		const entidades = await withBrand(BRAND_A, (tx) =>
			tx.execute<{ brand_id: string; n: string }>(
				sql`SELECT brand_id, count(*)::text AS n FROM agent_brand_entities GROUP BY brand_id`,
			),
		);
		expect(entidades.rows.map((row) => `${row.brand_id}:${row.n}`)).toEqual([`${BRAND_A}:${ENTIDADES_A}`]);

		// Y por el camino real de drizzle, no solo por SQL crudo.
		const filas = await withBrand(BRAND_A, (tx) => tx.select({ brandId: prompts.brandId }).from(prompts));
		expect(filas.map((fila) => fila.brandId)).toEqual([BRAND_A]);
	}, 30_000);

	it("caso 2 — con la variable en la marca B no se ve ni una fila de A", async () => {
		const { entidades, deA } = await withBrand(BRAND_B, async (tx) => {
			const todas = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM agent_brand_entities`);
			const soloA = await tx.execute<{ n: string }>(
				sql`SELECT count(*)::text AS n FROM agent_brand_entities WHERE brand_id = ${BRAND_A}`,
			);
			return { entidades: primera(todas.rows).n, deA: primera(soloA.rows).n };
		});
		expect(deA).toBe("0");
		expect(entidades).toBe(String(ENTIDADES_B));
	}, 30_000);

	it("caso 3 — sin la variable se ven CERO filas y NO hay error (fail-closed, en silencio)", async () => {
		// El `true` (missing_ok) es la pieza: sin variable, `current_setting` devuelve NULL.
		const { rows } = await app.query<{ v: string | null }>(`SELECT current_setting('beaos.brand_id', true) AS v`);
		expect(primera(rows).v).toBeNull();

		// Sin el `true`, esto sería un error de configuración — y por eso el `true` está puesto:
		// queremos "cero filas", no "roto hasta que alguien lo configure".
		await expect(app.query(`SELECT current_setting('beaos.brand_id')`)).rejects.toThrow(
			/unrecognized configuration parameter/,
		);

		// `brand_id = NULL` no es falso: es NULL, y la política no deja pasar la fila.
		const sinVariable = await app.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
		expect(primera(sinVariable.rows).n).toBe("0");

		// Y tampoco aparecen las de A ni las de B, que sí existen. La comparación es "al menos"
		// a propósito: `db-smoke.test.ts` corre contra la misma base y deja filas de su propia
		// marca, así que clavar el total acá sería un test que depende del orden de otro archivo.
		const comoDueno = await owner.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
		expect(Number(primera(comoDueno.rows).n)).toBeGreaterThanOrEqual(ENTIDADES_A + ENTIDADES_B);
	}, 30_000);

	it("caso 4 — un INSERT de la marca B con la variable en A se rechaza", async () => {
		const rechazo = await withBrand(BRAND_A, (tx) =>
			tx.execute(
				sql`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES (${BRAND_B}, 'product', 'colada de B')`,
			),
		).then(
			() => null,
			(error: unknown) => error,
		);
		expect(rechazo).toBeInstanceOf(Error);
		// El mensaje de Postgres tiene que estar en la cadena: si no, el "rechazo" podría ser
		// cualquier otra cosa (una FK, un tipo mal puesto) y el test pasaría igual.
		expect(mensajeConCausas(rechazo)).toMatch(/row-level security/i);

		// El rechazo no dejó basura: la transacción se cayó entera.
		const { rows } = await owner.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM agent_brand_entities WHERE brand_id = $1`,
			[BRAND_B],
		);
		expect(primera(rows).n).toBe(String(ENTIDADES_B));

		// Y el INSERT de la propia marca sí pasa.
		await withBrand(BRAND_B, (tx) =>
			tx.execute(
				sql`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES (${BRAND_B}, 'product', 'propia de B')`,
			),
		);
		const despues = await owner.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM agent_brand_entities WHERE brand_id = $1`,
			[BRAND_B],
		);
		expect(primera(despues.rows).n).toBe(String(ENTIDADES_B + 1));
	}, 30_000);

	it("caso 5 — dos requests con marcas distintas sobre la MISMA conexión, y la trampa del SET sin LOCAL", async () => {
		// Lo que existe de verdad, medido por el dueño: las expectativas salen de acá y no de una
		// fórmula, para que este caso no dependa de lo que hayan hecho los casos anteriores.
		const bReales = await owner.query<{ n: string }>(
			`SELECT count(*)::text AS n FROM agent_brand_entities WHERE brand_id = $1`,
			[BRAND_B],
		);
		// Por qué las dos llamadas caen en la misma conexión: el pool de la app está ocioso y
		// estos dos requests son **secuenciales**, así que `pg` saca de su pila de ociosos la
		// misma conexión que acaba de devolver el anterior (LIFO). Nota medida: `?max=1` en la
		// URL **no** sirve para forzarlo — `pg` resuelve `max` en las opciones del pool, no en la
		// cadena de conexión, así que el parámetro se ignora. La garantía no se pide, se
		// **comprueba**: el `pg_backend_pid()` de abajo exige que sea la misma conexión, y si
		// dejara de serlo el test falla en vez de pasar sin probar nada.
		const primero = await withBrand(BRAND_A, async (tx) => {
			const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
			const n = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM agent_brand_entities`);
			return { pid: primera(pid.rows).pid, n: primera(n.rows).n };
		});
		const segundo = await withBrand(BRAND_B, async (tx) => {
			const pid = await tx.execute<{ pid: number }>(sql`SELECT pg_backend_pid() AS pid`);
			const deA = await tx.execute<{ n: string }>(
				sql`SELECT count(*)::text AS n FROM agent_brand_entities WHERE brand_id = ${BRAND_A}`,
			);
			const total = await tx.execute<{ n: string }>(sql`SELECT count(*)::text AS n FROM agent_brand_entities`);
			const variable = await tx.execute<{ v: string | null }>(sql`SELECT current_setting('beaos.brand_id', true) AS v`);
			return {
				pid: primera(pid.rows).pid,
				deA: primera(deA.rows).n,
				total: primera(total.rows).n,
				variable: primera(variable.rows).v,
			};
		});

		// Misma conexión: sin esto, la prueba no probaría nada.
		expect(segundo.pid).toBe(primero.pid);
		// El primer request vio lo suyo.
		expect(primero.n).toBe(String(ENTIDADES_A));
		// El segundo NO ve nada del primero, y sí ve lo suyo.
		expect(segundo.deA).toBe("0");
		expect(segundo.total).toBe(primera(bReales.rows).n);
		// La variable quedó en B: `is_local` la ató a la transacción y la anterior murió con ella.
		expect(segundo.variable).toBe(BRAND_B);

		// --- La trampa, medida ---
		// `set_config(..., false)` es el equivalente a `SET` sin `LOCAL`: queda pegada a la
		// conexión. Un request siguiente que **no** setea nada hereda la marca anterior y ve sus
		// datos. Esto es exactamente lo que `withBrand` evita.
		const client = await app.connect();
		try {
			await client.query(`select set_config('beaos.brand_id', $1, false)`, [BRAND_A]);
			const heredado = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
			// Sin declarar ninguna marca, la conexión todavía dice A: la fuga, comprobada.
			expect(primera(heredado.rows).n).toBe(String(ENTIDADES_A));
			const { rows } = await client.query<{ v: string | null }>(`SELECT current_setting('beaos.brand_id', true) AS v`);
			expect(primera(rows).v).toBe(BRAND_A);

			// Y al soltar la conexión hay que limpiarla a mano, que es justo lo que no hay que
			// tener que recordar. `withBrand` no necesita este paso.
			await client.query(`RESET beaos.brand_id`);
			const limpio = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
			expect(primera(limpio.rows).n).toBe("0");
		} finally {
			client.release();
		}
	}, 30_000);

	it("caso 6 — el rol con el que la app conecta hoy sigue leyendo y escribiendo: RLS no lo alcanza", async () => {
		const identidad = await owner.query<{
			rol: string;
			rolsuper: boolean;
			rolbypassrls: boolean;
			tablas_propias: string;
		}>(
			`SELECT current_user AS rol,
			        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
			        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
			        (SELECT count(*)::text FROM pg_class c
			           JOIN pg_namespace n ON n.oid = c.relnamespace
			          WHERE n.nspname = 'public' AND pg_get_userbyid(c.relowner) = current_user) AS tablas_propias`,
		);
		const yo = primera(identidad.rows);
		// Las razones por las que las 14 políticas de arriba no cambian una sola consulta de la
		// app tal como está desplegada.
		expect(yo.rolsuper).toBe(true);
		expect(yo.tablas_propias).not.toBe("0");

		// Lo que hay en la tabla, contado por el dueño: la referencia de "TODO".
		const totalReal = await owner.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
		expect(Number(primera(totalReal.rows).n)).toBeGreaterThanOrEqual(ENTIDADES_A + ENTIDADES_B);

		// Lo medido, no lo deducido: con la variable puesta en A, el dueño sigue viendo TODO.
		const client = await owner.connect();
		try {
			await client.query("BEGIN");
			await client.query(`select set_config('beaos.brand_id', $1, true)`, [BRAND_A]);
			const todas = await client.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_brand_entities`);
			expect(Number(primera(todas.rows).n)).toBe(Number(primera(totalReal.rows).n));

			// Y escribe una fila de OTRA marca con la variable en A, sin que nadie se lo impida.
			await client.query(
				`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES ($1, 'product', 'escrita por el dueño')`,
				[BRAND_B],
			);
			await client.query("ROLLBACK");
		} finally {
			client.release();
		}

		// La app sigue leyendo y escribiendo sobre las tablas de AOS/APS y sobre las del producto,
		// que es la condición de "no romper el producto mientras el rol no se active".
		const appClient = await owner.connect();
		try {
			const leido = await appClient.query<{ n: string }>(`SELECT count(*)::text AS n FROM agent_aps_runs`);
			expect(typeof primera(leido.rows).n).toBe("string");
			const escrito = await appClient.query<{ id: string }>(
				`INSERT INTO agent_brand_entities (brand_id, entity_type, name)
				 VALUES ($1, 'product', 'la app con el rol de dueño') RETURNING id`,
				[BRAND_A],
			);
			expect(primera(escrito.rows).id).toBeTruthy();
			await appClient.query(`DELETE FROM agent_brand_entities WHERE id = $1`, [primera(escrito.rows).id]);
		} finally {
			appClient.release();
		}
	}, 30_000);

	/**
	 * El efecto colateral que deja el rol dedicado fuera de alcance, medido: `brands` no tiene
	 * `brand_id` —su clave primaria **es** la marca— así que se queda sin política, y con el rol
	 * dedicado la tabla de identidad devuelve **cero filas**. Eso solo ya rompe el selector de
	 * organizaciones y el listado de marcas del admin. Es una de las razones por las que el rol
	 * no se activa, y por eso se mide en vez de suponerse.
	 */
	it("por qué el rol no se puede activar todavía: con el rol dedicado la tabla `brands` queda vacía", async () => {
		const comoDueno = await owner.query<{ n: string }>(`SELECT count(*)::text AS n FROM brands`);
		expect(Number(primera(comoDueno.rows).n)).toBeGreaterThanOrEqual(2);

		const comoApp = await app.query<{ n: string }>(`SELECT count(*)::text AS n FROM brands`);
		expect(primera(comoApp.rows).n).toBe("0");
	}, 30_000);
});
