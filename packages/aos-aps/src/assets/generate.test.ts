import { generateKeyPairSync, type KeyObject, verify as verifyBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SigningKey } from "../provenance";
import { type DeclaredAgentResource, generateAgentAssets } from "./generate";

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

/** Bloques de `robots.txt` que declaran user agents, en el orden del archivo: es como lo parte la spec. */
function robotsGroups(content: string): string[][] {
	return content
		.split("\n\n")
		.filter((block) => block.startsWith("User-agent:"))
		.map((block) => block.split("\n"));
}

function robotsOf(assets: ReturnType<typeof generateAgentAssets>): string {
	return assetByPath(assets, "/robots.txt")?.content ?? "";
}

/** Lo que la marca declara de su API pública, tal como lo lee el generador. */
const API = {
	apiUrl: "https://believe-global.com/api/v1",
	openApiUrl: "https://believe-global.com/openapi.json",
	apiDocsUrl: "https://believe-global.com/developers",
	apiStatusUrl: "https://believe-global.com/api/v1/status",
};

/** Recursos ARD completos: nombre, namespace, media type, url y 2 a 5 consultas representativas. */
const ARD = [
	{
		name: "brand-profile",
		namespace: "registry",
		type: "application/json",
		url: "https://believe-global.com/.well-known/brand.json",
		representativeQueries: ["que hace believe", "cual es el diferencial de believe"],
	},
	{
		name: "server-card",
		namespace: "mcp",
		type: "application/mcp-server-card+json",
		displayName: "Believe MCP",
		url: "https://believe-global.com/.well-known/mcp/server-card.json",
		representativeQueries: ["que tools tiene el mcp de believe", "como llamo al mcp de believe"],
	},
];

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

describe("bundle completo", () => {
	it("sigue emitiendo los archivos de siempre, y ninguna superficie nueva sin datos nuevos", () => {
		// Guardia de regresion: las tres superficies nuevas se emiten SOLO con datos. Sin `securityContact`,
		// sin API/MCP declarado y sin `ardEntries`, el bundle tiene que quedar exactamente como estaba
		// (los 12 de siempre menos el server-card, que depende del MCP).
		const { signing } = newSigningKey();
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			signing,
		});
		expect(assets.map((asset) => asset.path).sort()).toEqual(
			[
				"/llms.txt",
				"/llms-full.txt",
				"/AGENTS.md",
				"/robots.txt",
				"/sitemap.xml",
				"/.well-known/agent-card.json",
				"/.well-known/agent-permissions.json",
				"/.well-known/brand.json",
				"/.well-known/brand.json.sig",
				"/.well-known/keys.json",
				"/.well-known/http-message-signatures-directory",
			].sort(),
		);
		expect(assetByPath(assets, "/.well-known/security.txt")).toBeUndefined();
		expect(assetByPath(assets, "/.well-known/api-catalog")).toBeUndefined();
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeUndefined();
	});

	it("el api-catalog entra cuando la marca declara un MCP, porque ese anchor es real", () => {
		const { signing } = newSigningKey();
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			signing,
			mcpUrl: "https://believe-global.com/mcp",
		});
		expect(assets).toHaveLength(13);
		expect(assetByPath(assets, "/.well-known/mcp/server-card.json")).toBeDefined();
		expect(assetByPath(assets, "/.well-known/api-catalog")).toBeDefined();
	});

	it("con datos completos emite 15: los 12 de siempre mas security.txt, api-catalog y ai-catalog", () => {
		const { signing } = newSigningKey();
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			signing,
			mcpUrl: "https://believe-global.com/mcp",
			securityContact: "mailto:security@believe-global.com",
			ardEntries: ARD,
			...API,
		});
		expect(assets).toHaveLength(15);
		expect(assets.map((asset) => asset.path)).toEqual(
			expect.arrayContaining(["/.well-known/security.txt", "/.well-known/api-catalog", "/.well-known/ai-catalog.json"]),
		);
	});
});

describe("robots.txt: Content-Signal y Agentmap", () => {
	it("declara Content-Signal en cada grupo, justo despues de sus lineas User-agent", () => {
		const robots = robotsOf(generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna }));
		const groups = robotsGroups(robots);
		expect(groups).toHaveLength(3);
		for (const group of groups) {
			const firstRule = group.find((line) => line.startsWith("User-agent:") === false);
			expect(firstRule).toBe("Content-Signal: search=yes, ai-input=yes, ai-train=yes");
		}
	});

	it("separa busqueda IA y agentes disparados por el usuario de los crawlers de entrenamiento", () => {
		const robots = robotsOf(generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna }));
		const [own, search, training] = robotsGroups(robots);

		expect(own).toEqual(["User-agent: *", "Content-Signal: search=yes, ai-input=yes, ai-train=yes", "Allow: /"]);
		expect(search).toEqual([
			"User-agent: OAI-SearchBot",
			"User-agent: ChatGPT-User",
			"User-agent: Claude-SearchBot",
			"User-agent: Claude-User",
			"User-agent: PerplexityBot",
			"User-agent: Perplexity-User",
			"User-agent: DuckAssistBot",
			"User-agent: MistralAI-User",
			"User-agent: Meta-ExternalFetcher",
			"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
			"Allow: /",
		]);
		expect(training).toEqual([
			"User-agent: GPTBot",
			"User-agent: ClaudeBot",
			"User-agent: Google-Extended",
			"User-agent: Applebot-Extended",
			"User-agent: Meta-ExternalAgent",
			"User-agent: CCBot",
			"User-agent: Amazonbot",
			"User-agent: cohere-ai",
			// Ya estaba en la politica explicita de este generador: sacarlo la debilitaba en silencio.
			"User-agent: anthropic-ai",
			"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
			"Allow: /",
		]);
	});

	it("emite Agentmap al ai-catalog solo cuando el bundle lo publica de verdad", () => {
		const withArd = robotsOf(
			generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna, ardEntries: ARD }),
		);
		expect(withArd).toMatch(/^Agentmap: https:\/\/believe-global\.com\/\.well-known\/ai-catalog\.json$/m);

		const withoutArd = robotsOf(
			generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna }),
		);
		expect(withoutArd).not.toContain("Agentmap:");
	});

	it("abre solo la API publica con Allow: /api/v1/ junto a Disallow: /api/", () => {
		const robots = robotsOf(
			generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna, ...API }),
		);
		expect(robotsGroups(robots)[0]).toEqual([
			"User-agent: *",
			"Content-Signal: search=yes, ai-input=yes, ai-train=yes",
			"Allow: /",
			"Disallow: /api/",
			"Allow: /api/v1/",
		]);
	});

	it("no cierra rutas de una API que la marca no declaro", () => {
		const robots = robotsOf(generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna }));
		expect(robots).not.toContain("Disallow:");
		expect(robots).not.toContain("/api/v1/");
	});

	it("no deriva un Disallow que cerraria el sitio entero", () => {
		// Una API en la raiz de otro host no declara prefijo propio: `Disallow: /` seria peor que no decir nada.
		const robots = robotsOf(
			generateAgentAssets({
				name: "Believe",
				websiteUrl: "https://believe-global.com",
				dna,
				apiUrl: "https://api.believe-global.com/v1",
			}),
		);
		expect(robots).not.toContain("Disallow:");
	});
});

describe("security.txt (RFC 9116)", () => {
	it("se emite con los cuatro campos de la spec cuando la marca declara un contacto", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			securityContact: "mailto:security@believe-global.com",
		});
		const asset = assetByPath(assets, "/.well-known/security.txt");
		expect(asset?.type).toBe("text/plain");
		const lines = (asset?.content ?? "").trimEnd().split("\n");
		expect(lines[0]).toBe("Contact: mailto:security@believe-global.com");
		// El formato exacto de la plantilla: fecha ISO 8601 con milisegundos y `Z`.
		expect(lines[1]).toMatch(/^Expires: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(lines[2]).toBe("Canonical: https://believe-global.com/.well-known/security.txt");
		expect(lines[3]).toBe("Preferred-Languages: en, es");
	});

	it("Expires queda en el futuro y a menos de un ano, como pide la RFC", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			securityContact: "mailto:security@believe-global.com",
		});
		const line = (assetByPath(assets, "/.well-known/security.txt")?.content ?? "")
			.split("\n")
			.find((entry) => entry.startsWith("Expires: "));
		const expires = new Date((line ?? "").replace("Expires: ", ""));
		expect(expires.getTime()).toBeGreaterThan(Date.now());
		expect(expires.getTime()).toBeLessThan(Date.now() + 366 * 24 * 60 * 60 * 1000);
	});

	it("NO se emite sin contacto: un buzon de seguridad inventado manda al vacio", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/security.txt")).toBeUndefined();
	});

	it("NO se emite con un contacto que no es una URI reportable", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			securityContact: "security@believe-global.com",
		});
		expect(assetByPath(assets, "/.well-known/security.txt")).toBeUndefined();
	});

	it("omite Canonical sin sitio, en vez de inventar el origen", () => {
		const assets = generateAgentAssets({ name: "Believe", securityContact: "mailto:security@believe-global.com" });
		const content = assetByPath(assets, "/.well-known/security.txt")?.content ?? "";
		expect(content).toContain("Contact: mailto:security@believe-global.com");
		expect(content).not.toContain("Canonical:");
	});
});

describe("api-catalog (RFC 9727)", () => {
	const assets = generateAgentAssets({
		name: "Believe",
		websiteUrl: "https://believe-global.com",
		dna,
		mcpUrl: "https://believe-global.com/mcp",
		...API,
	});
	const catalog = JSON.parse(assetByPath(assets, "/.well-known/api-catalog")?.content ?? "{}");

	it("declara el media type obligatorio, con su profile", () => {
		expect(assetByPath(assets, "/.well-known/api-catalog")?.type).toBe(
			'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
		);
	});

	it("el primer linkset es el catalogo mismo y su item[] iguala los anchors de las APIs", () => {
		const [self, ...apis] = catalog.linkset;
		expect(self.anchor).toBe("https://believe-global.com/.well-known/api-catalog");
		expect(self.item.map((entry: { href: string }) => entry.href).sort()).toEqual(
			apis.map((entry: { anchor: string }) => entry.anchor).sort(),
		);
	});

	it("la API lleva service-desc, service-doc y status con sus tipos exactos", () => {
		const api = catalog.linkset.find((entry: { anchor: string }) => entry.anchor === API.apiUrl);
		expect(api.anchor).toBe(API.apiUrl);
		expect(api["service-desc"]).toEqual([
			{ href: API.openApiUrl, type: "application/vnd.oai.openapi+json;version=3.1" },
		]);
		expect(api["service-doc"]).toEqual([{ href: API.apiDocsUrl, type: "text/html" }]);
		expect(api.status).toEqual([{ href: API.apiStatusUrl, type: "application/json" }]);
	});

	it("suma la entrada del MCP con el server-card que este mismo bundle publica", () => {
		const mcp = catalog.linkset.find((entry: { anchor: string }) => entry.anchor === "https://believe-global.com/mcp");
		expect(mcp["service-desc"]).toEqual([
			{
				href: "https://believe-global.com/.well-known/mcp/server-card.json",
				type: "application/mcp-server-card+json",
			},
		]);
	});

	it("con solo el MCP declarado el catalogo sigue siendo valido", () => {
		const onlyMcp = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			mcpUrl: "https://believe-global.com/mcp",
		});
		const parsed = JSON.parse(assetByPath(onlyMcp, "/.well-known/api-catalog")?.content ?? "{}");
		expect(parsed.linkset[0].item).toEqual([{ href: "https://believe-global.com/mcp" }]);
		expect(parsed.linkset[1].anchor).toBe("https://believe-global.com/mcp");
	});

	it("NO se emite sin API ni MCP: el catalogo no inventa servicios", () => {
		const bare = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(bare, "/.well-known/api-catalog")).toBeUndefined();
	});

	it("NO se emite una API sin service-desc: el catalogo no llevaria a su descripcion", () => {
		const sinDesc = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			apiUrl: API.apiUrl,
		});
		expect(assetByPath(sinDesc, "/.well-known/api-catalog")).toBeUndefined();
	});

	it("NO se emite sin sitio: no hay anchor ni origen que declarar", () => {
		const sinSitio = generateAgentAssets({ name: "Believe", ...API });
		expect(assetByPath(sinSitio, "/.well-known/api-catalog")).toBeUndefined();
	});
});

describe("ai-catalog.json (ARD)", () => {
	it("se llama ai-catalog.json y no ard.json: el estandar y los scanners usan ese nombre", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: ARD,
		});
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeDefined();
		expect(assetByPath(assets, "/.well-known/ard.json")).toBeUndefined();
	});

	it("se emite con specVersion, host y las entradas declaradas", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: ARD,
		});
		const asset = assetByPath(assets, "/.well-known/ai-catalog.json");
		expect(asset?.type).toBe("application/json");
		const catalog = JSON.parse(asset?.content ?? "{}");
		expect(catalog.specVersion).toBe("1.0");
		expect(catalog.host.displayName).toBe("Believe");
		expect(catalog.entries).toHaveLength(2);
	});

	it("usa identifiers urn:air unicos con la forma de la spec", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: ARD,
		});
		const catalog = JSON.parse(assetByPath(assets, "/.well-known/ai-catalog.json")?.content ?? "{}");
		const ids = catalog.entries.map((entry: { identifier: string }) => entry.identifier);
		expect(ids).toEqual([
			"urn:air:believe-global.com:registry:brand-profile",
			"urn:air:believe-global.com:mcp:server-card",
		]);
		expect(new Set(ids).size).toBe(ids.length);
		for (const id of ids) {
			expect(id).toMatch(/^urn:air:believe-global\.com:[a-z0-9]+(:[a-z0-9-]+)*:[a-z0-9-]+$/);
		}
		expect(catalog.entries[1].displayName).toBe("Believe MCP");
	});

	it("cada entrada lleva exactamente uno de url o data, y entre 2 y 5 representatveQueries", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: [
				...ARD,
				{
					name: "inline-notes",
					namespace: "docs",
					type: "application/json",
					data: { ok: true },
					representativeQueries: ["q1", "q2"],
				},
			],
		});
		const catalog = JSON.parse(assetByPath(assets, "/.well-known/ai-catalog.json")?.content ?? "{}");
		expect(catalog.entries).toHaveLength(3);
		for (const entry of catalog.entries) {
			expect((entry.url === undefined) !== (entry.data === undefined)).toBe(true);
			expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
			expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
		}
		// El recurso sin URL propia viaja inline, que es la otra mitad del "url xor data".
		expect(catalog.entries[2].data).toEqual({ ok: true });
		expect(catalog.entries[2].url).toBeUndefined();
	});

	it("adjunta trustManifest solo cuando el bundle publica la firma Ed25519", () => {
		const { signing } = newSigningKey();
		const signed = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			signing,
			ardEntries: ARD,
		});
		const signedCatalog = JSON.parse(assetByPath(signed, "/.well-known/ai-catalog.json")?.content ?? "{}");
		expect(signedCatalog.host.trustManifest).toEqual({
			identity: "https://believe-global.com",
			identityType: "https",
		});

		const unsigned = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: ARD,
		});
		const unsignedCatalog = JSON.parse(assetByPath(unsigned, "/.well-known/ai-catalog.json")?.content ?? "{}");
		expect(unsignedCatalog.host).not.toHaveProperty("trustManifest");
	});

	it("descarta la entrada incompleta, y no emite el archivo si no queda ninguna", () => {
		// Entradas incompletas a proposito: una fuente sin tipar (un JSON externo) puede mandarlas, y el
		// generador tiene que descartarlas en vez de publicar un recurso que un agente no puede usar.
		const incompletas = [
			// Una sola consulta representativa: no llega al minimo.
			{
				name: "corta",
				namespace: "docs",
				type: "application/json",
				url: "https://believe-global.com/a",
				representativeQueries: ["q1"],
			},
			// url y data a la vez: la spec pide exactamente uno.
			{
				name: "doble",
				namespace: "docs",
				type: "application/json",
				url: "https://believe-global.com/b",
				data: { a: 1 },
				representativeQueries: ["q1", "q2"],
			},
			// Sin media type no se puede decir que es el recurso.
			{ name: "sin-type", namespace: "docs", url: "https://believe-global.com/c", representativeQueries: ["q1", "q2"] },
			// El namespace de un urn:air no admite guiones.
			{
				name: "namespace-invalido",
				namespace: "mi-docs",
				type: "application/json",
				url: "https://believe-global.com/d",
				representativeQueries: ["q1", "q2"],
			},
		] as unknown as DeclaredAgentResource[];
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: incompletas,
		});
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeUndefined();
	});

	it("descarta la entrada con mas de cinco consultas representativas", () => {
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna,
			ardEntries: [
				{
					name: "seis",
					namespace: "docs",
					type: "application/json",
					url: "https://believe-global.com/a",
					representativeQueries: ["q1", "q2", "q3", "q4", "q5", "q6"],
				},
			],
		});
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeUndefined();
	});

	it("NO se emite sin recursos declarados: las consultas representativas no se inventan", () => {
		const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", dna });
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeUndefined();
	});

	it("NO se emite sin sitio: sin fqdn no hay identifier urn:air", () => {
		const assets = generateAgentAssets({ name: "Believe", dna, ardEntries: ARD });
		expect(assetByPath(assets, "/.well-known/ai-catalog.json")).toBeUndefined();
	});
});
