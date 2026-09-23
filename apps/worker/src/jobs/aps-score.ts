/**
 * aps-score — APS Fase 2/3 wired to the database.
 *
 * Scores the analysed observations per model and persists the result with the series identity it
 * belongs to. It refuses to score an incomplete run: a number computed on a subset must never be
 * shown as if it were the whole measurement. Injected answers stay quarantined, so a manipulated
 * answer cannot move the score.
 */
import type { Job } from "pg-boss";
import { eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentApsObservations, agentApsRuns, agentApsScores } from "@workspace/aos-aps/db/schema";
import {
	type ApsObservation,
	MEASUREMENT_VERSION,
	SCORING_VERSION,
	rollupAps,
	scoreObservations,
} from "@workspace/aos-aps/aps";

export interface ApsScoreData {
	runId: string;
}

export interface ApsScoreResult {
	ok: boolean;
	models?: number;
	aps?: number | null;
	reason?: string;
}

export async function apsScoreJob(jobs: Job<ApsScoreData>[]): Promise<ApsScoreResult> {
	const [job] = jobs;
	if (job === undefined) throw new Error("aps-score handler received an empty batch");
	const { runId } = job.data;

	const [run] = await db.select().from(agentApsRuns).where(eq(agentApsRuns.id, runId)).limit(1);
	if (run === undefined) throw new Error(`APS run "${runId}" not found`);
	if (run.status !== "scoring") {
		console.log(`[aps-score] run ${runId} is ${run.status}, skipping`);
		return { ok: false, reason: `Estado inesperado: ${run.status}` };
	}

	const rows = await db
		.select()
		.from(agentApsObservations)
		.where(eq(agentApsObservations.runId, runId));
	const analyzed = rows.filter((row) => row.analyzedAt !== null);
	const isQuarantined = (flags: unknown) => Array.isArray(flags) && flags.length > 0;
	const quarantined = analyzed.filter((row) => isQuarantined(row.injectionFlags));
	const scoreable = analyzed.filter((row) => isQuarantined(row.injectionFlags) === false);

	if (scoreable.length === 0) {
		const reason = `Corrida sin respuestas puntuables: 0 de ${run.plannedCalls}.`;
		await db.update(agentApsRuns).set({ status: "failed", error: reason, finishedAt: new Date() }).where(eq(agentApsRuns.id, runId));
		console.error(`[aps-score] run ${runId}: ${reason}`);
		return { ok: false, reason };
	}

	// Fewer answers than planned still scores: the calls were paid for, and refusing would throw
	// them away. What it never does is pass for a complete measurement — the gap travels with it.
	const partial = scoreable.length < run.plannedCalls;
	const partialReason = partial
		? `${scoreable.length} de ${run.plannedCalls} respuestas puntuables${quarantined.length > 0 ? ` (${quarantined.length} en cuarentena por inyección)` : ""}.`
		: null;

	const observations: ApsObservation[] = scoreable.map((row) => ({
		model: row.model,
		promptId: row.promptId,
		appeared: row.appeared,
		recommended: row.recommended,
		position: row.position,
		sentiment0to100: row.sentiment0to100,
		// The corrected value: the judge's claim only counts when the text carries a source.
		grounded: row.sourceVerified === true && row.grounded === true,
		competitorsMentioned: Array.isArray(row.competitorsMentioned) ? (row.competitorsMentioned as string[]) : [],
	}));

	const scores = scoreObservations(observations, { capacidadAccion: run.capacidadAccion });

	await db.insert(agentApsScores).values(
		scores.map((score) => ({
			runId,
			entityId: run.entityId,
			model: score.model,
			aps: score.aps,
			band: score.band,
			subMetrics: score.sub,
			dimensions: score.dimensions,
			p10: score.p10,
			p50: score.p50,
			p90: score.p90,
			distribution: score.samples,
			recommendationProbability: score.recommendationProbability,
			observations: score.observations,
			partial,
			scoringVersion: SCORING_VERSION,
			measurementVersion: MEASUREMENT_VERSION,
			judgeModelAlias: run.judgeModelAlias,
			judgeModelVersion: run.judgeModelVersion,
			promptLibraryVersion: run.promptLibraryVersion,
		})),
	);

	await db
		.update(agentApsRuns)
		.set({ status: "done", completedCalls: scoreable.length, finishedAt: new Date(), error: null, partial, partialReason })
		.where(eq(agentApsRuns.id, runId));

	const rollup = rollupAps(scores);
	console.log(
		`[aps-score] run ${runId}: ${scores.length} modelos, APS ${rollup?.aps ?? "n/a"} (${rollup?.band ?? "sin banda"})${partial ? ` — PARCIAL: ${partialReason}` : ""}`,
	);

	return { ok: true, models: scores.length, aps: rollup?.aps ?? null };
}

/** Scores already persisted for a run, for the UI and for verification. */
export async function scoresForRun(runId: string) {
	return db.select().from(agentApsScores).where(eq(agentApsScores.runId, runId));
}
