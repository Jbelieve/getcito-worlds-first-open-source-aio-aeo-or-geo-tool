/**
 * Estimado contra real: el número que hoy nadie compara.
 *
 * `estimateApsRun` estima **antes** de gastar, con los precios que están en
 * `APS_PRICES`. Hasta ahora nada comparaba ese estimado con lo que la corrida
 * costó de verdad, y por eso un precio puesto a mano —`0,05` por llamada— podía
 * sobrevivir indefinidamente sin que nadie lo notara: no había con qué
 * contradecirlo.
 *
 * Acá vive esa comparación, en código puro y con una sola regla dura: **un total
 * incompleto se declara incompleto**. Si alguna llamada no reportó costo, el
 * total real es `null` y `unpricedCalls` dice cuántas faltan. Mostrar la suma de
 * las que sí sabemos como si fuera el total es la misma mentira de siempre —un
 * número que parece terminado— con otro nombre.
 */

/**
 * La suma de las llamadas de una corrida.
 *
 * `costUsd` es `null` cuando **al menos una** llamada quedó sin costo: un total
 * con huecos no es un total, es una cota inferior, y la decisión de mostrarlo
 * como cota o no mostrarlo la toma quien presenta el dato, no este módulo.
 */
export interface ApsRunCostTotals {
	/** Cantidad de llamadas registradas para la corrida. */
	calls: number;
	/** Cuántas de esas llamadas no tienen costo conocido. */
	unpricedCalls: number;
	/** Suma de las llamadas **con** costo (incluye las que costaron 0). */
	pricedUsd: number;
	/** Total real, o `null` si falta el costo de alguna llamada. */
	costUsd: number | null;
}

/** Una fila de `provider_calls` reducida a lo que hace falta para sumar. */
export interface ProviderCallCostRow {
	/** `cost_usd` tal como sale de la base: `null` es "no lo sé". */
	costUsd: number | null;
}

/** Redondeo a seis decimales: un costo unitario de gateway es del orden de 1e-5. */
function round6(value: number): number {
	return Math.round(value * 1e6) / 1e6;
}

/**
 * Suma los costos de una lista de llamadas sin inventar los que faltan.
 *
 * Una llamada con costo `0` es una llamada **conocida y gratis** y no cuenta como
 * faltante; una con `null` sí. Esa distinción es todo el punto: por eso
 * `cost_usd` es nullable y nunca se persiste un `0` para decir "no lo sé".
 */
export function sumProviderCallCosts(rows: ProviderCallCostRow[]): ApsRunCostTotals {
	let unpricedCalls = 0;
	let pricedUsd = 0;
	for (const row of rows) {
		if (row.costUsd === null || Number.isFinite(row.costUsd) === false) {
			unpricedCalls += 1;
			continue;
		}
		pricedUsd += row.costUsd;
	}
	return {
		calls: rows.length,
		unpricedCalls,
		pricedUsd: round6(pricedUsd),
		costUsd: unpricedCalls === 0 ? round6(pricedUsd) : null,
	};
}

export type ApsCostVerdict = "estimated_ok" | "estimated_low" | "estimated_high" | "incomplete" | "unknown";

/**
 * Hasta dónde se parece el real al estimado antes de que haya que corregir el precio.
 *
 * ±20% es deliberadamente ancho: un precio por llamada es un promedio de precios
 * que varían por prompt y por razonamiento, así que una diferencia chica es ruido
 * y no una señal.
 */
export const APS_COST_MISMATCH_THRESHOLD = 0.2;

export interface ApsCostComparison {
	estimatedUsd: number | null;
	measurementUsd: number | null;
	judgeUsd: number | null;
	/** Total real, o `null` cuando falta el costo de alguna llamada. */
	totalUsd: number | null;
	/**
	 * La suma de las llamadas **con** costo, incluidas las que costaron 0.
	 *
	 * Existe para poder decir "al menos tanto" cuando el total está incompleto. No es el total y
	 * no se presenta como tal: es la cota inferior que el dato permite afirmar.
	 */
	pricedUsd: number;
	unpricedCalls: number;
	totalCalls: number;
	/** `actual / estimated`. Null cuando falta alguno de los dos, o el estimado es 0. */
	ratio: number | null;
	verdict: ApsCostVerdict;
}

export interface ApsCostComparisonInput {
	/** Lo que la corrida estimó, en USD. Null cuando la corrida no tiene estimado guardado. */
	estimatedUsd: number | null;
	/** Totales reales de las llamadas de medición y del juez, por separado. */
	measurement: ApsRunCostTotals;
	judge: ApsRunCostTotals;
}

/**
 * Compara estimado contra real y dice si el precio estaba bien.
 *
 * Los veredictos no son decorativos:
 *   - `incomplete`: hay llamadas sin costo. **No se afirma nada sobre el precio**,
 *     porque el total real no existe. Es el estado de una corrida con modelos que
 *     no pasan por el gateway.
 *   - `unknown`: no hay estimado guardado, así que no hay contra qué comparar.
 *   - `estimated_ok` / `estimated_low` / `estimated_high`: hay estimado y total real,
 *     y la diferencia supera (o no) el umbral.
 */
export function compareEstimatedToActual(input: ApsCostComparisonInput): ApsCostComparison {
	const totalCalls = input.measurement.calls + input.judge.calls;
	const unpricedCalls = input.measurement.unpricedCalls + input.judge.unpricedCalls;
	// El total real solo existe si las DOS mitades están completas: un juez completo
	// con una medición a la que le faltan llamadas no da un total.
	const totalUsd =
		input.measurement.costUsd === null || input.judge.costUsd === null
			? null
			: round6(input.measurement.costUsd + input.judge.costUsd);

	const base: Omit<ApsCostComparison, "ratio" | "verdict"> = {
		estimatedUsd: input.estimatedUsd,
		measurementUsd: input.measurement.costUsd,
		judgeUsd: input.judge.costUsd,
		totalUsd,
		pricedUsd: round6(input.measurement.pricedUsd + input.judge.pricedUsd),
		unpricedCalls,
		totalCalls,
	};

	if (unpricedCalls > 0) return { ...base, ratio: null, verdict: "incomplete" };
	if (input.estimatedUsd === null || totalUsd === null) return { ...base, ratio: null, verdict: "unknown" };

	// Un estimado de 0 no tiene ratio: dividir por cero no dice "coincide", dice nada.
	const ratio = input.estimatedUsd === 0 ? null : totalUsd / input.estimatedUsd;
	if (ratio === null) return { ...base, ratio: null, verdict: "unknown" };

	const difference = (totalUsd - input.estimatedUsd) / input.estimatedUsd;
	if (Math.abs(difference) <= APS_COST_MISMATCH_THRESHOLD) return { ...base, ratio, verdict: "estimated_ok" };
	return { ...base, ratio, verdict: difference > 0 ? "estimated_low" : "estimated_high" };
}
