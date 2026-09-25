/**
 * El protocolo MCP, aislado de la base y de la red.
 *
 * Es una función pura sobre mensajes JSON-RPC 2.0 para poder probar el contrato sin levantar nada: qué
 * se responde a `initialize`, qué a `tools/list`, qué pasa con un método que no existe, con un JSON
 * roto, con una notificación (que **no** lleva respuesta) y con un tool que revienta.
 *
 * Lo que el protocolo exige y acá se respeta:
 * - Una **notificación** (sin `id`) nunca lleva respuesta: el transporte devuelve 202 y sin cuerpo.
 * - Un método desconocido es error `-32601`; un tool desconocido es `-32602` (params inválidos), no un
 *   resultado con `isError`.
 * - Un tool que falla **no** es un error de protocolo: es un resultado con `isError: true`, porque el
 *   modelo tiene que poder leer el motivo y corregir. El protocolo se reserva los errores para lo que
 *   está mal formado.
 */

export const JSONRPC_VERSION = "2.0";
/** Versión de MCP que hablamos. La fecha es la del protocolo, no la nuestra. */
export const MCP_PROTOCOL_VERSION = "2025-06-18";

export const ERROR_CODES = {
	parse: -32700,
	invalidRequest: -32600,
	methodNotFound: -32601,
	invalidParams: -32602,
	internal: -32603,
} as const;

export interface JsonRpcRequest {
	jsonrpc: string;
	id?: string | number | null;
	method: string;
	params?: unknown;
}

export interface JsonRpcError {
	code: number;
	message: string;
	data?: unknown;
}

export type JsonRpcResponse =
	| { jsonrpc: "2.0"; id: string | number | null; result: unknown }
	| { jsonrpc: "2.0"; id: string | number | null; error: JsonRpcError };

export interface McpTextContent {
	type: "text";
	text: string;
}

export interface McpToolResult {
	content: McpTextContent[];
	isError?: boolean;
	structuredContent?: unknown;
}

export interface McpTool {
	name: string;
	title?: string;
	description: string;
	/** JSON Schema del objeto de argumentos. */
	inputSchema: Record<string, unknown>;
	handler: (args: Record<string, unknown>) => Promise<McpToolResult>;
}

export interface McpServerInfo {
	name: string;
	version: string;
	instructions?: string;
}

/** Un error que el llamador puede arreglar: se muestra tal cual y no ensucia los logs. */
export class ToolInputError extends Error {}

function ok(id: string | number | null, result: unknown): JsonRpcResponse {
	return { jsonrpc: JSONRPC_VERSION, id, result };
}

function fail(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcResponse {
	return { jsonrpc: JSONRPC_VERSION, id, error: data === undefined ? { code, message } : { code, message, data } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Una notificación no lleva `id` y por lo tanto no se responde. */
export function isNotification(message: JsonRpcRequest): boolean {
	return message.id === undefined || message.id === null;
}

/**
 * Parsea el cuerpo crudo. Un JSON roto es `-32700` con `id: null`, que es lo único que el protocolo
 * permite responder cuando no se pudo leer el `id`.
 */
export function parseMessage(
	raw: string,
): { ok: true; request: JsonRpcRequest } | { ok: false; response: JsonRpcResponse } {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return { ok: false, response: fail(null, ERROR_CODES.parse, "El cuerpo no es JSON válido.") };
	}
	if (isRecord(parsed) === false || typeof parsed.method !== "string") {
		return {
			ok: false,
			response: fail(null, ERROR_CODES.invalidRequest, "Se esperaba un mensaje JSON-RPC 2.0 con `method`."),
		};
	}
	if (parsed.jsonrpc !== undefined && parsed.jsonrpc !== JSONRPC_VERSION) {
		return { ok: false, response: fail(null, ERROR_CODES.invalidRequest, "Solo hablamos JSON-RPC 2.0.") };
	}
	const id = parsed.id;
	if (id !== undefined && id !== null && typeof id !== "string" && typeof id !== "number") {
		return { ok: false, response: fail(null, ERROR_CODES.invalidRequest, "El `id` debe ser texto, número o nulo.") };
	}
	return {
		ok: true,
		request: {
			jsonrpc: JSONRPC_VERSION,
			...(id === undefined ? {} : { id: id as string | number | null }),
			method: parsed.method,
			params: parsed.params,
		},
	};
}

/** El listado de tools, en el formato del protocolo, sin los handlers. */
export function describeTools(tools: McpTool[]): Array<Record<string, unknown>> {
	return tools.map((tool) => ({
		name: tool.name,
		...(tool.title === undefined ? {} : { title: tool.title }),
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
}

export function textResult(text: string, structuredContent?: unknown): McpToolResult {
	return structuredContent === undefined
		? { content: [{ type: "text", text }] }
		: { content: [{ type: "text", text }], structuredContent };
}

/**
 * Resuelve un mensaje. Devuelve `null` cuando es una notificación y no corresponde responder.
 */
export async function dispatch(
	request: JsonRpcRequest,
	options: { tools: McpTool[]; serverInfo: McpServerInfo },
): Promise<JsonRpcResponse | null> {
	const { tools, serverInfo } = options;
	const notification = isNotification(request);
	const id = notification ? null : (request.id as string | number | null);

	if (notification) {
		// `notifications/initialized` y cualquier otra notificación se aceptan en silencio.
		return null;
	}

	switch (request.method) {
		case "initialize":
			return ok(id, {
				protocolVersion: MCP_PROTOCOL_VERSION,
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: serverInfo.name, version: serverInfo.version },
				...(serverInfo.instructions === undefined ? {} : { instructions: serverInfo.instructions }),
			});

		case "ping":
			return ok(id, {});

		case "tools/list":
			return ok(id, { tools: describeTools(tools) });

		case "tools/call": {
			const params = request.params;
			if (isRecord(params) === false || typeof params.name !== "string") {
				return fail(id, ERROR_CODES.invalidParams, "`tools/call` necesita `params.name`.");
			}
			const tool = tools.find((candidate) => candidate.name === params.name);
			if (tool === undefined) {
				const known = tools.map((candidate) => candidate.name).join(", ");
				return fail(id, ERROR_CODES.invalidParams, `No existe el tool "${params.name}". Disponibles: ${known}.`);
			}
			const rawArgs = params.arguments;
			if (rawArgs !== undefined && isRecord(rawArgs) === false) {
				return fail(id, ERROR_CODES.invalidParams, "`params.arguments` debe ser un objeto.");
			}
			try {
				const result = await tool.handler((rawArgs ?? {}) as Record<string, unknown>);
				return ok(id, result);
			} catch (error) {
				// Un fallo del tool es contenido, no un error de protocolo: el llamador tiene que poder leerlo.
				const message = error instanceof Error ? error.message : String(error);
				return ok(id, {
					content: [{ type: "text", text: `El tool "${tool.name}" falló: ${message}` }],
					isError: true,
				} satisfies McpToolResult);
			}
		}

		default:
			return fail(id, ERROR_CODES.methodNotFound, `Método no soportado: ${request.method}.`);
	}
}

// ---------------------------------------------------------------------------
// Lectura de argumentos. Falla temprano y en castellano: el mensaje lo lee un modelo,
// y "expected string, received undefined at path arguments.entityId" no le dice qué hacer.
// ---------------------------------------------------------------------------

export function requireString(args: Record<string, unknown>, key: string): string {
	const value = args[key];
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new ToolInputError(`Falta "${key}": se espera un texto no vacío.`);
	}
	return value.trim();
}

export function requireUuid(args: Record<string, unknown>, key: string): string {
	const value = requireString(args, key);
	const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
	if (uuid.test(value) === false) throw new ToolInputError(`"${key}" debe ser un UUID. Recibido: ${value}`);
	return value;
}

export function requireBoolean(args: Record<string, unknown>, key: string): boolean {
	const value = args[key];
	if (typeof value !== "boolean") throw new ToolInputError(`Falta "${key}": se espera true o false.`);
	return value;
}

export function optionalInteger(
	args: Record<string, unknown>,
	key: string,
	options: { min: number; max: number; fallback: number },
): number {
	const value = args[key];
	if (value === undefined || value === null) return options.fallback;
	if (typeof value !== "number" || Number.isInteger(value) === false) {
		throw new ToolInputError(`"${key}" debe ser un entero.`);
	}
	if (value < options.min || value > options.max) {
		throw new ToolInputError(`"${key}" debe estar entre ${options.min} y ${options.max}.`);
	}
	return value;
}
