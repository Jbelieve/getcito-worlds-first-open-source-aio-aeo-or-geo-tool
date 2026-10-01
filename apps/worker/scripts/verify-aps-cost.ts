/**
 * Verificación del costo real de una corrida APS contra un Postgres real.
 *
 * Existe porque la parte que más fácil se rompe en silencio es la lectura: el
 * costo se guarda como `numeric`, Drizzle lo devuelve como **string**, y un
 * `Number.parseFloat` de más o de menos convierte un total en `NaN` sin que nada
 * falle. Este script hace el recorrido completo —insertar llamadas con costo,
 * costo `null` y costo `0`, leerlas y sumarlas— contra una base de verdad.
 *
 * Uso:
 *   DATABASE_URL=postgres://... npx tsx scripts/verify-aps-cost.ts
 *
 * Escribe una corrida de prueba y la borra al terminar. No toca ninguna corrida
 * existente: la marca y la entidad de prueba se crean y se destruyen acá.
 */
import { randomUUID } from "node:crypto";
import { compareEstimatedToActual } from "@workspace/aos-aps/aps";
import { agentApsPromptLibraries, agentApsRuns, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands, providerCalls } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";
import { readApsRunRealCost } from "../src/jobs/aps-cost";

async function main(): Promise<void> {
	const brandId = `verify-cost-${randomUUID()}`;
	const entityId = randomUUID();
	const runId = randomUUID();

	await db.insert(brands).values({ id: brandId, name: "Verificación de costo", website: "https://verify.test" });
	await db.insert(agentBrandEntities).values({
		id: entityId,
		brandId,
		entityType: "umbrella",
		name: "Verificación de costo",
	});
	const [library] = await db
		.insert(agentApsPromptLibraries)
		.values({
			brandId,
			entityId,
			version: 1,
			status: "active",
			lockedAt: new Date(),
			unlocksAt: new Date(Date.now() + 86_400_000),
		})
		.returning({ id: agentApsPromptLibraries.id });
	if (library === undefined) throw new Error("no se pudo crear la biblioteca de prueba");

	await db.insert(agentApsRuns).values({
		id: runId,
		brandId,
		entityId,
		libraryId: library.id,
		status: "scoring",
		models: ["chatgpt", "perplexity"],
		requestedRepetitions: 1,
		effectiveRepetitions: 1,
		plannedCalls: 4,
		// Estimado deliberadamente distinto del real para ver el veredicto.
		estimatedCostUsd: "1",
		scoringVersion: "v",
		measurementVersion: "v",
		judgeModelAlias: "believe-deep",
		judgeModelVersion: "v",
		judgePipelineVersion: "v",
		promptLibraryVersion: 1,
	});

	await db.insert(providerCalls).values([
		// Medición con costo real informado por el proveedor.
		{
			provider: "openrouter",
			model: "chatgpt",
			kind: "run",
			brandId,
			agentApsRunId: runId,
			success: true,
			costUsd: "0.4000000000",
			pricingSource: "provider",
			promptTokens: 1000,
			completionTokens: 2000,
		},
		// Medición cuyo proveedor reporta tokens y ningún costo: el total tiene que quedar incompleto.
		{
			provider: "openai-api",
			model: "chatgpt",
			kind: "run",
			brandId,
			agentApsRunId: runId,
			success: true,
			costUsd: null,
			pricingSource: "tokens_only",
			promptTokens: 500,
			completionTokens: 700,
		},
		// Scraper: no puede reportar ni costo ni tokens.
		{ provider: "brightdata", model: "perplexity", kind: "run", brandId, agentApsRunId: runId, success: true },
		// Juez: pasa por el gateway y su costo está facturado.
		{
			provider: "gateway",
			model: "believe-deep",
			kind: "aps_judge",
			brandId,
			agentApsRunId: runId,
			success: true,
			costUsd: "0.0100000000",
			pricingSource: "gateway_header",
			promptTokens: 812,
			completionTokens: 140,
			reasoningTokens: 940,
		},
		// Una llamada de OTRA corrida: no puede entrar en esta suma.
		{
			provider: "gateway",
			model: "believe-deep",
			kind: "aps_judge",
			brandId,
			agentApsRunId: randomUUID(),
			success: true,
			costUsd: "99",
			pricingSource: "gateway_header",
		},
	]);

	try {
		const cost = await readApsRunRealCost(runId);
		const comparison = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: cost.measurement,
			judge: cost.judge,
		});

		console.log("medición:", cost.measurement);
		console.log("juez:", cost.judge);
		console.log("comparación:", comparison);

		const problems: string[] = [];
		if (cost.measurement.calls !== 3)
			problems.push(`la medición debería tener 3 llamadas, tiene ${cost.measurement.calls}`);
		if (cost.measurement.unpricedCalls !== 2)
			problems.push(`faltan 2 costos de medición, el script contó ${cost.measurement.unpricedCalls}`);
		if (cost.measurement.pricedUsd !== 0.4)
			problems.push(`la cota inferior debería ser 0.4, es ${cost.measurement.pricedUsd}`);
		if (cost.measurement.costUsd !== null)
			problems.push("el total de medición debería ser null: hay llamadas sin costo");
		if (cost.judge.unpricedCalls !== 0) problems.push("el juez debería estar completo");
		if (Math.abs(cost.judge.pricedUsd - 0.01) > 1e-9)
			problems.push(`el juez debería costar 0.01, es ${cost.judge.pricedUsd}`);
		if (comparison.verdict !== "incomplete")
			problems.push(`el veredicto debería ser incomplete, es ${comparison.verdict}`);
		if (comparison.totalUsd !== null) problems.push("no puede haber total con llamadas sin costo");
		if (comparison.unpricedCalls !== 2)
			problems.push(`debería informar 2 llamadas sin costo, informó ${comparison.unpricedCalls}`);

		if (problems.length > 0) {
			console.error("\nFALLÓ:");
			for (const problem of problems) console.error(`  - ${problem}`);
			process.exitCode = 1;
			return;
		}
		console.log("\nOK: la suma no inventa costos y el total incompleto se declara incompleto.");
	} finally {
		await db.delete(providerCalls).where(eq(providerCalls.agentApsRunId, runId));
		await db.delete(agentApsRuns).where(eq(agentApsRuns.id, runId));
		await db.delete(agentApsPromptLibraries).where(eq(agentApsPromptLibraries.brandId, brandId));
		await db.delete(agentBrandEntities).where(eq(agentBrandEntities.id, entityId));
		await db.delete(brands).where(eq(brands.id, brandId));
	}
}

main().then(
	() => process.exit(process.exitCode ?? 0),
	(error) => {
		console.error(error);
		process.exit(1);
	},
);
