/**
 * La parte pura del descubrimiento de assets: leer lo que el sitio YA publica.
 *
 * La regla que sostienen estos tests es la misma del bundle: BeAOS no inventa un correo de seguridad ni
 * una API. Si el sitio no lo declara, no se emite el archivo — y eso es un resultado, no un fallo.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	apiFromOpenApiDocument,
	declaredApi,
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
