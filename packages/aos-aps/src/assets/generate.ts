import { buildKeysJson, signDetached } from "../provenance";

export interface GeneratedAsset {
path: string;
type: string;
content: string;
}

export interface AgentAssetInput {
name: string;
websiteUrl?: string;
industry?: string;
brief?: string;
dna?: Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function descriptionFrom(input: AgentAssetInput): string | undefined {
const dna = input.dna ?? {};
return (
asString(dna.business_description) ??
asString(dna.strategic_brief) ??
asString(dna.differentiator) ??
asString(input.brief)
);
}

function brandJson(input: AgentAssetInput): string {
const description = descriptionFrom(input);
const dna = input.dna ?? {};
const profile = {
$schema: "https://maasy.ai/schema/brand-profile/v1.json",
version: 1,
brand: {
name: input.name,
website_url: input.websiteUrl,
industry: input.industry,
updated_at: new Date().toISOString(),
},
identity: {
positioning: asString(dna.strategic_brief) ?? description,
business_description: description,
differentiator: asString(dna.differentiator),
main_result: asString(dna.main_result),
voice_tone: dna.tone_tags ?? dna.tone,
approved_ctas: asString(dna.approved_ctas),
prohibited_words: asString(dna.prohibited_words),
},
claims: [],
proofs: [],
boundaries: {},
};
return JSON.stringify(profile, null, 2);
}

function llmsTxt(input: AgentAssetInput): string {
const description = descriptionFrom(input) ?? "Marca monitoreada por BeAOS.";
const website = input.websiteUrl ?? "";
return [
`# ${input.name}`,
"",
`> ${description}`,
"",
"## Sitio",
website.length > 0 ? `- [${input.name}](${website})` : "- Sitio oficial",
"",
"## Recursos",
"- [Brand Profile](/.well-known/brand.json)",
"- [Agent Card](/.well-known/agent-card.json)",
"- [Agent Permissions](/.well-known/agent-permissions.json)",
].join("\\n");
}

export function generateAgentAssets(input: AgentAssetInput): GeneratedAsset[] {
const description = descriptionFrom(input) ?? "";
const assets: GeneratedAsset[] = [
{ path: "/llms.txt", type: "text/markdown", content: llmsTxt(input) },
{ path: "/AGENTS.md", type: "text/markdown", content: `# ${input.name}\\n\\n${description}\\n` },
{
path: "/.well-known/agent-card.json",
type: "application/json",
content: JSON.stringify({
name: input.name,
description,
url: input.websiteUrl,
version: "1.0.0",
protocolVersion: "1.0",
skills: [],
capabilities: {},
defaultInputModes: ["text/plain"],
defaultOutputModes: ["text/plain"],
}, null, 2),
},
{
path: "/.well-known/agent-permissions.json",
type: "application/json",
content: JSON.stringify({ permissions: [], boundaries: {} }, null, 2),
},
{ path: "/.well-known/brand.json", type: "application/json", content: brandJson(input) },
];

const brandAsset = assets[assets.length - 1];
const brandBody = brandAsset === undefined ? "" : brandAsset.content;
const signature = signDetached(brandBody);
if (signature !== null) {
assets.push({ path: "/.well-known/brand.json.sig", type: "application/json", content: JSON.stringify(signature, null, 2) });
const keys = buildKeysJson();
if (keys !== null) assets.push({ path: "/.well-known/keys.json", type: "application/json", content: JSON.stringify(keys, null, 2) });
}

return assets;
}
