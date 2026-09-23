import { describe, expect, it } from "vitest";
import {
	LIBRARY_LOCK_DAYS,
	LIBRARY_MIX,
	type LibraryPromptInput,
	canRegenerateLibrary,
	isLibraryLocked,
	isUnaided,
	libraryLockWindow,
	validateLibrary,
} from "./library";

function prompt(overrides: Partial<LibraryPromptInput> = {}): LibraryPromptInput {
	return {
		text: "¿Cuál es la mejor opción para mi negocio?",
		kind: "comparison",
		funnelStage: "consideration",
		...overrides,
	};
}

describe("isUnaided", () => {
	it("accepts a prompt that does not name the brand", () => {
		expect(isUnaided("¿Qué schorle artesanal me recomiendas?", ["Felix Schorle", "Felix"])).toBe(true);
	});

	it("rejects a prompt that names the brand or an alias", () => {
		expect(isUnaided("Compara Felix con otras marcas", ["Felix"])).toBe(false);
		expect(isUnaided("¿Es buena Felix Schorle?", ["Felix Schorle"])).toBe(false);
	});

	it("matches on word boundaries, not substrings", () => {
		// A two-letter brand must not reject every prompt containing those letters.
		expect(isUnaided("¿Qué opciones hay con envío incluido?", ["ON"])).toBe(true);
		expect(isUnaided("Recomiéndame ON para mi negocio", ["ON"])).toBe(false);
		expect(isUnaided("Las mejores ondas del mercado", ["ON"])).toBe(true);
	});

	it("ignores case and accents", () => {
		expect(isUnaided("recomiendame PAWERS", ["pawers"])).toBe(false);
		expect(isUnaided("recomiendame pawers", ["Páwers"])).toBe(false);
	});

	it("ignores single-character terms that would match everything", () => {
		expect(isUnaided("cualquier prompt", ["A"])).toBe(true);
	});
});

describe("validateLibrary", () => {
	it("keeps unaided prompts and reports what it dropped", () => {
		const result = validateLibrary(
			[
				prompt({ text: "Mejor schorle para una cena" }),
				prompt({ text: "¿Es buena Felix?" }),
				prompt({ text: "   " }),
				prompt({ text: "Mejor schorle para una cena" }),
				prompt({ text: "Otra consulta valida", kind: "otro" as never }),
				prompt({ text: "Consulta con embudo raro", funnelStage: "otro" as never }),
			],
			["Felix"],
		);
		expect(result.accepted).toHaveLength(1);
		expect(result.rejected.map((entry) => entry.reason)).toEqual([
			"names_brand",
			"empty",
			"duplicate",
			"unknown_kind",
			"unknown_funnel_stage",
		]);
	});

	it("counts kinds and measures the mix against the blueprint", () => {
		const balanced: LibraryPromptInput[] = [
			...Array.from({ length: 5 }, (_, i) => prompt({ text: `comparison ${i}`, kind: "comparison" })),
			...Array.from({ length: 3 }, (_, i) => prompt({ text: `use case ${i}`, kind: "use_case" })),
			...Array.from({ length: 2 }, (_, i) => prompt({ text: `category ${i}`, kind: "category" })),
		];
		const result = validateLibrary(balanced, []);
		expect(result.counts).toEqual({ comparison: 5, use_case: 3, category: 2 });
		expect(result.mix.comparison).toBeCloseTo(LIBRARY_MIX.comparison, 6);
		expect(result.mixWithinTolerance).toBe(true);
		// Ten prompts is far below the 40-60 the blueprint asks for.
		expect(result.sizeWithinRange).toBe(false);
	});

	it("flags an off-mix library", () => {
		const skewed = Array.from({ length: 10 }, (_, i) => prompt({ text: `solo comparacion ${i}`, kind: "comparison" }));
		expect(validateLibrary(skewed, []).mixWithinTolerance).toBe(false);
	});

	it("accepts a library inside the 40-60 range", () => {
		const sized = Array.from({ length: 50 }, (_, i) => prompt({ text: `prompt numero ${i}` }));
		expect(validateLibrary(sized, []).sizeWithinRange).toBe(true);
	});
});

describe("library lock", () => {
	const createdAt = new Date("2026-01-01T00:00:00Z");

	it("locks for 90 days from creation", () => {
		const lock = libraryLockWindow(createdAt);
		expect(LIBRARY_LOCK_DAYS).toBe(90);
		expect(lock.lockedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(lock.unlocksAt).toBe("2026-04-01T00:00:00.000Z");
	});

	it("stays locked until the window closes", () => {
		const lock = libraryLockWindow(createdAt);
		expect(isLibraryLocked(lock, new Date("2026-03-31T00:00:00Z"))).toBe(true);
		expect(isLibraryLocked(lock, new Date("2026-04-02T00:00:00Z"))).toBe(false);
	});

	it("refuses regeneration while locked, because the instrument must not move", () => {
		const lock = libraryLockWindow(createdAt);
		const locked = canRegenerateLibrary(lock, new Date("2026-02-01T00:00:00Z"));
		expect(locked.allowed).toBe(false);
		expect(locked.reason).toContain("bloqueada");
	});

	it("allows regeneration after the window or when explicitly superseding", () => {
		const lock = libraryLockWindow(createdAt);
		expect(canRegenerateLibrary(lock, new Date("2026-05-01T00:00:00Z")).allowed).toBe(true);
		const superseded = canRegenerateLibrary(lock, new Date("2026-02-01T00:00:00Z"), true);
		expect(superseded.allowed).toBe(true);
		expect(superseded.reason).toContain("serie nueva");
	});
});
