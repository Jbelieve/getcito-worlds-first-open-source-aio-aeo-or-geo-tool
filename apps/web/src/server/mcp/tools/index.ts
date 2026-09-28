/**
 * El registro del MCP de BeAOS, armado desde tres archivos.
 *
 * `agent.ts` son las herramientas propias (AOS, APS medido, pruebas, bundle publicado), `platform.ts` las
 * heredadas de Getcito (prompts, competidores, visibilidad, citas, oportunidades, reportes) y
 * `actions.ts` las que escriben (asegurar marca y entidad, pruebas, medir, sincronizar DNA, generar y
 * publicar assets).
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
	/**
	 * Lo que lee un agente que llega sin contexto.
	 *
	 * Antes nombraba solo parte del alta, así que un consumidor podía crear la marca y la entidad y
	 * trabarse justo en la pieza que decide si la marca puede publicar. Ahora dice el ciclo entero, en
	 * orden, y las dos reglas que no se doblan.
	 */
	instructions:
		"BeAOS mide si una marca y sus webs son operables y preferibles para agentes, y monitorea su visibilidad en los motores de IA. AOS es el score de la web (qué declara y qué puede hacer un agente); APS medido es lo que modelos reales responden sobre la marca; APS declarado sale de los Claims & Proofs que el sitio firma. El ciclo completo, en orden: (1) ensure_brand crea la marca; (2) ensure_entity crea la entidad —el paraguas o un producto— y devuelve el entityId que piden los demás tools; (3) sync_brand_dna trae el contexto de marca que Maasy tiene del proyecto, que es la evidencia en prosa; (4) upsert_claim convierte esa evidencia en pruebas estructuradas: la afirmación, el número, los límites y con qué documento se verifica. **La prueba nace en BeAOS, no en Maasy**: Maasy manda la evidencia en prosa y la estructura la pone BeAOS con lo que confirma el operador. (5) generate_agent_assets genera el bundle desde el DNA y las pruebas confirmadas; (6) publish_agent_assets lo publica. Dos reglas que no se doblan: un perfil que declara menos pruebas que el sitio que ya las sirve se **rechaza** al publicar, porque degradaría en silencio la evidencia de la marca; y BeAOS **no inventa pruebas** —si no hay una prueba confirmada, el claim no existe, y una prueba que no se puede verificar es peor que su ausencia—. Para leer: list_brands, después get_brand para obtener el entityId, y desde ahí get_aos_audit, list_aps_runs, get_aps_score_detail, get_visibility, get_share_of_voice o get_agent_bundle. Para revisar o corregir pruebas antes de generar: list_claims, get_claim, delete_claim y set_claim_inheritable.",
} as const;
