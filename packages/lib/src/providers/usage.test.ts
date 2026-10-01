/**
 * El costo y los tokens de una llamada, tal como salen del proveedor.
 *
 * La regla que estos tests protegen: **"no vino" no es `0`**. Un costo desconocido
 * se guarda `null` y un token desconocido también, porque `0` afirma un dato que
 * nadie midió. El caso concreto que lo motivó es el precio de `APS_PRICES`: con
 * ceros inventados, un total parece completo y miente.
 */
import { describe, expect, it } from "vitest";
import { costFromResponse, usageFromResponse } from "./token-usage";
import { callCostFromResult } from "./usage";

describe("usageFromResponse", () => {
	it("lee el formato OpenAI-compatible", () => {
		expect(usageFromResponse({ usage: { prompt_tokens: 812, completion_tokens: 140 } })).toEqual({
			promptTokens: 812,
			completionTokens: 140,
		});
	});

	it("lee el formato de Anthropic", () => {
		expect(usageFromResponse({ usage: { input_tokens: 500, output_tokens: 200 } })).toEqual({
			promptTokens: 500,
			completionTokens: 200,
		});
	});

	it("lee el formato del AI SDK", () => {
		expect(usageFromResponse({ usage: { inputTokens: 10, outputTokens: 20 } })).toEqual({
			promptTokens: 10,
			completionTokens: 20,
		});
	});

	it("separa el razonamiento, que es costo puro", () => {
		expect(
			usageFromResponse({
				usage: { prompt_tokens: 1, completion_tokens: 2, completion_tokens_details: { reasoning_tokens: 940 } },
			}),
		).toEqual({ promptTokens: 1, completionTokens: 2, reasoningTokens: 940 });
	});

	it("sin usage devuelve undefined, no ceros", () => {
		expect(usageFromResponse({})).toBeUndefined();
		expect(usageFromResponse({ usage: {} })).toBeUndefined();
		expect(usageFromResponse({ usage: { prompt_tokens: "812" } })).toBeUndefined();
		expect(usageFromResponse(null)).toBeUndefined();
	});

	it("un cero reportado por el proveedor sí es cero", () => {
		expect(usageFromResponse({ usage: { prompt_tokens: 0, completion_tokens: 0 } })).toEqual({
			promptTokens: 0,
			completionTokens: 0,
		});
	});
});

describe("costFromResponse", () => {
	it("lee el costo que informa OpenRouter", () => {
		expect(costFromResponse({ usage: { cost: 0.00042 } })).toBeCloseTo(0.00042, 10);
	});

	it("sin costo devuelve undefined, nunca cero", () => {
		expect(costFromResponse({ usage: { prompt_tokens: 10 } })).toBeUndefined();
		expect(costFromResponse({ usage: { cost: "0.5" } })).toBeUndefined();
		expect(costFromResponse({ usage: { cost: -1 } })).toBeUndefined();
		expect(costFromResponse({})).toBeUndefined();
	});

	it("un costo de cero es un dato: la llamada entró en el plan", () => {
		expect(costFromResponse({ usage: { cost: 0 } })).toBe(0);
	});
});

describe("callCostFromResult", () => {
	it("un resultado sin tokens ni costo no produce nada que guardar", () => {
		expect(callCostFromResult({})).toBeUndefined();
	});

	it("con tokens y sin costo dice que el costo no se puede derivar sin tarifa", () => {
		// Este es el estado real de los modelos de medición: el proveedor reporta el
		// consumo y no el precio, así que el costo queda null y el origen lo declara.
		expect(callCostFromResult({ usage: { promptTokens: 500, completionTokens: 1200 } })).toEqual({
			pricingSource: "tokens_only",
			usage: { promptTokens: 500, completionTokens: 1200 },
		});
	});

	it("con costo del proveedor lo marca como medido y no como derivado", () => {
		expect(callCostFromResult({ costUsd: 0.00042, usage: { promptTokens: 10, completionTokens: 20 } })).toEqual({
			costUsd: 0.00042,
			pricingSource: "provider",
			usage: { promptTokens: 10, completionTokens: 20 },
		});
	});

	it("un costo inválido no se convierte en cero: cae al camino de tokens", () => {
		expect(callCostFromResult({ costUsd: Number.NaN, usage: { promptTokens: 1 } })).toEqual({
			pricingSource: "tokens_only",
			usage: { promptTokens: 1 },
		});
		expect(callCostFromResult({ costUsd: -1 })).toBeUndefined();
	});
});
