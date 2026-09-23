import { describe, expect, it } from "vitest";
import { APS_BUDGET_DEFAULTS, type ApsBudgetConfig, type ProviderPrice } from "../worker/budget";
import { MEASUREMENT_VERSION } from "../preference/measurement";
import { SCORING_VERSION } from "../preference/score";
import { captureSummary, fanOut, isRunComplete, planApsRun, runVersions } from "./runPlan";

const PRICES: ProviderPrice[] = [
	{ target: "chatgpt", usdPerCall: 0.02 },
	{ target: "claude", usdPerCall: 0.01 },
	{ target: "believe-deep", usdPerCall: 0.001 },
];

const JUDGE = { alias: "believe-deep", version: "deepseek-flash-4.1", pipelineVersion: "judge-v1" };

function config(overrides: Partial<ApsBudgetConfig> = {}): ApsBudgetConfig {
	return { ...APS_BUDGET_DEFAULTS, ...overrides };
}

describe("runVersions", () => {
	it("stamps the full series identity a run belongs to", () => {
		const versions = runVersions(JUDGE, 3);
		expect(versions).toEqual({
			scoringVersion: SCORING_VERSION,
			measurementVersion: MEASUREMENT_VERSION,
			judgeModelAlias: "believe-deep",
			judgeModelVersion: "deepseek-flash-4.1",
			judgePipelineVersion: "judge-v1",
			promptLibraryVersion: 3,
		});
	});
});

describe("fanOut", () => {
	it("creates one job per prompt, model and repetition", () => {
		const jobs = fanOut(["p1", "p2"], ["chatgpt", "claude"], 2);
		expect(jobs).toHaveLength(8);
		expect(jobs[0]).toEqual({ promptIndex: 0, promptText: "p1", model: "chatgpt", runIndex: 0 });
		expect(jobs[7]).toEqual({ promptIndex: 1, promptText: "p2", model: "claude", runIndex: 1 });
	});

	it("returns nothing when any dimension is empty", () => {
		expect(fanOut([], ["chatgpt"], 3)).toEqual([]);
		expect(fanOut(["p1"], [], 3)).toEqual([]);
		expect(fanOut(["p1"], ["chatgpt"], 0)).toEqual([]);
	});
});

describe("planApsRun", () => {
	it("plans the full fan-out when the budget allows it", () => {
		const plan = planApsRun({
			prompts: ["p1", "p2", "p3"],
			models: ["chatgpt", "claude"],
			repetitions: 2,
			judge: JUDGE,
			promptLibraryVersion: 1,
			budgetConfig: config(),
			prices: PRICES,
		});
		expect(plan.status).toBe("ready");
		expect(plan.plannedCalls).toBe(12);
		expect(plan.jobs).toHaveLength(12);
		expect(plan.effectiveRepetitions).toBe(2);
		expect(plan.repetitionsReduced).toBe(false);
		expect(plan.versions.promptLibraryVersion).toBe(1);
	});

	it("blocks instead of running when a price is missing", () => {
		const plan = planApsRun({
			prompts: ["p1"],
			models: ["modelo-sin-precio"],
			repetitions: 1,
			judge: JUDGE,
			promptLibraryVersion: 1,
			budgetConfig: config(),
			prices: PRICES,
		});
		expect(plan.status).toBe("blocked");
		expect(plan.jobs).toEqual([]);
		expect(plan.plannedCalls).toBe(0);
		expect(plan.effectiveRepetitions).toBe(0);
		expect(plan.reasons.join(" ")).toContain("modelo-sin-precio");
	});

	it("blocks when the library is bigger than the configured maximum", () => {
		const plan = planApsRun({
			prompts: Array.from({ length: 51 }, (_, i) => `p${i}`),
			models: ["chatgpt"],
			repetitions: 1,
			judge: JUDGE,
			promptLibraryVersion: 1,
			budgetConfig: config(),
			prices: PRICES,
		});
		expect(plan.status).toBe("blocked");
	});

	it("carries the reduction forward and flags it as a partial measurement", () => {
		const plan = planApsRun({
			prompts: Array.from({ length: 10 }, (_, i) => `p${i}`),
			models: ["chatgpt", "claude"],
			repetitions: 3, // 60 calls
			judge: JUDGE,
			promptLibraryVersion: 2,
			budgetConfig: config({ maxCallsPerRun: 30, policy: "reduce_repetitions" }),
			prices: PRICES,
		});
		expect(plan.status).toBe("ready");
		expect(plan.effectiveRepetitions).toBe(1);
		expect(plan.plannedCalls).toBe(20);
		expect(plan.repetitionsReduced).toBe(true);
		expect(plan.reasons.join(" ")).toContain("Se reduce a 1 repeticiones");
	});

	it("stops on a month ceiling breach instead of reducing silently", () => {
		const plan = planApsRun({
			prompts: ["p1", "p2"],
			models: ["chatgpt"],
			repetitions: 1,
			judge: JUDGE,
			promptLibraryVersion: 1,
			budgetConfig: config({ monthBudgetUsd: 1 }),
			prices: PRICES,
			spentThisMonthUsd: 0.99,
		});
		expect(plan.status).toBe("blocked");
		expect(plan.reasons.join(" ")).toContain("Acumulado del mes");
	});
});

describe("capture", () => {
	it("counts attempts, stored answers and empties", () => {
		expect(captureSummary(["hola", "", null, undefined, "chau"])).toEqual({ attempted: 5, observations: 2, empty: 3 });
		expect(captureSummary([])).toEqual({ attempted: 0, observations: 0, empty: 0 });
	});

	it("refuses to call a run complete when answers are missing", () => {
		// A score computed on a subset must never be presented as the whole run.
		expect(isRunComplete(3, captureSummary(["a", "b", "c"]))).toBe(true);
		expect(isRunComplete(3, captureSummary(["a", "b", ""]))).toBe(false);
		expect(isRunComplete(0, captureSummary([]))).toBe(false);
	});
});
