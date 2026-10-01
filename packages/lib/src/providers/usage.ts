/**
 * Billable-call accounting for upstream providers.
 *
 * Every `Provider.run()` / `runStructuredResearch()` is one billable unit —
 * one Olostep scrape, one chat completion — so this module wraps those calls
 * and writes a `provider_calls` row per attempt. The admin usage page reads
 * those rows back; the point is to have a number to hold against a vendor's
 * invoice.
 *
 * Recording is best-effort by design: a logging failure must never take down
 * the run that was being logged, so `recordProviderCall` swallows its own
 * errors after warning.
 *
 * ## El costo y por qué tiene tres estados
 *
 * `costUsd` es el precio **real** de la llamada, no una estimación. Se llena
 * con el número que ya facturó el gateway (`x-litellm-response-cost`) o con el
 * que el propio proveedor informa (OpenRouter). Cuando no se puede obtener,
 * queda `null` — **nunca `0`**: `0` afirma "esta llamada salió gratis" y `null`
 * dice "no lo sé". Un total construido con ceros inventados parece completo y
 * miente, que es exactamente el problema que este campo viene a arreglar.
 *
 * `pricingSource` dice **por qué** hay o no hay costo, porque las dos ausencias
 * no son la misma: un scraper no puede reportar costo (no hay arreglo de código
 * que lo cambie) y un proveedor que reporta tokens sin tarifa deja el dato a
 * medio camino (`tokens_only`: falta la tarifa del modelo para convertirlo en
 * dólares, y esa tarifa no vive en el sistema).
 */
import { db } from "../db/db";
import { providerCalls } from "../db/schema";
import type { ProviderUsage } from "./types";

export type ProviderCallKind = "run" | "research" | "aps_judge";

/** De dónde salió el costo. `null` cuando no hay costo. Ver el comentario del módulo. */
export type PricingSource = "gateway_header" | "provider" | "tokens_only";

/**
 * Lo que una llamada terminada sabe de su costo y su consumo.
 *
 * Es un objeto y no cinco parámetros sueltos para que el llamador que no tiene
 * nada que informar simplemente no lo pase: la ausencia es el default, y el
 * default se persiste como `null`.
 */
export interface ProviderCallCost {
	/** Costo real en USD, o `null`/ausente cuando no se pudo obtener. */
	costUsd?: number | null;
	/** De dónde salió el costo. Obligatorio si hay `costUsd`. */
	pricingSource?: PricingSource | null;
	usage?: ProviderUsage;
}

export interface ProviderCallRecord {
	provider: string;
	model: string;
	kind: ProviderCallKind;
	brandId?: string | null;
	/** Set for tracked prompt runs; null for reports and onboarding research. */
	promptId?: string | null;
	/** La corrida APS dueña de la llamada, para poder sumar su costo real. Null fuera de APS. */
	agentApsRunId?: string | null;
	success: boolean;
	errorMessage?: string | null;
	durationMs?: number;
	/** Costo real y tokens de la llamada. Ausente cuando el camino no los conoce. */
	cost?: ProviderCallCost;
}

/** Error text is only ever read by a human in the admin table. */
const MAX_ERROR_CHARS = 500;

/**
 * Redondeo a diez decimales, que es la escala de la columna.
 *
 * Un costo unitario de gateway es del orden de 1e-5 y Postgres redondearía igual,
 * así que el redondeo acá no pierde nada y evita que el valor en memoria y el
 * valor persistido difieran al compararlos en un test.
 */
function roundCost(usd: number): number {
	return Math.round(usd * 1e10) / 1e10;
}

export async function recordProviderCall(record: ProviderCallRecord): Promise<void> {
	const cost = record.cost;
	// Un costo sin origen no se guarda: el número solo no se puede auditar, y
	// `pricing_source` es lo que distingue "no lo capturamos" de "no lo reporta".
	const hasCost = typeof cost?.costUsd === "number" && cost.pricingSource !== undefined && cost.pricingSource !== null;
	try {
		await db.insert(providerCalls).values({
			provider: record.provider,
			model: record.model,
			kind: record.kind,
			brandId: record.brandId ?? null,
			promptId: record.promptId ?? null,
			agentApsRunId: record.agentApsRunId ?? null,
			success: record.success,
			errorMessage: record.errorMessage?.slice(0, MAX_ERROR_CHARS) ?? null,
			durationMs: record.durationMs,
			costUsd: hasCost ? String(roundCost(cost.costUsd as number)) : null,
			pricingSource: hasCost ? (cost.pricingSource as PricingSource) : null,
			promptTokens: cost?.usage?.promptTokens ?? null,
			completionTokens: cost?.usage?.completionTokens ?? null,
			reasoningTokens: cost?.usage?.reasoningTokens ?? null,
		});
	} catch (err) {
		console.warn("[provider-usage] failed to record call:", err);
	}
}

/**
 * Lee costo y tokens de un resultado de proveedor.
 *
 * Existe para que los cuatro caminos que registran llamadas no repitan la misma
 * traducción de `ScrapeResult` a `ProviderCallCost`. Un resultado sin `usage` ni
 * `costUsd` (un scraper) devuelve `undefined`, y con eso el registro queda con
 * `cost_usd` en `null` y `pricing_source` en `null`: el dato no se inventa.
 */
export function callCostFromResult(result: { usage?: ProviderUsage; costUsd?: number }): ProviderCallCost | undefined {
	const usage = result.usage;
	const hasUsage =
		usage !== undefined &&
		(usage.promptTokens !== undefined || usage.completionTokens !== undefined || usage.reasoningTokens !== undefined);
	const hasCost = typeof result.costUsd === "number" && Number.isFinite(result.costUsd) && result.costUsd >= 0;
	if (hasCost === false && hasUsage === false) return undefined;
	// Sin costo pero con tokens: el proveedor reporta consumo y no precio. Se dice
	// `tokens_only` en vez de dejar el origen en blanco, porque esa es la mitad del
	// sistema donde el costo todavía no se puede derivar.
	const pricingSource: PricingSource | null = hasCost ? "provider" : "tokens_only";
	return {
		...(hasCost ? { costUsd: result.costUsd as number } : {}),
		pricingSource: hasCost || hasUsage ? pricingSource : null,
		...(hasUsage ? { usage } : {}),
	};
}

/**
 * Run `fn` and record one call against it, whether it resolves or throws.
 *
 * The original error is always rethrown — the counter is an observer, never a
 * gate on the work it observes.
 *
 * `costOf` recibe el resultado **recién cuando salió bien**: el costo y los
 * tokens son cosas que devuelve la respuesta, así que una llamada que falló no
 * tiene ninguno de los dos y se registra con `null`. Eso es correcto y no una
 * pérdida: un error no facturado no tiene costo que guardar.
 */
export async function withProviderCallTracking<T>(
	meta: Omit<ProviderCallRecord, "success" | "errorMessage" | "durationMs" | "cost">,
	fn: () => Promise<T>,
	costOf?: (result: T) => ProviderCallCost | undefined,
): Promise<T> {
	const startedAt = Date.now();
	try {
		const result = await fn();
		const cost = costOf?.(result);
		await recordProviderCall({ ...meta, success: true, durationMs: Date.now() - startedAt, ...(cost ? { cost } : {}) });
		return result;
	} catch (err) {
		await recordProviderCall({
			...meta,
			success: false,
			errorMessage: err instanceof Error ? err.message : String(err),
			durationMs: Date.now() - startedAt,
		});
		throw err;
	}
}
