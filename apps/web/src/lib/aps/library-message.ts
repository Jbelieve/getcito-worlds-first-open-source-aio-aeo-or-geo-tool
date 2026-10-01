/**
 * Las palabras con las que el panel de APS cuenta una generación de biblioteca.
 *
 * Vive aparte del componente porque es lo único de la pantalla que se puede probar: el texto que dice
 * cuántos candidatos volvieron, cuántos se descartaron y por qué. Antes estaba incrustado en el JSX y
 * los motivos del descarte —que el validador ya calculaba— se tiraban a la basura.
 *
 * La regla que ordena todo esto: **el número no lo controla el botón**. BeAOS le pide un objetivo al
 * gateway y el gateway devuelve lo que puede (medido: 6 de 50 el 2026-09-23, y 0 cuando el razonamiento
 * se come el tope de tokens). Por eso ninguna frase promete una cantidad: se dice cuántos vinieron.
 */

import { LIBRARY_TARGET_TOTAL, type LibraryFailure } from "@workspace/aos-aps/aps";

/** Lo que el generador le pide al modelo. No es una promesa: el gateway devuelve lo que puede. */
export const LIBRARY_ASKED_FOR = LIBRARY_TARGET_TOTAL;

/** Qué significa cada motivo de descarte. Los motivos ya los calcula `validateLibrary`. */
const REJECTION_TEXT: Record<string, string> = {
	empty: "vinieron vacíos",
	names_brand: "nombraban la marca",
	duplicate: "estaban repetidos",
	unknown_kind: "no eran comparación, caso de uso ni categoría",
	unknown_funnel_stage: "no tenían una etapa del embudo válida",
	"kind, funnel_stage o texto invalido": "no traían tipo, etapa o texto legibles",
};

const FAILURE_TEXT: Record<LibraryFailure, string> = {
	truncated: "el gateway cortó la respuesta antes de terminarla (se quedó sin tokens y el JSON quedó abierto)",
	unparseable: "el gateway no devolvió un JSON de prompts que se pueda leer",
	http_error: "el gateway rechazó la llamada",
	network_error: "no se pudo llegar al gateway",
	no_prompts: "el gateway devolvió una lista de prompts vacía",
};

export interface LibraryGenerationReport {
	/** Cuántos candidatos devolvió el gateway: los usables más los descartados por forma. */
	returned: number;
	/** Cuántos quedaron usables. */
	usable: number;
	/** Los descartados, con el motivo que ya calculó el validador. */
	rejected: Array<{ reason: string }>;
	/** Cuántos le pedimos al gateway. */
	askedFor: number;
	/** Por qué la generación no sirvió, cuando no sirvió. */
	failure: LibraryFailure | null;
}

/** Los insumos del generador: lo que recibió, lo que le falta y la categoría que usa de marcador. */
export interface GeneratorInputs {
	received: string[];
	missing: string[];
	categoryPlaceholder: string;
}

/** El marcador de categoría con el que trabaja el generador cuando nadie le pasa la categoría real. */
export const CATEGORY_PLACEHOLDER = "marketing/software";

/** Lo que el generador sí consume del proyecto. `industry` no está: ninguna puerta se lo pasa. */
export interface BrandContextFields {
	shortDescription: string | null;
	productsAndServices: string[] | null;
	keywords: string[] | null;
}

/** Traduce el contexto de marca a insumos con nombre, para poder decir cuál falta. */
export function generatorInputsFromBrand(brand: BrandContextFields): GeneratorInputs {
	const received: string[] = [];
	const missing: string[] = [];
	const check = (present: boolean, ok: string, absent: string): void => {
		if (present) received.push(ok);
		else missing.push(absent);
	};
	check((brand.shortDescription ?? "").trim().length > 0, "la descripción corta", "la descripción corta de la marca");
	check(
		(brand.productsAndServices ?? []).length > 0,
		"los productos y servicios",
		"los productos y servicios de la marca",
	);
	check((brand.keywords ?? []).length > 0, "las palabras clave", "las palabras clave de la marca");
	return { received, missing, categoryPlaceholder: CATEGORY_PLACEHOLDER };
}

/** El título dice lo que hace: pide candidatos, hasta un tope, y no promete la cantidad. */
export function generateButtonLabel(pending: boolean): string {
	return pending ? "Generando…" : `Generar candidatos (hasta ${LIBRARY_ASKED_FOR})`;
}

/** "2 nombraban la marca · 1 estaban repetidos": agrupado por motivo, que es lo que se puede contar. */
export function rejectionSummary(rejected: Array<{ reason: string }>): string | null {
	if (rejected.length === 0) return null;
	const counts = new Map<string, number>();
	for (const entry of rejected) counts.set(entry.reason, (counts.get(entry.reason) ?? 0) + 1);
	return [...counts.entries()].map(([reason, count]) => `${count} ${REJECTION_TEXT[reason] ?? reason}`).join(" · ");
}

/**
 * Nombra el insumo que falta. Existe porque el genérico *"no devolvió una biblioteca usable"* ya mandó
 * a un agente a buscar el problema donde no estaba: si falta contexto, hay que decir cuál.
 *
 * La categoría se nombra siempre porque el generador **nunca** la recibe: `buildLibraryPrompt` cae al
 * marcador cuando `industry` viene vacío y ninguna de las dos puertas se lo pasa.
 */
export function generatorInputsNote(inputs: GeneratorInputs): string {
	const received = inputs.received.length > 0 ? inputs.received.join(", ") : "contexto de marca";
	const context =
		inputs.missing.length === 0
			? `El generador recibió ${received}.`
			: `Al proyecto le falta ${inputs.missing.join(", ")}: el generador no recibió ${received}.`;
	return `${context} La categoría tampoco se le pasa: usa «${inputs.categoryPlaceholder}» como marcador.`;
}

/** Lo que se lee cuando SÍ volvieron candidatos: cuántos, qué se descartó y que todavía no se guardó. */
export function libraryReviewMessage(report: LibraryGenerationReport, inputs: GeneratorInputs | null): string {
	const parts: string[] = [
		report.returned > report.usable
			? `El gateway devolvió ${report.returned} candidatos y ${report.usable} quedaron usables.`
			: `El gateway devolvió ${report.returned} candidatos usables.`,
		`Pedimos hasta ${report.askedFor}: cuántos devuelve no lo decide el botón.`,
	];
	const rejected = rejectionSummary(report.rejected);
	if (rejected !== null) parts.push(`Se descartaron ${report.rejected.length}: ${rejected}.`);
	parts.push("Son candidatos, no una biblioteca: no se guardan hasta que confirmes.");
	parts.push(
		"Al guardar se bloquean 90 días y se convierten en el instrumento con el que vas a comparar todas las mediciones; el worker los vuelve a chequear, así que la biblioteca puede quedar con menos de los que ves acá.",
	);
	if (inputs !== null) parts.push(generatorInputsNote(inputs));
	return parts.join(" ");
}

/** Lo que se lee cuando NO volvió nada: la causa concreta, no un genérico. */
export function generationFailureMessage(report: LibraryGenerationReport, inputs: GeneratorInputs | null): string {
	const parts: string[] = [];
	if (report.failure !== null) {
		parts.push(`No hay biblioteca: ${FAILURE_TEXT[report.failure]}.`);
		if (report.failure === "truncated")
			parts.push("No es un problema de tu proyecto: es el tope de tokens del gateway.");
	} else if (report.returned > 0) {
		parts.push(`El gateway devolvió ${report.returned} candidatos y ninguno quedó usable.`);
	} else {
		parts.push("El gateway no devolvió ningún candidato.");
	}
	const rejected = rejectionSummary(report.rejected);
	if (rejected !== null) parts.push(`Se descartaron ${report.rejected.length}: ${rejected}.`);
	parts.push("No se guardó nada.");
	if (inputs !== null) parts.push(generatorInputsNote(inputs));
	return parts.join(" ");
}
