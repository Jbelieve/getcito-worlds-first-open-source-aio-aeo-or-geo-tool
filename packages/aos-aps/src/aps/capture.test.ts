import { describe, expect, it } from "vitest";
import { captureRun, type QueryTarget } from "./capture";
import { fanOut } from "./runPlan";

function target(name: string, answer: (prompt: string) => string | null): QueryTarget {
	return { target: name, query: async (prompt: string) => answer(prompt) };
}

describe("captureRun", () => {
	it("asks every model for every prompt and repetition", async () => {
		const seen: string[] = [];
		const targets = [
			target("chatgpt", (prompt) => {
				seen.push(`chatgpt:${prompt}`);
				return "respuesta chatgpt";
			}),
			target("claude", (prompt) => {
				seen.push(`claude:${prompt}`);
				return "respuesta claude";
			}),
		];
		const jobs = fanOut(["p1", "p2"], ["chatgpt", "claude"], 1);
		const report = await captureRun(jobs, targets);
		expect(report.answers).toHaveLength(4);
		expect(report.summary).toEqual({ attempted: 4, observations: 4, empty: 0 });
		expect(seen.sort()).toEqual(["chatgpt:p1", "chatgpt:p2", "claude:p1", "claude:p2"]);
	});

	it("keeps the job order so answers can be zipped back", async () => {
		const targets = [target("a", (prompt) => `eco:${prompt}`)];
		const jobs = fanOut(["p1", "p2", "p3"], ["a"], 1);
		const report = await captureRun(jobs, targets, { concurrency: 1 });
		expect(report.answers.map((entry) => entry.response)).toEqual(["eco:p1", "eco:p2", "eco:p3"]);
	});

	it("counts an empty answer as empty and does not keep it as an observation", async () => {
		const targets = [target("chatgpt", () => "")];
		const report = await captureRun(fanOut(["p1"], ["chatgpt"], 1), targets);
		expect(report.answers).toEqual([]);
		expect(report.summary).toEqual({ attempted: 1, observations: 0, empty: 1 });
		expect(report.failures).toEqual([]);
	});

	it("reports a missing model client instead of silently scoring nothing", async () => {
		const report = await captureRun(fanOut(["p1"], ["gemini"], 1), [target("chatgpt", () => "x")]);
		expect(report.answers).toEqual([]);
		expect(report.failures).toHaveLength(1);
		expect(report.failures[0]?.reason).toContain("gemini");
	});

	it("turns a provider error into an empty answer plus a failure, never a partial observation", async () => {
		const failing: QueryTarget = {
			target: "chatgpt",
			query: async () => {
				throw new Error("429 rate limited");
			},
		};
		const report = await captureRun(fanOut(["p1"], ["chatgpt"], 1), [failing]);
		expect(report.answers).toEqual([]);
		expect(report.summary).toEqual({ attempted: 1, observations: 0, empty: 1 });
		expect(report.failures[0]?.reason).toBe("429 rate limited");
	});

	it("never exceeds the configured concurrency", async () => {
		let inFlight = 0;
		let peak = 0;
		const slow = target("chatgpt", () => {
			inFlight += 1;
			peak = Math.max(peak, inFlight);
			return "ok";
		});
		const original = slow.query;
		slow.query = async (prompt) => {
			const result = original(prompt);
			await new Promise((resolve) => setTimeout(resolve, 5));
			inFlight -= 1;
			return result;
		};
		await captureRun(fanOut(["p1", "p2", "p3", "p4", "p5"], ["chatgpt"], 1), [slow], { concurrency: 2 });
		expect(peak).toBeLessThanOrEqual(2);
	});

	it("does nothing for an empty job list", async () => {
		const report = await captureRun([], []);
		expect(report).toEqual({ answers: [], summary: { attempted: 0, observations: 0, empty: 0 }, failures: [] });
	});
});
