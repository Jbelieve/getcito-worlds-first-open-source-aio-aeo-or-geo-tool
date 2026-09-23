/**
 * APS run controls for the UI.
 *
 * On demand by design: `estimate` shows what a run would cost without writing anything, `start`
 * creates the run only after the operator confirmed, and the worker chain takes it from there.
 * Nothing here spends money by itself.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import {
	agentAosAudits,
	agentApsPromptLibraries,
	agentApsPrompts,
	agentApsRuns,
	agentApsScores,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import {
	GATEWAY_JUDGE_PIPELINE_VERSION,
	apsBudgetConfigFromEnv,
	apsPricesFromEnv,
	judgeConfigFromEnv,
	prepareApsRun,
} from "@workspace/aos-aps/aps";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getBoss } from "@/lib/boss-client";

const runInput = z.object({
	brandId: z.string().min(1),
	entityId: z.string().uuid(),
	models: z.array(z.string().min(1)).min(1).optional(),
	repetitions: z.number().int().min(1).max(5).optional(),
	spentThisMonthUsd: z.number().min(0).nullable().optional(),
});

/** Candidate prompt libraries are the operator's: generation is a separate, explicit step. */
export const saveApsLibraryFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			entityId: z.string().uuid(),
			prompts: z
				.array(
					z.object({
						text: z.string().min(1),
						kind: z.enum(["comparison", "use_case", "category"]),
						funnelStage: z.enum(["awareness", "consideration", "decision"]),
					}),
				)
				.min(1),
			supersede: z.boolean().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const boss = await getBoss();
		await boss.send("aps-prompt-library", {
			brandId: data.brandId,
			entityId: data.entityId,
			prompts: data.prompts,
			supersede: data.supersede ?? false,
		});
		return { ok: true };
	});

/** Everything a run needs, read once and handed to the pure preparation step. */
async function loadRunContext(data: z.infer<typeof runInput>) {
	const [entity] = await db
		.select({
			id: agentBrandEntities.id,
			name: agentBrandEntities.name,
			websiteUrl: agentBrandEntities.websiteUrl,
		})
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
		.limit(1);
	if (entity === undefined) throw new Error("Entity not found");

	const [library] = await db
		.select({ id: agentApsPromptLibraries.id, version: agentApsPromptLibraries.version })
		.from(agentApsPromptLibraries)
		.where(and(eq(agentApsPromptLibraries.entityId, data.entityId), eq(agentApsPromptLibraries.status, "active")))
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);

	const prompts =
		library === undefined
			? []
			: await db
					.select({ id: agentApsPrompts.id, text: agentApsPrompts.text })
					.from(agentApsPrompts)
					.where(and(eq(agentApsPrompts.libraryId, library.id), eq(agentApsPrompts.enabled, true)));

	// The AOS audit of the same site feeds the capacidad_accion dimension.
	const [audit] = await db
		.select({ score: agentAosAudits.score })
		.from(agentAosAudits)
		.where(eq(agentAosAudits.brandId, data.brandId))
		.orderBy(desc(agentAosAudits.createdAt))
		.limit(1);

	const judgeConfig = judgeConfigFromEnv();
	const models = data.models ?? (process.env.SCRAPE_TARGETS ?? "").split(",").map((entry) => entry.split(":")[0]?.trim() ?? "").filter((model) => model.length > 0);

	return {
		entity,
		library: library ?? null,
		prompts,
		capacidadAccion: audit?.score ?? null,
		judge: {
			alias: judgeConfig?.model ?? process.env.APS_JUDGE_MODEL?.trim() ?? "believe-deep",
			version: judgeConfig?.version ?? "unpinned",
			pipelineVersion: GATEWAY_JUDGE_PIPELINE_VERSION,
		},
		models,
	};
}

/** What the operator sees before confirming: calls and dollars, with nothing written. */
export const estimateApsRunFn = createServerFn({ method: "POST" })
	.validator(runInput)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const context = await loadRunContext(data);
		const prepared = prepareApsRun({
			entity: context.entity,
			library: context.library,
			prompts: context.prompts,
			models: context.models,
			repetitions: data.repetitions ?? 3,
			capacidadAccion: context.capacidadAccion,
			judge: context.judge,
			prices: apsPricesFromEnv(),
			budgetConfig: apsBudgetConfigFromEnv(),
			spentThisMonthUsd: data.spentThisMonthUsd ?? null,
		});
		return {
			status: prepared.status,
			estimate: prepared.estimate,
			reasons: prepared.reasons,
			libraryVersion: context.library?.version ?? null,
			prompts: context.prompts.length,
			models: context.models,
			capacidadAccion: context.capacidadAccion,
		};
	});

export const startApsRunFn = createServerFn({ method: "POST" })
	.validator(runInput)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const context = await loadRunContext(data);
		const prepared = prepareApsRun({
			entity: context.entity,
			library: context.library,
			prompts: context.prompts,
			models: context.models,
			repetitions: data.repetitions ?? 3,
			capacidadAccion: context.capacidadAccion,
			judge: context.judge,
			prices: apsPricesFromEnv(),
			budgetConfig: apsBudgetConfigFromEnv(),
			spentThisMonthUsd: data.spentThisMonthUsd ?? null,
		});
		if (prepared.status === "blocked" || prepared.run === null) {
			return { ok: false as const, reasons: prepared.reasons };
		}

		const [run] = await db
			.insert(agentApsRuns)
			.values({ brandId: data.brandId, status: "planned", ...prepared.run })
			.returning({ id: agentApsRuns.id });

		const boss = await getBoss();
		await boss.send("aps-query", { runId: run.id });
		return { ok: true as const, runId: run.id, plannedCalls: prepared.run.plannedCalls, estimate: prepared.estimate };
	});

export const getApsRunsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const runs = await db
			.select()
			.from(agentApsRuns)
			.where(eq(agentApsRuns.brandId, data.brandId))
			.orderBy(desc(agentApsRuns.createdAt))
			.limit(10);
		const scores = await db
			.select()
			.from(agentApsScores)
			.where(eq(agentApsScores.entityId, runs[0]?.entityId ?? ""))
			.orderBy(desc(agentApsScores.createdAt))
			.limit(60);
		return runs.map((run) => ({
			id: run.id,
			entityId: run.entityId,
			status: run.status,
			models: run.models,
			plannedCalls: run.plannedCalls,
			completedCalls: run.completedCalls,
			repetitionsReduced: run.repetitionsReduced,
			capacidadAccion: run.capacidadAccion,
			judgeModelAlias: run.judgeModelAlias,
			judgeModelVersion: run.judgeModelVersion,
			scoringVersion: run.scoringVersion,
			measurementVersion: run.measurementVersion,
			promptLibraryVersion: run.promptLibraryVersion,
			error: run.error,
			createdAt: run.createdAt.toISOString(),
			scores: scores
				.filter((score) => score.runId === run.id)
				.map((score) => ({
					model: score.model,
					aps: score.aps,
					band: score.band,
					p10: score.p10,
					p50: score.p50,
					p90: score.p90,
					recommendationProbability: score.recommendationProbability,
					observations: score.observations,
					dimensions: score.dimensions as Record<string, number | null> | null,
				})),
		}));
	});
