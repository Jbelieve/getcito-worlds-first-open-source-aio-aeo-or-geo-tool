/**
 * Compact AOS + APS summary for the overview dashboard.
 *
 * One read for both scores, shaped for a person: the number, the band, what is failing and how many
 * answers hold each model's score. The full detail stays in the AOS and APS sections.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentAosAudits, agentApsRuns, agentApsScores } from "@workspace/aos-aps/db/schema";
import { bandFor } from "@workspace/aos-aps/aps";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

interface StoredRequirement {
	id: string;
	title: string;
	status: "pass" | "fail" | "n_a";
	axis?: "AOS" | "APS";
	diagnostic?: boolean;
	/** Puntos que devolvería si pasa. Presentación: lo calcula la auditoría, no el puntaje. */
	gain?: number;
}

export interface AgentOverview {
	aos: {
		score: number;
		band: string;
		businessType: string;
		auditedAt: string;
		passed: number;
		applicable: number;
		/** What is failing in the scored rubric: the actionable list. */
		failing: Array<{ id: string; title: string; axis: "AOS" | "APS"; gain: number | null }>;
		/** Failing checks that are reported but do not move the score. */
		diagnosticsFailing: number;
	} | null;
	aps: {
		aps: number;
		band: string;
		createdAt: string;
		models: Array<{
			model: string;
			aps: number;
			band: string;
			observations: number;
			recommendationProbability: number | null;
			p10: number | null;
			p90: number | null;
		}>;
		partial: boolean;
		partialReason: string | null;
		planned: number;
		answered: number;
	} | null;
}

export const getAgentOverviewFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1) }))
	.handler(async ({ data }): Promise<AgentOverview> => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const [audit] = await db
			.select()
			.from(agentAosAudits)
			.where(eq(agentAosAudits.brandId, data.brandId))
			.orderBy(desc(agentAosAudits.createdAt))
			.limit(1);

		const [run] = await db
			.select()
			.from(agentApsRuns)
			.where(eq(agentApsRuns.brandId, data.brandId))
			.orderBy(desc(agentApsRuns.createdAt))
			.limit(1);

		const scores =
			run === undefined
				? []
				: await db.select().from(agentApsScores).where(eq(agentApsScores.runId, run.id)).orderBy(agentApsScores.model);

		const requirements = (audit?.requirements ?? []) as StoredRequirement[] | null;
		const scored = (requirements ?? []).filter((requirement) => requirement.diagnostic !== true);
		const applicable = scored.filter((requirement) => requirement.status !== "n_a");

		const modelScores = scores.map((score) => ({
			model: score.model,
			aps: score.aps,
			band: score.band,
			observations: score.observations,
			recommendationProbability: score.recommendationProbability,
			p10: score.p10,
			p90: score.p90,
		}));
		// Same rollup rule as the pipeline: the mean of already-normalized per-model scores.
		const aps =
			modelScores.length === 0
				? null
				: Math.round(modelScores.reduce((sum, model) => sum + model.aps, 0) / modelScores.length);

		return {
			aos:
				audit === undefined || audit.score === null
					? null
					: {
							score: audit.score,
							band: audit.band ?? "",
							businessType: audit.businessType ?? "",
							auditedAt: audit.createdAt.toISOString(),
							passed: applicable.filter((requirement) => requirement.status === "pass").length,
							applicable: applicable.length,
							// Ordenados por lo que devolvería arreglarlos, no por el orden del rubric: la
							// tarjeta es un resumen, y en un resumen manda el impacto.
							failing: applicable
								.filter((requirement) => requirement.status === "fail")
								.sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))
								.map((requirement) => ({
									id: requirement.id,
									title: requirement.title,
									axis: requirement.axis ?? "AOS",
									gain: requirement.gain ?? null,
								})),
							diagnosticsFailing: (requirements ?? []).filter(
								(requirement) => requirement.diagnostic === true && requirement.status === "fail",
							).length,
						},
			aps:
				run === undefined || aps === null
					? null
					: {
							aps,
							band: bandFor(aps),
							createdAt: run.createdAt.toISOString(),
							models: modelScores,
							partial: run.partial,
							partialReason: run.partialReason,
							planned: run.plannedCalls,
							answered: run.completedCalls,
						},
		};
	});
