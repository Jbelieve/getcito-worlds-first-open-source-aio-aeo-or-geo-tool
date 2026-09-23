import { describe, expect, it } from "vitest";
import {
	type ApsJudge,
	type JudgeInput,
	type JudgeVerdict,
	judgeObservations,
	judgePrompt,
	normalizeVerdict,
} from "./judge";

describe("judgePrompt", () => {
	it("asks the brand perspective over the raw answer", () => {
		const prompt = judgePrompt("Felix", "mejor schorle", "Prueba Felix Schorle.");
		expect(prompt).toContain('"mejor schorle"');
		expect(prompt).toContain('"Prueba Felix Schorle."');
		expect(prompt).toContain('la marca "Felix"');
	});
});

describe("normalizeVerdict", () => {
	it("accepts a well-formed verdict", () => {
		const verdict = normalizeVerdict({
			appeared: true,
			recommended: true,
			position: 2,
			sentiment_0_100: 80,
			grounded: true,
			competitors_mentioned: ["Otra", "Otra mas"],
		});
		expect(verdict).toEqual({
			appeared: true,
			recommended: true,
			position: 2,
			sentiment0to100: 80,
			grounded: true,
			competitorsMentioned: ["Otra", "Otra mas"],
		});
	});

	it("refuses a verdict missing a required boolean", () => {
		expect(normalizeVerdict(null)).toBeNull();
		expect(normalizeVerdict("texto")).toBeNull();
		expect(normalizeVerdict({ appeared: true, recommended: true })).toBeNull();
		expect(normalizeVerdict({ appeared: "si", recommended: true, grounded: true })).toBeNull();
	});

	it("clamps sentiment into 0-100 and defaults it to neutral", () => {
		const base = { appeared: true, recommended: true, grounded: true };
		expect(normalizeVerdict({ ...base, sentiment_0_100: 140 })?.sentiment0to100).toBe(100);
		expect(normalizeVerdict({ ...base, sentiment_0_100: -20 })?.sentiment0to100).toBe(0);
		expect(normalizeVerdict({ ...base, sentiment_0_100: "muy bueno" })?.sentiment0to100).toBe(50);
		expect(normalizeVerdict({ ...base })?.sentiment0to100).toBe(50);
	});

	it("forces position to null when the brand did not appear, and drops ranks below 1", () => {
		const base = { recommended: true, grounded: false };
		expect(normalizeVerdict({ ...base, appeared: false, position: 3 })?.position).toBeNull();
		expect(normalizeVerdict({ ...base, appeared: true, position: 0 })?.position).toBeNull();
		expect(normalizeVerdict({ ...base, appeared: true, position: 2.7 })?.position).toBe(2);
		expect(normalizeVerdict({ ...base, appeared: true, position: "primero" })?.position).toBeNull();
	});

	it("cannot recommend a brand that did not appear", () => {
		const verdict = normalizeVerdict({ appeared: false, recommended: true, grounded: true });
		expect(verdict?.recommended).toBe(false);
	});

	it("cleans the open competitor denominator", () => {
		const verdict = normalizeVerdict({
			appeared: true,
			recommended: false,
			grounded: false,
			competitors_mentioned: ["  Uno  ", "Uno", "", 42, null, "Dos"],
		});
		expect(verdict?.competitorsMentioned).toEqual(["Uno", "Dos"]);
	});
});

describe("judgeObservations", () => {
	const verdict = {
		appeared: true,
		recommended: true,
		position: 1,
		sentiment0to100: 90,
		grounded: true,
		competitorsMentioned: [],
	};

	function judge(analyze: (input: JudgeInput) => Promise<unknown>): ApsJudge {
		return {
			alias: "believe-deep",
			version: "deepseek-flash-4.1",
			pipelineVersion: "judge-v1",
			analyze: (input) => analyze(input) as Promise<JudgeVerdict | null>,
		};
	}

	it("judges stored answers without querying a model again", async () => {
		const report = await judgeObservations(
			[{ observationId: "o1", promptText: "p1", response: "respuesta" }],
			"Felix",
			judge(async () => verdict),
		);
		expect(report.judged).toHaveLength(1);
		expect(report.judged[0]?.verdict.appeared).toBe(true);
		expect(report.unjudged).toEqual([]);
	});

	it("drops a malformed verdict instead of guessing", async () => {
		const report = await judgeObservations(
			[{ observationId: "o1", promptText: "p1", response: "respuesta" }],
			"Felix",
			judge(async () => ({ appeared: true })),
		);
		expect(report.judged).toEqual([]);
		expect(report.unjudged[0]?.reason).toContain("usable");
	});

	it("reports a judge failure per observation and keeps the rest", async () => {
		const report = await judgeObservations(
			[
				{ observationId: "o1", promptText: "p1", response: "a" },
				{ observationId: "o2", promptText: "p2", response: "b" },
			],
			"Felix",
			judge(async (input) => {
				if (input.response === "a") throw new Error("judge timeout");
				return verdict;
			}),
		);
		expect(report.judged.map((entry) => entry.observationId)).toEqual(["o2"]);
		expect(report.unjudged[0]).toEqual({ observationId: "o1", reason: "judge timeout" });
	});

	it("passes the brand name and the raw answer to the judge", async () => {
		let received: JudgeInput | null = null;
		await judgeObservations(
			[{ observationId: "o1", promptText: "p1", response: "texto crudo" }],
			"Felix",
			judge(async (input) => {
				received = input;
				return verdict;
			}),
		);
		expect(received).toEqual({ brandName: "Felix", promptText: "p1", response: "texto crudo" });
	});

	it("does nothing with no observations", async () => {
		const report = await judgeObservations(
			[],
			"Felix",
			judge(async () => verdict),
		);
		expect(report).toEqual({ judged: [], unjudged: [] });
	});
});
