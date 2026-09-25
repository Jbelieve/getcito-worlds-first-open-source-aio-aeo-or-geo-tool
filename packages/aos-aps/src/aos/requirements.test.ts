import { describe, expect, it } from "vitest";
import {
	EXTENDED_REQUIREMENTS,
	REQUIREMENTS,
	classifyBusinessType,
	evaluateExtended,
	evaluateStandards,
} from "./requirements";

/**
 * The scored list must stay identical to MAASY's `aos-standards-check.ts`: BeAOS and the Maasy audit
 * have to report the same number for the same site. Changing this list changes every score.
 */
const MAASY_SCORED: Array<[string, "AOS" | "APS", "MUST" | "SHOULD" | "MAY", string]> = [
	["AOS-DISC-01", "AOS", "SHOULD", "llms_txt"],
	["AOS-DISC-03", "AOS", "SHOULD", "agents_md"],
	["AOS-DISC-04", "AOS", "MUST", "robots_sitemap"],
	["AOS-CONT-01", "AOS", "SHOULD", "jsonld"],
	["AOS-IDEN-01", "AOS", "MUST", "agent_card"],
	["AOS-IDEN-02", "AOS", "SHOULD", "agent_permissions"],
	["AOS-CAPA-01", "AOS", "SHOULD", "mcp_server_card"],
	["AOS-API-01", "AOS", "MUST", "openapi"],
	["APS-CLAIM-01", "APS", "MUST", "brand_json"],
	["APS-PROV-02", "APS", "SHOULD", "keys_json"],
	["APS-PROV-01", "APS", "SHOULD", "signature_valid"],
];

/** Every spec.json v0.1.0 id, split between scored and extended here. */
const SPEC_V0_1_0_IDS = [
	"AOS-DISC-01",
	"AOS-DISC-02",
	"AOS-DISC-03",
	"AOS-DISC-04",
	"AOS-CONT-01",
	"AOS-CONT-02",
	"AOS-CONT-03",
	"AOS-IDEN-01",
	"AOS-IDEN-02",
	"AOS-CAPA-01",
	"AOS-CAPA-02",
	"APS-CLAIM-01",
	"APS-CLAIM-02",
	"APS-CLAIM-03",
	"APS-CLAIM-04",
	"APS-PROV-01",
	"APS-PROV-02",
	"APS-PROV-03",
];

describe("REQUIREMENTS", () => {
	it("is the Maasy scored subset, element for element", () => {
		expect(REQUIREMENTS.map((r) => [r.id, r.axis, r.strength, r.signal])).toEqual(MAASY_SCORED);
	});

	it("covers the whole published standard between scored and extended checks", () => {
		const all = [...REQUIREMENTS, ...EXTENDED_REQUIREMENTS].map((r) => r.id);
		for (const id of SPEC_V0_1_0_IDS) expect(all, `${id} is missing`).toContain(id);
		// AOS-API-01 is the one local id: spec.json assigns that surface no id.
		expect(all.filter((id) => SPEC_V0_1_0_IDS.includes(id) === false)).toEqual(["AOS-API-01"]);
		expect(new Set(all).size).toBe(all.length);
	});

	it("keeps the extended checks out of the scored list", () => {
		for (const extended of EXTENDED_REQUIREMENTS) {
			expect(REQUIREMENTS.some((r) => r.id === extended.id)).toBe(false);
		}
	});
});

describe("evaluateStandards", () => {
	it("excludes inapplicable requirements from the denominator instead of failing them", () => {
		const brand = evaluateStandards({}, "brand");
		expect(brand.requirements.find((r) => r.id === "AOS-API-01")?.status).toBe("n_a");
		expect(brand.aos_standards).toBe(0);

		const product = evaluateStandards({}, "product_api");
		expect(product.requirements.find((r) => r.id === "AOS-API-01")?.status).toBe("fail");
	});

	it("scores a fully compliant site at 100 on both axes", () => {
		const probes: Record<string, boolean> = {};
		for (const requirement of [...REQUIREMENTS, ...EXTENDED_REQUIREMENTS]) probes[requirement.signal] = true;
		const result = evaluateStandards(probes, "brand");
		expect(result.aos_standards).toBe(100);
		expect(result.aps_standards).toBe(100);
		expect(result.signature_verified).toBe(true);
	});

	it("reproduces the Maasy number for believe-global.com", () => {
		// Probes as Maasy reported them: AGENTS.md is the only AOS miss, and the site classifies as
		// product_api because an MCP was found (declared in its own llms.txt).
		const probes: Record<string, boolean> = {
			llms_txt: true,
			agents_md: false,
			robots_sitemap: true,
			jsonld: true,
			agent_card: true,
			agent_permissions: true,
			mcp_server_card: true,
			openapi: true,
			brand_json: true,
			keys_json: true,
			signature_valid: true,
		};
		const result = evaluateStandards(probes, "product_api");
		// 17 of 19 applicable weight: the same 89 the Maasy audit reported.
		expect(result.aos_standards).toBe(89);
		expect(result.aps_standards).toBe(100);
	});

	it("weights MUST above SHOULD and MAY", () => {
		const onlyMust: Record<string, boolean> = {};
		for (const requirement of REQUIREMENTS) onlyMust[requirement.signal] = requirement.strength === "MUST";
		const result = evaluateStandards(onlyMust, "brand");
		// AOS applicable weight 16, the two brand-type MUSTs worth 6 -> 38.
		expect(result.aos_standards).toBe(38);
		// APS applicable weight 7, the single MUST worth 3 -> 43.
		expect(result.aps_standards).toBe(43);
	});
});

describe("evaluateExtended", () => {
	it("marks every extended result as diagnostic", () => {
		const results = evaluateExtended({}, "brand");
		expect(results).toHaveLength(EXTENDED_REQUIREMENTS.length);
		expect(results.every((result) => result.diagnostic === true)).toBe(true);
	});

	it("does not affect the scored result", () => {
		const scored = evaluateStandards({}, "brand");
		expect(scored.requirements.every((result) => result.diagnostic === undefined)).toBe(true);
	});
});

describe("classifyBusinessType", () => {
	it("treats an exposed MCP or API as a product surface", () => {
		expect(classifyBusinessType({ hasOpenApi: true })).toBe("product_api");
		expect(classifyBusinessType({})).toBe("brand");
	});
});

describe("estimateGains / evidencia", () => {
	/** Todos los puntuados pasan: no hay nada que ganar. */
	function allPass(): Record<string, boolean> {
		const probes: Record<string, boolean> = {};
		for (const def of REQUIREMENTS) probes[def.signal] = true;
		return probes;
	}

	it("la suma de las ganancias es, redondeo mediante, 100 menos el score", () => {
		const probes = allPass();
		probes.robots_sitemap = false; // MUST: el que más pesa
		probes.llms_txt = false; // SHOULD
		const result = evaluateStandards(probes, "brand");
		const fallando = result.requirements.filter((r) => r.status === "fail");
		const total = result.requirements.reduce((sum, r) => sum + (r.gain ?? 0), 0);
		expect(result.aos_standards).toBeLessThan(100);
		// El score se redondea a entero (±0,5) y cada ganancia a un decimal (±0,05 cada una), asi que
		// la igualdad exacta no es alcanzable: se verifica contra el bound real del redondeo.
		const tolerancia = 0.5 + 0.05 * fallando.length;
		expect(Math.abs(total - (100 - result.aos_standards))).toBeLessThanOrEqual(tolerancia);
	});

	it("solo los puntuados que fallan traen ganancia", () => {
		const probes = allPass();
		probes.llms_txt = false;
		probes.jsonld = false;
		const { requirements } = evaluateStandards(probes, "brand");
		for (const r of requirements) {
			if (r.status === "fail") expect(r.gain).toBeGreaterThan(0);
			else expect(r.gain).toBeUndefined();
		}
	});

	it("los diagnosticos no traen ganancia ni se llevan puntos ajenos", () => {
		const probes = allPass();
		for (const def of EXTENDED_REQUIREMENTS) probes[def.signal] = false;
		const scored = evaluateStandards(probes, "brand");
		const extended = evaluateExtended(probes, "brand");
		// El score con TODOS los diagnosticos en rojo es identico al de todos en verde.
		expect(scored.aos_standards).toBe(100);
		for (const r of extended) {
			expect(r.diagnostic).toBe(true);
			expect(r.gain).toBeUndefined();
		}
	});

	it("un check que no aplica queda n/a y no ensucia el denominador", () => {
		const probes = allPass();
		const brand = evaluateStandards(probes, "brand");
		const productApi = evaluateStandards(probes, "product_api");
		const naBrand = brand.requirements.filter((r) => r.status === "n_a");
		const naProductApi = productApi.requirements.filter((r) => r.status === "n_a");
		// Los conjuntos que aplican difieren entre tipos de negocio.
		expect(naBrand.length).not.toBe(naProductApi.length);
		expect(brand.aos_standards).toBe(100);
		expect(productApi.aos_standards).toBe(100);
	});

	it("adjunta la evidencia que le pasan, sin cambiar el score", () => {
		const probes = allPass();
		const sinEvidencia = evaluateStandards(probes, "brand");
		const conEvidencia = evaluateStandards(probes, "brand", { llms_txt: "/llms.txt responde 200 (text/plain, 812 chars)." });
		expect(conEvidencia.aos_standards).toBe(sinEvidencia.aos_standards);
		const disc01 = conEvidencia.requirements.find((r) => r.id === "AOS-DISC-01");
		expect(disc01?.evidence).toContain("/llms.txt responde 200");
		// Y donde no hay evidencia, el campo no existe (no queda un string vacio).
		const disc03 = conEvidencia.requirements.find((r) => r.id === "AOS-DISC-03");
		expect(disc03?.evidence).toBeUndefined();
	});
});
