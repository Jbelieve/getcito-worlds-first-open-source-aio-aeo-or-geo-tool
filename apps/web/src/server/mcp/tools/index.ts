/**
 * El registro del MCP de BeAOS, armado desde tres archivos.
 *
 * `agent.ts` son las herramientas propias (AOS, APS medido, bundle publicado), `platform.ts` las
 * heredadas de Getcito (prompts, competidores, visibilidad, citas, oportunidades, reportes) y
 * `actions.ts` las que escriben (asegurar marca y entidad, medir, sincronizar DNA, generar y publicar
 * assets).
 *
 * `tools.ts` era un solo archivo y ya no alcanzaba: separarlo no es cosmética —deja ver de un vistazo
 * qué es lectura propia, qué es lectura heredada y qué es acción, que es exactamente el mapa que
 * necesita quien audita el MCP—. El protocolo sigue viviendo en `../jsonrpc.ts`.
 */

import type { McpTool } from "../jsonrpc";
import { actionTools } from "./actions";
import { agentTools } from "./agent";
import { platformTools } from "./platform";

export const BEAOS_MCP_TOOLS: McpTool[] = [...agentTools, ...platformTools, ...actionTools];

export const BEAOS_MCP_SERVER = {
	name: "beaos",
	version: "1.1.0",
	instructions:
		"BeAOS mide si una marca y sus webs son operables y preferibles para agentes, y monitorea su visibilidad en los motores de IA. AOS es el score de la web (qué declara y qué puede hacer un agente); APS medido es lo que modelos reales responden sobre la marca; APS declarado sale de los Claims & Proofs que el sitio firma. Para empezar: list_brands, después get_brand para obtener el entityId, y desde ahí get_aos_audit, list_aps_runs, get_aps_score_detail, get_visibility, get_share_of_voice o get_agent_bundle. Para dar de alta una marca nueva: ensure_brand y ensure_entity; para medirla: start_aps_run.",
} as const;
