export interface MaasyBrand {
	id: string;
	name: string;
	[key: string]: unknown;
}

export interface MaasyBrandContext {
	brand_name?: string;
	industry?: string;
	brief?: string;
	website_url?: string;
	dna?: Record<string, unknown>;
	logo_urls?: unknown[];
	product_images?: unknown[];
	references_summary?: string;
	completeness?: Record<string, unknown>;
	warnings?: unknown[];
	[key: string]: unknown;
}

const DEFAULT_BASE_URL = "https://esptwxlgdbblvnmdpoao.supabase.co";

function gatewayBaseUrl(): string {
	const raw = process.env.MAASY_SUPABASE_URL || process.env.MAASY_URL || DEFAULT_BASE_URL;
	return raw.replace(/\/$/, "");
}

function gatewayToken(): string {
	const token = process.env.MAASY_MCP_TOKEN;
	if (token === undefined || token.length === 0) throw new Error("MAASY_MCP_TOKEN is required");
	return token;
}

export async function callMaasyTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
	const response = await fetch(`${gatewayBaseUrl()}/functions/v1/mcp-gateway`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			authorization: `Bearer ${gatewayToken()}`,
		},
		body: JSON.stringify({ tool, args }),
	});
	const payload = (await response.json().catch(() => ({}))) as { result?: T; error?: unknown };
	if (response.ok === false || payload.error !== undefined) {
		const message = typeof payload.error === "string" ? payload.error : `Maasy gateway error (${response.status})`;
		throw new Error(message);
	}
	return payload.result as T;
}

export async function listMaasyBrands(): Promise<MaasyBrand[]> {
	const result = await callMaasyTool<Array<Record<string, unknown>> | { brands?: Array<Record<string, unknown>> }>(
		"list_brands",
	);
	const rawBrands = Array.isArray(result) ? result : Array.isArray(result.brands) ? result.brands : [];
	return rawBrands.map((entry) => ({
		id: String(entry.id ?? ""),
		name:
			typeof entry.name === "string" && entry.name.length > 0
				? entry.name
				: String(entry.brand_name ?? entry.id ?? "Marca"),
	}));
}

export async function getMaasyBrandContext(projectId: string): Promise<MaasyBrandContext> {
	return callMaasyTool<MaasyBrandContext>("get_brand_context", { project_id: projectId });
}
