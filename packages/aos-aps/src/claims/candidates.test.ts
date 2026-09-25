/**
 * Los tests de los candidatos, con el contexto real de Believe.
 *
 * El punto de estos tests es la regla dura del estándar: **no inventar evidencia**. Por eso casi todos
 * comparan contra el texto de Maasy palabra por palabra, y el caso "sin número" verifica que la métrica
 * quede vacía en vez de completarse.
 */
import { describe, expect, it } from "vitest";
import { type ClaimCandidate, proposeClaimCandidates } from "./candidates";

/** El texto real que manda Maasy, tal como está en HALLAZGO-CLAIMS-MAASY.md. */
const CLIENT_RESULTS =
	"Aumento promedio de 35% en tasa de conversión y crecimiento sostenido de 20% en ventas tras instalar el sistema MAAS™…";
const TESTIMONIAL = "Con Believe y la metodología MAAS™ dejamos de gas…";
const SOCIAL_PROOF = "Más de 100 proyectos instalados con la metodología MAAS™";
const REFERENCES = "23 referencias subidas (sin analizar)";

/**
 * El contexto de marca como llega de verdad: `client_results` y `testimonials` **dentro de `dna`**, el
 * resumen de referencias arriba. Es la parte que un parser ingenuo se pierde.
 */
const context = {
	brand_name: "Believe",
	references_summary: REFERENCES,
	dna: {
		business_description: "Believe instala sistemas de preferencia.",
		client_results: CLIENT_RESULTS,
		testimonials: TESTIMONIAL,
		social_proof_count: SOCIAL_PROOF,
	},
};

function bySource(candidates: ClaimCandidate[], sourceField: string): ClaimCandidate[] {
	return candidates.filter((candidate) => candidate.sourceField === sourceField);
}

function firstOf(candidates: ClaimCandidate[], sourceField: string): ClaimCandidate {
	const found = bySource(candidates, sourceField)[0];
	if (found === undefined) throw new Error(`sin candidato para ${sourceField}`);
	return found;
}

describe("proposeClaimCandidates", () => {
	it("encuentra los campos que están dentro de dna, no solo los de arriba", () => {
		const candidates = proposeClaimCandidates(context);
		expect(bySource(candidates, "client_results").length).toBeGreaterThan(0);
		expect(bySource(candidates, "testimonials").length).toBeGreaterThan(0);
		expect(bySource(candidates, "social_proof_count").length).toBeGreaterThan(0);
		expect(bySource(candidates, "references_summary").length).toBeGreaterThan(0);
	});

	it("saca los números reales del ejemplo: 35% y 20%, los dos", () => {
		const candidate = firstOf(proposeClaimCandidates(context), "client_results");
		expect(candidate.suggestedMetric).toContain("35%");
		expect(candidate.suggestedMetric).toContain("20%");
	});

	it("no inventa números: un fragmento sin cifras deja suggestedMetric vacío", () => {
		const candidate = firstOf(proposeClaimCandidates(context), "testimonials");
		expect(candidate.fragment).toBe(TESTIMONIAL);
		expect(candidate.suggestedMetric).toBeUndefined();
		expect(candidate.why).toContain("Sin número no hay métrica");
	});

	it("copia el fragmento literal, sin reescribir ni traducir", () => {
		const candidates = proposeClaimCandidates(context);
		expect(firstOf(candidates, "client_results").fragment).toBe(CLIENT_RESULTS);
		expect(firstOf(candidates, "social_proof_count").fragment).toBe(SOCIAL_PROOF);
	});

	it("marca la redacción propuesta como propuesta, no como afirmación de BeAOS", () => {
		const candidate = firstOf(proposeClaimCandidates(context), "client_results");
		expect(candidate.suggestedStatement?.startsWith("[Propuesta] ")).toBe(true);
		expect(candidate.suggestedStatement).toContain("35%");
	});

	it("detecta las referencias sin analizar y las cuenta como lo que son", () => {
		const candidate = firstOf(proposeClaimCandidates(context), "references_summary");
		expect(candidate.id).toBe("references_summary-unanalyzed");
		expect(candidate.fragment).toBe(REFERENCES);
		expect(candidate.why).toContain("sin analizar");
		expect(candidate.why).toContain("23");
		// El 23 cuenta documentos, no resultados: no se ofrece como métrica de un claim.
		expect(candidate.suggestedMetric).toBeUndefined();
		expect(candidate.suggestedProofHint).toContain("23 referencias");
	});

	it("un references_summary que no habla de documentos sin analizar no dispara ese candidato", () => {
		const candidates = proposeClaimCandidates({
			references_summary: "12 casos de éxito publicados en el sitio",
		});
		expect(bySource(candidates, "references_summary")[0]?.id).not.toBe("references_summary-unanalyzed");
	});

	it("ordena por fuerza de la evidencia: primero los que tienen número", () => {
		const candidates = proposeClaimCandidates(context);
		const withMetric = candidates.filter((candidate) => candidate.suggestedMetric !== undefined);
		const withoutMetric = candidates.filter((candidate) => candidate.suggestedMetric === undefined);
		expect(withMetric.length).toBeGreaterThan(0);
		expect(withoutMetric.length).toBeGreaterThan(0);
		const firstWithout = candidates.findIndex((candidate) => candidate.suggestedMetric === undefined);
		const lastWith = candidates.map((candidate) => candidate.suggestedMetric !== undefined).lastIndexOf(true);
		expect(lastWith).toBeLessThan(firstWithout);
	});

	it("los ids son estables y únicos: el mismo contexto da los mismos ids", () => {
		const first = proposeClaimCandidates(context).map((candidate) => candidate.id);
		const second = proposeClaimCandidates(context).map((candidate) => candidate.id);
		expect(second).toEqual(first);
		expect(new Set(first).size).toBe(first.length);
	});

	it("no duplica el mismo texto si viene arriba y dentro de dna", () => {
		const candidates = proposeClaimCandidates({
			client_results: SOCIAL_PROOF,
			dna: { client_results: SOCIAL_PROOF },
		});
		expect(bySource(candidates, "client_results")).toHaveLength(1);
	});

	it("corta la prosa en fragmentos por los bordes que el texto ya tiene", () => {
		const candidates = proposeClaimCandidates({
			dna: {
				client_results: "- Aumento de 35% en conversión.\n- Crecimiento de 20% en ventas.",
			},
		});
		const fragments = bySource(candidates, "client_results").map((candidate) => candidate.fragment);
		expect(fragments).toEqual(["Aumento de 35% en conversión.", "Crecimiento de 20% en ventas."]);
	});

	it("no lee un número adentro de una palabra ni un decimal como dos cifras", () => {
		const candidates = proposeClaimCandidates({
			dna: { client_results: "El sistema MAAS2 mejoró la conversión en 3.5 veces durante el piloto." },
		});
		// El `2` de `MAAS2` no es una cifra de Maasy y `3.5` es un solo número, no un `3` y un `5`.
		expect(firstOf(candidates, "client_results").suggestedMetric).toBe("3.5");
	});

	it("un contexto que no es objeto no rompe: devuelve vacío", () => {
		expect(proposeClaimCandidates(null)).toEqual([]);
		expect(proposeClaimCandidates("Believe")).toEqual([]);
		expect(proposeClaimCandidates({})).toEqual([]);
	});
});
