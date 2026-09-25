/**
 * `/mcp` — el MCP de BeAOS.
 *
 * Es la puerta que faltaba para que los demás productos de Believe (Maasy, BeAds, el agente de una
 * marca) consuman BeAOS sin escribir una integración a medida: JSON-RPC 2.0 sobre HTTP, con `tools/list`
 * y `tools/call`.
 *
 * Decisiones de transporte:
 * - **Sin SSE.** Respondemos JSON en el POST. Es una de las dos formas que el transporte streamable
 *   acepta, y evita mantener una conexión abierta para tools que devuelven un resultado y terminan.
 * - **Sin sesión.** `Mcp-Session-Id` es opcional en el protocolo; acá el estado no vive en el servidor,
 *   así que cualquier instancia atiende cualquier request y un reinicio no rompe a nadie.
 * - **GET responde 405** con una pista, que es lo que el protocolo espera de un servidor que no ofrece
 *   stream por GET. Sin eso, un cliente se queda esperando un stream que nunca abre.
 * - El token se valida contra `ADMIN_API_KEYS` (`Authorization: Bearer …`), el mismo que ya usa
 *   `/api/v1`. Se acepta también `x-api-key` porque muchos clientes MCP mandan el header así.
 */
import { createFileRoute } from "@tanstack/react-router";
import { validateApiKeyFromRequest } from "@/lib/auth/policies";
import { dispatch, parseMessage } from "@/server/mcp/jsonrpc";
import { BEAOS_MCP_SERVER, BEAOS_MCP_TOOLS } from "@/server/mcp/tools";

const CORS_HEADERS = {
	"access-control-allow-origin": "*",
	"access-control-allow-methods": "POST, GET, OPTIONS",
	"access-control-allow-headers": "authorization, content-type, x-api-key, mcp-protocol-version, mcp-session-id",
	"access-control-expose-headers": "mcp-session-id",
};

function jsonRpcResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json", ...CORS_HEADERS },
	});
}

function unauthorized(message: string): Response {
	return new Response(JSON.stringify({ error: message }), {
		status: 401,
		headers: {
			"content-type": "application/json",
			// El protocolo pide el header: sin él, un cliente no sabe que tiene que autenticarse.
			"www-authenticate": 'Bearer realm="beaos"',
			...CORS_HEADERS,
		},
	});
}

function hasApiKey(request: Request): boolean {
	if (validateApiKeyFromRequest(request)) return true;
	const header = request.headers.get("x-api-key");
	if (header === null || header.trim().length === 0) return false;
	// Mismo validador, mismo formato: se reusa el header como si fuera el Bearer.
	return validateApiKeyFromRequest(new Request(request.url, { headers: { authorization: `Bearer ${header.trim()}` } }));
}

export const Route = createFileRoute("/mcp")({
	server: {
		handlers: {
			OPTIONS: () => new Response(null, { status: 204, headers: CORS_HEADERS }),

			GET: () =>
				new Response(
					JSON.stringify({
						error:
							"Este servidor MCP no abre stream por GET. Usá POST con JSON-RPC 2.0 (initialize, tools/list, tools/call).",
					}),
					{ status: 405, headers: { "content-type": "application/json", allow: "POST, OPTIONS", ...CORS_HEADERS } },
				),

			POST: async ({ request }) => {
				if (hasApiKey(request) === false) {
					return unauthorized("Falta un token válido: Authorization: Bearer <token> o x-api-key.");
				}

				const raw = await request.text();
				const parsed = parseMessage(raw);
				if (parsed.ok === false) return jsonRpcResponse(parsed.response);

				const response = await dispatch(parsed.request, {
					tools: BEAOS_MCP_TOOLS,
					serverInfo: BEAOS_MCP_SERVER,
				});

				// Una notificación no lleva respuesta: 202 sin cuerpo, como pide el protocolo.
				if (response === null) return new Response(null, { status: 202, headers: CORS_HEADERS });

				return jsonRpcResponse(response);
			},
		},
	},
});
