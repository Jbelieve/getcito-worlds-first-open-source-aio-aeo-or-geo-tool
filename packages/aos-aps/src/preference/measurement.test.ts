import { describe, expect, it } from "vitest";
import {
	type ApsObservation,
	DIMENSION_WEIGHTS,
	MONTECARLO_ITERATIONS,
	apsFromDimensions,
	bandFor,
	bootstrapApsDistribution,
	computeSubMetrics,
	dimensionsFromSubMetrics,
	percentile,
	positionWeight,
	recommendationProbability,
	rollupAps,
	scoreModel,
	scoreObservations,
} from "./measurement";

function observation(overrides: Partial<ApsObservation> = {}): ApsObservation {
	return {
		model: "chatgpt",
		promptId: "p1",
		appeared: true,
		recommended: true,
		position: 1,
		sentiment0to100: 80,
		grounded: true,
		competitorsMentioned: [],
		...overrides,
	};
}

/** Deterministic pseudo-random so the bootstrap is reproducible in tests. */
function seededRandom(seed = 1): () => number {
	let state = seed;
	return () => {
		state = (state * 1103515245 + 12345) % 2147483648;
		return state / 2147483648;
	};
}

describe("positionWeight", () => {
	it("gives full weight to first place and decays by rank", () => {
		expect(positionWeight(true, 1)).toBe(1);
		expect(positionWeight(true, 2)).toBe(0.5);
		expect(positionWeight(true, 4)).toBe(0.25);
	});

	it("gives zero when absent and full weight when the answer has no ranking", () => {
		expect(positionWeight(false, 1)).toBe(0);
		expect(positionWeight(false, null)).toBe(0);
		expect(positionWeight(true, null)).toBe(1);
		expect(positionWeight(true, 0)).toBe(1);
	});
});

describe("computeSubMetrics", () => {
	it("falls back to the documented defaults on no rows", () => {
		const sub = computeSubMetrics([]);
		expect(sub).toEqual({
			coverage: 0,
			recommendationRate: 0,
			sovPosWeight: 0,
			sentimentAvg: 0.5,
			groundingRate: 0,
			competitorBreadth: 0,
		});
	});

	it("computes the six sub-metrics over the rows", () => {
		const rows: ApsObservation[] = [
			observation({ position: 1, sentiment0to100: 100, competitorsMentioned: ["a"] }),
			observation({ position: 2, sentiment0to100: 0, appeared: false, recommended: false, grounded: false }),
		];
		const sub = computeSubMetrics(rows);
		expect(sub.coverage).toBe(0.5);
		expect(sub.recommendationRate).toBe(0.5);
		expect(sub.sovPosWeight).toBe(0.5); // (1 + 0) / 2
		expect(sub.sentimentAvg).toBe(0.5); // (100 + 0) / 2 / 100
		expect(sub.groundingRate).toBe(0.5);
		expect(sub.competitorBreadth).toBeCloseTo(0.95, 6); // 1 - (1/2)/10
	});

	it("treats a missing sentiment as the neutral default of 50", () => {
		expect(computeSubMetrics([observation({ sentiment0to100: null })]).sentimentAvg).toBe(0.5);
	});

	it("floors competitor breadth at zero instead of going negative", () => {
		const many = Array.from({ length: 12 }, (_, index) => `c${index}`);
		expect(computeSubMetrics([observation({ competitorsMentioned: many })]).competitorBreadth).toBe(0);
	});
});

describe("dimensions and APS", () => {
	it("maps sub-metrics to the five weighted dimensions", () => {
		const sub = computeSubMetrics([observation({ position: 1, sentiment0to100: 100 })]);
		const dims = dimensionsFromSubMetrics(sub, 40);
		expect(dims.discoverabilidad_agentica).toBe(100);
		expect(dims.inteligencia_estructurada).toBe(100);
		expect(dims.capacidad_accion).toBe(40);
		expect(dims.autoridad_fuente).toBeCloseTo(((1 + 1) / 2) * 100, 6);
		expect(dims.reputacion_agentica).toBeCloseTo(((1 + 1) / 2) * 100, 6);
	});

	it("scores a perfect answer set at 100", () => {
		const dims = dimensionsFromSubMetrics(computeSubMetrics([observation({ sentiment0to100: 100 })]), 100);
		expect(apsFromDimensions(dims)).toBe(100);
	});

	it("redistributes the capacidad_accion weight instead of inventing the dimension", () => {
		const dims = dimensionsFromSubMetrics(computeSubMetrics([observation({ sentiment0to100: 100 })]), null);
		expect(dims.capacidad_accion).toBeNull();
		expect(apsFromDimensions(dims)).toBe(100);

		// The same answers with a zero AOS: capacidad_accion now weighs its full 20 points.
		const withZero = dimensionsFromSubMetrics(computeSubMetrics([observation({ sentiment0to100: 100 })]), 0);
		expect(apsFromDimensions(withZero)).toBe(80);
	});

	it("keeps the published dimension weights", () => {
		expect(DIMENSION_WEIGHTS).toEqual({
			discoverabilidad_agentica: 25,
			inteligencia_estructurada: 20,
			capacidad_accion: 20,
			autoridad_fuente: 20,
			reputacion_agentica: 15,
		});
		expect(Object.values(DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
	});

	it("returns zero when no dimension is present", () => {
		expect(
			apsFromDimensions({
				discoverabilidad_agentica: null,
				inteligencia_estructurada: null,
				capacidad_accion: null,
				autoridad_fuente: null,
				reputacion_agentica: null,
			}),
		).toBe(0);
	});
});

describe("bandFor and recommendationProbability", () => {
	it("maps the published band boundaries", () => {
		expect(bandFor(85)).toBe("agent_native");
		expect(bandFor(84)).toBe("agent_ready");
		expect(bandFor(70)).toBe("agent_ready");
		expect(bandFor(69)).toBe("agent_visible");
		expect(bandFor(50)).toBe("agent_visible");
		expect(bandFor(49)).toBe("agent_opaque");
		expect(bandFor(25)).toBe("agent_opaque");
		expect(bandFor(24)).toBe("agent_blind");
	});

	it("matches the calibration documented with the ported constant", () => {
		expect(recommendationProbability(50)).toBe(50);
		expect(recommendationProbability(70)).toBe(83);
		expect(recommendationProbability(85)).toBe(94);
	});
});

describe("bootstrap", () => {
	it("is reproducible with an injected random source", () => {
		const rows = [observation(), observation({ promptId: "p2", position: 3 })];
		const first = bootstrapApsDistribution(rows, 50, { iterations: 20, random: seededRandom(7) });
		const second = bootstrapApsDistribution(rows, 50, { iterations: 20, random: seededRandom(7) });
		expect(first).toEqual(second);
		expect(first).toHaveLength(20);
		// Sorted ascending, as the percentile helper expects.
		expect([...first].sort((a, b) => a - b)).toEqual(first);
	});

	it("returns nothing to sample when there are no rows", () => {
		expect(bootstrapApsDistribution([], null, { iterations: 10, random: seededRandom() })).toEqual([]);
	});

	it("never resamples repetitions across different prompts", () => {
		// One prompt is always a hit, the other always a miss: any cross-prompt mixing would
		// produce intermediate values the data cannot support.
		const rows = [
			observation({ promptId: "always", position: 1, sentiment0to100: 100, competitorsMentioned: [] }),
			observation({
				promptId: "never",
				appeared: false,
				recommended: false,
				position: null,
				sentiment0to100: 0,
				grounded: false,
				competitorsMentioned: Array.from({ length: 10 }, (_, i) => `c${i}`),
			}),
		];
		const samples = bootstrapApsDistribution(rows, null, { iterations: 40, random: seededRandom(3) });
		// Each iteration draws one row per prompt, so the draw only chooses which repetition of
		// each prompt is used; with one repetition per prompt every sample equals the point score.
		const point = apsFromDimensions(dimensionsFromSubMetrics(computeSubMetrics(rows), null));
		expect(new Set(samples)).toEqual(new Set([point]));
	});

	it("computes percentiles by nearest rank over the sorted samples", () => {
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.1)).toBe(1);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5);
		expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
		expect(percentile([], 0.5)).toBe(0);
	});
});

describe("scoreModel and scoreObservations", () => {
	it("returns a point score with its variance band", () => {
		const rows = [observation({ promptId: "p1" }), observation({ promptId: "p2", position: 2 })];
		const score = scoreModel("chatgpt", rows, { capacidadAccion: 60, iterations: 30, random: seededRandom(11) });
		expect(score.model).toBe("chatgpt");
		expect(score.observations).toBe(2);
		expect(score.samples).toHaveLength(30);
		expect(score.p10).toBeLessThanOrEqual(score.p50);
		expect(score.p50).toBeLessThanOrEqual(score.p90);
		expect(score.band).toBe(bandFor(score.aps));
		expect(score.recommendationProbability).toBe(recommendationProbability(score.aps));
	});

	it("defaults to the ported 500 Montecarlo iterations", () => {
		expect(MONTECARLO_ITERATIONS).toBe(500);
		const score = scoreModel("chatgpt", [observation()], { random: seededRandom(5) });
		expect(score.samples).toHaveLength(500);
	});

	it("never mixes models in one denominator", () => {
		const scores = scoreObservations(
			[
				observation({ model: "chatgpt", appeared: true, recommended: true }),
				observation({ model: "perplexity", appeared: false, recommended: false, position: null }),
			],
			{ iterations: 10, random: seededRandom(2) },
		);
		expect(scores.map((score) => score.model)).toEqual(["chatgpt", "perplexity"]);
		// Each model is normalized on its own answers: a hit vs a miss must not average out.
		expect(scores[0]?.aps).toBeGreaterThan(scores[1]?.aps ?? 0);
		expect(scores[0]?.sub.coverage).toBe(1);
		expect(scores[1]?.sub.coverage).toBe(0);
	});

	it("rolls up per-model scores as a mean of already-normalized values", () => {
		const scores = scoreObservations(
			[observation({ model: "chatgpt" }), observation({ model: "perplexity", appeared: false, position: null })],
			{ iterations: 10, random: seededRandom(4) },
		);
		const rollup = rollupAps(scores);
		const [first, second] = scores;
		if (first === undefined || second === undefined) throw new Error("expected two model scores");
		expect(rollup).not.toBeNull();
		expect(rollup?.min).toBe(Math.min(...scores.map((score) => score.aps)));
		expect(rollup?.max).toBe(Math.max(...scores.map((score) => score.aps)));
		expect(rollup?.aps).toBe(Math.round((first.aps + second.aps) / 2));
		expect(rollupAps([])).toBeNull();
	});
});
