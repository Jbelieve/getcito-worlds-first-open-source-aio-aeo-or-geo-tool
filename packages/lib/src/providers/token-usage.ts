/**
 * Tokens de una respuesta, en las formas que los proveedores realmente usan.
 *
 * Cada API nombra lo mismo distinto: OpenAI-compatible y el AI SDK hablan de `prompt_tokens` /
 * `completion_tokens`, Anthropic de `input_tokens` / `output_tokens`, y el razonamiento viaja en
 * un sub-objeto que a veces no viene. En vez de que cada proveedor repita la traducción —y que
 * cuatro copias diverjan—, la traducción vive acá y cada uno devuelve su cuerpo crudo.
 *
 * **Nunca convierte "no vino" en `0`.** Un campo ausente queda `undefined`, y quien persiste lo
 * guarda como `null`. Es la misma regla que el costo: `0` es un dato, `null` es "no lo sé".
 */
import type { ProviderUsage } from "./types";

// Re-exportado para que quien solo necesita traducir tokens no tenga que importar
// dos módulos. El tipo vive en `./types` por la misma razón que `ScrapeResult`.
export type { ProviderUsage };

function nonNegativeInteger(value: unknown): number | undefined {
	if (typeof value !== "number" || Number.isFinite(value) === false) return undefined;
	const rounded = Math.trunc(value);
	return rounded >= 0 ? rounded : undefined;
}

function firstInteger(...values: unknown[]): number | undefined {
	for (const value of values) {
		const parsed = nonNegativeInteger(value);
		if (parsed !== undefined) return parsed;
	}
	return undefined;
}

/** ¿Hay algún número? Un objeto vacío no es consumo, es ausencia disfrazada. */
function hasAny(usage: ProviderUsage): boolean {
	return (
		usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.reasoningTokens !== undefined
	);
}

/**
 * Traduce el bloque de consumo de una respuesta a {@link ProviderUsage}.
 *
 * Acepta las cuatro formas que aparecen en este repo:
 *   - `usage.prompt_tokens` / `usage.completion_tokens` (OpenAI-compatible: Azure Foundry,
 *     Mistral, OpenRouter, el gateway de LiteLLM).
 *   - `usage.input_tokens` / `usage.output_tokens` (Anthropic).
 *   - `usage.inputTokens` / `usage.outputTokens` (los `LanguageModelUsage` del AI SDK, que usan
 *     `openai-api` y `anthropic-api`).
 *   - Razonamiento en `completion_tokens_details.reasoning_tokens`,
 *     `output_tokens_details.reasoning_tokens` o `reasoning_tokens` a secas.
 *
 * Devuelve `undefined` cuando no hay ningún número: distinguir "no reportó" de "reportó cero" es
 * la razón de ser de este módulo.
 */
export function usageFromResponse(body: unknown): ProviderUsage | undefined {
	if (body === null || typeof body !== "object") return undefined;
	const usage = (body as { usage?: unknown }).usage;
	if (usage === null || typeof usage !== "object") return undefined;
	const record = usage as Record<string, unknown>;

	const completionDetails =
		record.completion_tokens_details !== null && typeof record.completion_tokens_details === "object"
			? (record.completion_tokens_details as Record<string, unknown>)
			: undefined;
	const outputDetails =
		record.output_tokens_details !== null && typeof record.output_tokens_details === "object"
			? (record.output_tokens_details as Record<string, unknown>)
			: undefined;

	const parsed: ProviderUsage = {
		promptTokens: firstInteger(record.prompt_tokens, record.input_tokens, record.inputTokens),
		completionTokens: firstInteger(record.completion_tokens, record.output_tokens, record.outputTokens),
		reasoningTokens: firstInteger(
			completionDetails?.reasoning_tokens,
			outputDetails?.reasoning_tokens,
			record.reasoning_tokens,
		),
	};

	return hasAny(parsed) ? parsed : undefined;
}

/**
 * El costo que el **propio proveedor** informa en su respuesta, si lo informa.
 *
 * Hoy lo hace OpenRouter (`usage.cost`, en créditos equivalentes a USD). El gateway no pasa por
 * acá: su costo viene en `x-litellm-response-cost`, que se lee del header y no del cuerpo. Un
 * valor ausente, no numérico o negativo es `undefined` — nunca `0`, que significaría "fue gratis".
 */
export function costFromResponse(body: unknown): number | undefined {
	if (body === null || typeof body !== "object") return undefined;
	const usage = (body as { usage?: unknown }).usage;
	if (usage === null || typeof usage !== "object") return undefined;
	const cost = (usage as { cost?: unknown }).cost;
	if (typeof cost !== "number" || Number.isFinite(cost) === false || cost < 0) return undefined;
	return cost;
}
