import { describe, expect, it } from "vitest";
import {
	APS_BUDGET_DEFAULTS,
	type ApsBudgetConfig,
	type ApsRunRequest,
	apsBudgetConfigFromEnv,
	decideApsBudget,
	estimateApsRun,
	type ProviderPrice,
} from "./budget";

const PRICES: ProviderPrice[] = [
	{ target: "model-a", usdPerCall: 0.01 },
	{ target: "model-b", usdPerCall: 0.02 },
	{ target: "judge", usdPerCall: 0.001 },
];

const CONFIG: ApsBudgetConfig = { ...APS_BUDGET_DEFAULTS };

function request(overrides: Partial<ApsRunRequest> = {}): ApsRunRequest {
	return { prompts: 10, models: ["model-a", "model-b"], repetitions: 2, judgeModel: "judge", ...overrides };
}

describe("apsBudgetConfigFromEnv", () => {
	it("falls back to the documented defaults", () => {
		expect(apsBudgetConfigFromEnv({})).toEqual(APS_BUDGET_DEFAULTS);
		expect(APS_BUDGET_DEFAULTS.maxPrompts).toBe(50);
		expect(APS_BUDGET_DEFAULTS.maxCallsPerRun).toBe(450);
		expect(APS_BUDGET_DEFAULTS.policy).toBe("stop");
		// No monetary ceiling by default: the daily cap was the wrong instrument for on-demand runs.
		expect(APS_BUDGET_DEFAULTS.runBudgetUsd).toBeNull();
		expect(APS_BUDGET_DEFAULTS.monthBudgetUsd).toBeNull();
	});

	it("reads overrides and rejects nonsense", () => {
		const config = apsBudgetConfigFromEnv({
			APS_MAX_PROMPTS: "12",
			APS_MAX_MODELS: "abc",
			APS_MAX_REPETITIONS: "0",
			APS_MAX_CALLS_PER_RUN: "100",
			APS_RUN_BUDGET_USD: "2.5",
			APS_MONTH_BUDGET_USD: "-1",
			APS_BUDGET_POLICY: "reduce_repetitions",
		});
		expect(config.maxPrompts).toBe(12);
		expect(config.maxModels).toBe(APS_BUDGET_DEFAULTS.maxModels);
		expect(config.maxRepetitions).toBe(APS_BUDGET_DEFAULTS.maxRepetitions);
		expect(config.maxCallsPerRun).toBe(100);
		expect(config.runBudgetUsd).toBe(2.5);
		expect(config.monthBudgetUsd).toBeNull();
		expect(config.policy).toBe("reduce_repetitions");
		expect(apsBudgetConfigFromEnv({ APS_BUDGET_POLICY: "cualquier-cosa" }).policy).toBe("stop");
	});
});

describe("estimateApsRun", () => {
	it("counts measurement calls and judge calls separately", () => {
		const estimate = estimateApsRun(request(), PRICES);
		expect(estimate.calls).toBe(40);
		expect(estimate.judgeCalls).toBe(40);
		expect(estimate.measurementUsd).toBeCloseTo(0.6, 6);
		expect(estimate.judgeUsd).toBeCloseTo(0.04, 6);
		expect(estimate.totalUsd).toBeCloseTo(0.64, 6);
		expect(estimate.missingPrices).toEqual([]);
	});

	it("prices each model with its own rate", () => {
		const estimate = estimateApsRun(request({ models: ["model-b"] }), PRICES);
		expect(estimate.calls).toBe(20);
		expect(estimate.measurementUsd).toBeCloseTo(0.4, 6);
	});

	it("never invents a price for a model it does not know", () => {
		const estimate = estimateApsRun(request({ models: ["model-a", "desconocido"] }), PRICES);
		expect(estimate.measurementUsd).toBeNull();
		expect(estimate.totalUsd).toBeNull();
		expect(estimate.missingPrices).toEqual(["desconocido"]);
	});

	it("reports no dollar total when the judge has no price", () => {
		const estimate = estimateApsRun(request({ judgeModel: "juez-sin-precio" }), PRICES);
		expect(estimate.judgeUsd).toBeNull();
		expect(estimate.totalUsd).toBeNull();
		expect(estimate.missingPrices).toEqual(["juez-sin-precio"]);
	});

	it("totals only the measurement layer when there is no judge", () => {
		const estimate = estimateApsRun(request({ judgeModel: undefined }), PRICES);
		expect(estimate.judgeUsd).toBeNull();
		expect(estimate.missingPrices).toEqual([]);
		expect(estimate.totalUsd).toBeCloseTo(0.6, 6);
	});
});

describe("decideApsBudget", () => {
	it("allows a run that fits", () => {
		const decision = decideApsBudget(request(), PRICES, CONFIG);
		expect(decision.decision).toBe("allow");
		expect(decision.reasons).toEqual([]);
		expect(decision.effectiveRepetitions).toBe(2);
	});

	it("stops an empty run instead of scoring nothing", () => {
		expect(decideApsBudget(request({ prompts: 0 }), PRICES, CONFIG).decision).toBe("stop");
		expect(decideApsBudget(request({ models: [] }), PRICES, CONFIG).decision).toBe("stop");
		expect(decideApsBudget(request({ repetitions: 0 }), PRICES, CONFIG).decision).toBe("stop");
	});

	it("stops when the library, the model list or the repetitions exceed the configured maximum", () => {
		expect(decideApsBudget(request({ prompts: 51 }), PRICES, CONFIG).reasons.join(" ")).toContain("biblioteca");
		expect(
			decideApsBudget(request({ models: ["model-a", "model-b", "model-a", "model-b"] }), PRICES, CONFIG).reasons.join(
				" ",
			),
		).toContain("modelos");
		expect(decideApsBudget(request({ repetitions: 4 }), PRICES, CONFIG).reasons.join(" ")).toContain("repeticiones");
	});

	it("stops when a price is missing rather than guessing", () => {
		const decision = decideApsBudget(request({ models: ["model-a", "model-sin-precio"] }), PRICES, CONFIG);
		expect(decision.decision).toBe("stop");
		expect(decision.reasons.join(" ")).toContain("model-sin-precio");
		expect(decision.effectiveRepetitions).toBe(0);
	});

	it("stops a run over the call ceiling", () => {
		const decision = decideApsBudget(request(), PRICES, { ...CONFIG, maxCallsPerRun: 30 });
		expect(decision.decision).toBe("stop");
		expect(decision.reasons.join(" ")).toContain("40 llamadas");
	});

	it("stops a run over the per-run ceiling", () => {
		const decision = decideApsBudget(request(), PRICES, { ...CONFIG, runBudgetUsd: 0.5 });
		expect(decision.decision).toBe("stop");
		expect(decision.reasons.join(" ")).toContain("techo por corrida");
	});

	it("stops a run that would breach the month ceiling", () => {
		const over = decideApsBudget(request(), PRICES, { ...CONFIG, monthBudgetUsd: 1 }, 0.5);
		expect(over.decision).toBe("stop");
		expect(over.reasons.join(" ")).toContain("Acumulado del mes");

		// Without a recorded month spend the month ceiling cannot be evaluated, so it does not block.
		expect(decideApsBudget(request(), PRICES, { ...CONFIG, monthBudgetUsd: 1 }, null).decision).toBe("allow");
	});

	it("reduces repetitions instead of swapping the measurement models", () => {
		const three = request({ prompts: 50, models: ["model-a", "model-b", "model-a"], repetitions: 3 });
		const reduced = decideApsBudget(three, PRICES, { ...CONFIG, maxCallsPerRun: 200, policy: "reduce_repetitions" });
		expect(reduced.decision).toBe("reduce_repetitions");
		expect(reduced.effectiveRepetitions).toBe(1);
		expect(reduced.estimate.calls).toBe(150);
		// Same measurement models: only the repetition count moved.
		expect(reduced.estimate.models).toBe(3);
		expect(reduced.reasons.join(" ")).toContain("Se reduce a 1 repeticiones");
	});

	it("reduces repetitions to fit the money ceiling too", () => {
		const reduced = decideApsBudget(request(), PRICES, {
			...CONFIG,
			runBudgetUsd: 0.5,
			policy: "reduce_repetitions",
		});
		expect(reduced.decision).toBe("reduce_repetitions");
		expect(reduced.effectiveRepetitions).toBe(1);
		expect(reduced.estimate.totalUsd).toBeLessThanOrEqual(0.5);
	});

	it("stops when not even one repetition fits", () => {
		// 50 prompts x 2 models = 100 calls at a single repetition, still over the ceiling of 40.
		const decision = decideApsBudget(request({ prompts: 50, repetitions: 3 }), PRICES, {
			...CONFIG,
			maxCallsPerRun: 40,
			policy: "reduce_repetitions",
		});
		expect(decision.decision).toBe("stop");
		expect(decision.effectiveRepetitions).toBe(0);
		expect(decision.reasons.join(" ")).toContain("Ni con 1 repetición");
	});

	it("keeps the default policy on stop: no silent reduction", () => {
		const decision = decideApsBudget(request({ prompts: 50, repetitions: 3 }), PRICES, {
			...CONFIG,
			maxCallsPerRun: 100,
		});
		expect(decision.decision).toBe("stop");
		expect(decision.effectiveRepetitions).toBe(0);
	});
});
