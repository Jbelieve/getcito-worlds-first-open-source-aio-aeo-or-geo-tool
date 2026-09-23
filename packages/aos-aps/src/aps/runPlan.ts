/**
 * APS run planning: turn a library plus a request into the exact fan-out that will be executed,
 * stamped with the series identity it belongs to, and only when the budget allows it.
 *
 * Fase 0 keeps capture and analysis separate — the run only stores raw answers, and the judge runs
 * later over that stored text — so a formula change never forces paying for the queries again.
 */

import { MEASUREMENT_VERSION } from "../preference/measurement";
import { SCORING_VERSION } from "../preference/score";
import { type ApsBudgetConfig, type ApsBudgetDecision, decideApsBudget, type ProviderPrice } from "../worker/budget";

export interface ApsJudgeIdentity {
	alias: string;
	version: string;
	pipelineVersion: string;
}

/** Fixed per run, never per observation: a judge change must create a new comparable series. */
export interface ApsRunVersions {
	scoringVersion: string;
	measurementVersion: string;
	judgeModelAlias: string;
	judgeModelVersion: string;
	judgePipelineVersion: string;
	promptLibraryVersion: number;
}

export interface ApsQueryJob {
	promptIndex: number;
	promptText: string;
	model: string;
	runIndex: number;
}

export interface ApsRunPlanInput {
	prompts: string[];
	models: string[];
	repetitions: number;
	judge: ApsJudgeIdentity;
	promptLibraryVersion: number;
	budgetConfig: ApsBudgetConfig;
	prices: ProviderPrice[];
	spentThisMonthUsd?: number | null;
}

export interface ApsRunPlan {
	status: "ready" | "blocked";
	versions: ApsRunVersions;
	/** Repetitions the run will actually use; 0 when blocked. */
	effectiveRepetitions: number;
	plannedCalls: number;
	/**
	 * True when repetitions had to drop below the request. A partial measurement is never presented
	 * as a complete one, so this travels with the run and must be shown to the operator.
	 */
	repetitionsReduced: boolean;
	jobs: ApsQueryJob[];
	decision: ApsBudgetDecision;
	reasons: string[];
}

export function runVersions(judge: ApsJudgeIdentity, promptLibraryVersion: number): ApsRunVersions {
	return {
		scoringVersion: SCORING_VERSION,
		measurementVersion: MEASUREMENT_VERSION,
		judgeModelAlias: judge.alias,
		judgeModelVersion: judge.version,
		judgePipelineVersion: judge.pipelineVersion,
		promptLibraryVersion,
	};
}

/** Prompt x model x repetition: every combination is one independent raw observation. */
export function fanOut(prompts: string[], models: string[], repetitions: number): ApsQueryJob[] {
	const jobs: ApsQueryJob[] = [];
	for (const [promptIndex, promptText] of prompts.entries()) {
		for (const model of models) {
			for (let runIndex = 0; runIndex < repetitions; runIndex += 1) {
				jobs.push({ promptIndex, promptText, model, runIndex });
			}
		}
	}
	return jobs;
}

export function planApsRun(input: ApsRunPlanInput): ApsRunPlan {
	const versions = runVersions(input.judge, input.promptLibraryVersion);
	const decision = decideApsBudget(
		{
			prompts: input.prompts.length,
			models: input.models,
			repetitions: input.repetitions,
			judgeModel: input.judge.alias,
		},
		input.prices,
		input.budgetConfig,
		input.spentThisMonthUsd ?? null,
	);

	if (decision.decision === "stop") {
		return {
			status: "blocked",
			versions,
			effectiveRepetitions: 0,
			plannedCalls: 0,
			repetitionsReduced: false,
			jobs: [],
			decision,
			reasons: decision.reasons,
		};
	}

	const effectiveRepetitions =
		decision.decision === "reduce_repetitions" ? decision.effectiveRepetitions : input.repetitions;
	const jobs = fanOut(input.prompts, input.models, effectiveRepetitions);

	return {
		status: "ready",
		versions,
		effectiveRepetitions,
		plannedCalls: jobs.length,
		repetitionsReduced: effectiveRepetitions < input.repetitions,
		jobs,
		decision,
		reasons: decision.reasons,
	};
}

export interface CaptureOutcome {
	/** Prompt/model/repetition combinations that were attempted. */
	attempted: number;
	/** Answers actually stored. Only non-empty answers become observations. */
	observations: number;
	empty: number;
}

/** Ported from Fase 0: an empty answer is dropped, never stored as an observation. */
export function captureSummary(answers: Array<string | null | undefined>): CaptureOutcome {
	const observations = answers.filter((answer) => typeof answer === "string" && answer.length > 0).length;
	return { attempted: answers.length, observations, empty: answers.length - observations };
}

/**
 * A run is only scoreable when every planned combination produced an answer. Otherwise the score
 * would be computed on a subset and presented as the whole run.
 */
export function isRunComplete(planned: number, capture: CaptureOutcome): boolean {
	return planned > 0 && capture.observations === planned;
}
