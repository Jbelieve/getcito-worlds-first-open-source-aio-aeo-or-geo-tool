import { describe, expect, it } from "vitest";
import {
	CATEGORY_PLACEHOLDER,
	canRegenerateLibrary,
	categoryFromBrandContext,
	isLibraryLocked,
	isUnaided,
	LIBRARY_LOCK_DAYS,
	LIBRARY_MIX,
	type LibraryPromptInput,
	libraryLockWindow,
	resolveLibraryCategory,
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

/**
 * La categoría con la que se calibra la biblioteca.
 *
 * El bug que cierra: `buildLibraryPrompt` caía al literal "marketing/software" porque ninguna puerta
 * le pasaba la categoría, así que la biblioteca de un fabricante de camiones se calibraba como la de
 * una consultora de marketing. El campo real es `industry`, el mismo que BeAOS publica en el
 * `brand.json`; y cuando la marca no lo declara hay que decirlo, no inventarlo.
 */
describe("categoryFromBrandContext", () => {
	it("lee el campo industry que la marca declara", () => {
		expect(categoryFromBrandContext({ industry: "Automotriz" })).toBe("Automotriz");
		expect(categoryFromBrandContext({ industry: "  Media y Publicidad  " })).toBe("Media y Publicidad");
	});

	it("no inventa una categoría cuando la marca no la declara", () => {
		expect(categoryFromBrandContext({})).toBeNull();
		expect(categoryFromBrandContext(undefined)).toBeNull();
		expect(categoryFromBrandContext(null)).toBeNull();
		// El DNA real de BeAOS trae `industry` como string vacío: eso es "no la declara", no "una
		// categoría sin nombre".
		expect(categoryFromBrandContext({ industry: "" })).toBeNull();
		expect(categoryFromBrandContext({ industry: "   " })).toBeNull();
	});

	it("no acepta un industry que no sea texto", () => {
		expect(categoryFromBrandContext({ industry: 42 })).toBeNull();
		expect(categoryFromBrandContext({ industry: ["a"] })).toBeNull();
		expect(categoryFromBrandContext({ industry: { name: "Automotriz" } })).toBeNull();
	});

	it("el marcador no es la categoría de nadie: se usa solo cuando no hay ninguna", () => {
		expect(categoryFromBrandContext({ industry: CATEGORY_PLACEHOLDER })).toBe(CATEGORY_PLACEHOLDER);
	});
});

/**
 * La precedencia con la que se calibra la biblioteca.
 *
 * El caso real que la justifica: BeAOS y BeScore no tienen proyecto de Maasy, así que su DNA no trae
 * `industry`. Sin una categoría declarada en la marca, su biblioteca de 50 preguntas de compra salía
 * calibrada con el marcador «marketing/software» —falso para una plataforma de AOS y para un
 * fabricante de camiones— y quedaba bloqueada 90 días. La marca declara su categoría en BeAOS y esa
 * manda; el DNA queda como red de seguridad para quien ya tiene Maasy.
 */
describe("resolveLibraryCategory", () => {
	it("si la marca la declara en BeAOS, manda esa y no la del DNA", () => {
		const resolved = resolveLibraryCategory({
			declared: "Plataformas de AOS",
			dna: { industry: "Marketing y Publicidad" },
		});
		expect(resolved).toEqual({ category: "Plataformas de AOS", source: "declared" });
	});

	it("si la marca no la declara, hereda la del DNA de Maasy en vez del marcador", () => {
		expect(resolveLibraryCategory({ declared: null, dna: { industry: "Automotriz" } })).toEqual({
			category: "Automotriz",
			source: "dna",
		});
		expect(resolveLibraryCategory({ dna: { industry: "Automotriz" } })).toEqual({
			category: "Automotriz",
			source: "dna",
		});
	});

	it("una declaración vacía no gana: cae al DNA", () => {
		expect(resolveLibraryCategory({ declared: "   ", dna: { industry: "Automotriz" } })).toEqual({
			category: "Automotriz",
			source: "dna",
		});
		expect(resolveLibraryCategory({ declared: 42, dna: { industry: "Automotriz" } }).source).toBe("dna");
	});

	it("sin ninguna de las dos no inventa: dice que falta", () => {
		expect(resolveLibraryCategory({ declared: null, dna: {} })).toEqual({
			category: null,
			source: "placeholder",
		});
		expect(resolveLibraryCategory({ declared: "", dna: null })).toEqual({
			category: null,
			source: "placeholder",
		});
		expect(resolveLibraryCategory({}).source).toBe("placeholder");
	});

	it("normaliza igual las dos fuentes: la misma categoría con espacios da lo mismo", () => {
		expect(resolveLibraryCategory({ declared: "  Automotriz  " }).category).toBe("Automotriz");
		expect(resolveLibraryCategory({ dna: { industry: "  Automotriz  " } }).category).toBe("Automotriz");
	});
});
