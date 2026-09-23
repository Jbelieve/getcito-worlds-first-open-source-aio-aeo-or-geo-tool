import { describe, expect, it } from "vitest";
import { APS_BUDGET_DEFAULTS, apsPricesFromEnv } from "../worker/budget";
import { type PrepareApsRunInput, prepareApsRun } from "./startRun";

const JUDGE = { alias: "believe-deep", version: "deepseek-flash-4.1", pipelineVersion: "gateway-json-v1" };
const PRICES = [
	{ target: "chatgpt", usdPerCall: 0.02 },
	{ target: "claude", usdPerCall: 0.01 },
	{ target: "believe-deep", usdPerCall: 0.001 },
];

function input(overrides: Partial<PrepareApsRunInput> = {}): PrepareApsRunInput {
	return {
		entity: { id: "entity-1", name: "Felix", websiteUrl: "https://felix.com" },
		library: { id: "lib-1", version: 3 },
		prompts: [
			{ id: "p1", text: "mejor schorle" },
			{ id: "p2", text: "alternativas sin alcohol" },
		],
		models: ["chatgpt", "claude"],
		repetitions: 3,
		capacidadAccion: 60,
		judge: JUDGE,
		prices: PRICES,
		budgetConfig: APS_BUDGET_DEFAULTS,
		...overrides,
	};
}

describe("apsPricesFromEnv", () => {
	it("parses target=usd pairs", () => {
		expect(apsPricesFromEnv({ APS_PRICES: "chatgpt=0.02,believe-deep=0.0005" })).toEqual([
			{ target: "chatgpt", usdPerCall: 0.02 },
			{ target: "believe-deep", usdPerCall: 0.0005 },
		]);
	});

	it("skips entries it cannot read instead of pricing them at zero", () => {
		expect(apsPricesFromEnv({ APS_PRICES: "chatgpt=0.02,roto,claude=abc,=0.5,otro=-1" })).toEqual([
			{ target: "chatgpt", usdPerCall: 0.02 },
		]);
	});

	it("returns nothing when unset", () => {
		expect(apsPricesFromEnv({})).toEqual([]);
		expect(apsPricesFromEnv({ APS_PRICES: "   " })).toEqual([]);
	});
});

describe("prepareApsRun", () => {
	it("prepares a ready run with its series identity and estimate", () => {
		const prepared = prepareApsRun(input());
		expect(prepared.status).toBe("ready");
		expect(prepared.run).toMatchObject({
			entityId: "entity-1",
			libraryId: "lib-1",
			models: ["chatgpt", "claude"],
			requestedRepetitions: 3,
			effectiveRepetitions: 3,
			repetitionsReduced: false,
			plannedCalls: 12,
			capacidadAccion: 60,
			promptLibraryVersion: 3,
			judgeModelAlias: "believe-deep",
			judgeModelVersion: "deepseek-flash-4.1",
			judgePipelineVersion: "gateway-json-v1",
		});
		expect(prepared.jobs).toHaveLength(12);
		expect(prepared.estimate?.calls).toBe(12);
		// 2 prompts x 3 reps x (0.02 + 0.01) = 0.18, plus the judge over 12 calls.
		expect(prepared.estimate?.measurementUsd).toBeCloseTo(0.18, 6);
		// Components are rounded to cents for display; the total is computed from exact values, so it
		// can differ from the sum of the rounded ones by a cent.
		expect(prepared.estimate?.judgeUsd).toBeCloseTo(0.01, 6);
		expect(prepared.estimate?.totalUsd).toBeCloseTo(0.19, 6);
	});

	it("blocks without a library, with no prompts or with no models", () => {
		expect(prepareApsRun(input({ library: null })).reasons.join(" ")).toContain("biblioteca");
		expect(prepareApsRun(input({ prompts: [] })).reasons.join(" ")).toContain("prompts");
		expect(prepareApsRun(input({ models: [] })).reasons.join(" ")).toContain("modelos");
	});

	it("blocks when a model has no configured price", () => {
		const prepared = prepareApsRun(input({ prices: [PRICES[2] as { target: string; usdPerCall: number }] }));
		expect(prepared.status).toBe("blocked");
		expect(prepared.run).toBeNull();
		expect(prepared.jobs).toEqual([]);
		expect(prepared.reasons.join(" ")).toContain("chatgpt");
	});

	it("blocks over the per-run ceiling and explains why", () => {
		const prepared = prepareApsRun(input({ budgetConfig: { ...APS_BUDGET_DEFAULTS, runBudgetUsd: 0.05 } }));
		expect(prepared.status).toBe("blocked");
		expect(prepared.reasons.join(" ")).toContain("techo por corrida");
	});

	it("carries a reduced repetition count forward as a partial measurement", () => {
		const prepared = prepareApsRun(
			input({
				models: ["chatgpt"],
				repetitions: 3,
				budgetConfig: { ...APS_BUDGET_DEFAULTS, maxCallsPerRun: 3, policy: "reduce_repetitions" },
			}),
		);
		expect(prepared.status).toBe("ready");
		expect(prepared.run?.requestedRepetitions).toBe(3);
		expect(prepared.run?.effectiveRepetitions).toBe(1);
		expect(prepared.run?.repetitionsReduced).toBe(true);
		expect(prepared.run?.plannedCalls).toBe(2);
	});

	it("runs without a capacidad_accion when the site was never audited", () => {
		expect(prepareApsRun(input({ capacidadAccion: null })).run?.capacidadAccion).toBeNull();
	});
});
