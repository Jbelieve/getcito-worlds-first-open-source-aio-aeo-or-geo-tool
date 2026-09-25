/**
 * La superficie publica de BeAOS en su **propia raiz**: `/.well-known/mcp/server-card.json`.
 *
 * BeAOS predica que las marcas publiquen su server-card y no lo hacia. Esto es lo mismo que el bundle
 * genera para una marca, pero para BeAOS mismo: el endpoint real de su MCP y sus tools reales, leidos
 * del registro `BEAOS_MCP_TOOLS` para que no haya dos listas que se desincronicen.
 *
 * El nombre del archivo lleva los puntos escapados (`[.]`) porque el router los lee como separadores de
 * segmento: sin escaparlos, `server-card.json` seria la ruta `/server-card/json` y el archivo no
 * existiria en la URL que los agentes buscan. Los corchetes son la forma documentada de escapar un
 * caracter en el nombre, no un catch-all que se coma el resto del sitio.
 *
 * `security.txt` NO esta: BeAOS no tiene un contacto de seguridad propio en el repo ni en la config, y
 * publicar el de otro producto (o inventar un buzon) manda el aviso de vulnerabilidad a un lugar que no
 * existe. La ruta queda afuera hasta que haya una direccion real que la marca confirme.
 */
import { createFileRoute } from "@tanstack/react-router";
import { MCP_PROTOCOL_VERSION } from "@/server/mcp/jsonrpc";
import { BEAOS_MCP_SERVER, BEAOS_MCP_TOOLS } from "@/server/mcp/tools";

/** El origen canonico de BeAOS. Es el host que atiende este mismo proceso (ver .env.beaos.example). */
const BEAOS_ORIGIN = "https://beaos.believe-global.com";
const MCP_ENDPOINT = `${BEAOS_ORIGIN}/mcp`;

/**
 * El server-card, construido desde el registro de tools.
 *
 * Los tools salen de `BEAOS_MCP_TOOLS` y no de una lista escrita a mano: si manana se agrega o se
 * renombra un tool, el card lo dice sin que nadie se acuerde de actualizarlo.
 */
function serverCard(): Record<string, unknown> {
	return {
		name: BEAOS_MCP_SERVER.name,
		description: BEAOS_MCP_SERVER.instructions,
		version: BEAOS_MCP_SERVER.version,
		protocolVersion: MCP_PROTOCOL_VERSION,
		serverUrl: MCP_ENDPOINT,
		websiteUrl: BEAOS_ORIGIN,
		transport: { type: "streamable-http", endpoint: MCP_ENDPOINT },
		tools: BEAOS_MCP_TOOLS.map((tool) => ({
			name: tool.name,
			...(tool.title === undefined ? {} : { title: tool.title }),
			description: tool.description,
			inputSchema: tool.inputSchema,
		})),
	};
}

export const Route = createFileRoute("/.well-known/mcp/server-card.json")({
	server: {
		handlers: {
			GET: () =>
				Response.json(serverCard(), {
					headers: { "cache-control": "public, max-age=300" },
				}),
		},
	},
});
