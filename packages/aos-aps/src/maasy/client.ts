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

/**
 * La credencial contra el gateway de Maasy.
 *
 * El gateway acepta **dos** cosas (ver `_shared/mcp-core.ts` de Maasy): una **API key** de perfil, que
 * **no expira**, y un token OAuth, que **sí expira**. BeAOS usaba el segundo y se venció: la importación
 * de marcas y la sincronización del DNA quedaron mudas, con un `401 OAuth token expired` que nadie ve
 * hasta que alguien aprieta el botón.
 *
 * Un token que expira no sirve para una integración de servidor a servidor: no hay nadie mirando una
 * pantalla que pueda volver a autorizar. Se prefiere la API key cuando está, y el token queda como
 * respaldo para no romper una instalación que ya funcionaba.
 *
 * Recibe el entorno como parámetro para poder probar la precedencia sin tocar el proceso.
 */
export function maasyAuthHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
	const apiKey = env.MAASY_MCP_API_KEY?.trim();
	if (apiKey !== undefined && apiKey.length > 0) return { "x-api-key": apiKey };

	const token = env.MAASY_MCP_TOKEN?.trim();
	if (token === undefined || token.length === 0) {
		throw new Error(
			"Falta la credencial de Maasy: definí MAASY_MCP_API_KEY (la API key del perfil, que no expira) " +
				"o MAASY_MCP_TOKEN (token OAuth, que expira).",
		);
	}
	return { authorization: `Bearer ${token}` };
}

export async function callMaasyTool<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
	const response = await fetch(`${gatewayBaseUrl()}/functions/v1/mcp-gateway`, {
		method: "POST",
		headers: {
			"content-type": "application/json",
			...maasyAuthHeaders(),
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
