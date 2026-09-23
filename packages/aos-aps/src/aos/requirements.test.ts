import { describe, expect, it } from "vitest";
import { classifyBusinessType, evaluateStandards, REQUIREMENTS } from "./requirements";

/**
 * The rubric must stay readable against aos-aps-standard/spec.json v0.1.0: same ids, same axis,
 * same strength. Diverging from the published standard is a spec decision, not a refactor.
 */
const SPEC_V0_1_0: Array<[string, "AOS" | "APS", "MUST" | "SHOULD" | "MAY"]> = [
	["AOS-DISC-01", "AOS", "SHOULD"],
	["AOS-DISC-02", "AOS", "MAY"],
	["AOS-DISC-03", "AOS", "SHOULD"],
	["AOS-DISC-04", "AOS", "MUST"],
	["AOS-CONT-01", "AOS", "SHOULD"],
	["AOS-CONT-02", "AOS", "SHOULD"],
	["AOS-CONT-03", "AOS", "MAY"],
	["AOS-IDEN-01", "AOS", "MUST"],
	["AOS-IDEN-02", "AOS", "SHOULD"],
	["AOS-CAPA-01", "AOS", "SHOULD"],
	["AOS-CAPA-02", "AOS", "SHOULD"],
	["APS-CLAIM-01", "APS", "MUST"],
	["APS-CLAIM-02", "APS", "MUST"],
	["APS-CLAIM-03", "APS", "MUST"],
	["APS-CLAIM-04", "APS", "MUST"],
	["APS-PROV-01", "APS", "SHOULD"],
	["APS-PROV-02", "APS", "SHOULD"],
	["APS-PROV-03", "APS", "MAY"],
];

describe("REQUIREMENTS", () => {
	it("covers every requirement in spec.json v0.1.0 with the published axis and strength", () => {
		for (const [id, axis, strength] of SPEC_V0_1_0) {
			const found = REQUIREMENTS.find((requirement) => requirement.id === id);
			expect(found, `${id} is missing from the rubric`).toBeDefined();
			expect({ id, axis: found?.axis, strength: found?.strength }).toEqual({ id, axis, strength });
		}
	});

	it("marks non-standard ids as extensions", () => {
		const extras = REQUIREMENTS.filter((requirement) => SPEC_V0_1_0.every(([id]) => id !== requirement.id));
		expect(extras.map((requirement) => requirement.id)).toEqual(["AOS-API-01"]);
		expect(extras.every((requirement) => requirement.extension === true)).toBe(true);
	});
});

describe("evaluateStandards", () => {
	it("excludes inapplicable requirements from the denominator instead of failing them", () => {
		const brand = evaluateStandards({}, "brand");
		const api = brand.requirements.find((requirement) => requirement.id === "AOS-API-01");
		expect(api?.status).toBe("n_a");
		expect(brand.aos_standards).toBe(0);

		const product = evaluateStandards({}, "product_api");
		expect(product.requirements.find((requirement) => requirement.id === "AOS-API-01")?.status).toBe("fail");
	});

	it("scores a fully compliant profile at 100 on both axes", () => {
		const probes: Record<string, boolean> = {};
		for (const requirement of REQUIREMENTS) probes[requirement.signal] = true;
		const result = evaluateStandards(probes, "brand");
		expect(result.aos_standards).toBe(100);
		expect(result.aps_standards).toBe(100);
		expect(result.signature_verified).toBe(true);
	});

	it("weights MUST above SHOULD and MAY", () => {
		const onlyMust: Record<string, boolean> = {};
		for (const requirement of REQUIREMENTS) onlyMust[requirement.signal] = requirement.strength === "MUST";
		const result = evaluateStandards(onlyMust, "brand");
		// AOS applicable weight is 22 with the two brand-type MUSTs worth 6 -> 27.
		expect(result.aos_standards).toBe(27);
		// APS applicable weight is 17 with the four MUSTs worth 12 -> 71.
		expect(result.aps_standards).toBe(71);
	});
});

describe("classifyBusinessType", () => {
	it("treats an exposed API as a product surface", () => {
		expect(classifyBusinessType({ hasOpenApi: true })).toBe("product_api");
		expect(classifyBusinessType({})).toBe("brand");
	});
});
