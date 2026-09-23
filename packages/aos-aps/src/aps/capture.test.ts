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

describe("captureRun timeouts", () => {
	it("turns a hung provider into a failure instead of stalling the whole run", async () => {
		const hung: QueryTarget = { target: "perplexity", query: () => new Promise(() => {}) };
		const report = await captureRun(fanOut(["p1"], ["perplexity"], 1), [hung], { timeoutMs: 1000 });
		expect(report.answers).toEqual([]);
		expect(report.summary).toEqual({ attempted: 1, observations: 0, empty: 1 });
		expect(report.failures[0]?.reason).toContain("sin respuesta en 1000ms");
	});

	it("keeps the answers that did arrive when another model hangs", async () => {
		const ok = target("chatgpt", () => "respuesta buena");
		const hung: QueryTarget = { target: "perplexity", query: () => new Promise(() => {}) };
		const report = await captureRun(fanOut(["p1"], ["chatgpt", "perplexity"], 1), [ok, hung], { timeoutMs: 1000 });
		expect(report.answers).toHaveLength(1);
		expect(report.summary).toEqual({ attempted: 2, observations: 1, empty: 1 });
		expect(report.failures).toHaveLength(1);
	});
});

describe("captureRun con un proveedor lento", () => {
	/** Un modelo que nunca responde, con techo declarado. */
	function hanging(name: string, timeoutMs?: number): QueryTarget {
		return {
			target: name,
			query: () => new Promise<string>(() => {}),
			...(timeoutMs === undefined ? {} : { timeoutMs }),
		};
	}

	it("usa el techo del modelo cuando lo declara, en vez del de la corrida", async () => {
		// El techo de la corrida es enorme a proposito: si el modelo no mandara, el test tardaria 60s.
		const report = await captureRun([{ promptIndex: 0, promptText: "p1", model: "lento", runIndex: 0 }], [hanging("lento", 1000)], {
			timeoutMs: 60_000,
		});
		expect(report.failures[0]?.reason).toContain("sin respuesta en 1000ms");
	});

	it("corre los modelos lentos en carriles distintos en vez de uno detras del otro", async () => {
		// Con lotes fijos de 2 y el orden prompt -> modelo -> repeticion, los dos jobs lentos caen en
		// lotes distintos: nunca corren juntos y la corrida paga el techo DOS veces. Con el pool y el
		// reclamo agrupado por modelo, arrancan los dos a la vez.
		let lentosEnVuelo = 0;
		let picoLentos = 0;
		const lento = (): Promise<string> => {
			lentosEnVuelo += 1;
			picoLentos = Math.max(picoLentos, lentosEnVuelo);
			return new Promise<string>((resolve) =>
				setTimeout(() => {
					lentosEnVuelo -= 1;
					resolve("respuesta-lenta");
				}, 1200),
			);
		};
		const targets: QueryTarget[] = [{ target: "lento", query: lento }, target("rapido", () => "ok")];
		const jobs = [
			{ promptIndex: 0, promptText: "p1", model: "lento", runIndex: 0 },
			{ promptIndex: 0, promptText: "p1", model: "rapido", runIndex: 0 },
			{ promptIndex: 0, promptText: "p1", model: "lento", runIndex: 1 },
			{ promptIndex: 0, promptText: "p1", model: "rapido", runIndex: 1 },
		];

		const report = await captureRun(jobs, targets, { concurrency: 2 });

		expect(picoLentos).toBe(2);
		expect(report.summary).toEqual({ attempted: 4, observations: 4, empty: 0 });
		expect(report.failures).toEqual([]);
	});

	it("sigue devolviendo cada respuesta en la posicion de su job con varios modelos", async () => {
		// El reclamo agrupado por modelo cambia el orden de ejecucion: las respuestas igual tienen que
		// volver a la posicion que les toca, o se pegan al prompt equivocado.
		const targets: QueryTarget[] = [
			{ target: "b", query: async (p: string) => `b:${p}` },
			{ target: "a", query: async (p: string) => `a:${p}` },
		];
		const jobs = [
			{ promptIndex: 0, promptText: "p1", model: "b", runIndex: 0 },
			{ promptIndex: 1, promptText: "p2", model: "a", runIndex: 0 },
			{ promptIndex: 2, promptText: "p3", model: "b", runIndex: 0 },
			{ promptIndex: 3, promptText: "p4", model: "a", runIndex: 0 },
		];

		const report = await captureRun(jobs, targets, { concurrency: 2 });

		expect(report.answers.map((entry) => entry.response)).toEqual(["b:p1", "a:p2", "b:p3", "a:p4"]);
		expect(report.answers.map((entry) => entry.job.promptIndex)).toEqual([0, 1, 2, 3]);
	});
});
