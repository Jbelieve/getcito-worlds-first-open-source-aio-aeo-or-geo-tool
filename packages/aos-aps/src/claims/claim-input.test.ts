/**
 * Las reglas del alta de una prueba, probadas sin base ni red.
 *
 * Es el contrato que comparten la pantalla de Pruebas, el MCP y lo que venga: si estas reglas se
 * aflojaran, un consumidor podría guardar una prueba que `parseBrandProfile` rechaza, y el `brand.json`
 * firmado por BeAOS saldría con errores que ya sabíamos cómo evitar.
 */
import { describe, expect, it } from "vitest";
import { CLAIM_PROOF_TYPES, ClaimInputError, normalizeClaimInput } from "./claim-input";

/** Un formulario válido y completo. Cada test rompe una cosa. */
function input(overrides: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		claimId: "CLM-MARCA-100-PROYECTOS",
		statement: "Más de 100 proyectos entregados desde 2019.",
		status: "confirmed",
		proofType: "aggregate_metric",
		proofTitle: "Volumen histórico de la marca",
		metric: "100",
		category: "experience",
		boundaryApplicableFor: "Proyectos entregados por la marca.",
		boundaryNotApplicableFor: "Trabajos de terceros.",
		proofSummary: "Más de 100 proyectos entregados.",
		proofClient: null,
		verifiableBy: "public_url",
		confidentiality: "public",
		sourceFragment: "Más de 100 proyectos entregados desde 2019.",
		...overrides,
	};
}

describe("normalizeClaimInput", () => {
	it("acepta una prueba válida, la recorta y no avisa nada", () => {
		const result = normalizeClaimInput(input({ statement: "  Más de 100 proyectos.  ", metric: " 100 " }));
		expect(result.claim.statement).toBe("Más de 100 proyectos.");
		expect(result.claim.metric).toBe("100");
		expect(result.claim.status).toBe("confirmed");
		expect(result.claim.proofType).toBe("aggregate_metric");
		expect(result.claim.verifiableBy).toBe("public_url");
		expect(result.warnings).toEqual([]);
	});

	it("un campo opcional vacío queda en null: vacío y ausente son lo mismo", () => {
		const result = normalizeClaimInput(input({ metric: "", proofSummary: "   ", proofClient: null }));
		expect(result.claim.metric).toBeNull();
		expect(result.claim.proofSummary).toBeNull();
		expect(result.claim.proofClient).toBeNull();
	});

	it("un borrador es válido: el estado no lo rechaza, solo lo deja fuera del bundle", () => {
		const result = normalizeClaimInput(input({ status: "draft" }));
		expect(result.claim.status).toBe("draft");
	});

	it("rechaza un claimId que no cumple el patrón CLM-[A-Z0-9-]+", () => {
		for (const claimId of ["claim-1", "PRF-1", "CLM-", "CLM-ñ", "  "]) {
			expect(() => normalizeClaimInput(input({ claimId })), `debería rechazar "${claimId}"`).toThrow(ClaimInputError);
			expect(() => normalizeClaimInput(input({ claimId }))).toThrow(/CLM-\[A-Z0-9-\]\+/);
		}
	});

	it("rechaza un status fuera del enum y lista los que acepta", () => {
		expect(() => normalizeClaimInput(input({ status: "published" }))).toThrow(/draft, confirmed/);
	});

	it("rechaza un verifiableBy fuera del enum que acepta el validador", () => {
		expect(() => normalizeClaimInput(input({ verifiableBy: "self_reported" }))).toThrow(
			/public_url, third_party_platform, signed_client, internal/,
		);
	});

	it("rechaza un proofType que no está ni en el vocabulario de BeAOS ni en el del estándar", () => {
		expect(() => normalizeClaimInput(input({ proofType: "banana" }))).toThrow(ClaimInputError);
	});

	it("rechaza una categoría fuera del enum del estándar", () => {
		expect(() => normalizeClaimInput(input({ category: "vibes" }))).toThrow(
			/outcome, methodology, experience, scope, performance/,
		);
	});

	it("rechaza una afirmación vacía: sin afirmación no hay prueba", () => {
		expect(() => normalizeClaimInput(input({ statement: "   " }))).toThrow(/"statement" es obligatorio/);
	});

	it("avisa —sin rechazar— cuando la prueba no declara cómo se verifica", () => {
		const result = normalizeClaimInput(input({ verifiableBy: undefined }));
		expect(result.claim.verifiableBy).toBeNull();
		expect(result.warnings.join(" ")).toContain("no verificable");
	});

	it("avisa cuando falta el límite de la prueba, que el estándar exige", () => {
		const result = normalizeClaimInput(input({ boundaryApplicableFor: null, boundaryNotApplicableFor: "" }));
		expect(result.warnings.join(" ")).toContain("APS-CLAIM-02");
		expect(result.warnings.join(" ")).toContain("boundaryApplicableFor y boundaryNotApplicableFor");
	});

	it("acepta los dos vocabularios de proofType y avisa solo por el que el estándar no reconoce", () => {
		// El enum del estándar: el perfil no lo marca.
		for (const proofType of [
			"case_study",
			"testimonial",
			"aggregate_metric",
			"third_party_review",
			"publication",
			"credential",
		]) {
			const standard = normalizeClaimInput(input({ proofType }));
			expect(standard.claim.proofType).toBe(proofType);
			expect(standard.warnings.join(" "), `${proofType} no debería avisar`).not.toContain("APS-CLAIM-01");
		}
		// El vocabulario propio de BeAOS: se guarda igual, y el perfil lo va a marcar.
		const beaos = normalizeClaimInput(input({ proofType: "document" }));
		expect(beaos.claim.proofType).toBe("document");
		expect(beaos.warnings.join(" ")).toContain("APS-CLAIM-01");
	});

	it("la lista de tipos aceptados cubre los dos vocabularios sin repetir", () => {
		expect(new Set(CLAIM_PROOF_TYPES).size).toBe(CLAIM_PROOF_TYPES.length);
		expect(CLAIM_PROOF_TYPES).toContain("document");
		expect(CLAIM_PROOF_TYPES).toContain("aggregate_metric");
	});
});
