import { describe, expect, it } from "vitest";
import { type MeasurementTargetConfig, callTimeoutsFromEnv, measurableModels, queryTargetsFrom, withCallTimeouts } from "./targets";

function config(overrides: Partial<MeasurementTargetConfig> = {}): MeasurementTargetConfig {
	return { model: "chatgpt", provider: "openai-api", version: "gpt-5.5", webSearch: true, ...overrides };
}

describe("queryTargetsFrom", () => {
	it("creates one client per measured model, keyed by model name", async () => {
		const calls: Array<{ provider: string; prompt: string }> = [];
		const { targets, duplicateModels } = queryTargetsFrom(
			[config({ model: "chatgpt" }), config({ model: "claude", provider: "anthropic-api" })],
			async (target, prompt) => {
				calls.push({ provider: target.provider, prompt });
				return `respuesta de ${target.model}`;
			},
		);
		expect(targets.map((target) => target.target)).toEqual(["chatgpt", "claude"]);
		expect(duplicateModels).toEqual([]);

		// Each client passes its own config through, so provider and version are not lost.
		const answer = await targets[1]?.query("mejor opcion");
		expect(answer).toBe("respuesta de claude");
		expect(calls).toEqual([{ provider: "anthropic-api", prompt: "mejor opcion" }]);
	});

	it("keeps the first config when two share a model and reports the collision", () => {
		const { targets, duplicateModels } = queryTargetsFrom(
			[config({ provider: "openai-api" }), config({ provider: "openrouter" })],
			async () => "x",
		);
		expect(targets).toHaveLength(1);
		expect(duplicateModels).toEqual(["chatgpt"]);
	});

	it("handles an empty configuration", () => {
		expect(queryTargetsFrom([], async () => "x")).toEqual({ targets: [], duplicateModels: [] });
		expect(measurableModels([])).toEqual([]);
	});
});

describe("measurableModels", () => {
	it("lists the models a run can measure, in order and without repeats", () => {
		expect(
			measurableModels([
				config({ model: "chatgpt" }),
				config({ model: "claude" }),
				config({ model: "chatgpt" }),
				config({ model: "perplexity" }),
			]),
		).toEqual(["chatgpt", "claude", "perplexity"]);
	});
});

describe("callTimeoutsFromEnv", () => {
	it("lee los techos por modelo", () => {
		expect(callTimeoutsFromEnv({ APS_CALL_TIMEOUTS: "perplexity=600000,google-ai-mode=330000" })).toEqual({
			perplexity: 600_000,
			"google-ai-mode": 330_000,
		});
	});

	it("sin la variable no hay techos: cada modelo usa el de la corrida", () => {
		expect(callTimeoutsFromEnv({})).toEqual({});
		expect(callTimeoutsFromEnv({ APS_CALL_TIMEOUTS: "   " })).toEqual({});
	});

	it("ignora entradas rotas en vez de tumbar la corrida", () => {
		expect(callTimeoutsFromEnv({ APS_CALL_TIMEOUTS: "perplexity=,=5000,roto=abc,solouno,chico=12" })).toEqual({});
	});
});

describe("withCallTimeouts", () => {
	it("aplica el techo solo al modelo que lo tiene", () => {
		const configs = [{ model: "perplexity" }, { model: "chatgpt" }];
		expect(withCallTimeouts(configs, { perplexity: 600_000 })).toEqual([
			{ model: "perplexity", timeoutMs: 600_000 },
			{ model: "chatgpt" },
		]);
	});

	it("sin techos devuelve lo mismo, sin campos de mas", () => {
		const configs = [{ model: "chatgpt" }];
		expect(withCallTimeouts(configs, {})).toEqual([{ model: "chatgpt" }]);
	});
});
