import { describe, expect, it } from "vitest";
import { deriveConfidence } from "./confidence";
import { parseBrandProfile } from "./profile";
import { APS_WEIGHTS, computeApsScore, scoreBrandProfile } from "./score";
import type { Claim, Proof } from "./types";

/**
 * Compact fixture with the same arithmetic as the standard's reference profile
 * (aos-aps-standard/examples/believe.brand.json, which declares aps: 94):
 * every claim has a real boundary and one linked proof, proofs are signed_client/public,
 * and the whole profile is Ed25519-signed.
 */
function claim(id: string, proofId: string, overrides: Partial<Claim> = {}): Claim {
	return {
		claim_id: id,
		statement: `Resultado verificable ${id} sobre una operacion real.`,
		category: "outcome",
		metric: { name: "sales_lift", value: "+30%", unit: "percent_change" },
		boundary: {
			applicable_for: "Operaciones con volumen estable y datos medibles.",
			not_applicable_for: "Marcas sin datos operativos que medir.",
		},
		linked_proofs: [proofId],
		confidence: null,
		...overrides,
	};
}

function proof(id: string, claimId: string, overrides: Partial<Proof> = {}): Proof {
	return {
		proof_id: id,
		type: "case_study",
		title: `Caso ${id}`,
		claim_refs: [claimId],
		evidence: { summary: "Evidencia auditada.", client: "Cliente" },
		verification: {
			verifiable_by: "signed_client",
			source_uri: "https://example.com/casos",
			date_verified: null,
			external_auditor: null,
		},
		confidentiality: "public",
		signature: {
			algorithm: "Ed25519",
			value: "sig",
			signer_role: "signed_provenance",
			signed_at: "2026-07-11T00:00:00Z",
		},
		...overrides,
	};
}

function profile(claims: Claim[], proofs: Proof[]) {
	return {
		$schema: "https://maasy.ai/schema/brand-profile/v1.json",
		version: 1,
		claims_proofs_version: "claims-proofs/v1",
		brand: { name: "Believe", website_url: "https://believe-global.com" },
		agent_guidance: { avoid_claims: ["estrategia (usar: sistema)", "solucion integral"] },
		claims,
		proofs,
	};
}

const reference = profile(
	[claim("CLM-R01", "PRF-R01"), claim("CLM-R02", "PRF-R02")],
	[proof("PRF-R01", "CLM-R01"), proof("PRF-R02", "CLM-R02")],
);

describe("computeApsScore", () => {
	it("reproduces the standard's reference arithmetic", () => {
		const unsigned = scoreBrandProfile(reference);
		expect(unsigned.proof_coverage).toBe(1);
		expect(unsigned.boundary_coverage).toBe(1);
		expect(unsigned.smoke_penalty).toBe(0);
		expect(unsigned.evidence_strength).toBe(0.6);
		// 100 * (0.35 + 0.25 + 0.30*0.6 + 0.10) = 88
		expect(unsigned.aps).toBe(88);
		expect(unsigned.signed_provenance_applied).toBe(false);

		const signed = scoreBrandProfile(reference, { signedProvenanceVerified: true });
		expect(signed.evidence_strength).toBe(0.8);
		// 100 * (0.35 + 0.25 + 0.30*0.8 + 0.10) = 94
		expect(signed.aps).toBe(94);
		expect(signed.signed_provenance_applied).toBe(true);

		expect(APS_WEIGHTS).toEqual({ proof_coverage: 0.35, boundary_coverage: 0.25, evidence_strength: 0.3, smoke: 0.1 });
	});

	it("never promotes a public_url proof above its own weight", () => {
		const publicProof = profile(
			[claim("CLM-R01", "PRF-R01")],
			[proof("PRF-R01", "CLM-R01", { verification: { verifiable_by: "public_url" } })],
		);
		expect(scoreBrandProfile(publicProof, { signedProvenanceVerified: true }).evidence_strength).toBe(1);
	});

	it("does not score an empty profile as perfect", () => {
		const breakdown = scoreBrandProfile(profile([], []));
		expect(breakdown.aps).toBeNull();
		expect(breakdown.findings.some((finding) => finding.code === "APS-CLAIM-01")).toBe(true);
	});

	it("charges for unproven claims and missing boundaries", () => {
		const unproven = profile([claim("CLM-R01", "PRF-R01", { linked_proofs: [] })], [proof("PRF-R01", "CLM-R01")]);
		const breakdown = scoreBrandProfile(unproven);
		expect(breakdown.proof_coverage).toBe(0);
		expect(breakdown.unproven_claims).toBe(1);

		const boundaryless = profile(
			[claim("CLM-R01", "PRF-R01", { boundary: { applicable_for: "Solo con datos." } })],
			[proof("PRF-R01", "CLM-R01")],
		);
		const parsed = parseBrandProfile(boundaryless);
		expect(parsed.signals.claimBoundaries).toBe(false);
		expect(computeApsScore(parsed).boundary_coverage).toBe(0);
	});

	it("treats a marker not_applicable_for as explicit but not real", () => {
		const marked = profile(
			[
				claim("CLM-R01", "PRF-R01", {
					boundary: { applicable_for: "Casos con datos.", not_applicable_for: "⚠ CONFIRMAR" },
				}),
			],
			[proof("PRF-R01", "CLM-R01")],
		);
		const parsed = parseBrandProfile(marked);
		// The boundary is declared, so the requirement passes...
		expect(parsed.signals.claimBoundaries).toBe(true);
		// ...but it earns no boundary coverage.
		expect(computeApsScore(parsed).boundary_coverage).toBe(0);
	});

	it("subtracts prohibited-term hits from the smoke component", () => {
		const smoking = profile(
			[
				claim("CLM-R01", "PRF-R01", { statement: "Nuestra estrategia integral produjo el resultado." }),
				claim("CLM-R02", "PRF-R02"),
			],
			[proof("PRF-R01", "CLM-R01"), proof("PRF-R02", "CLM-R02")],
		);
		const breakdown = scoreBrandProfile(smoking, { signedProvenanceVerified: true });
		expect(breakdown.smoke_penalty).toBe(0.5);
		expect(breakdown.smoke_hits).toEqual([{ claim_id: "CLM-R01", term: "estrategia" }]);
		// 100 * (0.35 + 0.25 + 0.24 + 0.10*0.5) = 89
		expect(breakdown.aps).toBe(89);
	});

	it("weights evidence by confidentiality and unknown verifiers", () => {
		const nda = profile([claim("CLM-R01", "PRF-R01")], [proof("PRF-R01", "CLM-R01", { confidentiality: "nda" })]);
		expect(scoreBrandProfile(nda).evidence_strength).toBe(0.18);

		const unknown = profile(
			[claim("CLM-R01", "PRF-R01")],
			[proof("PRF-R01", "CLM-R01", { verification: { verifiable_by: "trust_me" } })],
		);
		const parsed = parseBrandProfile(unknown);
		expect(parsed.signals.proofsLinkClaims).toBe(false);
		expect(computeApsScore(parsed).evidence_strength).toBe(0.2);
	});
});

describe("parseBrandProfile", () => {
	it("rejects a payload without claims[] and proofs[] arrays", () => {
		const parsed = parseBrandProfile({ brand: { name: "Believe" } });
		expect(parsed.signals.brandJsonSpec).toBe(false);
		expect(parsed.findings[0]?.code).toBe("APS-CLAIM-01");

		expect(parseBrandProfile(null).signals.brandJsonSpec).toBe(false);
		expect(parseBrandProfile("nope").signals.brandJsonSpec).toBe(false);
	});

	it("accepts the reference-style profile", () => {
		const parsed = parseBrandProfile(reference);
		expect(parsed.signals).toMatchObject({
			brandJsonSpec: true,
			claimBoundaries: true,
			proofsLinkClaims: true,
			derivedConfidence: true,
			claimsCount: 2,
			proofsCount: 2,
		});
		expect(parsed.findings).toEqual([]);
	});

	it("requires both sides of the claim/proof link", () => {
		const oneSided = profile([claim("CLM-R01", "PRF-R01")], [proof("PRF-R01", "CLM-OTHER")]);
		const parsed = parseBrandProfile(oneSided);
		expect(parsed.signals.proofsLinkClaims).toBe(false);
		expect(parsed.findings.some((finding) => finding.message.includes("does not link back"))).toBe(true);
	});

	it("flags unknown proof references and orphan proofs", () => {
		const dangling = profile([claim("CLM-R01", "PRF-MISSING")], [proof("PRF-R01", "CLM-R01")]);
		const parsed = parseBrandProfile(dangling);
		expect(parsed.unlinkedProofIds).toEqual(["PRF-R01"]);
		expect(parsed.findings.some((finding) => finding.message.includes("unknown proof PRF-MISSING"))).toBe(true);
	});

	it("enforces derived confidence instead of self-assigned values", () => {
		const selfAssigned = profile(
			[claim("CLM-R01", "PRF-R01", { metric: { n: 1 }, confidence: 0.9 })],
			[proof("PRF-R01", "CLM-R01")],
		);
		const parsed = parseBrandProfile(selfAssigned);
		expect(parsed.signals.derivedConfidence).toBe(false);
		expect(parsed.findings.some((finding) => finding.code === "APS-CLAIM-04")).toBe(true);

		const derived = profile(
			[claim("CLM-R01", "PRF-R01", { metric: { n: 100 }, confidence: 0.9 })],
			[proof("PRF-R01", "CLM-R01")],
		);
		expect(parseBrandProfile(derived).signals.derivedConfidence).toBe(true);
	});

	it("validates ids against the spec patterns", () => {
		const badIds = profile([claim("CLAIM-1", "PRF-R01")], [proof("PROOF-1", "CLAIM-1")]);
		const parsed = parseBrandProfile(badIds);
		const messages = parsed.findings.map((finding) => finding.message).join(" | ");
		expect(messages).toContain("claim_id");
		expect(messages).toContain("proof_id");
	});
});

describe("deriveConfidence", () => {
	it("returns null below two samples and clamps between 0.5 and 0.95", () => {
		expect(deriveConfidence(null)).toBeNull();
		expect(deriveConfidence(undefined)).toBeNull();
		expect(deriveConfidence(0)).toBeNull();
		expect(deriveConfidence(1)).toBeNull();
		expect(deriveConfidence(2)).toBe(0.5);
		expect(deriveConfidence(4)).toBe(0.5);
		expect(deriveConfidence(25)).toBe(0.8);
		expect(deriveConfidence(100)).toBe(0.9);
		expect(deriveConfidence(100000)).toBe(0.95);
	});
});
