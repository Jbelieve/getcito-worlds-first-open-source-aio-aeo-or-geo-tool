import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type ApsBreakdown, computeApsScore, parseBrandProfile } from "../preference";
import { classifyBusinessType, evaluateStandards, type Probes, type StandardsResult } from "./requirements";
import { verifyBrandSignature } from "./signature";

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
	/** Spec APS from the Claims & Proofs layer. Null when no usable brand.json is served. */
	aps: ApsBreakdown | null;
	score: number;
	band: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const USER_AGENT = "BeAOS-AOS-Audit/0.1 (+https://beaos.believe-global.com)";

function isPrivateIp(ip: string): boolean {
	if (ip.startsWith("10.")) return true;
	if (ip.startsWith("192.168.")) return true;
	if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
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

async function fetchWithTimeout(url: string, timeoutMs: number, accept = "*/*"): Promise<Response | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(url, {
			redirect: "follow",
			signal: controller.signal,
			headers: { "user-agent": USER_AGENT, accept },
		});
		clearTimeout(timer);
		return response;
	} catch {
		return null;
	}
}

interface JsonDocument {
	present: boolean;
	text: string;
	body: unknown;
}

const ABSENT_DOCUMENT: JsonDocument = { present: false, text: "", body: null };

async function fetchJsonDocument(url: string, timeoutMs: number): Promise<JsonDocument> {
	const response = await fetchWithTimeout(url, timeoutMs);
	if (response === null || response.ok === false) return ABSENT_DOCUMENT;
	const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
	if (contentType.includes("json") === false) return ABSENT_DOCUMENT;
	try {
		const text = await response.text();
		const body = JSON.parse(text);
		if (body === null || typeof body !== "object") return ABSENT_DOCUMENT;
		return { present: true, text, body };
	} catch {
		return ABSENT_DOCUMENT;
	}
}

async function probeJson(base: URL, path: string, timeoutMs: number): Promise<boolean> {
	const document = await fetchJsonDocument(new URL(path, base).toString(), timeoutMs);
	return document.present;
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

/**
 * A 404/410 means the route does not exist. 401/403/405 mean it does but is guarded or
 * method-specific, which still counts as exposed capability. Probes never send a body.
 */
async function probeRoutePresence(base: URL, path: string, timeoutMs: number): Promise<boolean> {
	const response = await fetchWithTimeout(new URL(path, base).toString(), timeoutMs);
	if (response === null) return false;
	return response.status !== 404 && response.status !== 410;
}

async function probeMarkdownNegotiation(base: URL, timeoutMs: number): Promise<boolean> {
	const response = await fetchWithTimeout(base.toString(), timeoutMs, "text/markdown");
	if (response === null || response.ok === false) return false;
	const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
	return contentType.includes("markdown");
}

function detectOperator(html: string): boolean {
	return html.includes("operator.maasy.ai/operator/v1/operator.js") || html.includes("data-maasy-operator");
}

function jsonLdTypes(html: string): string[] {
	if (html.includes("application/ld+json") === false) return [];
	const types: string[] = [];
	for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
		try {
			const parsed = JSON.parse(match[1] ?? "");
			for (const node of Array.isArray(parsed) ? parsed : [parsed]) {
				const type = node?.["@type"];
				for (const entry of Array.isArray(type) ? type : [type]) {
					if (entry !== undefined && entry !== null) types.push(String(entry));
				}
				const graph = node?.["@graph"];
				if (Array.isArray(graph)) {
					for (const child of graph) {
						const childType = child?.["@type"];
						for (const entry of Array.isArray(childType) ? childType : [childType]) {
							if (entry !== undefined && entry !== null) types.push(String(entry));
						}
					}
				}
			}
		} catch {
			// Not a JSON-LD block: skip it.
		}
	}
	return types;
}

function hasJsonLdIdentity(types: string[]): boolean {
	return types.some((entry) => ["Organization", "Service", "Product"].includes(entry));
}

function hasJsonLdProofObjects(types: string[]): boolean {
	return types.some((entry) => ["CreativeWork", "CaseStudy", "Review", "Article"].includes(entry));
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
	const [
		llmsTxt,
		llmsFullTxt,
		agentsMd,
		robots,
		sitemap,
		agentCard,
		agentPermissions,
		mcpServerCard,
		brandJsonDocument,
		keysJson,
		openapiWellKnown,
		openapiRoot,
		httpMessageSignatures,
		nlwebAsk,
		markdownNegotiation,
		homepage,
	] = await Promise.all([
		probeText(base, "/llms.txt", timeoutMs),
		probeText(base, "/llms-full.txt", timeoutMs),
		probeText(base, "/AGENTS.md", timeoutMs),
		probeText(base, "/robots.txt", timeoutMs),
		probeText(base, "/sitemap.xml", timeoutMs),
		probeJson(base, "/.well-known/agent-card.json", timeoutMs),
		probeJson(base, "/.well-known/agent-permissions.json", timeoutMs),
		probeJson(base, "/.well-known/mcp/server-card.json", timeoutMs),
		fetchJsonDocument(new URL("/.well-known/brand.json", base).toString(), timeoutMs),
		probeJson(base, "/.well-known/keys.json", timeoutMs),
		probeJson(base, "/.well-known/openapi.json", timeoutMs),
		probeJson(base, "/openapi.json", timeoutMs),
		probeJson(base, "/.well-known/http-message-signatures-directory", timeoutMs),
		probeRoutePresence(base, "/ask", timeoutMs),
		probeMarkdownNegotiation(base, timeoutMs),
		fetchWithTimeout(base.toString(), timeoutMs),
	]);

	const html = homepage ? await homepage.text().catch(() => "") : "";
	const types = jsonLdTypes(html);
	const operatorDetected = detectOperator(html);

	// The Claims & Proofs layer: the signature is over the exact served bytes, so verification
	// receives the same text that was parsed instead of re-fetching.
	const profile = parseBrandProfile(brandJsonDocument.body);
	const signatureValid =
		brandJsonDocument.present === true && (await verifyBrandSignature(base, timeoutMs, brandJsonDocument.text));
	const aps = brandJsonDocument.present
		? computeApsScore(profile, { signedProvenanceVerified: signatureValid })
		: null;

	const probes: Probes = {
		llms_txt: llmsTxt,
		llms_full_txt: llmsFullTxt,
		agents_md: agentsMd,
		robots_sitemap: robots && sitemap,
		jsonld: hasJsonLdIdentity(types),
		proof_objects: hasJsonLdProofObjects(types),
		markdown_negotiation: markdownNegotiation,
		agent_card: agentCard,
		agent_permissions: agentPermissions,
		mcp_server_card: mcpServerCard,
		nlweb_ask: nlwebAsk,
		openapi: openapiWellKnown || openapiRoot,
		brand_json: brandJsonDocument.present,
		brand_json_spec: profile.signals.brandJsonSpec,
		claim_boundaries: profile.signals.claimBoundaries,
		proofs_link_claims: profile.signals.proofsLinkClaims,
		derived_confidence: profile.signals.derivedConfidence,
		keys_json: keysJson,
		http_message_signatures: httpMessageSignatures,
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
		aps,
		score,
		band: bandFromScore(score),
	};
}
