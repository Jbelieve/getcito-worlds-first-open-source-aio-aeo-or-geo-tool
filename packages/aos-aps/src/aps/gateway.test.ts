import { describe, expect, it } from "vitest";
import { GATEWAY_JUDGE_PIPELINE_VERSION, extractJsonObject, gatewayJudge } from "./gateway";

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
