import { buildKeysJson, signDetached } from "../provenance";
import type { Claim, Proof } from "../preference";

/**
 * Generates the agent-facing asset bundle for one brand entity.
 *
 * Shapes follow aos-aps-standard: llms.txt (AOS-DISC-01), AGENTS.md (AOS-DISC-03),
 * robots.txt + sitemap.xml (AOS-DISC-04), agent-card.json (AOS-IDEN-01),
 * agent-permissions.json (AOS-IDEN-02), brand.json + .sig + keys.json (APS-CLAIM/PROV).
 *
 * Hard rule from the standard: AOS links proofs, it does not create them. Claims and proofs are
 * only copied from the brand's own synced data; absent input yields empty arrays, never invented
 * evidence.
 */

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

/** Claims pass through only when the brand's own data already carries them. */
function claimsFrom(dna: Record<string, unknown>): Claim[] {
	return Array.isArray(dna.claims) ? (dna.claims as Claim[]) : [];
}

function proofsFrom(dna: Record<string, unknown>): Proof[] {
	return Array.isArray(dna.proofs) ? (dna.proofs as Proof[]) : [];
}

function prohibitedTermsFrom(dna: Record<string, unknown>): string[] {
	const raw = asString(dna.prohibited_words);
	if (raw === undefined) return [];
	return raw
		.split(",")
		.map((entry) => entry.trim())
		.filter((entry) => entry.length > 0);
}

function normalizedOrigin(websiteUrl: string | undefined): string | undefined {
	if (websiteUrl === undefined) return undefined;
	try {
		const url = new URL(websiteUrl);
		return `${url.protocol}//${url.host}`;
	} catch {
		return undefined;
	}
}

function brandJson(input: AgentAssetInput): string {
	const description = descriptionFrom(input);
	const dna = input.dna ?? {};
	const terms = prohibitedTermsFrom(dna);
	const profile = {
		$schema: "https://maasy.ai/schema/brand-profile/v1.json",
		version: 1,
		claims_proofs_version: "claims-proofs/v1",
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
		agent_guidance: { avoid_claims: terms },
		claims: claimsFrom(dna),
		proofs: proofsFrom(dna),
		generated_by: "BeAOS",
	};
	return `${JSON.stringify(profile, null, 2)}\n`;
}

function boundariesFrom(claims: Claim[]): Record<string, { applicable_for?: string; not_applicable_for?: string }> {
	const boundaries: Record<string, { applicable_for?: string; not_applicable_for?: string }> = {};
	for (const claim of claims) {
		const id = asString(claim.claim_id);
		if (id === undefined || claim.boundary === null || claim.boundary === undefined) continue;
		boundaries[id] = {
			applicable_for: asString(claim.boundary.applicable_for),
			not_applicable_for: asString(claim.boundary.not_applicable_for),
		};
	}
	return boundaries;
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
		"## Perfil verificable",
		"- [Brand Profile](/.well-known/brand.json)",
		"- [Firma Ed25519](/.well-known/brand.json.sig)",
		"- [Clave publica](/.well-known/keys.json)",
		"",
		"## Capacidades",
		"- [Agent Card](/.well-known/agent-card.json)",
		"- [Agent Permissions](/.well-known/agent-permissions.json)",
		"",
	].join("\n");
}

function agentsMd(input: AgentAssetInput): string {
	const description = descriptionFrom(input) ?? "";
	return [
		`# ${input.name}`,
		"",
		description,
		"",
		"## Cuando usar este perfil",
		"- Para responder que hace la marca y a quien sirve, lee `/.well-known/brand.json`.",
		"- Antes de citar un resultado, verifica `claims[]` y sus `proofs[]`.",
		"- Cada claim declara `boundary.applicable_for` y `boundary.not_applicable_for`: respeta ambos.",
		"- La firma es Ed25519 sobre los bytes exactos de `brand.json`, verificable con `keys.json`.",
		"",
		"## Cuando no usar este perfil",
		"- No extrapoles un claim fuera de su `applicable_for`.",
		"- No trates un claim sin `proofs` como evidencia verificada.",
		"",
	].join("\n");
}

function robotsTxt(input: AgentAssetInput): string {
	const origin = normalizedOrigin(input.websiteUrl);
	const agents = [
		"GPTBot",
		"OAI-SearchBot",
		"ChatGPT-User",
		"ClaudeBot",
		"Claude-User",
		"anthropic-ai",
		"PerplexityBot",
		"Perplexity-User",
		"Google-Extended",
		"Applebot-Extended",
		"CCBot",
	];
	const lines = ["# Politica explicita de crawlers de IA", ...agents.map((agent) => `User-agent: ${agent}\nAllow: /`)];
	lines.push("User-agent: *", "Allow: /");
	if (origin !== undefined) lines.push("", `Sitemap: ${origin}/sitemap.xml`);
	return `${lines.join("\n")}\n`;
}

function sitemapXml(input: AgentAssetInput): string | undefined {
	if (input.websiteUrl === undefined) return undefined;
	const lastmod = new Date().toISOString().slice(0, 10);
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
		"  <url>",
		`    <loc>${input.websiteUrl}</loc>`,
		`    <lastmod>${lastmod}</lastmod>`,
		"  </url>",
		"</urlset>",
		"",
	].join("\n");
}

export function generateAgentAssets(input: AgentAssetInput): GeneratedAsset[] {
	const description = descriptionFrom(input) ?? "";
	const dna = input.dna ?? {};
	const claims = claimsFrom(dna);
	const brand = brandJson(input);

	const assets: GeneratedAsset[] = [
		{ path: "/llms.txt", type: "text/plain", content: llmsTxt(input) },
		{ path: "/AGENTS.md", type: "text/markdown", content: agentsMd(input) },
		{ path: "/robots.txt", type: "text/plain", content: robotsTxt(input) },
		{
			path: "/.well-known/agent-card.json",
			type: "application/json",
			content: `${JSON.stringify(
				{
					name: input.name,
					description,
					url: input.websiteUrl,
					version: "1.0.0",
					protocolVersion: "1.0",
					skills: [],
					capabilities: {},
					defaultInputModes: ["text/plain"],
					defaultOutputModes: ["text/plain"],
				},
				null,
				2,
			)}\n`,
		},
		{
			path: "/.well-known/agent-permissions.json",
			type: "application/json",
			content: `${JSON.stringify({ permissions: [], boundaries: boundariesFrom(claims) }, null, 2)}\n`,
		},
		{ path: "/.well-known/brand.json", type: "application/json", content: brand },
	];

	const sitemap = sitemapXml(input);
	if (sitemap !== undefined) {
		assets.splice(3, 0, { path: "/sitemap.xml", type: "application/xml", content: sitemap });
	}

	// The signature is over the exact bytes served as brand.json.
	const signature = signDetached(brand);
	if (signature !== null) {
		assets.push({
			path: "/.well-known/brand.json.sig",
			type: "application/json",
			content: `${JSON.stringify(signature, null, 2)}\n`,
		});
		const keys = buildKeysJson();
		if (keys !== null) {
			assets.push({
				path: "/.well-known/keys.json",
				type: "application/json",
				content: `${JSON.stringify(keys, null, 2)}\n`,
			});
		}
	}

	return assets;
}
