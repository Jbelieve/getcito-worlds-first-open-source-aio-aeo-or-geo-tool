/**
 * APS Fase 2 + Fase 3 — the measurement score, computed from what the models actually answered.
 *
 * Ported from MAASY's `aps-score-compute` so BeAOS produces the same number for the same answers:
 * six sub-metrics, five weighted dimensions, a band, and a bootstrap distribution over the variance
 * of the repetitions.
 *
 * Two hard rules carried over verbatim:
 *   1. Never mix raw answers from different models in one denominator. Everything is normalized
 *      per model and persisted per model; `rollupAps` averages already-normalized scores.
 *   2. Never report a point number without its variance band, and never resample repetitions across
 *      different prompts — repetitions of the same prompt are the only exchangeable ones.
 *
 * This is not the spec APS of ./score.ts, which is computed from Claims & Proofs and costs nothing.
 * This one needs real model calls, so it only runs on a budgeted, on-demand run.
 */

export const MONTECARLO_ITERATIONS = 500;
/** Only fixes the shape: APS 50 -> P 50%, APS 70 -> P≈83%, APS 85 -> P≈94%. */
export const SIGMOID_K = 0.08;

/** Weights over 100, from the design mockup (D1..D5). */
export const DIMENSION_WEIGHTS = {
	discoverabilidad_agentica: 25,
	inteligencia_estructurada: 20,
	capacidad_accion: 20,
	autoridad_fuente: 20,
	reputacion_agentica: 15,
} as const;

export type DimensionKey = keyof typeof DIMENSION_WEIGHTS;
export type ApsBand = "agent_blind" | "agent_opaque" | "agent_visible" | "agent_ready" | "agent_native";

export interface ApsObservation {
	model: string;
	promptId: string;
	appeared: boolean | null;
	recommended: boolean | null;
	/** Rank in the answer. Null means the answer presented the brand without an explicit ranking. */
	position: number | null;
	sentiment0to100: number | null;
	grounded: boolean | null;
	competitorsMentioned: string[] | null;
}

export interface SubMetrics {
	coverage: number;
	recommendationRate: number;
	sovPosWeight: number;
	sentimentAvg: number;
	groundingRate: number;
	competitorBreadth: number;
}

export interface ApsModelScore {
	model: string;
	aps: number;
	band: ApsBand;
	sub: SubMetrics;
	dimensions: Record<DimensionKey, number | null>;
	/** Answers behind this score. */
	observations: number;
	/** Bootstrap distribution of the APS, sorted ascending. */
	samples: number[];
	p10: number;
	p50: number;
	p90: number;
	/** P(recommendation) in percent, from the sigmoid of APS. */
	recommendationProbability: number;
}

export interface ApsMeasurementOptions {
	/** AOS score of the same site, when an audit exists. Null redistributes its weight. */
	capacidadAccion?: number | null;
	iterations?: number;
	/** Injectable for deterministic tests; the bootstrap is the only randomness here. */
	random?: () => number;
}

function clamp0to100(value: number): number {
	return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * First place carries full weight and each place decays. Not appearing is zero; appearing without
 * an explicit position is full weight, because the brand was still the presented option.
 */
export function positionWeight(appeared: boolean, position: number | null): number {
	if (!appeared) return 0;
	if (position === null || position < 1) return 1;
	return 1 / position;
}

export function computeSubMetrics(rows: ApsObservation[]): SubMetrics {
	const n = rows.length;
	if (n === 0) {
		return {
			coverage: 0,
			recommendationRate: 0,
			sovPosWeight: 0,
			sentimentAvg: 0.5,
			groundingRate: 0,
			competitorBreadth: 0,
		};
	}

	let appearedCount = 0;
	let recommendedCount = 0;
	let posWeightSum = 0;
	let sentimentSum = 0;
	let groundedCount = 0;
	let competitorCountSum = 0;

	for (const row of rows) {
		const appeared = row.appeared === true;
		if (appeared) appearedCount += 1;
		if (row.recommended === true) recommendedCount += 1;
		posWeightSum += positionWeight(appeared, row.position);
		sentimentSum += row.sentiment0to100 ?? 50;
		if (row.grounded === true) groundedCount += 1;
		competitorCountSum += (row.competitorsMentioned ?? []).length;
	}

	// Open denominator: the more competitors named next to the brand, the lower its relative
	// authority. Normalized against an assumed ceiling of ten competitors per answer.
	const competitorBreadth = Math.max(0, 1 - competitorCountSum / n / 10);

	return {
		coverage: appearedCount / n,
		recommendationRate: recommendedCount / n,
		sovPosWeight: posWeightSum / n,
		sentimentAvg: sentimentSum / n / 100,
		groundingRate: groundedCount / n,
		competitorBreadth,
	};
}

export function dimensionsFromSubMetrics(
	sub: SubMetrics,
	capacidadAccion: number | null = null,
): Record<DimensionKey, number | null> {
	return {
		discoverabilidad_agentica: sub.coverage * 100,
		inteligencia_estructurada: sub.groundingRate * 100,
		capacidad_accion: capacidadAccion,
		autoridad_fuente: ((sub.sovPosWeight + sub.competitorBreadth) / 2) * 100,
		reputacion_agentica: ((sub.recommendationRate + sub.sentimentAvg) / 2) * 100,
	};
}

/**
 * Weighted mean over the dimensions that exist. When capacidad_accion is missing its weight is
 * redistributed proportionally instead of inventing a fifth number or averaging flat.
 */
export function apsFromDimensions(dimensions: Record<DimensionKey, number | null>): number {
	const present = (Object.entries(dimensions) as Array<[DimensionKey, number | null]>).filter(
		(entry): entry is [DimensionKey, number] => entry[1] !== null,
	);
	const totalWeight = present.reduce((sum, [key]) => sum + DIMENSION_WEIGHTS[key], 0);
	if (totalWeight === 0) return 0;
	const weighted = present.reduce((sum, [key, value]) => sum + value * (DIMENSION_WEIGHTS[key] / totalWeight), 0);
	return clamp0to100(weighted);
}

export function bandFor(aps: number): ApsBand {
	if (aps >= 85) return "agent_native";
	if (aps >= 70) return "agent_ready";
	if (aps >= 50) return "agent_visible";
	if (aps >= 25) return "agent_opaque";
	return "agent_blind";
}

export function recommendationProbability(aps: number): number {
	return Math.round((1 / (1 + Math.exp(-SIGMOID_K * (aps - 50)))) * 100);
}

export function percentile(sorted: number[], p: number): number {
	const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)));
	return sorted[idx] ?? 0;
}

function groupByPrompt(rows: ApsObservation[]): Map<string, ApsObservation[]> {
	const byPrompt = new Map<string, ApsObservation[]>();
	for (const row of rows) {
		const group = byPrompt.get(row.promptId);
		if (group === undefined) byPrompt.set(row.promptId, [row]);
		else group.push(row);
	}
	return byPrompt;
}

/**
 * Bootstrap: resample one repetition per prompt (with replacement, never across prompts) and
 * recompute the APS. Repeating that gives the variance band the score must always carry.
 */
export function bootstrapApsDistribution(
	rows: ApsObservation[],
	capacidadAccion: number | null,
	options: ApsMeasurementOptions = {},
): number[] {
	const iterations = options.iterations ?? MONTECARLO_ITERATIONS;
	const random = options.random ?? Math.random;
	const promptGroups = [...groupByPrompt(rows).values()].filter((group) => group.length > 0);
	if (promptGroups.length === 0) return [];

	const samples: number[] = [];
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const sampled = promptGroups.map((group) => group[Math.floor(random() * group.length)] as ApsObservation);
		samples.push(apsFromDimensions(dimensionsFromSubMetrics(computeSubMetrics(sampled), capacidadAccion)));
	}
	return samples.sort((a, b) => a - b);
}

/** Scores the answers of ONE model. Never call this with rows from more than one model. */
export function scoreModel(model: string, rows: ApsObservation[], options: ApsMeasurementOptions = {}): ApsModelScore {
	const capacidadAccion = options.capacidadAccion ?? null;
	const sub = computeSubMetrics(rows);
	const dimensions = dimensionsFromSubMetrics(sub, capacidadAccion);
	const aps = apsFromDimensions(dimensions);
	const samples = bootstrapApsDistribution(rows, capacidadAccion, options);

	return {
		model,
		aps,
		band: bandFor(aps),
		sub,
		dimensions,
		observations: rows.length,
		samples,
		p10: percentile(samples, 0.1),
		p50: percentile(samples, 0.5),
		p90: percentile(samples, 0.9),
		recommendationProbability: recommendationProbability(aps),
	};
}

/**
 * Groups by model first and scores each model on its own, so no denominator ever mixes models.
 * Returns one score per model, in first-seen order.
 */
export function scoreObservations(
	observations: ApsObservation[],
	options: ApsMeasurementOptions = {},
): ApsModelScore[] {
	const byModel = new Map<string, ApsObservation[]>();
	for (const observation of observations) {
		const group = byModel.get(observation.model);
		if (group === undefined) byModel.set(observation.model, [observation]);
		else group.push(observation);
	}
	return [...byModel.entries()].map(([model, rows]) => scoreModel(model, rows, options));
}

/**
 * Brand rollup: the mean of per-model scores that were each normalized on their own model's
 * answers. This is not a common denominator over mixed answers — that is the rule it respects.
 */
export function rollupAps(scores: ApsModelScore[]): { aps: number; band: ApsBand; min: number; max: number } | null {
	if (scores.length === 0) return null;
	const values = scores.map((score) => score.aps);
	const aps = clamp0to100(values.reduce((sum, value) => sum + value, 0) / values.length);
	return { aps, band: bandFor(aps), min: Math.min(...values), max: Math.max(...values) };
}
