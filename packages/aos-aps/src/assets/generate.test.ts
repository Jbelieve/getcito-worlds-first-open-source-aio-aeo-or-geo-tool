import { generateKeyPairSync, type KeyObject, verify as verifyBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SigningKey } from "../provenance";
import { generateAgentAssets } from "./generate";

function newSigningKey(keysUri?: string): { publicKey: KeyObject; signing: SigningKey } {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	const signing: SigningKey = { keyId: "believe-2026-primary", material: pkcs8.toString("base64") };
	if (keysUri !== undefined) signing.keysUri = keysUri;
	return { publicKey, signing };
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
		const { publicKey, signing } = newSigningKey();
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna, signing });
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
		expect(parsedKeys.keys[0].key_id).toBe("believe-2026-primary");
		expect(parsedKeys.keys[0].kid).toBe(parsedSignature.kid);
		expect(parsedKeys.keys[0].public_key_b64.length).toBeGreaterThan(0);
	});

	it("signs a sub-brand with the umbrella identity", () => {
		const { publicKey, signing } = newSigningKey("https://believe-global.com/.well-known/keys.json");
		const assets = generateAgentAssets({ name: "Felix Schorle", websiteUrl: "https://felix.com", dna, signing });
		const brand = assetByPath(assets, "/.well-known/brand.json");
		const signature = JSON.parse(assetByPath(assets, "/.well-known/brand.json.sig")?.content ?? "{}");
		const keys = JSON.parse(assetByPath(assets, "/.well-known/keys.json")?.content ?? "{}");

		// The bundle lives on the sub-brand's site but points at the umbrella's published key.
		expect(signature.public_key_url).toBe("https://believe-global.com/.well-known/keys.json");
		expect(keys.keys[0].key_id).toBe("believe-2026-primary");
		expect(
			verifyBytes(null, Buffer.from(brand?.content ?? "", "utf8"), publicKey, Buffer.from(signature.value, "base64")),
		).toBe(true);
	});

	it("omits the provenance assets when no signing key is configured", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/brand.json")).toBeDefined();
		expect(assetByPath(assets, "/.well-known/brand.json.sig")).toBeUndefined();
		expect(assetByPath(assets, "/.well-known/keys.json")).toBeUndefined();
	});

	it("omits the provenance assets when the key material is unusable", () => {
		const unusable = { keyId: "believe-2026-primary", material: Buffer.alloc(48, 3).toString("base64") };
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			signing: unusable,
		});
		expect(assetByPath(assets, "/.well-known/brand.json")).toBeDefined();
		expect(assetByPath(assets, "/.well-known/brand.json.sig")).toBeUndefined();
	});
});

describe("llms-full.txt (AOS-DISC-02)", () => {
	it("se emite, y el bundle ya no publica solo el indice", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const full = assetByPath(assets, "/llms-full.txt");
		expect(full?.type).toBe("text/plain");
		expect(full?.content.length).toBeGreaterThan(500);
		// El indice enlaza; el completo trae el contenido.
		const index = assetByPath(assets, "/llms.txt")?.content ?? "";
		expect(index.length).toBeLessThan(full?.content.length ?? 0);
	});

	it("incluye cada claim con su boundary y la evidencia que lo sostiene", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const content = assetByPath(assets, "/llms-full.txt")?.content ?? "";
		expect(content).toContain("Trust Logistics redujo errores de picking 30%.");
		expect(content).toContain("`claim_id`: CLM-R01");
		expect(content).toContain("Fulfillment con volumen.");
		expect(content).toContain("**No** aplica a: Sin datos operativos.");
		expect(content).toContain("[case_study] Trust Logistics");
	});

	it("sin claims lo dice con todas las letras en vez de rellenar", () => {
		// Es el caso REAL de produccion: el DNA sincronizado trae client_results como texto libre y
		// claims[] vacio. El archivo tiene que reflejarlo, no inventar evidencia.
		const sinClaims = { ...dna, claims: [], proofs: [] };
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna: sinClaims });
		const content = assetByPath(assets, "/llms-full.txt")?.content ?? "";
		expect(content).toContain("no declara claims");
		expect(content).not.toContain("###");
	});

	it("un claim sin proof se marca como no verificado", () => {
		const huerfano = { ...dna, proofs: [] };
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna: huerfano });
		const content = assetByPath(assets, "/llms-full.txt")?.content ?? "";
		expect(content).toContain("sin proof que lo sostenga");
	});

	it("escribe saltos de linea reales", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		for (const path of ["/llms-full.txt", "/llms.txt", "/AGENTS.md", "/robots.txt", "/sitemap.xml"]) {
			const content = assetByPath(assets, path)?.content ?? "";
			expect(content).toContain("\n");
			expect(content).not.toContain("\\n");
		}
	});

	it("deja el sitemap pegado a robots.txt sin importar cuantos archivos se agreguen antes", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		const paths = assets.map((asset) => asset.path);
		expect(paths.indexOf("/sitemap.xml")).toBe(paths.indexOf("/robots.txt") + 1);
	});
});

describe("server-card (AOS-CAPA-01)", () => {
	it("se emite con serverUrl cuando la marca declara un MCP", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			mcpUrl: "https://believe-global.com/mcp",
		});
		const card = JSON.parse(assetByPath(assets, "/.well-known/mcp/server-card.json")?.content ?? "{}");
		// Los lectores buscan serverUrl en la raiz: es lo que le faltaba al card del sitio.
		expect(card.serverUrl).toBe("https://believe-global.com/mcp");
		expect(card.transport.endpoint).toBe("https://believe-global.com/mcp");
	});

	it("copia los tools que el sitio declara, para que el card diga que se puede llamar", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			mcpUrl: "https://believe-global.com/mcp",
			mcpTools: [
				{ name: "ask_brand", title: "Preguntar por la marca", description: "Retrieval sobre el perfil firmado." },
				{ name: "request_diagnostic" },
			],
		});
		const card = JSON.parse(assetByPath(assets, "/.well-known/mcp/server-card.json")?.content ?? "{}");
		expect(card.tools).toEqual([
			{ name: "ask_brand", title: "Preguntar por la marca", description: "Retrieval sobre el perfil firmado." },
			{ name: "request_diagnostic" },
		]);
	});

	it("OMITE tools cuando no los conoce: una lista vacía afirmaría que no hay ninguno", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			mcpUrl: "https://believe-global.com/mcp",
		});
		const card = JSON.parse(assetByPath(assets, "/.well-known/mcp/server-card.json")?.content ?? "{}");
		expect(card).not.toHaveProperty("tools");
	});

	it("descarta un tool sin nombre y no deja la lista vacía", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			mcpUrl: "https://believe-global.com/mcp",
			mcpTools: [{ name: "   " }, { name: "ask_brand" }],
		});
		const card = JSON.parse(assetByPath(assets, "/.well-known/mcp/server-card.json")?.content ?? "{}");
		expect(card.tools).toEqual([{ name: "ask_brand" }]);
	});

	it("NO se emite si la marca no declara MCP: no inventamos endpoints", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/mcp/server-card.json")).toBeUndefined();
	});
});

describe("directorio de Web Bot Auth (APS-PROV-03)", () => {
	it("se emite al firmar, y la clave del JWK es la MISMA que publica keys.json", () => {
		const { signing } = newSigningKey("https://believe-global.com/.well-known/keys.json");
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna, signing });
		const directory = JSON.parse(
			assetByPath(assets, "/.well-known/http-message-signatures-directory")?.content ?? "{}",
		);
		const keys = JSON.parse(assetByPath(assets, "/.well-known/keys.json")?.content ?? "{}");

		expect(directory.keys).toHaveLength(1);
		const jwk = directory.keys[0];
		expect(jwk).toMatchObject({ kty: "OKP", crv: "Ed25519", use: "sig" });
		expect(jwk.kid).toBe(keys.keys[0].kid);
		// `x` es la clave cruda en base64url: tiene que decodificar al MISMO hex que keys.json.
		expect(Buffer.from(jwk.x, "base64url").toString("hex")).toBe(keys.keys[0].public_key_hex);
	});

	it("no se emite sin firma", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/http-message-signatures-directory")).toBeUndefined();
	});
});
