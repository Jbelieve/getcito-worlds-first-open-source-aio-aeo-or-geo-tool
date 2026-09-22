import { lookup } from "node:dns/promises";
import { verifyBrandSignature } from "./signature";
import { isIP } from "node:net";
import { classifyBusinessType, evaluateStandards, type Probes, type StandardsResult } from "./requirements";

export interface AosAuditInput {
url: string;
timeoutMs?: number;
}

export interface AosAuditResult {
url: string;
operatorDetected: boolean;
businessType: "brand" | "product_api";
probes: Probes;
standards: StandardsResult;
score: number;
band: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = "BeAOS-AOS-Audit/0.1 (+https://beaos.believe-global.com)";

function isPrivateIp(ip: string): boolean {
if (ip.startsWith("10.")) return true;
if (ip.startsWith("192.168.")) return true;
if (/^172\\.(1[6-9]|2[0-9]|3[0-1])\\./.test(ip)) return true;
if (ip.startsWith("127.")) return true;
if (ip === "::1") return true;
if (ip.startsWith("fc") || ip.startsWith("fd") || ip.startsWith("fe80")) return true;
return false;
}

async function assertSafeUrl(raw: string): Promise<URL> {
const url = new URL(raw);
if (url.protocol !== "http:" && url.protocol !== "https:") {
throw new Error("Only http/https URLs are supported");
}
const host = url.hostname;
if (host === "localhost" || host.endsWith(".localhost")) throw new Error("localhost is not allowed");
if (isIP(host)) {
if (isPrivateIp(host)) throw new Error("private IPs are not allowed");
return url;
}
const addresses = await lookup(host, { all: true });
if (addresses.some((entry) => isPrivateIp(entry.address))) {
throw new Error("private IPs are not allowed");
}
return url;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response | null> {
try {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
const response = await fetch(url, {
redirect: "follow",
signal: controller.signal,
headers: { "user-agent": USER_AGENT, accept: "*/*" },
});
clearTimeout(timer);
return response;
} catch {
return null;
}
}

async function probeJson(base: URL, path: string, timeoutMs: number): Promise<boolean> {
const response = await fetchWithTimeout(new URL(path, base).toString(), timeoutMs);
if (response === null || response.ok === false) return false;
const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
if (contentType.includes("json") === false) return false;
try {
const body = await response.json();
return Boolean(body) && typeof body === "object";
} catch {
return false;
}
}

async function probeText(base: URL, path: string, timeoutMs: number): Promise<boolean> {
const response = await fetchWithTimeout(new URL(path, base).toString(), timeoutMs);
if (response === null || response.ok === false) return false;
try {
const body = await response.text();
return body.trim().length > 0;
} catch {
return false;
}
}
function detectOperator(html: string): boolean {
	return html.includes("operator.maasy.ai/operator/v1/operator.js") || html.includes("data-maasy-operator");
}

function hasJsonLdIdentity(html: string): boolean {
	if (html.includes("application/ld+json") === false) return false;
	const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
	for (const match of scripts) {
		try {
			const parsed = JSON.parse(match[1] ?? "");
			const nodes = Array.isArray(parsed) ? parsed : [parsed];
			for (const node of nodes) {
				const type = node?.["@type"];
				const types = Array.isArray(type) ? type : [type];
				if (types.some((entry) => ["Organization", "Service", "Product"].includes(String(entry)))) return true;
			}
		} catch {
			continue;
		}
	}
	return false;
}

function bandFromScore(score: number): string {
if (score >= 80) return "Agent-Operable";
if (score >= 60) return "Agent-Attemptable";
if (score >= 35) return "Agent-Blocked";
return "Agent-Inert";
}

export async function runAosAudit(input: AosAuditInput): Promise<AosAuditResult> {
const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
const base = await assertSafeUrl(input.url);
const [llmsTxt, agentsMd, robots, sitemap, agentCard, agentPermissions, mcpServerCard, brandJson, keysJson, openapiWellKnown, openapiRoot, homepage] = await Promise.all([
probeText(base, "/llms.txt", timeoutMs),
probeText(base, "/AGENTS.md", timeoutMs),
probeText(base, "/robots.txt", timeoutMs),
probeText(base, "/sitemap.xml", timeoutMs),
probeJson(base, "/.well-known/agent-card.json", timeoutMs),
probeJson(base, "/.well-known/agent-permissions.json", timeoutMs),
probeJson(base, "/.well-known/mcp/server-card.json", timeoutMs),
probeJson(base, "/.well-known/brand.json", timeoutMs),
probeJson(base, "/.well-known/keys.json", timeoutMs),
probeJson(base, "/.well-known/openapi.json", timeoutMs),
probeJson(base, "/openapi.json", timeoutMs),
fetchWithTimeout(base.toString(), timeoutMs),
]);
const html = homepage ? await homepage.text().catch(() => "") : "";
	const operatorDetected = detectOperator(html);
	const signatureValid = brandJson ? await verifyBrandSignature(base, timeoutMs) : false;
const probes: Probes = {
llms_txt: llmsTxt,
agents_md: agentsMd,
robots_sitemap: robots && sitemap,
jsonld: hasJsonLdIdentity(html),
agent_card: agentCard,
agent_permissions: agentPermissions,
mcp_server_card: mcpServerCard,
openapi: openapiWellKnown || openapiRoot,
brand_json: brandJson,
keys_json: keysJson,
signature_valid: signatureValid,
		operator_detected: operatorDetected,
};
const businessType = classifyBusinessType({
hasOpenApi: probes.openapi,
hasPublicApi: probes.openapi,
});
const standards = evaluateStandards(probes, businessType);
const score = standards.aos_standards;
return {
url: base.toString(),
		operatorDetected,
businessType,
probes,
standards,
score,
band: bandFromScore(score),
};
}
