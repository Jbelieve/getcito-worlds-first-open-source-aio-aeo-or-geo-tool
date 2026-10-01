/**
 * Cómo se cuenta el costo de una corrida en la pantalla.
 *
 * El test que importa es el del total incompleto: un total que parece completo y
 * miente es exactamente lo que este trabajo viene a arreglar, así que la línea
 * tiene que decir cuántas llamadas quedaron sin costo en vez de mostrar la suma de
 * las que sí sabemos como si fuera todo.
 */
import { describe, expect, it } from "vitest";
import { type ApsCostComparisonView, costLineText, costVerdictNote, formatUsd } from "./run-cost";

const comparison = (partial: Partial<ApsCostComparisonView> = {}): ApsCostComparisonView => ({
	estimatedUsd: 1,
	measurementUsd: 1,
	judgeUsd: 0.02,
	totalUsd: 1.02,
	pricedUsd: 1.02,
	unpricedCalls: 0,
	totalCalls: 3,
	ratio: 1.02,
	verdict: "estimated_ok",
	...partial,
});

describe("formatUsd", () => {
	it("no muestra un guion como si fuera un cero", () => {
		expect(formatUsd(null)).toBe("—");
		expect(formatUsd(null)).not.toBe("USD 0");
	});

	it("distingue el cero real", () => {
		expect(formatUsd(0)).toBe("USD 0");
	});

	it("usa más decimales cuando el monto es chico", () => {
		expect(formatUsd(0.0000165)).toBe("USD 0.000017");
		expect(formatUsd(1.5)).toBe("USD 1.5");
	});
});

describe("costVerdictNote", () => {
	it("cada veredicto dice qué hacer con el precio", () => {
		expect(costVerdictNote(comparison({ verdict: "estimated_ok" }))).toContain("estaba bien");
		expect(costVerdictNote(comparison({ verdict: "estimated_low" }))).toContain("hay que subirlo");
		expect(costVerdictNote(comparison({ verdict: "estimated_high" }))).toContain("está alto");
		expect(costVerdictNote(comparison({ verdict: "incomplete" }))).toContain("no es un total");
		expect(costVerdictNote(comparison({ verdict: "unknown" }))).toContain("todavía");
	});
});

describe("costLineText", () => {
	it("con el total completo muestra el total y no habla de llamadas sin costo", () => {
		const text = costLineText(comparison());
		expect(text.real).toBe(formatUsd(1.02));
		expect(text.calls).toBe("3 llamadas");
	});

	it("informa cuántas llamadas quedaron sin costo en vez de mostrar un total falso", () => {
		const text = costLineText(
			comparison({
				measurementUsd: null,
				totalUsd: null,
				pricedUsd: 0.4,
				unpricedCalls: 2,
				totalCalls: 4,
				ratio: null,
				verdict: "incomplete",
			}),
		);
		expect(text.real).toBe("al menos USD 0.4");
		expect(text.calls).toBe("4 llamadas, 2 sin costo");
		expect(text.note).toContain("no es un total");
	});

	it("una corrida sin llamadas lo dice, no muestra cero", () => {
		const text = costLineText(comparison({ totalCalls: 0, unpricedCalls: 0, totalUsd: 0, pricedUsd: 0 }));
		expect(text.calls).toBe("sin llamadas registradas");
	});

	it("separa la medición del juez: son dos gastos distintos", () => {
		const text = costLineText(comparison({ measurementUsd: 0.9, judgeUsd: 0.12 }));
		expect(text.split).toBe(`Medición ${formatUsd(0.9)} · juez ${formatUsd(0.12)}.`);
	});
});
