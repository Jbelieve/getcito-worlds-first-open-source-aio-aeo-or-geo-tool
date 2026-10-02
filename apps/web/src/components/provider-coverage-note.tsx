/**
 * La cobertura al lado del porcentaje.
 *
 * Existe porque un Share of Voice sin su cobertura es una opinión: un ciclo con 6 de 9
 * corridas se veía idéntico a uno con 9 de 9, y el porcentaje se calculaba sobre las 6.
 * Un fallo de proveedor no puede hacer que el número se vea mejor.
 *
 * El histórico se declara, no se rellena: cuando la ventana es anterior a que se
 * registraran los intentos, el componente dice que el denominador está incompleto en vez
 * de mostrar un cero de fallos que no se midió.
 */

export interface ProviderCoverageView {
	plannedRuns: number;
	succeededRuns: number;
	failedRuns: number;
	state: "complete" | "partial" | "no_data" | "unverifiable";
	label: string;
	attemptShare?: number | null;
	isCoverageVerifiable: boolean;
}

/**
 * El texto de la cobertura. Puro y exportado para poder probarlo sin renderizar.
 *
 * `null` cuando no hay medición (`no_data`). `no_data` no se declara como completo:
 * "no medí" y "medí todo bien" son cosas distintas.
 */
export function providerCoverageText(coverage: ProviderCoverageView | undefined): string | null {
	if (!coverage) return null;
	if (coverage.state === "no_data") return null;
	if (coverage.isCoverageVerifiable === false) return coverage.label;
	if (coverage.state === "complete") {
		return `${coverage.succeededRuns.toLocaleString()} de ${coverage.plannedRuns.toLocaleString()} corridas respondieron.`;
	}
	return coverage.label;
}

export function ProviderCoverageNote({
	coverage,
	className,
}: {
	coverage: ProviderCoverageView | undefined;
	className?: string;
}) {
	const text = providerCoverageText(coverage);
	if (text === null || coverage === undefined) return null;

	const isWarning = coverage.state === "partial" || coverage.isCoverageVerifiable === false;
	const base =
		className ?? (isWarning ? "text-xs text-amber-600 dark:text-amber-500" : "text-xs text-muted-foreground");

	return (
		<p className={base} data-coverage={coverage.state}>
			{text}
			{coverage.state === "partial" && typeof coverage.attemptShare === "number"
				? ` · ${coverage.attemptShare}% de los intentos mencionó la marca`
				: ""}
		</p>
	);
}
