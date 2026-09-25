/**
 * Los tests del mapeo: de las filas confirmadas al `claims[]` / `proofs[]` que el generador firma.
 *
 * Acá vive la regla que más caro sale si se rompe: **el borrador no entra al bundle**. Un borrador que se
 * publica es trabajo en curso presentado como declaración firmada.
 */
import { describe, expect, it } from "vitest";
import { generateAgentAssets } from "../assets/generate";
import type { AgentBrandClaim } from "../db/schema";
import {
	claimIdFromCandidateId,
	claimsFromRows,
	dnaCarriesClaims,
	proofIdForClaim,
	resolveBundleClaims,
} from "./mapping";

function row(overrides: Partial<AgentBrandClaim> = {}): AgentBrandClaim {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		brandId: "believe",
		entityId: "00000000-0000-4000-8000-0000000000aa",
		claimId: "CLM-BE-35-CONVERSION",
		statement: "Aumento promedio de 35% en tasa de conversión tras instalar el sistema MAAS™.",
		metric: "35%",
		category: "outcome",
		boundaryApplicableFor: "Clientes con el sistema instalado y medición previa.",
		boundaryNotApplicableFor: "Cuentas sin línea base medida.",
		confidence: "alta",
		proofType: "case_study",
		proofTitle: "Caso Believe · conversión",
		proofSummary: "Reporte de resultados del programa de instalación.",
		proofClient: "Believe",
		verifiableBy: "signed_client",
		confidentiality: "anonymized",
		sourceFragment: "Aumento promedio de 35% en tasa de conversión…",
		status: "confirmed",
		createdAt: new Date("2026-09-25T00:00:00.000Z"),
		updatedAt: new Date("2026-09-25T00:00:00.000Z"),
		...overrides,
	};
}

describe("claimsFromRows", () => {
	it("mapea la fila a los nombres de campo exactos del estándar", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		expect(claims).toHaveLength(1);
		expect(proofs).toHaveLength(1);

		const claim = claims[0];
		expect(claim?.claim_id).toBe("CLM-BE-35-CONVERSION");
		expect(claim?.statement).toBe("Aumento promedio de 35% en tasa de conversión tras instalar el sistema MAAS™.");
		expect(claim?.category).toBe("outcome");
		expect(claim?.metric).toEqual({ value: "35%" });
		expect(claim?.boundary).toEqual({
			applicable_for: "Clientes con el sistema instalado y medición previa.",
			not_applicable_for: "Cuentas sin línea base medida.",
		});
		expect(claim?.linked_proofs).toEqual(["PRF-CLM-BE-35-CONVERSION"]);

		const proof = proofs[0];
		expect(proof?.proof_id).toBe("PRF-CLM-BE-35-CONVERSION");
		expect(proof?.type).toBe("case_study");
		expect(proof?.title).toBe("Caso Believe · conversión");
		expect(proof?.claim_refs).toEqual(["CLM-BE-35-CONVERSION"]);
		expect(proof?.evidence).toEqual({
			summary: "Reporte de resultados del programa de instalación.",
			client: "Believe",
			source_fragment: "Aumento promedio de 35% en tasa de conversión…",
		});
		expect(proof?.verification).toEqual({ verifiable_by: "signed_client" });
		expect(proof?.confidentiality).toBe("anonymized");
	});

	it("los dos lados del vínculo se apuntan mutuamente", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		const claimId = claims[0]?.claim_id;
		const proofId = proofs[0]?.proof_id;
		expect(claims[0]?.linked_proofs).toContain(proofId);
		expect(proofs[0]?.claim_refs).toContain(claimId);
	});

	it("el claim viaja con su prueba adentro, además del proofs[] de arriba", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		const nested = (claims[0] as { proofs?: unknown[] } | undefined)?.proofs ?? [];
		expect(nested).toHaveLength(1);
		expect(nested[0]).toEqual(proofs[0]);
	});

	it("no emite la confianza: el estándar la deriva del tamaño de muestra", () => {
		// La fila tiene `confidence: "alta"`, pero `metric` no declara `n`, así que la confianza derivada
		// es null y una asignada a mano sería un dato inventado (APS-CLAIM-04).
		const { claims } = claimsFromRows([row({ confidence: "0.9" })]);
		expect(claims[0]?.confidence).toBeUndefined();
	});

	it("sin métrica no inventa un valor, y sin borde no inventa un borde", () => {
		const { claims } = claimsFromRows([
			row({ metric: null, boundaryApplicableFor: null, boundaryNotApplicableFor: null }),
		]);
		expect(claims[0]?.metric).toBeUndefined();
		expect(claims[0]?.boundary).toBeUndefined();
	});

	it("un borrador no entra, y mezclado con confirmadas solo entran las confirmadas", () => {
		const drafts = claimsFromRows([row({ status: "draft" })]);
		expect(drafts.claims).toHaveLength(0);
		expect(drafts.proofs).toHaveLength(0);

		const mixed = claimsFromRows([
			row({ claimId: "CLM-A", status: "confirmed" }),
			row({ claimId: "CLM-B", status: "draft" }),
			row({ claimId: "CLM-C", status: "confirmed" }),
		]);
		expect(mixed.claims.map((claim) => claim.claim_id)).toEqual(["CLM-A", "CLM-C"]);
		expect(mixed.proofs).toHaveLength(2);
	});

	it("una fila sin id o sin afirmación no se emite a medias", () => {
		expect(claimsFromRows([row({ claimId: "   " })]).claims).toHaveLength(0);
		expect(claimsFromRows([row({ statement: "" })]).claims).toHaveLength(0);
	});

	it("deriva ids con la forma que el estándar exige", () => {
		expect(proofIdForClaim("be-35-conversion")).toBe("PRF-BE-35-CONVERSION");
		expect(proofIdForClaim("CLM-BE-35")).toBe("PRF-CLM-BE-35");
		// Un id sin letras usables cae a un hash estable, no a un proof_id vacío.
		const hashed = proofIdForClaim("···");
		expect(hashed.startsWith("PRF-CLAIM-")).toBe(true);
		expect(proofIdForClaim("···")).toBe(hashed);

		expect(claimIdFromCandidateId("client_results-0")).toBe("CLM-CLIENT-RESULTS-0");
	});
});

describe("resolveBundleClaims", () => {
	it("si el DNA ya trae claims, se usan esos y no se sustituyen", () => {
		const dnaClaims = [{ claim_id: "CLM-DEL-DNA", statement: "La marca lo declara." }];
		const resolved = resolveBundleClaims({ dna: { claims: dnaClaims, proofs: [] }, saved: [row()] });
		expect(resolved.claims).toEqual(dnaClaims);
		expect(dnaCarriesClaims({ claims: dnaClaims })).toBe(true);
	});

	it("un dna.claims vacío no cuenta como claims propios: se usan las confirmadas", () => {
		const resolved = resolveBundleClaims({ dna: { claims: [], proofs: [] }, saved: [row()] });
		expect(resolved.claims).toHaveLength(1);
		expect(dnaCarriesClaims({ claims: [] })).toBe(false);
	});

	it("sin claims en el DNA se usan solo las confirmadas de BeAOS", () => {
		const resolved = resolveBundleClaims({
			dna: { client_results: "35%" },
			saved: [row(), row({ claimId: "CLM-X", status: "draft" })],
		});
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-BE-35-CONVERSION"]);
	});
});

describe("el bundle declara lo que hay, ni más ni menos", () => {
	function brandJsonClaims(rows: AgentBrandClaim[]): number {
		const dna = { business_description: "Believe instala sistemas de preferencia." };
		const resolved = resolveBundleClaims({ dna, saved: rows });
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna: { ...dna, ...resolved },
		});
		const brand = assets.find((asset) => asset.path === "/.well-known/brand.json");
		const parsed = JSON.parse(brand?.content ?? "{}") as { claims?: unknown[]; proofs?: unknown[] };
		return parsed.claims?.length ?? 0;
	}

	it("declara N claims cuando hay N confirmadas", () => {
		expect(brandJsonClaims([row({ claimId: "CLM-A" }), row({ claimId: "CLM-B" })])).toBe(2);
	});

	it("declara 0 cuando todas son borradores", () => {
		expect(brandJsonClaims([row({ claimId: "CLM-A", status: "draft" })])).toBe(0);
	});

	it("con el DNA real de Maasy (sin claims) y una confirmada, el bundle deja de estar vacío", () => {
		expect(brandJsonClaims([row()])).toBe(1);
	});
});
