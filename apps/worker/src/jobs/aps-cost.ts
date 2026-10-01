/**
 * El costo real de una corrida APS, leído de `provider_calls`.
 *
 * Una corrida APS son dos gastos distintos y hay que poder verlos por separado:
 * las **llamadas de medición** (los modelos que responden las preguntas) y las
 * **llamadas del juez** (el gateway que parsea cada respuesta). Los dos van a
 * `provider_calls`, que ya registraba cada llamada pero sin costo ni tokens.
 *
 * El costo de la medición es el número que **no existía en ningún lado** y que
 * Jorge necesita para fijar el precio de su producto, así que este módulo existe
 * para que ese número se pueda leer, no para que se pueda adivinar.
 */

import { type ApsRunCostTotals, sumProviderCallCosts } from "@workspace/aos-aps/aps";
import { db } from "@workspace/lib/db/db";
import { providerCalls } from "@workspace/lib/db/schema";
import { eq } from "drizzle-orm";

export interface ApsRunRealCost {
	measurement: ApsRunCostTotals;
	judge: ApsRunCostTotals;
}

interface CallRow {
	kind: string;
	costUsd: string | null;
}

/** `cost_usd` es `numeric` y Drizzle lo devuelve como string; `null` se conserva como `null`. */
function toCost(value: string | null): number | null {
	if (value === null) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Suma —sin inventar lo que falta— el costo de todas las llamadas de la corrida.
 *
 * La llamada del juez se registra con `kind: "aps_judge"`; cualquier otro `kind`
 * de esta corrida es medición. La distinción importa porque el juez sí pasa por
 * el gateway y por lo tanto sí tiene costo real, mientras la medición puede no
 * tenerlo: ver los dos números separados es lo que permite decir **cuál** mitad
 * está sin costear.
 */
export async function readApsRunRealCost(runId: string): Promise<ApsRunRealCost> {
	const rows: CallRow[] = await db
		.select({ kind: providerCalls.kind, costUsd: providerCalls.costUsd })
		.from(providerCalls)
		.where(eq(providerCalls.agentApsRunId, runId));

	const asRows = (filter: (kind: string) => boolean) =>
		sumProviderCallCosts(rows.filter((row) => filter(row.kind)).map((row) => ({ costUsd: toCost(row.costUsd) })));

	return {
		measurement: asRows((kind) => kind !== "aps_judge"),
		judge: asRows((kind) => kind === "aps_judge"),
	};
}

/**
 * Las columnas de costo de `agent_aps_runs` para un par medición/juez.
 *
 * Se escribe el número **solo cuando está completo**. `actual_measurement_usd`
 * queda en `null` si alguna llamada de medición no reportó costo, y
 * `unpriced_calls` guarda cuántas fueron: así el dato que se lee nunca es un
 * total que parece terminado y no lo es.
 *
 * El total de la corrida no se guarda como columna propia: es la suma de las dos
 * mitades y se calcula al leer, donde además se decide el veredicto contra el
 * estimado (`compareEstimatedToActual`). Una tercera copia sería un número más
 * que puede quedar desincronizado.
 */
export function costColumnsFrom(cost: ApsRunRealCost) {
	return {
		actualMeasurementUsd: cost.measurement.costUsd === null ? null : String(cost.measurement.costUsd),
		actualJudgeUsd: cost.judge.costUsd === null ? null : String(cost.judge.costUsd),
		unpricedCalls: cost.measurement.unpricedCalls + cost.judge.unpricedCalls,
		costedCalls: cost.measurement.calls + cost.judge.calls,
	};
}
