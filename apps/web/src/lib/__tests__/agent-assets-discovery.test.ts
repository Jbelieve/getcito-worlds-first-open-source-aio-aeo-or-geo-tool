/**
 * La parte pura del descubrimiento de assets: leer lo que el sitio YA publica.
 *
 * La regla que sostienen estos tests es la misma del bundle: BeAOS no inventa un correo de seguridad ni
 * una API ni un endpoint de MCP. Si el sitio no lo declara, no se emite el archivo — y eso es un
 * resultado, no un fallo.
 */
import { generateAgentAssets } from "@workspace/aos-aps/assets";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	apiFromOpenApiDocument,
	declaredApi,
	declaredMcp,
	declaredSecurityContact,
	linkByRel,
	parseLinkHeader,
	parseSecurityContact,
} from "@/server/agent-assets-core";

describe("parseSecurityContact", () => {
	it("lee el campo Contact de la RFC 9116", () => {
		const body = "# seguridad\nContact: mailto:security@believe-global.com\nExpires: 2027-01-01T00:00:00.000Z\n";
		expect(parseSecurityContact(body)).toBe("mailto:security@believe-global.com");
	});

	it("ignora los comentarios y los campos que no son Contact", () => {
		expect(parseSecurityContact("# Contact: mailto:falso@x.com\nPolicy: https://x.com/p\n")).toBeUndefined();
	});

	it("toma el primer contacto usable cuando hay varios", () => {
		const body = "Contact: not-a-uri\nContact: https://believe-global.com/seguridad\n";
		expect(parseSecurityContact(body)).toBe("https://believe-global.com/seguridad");
	});

	it("no inventa un buzon: sin Contact usable no hay nada", () => {
		// Un correo inventado manda a quien reporta una vulnerabilidad al vacio.
		expect(parseSecurityContact("")).toBeUndefined();
		expect(parseSecurityContact("Contact:\n")).toBeUndefined();
		expect(parseSecurityContact("Contact: security@believe-global.com")).toBeUndefined();
		expect(parseSecurityContact("Contact: mailto:")).toBeUndefined();
		expect(parseSecurityContact("<html>404</html>")).toBeUndefined();
	});
});

describe("parseLinkHeader", () => {
	it("separa varios enlaces y no se rompe con las comas de adentro de la URL", () => {
		const header =
			'<https://believe-global.com/a,b>; rel="service-desc", <https://believe-global.com/docs>; rel="service-doc"';
		expect(parseLinkHeader(header)).toEqual([
			{ url: "https://believe-global.com/a,b", rel: "service-desc" },
			{ url: "https://believe-global.com/docs", rel: "service-doc" },
		]);
	});

	it("soporta rel sin comillas y varios valores en una misma relacion", () => {
		expect(linkByRel(parseLinkHeader("<https://x.com/a>; rel=service-desc"), "service-desc")).toBe("https://x.com/a");
		expect(linkByRel(parseLinkHeader('<https://x.com/b>; rel="service-doc status"'), "status")).toBe("https://x.com/b");
	});

	it("sin header no hay enlaces", () => {
		expect(parseLinkHeader(null)).toEqual([]);
		expect(parseLinkHeader("")).toEqual([]);
		expect(parseLinkHeader("este header no tiene enlaces")).toEqual([]);
		expect(linkByRel([], "service-desc")).toBeUndefined();
	});
});

const OPENAPI_URL = "https://believe-global.com/openapi.json";
const ORIGIN = "https://believe-global.com";

describe("apiFromOpenApiDocument", () => {
	it("toma la raiz que la propia API declara", () => {
		const document = { openapi: "3.1.0", servers: [{ url: "https://api.believe-global.com/v1" }] };
		expect(apiFromOpenApiDocument(document, OPENAPI_URL, ORIGIN)).toEqual({
			apiUrl: "https://api.believe-global.com/v1",
			openApiUrl: OPENAPI_URL,
			apiDocsUrl: `${ORIGIN}/developers`,
		});
	});

	it("resuelve un server relativo contra el origen", () => {
		const document = { openapi: "3.0.0", servers: [{ url: "/api/v2" }] };
		expect(apiFromOpenApiDocument(document, OPENAPI_URL, ORIGIN)?.apiUrl).toBe(`${ORIGIN}/api/v2`);
	});

	it("sin servers cae al prefijo convencional del origen", () => {
		expect(apiFromOpenApiDocument({ openapi: "3.1.0" }, OPENAPI_URL, ORIGIN)?.apiUrl).toBe(`${ORIGIN}/api/v1`);
	});

	it("la doc y el estado salen del Link del home cuando existen", () => {
		const document = { openapi: "3.1.0", servers: [{ url: `${ORIGIN}/api` }] };
		const api = apiFromOpenApiDocument(document, OPENAPI_URL, ORIGIN, `${ORIGIN}/docs/api`, `${ORIGIN}/api/v1/status`);
		expect(api?.apiDocsUrl).toBe(`${ORIGIN}/docs/api`);
		expect(api?.apiStatusUrl).toBe(`${ORIGIN}/api/v1/status`);
	});

	it("sin estado declarado el campo se omite, no se inventa", () => {
		const document = { openapi: "3.1.0" };
		expect(apiFromOpenApiDocument(document, OPENAPI_URL, ORIGIN)).not.toHaveProperty("apiStatusUrl");
	});

	it("un JSON que no es OpenAPI no declara ninguna API", () => {
		expect(apiFromOpenApiDocument({}, OPENAPI_URL, ORIGIN)).toBeUndefined();
		expect(apiFromOpenApiDocument({ openapi: "" }, OPENAPI_URL, ORIGIN)).toBeUndefined();
		expect(apiFromOpenApiDocument(null, OPENAPI_URL, ORIGIN)).toBeUndefined();
		expect(apiFromOpenApiDocument("<html>", OPENAPI_URL, ORIGIN)).toBeUndefined();
	});
});

describe("declaredApi", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("prefiere el Link service-desc del home antes que /openapi.json", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (input: unknown) => {
			const url = String(input);
			calls.push(url);
			if (url === `${ORIGIN}/`) {
				return new Response("", {
					status: 200,
					headers: {
						link: `<${ORIGIN}/api/openapi.json>; rel="service-desc", <${ORIGIN}/docs/api>; rel="service-doc"`,
					},
				});
			}
			if (url === `${ORIGIN}/api/openapi.json`) {
				return new Response(JSON.stringify({ openapi: "3.1.0", servers: [{ url: `${ORIGIN}/api` }] }), {
					status: 200,
				});
			}
			return new Response("no", { status: 404 });
		});

		const api = await declaredApi(ORIGIN);
		expect(api).toEqual({
			apiUrl: `${ORIGIN}/api`,
			openApiUrl: `${ORIGIN}/api/openapi.json`,
			apiDocsUrl: `${ORIGIN}/docs/api`,
		});
		expect(calls).not.toContain(OPENAPI_URL);
	});

	it("sin Link cae a /openapi.json y despues a /.well-known/openapi.json", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (input: unknown) => {
			const url = String(input);
			calls.push(url);
			if (url === `${ORIGIN}/openapi.json`) return new Response("no", { status: 404 });
			if (url === `${ORIGIN}/.well-known/openapi.json`) {
				return new Response(JSON.stringify({ openapi: "3.1.0" }), { status: 200 });
			}
			return new Response("", { status: 200 });
		});

		const api = await declaredApi(ORIGIN);
		expect(api?.openApiUrl).toBe(`${ORIGIN}/.well-known/openapi.json`);
		expect(api?.apiUrl).toBe(`${ORIGIN}/api/v1`);
		expect(calls).toContain(`${ORIGIN}/openapi.json`);
	});

	it("sin API declarada no devuelve nada", async () => {
		vi.stubGlobal("fetch", async () => new Response("<html>no hay api</html>", { status: 200 }));
		expect(await declaredApi(ORIGIN)).toBeUndefined();
	});

	it("sin web no se sale a la red", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		expect(await declaredApi(undefined)).toBeUndefined();
		expect(await declaredSecurityContact(undefined)).toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});

describe("declaredSecurityContact", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("lee el Contact de /.well-known/security.txt", async () => {
		vi.stubGlobal("fetch", async (input: unknown) =>
			String(input) === `${ORIGIN}/.well-known/security.txt`
				? new Response("Contact: mailto:security@believe-global.com\n", { status: 200 })
				: new Response("no", { status: 404 }),
		);
		expect(await declaredSecurityContact(ORIGIN)).toBe("mailto:security@believe-global.com");
	});

	it("si no esta en well-known, mira la raiz", async () => {
		const calls: string[] = [];
		vi.stubGlobal("fetch", async (input: unknown) => {
			const url = String(input);
			calls.push(url);
			if (url === `${ORIGIN}/security.txt`) {
				return new Response("Contact: https://believe-global.com/seguridad\n", { status: 200 });
			}
			return new Response("no", { status: 404 });
		});
		expect(await declaredSecurityContact(ORIGIN)).toBe("https://believe-global.com/seguridad");
		expect(calls[0]).toBe(`${ORIGIN}/.well-known/security.txt`);
	});

	it("un security.txt sin Contact usable no emite nada", async () => {
		vi.stubGlobal("fetch", async () => new Response("Expires: 2027-01-01T00:00:00.000Z\n", { status: 200 }));
		expect(await declaredSecurityContact(ORIGIN)).toBeUndefined();
	});
});

/**
 * El fixture REAL de la landing de BeAOS (verbatim de `https://be-aos.believe-global.com`, 2026-02): su
 * `url` es la de la landing y su MCP vive en un Supabase, declarado dentro de `mcp`.
 */
const LANDING_ORIGIN = "https://be-aos.believe-global.com";
const LANDING_ENDPOINT =
	"https://esptwxlgdbblvnmdpoao.supabase.co/functions/v1/aos-mcp?site_id=386250c1-01d7-4cb7-94b7-a7f3ba5af8f3";
const LANDING_CARD = {
	name: "BeAOS",
	url: LANDING_ORIGIN,
	description:
		"Servidor MCP del Operator de BeAOS: un agente lee el perfil de marca firmado y opera el sitio sin navegador.",
	provider: { name: "Believe", url: "https://believe-global.com" },
	mcp: { endpoint: LANDING_ENDPOINT, transport: "http" },
};
const LANDING_LLMS_TXT = `# BeAOS

> El estandar de marca para agentes de IA, por Believe.

- Sitio: ${LANDING_ORIGIN}

## Como operar este sitio por MCP
- MCP Server Card: /.well-known/mcp/server-card.json
- Endpoint del servidor MCP: ${LANDING_ENDPOINT}
- Un agente descubre y ejecuta las acciones del Operator (operate_page) sin usar un navegador.
`;

/** Sirve la landing: el card y el llms.txt reales, y 404 en todo lo demas. */
function stubLanding({ card, llms }: { card: unknown | null; llms: string | null }): string[] {
	const calls: string[] = [];
	vi.stubGlobal("fetch", async (input: unknown) => {
		const url = String(input);
		calls.push(url);
		if (url === `${LANDING_ORIGIN}/.well-known/mcp/server-card.json` && card !== null) {
			return new Response(JSON.stringify(card), { status: 200, headers: { "content-type": "application/json" } });
		}
		if (url === `${LANDING_ORIGIN}/llms.txt` && llms !== null) {
			return new Response(llms, { status: 200, headers: { "content-type": "text/plain" } });
		}
		return new Response("no", { status: 404 });
	});
	return calls;
}

/** El server-card del bundle, tal como lo emite el generador para esa marca. */
function generatedServerCard(websiteUrl: string, mcp?: { url: string; transport?: string }): Record<string, unknown> {
	const assets = generateAgentAssets({ name: "BeAOS", websiteUrl, mcpUrl: mcp?.url, mcpTransport: mcp?.transport });
	const asset = assets.find((entry) => entry.path === "/.well-known/mcp/server-card.json");
	return asset === undefined ? {} : JSON.parse(asset.content);
}

describe("declaredMcp", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("declara el endpoint que el sitio declara, no el dominio de la marca", async () => {
		stubLanding({ card: LANDING_CARD, llms: LANDING_LLMS_TXT });
		const mcp = await declaredMcp(LANDING_ORIGIN);
		expect(mcp?.url).toBe(LANDING_ENDPOINT);
		expect(mcp?.url).not.toBe(LANDING_ORIGIN);
		expect(mcp?.transport).toBe("http");
	});

	it("el server-card generado declara el endpoint del Supabase, no la landing", async () => {
		stubLanding({ card: LANDING_CARD, llms: LANDING_LLMS_TXT });
		const mcp = await declaredMcp(LANDING_ORIGIN);
		const card = generatedServerCard(LANDING_ORIGIN, mcp);
		expect(card.serverUrl).toBe(LANDING_ENDPOINT);
		expect((card.transport as { endpoint?: string }).endpoint).toBe(LANDING_ENDPOINT);
		expect((card.transport as { type?: string }).type).toBe("http");
		// El dominio sigue en `websiteUrl`: es la identidad del sitio, no un endpoint.
		expect(card.websiteUrl).toBe(LANDING_ORIGIN);
	});

	it("un sitio que declara un endpoint distinto de su dominio se respeta", async () => {
		stubLanding({
			card: { url: LANDING_ORIGIN, serverUrl: "https://mcp.otro-host.com/mcp" },
			llms: LANDING_LLMS_TXT,
		});
		expect(await declaredMcp(LANDING_ORIGIN)).toEqual({ url: "https://mcp.otro-host.com/mcp" });
	});

	it("sin server-card el endpoint NO esta, aunque su llms.txt lo nombre", async () => {
		// Omitir es informacion; derivar el endpoint del dominio es la mentira que un agente va a seguir.
		stubLanding({ card: null, llms: LANDING_LLMS_TXT });
		expect(await declaredMcp(LANDING_ORIGIN)).toBeUndefined();
		const card = generatedServerCard(LANDING_ORIGIN, await declaredMcp(LANDING_ORIGIN));
		expect(card).toEqual({});
		// Y el dominio no aparece como endpoint en ningun asset del bundle.
		const assets = generateAgentAssets({ name: "BeAOS", websiteUrl: LANDING_ORIGIN });
		expect(assets.some((asset) => asset.path === "/.well-known/mcp/server-card.json")).toBe(false);
		expect(assets.some((asset) => asset.content.includes(`"serverUrl": "${LANDING_ORIGIN}"`))).toBe(false);
	});

	it("un card que solo declara su propia url no declara ningun MCP", async () => {
		stubLanding({ card: { name: "BeAOS", url: LANDING_ORIGIN }, llms: LANDING_LLMS_TXT });
		expect(await declaredMcp(LANDING_ORIGIN)).toBeUndefined();
	});

	it("un card que declara el endpoint en la forma vieja `transport.endpoint` se lee igual", async () => {
		stubLanding({
			card: { url: LANDING_ORIGIN, transport: { type: "streamable-http", endpoint: LANDING_ENDPOINT } },
			llms: null,
		});
		expect(await declaredMcp(LANDING_ORIGIN)).toEqual({ url: LANDING_ENDPOINT, transport: "streamable-http" });
	});

	it("un 404 o un HTML con 200 no declaran un MCP", async () => {
		vi.stubGlobal("fetch", async () => new Response("<html>la landing no habla MCP</html>", { status: 200 }));
		expect(await declaredMcp(LANDING_ORIGIN)).toBeUndefined();
	});

	it("sin web no se sale a la red", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);
		expect(await declaredMcp(undefined)).toBeUndefined();
		expect(fetchSpy).not.toHaveBeenCalled();
	});
});
