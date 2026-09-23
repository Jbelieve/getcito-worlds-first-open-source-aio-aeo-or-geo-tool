/**
 * AOS/APS requirements rubric.
 *
 * Ids and strengths mirror aos-aps-standard/spec.json v0.1.0 so a BeAOS report can be read
 * against the published standard.
 *
 * Local extension: `AOS-API-01` has no id in spec.json; spec/scoring.md lists "Public API /
 * OpenAPI / OAuth / SDK / webhooks" as a required surface for product/API businesses without
 * assigning a requirement id. It is kept here (product_api only) and marked as an extension.
 */

export type BusinessType = "brand" | "product_api";
export type Axis = "AOS" | "APS";
export type Strength = "MUST" | "SHOULD" | "MAY";
export type Status = "pass" | "fail" | "n_a";

export interface RequirementDef {
	id: string;
	axis: Axis;
	strength: Strength;
	title: string;
	applies: BusinessType[];
	signal: string;
	/** True when the id is a BeAOS extension and not part of the published standard. */
	extension?: boolean;
}

export const REQUIREMENTS: RequirementDef[] = [
	{ id: "AOS-DISC-01", axis: "AOS", strength: "SHOULD", title: "llms.txt", applies: ["brand", "product_api"], signal: "llms_txt" },
	{ id: "AOS-DISC-02", axis: "AOS", strength: "MAY", title: "llms-full.txt", applies: ["brand", "product_api"], signal: "llms_full_txt" },
	{ id: "AOS-DISC-03", axis: "AOS", strength: "SHOULD", title: "AGENTS.md", applies: ["brand", "product_api"], signal: "agents_md" },
	{
		id: "AOS-DISC-04",
		axis: "AOS",
		strength: "MUST",
		title: "robots.txt + sitemap",
		applies: ["brand", "product_api"],
		signal: "robots_sitemap",
	},
	{ id: "AOS-CONT-01", axis: "AOS", strength: "SHOULD", title: "JSON-LD identity", applies: ["brand", "product_api"], signal: "jsonld" },
	{
		id: "AOS-CONT-02",
		axis: "AOS",
		strength: "SHOULD",
		title: "Proof objects as structured data",
		applies: ["brand", "product_api"],
		signal: "proof_objects",
	},
	{
		id: "AOS-CONT-03",
		axis: "AOS",
		strength: "MAY",
		title: "Markdown content negotiation",
		applies: ["brand", "product_api"],
		signal: "markdown_negotiation",
	},
	{ id: "AOS-IDEN-01", axis: "AOS", strength: "MUST", title: "A2A Agent Card", applies: ["brand", "product_api"], signal: "agent_card" },
	{
		id: "AOS-IDEN-02",
		axis: "AOS",
		strength: "SHOULD",
		title: "Agent permissions",
		applies: ["brand", "product_api"],
		signal: "agent_permissions",
	},
	{
		id: "AOS-CAPA-01",
		axis: "AOS",
		strength: "SHOULD",
		title: "MCP Server Card",
		applies: ["brand", "product_api"],
		signal: "mcp_server_card",
	},
	{ id: "AOS-CAPA-02", axis: "AOS", strength: "SHOULD", title: "NLWeb /ask endpoint", applies: ["brand", "product_api"], signal: "nlweb_ask" },
	{
		id: "AOS-API-01",
		axis: "AOS",
		strength: "MUST",
		title: "Public API / OpenAPI",
		applies: ["product_api"],
		signal: "openapi",
		extension: true,
	},
	{
		id: "APS-CLAIM-01",
		axis: "APS",
		strength: "MUST",
		title: "brand.json Claims & Proofs",
		applies: ["brand", "product_api"],
		signal: "brand_json_spec",
	},
	{
		id: "APS-CLAIM-02",
		axis: "APS",
		strength: "MUST",
		title: "Mandatory boundary",
		applies: ["brand", "product_api"],
		signal: "claim_boundaries",
	},
	{
		id: "APS-CLAIM-03",
		axis: "APS",
		strength: "MUST",
		title: "Proofs link to claims",
		applies: ["brand", "product_api"],
		signal: "proofs_link_claims",
	},
	{
		id: "APS-CLAIM-04",
		axis: "APS",
		strength: "MUST",
		title: "Derived confidence",
		applies: ["brand", "product_api"],
		signal: "derived_confidence",
	},
	{
		id: "APS-PROV-01",
		axis: "APS",
		strength: "SHOULD",
		title: "Ed25519 signature",
		applies: ["brand", "product_api"],
		signal: "signature_valid",
	},
	{ id: "APS-PROV-02", axis: "APS", strength: "SHOULD", title: "Public key (keys.json)", applies: ["brand", "product_api"], signal: "keys_json" },
	{
		id: "APS-PROV-03",
		axis: "APS",
		strength: "MAY",
		title: "Web Bot Auth",
		applies: ["brand", "product_api"],
		signal: "http_message_signatures",
	},
];

/**
 * Strength-weighted pass ratio per axis. The published scoring.md describes surface weights
 * (0.30 discovery / 0.30 identity / 0.25 capability / 0.15 action); this rubric weights by
 * MUST/SHOULD/MAY instead. Reconciling both is a spec decision, not a silent tweak.
 */
const STRENGTH_WEIGHT: Record<Strength, number> = { MUST: 3, SHOULD: 2, MAY: 1 };

export interface Probes {
	[signal: string]: boolean;
}

export interface RequirementResult {
	id: string;
	axis: Axis;
	strength: Strength;
	title: string;
	status: Status;
	extension?: boolean;
}

export interface StandardsResult {
	business_type: BusinessType;
	requirements: RequirementResult[];
	aos_standards: number;
	aps_standards: number;
	signature_verified: boolean;
}

export function classifyBusinessType(signals: {
	hasOpenApi?: boolean;
	hasPublicApi?: boolean;
	industryIsApiProduct?: boolean;
}): BusinessType {
	if (signals.hasOpenApi || signals.hasPublicApi || signals.industryIsApiProduct) return "product_api";
	return "brand";
}

function axisScore(results: RequirementResult[], axis: Axis): number {
	const applicable = results.filter((r) => r.axis === axis && r.status !== "n_a");
	if (applicable.length === 0) return 0;
	const got = applicable.reduce((sum, r) => sum + (r.status === "pass" ? STRENGTH_WEIGHT[r.strength] : 0), 0);
	const max = applicable.reduce((sum, r) => sum + STRENGTH_WEIGHT[r.strength], 0);
	return Math.round((got / max) * 100);
}

export function evaluateStandards(probes: Probes, businessType: BusinessType): StandardsResult {
	const requirements: RequirementResult[] = REQUIREMENTS.map((def) => {
		const applies = def.applies.includes(businessType);
		const status: Status = applies === false ? "n_a" : probes[def.signal] ? "pass" : "fail";
		const result: RequirementResult = { id: def.id, axis: def.axis, strength: def.strength, title: def.title, status };
		if (def.extension === true) result.extension = true;
		return result;
	});
	return {
		business_type: businessType,
		requirements,
		aos_standards: axisScore(requirements, "AOS"),
		aps_standards: axisScore(requirements, "APS"),
		signature_verified: Boolean(probes.signature_valid),
	};
}
