/**
 * Cómo se cuenta el costo de una corrida en la pantalla.
 *
 * El cálculo —cuántas llamadas quedaron sin costo, si el total está completo,
 * cuánto se parece el real al estimado— **no vive acá**: vive en
 * `@workspace/aos-aps/aps` (`compareEstimatedToActual`), que es el mismo módulo
 * que usa el worker. Acá solo está el texto, porque una diferencia de costo sin
 * una frase que diga qué hacer con el precio deja el número puesto a mano
 * exactamente igual que antes.
 */

/**
 * La comparación tal como viaja a la pantalla. Espeja `ApsCostComparison` del
 * dominio: si el dominio agrega un veredicto, acá falta y TypeScript lo dice.
 */
export interface ApsCostComparisonView {
	estimatedUsd: number | null;
	measurementUsd: number | null;
	judgeUsd: number | null;
	/** Total real, o `null` cuando falta el costo de alguna llamada. */
	totalUsd: number | null;
	/** Cota inferior cuando el total está incompleto. Nunca se presenta como el total. */
	pricedUsd: number;
	unpricedCalls: number;
	totalCalls: number;
	ratio: number | null;
	verdict: "estimated_ok" | "estimated_low" | "estimated_high" | "incomplete" | "unknown";
}

/** USD con la precisión que importa: un total de corrida vive entre 1e-4 y 1e+1. */
export function formatUsd(value: number | null): string {
	if (value === null) return "—";
	if (value === 0) return "USD 0";
	const decimals = Math.abs(value) < 0.01 ? 6 : 4;
	return `USD ${value.toFixed(decimals).replace(/0+$/, "").replace(/\.$/, "")}`;
}

/**
 * Qué decir cuando el real no coincide con el estimado.
 *
 * Cada frase dice **qué hacer con el precio**, porque el problema de fondo no era
 * ver la diferencia: era que el precio de `APS_PRICES` no tenía con qué
 * contrastarse. Un veredicto sin acción deja el número puesto a mano igual que
 * antes.
 */
export function costVerdictNote(cost: ApsCostComparisonView): string {
	switch (cost.verdict) {
		case "estimated_ok":
			return "El precio por llamada estaba bien: el real quedó dentro del 20% del estimado.";
		case "estimated_low":
			return "El real salió más caro que el estimado. El precio por llamada está bajo y hay que subirlo, o el tope de la corrida se rechaza solo.";
		case "estimated_high":
			return "El real salió más barato que el estimado. El precio por llamada está alto y está frenando corridas que sí entrarían en el presupuesto.";
		case "incomplete":
			return "No se puede comparar: hay llamadas sin costo, así que este total está incompleto y no es un total.";
		case "unknown":
			return "No se puede comparar todavía: falta el estimado o el total real.";
	}
}

/**
 * La línea de costo completa, ya redactada.
 *
 * Existe separada del componente para poder testear el texto —sobre todo el
 * "N de M llamadas sin costo", que es lo que impide leer una suma parcial como si
 * fuera el total— sin montar React.
 */
export function costLineText(cost: ApsCostComparisonView): {
	real: string;
	calls: string;
	split: string;
	note: string;
} {
	const incomplete = cost.verdict === "incomplete";
	return {
		real: incomplete ? `al menos ${formatUsd(cost.pricedUsd)}` : formatUsd(cost.totalUsd),
		calls:
			cost.totalCalls === 0
				? "sin llamadas registradas"
				: `${cost.totalCalls} llamadas${incomplete ? `, ${cost.unpricedCalls} sin costo` : ""}`,
		split: `Medición ${formatUsd(cost.measurementUsd)} · juez ${formatUsd(cost.judgeUsd)}.`,
		note: costVerdictNote(cost),
	};
}
