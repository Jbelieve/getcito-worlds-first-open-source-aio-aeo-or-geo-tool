/**
 * aps-parse — APS Fase 1 plus the Fase 6 robustness audit, wired to the database.
 *
 * Judges text that was already captured (never re-queries a model) and stores the verdict next to the
 * raw answer. The grounding the judge claims is verified against the raw text here, so the score
 * never rests on a model's word about itself.
 */
import type { Job, PgBoss } from "pg-boss";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { agentApsObservations, agentApsRuns } from "@workspace/aos-aps/db/schema";
import {
	type ApsJudge,
	auditRobustness,
	correctedGrounded,
	gatewayJudge,
	judgeObservations,
} from "@workspace/aos-aps/aps";

export interface ApsParseData {
	runId: string;
}

export interface ApsParseResult {
	ok: boolean;
	judged?: number;
	unjudged?: number;
	reason?: string;
}

/** The judge runs inside the gateway, so its identity comes from the environment. */
export function judgeConfigFromEnv(env: Record<string, string | undefined> = process.env) {
	const url = env.LLM_GATEWAY_URL?.trim();
	const key = (env.LLM_GATEWAY_KEY_BEAOS ?? env.LLM_GATEWAY_KEY_BEADS)?.trim();
	if (url === undefined || url.length === 0 || key === undefined || key.length === 0) return null;
	const model = env.APS_JUDGE_MODEL?.trim() ?? "believe-deep";
	return {
		url,
		key,
		model: model.length > 0 ? model : "believe-deep",
		// Recorded per run: without a pinned version the series cannot tell a model update apart.
		version: env.APS_JUDGE_VERSION?.trim() ?? "unpinned",
	};
}

/** Injection seam: a verification run passes a fake judge instead of calling the gateway. */
export interface ApsParseDeps {
	judge?: ApsJudge;
}

export async function apsParseJob(
	jobs: Job<ApsParseData>[],
	boss: PgBoss,
	deps: ApsParseDeps = {},
): Promise<ApsParseResult> {
	const [job] = jobs;
	if (job === undefined) throw new Error("aps-parse handler received an empty batch");
	const { runId } = job.data;

	const [run] = await db.select().from(agentApsRuns).where(eq(agentApsRuns.id, runId)).limit(1);
	if (run === undefined) throw new Error(`APS run "${runId}" not found`);
	if (run.status !== "parsing") {
		console.log(`[aps-parse] run ${runId} is ${run.status}, skipping`);
		return { ok: false, reason: `Estado inesperado: ${run.status}` };
	}

	const config = deps.judge === undefined ? judgeConfigFromEnv() : null;
	if (config === null && deps.judge === undefined) {
		const reason = "Falta LLM_GATEWAY_URL o la key del gateway para juzgar.";
		await db.update(agentApsRuns).set({ status: "failed", error: reason }).where(eq(agentApsRuns.id, runId));
		console.error(`[aps-parse] ${reason}`);
		return { ok: false, reason };
	}

	const [brand] = await db.select().from(brands).where(eq(brands.id, run.brandId)).limit(1);
	if (brand === undefined) throw new Error(`Brand "${run.brandId}" not found`);

	const pending = await db
		.select({
			id: agentApsObservations.id,
			promptText: agentApsObservations.promptText,
			fullResponse: agentApsObservations.fullResponse,
		})
		.from(agentApsObservations)
		.where(and(eq(agentApsObservations.runId, runId), isNull(agentApsObservations.analyzedAt)));

	const judge = deps.judge ?? gatewayJudge(config as NonNullable<ReturnType<typeof judgeConfigFromEnv>>);
	const report = await judgeObservations(
		pending.map((row) => ({
			observationId: row.id,
			promptText: row.promptText,
			response: row.fullResponse ?? "",
		})),
		brand.name,
		judge,
	);

	const byId = new Map(pending.map((row) => [row.id, row]));
	const analyzedAt = new Date();
	for (const entry of report.judged) {
		const row = byId.get(entry.observationId);
		if (row === undefined) continue;
		const injectionFlags = auditRobustness([
			{ id: entry.observationId, fullResponse: row.fullResponse, judgeSaidGrounded: entry.verdict.grounded },
		]);
		await db
			.update(agentApsObservations)
			.set({
				appeared: entry.verdict.appeared,
				recommended: entry.verdict.recommended,
				position: entry.verdict.position,
				sentiment0to100: entry.verdict.sentiment0to100,
				grounded: entry.verdict.grounded,
				// Independent check: the judge's claim only survives if the text backs it.
				sourceVerified: correctedGrounded({
					id: entry.observationId,
					fullResponse: row.fullResponse,
					judgeSaidGrounded: entry.verdict.grounded,
				}),
				injectionFlags: injectionFlags.findings
					.filter((finding) => finding.kind === "injection")
					.map((finding) => finding.detail),
				competitorsMentioned: entry.verdict.competitorsMentioned,
				judgeModelAlias: judge.alias,
				judgeModelVersion: judge.version,
				analyzedAt,
			})
			.where(eq(agentApsObservations.id, entry.observationId));
	}

	await db
		.update(agentApsRuns)
		.set({
			status: "scoring",
			judgeModelAlias: judge.alias,
			judgeModelVersion: judge.version,
			judgePipelineVersion: judge.pipelineVersion,
		})
		.where(eq(agentApsRuns.id, runId));

	console.log(`[aps-parse] run ${runId}: ${report.judged.length} juzgadas, ${report.unjudged.length} sin veredicto`);
	await boss.send("aps-score", { runId });
	return { ok: true, judged: report.judged.length, unjudged: report.unjudged.length };
}
