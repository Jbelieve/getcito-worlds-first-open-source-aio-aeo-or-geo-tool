/**
 * El guardián de la paleta. Si alguien vuelve a pintar un estado de verde, ámbar o rojo, estos tests
 * fallan — que es el punto: el semáforo se colaba porque el color se decidía en cada pantalla.
 */
import { describe, expect, it } from "vitest";
import {
	AOS_BANDS,
	APS_BANDS,
	STATUS_TONE,
	STAGE_LEVEL,
	type Level,
	apsBand,
	aosBand,
	levelFromScore,
	toneOf,
} from "./status-tone";

/** Los seis tintes del brandbook. Cualquier otro hex es un invento. */
const BRAND_INKS = ["#0c3bb9", "#062778", "#00aaff", "#fafaf7", "#1a1a1a", "#6b6b65"];

/** Familias de color que no existen en la marca. El semáforo salía de acá. */
const FOREIGN_HUES =
	/\b(?:emerald|green|lime|teal|sky|indigo|violet|purple|fuchsia|pink|rose|red|orange|amber|yellow)-?\d{0,3}\b/;

const LEVELS: Level[] = ["full", "high", "mid", "low", "none", "unknown"];

function classStrings(): Array<{ level: Level; value: string }> {
	const out: Array<{ level: Level; value: string }> = [];
	for (const level of LEVELS) {
		const tone = STATUS_TONE[level];
		for (const value of Object.values(tone)) {
			if (typeof value === "string") out.push({ level, value });
		}
	}
	return out;
}

describe("status-tone", () => {
	it("no vuelve al semáforo: ningún hues ajeno a la marca", () => {
		for (const { level, value } of classStrings()) {
			expect(FOREIGN_HUES.test(value), `${level} → ${value}`).toBe(false);
		}
	});

	it("no inventa colores: todo literal sale de los seis tintes de marca", () => {
		const literals = new Set<string>();
		for (const { value } of classStrings()) {
			for (const match of value.matchAll(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/g)) {
				literals.add((match[0] ?? "").toLowerCase());
			}
		}
		expect(literals.size).toBeGreaterThan(0);
		for (const literal of literals) {
			if (literal.startsWith("rgba")) {
				// Una opacidad sobre tinta de marca es una derivación, no un color nuevo.
				expect(literal).toMatch(/^rgba\((12, 59, 185|26, 26, 26), [\d.]+\)$/);
				continue;
			}
			expect(BRAND_INKS).toContain(literal);
		}
	});

	it("la rampa es monótona: cuanto menos azul, menos cumplido", () => {
		const bluePresence = (mark: string): number => {
			const rgba = mark.match(/^rgba\(12, 59, 185, ([\d.]+)\)$/);
			if (rgba !== null) return Number(rgba[1]);
			return mark.toLowerCase() === "#0c3bb9" ? 1 : 0;
		};
		const ladder: Level[] = ["full", "high", "mid", "low", "none"];
		const values = ladder.map((level) => bluePresence(STATUS_TONE[level].mark));
		for (let index = 1; index < values.length; index += 1) {
			expect(values[index] ?? 0).toBeLessThan(values[index - 1] ?? 0);
		}
		// El peor estado no tiene azul: es ausencia, no alarma.
		expect(values.at(-1)).toBe(0);
	});

	it("el estado sobrevive sin color: el mejor es marca llena, el peor es hueca", () => {
		expect(STATUS_TONE.full.solid).toBe(true);
		expect(STATUS_TONE.high.solid).toBe(true);
		for (const level of ["mid", "low", "none", "unknown"] as Level[]) {
			expect(STATUS_TONE[level].solid, level).toBe(false);
		}
	});

	it("todo nivel tiene etiqueta y todo texto es legible", () => {
		for (const level of LEVELS) {
			const tone = STATUS_TONE[level];
			expect(tone.text.length).toBeGreaterThan(0);
			expect(tone.chip).toContain(tone.border);
			expect(tone.chip).toContain(tone.bg);
		}
		expect(toneOf(undefined)).toBe(STATUS_TONE.unknown);
	});

	it("el AOS usa cuatro escalones y la visibilidad heredada usa tres", () => {
		const aos = { full: 80, high: 60, mid: 35 };
		expect(levelFromScore(89, aos)).toBe("full");
		expect(levelFromScore(80, aos)).toBe("full");
		expect(levelFromScore(70, aos)).toBe("high");
		expect(levelFromScore(35, aos)).toBe("mid");
		expect(levelFromScore(10, aos)).toBe("low");
		expect(levelFromScore(0, aos)).toBe("none");

		const visibility = { full: 75, high: 45 };
		expect(levelFromScore(90, visibility)).toBe("full");
		expect(levelFromScore(50, visibility)).toBe("high");
		expect(levelFromScore(20, visibility)).toBe("low");
		expect(levelFromScore(0, visibility)).toBe("none");
	});

	it("mapea las bandas del auditor y del APS sin inventar etiquetas", () => {
		expect(aosBand("Agent-Operable")).toMatchObject({ label: "Operable", level: "full" });
		expect(aosBand("Agent-Attemptable").level).toBe("high");
		expect(aosBand("Agent-Blocked").level).toBe("mid");
		expect(aosBand("Agent-Inert").level).toBe("low");
		expect(apsBand("agent_native").level).toBe("full");
		expect(apsBand("agent_visible").level).toBe("mid");
		expect(apsBand("agent_blind").level).toBe("none");
	});

	it("una banda desconocida se muestra cruda en vez de mentir un estado", () => {
		const unknown = aosBand("Agent-Inventado");
		expect(unknown).toMatchObject({ label: "Agent-Inventado", level: "unknown" });
		expect(unknown.tone).toBe(STATUS_TONE.unknown);
		expect(aosBand(null).level).toBe("unknown");
		expect(apsBand(undefined).label).toBe("Sin dato");
	});

	it("cada banda conocida tiene su nivel, y cada etapa también", () => {
		for (const [band, entry] of Object.entries({ ...AOS_BANDS, ...APS_BANDS })) {
			expect(LEVELS, band).toContain(entry.level);
			expect(entry.level).not.toBe("unknown");
		}
		expect(Object.keys(STAGE_LEVEL).sort()).toEqual(["a medias", "bloqueado", "listo", "sin datos"]);
		for (const level of Object.values(STAGE_LEVEL)) expect(LEVELS).toContain(level);
	});
});
