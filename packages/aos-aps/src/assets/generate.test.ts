import { generateKeyPairSync, type KeyObject, verify as verifyBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { generateAgentAssets } from "./generate";

const originalKey = process.env.BELIEVE_SIGNING_KEY_ED25519;

afterEach(() => {
	if (originalKey === undefined) {
		delete process.env.BELIEVE_SIGNING_KEY_ED25519;
	} else {
		process.env.BELIEVE_SIGNING_KEY_ED25519 = originalKey;
	}
});

function withSigningKey(): KeyObject {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	process.env.BELIEVE_SIGNING_KEY_ED25519 = pkcs8.toString("base64");
	return publicKey;
}

const dna = {
	business_description: "Believe instala sistemas de preferencia.",
	strategic_brief: "Marketing como sistema de preferencia.",
	differentiator: "Instala y se retira.",
	prohibited_words: "estrategia, solucion integral",
	approved_ctas: "Quiero mi sistema",
	tone_tags: ["Editorial"],
	claims: [
		{
			claim_id: "CLM-R01",
			statement: "Trust Logistics redujo errores de picking 30%.",
			category: "outcome",
			boundary: { applicable_for: "Fulfillment con volumen.", not_applicable_for: "Sin datos operativos." },
			linked_proofs: ["PRF-R01"],
			confidence: null,
		},
	],
	proofs: [
		{
			proof_id: "PRF-R01",
			type: "case_study",
			title: "Trust Logistics",
			claim_refs: ["CLM-R01"],
			verification: { verifiable_by: "signed_client" },
			confidentiality: "public",
		},
	],
};

function assetByPath(assets: ReturnType<typeof generateAgentAssets>, path: string) {
	return assets.find((asset) => asset.path === path);
}

describe("generateAgentAssets", () => {
	it("emits every asset the AOS discovery and identity requirements probe for", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const paths = assets.map((asset) => asset.path);
		expect(paths).toEqual(
			expect.arrayContaining([
				"/llms.txt",
				"/AGENTS.md",
				"/robots.txt",
				"/sitemap.xml",
				"/.well-known/agent-card.json",
				"/.well-known/agent-permissions.json",
				"/.well-known/brand.json",
			]),
		);
	});

	it("writes real newlines instead of escaped ones", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		for (const path of ["/llms.txt", "/AGENTS.md", "/robots.txt", "/sitemap.xml"]) {
			const content = assetByPath(assets, path)?.content ?? "";
			expect(content).toContain("\n");
			expect(content).not.toContain("\\n");
		}
	});

	it("publishes an explicit AI-crawler policy with the sitemap pointer", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const robots = assetByPath(assets, "/robots.txt")?.content ?? "";
		expect(robots).toContain("User-agent: GPTBot");
		expect(robots).toContain("User-agent: ClaudeBot");
		expect(robots).toContain("Sitemap: https://believe-global.com/sitemap.xml");

		const sitemap = assetByPath(assets, "/sitemap.xml")?.content ?? "";
		expect(sitemap).toContain("<loc>https://believe-global.com</loc>");
	});

	it("skips the sitemap when the entity has no website", () => {
		const assets = generateAgentAssets({ name: "Believe", dna });
		expect(assetByPath(assets, "/sitemap.xml")).toBeUndefined();
		expect(assetByPath(assets, "/robots.txt")?.content).not.toContain("Sitemap:");
	});

	it("copies claims and proofs from brand data and never invents evidence", () => {
		const withClaims = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const profile = JSON.parse(assetByPath(withClaims, "/.well-known/brand.json")?.content ?? "{}");
		expect(profile.claims).toHaveLength(1);
		expect(profile.proofs).toHaveLength(1);
		expect(profile.claims_proofs_version).toBe("claims-proofs/v1");
		expect(profile.agent_guidance.avoid_claims).toEqual(["estrategia", "solucion integral"]);

		const bare = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com" });
		const bareProfile = JSON.parse(assetByPath(bare, "/.well-known/brand.json")?.content ?? "{}");
		expect(bareProfile.claims).toEqual([]);
		expect(bareProfile.proofs).toEqual([]);

		const permissions = JSON.parse(assetByPath(withClaims, "/.well-known/agent-permissions.json")?.content ?? "{}");
		expect(permissions.boundaries["CLM-R01"]).toEqual({
			applicable_for: "Fulfillment con volumen.",
			not_applicable_for: "Sin datos operativos.",
		});
	});
});

describe("generateAgentAssets signing", () => {
	it("serves a signature over the exact brand.json bytes", () => {
		const publicKey = withSigningKey();
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const brand = assetByPath(assets, "/.well-known/brand.json");
		const signature = assetByPath(assets, "/.well-known/brand.json.sig");
		const keys = assetByPath(assets, "/.well-known/keys.json");
		expect(brand).toBeDefined();
		expect(signature).toBeDefined();
		expect(keys).toBeDefined();

		const parsedSignature = JSON.parse(signature?.content ?? "{}");
		expect(parsedSignature.alg).toBe("Ed25519");
		expect(parsedSignature.public_key_url).toBe("/.well-known/keys.json");
		expect(
			verifyBytes(
				null,
				Buffer.from(brand?.content ?? "", "utf8"),
				publicKey,
				Buffer.from(parsedSignature.value, "base64"),
			),
		).toBe(true);

		const parsedKeys = JSON.parse(keys?.content ?? "{}");
		expect(parsedKeys.keys[0].kid).toBe(parsedSignature.kid);
		expect(parsedKeys.keys[0].public_key_b64.length).toBeGreaterThan(0);
	});

	it("omits the provenance assets when no signing key is configured", () => {
		delete process.env.BELIEVE_SIGNING_KEY_ED25519;
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/brand.json")).toBeDefined();
		expect(assetByPath(assets, "/.well-known/brand.json.sig")).toBeUndefined();
		expect(assetByPath(assets, "/.well-known/keys.json")).toBeUndefined();
	});
});
