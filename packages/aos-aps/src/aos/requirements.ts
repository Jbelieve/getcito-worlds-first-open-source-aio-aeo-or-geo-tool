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
}

export const REQUIREMENTS: RequirementDef[] = [
{ id: "AOS-DISC-01", axis: "AOS", strength: "SHOULD", title: "llms.txt", applies: ["brand", "product_api"], signal: "llms_txt" },
{ id: "AOS-DISC-03", axis: "AOS", strength: "SHOULD", title: "AGENTS.md", applies: ["brand", "product_api"], signal: "agents_md" },
{ id: "AOS-DISC-04", axis: "AOS", strength: "MUST", title: "robots.txt + sitemap", applies: ["brand", "product_api"], signal: "robots_sitemap" },
{ id: "AOS-CONT-01", axis: "AOS", strength: "SHOULD", title: "JSON-LD identity", applies: ["brand", "product_api"], signal: "jsonld" },
{ id: "AOS-IDEN-01", axis: "AOS", strength: "MUST", title: "A2A Agent Card", applies: ["brand", "product_api"], signal: "agent_card" },
{ id: "AOS-IDEN-02", axis: "AOS", strength: "SHOULD", title: "Agent permissions", applies: ["brand", "product_api"], signal: "agent_permissions" },
{ id: "AOS-CAPA-01", axis: "AOS", strength: "SHOULD", title: "MCP Server Card", applies: ["brand", "product_api"], signal: "mcp_server_card" },
{ id: "AOS-API-01", axis: "AOS", strength: "MUST", title: "Public API / OpenAPI", applies: ["product_api"], signal: "openapi" },
{ id: "APS-CLAIM-01", axis: "APS", strength: "MUST", title: "brand.json Claims & Proofs", applies: ["brand", "product_api"], signal: "brand_json" },
{ id: "APS-PROV-02", axis: "APS", strength: "SHOULD", title: "Public key (keys.json)", applies: ["brand", "product_api"], signal: "keys_json" },
{ id: "APS-PROV-01", axis: "APS", strength: "SHOULD", title: "Ed25519 signature verifies", applies: ["brand", "product_api"], signal: "signature_valid" },
];

const STRENGTH_WEIGHT: Record<Strength, number> = { MUST: 3, SHOULD: 2, MAY: 1 };

export interface Probes { [signal: string]: boolean; }

export interface RequirementResult {
id: string;
axis: Axis;
strength: Strength;
title: string;
status: Status;
}

export interface StandardsResult {
business_type: BusinessType;
requirements: RequirementResult[];
aos_standards: number;
aps_standards: number;
signature_verified: boolean;
}

export function classifyBusinessType(signals: { hasOpenApi?: boolean; hasPublicApi?: boolean; industryIsApiProduct?: boolean }): BusinessType {
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
return { id: def.id, axis: def.axis, strength: def.strength, title: def.title, status };
});
return {
business_type: businessType,
requirements,
aos_standards: axisScore(requirements, "AOS"),
aps_standards: axisScore(requirements, "APS"),
signature_verified: Boolean(probes.signature_valid),
};
}
