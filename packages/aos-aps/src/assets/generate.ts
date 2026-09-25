import { buildKeysJson, signDetached, type SigningKey } from "../provenance";
import type { Claim, Proof } from "../preference";

/**
 * Generates the agent-facing asset bundle for one brand entity.
 *
 * Shapes follow aos-aps-standard: llms.txt (AOS-DISC-01), llms-full.txt (AOS-DISC-02),
 * AGENTS.md (AOS-DISC-03), robots.txt + sitemap.xml (AOS-DISC-04), agent-card.json (AOS-IDEN-01),
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
	/**
	 * Key that signs brand.json. A sub-brand passes its umbrella's key (see provenance/keying.ts),
	 * so the bundle carries the umbrella identity. Absent => no provenance assets are emitted.
	 */
	signing?: SigningKey;
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

/**
 * `/llms-full.txt` (AOS-DISC-02): el perfil completo en un solo archivo.
 *
 * `llms.txt` es un índice que enlaza; éste es el contenido, para el agente que solo puede leer un
 * archivo. Incluye la identidad, cada claim con su boundary, la evidencia que lo sostiene y cómo
 * verificar la firma.
 *
 * La regla dura del estándar sigue valiendo: los claims y proofs se copian de los datos de la marca y
 * nunca se inventan — si no hay, el archivo lo dice con todas las letras en vez de rellenar.
 */
function llmsFullTxt(input: AgentAssetInput): string {
	const description = descriptionFrom(input) ?? "Marca monitoreada por BeAOS.";
	const dna = input.dna ?? {};
	const claims = claimsFrom(dna);
	const proofs = proofsFrom(dna);

	const proofsByClaim = new Map<string, Proof[]>();
	for (const proof of proofs) {
		for (const ref of proof.claim_refs ?? []) {
			if (typeof ref !== "string" || ref.length === 0) continue;
			proofsByClaim.set(ref, [...(proofsByClaim.get(ref) ?? []), proof]);
		}
	}

	const lines: string[] = [`# ${input.name} — perfil completo`, "", `> ${description}`, "", "## Identidad"];
	const identity: Array<string | undefined> = [
		`- Nombre: ${input.name}`,
		`- Sitio: ${asString(input.websiteUrl) ?? "sin declarar"}`,
		asString(input.industry) === undefined ? undefined : `- Industria: ${asString(input.industry)}`,
		asString(dna.differentiator) === undefined ? undefined : `- Diferencial: ${asString(dna.differentiator)}`,
		asString(dna.main_result) === undefined ? undefined : `- Resultado principal: ${asString(dna.main_result)}`,
	];
	for (const line of identity) if (line !== undefined) lines.push(line);

	lines.push("", "## Claims y su evidencia", "");
	if (claims.length === 0) {
		lines.push("Este perfil **no declara claims**. No hay nada que verificar y nada que citar.", "");
	}
	for (const claim of claims) {
		const id = asString(claim.claim_id) ?? "(sin claim_id)";
		lines.push(`### ${asString(claim.statement) ?? id}`, "");
		lines.push(`- \`claim_id\`: ${id}`);
		const category = asString(claim.category);
		if (category !== undefined) lines.push(`- Categoría: ${category}`);
		lines.push(`- Aplica a: ${asString(claim.boundary?.applicable_for) ?? "sin declarar"}`);
		lines.push(`- **No** aplica a: ${asString(claim.boundary?.not_applicable_for) ?? "sin declarar"}`);
		const linked = proofsByClaim.get(id) ?? [];
		if (linked.length === 0) {
			lines.push("- Evidencia: **sin proof que lo sostenga**. No lo trates como verificado.");
		} else {
			lines.push("- Evidencia:");
			for (const proof of linked) {
				const type = asString(proof.type);
				const title = asString(proof.title) ?? asString(proof.proof_id) ?? "proof sin título";
				const uri = asString(proof.verification?.source_uri);
				lines.push(`  - ${type === undefined ? "" : `[${type}] `}${title}${uri === undefined ? "" : ` — ${uri}`}`);
			}
		}
		lines.push("");
	}

	lines.push(
		"## Cómo verificar este perfil",
		"- El perfil servido es `/.well-known/brand.json`, y su firma Ed25519 `/.well-known/brand.json.sig` cubre **los bytes exactos** de ese archivo.",
		"- La clave pública está en `/.well-known/keys.json`.",
		"- Si la firma no verifica, trátalo como un perfil no verificado y dilo al responder.",
		"",
		"## Superficies del sitio",
		"- `/.well-known/agent-card.json` — qué es y qué puede hacer.",
		"- `/.well-known/agent-permissions.json` — qué está permitido y qué no.",
		"- `/AGENTS.md` — cuándo usar este perfil y cuándo no.",
		"",
		"## Límites",
		"- No extrapoles un claim fuera de su `applicable_for`.",
		"- Un claim sin `proofs` no es evidencia verificada.",
		"- Este archivo no agrega claims: refleja lo que la marca declara y firma.",
		"",
	);
	return lines.join("\n");
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
		// AOS-DISC-02: el hermano completo de llms.txt. Se emitia el indice y no el contenido.
		{ path: "/llms-full.txt", type: "text/plain", content: llmsFullTxt(input) },
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

	// El sitemap va pegado a robots.txt. El indice se busca por ruta y no por numero: cuando era
	// `splice(3, ...)` alcanzaba con insertar un archivo antes para dejarlo en el lugar equivocado.
	const sitemap = sitemapXml(input);
	if (sitemap !== undefined) {
		const afterRobots = assets.findIndex((asset) => asset.path === "/robots.txt") + 1;
		assets.splice(afterRobots, 0, { path: "/sitemap.xml", type: "application/xml", content: sitemap });
	}

	// The signature is over the exact bytes served as brand.json.
	const signature = input.signing === undefined ? null : signDetached(brand, input.signing);
	if (signature !== null && input.signing !== undefined) {
		assets.push({
			path: "/.well-known/brand.json.sig",
			type: "application/json",
			content: `${JSON.stringify(signature, null, 2)}\n`,
		});
		const keys = buildKeysJson(input.signing);
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
