import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { type ApsBreakdown, computeApsScore, parseBrandProfile } from "../preference";
import {
	DISCOVERY_FILES,
	type DiscoveryFiles,
	detectMaasyOperator,
	extractMcpEndpoint,
	hasJsonLdScript,
	isMcpJsonRpcPayload,
	isMcpOrOpenApiDescriptor,
	isValidDiscoveryFile,
} from "./probe";
import {
	classifyBusinessType,
	evaluateExtended,
	evaluateStandards,
	type Probes,
	type RequirementResult,
	type StandardsResult,
} from "./requirements";
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
	/** Scored rubric: identical output to the Maasy audit for the same site. */
	standards: StandardsResult;
	/** Rest of spec.json, checked but never scored. */
	extended: RequirementResult[];
	/** Informative discovery files (agent.json, discovery.json, llms-full.txt). */
	discoveryFiles: DiscoveryFiles;
	/** Whether an MCP or OpenAPI surface was found, by any of the four routes. */
	hasMcpOrOpenApi: boolean;
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

/** A URL taken from the audited content (a declared MCP endpoint) needs its own guard. */
async function isSafeTarget(raw: string): Promise<boolean> {
	try {
		await assertSafeUrl(raw);
		return true;
	} catch {
		return false;
	}
}

interface Probe {
	ok: boolean;
	status: number;
	contentType: string;
	body: string;
}

/**
 * Probes do not follow redirects, exactly like the Maasy audit: a 3xx means the file is not served
 * at that path, and following it could turn an SPA catch-all into a false positive.
 */
async function probe(url: string, timeoutMs: number, method = "GET", payload?: unknown): Promise<Probe | null> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(url, {
			method,
			redirect: "manual",
			signal: controller.signal,
			headers: {
				"user-agent": USER_AGENT,
				accept: "*/*",
				...(payload ? { "content-type": "application/json" } : {}),
			},
			body: payload ? JSON.stringify(payload) : undefined,
		});
		const body = await response.text();
		clearTimeout(timer);
		return {
			ok: response.ok,
			status: response.status,
			contentType: response.headers.get("content-type") ?? "",
			body,
		};
	} catch {
		return null;
	}
}

/** A real JSON document, not the index.html a SPA serves for every path. */
function isJsonObject(response: Probe | null): boolean {
	return isValidDiscoveryFile(true, response?.ok === true, response?.contentType ?? "", response?.body ?? "");
}

/**
 * ¿El sitio expone su propio MCP u OpenAPI? Four routes, in the order Maasy tries them: the HTML
 * itself, the well-known descriptors, the mcp.<domain> subdomain, and the endpoint the site declares
 * in its own llms.txt — which is how an MCP hosted elsewhere still counts.
 */
async function findMcpOrOpenApi(base: URL, html: string, llmsTxtBody: string, timeoutMs: number): Promise<boolean> {
	if (/application\/vnd\.mcp|"openapi":\s*"3/i.test(html)) return true;

	for (const path of ["/.well-known/mcp", "/.well-known/openapi.json", "/.well-known/ai-plugin.json"]) {
		const response = await probe(new URL(path, base).toString(), timeoutMs);
		if (response === null) continue;
		if (isMcpOrOpenApiDescriptor(response.ok, response.contentType, safeJson(response.body))) return true;
	}

	try {
		const hostname = base.hostname.replace(/^www\./, "");
		const mcpUrl = `https://mcp.${hostname}`;
		if (await isSafeTarget(mcpUrl)) {
			const response = await probe(mcpUrl, timeoutMs, "POST", { jsonrpc: "2.0", id: 1, method: "tools/list" });
			if (response !== null && isMcpJsonRpcPayload(safeJson(response.body))) return true;
		}
	} catch {
		// el subdominio no existe o no responde — no cuenta
	}

	if (llmsTxtBody.length > 0) {
		const declared = extractMcpEndpoint(llmsTxtBody);
		if (declared !== null && (await isSafeTarget(declared))) {
			const response = await probe(declared, timeoutMs, "POST", { jsonrpc: "2.0", id: 1, method: "tools/list" });
			if (response !== null && isMcpJsonRpcPayload(safeJson(response.body))) return true;
		}
	}

	return false;
}

/** Types of the JSON-LD blocks; used only for the diagnostic proof-object check. */
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
			}
		} catch {
			// Los scripts de RSC de Next.js también matchean el regex y no son JSON-LD.
		}
	}
	return types;
}

function safeJson(body: string | undefined): unknown {
	if (body === undefined || body.length === 0) return null;
	try {
		return JSON.parse(body);
	} catch {
		return null;
	}
}

async function probeMarkdownNegotiation(base: URL, timeoutMs: number): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), timeoutMs);
		const response = await fetch(base.toString(), {
			redirect: "follow",
			signal: controller.signal,
			headers: { "user-agent": USER_AGENT, accept: "text/markdown" },
		});
		clearTimeout(timer);
		if (response.ok === false) return false;
		return (response.headers.get("content-type") ?? "").toLowerCase().includes("markdown");
	} catch {
		return false;
	}
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
	const at = (path: string) => new URL(path, base).toString();

	const homepage = await probe(base.toString(), timeoutMs);
	const html = homepage?.body ?? "";

	const llmsTxt = await probe(at("/llms.txt"), timeoutMs);
	const agentsMd = await probe(at("/AGENTS.md"), timeoutMs);
	const robots = await probe(at("/robots.txt"), timeoutMs);
	const sitemap = await probe(at("/sitemap.xml"), timeoutMs);
	const agentCard = await probe(at("/.well-known/agent-card.json"), timeoutMs);
	const agentPermissions = await probe(at("/.well-known/agent-permissions.json"), timeoutMs);
	const mcpServerCard = await probe(at("/.well-known/mcp/server-card.json"), timeoutMs);
	const brandJsonResponse = await probe(at("/.well-known/brand.json"), timeoutMs);
	const keysJson = await probe(at("/.well-known/keys.json"), timeoutMs);
	const httpMessageSignatures = await probe(at("/.well-known/http-message-signatures-directory"), timeoutMs);
	const nlwebAsk = await probe(at("/ask"), timeoutMs);

	const discoveryEntries = await Promise.all(
		DISCOVERY_FILES.map(async (file) => {
			const response = await probe(at(file.path), timeoutMs);
			return [
				file.key,
				isValidDiscoveryFile(file.json, response?.ok === true, response?.contentType ?? "", response?.body ?? ""),
			] as const;
		}),
	);
	const discoveryFiles: DiscoveryFiles = Object.fromEntries(discoveryEntries);

	const hasMcpOrOpenApi = await findMcpOrOpenApi(base, html, llmsTxt?.body ?? "", timeoutMs);
	const businessType = classifyBusinessType({ hasOpenApi: hasMcpOrOpenApi });

	// The Claims & Proofs layer: the signature covers the exact served bytes, so verification
	// receives the same text that was parsed instead of re-fetching it.
	const profile = parseBrandProfile(safeJson(brandJsonResponse?.body));
	const signatureValid = await verifyBrandSignature(base, timeoutMs, brandJsonResponse?.body);
	const aps = isJsonObject(brandJsonResponse)
		? computeApsScore(profile, { signedProvenanceVerified: signatureValid })
		: null;

	const probes: Probes = {
		llms_txt: llmsTxt?.ok === true,
		agents_md: agentsMd?.ok === true && agentsMd.contentType.toLowerCase().includes("html") === false,
		robots_sitemap: robots?.ok === true && sitemap?.ok === true,
		jsonld: hasJsonLdScript(html),
		agent_card: isJsonObject(agentCard),
		agent_permissions: isJsonObject(agentPermissions),
		mcp_server_card: isJsonObject(mcpServerCard) || hasMcpOrOpenApi,
		openapi: hasMcpOrOpenApi,
		brand_json: isJsonObject(brandJsonResponse) && /"claims"\s*:/.test(brandJsonResponse?.body ?? ""),
		keys_json: isJsonObject(keysJson) && /"keys"\s*:/.test(keysJson?.body ?? ""),
		signature_valid: signatureValid,
		// Extended and unscored: the rest of spec.json plus what this audit checks on top.
		llms_full_txt: discoveryFiles.llms_full_txt === true,
		proof_objects: jsonLdTypes(html).some((type) => ["CreativeWork", "CaseStudy", "Review", "Article"].includes(type)),
		markdown_negotiation: await probeMarkdownNegotiation(base, timeoutMs),
		nlweb_ask: nlwebAsk !== null && nlwebAsk.status !== 404 && nlwebAsk.status !== 410,
		http_message_signatures: isJsonObject(httpMessageSignatures),
		claim_boundaries: profile.signals.claimBoundaries,
		proofs_link_claims: profile.signals.proofsLinkClaims,
		derived_confidence: profile.signals.derivedConfidence,
		operator_detected: detectMaasyOperator(html),
	};

	const standards = evaluateStandards(probes, businessType);
	const extended = evaluateExtended(probes, businessType);

	return {
		url: base.toString(),
		operatorDetected: probes.operator_detected === true,
		businessType,
		probes,
		standards,
		extended,
		discoveryFiles,
		hasMcpOrOpenApi,
		aps,
		score: standards.aos_standards,
		band: bandFromScore(standards.aos_standards),
	};
}
