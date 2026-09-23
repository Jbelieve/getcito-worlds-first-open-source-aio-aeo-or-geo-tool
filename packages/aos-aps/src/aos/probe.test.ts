import { describe, expect, it } from "vitest";
import {
	DISCOVERY_FILES,
	detectMaasyOperator,
	extractMcpEndpoint,
	hasJsonLdScript,
	isMcpJsonRpcPayload,
	isMcpOrOpenApiDescriptor,
	isValidDiscoveryFile,
} from "./probe";

describe("isValidDiscoveryFile", () => {
	it("rejects the SPA catch-all that answers 200 with index.html", () => {
		expect(isValidDiscoveryFile(true, true, "text/html", "<!DOCTYPE html>")).toBe(false);
		expect(isValidDiscoveryFile(false, true, "text/html", "<h1>hola</h1>")).toBe(false);
		expect(isValidDiscoveryFile(true, false, "application/json", "{}")).toBe(false);
	});

	it("accepts a real json or text file", () => {
		expect(isValidDiscoveryFile(true, true, "application/json; charset=utf-8", '{"a":1}')).toBe(true);
		expect(isValidDiscoveryFile(true, true, "application/json", "{}")).toBe(false); // vacío
		expect(isValidDiscoveryFile(true, true, "application/json", "no json")).toBe(false);
		expect(isValidDiscoveryFile(false, true, "text/plain", "contenido")).toBe(true);
		expect(isValidDiscoveryFile(false, true, "text/markdown", "   ")).toBe(false);
	});

	it("lists the discovery files the market expects", () => {
		expect(DISCOVERY_FILES.map((file) => file.key)).toEqual(["agent_json", "discovery_json", "llms_full_txt"]);
	});
});

describe("extractMcpEndpoint", () => {
	it("finds an aos-mcp url first", () => {
		const llms = "Recursos\n- MCP: https://xyz.supabase.co/functions/v1/aos-mcp\n- Otro";
		expect(extractMcpEndpoint(llms)).toBe("https://xyz.supabase.co/functions/v1/aos-mcp");
	});

	it("falls back to the endpoint declared after 'endpoint mcp'", () => {
		expect(extractMcpEndpoint("Canonical: https://maasy.ai · Endpoint MCP: https://mcp.maasy.ai")).toBe(
			"https://mcp.maasy.ai",
		);
		expect(extractMcpEndpoint("endpoint mcp: [texto](https://mcp.ejemplo.com)")).toBe("https://mcp.ejemplo.com");
	});

	it("does not catch the reversed phrasing, which is why the aos-mcp url matters", () => {
		// believe-global.com writes "MCP endpoint:", which this fallback (as ported) does not match.
		// What saves it there is the aos-mcp url in the same llms.txt, matched above.
		expect(extractMcpEndpoint("Canonical: https://maasy.ai · MCP endpoint: https://mcp.maasy.ai")).toBeNull();
	});

	it("returns null when nothing is declared", () => {
		expect(extractMcpEndpoint("# Believe\n\nSin endpoints.")).toBeNull();
	});
});

describe("hasJsonLdScript", () => {
	it("matches the tag, whatever the quoting", () => {
		expect(hasJsonLdScript('<script type="application/ld+json">{"a":1}</script>')).toBe(true);
		expect(hasJsonLdScript("<script type='application/ld+json'>{}</script>")).toBe(true);
	});

	it("does not match a plain script or a mention in text", () => {
		expect(hasJsonLdScript('<script type="text/javascript">var a=1</script>')).toBe(false);
		expect(hasJsonLdScript("menciona application/ld+json en el texto")).toBe(false);
	});
});

describe("isMcpOrOpenApiDescriptor", () => {
	it("accepts a real json descriptor", () => {
		expect(isMcpOrOpenApiDescriptor(true, "application/json", { openapi: "3.0.0" })).toBe(true);
		expect(isMcpOrOpenApiDescriptor(true, "application/json", { tools: [] })).toBe(true);
	});

	it("rejects html, non-objects and errors", () => {
		expect(isMcpOrOpenApiDescriptor(true, "text/html", { a: 1 })).toBe(false);
		expect(isMcpOrOpenApiDescriptor(false, "application/json", { a: 1 })).toBe(false);
		expect(isMcpOrOpenApiDescriptor(true, "application/json", null)).toBe(false);
		expect(isMcpOrOpenApiDescriptor(true, "application/json", "texto")).toBe(false);
	});
});

describe("isMcpJsonRpcPayload", () => {
	it("accepts a real JSON-RPC answer with tools", () => {
		expect(isMcpJsonRpcPayload({ jsonrpc: "2.0", result: { tools: [{ name: "x" }] } })).toBe(true);
		expect(isMcpJsonRpcPayload({ jsonrpc: "2.0", result: {} })).toBe(true);
	});

	it("rejects an empty or unrelated answer", () => {
		expect(isMcpJsonRpcPayload({ jsonrpc: "2.0", result: { tools: [] } })).toBe(false);
		expect(isMcpJsonRpcPayload({ status: "parked" })).toBe(false);
		expect(isMcpJsonRpcPayload("html")).toBe(false);
		expect(isMcpJsonRpcPayload(null)).toBe(false);
	});
});

describe("detectMaasyOperator", () => {
	it("accepts the script or the DOM marker", () => {
		expect(detectMaasyOperator('<script src="https://operator.maasy.ai/operator/v1/operator.js"></script>')).toBe(true);
		expect(detectMaasyOperator('<div data-maasy-operator="1"></div>')).toBe(true);
	});

	it("rejects a page without the operator", () => {
		expect(detectMaasyOperator("<html><body>hola</body></html>")).toBe(false);
	});
});
