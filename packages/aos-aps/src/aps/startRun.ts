/**
 * Preparing an on-demand APS run.
 *
 * The trigger is a button, so everything that decides whether the run may start — and how much it
 * will cost — happens here, in pure code, before a single row is written. The caller only persists
 * what this returns.
 */

import type { ApsBudgetConfig, ProviderPrice } from "../worker/budget";
import { type ApsRunPlan, type ApsQueryJob, planApsRun } from "./runPlan";

export interface ApsLibraryPrompt {
	id: string;
	text: string;
}

export interface ApsEntityRef {
	id: string;
	name: string;
	websiteUrl: string | null;
}

export interface PrepareApsRunInput {
	entity: ApsEntityRef;
	/** Active, locked library of the entity. Null means it has to be created first. */
	library: { id: string; version: number } | null;
	prompts: ApsLibraryPrompt[];
	models: string[];
	repetitions: number;
	/** AOS score of the same site, feeding the capacidad_accion dimension. Null when never audited. */
	capacidadAccion: number | null;
	judge: { alias: string; version: string; pipelineVersion: string };
	prices: ProviderPrice[];
	budgetConfig: ApsBudgetConfig;
	spentThisMonthUsd?: number | null;
}

export interface PreparedApsRun {
	status: "ready" | "blocked";
	plan: ApsRunPlan | null;
	/** The row the caller inserts, already carrying its series identity. */
	run: {
		entityId: string;
		libraryId: string;
		models: string[];
		requestedRepetitions: number;
		effectiveRepetitions: number;
		repetitionsReduced: boolean;
		plannedCalls: number;
		capacidadAccion: number | null;
		scoringVersion: string;
		measurementVersion: string;
		judgeModelAlias: string;
		judgeModelVersion: string;
		judgePipelineVersion: string;
		promptLibraryVersion: number;
	} | null;
	jobs: ApsQueryJob[];
	/** What the operator sees before confirming: calls, models and the dollar estimate. */
	estimate: {
		calls: number;
		measurementUsd: number | null;
		judgeUsd: number | null;
		totalUsd: number | null;
		missingPrices: string[];
	} | null;
	reasons: string[];
}

/**
 * Fails closed for the same reasons the whole pipeline does: no library, no prompts, no price, or a
 * breached budget all come back as `blocked` with every reason, never as a run that starts anyway.
 */
export function prepareApsRun(input: PrepareApsRunInput): PreparedApsRun {
	const blocked = (reasons: string[]): PreparedApsRun => ({
		status: "blocked",
		plan: null,
		run: null,
		jobs: [],
		estimate: null,
		reasons,
	});

	if (input.library === null) {
		return blocked(["La entidad no tiene una biblioteca de prompts activa: hay que crearla primero."]);
	}
	if (input.prompts.length === 0) {
		return blocked(["La biblioteca activa no tiene prompts habilitados."]);
	}
	if (input.models.length === 0) {
		return blocked(["No hay modelos de medicion seleccionados."]);
	}

	const plan = planApsRun({
		prompts: input.prompts.map((prompt) => prompt.text),
		models: input.models,
		repetitions: input.repetitions,
		judge: input.judge,
		promptLibraryVersion: input.library.version,
		budgetConfig: input.budgetConfig,
		prices: input.prices,
		spentThisMonthUsd: input.spentThisMonthUsd ?? null,
	});

	if (plan.status === "blocked") return blocked(plan.reasons);

	return {
		status: "ready",
		plan,
		run: {
			entityId: input.entity.id,
			libraryId: input.library.id,
			models: input.models,
			requestedRepetitions: input.repetitions,
			effectiveRepetitions: plan.effectiveRepetitions,
			repetitionsReduced: plan.repetitionsReduced,
			plannedCalls: plan.plannedCalls,
			capacidadAccion: input.capacidadAccion,
			scoringVersion: plan.versions.scoringVersion,
			measurementVersion: plan.versions.measurementVersion,
			judgeModelAlias: plan.versions.judgeModelAlias,
			judgeModelVersion: plan.versions.judgeModelVersion,
			judgePipelineVersion: plan.versions.judgePipelineVersion,
			promptLibraryVersion: plan.versions.promptLibraryVersion,
		},
		jobs: plan.jobs,
		estimate: {
			calls: plan.decision.estimate.calls,
			measurementUsd: plan.decision.estimate.measurementUsd,
			judgeUsd: plan.decision.estimate.judgeUsd,
			totalUsd: plan.decision.estimate.totalUsd,
			missingPrices: plan.decision.estimate.missingPrices,
		},
		reasons: plan.reasons,
	};
}
