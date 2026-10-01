/**
 * El mensaje de la biblioteca de APS tiene que poder explicarse solo.
 *
 * Estos tests existen por el bug del botón "Generar 50 prompts de compra": pedía 50, el gateway
 * devolvía 6, los motivos del descarte ya se calculaban y se tiraban, y la pantalla no decía ni
 * cuántos vinieron ni por qué. El que miraba no podía armarse un modelo mental.
 */
import { describe, expect, it } from "vitest";
import {
	CATEGORY_PLACEHOLDER,
	type GeneratorInputs,
	generateButtonLabel,
	generationFailureMessage,
	generatorInputsFromBrand,
	generatorInputsNote,
	type LibraryGenerationReport,
	libraryReviewMessage,
	missingCategoryWarning,
	rejectionSummary,
} from "./library-message";

/** La marca declara categoría en BeAOS: es el caso de una marca bien configurada. */
const INPUTS: GeneratorInputs = {
	received: ["la descripción corta", "los productos y servicios", "las palabras clave"],
	missing: [],
	category: "Automotriz",
	categorySource: "declared",
};

/** La marca no la declara en BeAOS pero su DNA de Maasy trae `industry`. */
const INPUTS_CATEGORIA_DNA: GeneratorInputs = { ...INPUTS, categorySource: "dna" };

/** La marca no la declara: el generador calibra con el marcador genérico. */
const INPUTS_SIN_CATEGORIA: GeneratorInputs = { ...INPUTS, category: null, categorySource: "placeholder" };

function report(overrides: Partial<LibraryGenerationReport> = {}): LibraryGenerationReport {
	return { returned: 6, usable: 6, rejected: [], askedFor: 50, failure: null, ...overrides };
}

describe("el botón", () => {
	it("no promete un número que no controlamos: dice hasta cuántos pide", () => {
		const label = generateButtonLabel(false);
		expect(label).toContain("hasta");
		expect(label).not.toBe("Generar 50 prompts de compra");
	});

	it("mientras corre, dice que está corriendo", () => {
		expect(generateButtonLabel(true)).toBe("Generando…");
	});
});

describe("cuando vuelven menos de los esperados", () => {
	it("dice cuántos vinieron y cuántos quedaron usables", () => {
		const message = libraryReviewMessage(report({ returned: 6, usable: 6 }), INPUTS);
		expect(message).toContain("6");
		expect(message).toContain("candidatos");
	});

	it("dice por qué se descartaron, con los motivos que ya calcula el validador", () => {
		const message = libraryReviewMessage(
			report({
				returned: 9,
				usable: 6,
				rejected: [{ reason: "names_brand" }, { reason: "names_brand" }, { reason: "duplicate" }],
			}),
			INPUTS,
		);
		expect(message).toContain("marca");
		expect(message).toContain("repetido");
	});

	it("aclara que son candidatos y que no se guardan hasta confirmar", () => {
		const message = libraryReviewMessage(report(), INPUTS);
		expect(message).toContain("candidatos");
		expect(message).toMatch(/no se guardan hasta/i);
	});

	it("no promete que el gateway devuelva los 50", () => {
		const message = libraryReviewMessage(report({ returned: 6, usable: 6 }), INPUTS);
		expect(message).toMatch(/no lo (controla|decide)/i);
	});
});

describe("cuando no vuelve nada", () => {
	it("dice que el gateway cortó la respuesta en vez de un genérico", () => {
		const message = generationFailureMessage(report({ returned: 0, usable: 0, failure: "truncated" }), INPUTS);
		expect(message).toMatch(/cortó/i);
		expect(message).not.toBe("El gateway no devolvio una biblioteca usable.");
	});

	it("distingue el caso de los candidatos que no pasaron el chequeo", () => {
		const message = generationFailureMessage(
			report({ returned: 4, usable: 0, rejected: [{ reason: "unknown_kind" }, { reason: "unknown_kind" }] }),
			INPUTS,
		);
		expect(message).toContain("4");
		expect(message).toMatch(/ninguno/i);
	});
});

describe("los insumos que el generador no recibió", () => {
	it("nombra el insumo que falta en vez de decir que no devolvió una biblioteca usable", () => {
		const note = generatorInputsNote({
			...INPUTS,
			received: [],
			missing: ["la descripción corta", "los productos y servicios"],
		});
		expect(note).not.toBeNull();
		expect(note).toContain("la descripción corta");
		expect(note).toContain("los productos y servicios");
	});

	it("dice que la marca no declara categoría y con qué marcador calibró", () => {
		const note = generatorInputsNote(INPUTS_SIN_CATEGORIA);
		expect(note).toContain(CATEGORY_PLACEHOLDER);
		expect(note).toMatch(/no declara categoría/i);
	});

	it("cuando la categoría falta, dice que la biblioteca puede salir mal calibrada", () => {
		expect(generatorInputsNote(INPUTS_SIN_CATEGORIA)).toMatch(/mal calibrada/i);
	});

	/**
	 * El test que fija la precedencia de punta a punta del mensaje: **sin** categoría el aviso de "puede
	 * salir mal calibrada" aparece, y **con** categoría declarada no aparece. Es la diferencia entre
	 * avisar de verdad y avisar siempre —un aviso que sale siempre no lo lee nadie.
	 */
	it("sin categoría el aviso de mal calibrada aparece, y con categoría declarada NO", () => {
		expect(generatorInputsNote(INPUTS_SIN_CATEGORIA)).toMatch(/mal calibrada/i);
		expect(generatorInputsNote(INPUTS)).not.toMatch(/mal calibrada/i);
		expect(generatorInputsNote(INPUTS)).not.toContain(CATEGORY_PLACEHOLDER);
		expect(generatorInputsNote(INPUTS)).toContain("Automotriz");
	});

	it("distingue la categoría declarada en BeAOS de la heredada del DNA", () => {
		expect(generatorInputsNote(INPUTS)).toMatch(/la declara la marca en BeAOS/i);
		expect(generatorInputsNote(INPUTS_CATEGORIA_DNA)).toMatch(/DNA de Maasy/i);
		expect(generatorInputsNote(INPUTS_CATEGORIA_DNA)).not.toMatch(/mal calibrada/i);
	});

	it("cuando la categoría viene, la nombra en vez de hablar del marcador", () => {
		const note = generatorInputsNote(INPUTS);
		expect(note).toContain("Automotriz");
		expect(note).not.toContain(CATEGORY_PLACEHOLDER);
	});

	it("el mensaje de falla incluye el insumo que falta", () => {
		const message = generationFailureMessage(report({ returned: 0, usable: 0, failure: "truncated" }), {
			...INPUTS,
			received: [],
			missing: ["la descripción corta"],
		});
		expect(message).toContain("la descripción corta");
	});

	it("lee del proyecto cuál de los tres insumos falta", () => {
		const inputs = generatorInputsFromBrand(
			{
				shortDescription: "una marca",
				productsAndServices: [],
				keywords: ["uno", "dos"],
			},
			"Bebidas",
		);
		expect(inputs.received).toEqual(["la descripción corta", "las palabras clave"]);
		expect(inputs.missing).toEqual(["los productos y servicios de la marca"]);
		expect(inputs.category).toBe("Bebidas");
	});

	it("la categoría vacía cuenta como ausente, no como una categoría llamada «»", () => {
		const brand = { shortDescription: "una marca", productsAndServices: ["uno"], keywords: ["dos"] };
		expect(generatorInputsFromBrand(brand, "   ").category).toBeNull();
		expect(generatorInputsFromBrand(brand, null).category).toBeNull();
		expect(generatorInputsFromBrand(brand, " Automotriz ").category).toBe("Automotriz");
	});

	it("con el proyecto vacío, los tres insumos faltan", () => {
		const inputs = generatorInputsFromBrand(
			{ shortDescription: null, productsAndServices: null, keywords: null },
			null,
		);
		expect(inputs.missing).toHaveLength(3);
		expect(generatorInputsNote(inputs)).toContain("el generador no recibió contexto de marca");
	});
});

describe("el aviso antes de gastar la llamada", () => {
	it("dice que no se gastó nada y por qué", () => {
		const warning = missingCategoryWarning("BeAOS");
		expect(warning).toMatch(/No se gastó la llamada/i);
		expect(warning).toContain("BeAOS");
		expect(warning).toContain(CATEGORY_PLACEHOLDER);
	});

	it("nombra el campo que hay que completar y el bloqueo de 90 días", () => {
		const warning = missingCategoryWarning("VW Camiones y Buses");
		expect(warning).toContain("industry");
		expect(warning).toContain("90 días");
		expect(warning).toMatch(/mal calibrada/i);
	});
});

describe("el resumen de descartes", () => {
	it("cuenta por motivo", () => {
		expect(rejectionSummary([{ reason: "names_brand" }, { reason: "names_brand" }, { reason: "duplicate" }])).toBe(
			"2 nombraban la marca · 1 estaban repetidos",
		);
	});

	it("sin descartes no inventa una línea", () => {
		expect(rejectionSummary([])).toBeNull();
	});
});
