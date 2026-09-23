/**
 * aps-query — APS Fase 0 wired to the database and to Getcito's providers.
 *
 * Captures raw answers for the run's fan-out, stores them, and hands off to the judge. Capture and
 * analysis stay separate, so a formula change re-scores stored text instead of re-paying the models.
 *
 * Every provider call goes through the same usage tracking the product already uses, so an APS run
 * shows up in Admin > API Usage like any other run.
 */
import type { Job, PgBoss } from "pg-boss";
import { and, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { getProvider, parseScrapeTargets, selectTargetsForBrand, withProviderCallTracking } from "@workspace/lib/providers";
import { agentApsObservations, agentApsPrompts, agentApsRuns } from "@workspace/aos-aps/db/schema";
import {
	type MeasurementTargetConfig,
	type ProviderInvoker,
	captureRun,
	fanOut,
	queryTargetsFrom,
} from "@workspace/aos-aps/aps";

export interface ApsQueryData {
	runId: string;
}

export interface ApsQueryResult {
	ok: boolean;
	observations?: number;
	failures?: number;
	reason?: string;
}

/**
 * Injection seam. Production uses Getcito's provider registry; a verification run passes a fake so
 * the chain can be exercised end to end without spending a single real call.
 */
export interface ApsQueryDeps {
	invoke?: ProviderInvoker;
}

export async function apsQueryJob(
	jobs: Job<ApsQueryData>[],
	boss: PgBoss,
	deps: ApsQueryDeps = {},
): Promise<ApsQueryResult> {
	const [job] = jobs;
	if (job === undefined) throw new Error("aps-query handler received an empty batch");
	const { runId } = job.data;

	const [run] = await db.select().from(agentApsRuns).where(eq(agentApsRuns.id, runId)).limit(1);
	if (run === undefined) throw new Error(`APS run "${runId}" not found`);
	if (run.status !== "planned" && run.status !== "capturing") {
		console.log(`[aps-query] run ${runId} is ${run.status}, skipping`);
		return { ok: false, reason: `Estado inesperado: ${run.status}` };
	}

	const [brand] = await db.select().from(brands).where(eq(brands.id, run.brandId)).limit(1);
	if (brand === undefined) throw new Error(`Brand "${run.brandId}" not found`);

	const prompts = await db
		.select({ id: agentApsPrompts.id, text: agentApsPrompts.text })
		.from(agentApsPrompts)
		.where(and(eq(agentApsPrompts.libraryId, run.libraryId), eq(agentApsPrompts.enabled, true)))
		.orderBy(agentApsPrompts.createdAt);

	if (prompts.length === 0) {
		await db.update(agentApsRuns).set({ status: "failed", error: "La biblioteca no tiene prompts activos." }).where(eq(agentApsRuns.id, runId));
		return { ok: false, reason: "La biblioteca no tiene prompts activos." };
	}

	const configured = parseScrapeTargets(process.env.SCRAPE_TARGETS);
	const selected = selectTargetsForBrand(configured, run.models);
	const invoke: ProviderInvoker =
		deps.invoke ??
		(async (config, prompt) => {
			const provider = getProvider(config.provider);
			const result = await withProviderCallTracking(
				{ provider: provider.id, model: config.model, kind: "run", brandId: run.brandId, promptId: null },
				() =>
					provider.run(config.model, prompt, {
						webSearch: config.webSearch,
						version: config.version,
						targetMarket: brand.targetMarket ?? undefined,
						targetLanguage: brand.targetLanguage ?? undefined,
					}),
			);
			return typeof result.textContent === "string" ? result.textContent : "";
		});
	const { targets, duplicateModels } = queryTargetsFrom(selected as MeasurementTargetConfig[], invoke);
	if (duplicateModels.length > 0) {
		console.warn(`[aps-query] modelos duplicados en SCRAPE_TARGETS: ${duplicateModels.join(", ")}`);
	}

	await db.update(agentApsRuns).set({ status: "capturing", startedAt: new Date() }).where(eq(agentApsRuns.id, runId));

	const jobsList = fanOut(
		prompts.map((prompt) => prompt.text),
		run.models,
		run.effectiveRepetitions,
	);
	const report = await captureRun(jobsList, targets);

	if (report.answers.length > 0) {
		await db.insert(agentApsObservations).values(
			report.answers.map((answer) => {
				const prompt = prompts[answer.job.promptIndex];
				return {
					runId,
					promptId: prompt?.id ?? prompts[0]?.id ?? "",
					model: answer.job.model,
					runIndex: answer.job.runIndex,
					promptText: answer.job.promptText,
					fullResponse: answer.response,
				};
			}),
		);
	}

	await db
		.update(agentApsRuns)
		.set({ status: "parsing", completedCalls: report.summary.observations })
		.where(eq(agentApsRuns.id, runId));

	console.log(
		`[aps-query] run ${runId}: ${report.summary.observations}/${report.summary.attempted} respuestas (${report.failures.length} fallas)`,
	);

	await boss.send("aps-parse", { runId });
	return { ok: true, observations: report.summary.observations, failures: report.failures.length };
}
