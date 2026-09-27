/**
 * La mitad heredada de Getcito: lo que BeAOS ya medía antes de AOS y APS.
 *
 * Prompts monitoreados, competidores, visibilidad, share of voice, citas, fan-out de consultas,
 * oportunidades y reportes viven en las tablas heredadas (`prompts`, `competitors`, `prompt_runs`,
 * `citations`, `brand_opportunities`, `reports`). El MCP no las exponía y Jorge lo pidió explícito:
 * *"el MCP expone solo AOS y APS y no lo que traemos portado de Getcito... debemos exponer lo máximo
 * posible."*
 *
 * Dos reglas para todos los tools de este archivo:
 *
 * 1. **Todo se lee por marca.** Ninguno devuelve filas de marcas distintas mezcladas; el `brandId` es la
 *    entrada obligatoria. La única tabla sin `brand_id` es `reports`, y por eso `list_reports` resuelve el
 *    nombre desde la marca y filtra por él.
 * 2. **Nada pesa cientos de KB.** `prompt_runs.raw_output` y `reports.raw_output` son enormes —hay un
 *    502 en la historia del repo causado por serializarlos— y por eso no se devuelven nunca. Lo que se
 *    devuelve es agregado, acotado, y cuando se recorta se dice.
 */

import type { McpTool } from "../jsonrpc";

/** Los tools heredados: la mitad de Getcito. */
export const platformTools: McpTool[] = [];
