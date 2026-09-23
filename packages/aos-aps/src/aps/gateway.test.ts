import { describe, expect, it } from "vitest";
import {
	GATEWAY_JUDGE_PIPELINE_VERSION,
	extractJsonObject,
	gatewayJudge,
	gatewaySpendFromHeaders,
	generateLibraryWithGateway,
	judgeConfigFromEnv,
	readGatewayBudget,
} from "./gateway";

const CONFIG = { url: "https://gateway.test/v1", key: "gw-key", model: "believe-deep", version: "deepseek-flash-4.1" };

function completion(content: string, ok = true): Response {
	return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
		status: ok ? 200 : 500,
		headers: { "content-type": "application/json" },
	});
}

const VERDICT = {
	appeared: true,
	recommended: true,
	position: 2,
	sentiment_0_100: 75,
	grounded: true,
	competitors_mentioned: ["Otra"],
};

describe("extractJsonObject", () => {
	it("parses a bare object", () => {
		expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
	});

	it("parses an object wrapped in fences or prose", () => {
		expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
		expect(extractJsonObject('Aca esta el analisis: {"a":1} — listo')).toEqual({ a: 1 });
	});

	it("returns null when there is no object", () => {
		expect(extractJsonObject("sin json")).toBeNull();
		expect(extractJsonObject("{roto")).toBeNull();
	});
});

describe("gatewayJudge", () => {
	it("gives the judge room for its reasoning, not just the answer", async () => {
		let body: Record<string, unknown> = {};
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
			body = JSON.parse(String(init?.body));
			return completion(JSON.stringify(VERDICT));
		}) as unknown as typeof fetch;
		await gatewayJudge(CONFIG, fetchImpl).analyze({ brandName: "F", promptText: "p", response: "r" });
		// Measured: 700 tokens went entirely to reasoning and returned empty content.
		expect(body.max_tokens).toBe(3000);
	});

	it("treats a truncated answer as no verdict instead of salvaging it", async () => {
		const truncated = (async () =>
			new Response(
				JSON.stringify({ choices: [{ finish_reason: "length", message: { content: '{"appeared": true,' } }] }),
				{
					status: 200,
					headers: { "content-type": "application/json" },
				},
			)) as unknown as typeof fetch;
		expect(
			await gatewayJudge(CONFIG, truncated).analyze({ brandName: "F", promptText: "p", response: "r" }),
		).toBeNull();
	});

	it("reads the judge token budget from the environment", () => {
		expect(judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1", LLM_GATEWAY_KEY_BEADS: "k" })?.maxTokens).toBe(3000);
		expect(
			judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1", LLM_GATEWAY_KEY_BEADS: "k", APS_JUDGE_MAX_TOKENS: "4000" })
				?.maxTokens,
		).toBe(4000);
		expect(
			judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1", LLM_GATEWAY_KEY_BEADS: "k", APS_JUDGE_MAX_TOKENS: "abc" })
				?.maxTokens,
		).toBe(3000);
	});

	it("posts the judge prompt to the gateway and returns the parsed verdict", async () => {
		const captured: { url?: string; init?: RequestInit } = {};
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			captured.url = String(url);
			captured.init = init;
			return completion(JSON.stringify(VERDICT));
		}) as unknown as typeof fetch;

		const judge = gatewayJudge(CONFIG, fetchImpl);
		const verdict = await judge.analyze({ brandName: "Felix", promptText: "mejor schorle", response: "Prueba Felix." });

		expect(verdict).toEqual(VERDICT);
		expect(captured.url).toBe("https://gateway.test/v1/chat/completions");
		const body = JSON.parse(String(captured.init?.body));
		expect(body.model).toBe("believe-deep");
		expect(body.temperature).toBe(0);
		expect(body.response_format).toEqual({ type: "json_object" });
		expect(body.messages[0].role).toBe("system");
		expect(body.messages[1].content).toContain("mejor schorle");
		expect((captured.init?.headers as Record<string, string>).authorization).toBe("Bearer gw-key");
	});

	it("publishes its own pipeline version so a judge change starts a new series", () => {
		const judge = gatewayJudge(CONFIG, (async () => completion("{}")) as unknown as typeof fetch);
		expect(judge.pipelineVersion).toBe(GATEWAY_JUDGE_PIPELINE_VERSION);
		expect(judge.pipelineVersion).not.toBe("judge-v1");
		expect(judge.alias).toBe("believe-deep");
		expect(judge.version).toBe("deepseek-flash-4.1");
	});

	it("returns null on an error response instead of inventing a verdict", async () => {
		const judge = gatewayJudge(CONFIG, (async () => completion("{}", false)) as unknown as typeof fetch);
		expect(await judge.analyze({ brandName: "F", promptText: "p", response: "r" })).toBeNull();
	});

	it("returns null when the request throws", async () => {
		const judge = gatewayJudge(CONFIG, (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch);
		expect(await judge.analyze({ brandName: "F", promptText: "p", response: "r" })).toBeNull();
	});

	it("returns null when the content is not an object", async () => {
		const judge = gatewayJudge(CONFIG, (async () => completion("no pude analizar")) as unknown as typeof fetch);
		expect(await judge.analyze({ brandName: "F", promptText: "p", response: "r" })).toBeNull();
	});

	it("falls back to the temporary key when the dedicated one is absent or empty", () => {
		const withBeaos = judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1", LLM_GATEWAY_KEY_BEAOS: "nueva" });
		expect(withBeaos?.key).toBe("nueva");

		// A rendered .env commonly carries `LLM_GATEWAY_KEY_BEAOS=` until the dedicated key exists.
		const empty = judgeConfigFromEnv({
			LLM_GATEWAY_URL: "https://gw/v1",
			LLM_GATEWAY_KEY_BEAOS: "",
			LLM_GATEWAY_KEY_BEADS: "temporal",
		});
		expect(empty?.key).toBe("temporal");

		const onlyTemporary = judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1", LLM_GATEWAY_KEY_BEADS: "temporal" });
		expect(onlyTemporary?.key).toBe("temporal");
		expect(onlyTemporary?.model).toBe("believe-deep");
		expect(onlyTemporary?.version).toBe("unpinned");
	});

	it("needs both the url and a key", () => {
		expect(judgeConfigFromEnv({ LLM_GATEWAY_URL: "https://gw/v1" })).toBeNull();
		expect(judgeConfigFromEnv({ LLM_GATEWAY_KEY_BEADS: "temporal" })).toBeNull();
		expect(judgeConfigFromEnv({ LLM_GATEWAY_URL: "  ", LLM_GATEWAY_KEY_BEADS: "temporal" })).toBeNull();
	});

	it("normalizes a trailing slash in the configured url", async () => {
		let url = "";
		const fetchImpl = (async (target: string | URL | Request) => {
			url = String(target);
			return completion("{}");
		}) as unknown as typeof fetch;
		await gatewayJudge({ ...CONFIG, url: "https://gateway.test/v1/" }, fetchImpl).analyze({
			brandName: "F",
			promptText: "p",
			response: "r",
		});
		expect(url).toBe("https://gateway.test/v1/chat/completions");
	});
});

describe("generateLibraryWithGateway", () => {
	const libraryConfig = {
		url: "https://gateway.test/v1",
		key: "gw-key",
		model: "believe-smart",
		version: "deepseek-flash-4.1",
	};

	function libraryResponse(prompts: unknown[]): Response {
		return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ prompts }) } }] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
	}

	it("asks for the target mix without letting the brand into the prompts", async () => {
		const captured: { body?: string } = {};
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
			captured.body = String(init?.body);
			return libraryResponse([{ text: "mejor opcion de la categoria", kind: "category", funnel_stage: "awareness" }]);
		}) as unknown as typeof fetch;

		const result = await generateLibraryWithGateway(
			{ brandName: "Felix", industry: "bebidas", brief: "schorle artesanal" },
			libraryConfig,
			fetchImpl,
		);
		expect(result?.prompts).toEqual([
			{ text: "mejor opcion de la categoria", kind: "category", funnelStage: "awareness" },
		]);
		expect(result?.rejected).toEqual([]);
		expect(captured.body).toContain("50% comparison, 30% use_case, 20% category");
		expect(captured.body).toContain("schorle artesanal");
	});

	it("gives generation room for the reasoning plus fifty prompts", async () => {
		let body: Record<string, unknown> = {};
		const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
			body = JSON.parse(String(init?.body));
			return libraryResponse([{ text: "x", kind: "category", funnel_stage: "awareness" }]);
		}) as unknown as typeof fetch;
		await generateLibraryWithGateway({ brandName: "F" }, libraryConfig, fetchImpl);
		// Measured: 50 prompts spent ~3.7k reasoning + ~6.3k writing; 4000 truncated it.
		expect(body.max_tokens).toBe(8000);
	});

	it("accepts a camelCase funnel stage and drops invalid candidates", async () => {
		const fetchImpl = (async () =>
			libraryResponse([
				{ text: "valido", kind: "comparison", funnelStage: "consideration" },
				{ text: "tipo raro", kind: "otro", funnel_stage: "awareness" },
				{ text: "embudo raro", kind: "category", funnel_stage: "otro" },
				{ text: "   ", kind: "category", funnel_stage: "awareness" },
			])) as unknown as typeof fetch;

		const result = await generateLibraryWithGateway({ brandName: "Felix" }, libraryConfig, fetchImpl);
		expect(result?.prompts).toHaveLength(1);
		expect(result?.prompts[0]?.text).toBe("valido");
		expect(result?.rejected).toHaveLength(3);
	});

	it("returns null instead of half a library", async () => {
		const empty = (async () => libraryResponse([])) as unknown as typeof fetch;
		expect(await generateLibraryWithGateway({ brandName: "F" }, libraryConfig, empty)).toBeNull();

		const broken = (async () =>
			new Response(JSON.stringify({ choices: [{ message: { content: "no es json" } }] }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		expect(await generateLibraryWithGateway({ brandName: "F" }, libraryConfig, broken)).toBeNull();

		const failing = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
		expect(await generateLibraryWithGateway({ brandName: "F" }, libraryConfig, failing)).toBeNull();
	});
});

describe("gateway cost and budget", () => {
	it("reads the billed cost the gateway reports per call", () => {
		const headers = new Headers({
			"x-litellm-response-cost": "1.65e-05",
			"x-litellm-key-spend": "3.388545045000002",
			"x-litellm-key-max-budget": "50.0",
		});
		expect(gatewaySpendFromHeaders(headers)).toBeCloseTo(0.0000165, 10);
		expect(gatewaySpendFromHeaders(new Headers())).toBeNull();
		expect(gatewaySpendFromHeaders(new Headers({ "x-litellm-response-cost": "no-es-numero" }))).toBeNull();
	});

	it("reports the real spend of each judge call", async () => {
		const costs: number[] = [];
		const fetchImpl = (async () =>
			new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(VERDICT) } }] }), {
				status: 200,
				headers: { "content-type": "application/json", "x-litellm-response-cost": "0.00002" },
			})) as unknown as typeof fetch;

		const judge = gatewayJudge(CONFIG, fetchImpl, (usd) => costs.push(usd));
		await judge.analyze({ brandName: "F", promptText: "p", response: "r" });
		await judge.analyze({ brandName: "F", promptText: "p", response: "r" });
		expect(costs).toEqual([0.00002, 0.00002]);
	});

	it("reads the key budget without an inference call", async () => {
		let url = "";
		const fetchImpl = (async (target: string | URL | Request) => {
			url = String(target);
			return new Response(
				JSON.stringify({
					key: "abc",
					info: {
						spend: 3.388545045000002,
						max_budget: 50,
						budget_duration: "30d",
						budget_reset_at: "2026-10-01T00:00:00Z",
						models: ["believe-fast", "believe-smart", "believe-deep"],
					},
				}),
				{ status: 200, headers: { "content-type": "application/json" } },
			);
		}) as unknown as typeof fetch;

		const budget = await readGatewayBudget(CONFIG, fetchImpl);
		expect(url).toBe("https://gateway.test/v1/key/info");
		expect(budget).toEqual({
			spend: 3.388545045000002,
			maxBudget: 50,
			budgetDuration: "30d",
			budgetResetAt: "2026-10-01T00:00:00Z",
			models: ["believe-fast", "believe-smart", "believe-deep"],
		});
	});

	it("returns null instead of inventing a budget", async () => {
		const failing = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
		expect(await readGatewayBudget(CONFIG, failing)).toBeNull();
		const throwing = (async () => {
			throw new Error("ECONNREFUSED");
		}) as unknown as typeof fetch;
		expect(await readGatewayBudget(CONFIG, throwing)).toBeNull();
		const noInfo = (async () =>
			new Response(JSON.stringify({ key: "abc" }), {
				status: 200,
				headers: { "content-type": "application/json" },
			})) as unknown as typeof fetch;
		expect(await readGatewayBudget(CONFIG, noInfo)).toBeNull();
	});
});
