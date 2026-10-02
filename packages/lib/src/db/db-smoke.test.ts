/**
 * La app sigue leyendo y escribiendo — **con el esquema que importan el worker y la web**,
 * contra un Postgres real.
 *
 * El test de `rls-isolation.test.ts` mide el comportamiento del motor con SQL crudo. Este
 * mide lo que de verdad importa para no romper el producto: que el esquema drizzle que
 * usan ambos procesos inserte y lea sobre la tabla nueva (`prompt_run_attempts`) y sobre
 * las columnas nuevas (`requested_version`, `reported_model_version`) — las tablas que
 * ahora tienen RLS, sobre la misma base.
 *
 * Las tablas de AOS/APS se validan con SQL crudo en `scripts/rls-postgres-check.sh`: su
 * esquema vive en `@workspace/aos-aps`, que no es resoluble desde el tsconfig de este
 * paquete, así que acá no se importa (declarado, no escondido).
 *
 * Se saltea sin `RLS_TEST_DATABASE_URL`.
 */
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { brands, promptRunAttempts, promptRuns, prompts } from "./schema";

const ADMIN_URL = process.env.RLS_TEST_DATABASE_URL;
const BRAND_ID = "rls-smoke-marca";

const d = ADMIN_URL ? describe : describe.skip;

d("la app lee y escribe con RLS activado (drizzle, Postgres real)", () => {
	let pool: Pool;
	let db: ReturnType<typeof drizzle>;

	const clean = async (client: Pool) => {
		await client.query(`DELETE FROM prompt_run_attempts WHERE brand_id = $1`, [BRAND_ID]);
		await client.query(`DELETE FROM prompt_runs WHERE brand_id = $1`, [BRAND_ID]);
		await client.query(`DELETE FROM prompts WHERE brand_id = $1`, [BRAND_ID]);
		await client.query(`DELETE FROM brands WHERE id = $1`, [BRAND_ID]);
	};

	beforeAll(async () => {
		pool = new Pool({ connectionString: ADMIN_URL });
		db = drizzle(pool);
		await clean(pool);
		await db.insert(brands).values({ id: BRAND_ID, name: "Smoke", website: "smoke.test" });
	}, 60_000);

	afterAll(async () => {
		if (!pool) return;
		await clean(pool);
		await pool.end();
	});

	it("escribe y lee la tabla de intentos, que es el denominador nuevo", async () => {
		const [prompt] = await db
			.insert(prompts)
			.values({ brandId: BRAND_ID, value: "mejor crm" })
			.returning({ id: prompts.id });

		await db.insert(promptRunAttempts).values([
			{
				promptId: prompt!.id,
				brandId: BRAND_ID,
				model: "chatgpt",
				provider: "dataforseo",
				runIndex: 1,
				cycleDate: "2026-10-02",
				success: true,
				errorMessage: null,
				promptRunId: null,
			},
			{
				promptId: prompt!.id,
				brandId: BRAND_ID,
				model: "gemini",
				provider: "dataforseo",
				runIndex: 1,
				cycleDate: "2026-10-02",
				success: false,
				errorMessage: "timeout",
				promptRunId: null,
			},
		]);

		const rows = await db.select().from(promptRunAttempts).where(eq(promptRunAttempts.brandId, BRAND_ID));
		expect(rows).toHaveLength(2);
		expect(rows.filter((row) => row.success === false)).toHaveLength(1);
		expect(rows.find((row) => row.model === "gemini")?.errorMessage).toBe("timeout");

		// El ciclo agrupado es lo que publica la cobertura "N de M".
		const cycle = await db.execute<{ planned: number; failed: number }>(sql`
			SELECT count(*)::int AS planned, count(*) FILTER (WHERE NOT success)::int AS failed
			FROM prompt_run_attempts WHERE brand_id = ${BRAND_ID}
		`);
		expect(cycle.rows[0]?.planned).toBe(2);
		expect(cycle.rows[0]?.failed).toBe(1);
	});

	it("guarda el modelo pedido y el reportado en columnas distintas", async () => {
		const [prompt] = await db
			.insert(prompts)
			.values({ brandId: BRAND_ID, value: "mejor crm 2" })
			.returning({ id: prompts.id });

		const [run] = await db
			.insert(promptRuns)
			.values({
				promptId: prompt!.id,
				brandId: BRAND_ID,
				model: "chatgpt",
				provider: "dataforseo",
				version: "gpt-5.5",
				requestedVersion: "gpt-5.5",
				// El proveedor no lo informó: `null`, nunca el nombre pedido.
				reportedModelVersion: null,
				webSearchEnabled: true,
				rawOutput: {},
				webQueries: [],
				brandMentioned: false,
				competitorsMentioned: [],
			})
			.returning({ id: promptRuns.id });

		const [read] = await db.select().from(promptRuns).where(eq(promptRuns.id, run!.id));
		expect(read?.requestedVersion).toBe("gpt-5.5");
		expect(read?.reportedModelVersion).toBeNull();

		// Y cuando el proveedor sí lo informa, se guarda ESA versión.
		const [reported] = await db
			.insert(promptRuns)
			.values({
				promptId: prompt!.id,
				brandId: BRAND_ID,
				model: "claude",
				provider: "openrouter",
				version: "claude-sonnet-4-5-20250929",
				requestedVersion: "anthropic/claude-sonnet-4.5",
				reportedModelVersion: "anthropic/claude-sonnet-4.5-20250929",
				webSearchEnabled: true,
				rawOutput: {},
				webQueries: [],
				brandMentioned: false,
				competitorsMentioned: [],
			})
			.returning({ id: promptRuns.id });

		const [readReported] = await db.select().from(promptRuns).where(eq(promptRuns.id, reported!.id));
		expect(readReported?.requestedVersion).toBe("anthropic/claude-sonnet-4.5");
		expect(readReported?.reportedModelVersion).toBe("anthropic/claude-sonnet-4.5-20250929");
	});

	/**
	 * Las tablas de AOS/APS con el rol de la app, leídas y escritas de verdad.
	 *
	 * Se hace con SQL crudo porque el esquema de ese paquete no es importable desde acá
	 * (rootDir). Lo que importa es la identidad: es la misma conexión con la que la app
	 * habla con la base, así que si RLS hubiera dejado todo afuera, esto falla.
	 */
	it("lee y escribe las tablas de AOS/APS con el rol de la app", async () => {
		const client = await pool.connect();
		try {
			const entity = await client.query<{ id: string }>(
				`INSERT INTO agent_brand_entities (brand_id, entity_type, name)
				 VALUES ($1, 'product', 'Entidad smoke') RETURNING id`,
				[BRAND_ID],
			);
			expect(entity.rows[0]?.id).toBeTruthy();

			const library = await client.query<{ id: string }>(
				`INSERT INTO agent_aps_prompt_libraries (brand_id, entity_id, version, unlocks_at)
				 VALUES ($1, $2, 1, now() + interval '1 day') RETURNING id`,
				[BRAND_ID, entity.rows[0]!.id],
			);
			const apsPrompt = await client.query<{ id: string }>(
				`INSERT INTO agent_aps_prompts (library_id, text, kind, funnel_stage)
				 VALUES ($1, '¿Cuál es el mejor CRM?', 'category', 'awareness') RETURNING id`,
				[library.rows[0]!.id],
			);
			const run = await client.query<{ id: string }>(
				`INSERT INTO agent_aps_runs
				   (brand_id, entity_id, library_id, models, requested_repetitions, effective_repetitions,
				    planned_calls, scoring_version, measurement_version, judge_model_alias, judge_model_version,
				    judge_pipeline_version, prompt_library_version)
				 VALUES ($1, $2, $3, ARRAY['chatgpt'], 1, 1, 1, 'test', 'test', 'judge', 'judge-1', 'test', 1)
				 RETURNING id`,
				[BRAND_ID, entity.rows[0]!.id, library.rows[0]!.id],
			);

			await client.query(
				`INSERT INTO agent_aps_observations
				   (run_id, prompt_id, model, model_version_reported, requested_model_version, run_index, prompt_text, full_response)
				 VALUES ($1, $2, 'chatgpt', NULL, 'gpt-5.5', 0, '¿Cuál es el mejor CRM?', 'respuesta')`,
				[run.rows[0]!.id, apsPrompt.rows[0]!.id],
			);

			const read = await client.query<{
				model: string;
				model_version_reported: string | null;
				requested_model_version: string | null;
			}>(
				`SELECT model, model_version_reported, requested_model_version
				 FROM agent_aps_observations WHERE run_id = $1`,
				[run.rows[0]!.id],
			);
			expect(read.rows[0]?.model).toBe("chatgpt");
			// El proveedor no lo informó: `null` declarado, nunca el nombre pedido.
			expect(read.rows[0]?.model_version_reported).toBeNull();
			expect(read.rows[0]?.requested_model_version).toBe("gpt-5.5");

			// Limpieza en orden por las foreign keys.
			await client.query(`DELETE FROM agent_aps_runs WHERE id = $1`, [run.rows[0]!.id]);
			await client.query(`DELETE FROM agent_aps_prompt_libraries WHERE id = $1`, [library.rows[0]!.id]);
			await client.query(`DELETE FROM agent_brand_entities WHERE id = $1`, [entity.rows[0]!.id]);
		} finally {
			client.release();
		}
	});
});
