/**
 * Validation of a served /.well-known/brand.json against the Claims & Proofs spec.
 *
 * Spec: aos-aps-standard spec/claims-proofs.md.
 * Hard rules enforced here:
 *   - no fabricated evidence: missing data is an explicit marker or empty array,
 *   - confidence is derived from sample size, never self-assigned,
 *   - boundary is mandatory,
 *   - no third-party auditor is claimed unless one exists.
 */

import { confidenceMatches, deriveConfidence, isMarker, isRealString, sampleSize } from "./confidence";
import {
	CLAIM_CATEGORIES,
	CLAIM_ID_PATTERN,
	type Claim,
	CONFIDENTIALITY,
	emptySignals,
	type ParsedBrandProfile,
	type ProfileFinding,
	type ProfileSignals,
	PROOF_ID_PATTERN,
	PROOF_TYPES,
	type Proof,
	VERIFIABLE_BY,
} from "./types";

function asArray<T>(value: unknown): T[] | null {
	return Array.isArray(value) ? (value as T[]) : null;
}

/** Declared: any non-empty string, including an explicit marker. */
function isDeclared(value: unknown): boolean {
	return isRealString(value) || isMarker(value);
}

/**
 * Parses and validates a brand profile. Never throws: an unusable payload returns
 * empty signals plus an error finding, so the audit can report it as a failed requirement.
 */
export function parseBrandProfile(raw: unknown): ParsedBrandProfile {
	const findings: ProfileFinding[] = [];
	const profile = (raw !== null && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
	const claims = asArray<Claim>(profile.claims);
	const proofs = asArray<Proof>(profile.proofs);

	if (claims === null || proofs === null) {
		findings.push({
			level: "error",
			code: "APS-CLAIM-01",
			message: "brand.json must serve claims[] and proofs[] arrays",
		});
		return {
			profile,
			signals: emptySignals(),
			findings,
			claimsWithoutRealBoundary: [],
			unprovenClaims: [],
			unlinkedProofIds: [],
		};
	}

	const proofById = new Map<string, Proof>();
	for (const proof of proofs) {
		const id = typeof proof.proof_id === "string" ? proof.proof_id : "";
		if (PROOF_ID_PATTERN.test(id) === false) {
			findings.push({
				level: "error",
				code: "APS-CLAIM-03",
				message: `proof_id "${id}" must match PRF-[A-Z0-9-]+`,
			});
			continue;
		}
		if (proofById.has(id)) {
			findings.push({ level: "error", code: "APS-CLAIM-03", message: `duplicate proof_id ${id}`, ref: id });
			continue;
		}
		proofById.set(id, proof);
	}

	const claimsWithoutRealBoundary: string[] = [];
	const unprovenClaims: string[] = [];
	const proofIdsReferenced = new Set<string>();
	let boundariesComplete = true;
	let confidenceDerived = true;
	let proofsLinkClaims = true;

	for (const claim of claims) {
		const claimId = typeof claim.claim_id === "string" ? claim.claim_id : "";
		if (CLAIM_ID_PATTERN.test(claimId) === false) {
			findings.push({
				level: "error",
				code: "APS-CLAIM-01",
				message: `claim_id "${claimId}" must match CLM-[A-Z0-9-]+`,
			});
		}
		if (isRealString(claim.statement) === false) {
			findings.push({ level: "error", code: "APS-CLAIM-01", message: "claim.statement is empty", ref: claimId });
		}

		// APS-CLAIM-02 — mandatory boundary. Both fields must be declared; a marker is an
		// explicit emission, not an omission. Only a real value earns boundary coverage.
		const applicable = claim.boundary?.applicable_for;
		const notApplicable = claim.boundary?.not_applicable_for;
		if (isDeclared(applicable) === false) {
			boundariesComplete = false;
			findings.push({
				level: "error",
				code: "APS-CLAIM-02",
				message: "claim.boundary.applicable_for is missing",
				ref: claimId,
			});
		}
		if (isDeclared(notApplicable) === false) {
			boundariesComplete = false;
			findings.push({
				level: "error",
				code: "APS-CLAIM-02",
				message: "claim.boundary.not_applicable_for is missing",
				ref: claimId,
			});
		}
		if (isRealString(applicable) === false || isRealString(notApplicable) === false) {
			claimsWithoutRealBoundary.push(claimId);
		}

		// APS-CLAIM-04 — confidence derived from sample size, never self-assigned.
		const n = sampleSize(claim.metric ?? null);
		const expected = deriveConfidence(n);
		if (confidenceMatches(expected, claim.confidence) === false) {
			confidenceDerived = false;
			findings.push({
				level: "error",
				code: "APS-CLAIM-04",
				message: `claim.confidence must be ${expected === null ? "null" : expected.toFixed(3)} for n=${n ?? "absent"}`,
				ref: claimId,
			});
		}

		if (claim.category !== undefined && CLAIM_CATEGORIES.includes(claim.category as never) === false) {
			findings.push({
				level: "warn",
				code: "APS-CLAIM-01",
				message: `claim.category "${String(claim.category)}" is not in the spec enum`,
				ref: claimId,
			});
		}

		// APS-CLAIM-03 — claims point at proofs, both sides synchronized.
		const linked = asArray<string>(claim.linked_proofs);
		if (linked === null) {
			findings.push({
				level: "error",
				code: "APS-CLAIM-03",
				message: "claim.linked_proofs must be an array ([] is allowed and costs APS)",
				ref: claimId,
			});
		} else if (linked.length === 0) {
			unprovenClaims.push(claimId);
		} else {
			for (const proofId of linked) {
				if (proofById.has(proofId) === false) {
					findings.push({
						level: "error",
						code: "APS-CLAIM-03",
						message: `claim.linked_proofs points at unknown proof ${proofId}`,
						ref: claimId,
					});
					continue;
				}
				proofIdsReferenced.add(proofId);
				const refs = asArray<string>(proofById.get(proofId)?.claim_refs);
				if (refs === null || refs.includes(claimId) === false) {
					proofsLinkClaims = false;
					findings.push({
						level: "error",
						code: "APS-CLAIM-03",
						message: `proof ${proofId}.claim_refs does not link back to ${claimId}`,
						ref: proofId,
					});
				}
			}
		}
	}

	for (const [proofId, proof] of proofById) {
		const verification = proof.verification;
		const verifiableBy = verification?.verifiable_by;
		if (verifiableBy === undefined || VERIFIABLE_BY.includes(verifiableBy as never) === false) {
			proofsLinkClaims = false;
			findings.push({
				level: "error",
				code: "APS-CLAIM-03",
				message: `proof.verification.verifiable_by "${String(verifiableBy)}" is not in the spec enum`,
				ref: proofId,
			});
		}
		if (verification?.external_auditor !== undefined && verification.external_auditor !== null) {
			findings.push({
				level: "warn",
				code: "APS-CLAIM-03",
				message: "external_auditor is set: signed_client is not signed_independent, do not claim an auditor",
				ref: proofId,
			});
		}
		if (proof.type !== undefined && PROOF_TYPES.includes(proof.type as never) === false) {
			findings.push({
				level: "warn",
				code: "APS-CLAIM-01",
				message: `proof.type "${String(proof.type)}" is not in the spec enum`,
				ref: proofId,
			});
		}
		if (proof.confidentiality !== undefined && CONFIDENTIALITY.includes(proof.confidentiality as never) === false) {
			findings.push({
				level: "warn",
				code: "APS-CLAIM-01",
				message: `proof.confidentiality "${String(proof.confidentiality)}" is not in the spec enum`,
				ref: proofId,
			});
		}
		const refs = asArray<string>(proof.claim_refs);
		if (refs === null || refs.length === 0) {
			proofsLinkClaims = false;
			findings.push({
				level: "error",
				code: "APS-CLAIM-03",
				message: "proof.claim_refs must link to at least one claim",
				ref: proofId,
			});
		}
	}

	const unlinkedProofIds = [...proofById.keys()].filter((id) => proofIdsReferenced.has(id) === false);
	for (const proofId of unlinkedProofIds) {
		findings.push({
			level: "warn",
			code: "APS-CLAIM-03",
			message: "proof is not referenced by any claim and does not raise proof coverage",
			ref: proofId,
		});
	}

	const signals: ProfileSignals = {
		brandJsonSpec: true,
		claimBoundaries: claims.length > 0 && boundariesComplete,
		proofsLinkClaims: claims.length > 0 && proofsLinkClaims,
		derivedConfidence: claims.length > 0 && confidenceDerived,
		claimsCount: claims.length,
		proofsCount: proofs.length,
	};

	if (proofs.length === 0 && claims.length > 0) {
		findings.push({
			level: "warn",
			code: "APS-CLAIM-03",
			message: "no proofs served: AOS links proofs, it does not create them",
		});
	}

	return { profile, signals, findings, claimsWithoutRealBoundary, unprovenClaims, unlinkedProofIds };
}

/** Prohibited terms, from agent_guidance.avoid_claims and identity.prohibited_words. */
export function prohibitedTerms(profile: Record<string, unknown>): string[] {
	const terms = new Set<string>();
	const guidance = profile.agent_guidance as { avoid_claims?: unknown } | undefined;
	if (Array.isArray(guidance?.avoid_claims)) {
		for (const entry of guidance.avoid_claims) {
			if (typeof entry !== "string") continue;
			const term = entry.split(/\s*\(usar:/)[0]?.trim() ?? "";
			if (term.length > 0) terms.add(term);
		}
	}
	const identity = profile.identity as { prohibited_words?: unknown } | undefined;
	if (typeof identity?.prohibited_words === "string") {
		for (const entry of identity.prohibited_words.split(",")) {
			const term = entry.trim();
			if (term.length > 0) terms.add(term);
		}
	}
	return [...terms];
}

export function normalizeForMatch(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase();
}

export function findProhibitedTermHits(claims: Claim[], terms: string[]): Array<{ claim_id: string; term: string }> {
	if (terms.length === 0) return [];
	const normalized = terms.map((term) => ({ term, needle: normalizeForMatch(term) }));
	const hits: Array<{ claim_id: string; term: string }> = [];
	for (const claim of claims) {
		if (typeof claim.statement !== "string") continue;
		const statement = normalizeForMatch(claim.statement);
		for (const { term, needle } of normalized) {
			if (statement.includes(needle)) hits.push({ claim_id: String(claim.claim_id ?? ""), term });
		}
	}
	return hits;
}
