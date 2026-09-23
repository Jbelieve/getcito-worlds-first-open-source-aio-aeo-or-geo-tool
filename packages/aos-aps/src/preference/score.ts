/**
 * The Agent Preference Score. Spec: aos-aps-standard spec/scoring.md
 *
 *   proof_coverage    = claims_with_at_least_one_proof / total_claims
 *   boundary_coverage = claims_with_a_real_not_applicable_for / total_claims
 *   evidence_strength = mean over proofs of ( w_verifiable_by * w_confidentiality )
 *   smoke_penalty     = fraction of statements that graze the brand's prohibited terms
 *
 *   APS = 100 * ( 0.35*proof_coverage + 0.25*boundary_coverage + 0.30*evidence_strength + 0.10*(1 - smoke_penalty) )
 *
 * A score without a breakdown is a badge, not a diagnosis: every run returns its components.
 */

import { isMarker, isRealString } from "./confidence";
import { findProhibitedTermHits, parseBrandProfile, prohibitedTerms } from "./profile";
import {
	type ApsBreakdown,
	type ApsScoreOptions,
	type Claim,
	type Confidentiality,
	type ParsedBrandProfile,
	type Proof,
	type VerifiableBy,
	VERIFIABLE_BY,
} from "./types";

/**
 * Version of the scoring algorithm that produced a run. Persisted with every result so a
 * changed formula creates a new comparable series instead of silently mixing history.
 */
export const SCORING_VERSION = "aos-aps/v0.1.0";

export const APS_WEIGHTS = {
	proof_coverage: 0.35,
	boundary_coverage: 0.25,
	evidence_strength: 0.3,
	smoke: 0.1,
} as const;

export const VERIFIABLE_BY_WEIGHT: Record<VerifiableBy, number> = {
	public_url: 1,
	third_party_platform: 1,
	signed_client: 0.6,
	internal: 0.2,
};

/** Rewarded when the whole brand.json is Ed25519-signed and served with a resolvable public key. */
export const SIGNED_PROVENANCE_WEIGHT = 0.8;

export const CONFIDENTIALITY_WEIGHT: Record<Confidentiality, number> = {
	public: 1,
	anonymized: 0.5,
	nda: 0.3,
};

function baseWeight(proof: Proof): number {
	const raw = proof.verification?.verifiable_by;
	if (typeof raw === "string" && VERIFIABLE_BY.includes(raw as VerifiableBy)) {
		return VERIFIABLE_BY_WEIGHT[raw as VerifiableBy];
	}
	// Unknown or missing verifiable_by: only the brand itself backs the proof.
	return VERIFIABLE_BY_WEIGHT.internal;
}

function confidentialityWeight(proof: Proof): number {
	const raw = proof.confidentiality;
	if (typeof raw === "string" && raw in CONFIDENTIALITY_WEIGHT) {
		return CONFIDENTIALITY_WEIGHT[raw as Confidentiality];
	}
	return CONFIDENTIALITY_WEIGHT.public;
}

function round(value: number, digits = 4): number {
	const factor = 10 ** digits;
	return Math.round(value * factor) / factor;
}

/**
 * Computes APS from a validated profile. Returns aps = null when there are no claims:
 * 0/0 coverage is not a perfect score, it is an unmeasured one.
 */
export function computeApsScore(parsed: ParsedBrandProfile, options: ApsScoreOptions = {}): ApsBreakdown {
	const profile = parsed.profile as Record<string, unknown>;
	const claims = Array.isArray(profile.claims) ? (profile.claims as Claim[]) : [];
	const proofs = Array.isArray(profile.proofs) ? (profile.proofs as Proof[]) : [];

	const proofIds = new Set(proofs.map((proof) => String(proof.proof_id ?? "")).filter((id) => id.length > 0));

	let claimsWithProof = 0;
	let claimsWithBoundary = 0;
	for (const claim of claims) {
		const linked = Array.isArray(claim.linked_proofs) ? claim.linked_proofs : [];
		if (linked.some((id) => proofIds.has(id))) claimsWithProof += 1;

		const applicable = claim.boundary?.applicable_for;
		const notApplicable = claim.boundary?.not_applicable_for;
		const realBoth =
			isRealString(applicable) &&
			isMarker(applicable) === false &&
			isRealString(notApplicable) &&
			isMarker(notApplicable) === false;
		if (realBoth) claimsWithBoundary += 1;
	}

	const signedProvenance = options.signedProvenanceVerified === true;
	let strengthSum = 0;
	for (const proof of proofs) {
		const base = signedProvenance ? Math.max(baseWeight(proof), SIGNED_PROVENANCE_WEIGHT) : baseWeight(proof);
		strengthSum += base * confidentialityWeight(proof);
	}

	const total = claims.length;
	const proofCoverage = total === 0 ? 0 : claimsWithProof / total;
	const boundaryCoverage = total === 0 ? 0 : claimsWithBoundary / total;
	const evidenceStrength = proofs.length === 0 ? 0 : strengthSum / proofs.length;

	const smokeHits = findProhibitedTermHits(claims, prohibitedTerms(profile));
	const smokePenalty = total === 0 ? 0 : smokeHits.length / total;

	const aps =
		total === 0
			? null
			: Math.round(
					100 *
						(APS_WEIGHTS.proof_coverage * proofCoverage +
							APS_WEIGHTS.boundary_coverage * boundaryCoverage +
							APS_WEIGHTS.evidence_strength * evidenceStrength +
							APS_WEIGHTS.smoke * (1 - smokePenalty)),
				);

	const findings = [...parsed.findings];
	if (total === 0) {
		findings.push({
			level: "error",
			code: "APS-CLAIM-01",
			message: "no claims served: APS cannot be computed from an empty profile",
		});
	}

	return {
		aps,
		scoring_version: SCORING_VERSION,
		proof_coverage: round(proofCoverage),
		boundary_coverage: round(boundaryCoverage),
		evidence_strength: round(evidenceStrength),
		smoke_penalty: round(smokePenalty),
		claims: total,
		proofs: proofs.length,
		unproven_claims: total - claimsWithProof,
		claims_without_boundary: total - claimsWithBoundary,
		unlinked_proofs: parsed.unlinkedProofIds.length,
		smoke_hits: smokeHits,
		signed_provenance_applied: signedProvenance,
		weights: APS_WEIGHTS,
		findings,
	};
}

/** Convenience: validate and score a raw parsed brand.json payload. */
export function scoreBrandProfile(raw: unknown, options: ApsScoreOptions = {}): ApsBreakdown {
	return computeApsScore(parseBrandProfile(raw), options);
}
