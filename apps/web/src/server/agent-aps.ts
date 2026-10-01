/**
 * APS run controls for the UI.
 *
 * On demand by design: `estimate` shows what a run would cost without writing anything, `start`
 * creates the run only after the operator confirmed, and the worker chain takes it from there.
 * Nothing here spends money by itself.
 */
import { createServerFn } from "@tanstack/react-start";
import {
	canRegenerateLibrary,
	generateLibraryWithGateway,
	isLibraryUsable,
	judgeConfigFromEnv,
	libraryConfigFromEnv,
	readGatewayBudget,
} from "@workspace/aos-aps/aps";
import { agentApsPromptLibraries, agentApsPrompts, agentApsRuns, agentApsScores } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
	generationFailureMessage,
	generatorInputsFromBrand,
	LIBRARY_ASKED_FOR,
	type LibraryGenerationReport,
} from "@/lib/aps/library-message";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getBoss } from "@/lib/boss-client";
import { estimateApsRunForBrand, startApsRunForBrand } from "@/server/agent-aps-core";

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

/**
 * The gateway already knows the real spend and the ceiling of the key BeAOS uses, so the month guard
 * reads them instead of asking the operator for a number. The ceiling is shared with whatever else
 * uses that key today, which is exactly why the remaining headroom is the right thing to compare.
 */
export const getGatewayBudgetFn = createServerFn({ method: "POST" }).handler(async () => {
	const session = await requireAuthSession();
	if (session.user.id.length === 0) throw new Error("Sesion invalida");
	const config = judgeConfigFromEnv();
	if (config === null) return { configured: false as const, budget: null, remainingUsd: null };
	const budget = await readGatewayBudget(config);
	if (budget === null) return { configured: true as const, budget: null, remainingUsd: null };
	return {
		configured: true as const,
		budget,
		remainingUsd: budget.maxBudget === null ? null : Math.max(0, budget.maxBudget - budget.spend),
	};
});

/** Everything a run needs lives in `agent-aps-core`, shared with el MCP. */

/** What the operator sees before confirming: calls and dollars, with nothing written. */
export const estimateApsRunFn = createServerFn({ method: "POST" })
	.validator(runInput)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return estimateApsRunForBrand(data);
	});

export const startApsRunFn = createServerFn({ method: "POST" })
	.validator(runInput)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const result = await startApsRunForBrand(data);
		if (result.ok === false) return { ok: false as const, reasons: result.reasons };
		return {
			ok: true as const,
			runId: result.runId,
			plannedCalls: result.plannedCalls,
			estimate: result.estimate,
		};
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
			partial: run.partial,
			partialReason: run.partialReason,
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
					subMetrics: score.subMetrics as Record<string, number> | null,
					distribution: (score.distribution as number[] | null) ?? null,
					partial: score.partial,
				})),
		}));
	});

/** Active library of an entity, with its lock window: the UI needs to show why it cannot change. */
export const getApsLibraryFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const [library] = await db
			.select()
			.from(agentApsPromptLibraries)
			.where(and(eq(agentApsPromptLibraries.entityId, data.entityId), eq(agentApsPromptLibraries.status, "active")))
			.orderBy(desc(agentApsPromptLibraries.version))
			.limit(1);
		if (library === undefined) return { library: null, counts: {}, canRegenerate: null };

		const prompts = await db
			.select({ kind: agentApsPrompts.kind, enabled: agentApsPrompts.enabled })
			.from(agentApsPrompts)
			.where(eq(agentApsPrompts.libraryId, library.id));
		const counts: Record<string, number> = {};
		for (const prompt of prompts) {
			if (prompt.enabled === false) continue;
			counts[prompt.kind] = (counts[prompt.kind] ?? 0) + 1;
		}
		const verdict = canRegenerateLibrary({ unlocksAt: library.unlocksAt.toISOString() });
		return {
			library: {
				id: library.id,
				version: library.version,
				lockedAt: library.lockedAt.toISOString(),
				unlocksAt: library.unlocksAt.toISOString(),
				promptCount: prompts.filter((prompt) => prompt.enabled).length,
			},
			counts,
			canRegenerate: verdict,
		};
	});

/**
 * Generates a candidate library on demand. It writes nothing: the operator reviews the candidates
 * and then calls saveApsLibraryFn, which is what validates and locks them.
 *
 * Devuelve la cuenta completa —cuántos vinieron, cuántos quedaron usables, por qué se descartó el
 * resto y por qué falló cuando falló— porque el panel no puede explicar lo que no recibe. Antes acá
 * se devolvían los candidatos y un motivo de descarte que la pantalla tiraba a la basura.
 */
export const generateApsLibraryFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			total: z.number().int().min(10).max(60).optional(),
			industry: z.string().min(1).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const askedFor = data.total ?? LIBRARY_ASKED_FOR;
		const config = libraryConfigFromEnv();
		if (config === null) {
			return {
				ok: false as const,
				reason: "Falta LLM_GATEWAY_URL o la key del gateway para generar la biblioteca.",
				prompts: [] as Array<{ text: string; kind: string; funnelStage: string }>,
				rejected: [] as Array<{ text: string; reason: string }>,
				returned: 0,
				usable: 0,
				askedFor,
				failure: null,
				inputs: null,
				model: null,
			};
		}
		const [brand] = await db.select().from(brands).where(eq(brands.id, data.brandId)).limit(1);
		if (brand === undefined) throw new Error("Brand not found");

		const inputs = generatorInputsFromBrand(brand);
		const brief = [
			brand.shortDescription,
			(brand.productsAndServices ?? []).join(", "),
			(brand.keywords ?? []).join(", "),
		]
			.filter((part) => typeof part === "string" && part.length > 0)
			.join(" | ");

		const generated = await generateLibraryWithGateway(
			{
				brandName: brand.name,
				industry: data.industry ?? null,
				brief: brief.length > 0 ? brief : null,
				total: data.total,
			},
			config,
		);
		const report: LibraryGenerationReport = {
			returned: generated.prompts.length + generated.rejected.length,
			usable: generated.prompts.length,
			rejected: generated.rejected,
			askedFor,
			failure: generated.failure,
		};
		if (isLibraryUsable(generated) === false) {
			return {
				ok: false as const,
				reason: generationFailureMessage(report, inputs),
				prompts: [] as Array<{ text: string; kind: string; funnelStage: string }>,
				...report,
				inputs,
				model: config.model,
			};
		}
		return { ok: true as const, reason: null, prompts: generated.prompts, ...report, inputs, model: config.model };
	});
