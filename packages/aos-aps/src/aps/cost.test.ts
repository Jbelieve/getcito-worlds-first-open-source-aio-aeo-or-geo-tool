/**
 * El costo real de una corrida y su comparación contra el estimado.
 *
 * El caso que este archivo protege es el de siempre: un número que parece
 * terminado y no lo es. Si una llamada no reporta costo, el total **no existe** y
 * hay que poder verlo así, no como la suma de las que sí sabemos.
 */
import { describe, expect, it } from "vitest";
import {
	APS_COST_MISMATCH_THRESHOLD,
	type ApsRunCostTotals,
	compareEstimatedToActual,
	sumProviderCallCosts,
} from "./cost";

const totals = (partial: Partial<ApsRunCostTotals> = {}): ApsRunCostTotals => ({
	calls: 0,
	unpricedCalls: 0,
	pricedUsd: 0,
	costUsd: 0,
	...partial,
});

describe("sumProviderCallCosts", () => {
	it("suma los costos conocidos", () => {
		const result = sumProviderCallCosts([{ costUsd: 0.00002 }, { costUsd: 0.00003 }]);
		expect(result.calls).toBe(2);
		expect(result.unpricedCalls).toBe(0);
		expect(result.costUsd).toBeCloseTo(0.00005, 10);
	});

	it("un cero es un costo conocido y gratis, no un costo faltante", () => {
		const result = sumProviderCallCosts([{ costUsd: 0 }, { costUsd: 0.5 }]);
		expect(result.unpricedCalls).toBe(0);
		expect(result.costUsd).toBeCloseTo(0.5, 10);
	});

	it("con una llamada sin costo el total es null, y dice cuántas faltan", () => {
		const result = sumProviderCallCosts([{ costUsd: 0.5 }, { costUsd: null }, { costUsd: null }]);
		expect(result.calls).toBe(3);
		expect(result.unpricedCalls).toBe(2);
		// La suma de las que sí sabemos existe, pero NO se presenta como el total.
		expect(result.pricedUsd).toBeCloseTo(0.5, 10);
		expect(result.costUsd).toBeNull();
	});

	it("una lista vacía es un total de cero, no un total desconocido", () => {
		const result = sumProviderCallCosts([]);
		expect(result.calls).toBe(0);
		expect(result.unpricedCalls).toBe(0);
		expect(result.costUsd).toBe(0);
	});
});

describe("compareEstimatedToActual", () => {
	it("el precio estaba bien cuando el real se parece al estimado", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({ calls: 2, pricedUsd: 0.9, costUsd: 0.9 }),
			judge: totals({ calls: 2, pricedUsd: 0.1, costUsd: 0.1 }),
		});
		expect(comparison.totalUsd).toBeCloseTo(1, 10);
		expect(comparison.ratio).toBeCloseTo(1, 10);
		expect(comparison.verdict).toBe("estimated_ok");
	});

	it("dice que el real salió más caro cuando el estimado quedó corto", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({ calls: 1, pricedUsd: 2, costUsd: 2 }),
			judge: totals(),
		});
		expect(comparison.verdict).toBe("estimated_low");
		expect(comparison.ratio).toBeCloseTo(2, 10);
	});

	it("dice que el real salió más barato cuando el estimado quedó alto", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 10,
			measurement: totals({ calls: 1, pricedUsd: 1, costUsd: 1 }),
			judge: totals(),
		});
		expect(comparison.verdict).toBe("estimated_high");
	});

	it("el umbral es ancho: una diferencia chica es ruido, no una señal", () => {
		const within = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({
				calls: 1,
				pricedUsd: 1 + APS_COST_MISMATCH_THRESHOLD,
				costUsd: 1 + APS_COST_MISMATCH_THRESHOLD,
			}),
			judge: totals(),
		});
		expect(within.verdict).toBe("estimated_ok");

		const beyond = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({ calls: 1, pricedUsd: 1.3, costUsd: 1.3 }),
			judge: totals(),
		});
		expect(beyond.verdict).toBe("estimated_low");
	});

	it("no compara nada cuando falta el costo de alguna llamada, y dice cuántas", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({ calls: 3, unpricedCalls: 2, pricedUsd: 0.5, costUsd: null }),
			judge: totals({ calls: 1, pricedUsd: 0.01, costUsd: 0.01 }),
		});
		expect(comparison.verdict).toBe("incomplete");
		expect(comparison.totalUsd).toBeNull();
		expect(comparison.ratio).toBeNull();
		expect(comparison.unpricedCalls).toBe(2);
		expect(comparison.totalCalls).toBe(4);
		// La cota inferior está disponible para poder decir "al menos tanto".
		expect(comparison.pricedUsd).toBeCloseTo(0.51, 10);
	});

	it("un juez completo no salva una medición a la que le faltan llamadas", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 1,
			measurement: totals({ calls: 2, unpricedCalls: 1, pricedUsd: 0.4, costUsd: null }),
			judge: totals({ calls: 1, pricedUsd: 0.01, costUsd: 0.01 }),
		});
		expect(comparison.measurementUsd).toBeNull();
		expect(comparison.judgeUsd).toBeCloseTo(0.01, 10);
		expect(comparison.totalUsd).toBeNull();
	});

	it("sin estimado guardado no se compara y lo dice", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: null,
			measurement: totals({ calls: 1, pricedUsd: 0.5, costUsd: 0.5 }),
			judge: totals(),
		});
		expect(comparison.verdict).toBe("unknown");
		expect(comparison.totalUsd).toBeCloseTo(0.5, 10);
	});

	it("una corrida sin llamadas registradas da real 0, que es un dato y no una ausencia", () => {
		// Sin llamadas no hay incógnita: el real es 0 conocido. Que el estimado fuera 5 y el real
		// 0 es una diferencia real (-100%), así que el veredicto es que el precio está alto.
		const comparison = compareEstimatedToActual({
			estimatedUsd: 5,
			measurement: totals(),
			judge: totals(),
		});
		expect(comparison.verdict).toBe("estimated_high");
		expect(comparison.totalUsd).toBe(0);
	});

	it("un estimado de cero no tiene ratio: no se compara contra nada", () => {
		const comparison = compareEstimatedToActual({
			estimatedUsd: 0,
			measurement: totals({ calls: 1, pricedUsd: 0.5, costUsd: 0.5 }),
			judge: totals(),
		});
		expect(comparison.ratio).toBeNull();
		expect(comparison.verdict).toBe("unknown");
	});
});
