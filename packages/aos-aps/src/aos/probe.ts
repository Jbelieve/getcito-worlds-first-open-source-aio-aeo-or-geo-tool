/**
 * Pure probe helpers, ported one-to-one from MAASY's `aos-audit-url/probe.ts` and the inline
 * checks in `aos-audit-url/index.ts`.
 *
 * They live here because BeAOS's AOS score has to be the SAME number the Maasy audit reports for
 * the same site. Re-implementing a stricter check (parsing the JSON-LD instead of matching the tag,
 * looking only at one MCP path) silently moved the score.
 */

/**
 * ¿La respuesta a un path de discovery file es el archivo real y no el index.html 200 del
 * catch-all de un SPA?
 */
export function isValidDiscoveryFile(json: boolean, ok: boolean, contentType: string, body: string): boolean {
	if (!ok) return false;
	const ct = contentType.toLowerCase();
	if (json) {
		if (ct.includes("json") === false) return false;
		try {
			const parsed = JSON.parse(body);
			return Boolean(parsed) && typeof parsed === "object" && Object.keys(parsed).length > 0;
		} catch {
			return false;
		}
	}
	if (ct.includes("html")) return false;
	return body.trim().length > 0;
}

/** Discovery files the market expects besides llms.txt. Informative: they do not move the score. */
export const DISCOVERY_FILES: Array<{ key: string; path: string; json: boolean }> = [
	{ key: "agent_json", path: "/.well-known/agent.json", json: true },
	{ key: "discovery_json", path: "/.well-known/discovery.json", json: true },
	{ key: "llms_full_txt", path: "/llms-full.txt", json: false },
];

export type DiscoveryFiles = Record<string, boolean>;

/**
 * MCP endpoint declared in the client's own llms.txt. Without this the audit only looks at the
 * client's domain, so installing an MCP hosted elsewhere never moved the score.
 */
export function extractMcpEndpoint(llmsTxt: string): string | null {
	const direct = llmsTxt.match(/https?:\/\/[^\s)"']*aos-mcp[^\s)"']*/i);
	if (direct) return direct[0];
	const declared = llmsTxt.match(/endpoint mcp[:\s]+(?:\[[^\]]*\]\()?(https?:\/\/[^\s)"']+)/i);
	return declared?.[1] ?? null;
}

/** The tag is enough: this is presence of structured identity, not a semantic validation. */
export function hasJsonLdScript(html: string): boolean {
	return /<script[^>]+type=["']application\/ld\+json["']/i.test(html);
}

/** A real descriptor, not the SPA catch-all serving index.html with a 200. */
export function isMcpOrOpenApiDescriptor(ok: boolean, contentType: string, body: unknown): boolean {
	if (!ok) return false;
	if (contentType.toLowerCase().includes("json") === false) return false;
	if (body === null || typeof body !== "object") return false;
	return "openapi" in body || "paths" in body || Object.keys(body).length > 0;
}

/**
 * A real MCP JSON-RPC answer. A parked domain or a 404 used to be enough to earn the capability
 * points, and an MCP that answers with zero tools is not operable.
 */
export function isMcpJsonRpcPayload(body: unknown): boolean {
	if (body === null || typeof body !== "object") return false;
	const payload = body as { jsonrpc?: unknown; result?: unknown };
	if (payload.jsonrpc !== "2.0" && payload.result == null) return false;
	const tools = (payload.result as { tools?: unknown } | undefined)?.tools;
	if (Array.isArray(tools)) return tools.length > 0;
	return true;
}

/** Two signals, either one counts: the public bundle in a script tag, or the DOM marker it leaves. */
export function detectMaasyOperator(html: string): boolean {
	const scriptTag = /<script[^>]+src=["'][^"']*operator\.maasy\.ai\/operator\/v1\/operator\.js[^"']*["']/i.test(html);
	const domMarker = /data-maasy-operator/i.test(html);
	return scriptTag || domMarker;
}
