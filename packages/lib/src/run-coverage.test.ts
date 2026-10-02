import { describe, expect, it } from "vitest";
import {
	type CoverageCycle,
	measuredShareOfAttempts,
	summarizeCoverage,
	summarizeCycleCoverage,
	unverifiableCoverage,
	VERIFIABLE_COVERAGE_SINCE,
} from "./run-coverage";

/**
 * El bug que estos tests cierran: un fallo de proveedor no dejaba fila, así que el
 * denominador eran las corridas que salieron bien y una caída **subía** el número.
 */
describe("measuredShareOfAttempts — un fallo baja el porcentaje", () => {
	it("cuenta el fallo como intento: el mismo numerador sobre 9 en vez de 6", () => {
		// 6 respuestas y 3 caídas: 4 de las 6 respuestas mencionan la marca.
		const onAttempts = measuredShareOfAttempts({ mentioned: 4, succeeded: 6, failed: 3 });

		// 4/9, no 4/6. El número baja cuando el proveedor falla.
		expect(onAttempts.share).toBe(44);
		expect(onAttempts.planned).toBe(9);
		expect(onAttempts.succeeded).toBe(6);
		expect(onAttempts.failed).toBe(3);
		expect(onAttempts.share).toBeLessThan(Math.round((4 / 6) * 100));
	});

	it("el mismo conjunto de éxitos da un porcentaje más bajo cuanto más falla", () => {
		const healthy = measuredShareOfAttempts({ mentioned: 4, succeeded: 6, failed: 0 });
		const degraded = measuredShareOfAttempts({ mentioned: 4, succeeded: 6, failed: 3 });
		const broken = measuredShareOfAttempts({ mentioned: 4, succeeded: 6, failed: 12 });

		expect(healthy.share).toBe(67);
		expect(degraded.share).toBe(44);
		expect(broken.share).toBe(22);
		expect(healthy.share!).toBeGreaterThan(degraded.share!);
		expect(degraded.share!).toBeGreaterThan(broken.share!);
	});

	it("sin intentos no hay porcentaje: null, nunca 0", () => {
		const none = measuredShareOfAttempts({ mentioned: 0, succeeded: 0, failed: 0 });
		expect(none.share).toBeNull();
		expect(none.coverage.state).toBe("no_data");
	});

	it("un fallo no se convierte en 'la marca no apareció': el numerador no se toca", () => {
		const withFailure = measuredShareOfAttempts({ mentioned: 4, succeeded: 6, failed: 3 });
		expect(withFailure.mentioned).toBe(4);
	});
});

describe("summarizeCoverage — la cobertura se declara", () => {
	it("publica 'N de M corridas no respondieron', no solo el porcentaje", () => {
		const summary = summarizeCoverage({ planned: 9, succeeded: 6, failed: 3 });
		expect(summary.label).toBe("3 de 9 corridas no respondieron");
		expect(summary.responseRate).toBe(67);
		expect(summary.state).toBe("partial");
		expect(summary.isCoverageVerifiable).toBe(true);
	});

	it("un punto sin fallos es `complete`, como `isRunComplete` en el APS", () => {
		const summary = summarizeCoverage({ planned: 9, succeeded: 9, failed: 0 });
		expect(summary.state).toBe("complete");
		expect(summary.label).toBe("0 de 9 corridas no respondieron");
		expect(summary.isCoverageVerifiable).toBe(true);
	});

	it("planned corto no encoge el denominador: manda succeeded + failed", () => {
		const summary = summarizeCoverage({ planned: 6, succeeded: 6, failed: 3 });
		expect(summary.label).toBe("3 de 9 corridas no respondieron");
		expect(summary.responseRate).toBe(67);
	});

	it("sin corridas planificadas es `no_data`, y no se declara verificable", () => {
		const summary = summarizeCoverage({ planned: 0, succeeded: 0, failed: 0 });
		expect(summary.state).toBe("no_data");
		expect(summary.responseRate).toBeNull();
		expect(summary.isCoverageVerifiable).toBe(false);
	});
});

describe("histórico sin intentos — se declara incompleto, no se rellena", () => {
	it("un ciclo viejo sin cobertura queda `unverifiable`", () => {
		const summary = unverifiableCoverage();
		expect(summary.state).toBe("unverifiable");
		expect(summary.isCoverageVerifiable).toBe(false);
		expect(summary.responseRate).toBeNull();
		expect(summary.label).toMatch(/denominador histórico está incompleto/);
	});

	it("no inventa los intentos que faltan: no aparecen como cero fallos", () => {
		const summary = unverifiableCoverage();
		expect(summary.label).not.toMatch(/0 de 0/);
		expect(summary.state).not.toBe("complete");
	});

	it("agrega la cobertura real y cuenta aparte los ciclos que no la tienen", () => {
		const cycles: CoverageCycle[] = [
			{ date: "2026-09-20", coverage: null }, // histórico: no dejó intentos
			{ date: "2026-09-21", coverage: null }, // histórico: no dejó intentos
			{ date: "2026-10-02", coverage: { planned: 9, succeeded: 6, failed: 3 } },
			{ date: "2026-10-03", coverage: { planned: 9, succeeded: 9, failed: 0 } },
		];

		const summary = summarizeCycleCoverage(cycles);

		expect(summary.unverifiableCycles).toBe(2);
		expect(summary.label).toBe(
			"3 de 18 corridas no respondieron · 2 ciclo(s) previos a 2026-10-02 no tienen cobertura: el denominador histórico está incompleto.",
		);
		expect(summary.state).toBe("partial");
		expect(summary.isCoverageVerifiable).toBe(true);
		expect(summary.verifiableSince).toBe(VERIFIABLE_COVERAGE_SINCE);
	});

	it("solo ciclos sin cobertura: todo el resultado es `unverifiable`", () => {
		const cycles: CoverageCycle[] = [
			{ date: "2026-09-20", coverage: null },
			{ date: "2026-09-21", coverage: null },
		];

		const summary = summarizeCycleCoverage(cycles);

		expect(summary.state).toBe("unverifiable");
		expect(summary.isCoverageVerifiable).toBe(false);
		expect(summary.unverifiableCycles).toBe(2);
		expect(summary.label).toMatch(/denominador histórico está incompleto/);
	});
});
