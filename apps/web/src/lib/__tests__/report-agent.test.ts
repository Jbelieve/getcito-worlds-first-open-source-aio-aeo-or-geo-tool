import { describe, expect, it } from "vitest";
import {
	hostOf,
	matchEntityForReport,
	type ReportEntityRef,
	readRequirements,
	registrableDomain,
	summarizeAos,
	summarizeAps,
} from "../report-agent";

const entities: ReportEntityRef[] = [
	{
		id: "e1",
		name: "Believe",
		websiteUrl: "https://believe-global.com/",
		entityType: "product",
		isPublished: false,
	},
	{ id: "e2", name: "Felix Schorle", websiteUrl: "https://felix.com", entityType: "product", isPublished: false },
	{
		id: "e3",
		name: "Tienda Felix",
		websiteUrl: "https://tienda.felix.com/",
		entityType: "product",
		isPublished: false,
	},
];

describe("hostOf", () => {
	it("normaliza el host y saca www", () => {
		expect(hostOf("https://www.Believe-Global.com/ruta")).toBe("believe-global.com");
		expect(hostOf("believe-global.com")).toBe("believe-global.com");
	});
	it("devuelve null con basura", () => {
		expect(hostOf("")).toBeNull();
		expect(hostOf(null)).toBeNull();
		expect(hostOf(undefined)).toBeNull();
	});
});

describe("registrableDomain", () => {
	it("usa los dos últimos segmentos", () => {
		expect(registrableDomain("tienda.felix.com")).toBe("felix.com");
		expect(registrableDomain("felix.com")).toBe("felix.com");
	});
	it("respeta los sufijos de dos niveles que conocemos", () => {
		expect(registrableDomain("tienda.felix.com.co")).toBe("felix.com.co");
		expect(registrableDomain("felix.com.co")).toBe("felix.com.co");
	});
	it("no confunde dominios distintos", () => {
		expect(registrableDomain("felix.com")).not.toBe(registrableDomain("felix.com.mx"));
	});
});

describe("matchEntityForReport", () => {
	it("gana el host exacto", () => {
		const found = matchEntityForReport(entities, { website: "https://believe-global.com", name: "Otra" });
		expect(found?.id).toBe("e1");
	});

	it("cae al dominio registrable cuando el host no coincide", () => {
		const found = matchEntityForReport(entities, { website: "https://blog.felix.com", name: null });
		// `felix.com` y `tienda.felix.com` comparten raíz: gana la primera del orden, que es `e2`.
		expect(["e2", "e3"]).toContain(found?.id);
	});

	it("cae al nombre cuando no hay web usable", () => {
		const found = matchEntityForReport(entities, { website: null, name: "  tienda felix " });
		expect(found?.id).toBe("e3");
	});

	it("devuelve null si no hay forma de vincular: mejor nada que el AOS de otra marca", () => {
		expect(matchEntityForReport(entities, { website: "https://otra.com", name: "Nadie" })).toBeNull();
		expect(matchEntityForReport([], { website: "https://believe-global.com", name: "Believe" })).toBeNull();
	});
});

describe("readRequirements", () => {
	it("lee lo que tiene forma y descarta lo que no", () => {
		const requirements = readRequirements([
			{ id: "a", title: "A", axis: "aos", status: "pass" },
			{ id: "b", status: "fail", gain: 12.5, diagnostic: true },
			{ status: "pass" },
			null,
			"texto",
		]);
		expect(requirements).toHaveLength(2);
		expect(requirements[1]).toMatchObject({ id: "b", title: "b", gain: 12.5, diagnostic: true });
	});

	it("aguanta que el json guardado no sea una lista", () => {
		expect(readRequirements({ nope: true })).toEqual([]);
		expect(readRequirements(null)).toEqual([]);
	});
});

describe("summarizeAos", () => {
	const stored = [
		{ id: "a", title: "AGENTS.md", axis: "aos", status: "pass" },
		{ id: "b", title: "brand.json", axis: "aps", status: "fail", gain: 18.8 },
		{ id: "c", title: "keys.json", axis: "aps", status: "fail", gain: 9.4 },
		{ id: "d", title: "llms.txt", axis: "aos", status: "n_a" },
		// Un diagnóstico: se guarda, se muestra en la UI, pero no puede contar acá.
		{ id: "e", title: "claims", axis: "aps", status: "fail", gain: 99, diagnostic: true },
	];

	it("cuenta solo los puntuados, para que la cuenta coincida con el número", () => {
		const summary = summarizeAos(stored);
		expect(summary.scored).toBe(4);
		expect(summary.passing).toBe(1);
		expect(summary.failing).toBe(2);
		expect(summary.notApplicable).toBe(1);
	});

	it("ordena los próximos pasos por puntos y deja afuera los diagnósticos", () => {
		const summary = summarizeAos(stored);
		expect(summary.nextSteps.map((step) => step.id)).toEqual(["b", "c"]);
	});

	it("respeta el límite", () => {
		expect(summarizeAos(stored, 1).nextSteps).toHaveLength(1);
	});

	it("con datos rotos devuelve ceros en vez de reventar", () => {
		const summary = summarizeAos(undefined);
		expect(summary).toMatchObject({ scored: 0, passing: 0, failing: 0, nextSteps: [] });
	});
});

describe("summarizeAps", () => {
	const scores = [
		{ model: "chatgpt", aps: 39, band: "agent_opaque", observations: 90, partial: false, p10: 31, p50: 39, p90: 47 },
		{ model: "claude", aps: 34, band: "agent_opaque", observations: 90, partial: false, p10: 28, p50: 34, p90: 41 },
		{
			model: "google-ai-mode",
			aps: 40,
			band: "agent_aware",
			observations: 84,
			partial: true,
			p10: 33,
			p50: 40,
			p90: 48,
		},
	];

	it("muestra el mejor, el peor y la distancia en vez de un promedio que las esconde", () => {
		const summary = summarizeAps(scores);
		expect(summary.best?.model).toBe("google-ai-mode");
		expect(summary.worst?.model).toBe("claude");
		expect(summary.spread).toBe(6);
	});

	it("cuenta las bandas distintas: más de una significa que depende de a quién le preguntes", () => {
		expect(summarizeAps(scores).distinctBands).toBe(2);
	});

	it("marca parcial si alguna corrida respondió menos de lo planeado", () => {
		expect(summarizeAps(scores).partial).toBe(true);
		expect(summarizeAps([scores[0] as (typeof scores)[number]]).partial).toBe(false);
	});

	it("sin mediciones devuelve vacío, no ceros que parezcan un resultado", () => {
		expect(summarizeAps([])).toEqual({
			models: 0,
			best: null,
			worst: null,
			spread: null,
			distinctBands: 0,
			partial: false,
		});
	});
});
