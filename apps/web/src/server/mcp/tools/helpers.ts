/**
 * Lo que comparten los tools del MCP: límites, serialización y dos reglas de presentación.
 *
 * Regla 1 — **nada pesa cientos de KB**. Un tool que devuelve una tabla heredada puede traer un JSON
 * enorme (`rawOutput`, `report`, un array de citas); antes de serializarlo se recorta y se dice que se
 * recortó. Un agente que recibe 400 KB no puede usarlos, y el que los pidió no se entera de que le
 * faltó la mitad.
 *
 * Regla 2 — **el conteo de competidores se lee de datos que no controlamos**. `competitorsMentioned` es
 * `json` en Postgres: puede ser una lista de textos, de objetos, o basura. Se lee defensivamente y lo
 * que no se entiende se ignora en vez de romper el tool entero.
 */

import type { McpToolResult } from "../jsonrpc";

/** Tope de filas que devuelve una lectura. Más que esto no lo lee nadie, y sí lo sufre el transporte. */
export const MAX_LIMIT = 100;

/** Recorte de un campo de texto largo (una `why`, un `summary`) antes de publicarlo. */
export const MAX_TEXT = 1200;

export function json(value: unknown): string {
	return JSON.stringify(value, null, 2);
}

/** Un resultado que **sí** es un error de negocio: el llamador tiene que leer el motivo y corregir. */
export function errorResult(text: string, structuredContent?: unknown): McpToolResult {
	return structuredContent === undefined
		? { content: [{ type: "text", text }], isError: true }
		: { content: [{ type: "text", text }], structuredContent, isError: true };
}

export interface TruncatedText {
	text: string;
	truncated: boolean;
}

/** Corta un texto largo y **dice** que lo cortó: un resumen silencioso se lee como el texto completo. */
export function truncateText(value: unknown, max = MAX_TEXT): TruncatedText {
	if (typeof value !== "string") return { text: "", truncated: false };
	if (value.length <= max) return { text: value, truncated: false };
	return { text: `${value.slice(0, max)}…`, truncated: true };
}

/**
 * Los nombres de competidores de una observación de APS.
 *
 * El jurado guarda `competitorsMentioned` como `string[]`, pero la columna es `json`: una fila vieja o
 * escrita a mano puede traer objetos. Se aceptan las dos formas y se descarta lo demás.
 */
export function readCompetitorNames(raw: unknown): string[] {
	if (Array.isArray(raw) === false) return [];
	const names: string[] = [];
	for (const entry of raw) {
		if (typeof entry === "string") {
			const trimmed = entry.trim();
			if (trimmed.length > 0) names.push(trimmed);
			continue;
		}
		if (typeof entry === "object" && entry !== null) {
			const record = entry as Record<string, unknown>;
			const candidate = record.name ?? record.brand ?? record.competitor;
			if (typeof candidate === "string" && candidate.trim().length > 0) names.push(candidate.trim());
		}
	}
	return names;
}

export interface CompetitorCount {
	name: string;
	count: number;
}

/** Ordena de más a menos mencionado y corta en `limit`. El empate se rompe alfabéticamente, no al azar. */
export function rankCounts(counts: Map<string, number>, limit: number): CompetitorCount[] {
	return [...counts.entries()]
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => (a.count === b.count ? a.name.localeCompare(b.name) : b.count - a.count))
		.slice(0, limit);
}
