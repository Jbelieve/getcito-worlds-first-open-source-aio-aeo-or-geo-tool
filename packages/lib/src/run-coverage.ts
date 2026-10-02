/**
 * Cobertura de una medición: cuántos intentos se planearon, cuántos respondieron y
 * cuántos no.
 *
 * Existe por el mismo motivo que el costo real (`packages/aos-aps/src/aps/cost.ts`):
 * **un número que parece completo y no lo es**. Hasta ahora un fallo de proveedor en
 * la capa de visibilidad no dejaba fila —solo una entrada en telemetría y una línea
 * de log— así que el Share of Voice se calculaba dividiendo por las corridas que
 * salieron bien. El efecto era perverso y estaba a la vista: **una caída de proveedor
 * no aparecía como fallo, hacía que el porcentaje se viera mejor**.
 *
 * Acá vive la regla, en código puro y sin IO para que se pueda probar aislada:
 *
 *   - Un fallo cuenta como intento y **baja** el porcentaje. La proporción se calcula
 *     sobre los intentos, no sobre los éxitos: si de 9 corridas planificadas solo 6
 *     respondieron, el denominador es 9.
 *   - Un porcentaje sin su cobertura es una opinión, así que el resultado viaja con
 *     `label` ("N de M corridas no respondieron").
 *   - El estado del punto es `complete | partial | no_data`, igual que el APS
 *     (`packages/aos-aps/src/aps/runPlan.ts:148` — `isRunComplete`).
 *
 * Lo que este módulo **no** hace es inventar los intentos que faltan. Ver
 * `VERIFIABLE_COVERAGE_SINCE`.
 */

/**
 * A partir de qué momento la cobertura de la capa de visibilidad es confiable.
 *
 * Antes de esta fecha los fallos **no dejaron fila** (`prompt_runs` solo guardaba las
 * corridas que salieron bien; el único rastro durable era
 * `provider_calls.success = false`), así que el denominador histórico está incompleto
 * y **no se puede reconstruir**: los intentos que faltan no están en ninguna parte.
 *
 * No se corrige en silencio y no se rellenan los intentos que faltan. Un ciclo
 * anterior a esta fecha —o cualquier ciclo sin filas de intentos— se declara
 * `unverifiable` (`isCoverageVerifiable === false`), que es la misma disciplina con la
 * que el costo declara su total incompleto (`APS veredicto "incomplete"`).
 *
 * La fecha marca el día en que esta máquina empezó a registrar la cobertura; un ciclo
 * posterior que igual no tenga intentos tampoco se da por completo: se declara
 * `no_data`, nunca `complete`.
 */
export const VERIFIABLE_COVERAGE_SINCE = "2026-10-02";

/** Los tres estados de un punto, más el histórico que no se puede verificar. */
export type PointState = "complete" | "partial" | "no_data" | "unverifiable";

/** Lo que aporta quien ejecutó la medición: intentos planeados, exitosos y fallidos. */
export interface RunCoverage {
	/** Intentos planificados para este punto. */
	planned: number;
	/** Intentos que terminaron con una respuesta guardada. */
	succeeded: number;
	/** Intentos que fallaron y **no** dejaron fila de resultado. */
	failed: number;
}

export interface CoverageSummary {
	/** Porcentaje de intentos que respondieron, 0-100. `null` si no hay intentos. */
	responseRate: number | null;
	/** "N de M corridas no respondieron", listo para mostrar junto al porcentaje. */
	label: string;
	state: PointState;
	/** `false` cuando el denominador histórico no se puede reconstruir. */
	isCoverageVerifiable: boolean;
}

/**
 * Resume la cobertura sin redondear hacia arriba.
 *
 * `planned` puede venir del ejecutor o deducirse de `succeeded + failed`; un `planned`
 * menor que la suma es una inconsistencia real y se resuelve a favor del denominador
 * más grande, porque quedarse corto es exactamente el bug que esto arregla.
 */
export function summarizeCoverage(coverage: RunCoverage): CoverageSummary {
	const succeeded = Math.max(0, coverage.succeeded);
	const failed = Math.max(0, coverage.failed);
	const planned = Math.max(coverage.planned, succeeded + failed);
	const attempts = planned;

	if (attempts === 0) {
		return {
			responseRate: null,
			label: "Sin corridas planificadas.",
			state: "no_data",
			isCoverageVerifiable: false,
		};
	}

	return {
		responseRate: Math.round((succeeded / attempts) * 100),
		label: `${failed} de ${attempts} corridas no respondieron`,
		state: failed === 0 ? "complete" : "partial",
		isCoverageVerifiable: true,
	};
}

/**
 * La cobertura de un histórico que no trae intentos: se declara incompleta, no se
 * rellena.
 *
 * El mensaje dice **por qué** falta el dato, porque "no hay cobertura" a secas se
 * confunde con "todas respondieron".
 */
export function unverifiableCoverage(reason?: string): CoverageSummary {
	return {
		responseRate: null,
		label: reason ?? "No se registraron los intentos de este período: el denominador histórico está incompleto.",
		state: "unverifiable",
		isCoverageVerifiable: false,
	};
}

/** Un ciclo de medición tal como quedó registrado, con el día al que pertenece. */
export interface CoverageCycle {
	/** Día de la corrida, `YYYY-MM-DD`. Un `null` es un ciclo sin fecha confiable. */
	date: string | null;
	coverage: RunCoverage | null;
}

export interface MeasuredShare {
	/** Marca mencionada entre los intentos que respondieron. */
	mentioned: number;
	/** Intentos de los que salió una respuesta. */
	succeeded: number;
	/** Intentos que fallaron y no dejaron fila de resultado. */
	failed: number;
	/** Intentos planificados; el denominador de `share`. */
	planned: number;
	/**
	 * Marca mencionada sobre **intentos planeados**, 0-100, o `null` sin intentos.
	 *
	 * Es la proporción honesta cuando hay fallos: un proveedor caído aporta al
	 * denominador y nada al numerador, así que el número **baja** en vez de subir. Un
	 * fallo nunca se convierte en "la marca no apareció" (eso sería otro dato falso):
	 * queda contado como intento sin respuesta, y su cobertura se muestra al lado.
	 */
	share: number | null;
	coverage: CoverageSummary;
}

/** Calcula la proporción sobre intentos y le adjunta su cobertura. */
export function measuredShareOfAttempts(input: {
	mentioned: number;
	succeeded: number;
	failed: number;
	planned?: number;
}): MeasuredShare {
	const coverage = summarizeCoverage({
		planned: input.planned ?? input.succeeded + input.failed,
		succeeded: input.succeeded,
		failed: input.failed,
	});
	const attempts = Math.max(input.planned ?? 0, input.succeeded + input.failed);
	return {
		mentioned: input.mentioned,
		succeeded: input.succeeded,
		failed: input.failed,
		planned: attempts,
		share: attempts === 0 ? null : Math.round((input.mentioned / attempts) * 100),
		coverage,
	};
}

/**
 * La cobertura agregada de un histórico, y **desde cuándo** el denominador es confiable.
 *
 * `cycles` con `coverage === null` son el histórico que no se puede reconstruir: se
 * cuentan aparte y la etiqueta lo dice, en vez de sumarlos como si tuvieran cero
 * fallos. Si no hay ningún ciclo con intentos, el resultado entero es `unverifiable`.
 */
export function summarizeCycleCoverage(
	cycles: CoverageCycle[],
	options: { verifiableSince?: string } = {},
): CoverageSummary & { verifiableSince: string; unverifiableCycles: number } {
	const verifiableSince = options.verifiableSince ?? VERIFIABLE_COVERAGE_SINCE;
	let planned = 0;
	let succeeded = 0;
	let failed = 0;
	let unverifiableCycles = 0;

	for (const cycle of cycles) {
		if (cycle.coverage === null) {
			unverifiableCycles += 1;
			continue;
		}
		planned += cycle.coverage.planned;
		succeeded += cycle.coverage.succeeded;
		failed += cycle.coverage.failed;
	}

	const summary = summarizeCoverage({ planned, succeeded, failed });

	if (summary.state === "no_data") {
		return {
			...unverifiableCoverage(
				`Sin cobertura registrada: ${unverifiableCycles} ciclo(s) anteriores a ${verifiableSince} no dejaron intentos. El denominador histórico está incompleto.`,
			),
			verifiableSince,
			unverifiableCycles,
		};
	}

	const historyNote =
		unverifiableCycles > 0
			? ` · ${unverifiableCycles} ciclo(s) previos a ${verifiableSince} no tienen cobertura: el denominador histórico está incompleto.`
			: "";

	return {
		...summary,
		label: `${summary.label}${historyNote}`,
		verifiableSince,
		unverifiableCycles,
	};
}
