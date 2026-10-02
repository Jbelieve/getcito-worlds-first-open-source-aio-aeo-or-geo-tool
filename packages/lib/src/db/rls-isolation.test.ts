/**
 * Aislamiento por fila (RLS) y el rol de la app — contra un Postgres **real**.
 *
 * Este test **no** corre en la suite normal: sin `RLS_TEST_DATABASE_URL` se saltea, para
 * no exigir infraestructura a quien solo quiere correr los unitarios. Con la variable
 * puesta (una base ya migrada, ver `scripts/rls-postgres-check.sh`) prueba las tres cosas
 * que importan, y **declara** lo que no puede probar.
 *
 *   1. Las tablas de AOS/APS tienen RLS **habilitado**, igual que las del producto.
 *   2. El rol de la app (el que usa `DATABASE_URL`) sigue **leyendo y escribiendo**:
 *      activar RLS sin la política correcta deja todo afuera, y un arreglo de seguridad
 *      que rompe el producto es el peor resultado posible.
 *   3. Cuál es el alcance real del aislamiento hoy, medido: cero políticas en toda la
 *      base, el dueño de la tabla saltea RLS, y un rol sin `BYPASSRLS` ve **cero filas**
 *      (RLS filtra en silencio) y no puede escribir.
 *
 * El punto (3) no es una nota al pie. Es la respuesta a "¿esto aísla algo?": con el rol
 * con el que la app conecta en este despliegue, `ENABLE ROW LEVEL SECURITY` **no cambia
 * el resultado de ninguna consulta**. El aislamiento efectivo entre marcas viene del
 * filtro por `brand_id` de la aplicación y del candado de publicación, no de RLS.
 *
 * Lo que **no se puede probar acá**, y por eso no se afirma: que con la identidad de una
 * marca no se vean las filas de otra **porque RLS lo impida**. Haría falta una política
 * por marca (`USING (brand_id = current_setting('beaos.brand_id'))`), un rol sin
 * `BYPASSRLS` y que la app fije esa variable por transacción. Nada de eso existe hoy.
 */

import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.RLS_TEST_DATABASE_URL;

/** Identidad de la marca que inserta el test. */
const BRAND_A = "rls-test-marca-a";

const TABLAS_AOS_APS = [
	"agent_brand_entities",
	"agent_aos_audits",
	"agent_brand_dna_snapshots",
	"agent_assets",
	"agent_brand_claims",
	"agent_aps_prompt_libraries",
	"agent_aps_prompts",
	"agent_aps_runs",
	"agent_aps_observations",
	"agent_aps_scores",
	"agent_api_tokens",
];

const d = ADMIN_URL ? describe : describe.skip;

d("RLS de AOS/APS contra Postgres real", () => {
	let pool: Pool;
	let appRole = "desconocido";
	let appBypassesRls = false;
	let appOwnsTables = false;
	/** Rol que NO es dueño y NO saltea RLS: la identidad de un despliegue endurecido. */
	let hardenedUrl: string | null = null;

	beforeAll(async () => {
		pool = new Pool({ connectionString: ADMIN_URL });
		const { rows } = await pool.query<{
			app_role: string;
			rolsuper: boolean;
			rolbypassrls: boolean;
			owns: boolean;
		}>(
			`SELECT current_user AS app_role,
			        (SELECT rolsuper FROM pg_roles WHERE rolname = current_user) AS rolsuper,
			        (SELECT rolbypassrls FROM pg_roles WHERE rolname = current_user) AS rolbypassrls,
			        bool_or(pg_get_userbyid(c.relowner) = current_user) AS owns
			 FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relname = ANY($1)`,
			[TABLAS_AOS_APS],
		);
		const row = rows[0];
		appRole = row?.app_role ?? "desconocido";
		appBypassesRls = Boolean(row?.rolsuper) || Boolean(row?.rolbypassrls);
		appOwnsTables = Boolean(row?.owns);

		await pool.query(`DELETE FROM agent_brand_entities WHERE brand_id = $1`, [BRAND_A]);
		await pool.query(`DELETE FROM brands WHERE id = $1`, [BRAND_A]);
		await pool.query(`INSERT INTO brands (id, name, website) VALUES ($1, 'Marca A', 'a.test')`, [BRAND_A]);
		await pool.query(
			`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES ($1, 'product', 'Entidad A')`,
			[BRAND_A],
		);

		hardenedUrl = await ensureHardenedRole(pool);
	}, 60_000);

	afterAll(async () => {
		if (!pool) return;
		await pool.query(`DELETE FROM agent_brand_entities WHERE brand_id = $1`, [BRAND_A]);
		await pool.query(`DELETE FROM brands WHERE id = $1`, [BRAND_A]);
		await pool.end();
	});

	it("habilita RLS en las tablas de AOS y APS, igual que el esquema de producto", async () => {
		const { rows } = await pool.query<{ relname: string; relrowsecurity: boolean; forcerls: boolean }>(
			`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity AS forcerls
			 FROM pg_class c
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public' AND c.relname = ANY($1)
			 ORDER BY c.relname`,
			[TABLAS_AOS_APS],
		);

		expect(rows.map((row) => row.relname).sort()).toEqual([...TABLAS_AOS_APS].sort());
		for (const row of rows) {
			expect(`${row.relname}:${row.relrowsecurity}`).toBe(`${row.relname}:true`);
		}
	}, 30_000);

	it("el rol de la app sigue leyendo y escribiendo sobre las tablas de AOS/APS", async () => {
		const client = await pool.connect();
		try {
			const inserted = await client.query<{ id: string; brand_id: string }>(
				`INSERT INTO agent_brand_entities (brand_id, entity_type, name)
				 VALUES ($1, 'product', 'Escritura de la app') RETURNING id, brand_id`,
				[BRAND_A],
			);
			expect(inserted.rows[0]?.id).toBeTruthy();
			expect(inserted.rows[0]?.brand_id).toBe(BRAND_A);

			const read = await client.query<{ name: string }>(
				`SELECT name FROM agent_brand_entities WHERE brand_id = $1 ORDER BY created_at DESC LIMIT 1`,
				[BRAND_A],
			);
			expect(read.rows[0]?.name).toBe("Escritura de la app");

			// También sobre una tabla del APS, que es la mitad que no tenía RLS.
			const runs = await client.query(`SELECT count(*)::int AS n FROM agent_aps_runs`);
			expect(typeof runs.rows[0]?.n).toBe("number");

			await client.query(`DELETE FROM agent_brand_entities WHERE id = $1`, [inserted.rows[0]!.id]);
		} finally {
			client.release();
		}
	}, 30_000);

	it("mide el alcance real: cero políticas, el dueño saltea y un rol endurecido queda afuera", async () => {
		const { rows } = await pool.query<{ policies: string }>(
			`SELECT count(*)::text AS policies FROM pg_policy p
			 JOIN pg_class c ON c.oid = p.polrelid
			 JOIN pg_namespace n ON n.oid = c.relnamespace
			 WHERE n.nspname = 'public'`,
		);
		// Cero políticas: el estado real del repo, medido y no supuesto.
		expect(rows[0]?.policies).toBe("0");

		// El rol de la app puede, porque es dueño de las tablas o saltea RLS.
		expect(appOwnsTables || appBypassesRls).toBe(true);
		expect(appRole.length).toBeGreaterThan(0);

		if (hardenedUrl !== null) {
			const hardened = new Pool({ connectionString: hardenedUrl });
			try {
				// Sin políticas, RLS no tira un error en el SELECT: **filtra todo**. El rol
				// ve cero filas y la app creería que la base está vacía. Es el modo de falla
				// más silencioso y por eso hay que medirlo, no suponerlo.
				const filtered = await hardened.query<{ count: string }>(`SELECT count(*) FROM agent_brand_entities`);
				expect(filtered.rows[0]?.count).toBe("0");

				// La escritura sí falla, y fuerte.
				await expect(
					hardened.query(
						`INSERT INTO agent_brand_entities (brand_id, entity_type, name) VALUES ($1, 'product', 'probe')`,
						[BRAND_A],
					),
				).rejects.toThrow(/row-level security/i);
			} finally {
				await hardened.end();
			}
		}
	}, 30_000);
});

/**
 * Crea (idempotente) un rol de login sin superusuario y sin BYPASSRLS, le da los permisos
 * que tendría la app y devuelve su URL de conexión.
 *
 * `NOSUPERUSER NOBYPASSRLS` es el punto: es el único rol con el que `enableRLS()` tiene
 * algún efecto, así que es el único con el que se puede medir si el aislamiento existe.
 */
async function ensureHardenedRole(pool: Pool): Promise<string | null> {
	try {
		await pool.query(`DROP ROLE IF EXISTS beaos_rls_probe`);
		await pool.query(`CREATE ROLE beaos_rls_probe LOGIN PASSWORD 'probe' NOSUPERUSER NOBYPASSRLS`);
		await pool.query(`GRANT USAGE ON SCHEMA public TO beaos_rls_probe`);
		await pool.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO beaos_rls_probe`);
		const url = new URL(ADMIN_URL!);
		url.username = "beaos_rls_probe";
		url.password = "probe";
		return url.toString();
	} catch (error) {
		console.warn("[rls-test] no se pudo crear el rol de sondeo:", error instanceof Error ? error.message : error);
		return null;
	}
}
