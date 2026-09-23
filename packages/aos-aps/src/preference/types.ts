/**
 * Types for the AOS/APS Claims & Proofs layer.
 * Source of truth: aos-aps-standard spec/claims-proofs.md and spec/scoring.md.
 */

export type VerifiableBy = "public_url" | "third_party_platform" | "signed_client" | "internal";
export type Confidentiality = "public" | "anonymized" | "nda";
export type ClaimCategory = "outcome" | "methodology" | "experience" | "scope" | "performance";
export type ProofType =
	| "case_study"
	| "testimonial"
	| "aggregate_metric"
	| "third_party_review"
	| "publication"
	| "credential";

export const CLAIM_CATEGORIES: ClaimCategory[] = ["outcome", "methodology", "experience", "scope", "performance"];
export const PROOF_TYPES: ProofType[] = [
	"case_study",
	"testimonial",
	"aggregate_metric",
	"third_party_review",
	"publication",
	"credential",
];
export const VERIFIABLE_BY: VerifiableBy[] = ["public_url", "third_party_platform", "signed_client", "internal"];
export const CONFIDENTIALITY: Confidentiality[] = ["public", "anonymized", "nda"];

export const CLAIM_ID_PATTERN = /^CLM-[A-Z0-9-]+$/;
export const PROOF_ID_PATTERN = /^PRF-[A-Z0-9-]+$/;

export interface ClaimMetric {
	name?: string;
	value?: string;
	baseline?: string;
	optimized?: string;
	window?: string;
	n?: number | null;
	unit?: string;
	[key: string]: unknown;
}

export interface ClaimBoundary {
	applicable_for?: string;
	not_applicable_for?: string;
	[key: string]: unknown;
}

export interface Claim {
	claim_id?: string;
	statement?: string;
	category?: string;
	metric?: ClaimMetric | null;
	boundary?: ClaimBoundary | null;
	linked_proofs?: string[];
	confidence?: number | null;
	[key: string]: unknown;
}

export interface ProofVerification {
	verifiable_by?: string;
	source_uri?: string | null;
	date_verified?: string | null;
	external_auditor?: string | null;
	[key: string]: unknown;
}

export interface ProofSignature {
	algorithm?: string;
	value?: string;
	signer_role?: string;
	signed_at?: string;
	[key: string]: unknown;
}

export interface Proof {
	proof_id?: string;
	type?: string;
	title?: string;
	claim_refs?: string[];
	evidence?: { summary?: string; metric?: unknown; client?: string; [key: string]: unknown };
	verification?: ProofVerification;
	confidentiality?: string;
	signature?: ProofSignature;
	key_ref?: { public_key_id?: string; keys_uri?: string; [key: string]: unknown };
	[key: string]: unknown;
}

export interface BrandProfile {
	$schema?: string;
	version?: number;
	claims_proofs_version?: string;
	brand?: { name?: string; website_url?: string; industry?: string; updated_at?: string; [key: string]: unknown };
	identity?: Record<string, unknown>;
	agent_guidance?: { avoid_claims?: string[]; [key: string]: unknown };
	claims?: Claim[];
	proofs?: Proof[];
	scores?: Record<string, unknown>;
	[key: string]: unknown;
}

export type FindingLevel = "error" | "warn";

export interface ProfileFinding {
	level: FindingLevel;
	/** Requirement id when the finding maps to one, e.g. APS-CLAIM-02. */
	code: string;
	message: string;
	/** claim_id or proof_id the finding refers to. */
	ref?: string;
}

/** Structural signals consumed by the AOS/APS requirements rubric. */
export interface ProfileSignals {
	/** Parsed object with array-typed claims[] and proofs[]. */
	brandJsonSpec: boolean;
	/** Every claim declares applicable_for and not_applicable_for. */
	claimBoundaries: boolean;
	/** Every proof declares verifiable_by and links claims, both sides synchronized. */
	proofsLinkClaims: boolean;
	/** Every claim confidence matches the value derived from metric.n. */
	derivedConfidence: boolean;
	claimsCount: number;
	proofsCount: number;
}

export interface ParsedBrandProfile {
	profile: BrandProfile;
	signals: ProfileSignals;
	findings: ProfileFinding[];
	/** Claims without a real (non-marker) not_applicable_for. */
	claimsWithoutRealBoundary: string[];
	/** Claim ids with an empty linked_proofs array. */
	unprovenClaims: string[];
	/** Proof ids referenced by no claim. */
	unlinkedProofIds: string[];
}

export interface ApsBreakdown {
	aps: number | null;
	scoring_version: string;
	proof_coverage: number;
	boundary_coverage: number;
	evidence_strength: number;
	smoke_penalty: number;
	claims: number;
	proofs: number;
	unproven_claims: number;
	claims_without_boundary: number;
	unlinked_proofs: number;
	/** Prohibited-term hits found in claim statements. */
	smoke_hits: Array<{ claim_id: string; term: string }>;
	signed_provenance_applied: boolean;
	weights: { proof_coverage: number; boundary_coverage: number; evidence_strength: number; smoke: number };
	findings: ProfileFinding[];
}

export interface ApsScoreOptions {
	/** The whole brand.json verified against the published Ed25519 key. */
	signedProvenanceVerified?: boolean;
}

const EMPTY_SIGNALS: ProfileSignals = {
	brandJsonSpec: false,
	claimBoundaries: false,
	proofsLinkClaims: false,
	derivedConfidence: false,
	claimsCount: 0,
	proofsCount: 0,
};

export function emptySignals(): ProfileSignals {
	return { ...EMPTY_SIGNALS };
}
