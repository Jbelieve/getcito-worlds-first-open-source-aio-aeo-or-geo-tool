/**
 * Las palabras con las que el panel de APS cuenta una generación de preguntas de compra.
 *
 * El nombre visible del instrumento es **preguntas de compra**, no "biblioteca de prompts": son lo que
 * un comprador le *pide* a un chat, y miden si te prefieren. Las **búsquedas** —lo que la gente
 * *escribe* en un buscador— son el otro instrumento y miden si te mencionan (sección Búsquedas). La
 * tabla y el código siguen diciendo `prompts`/`library`: esto es vocabulario de pantalla.
 *
 * Vive aparte del componente porque es lo único de la pantalla que se puede probar: el texto que dice
 * cuántos candidatos volvieron, cuántos se descartaron y por qué. Antes estaba incrustado en el JSX y
 * los motivos del descarte —que el validador ya calculaba— se tiraban a la basura.
 *
 * La regla que ordena todo esto: **el número no lo controla el botón**. BeAOS le pide un objetivo al
 * gateway y el gateway devuelve lo que puede (medido: 6 de 50 el 2026-09-23, y 0 cuando el razonamiento
 * se come el tope de tokens). Por eso ninguna frase promete una cantidad: se dice cuántos vinieron.
 *
 * La segunda regla: **la categoría se dice, no se supone**. El generador calibra las preguntas con la
 * categoría de la marca; cuando la marca no la declara hay que decirlo con todas las letras, porque una
 * lista calibrada con una categoría falsa sale genérica y después se bloquea 90 días.
 */

import {
	CATEGORY_PLACEHOLDER,
	LIBRARY_LOCK_DAYS,
	LIBRARY_TARGET_TOTAL,
	type LibraryCategorySource,
	type LibraryFailure,
} from "@workspace/aos-aps/aps";

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
	unparseable: "el gateway no devolvió un JSON de preguntas que se pueda leer",
	http_error: "el gateway rechazó la llamada",
	network_error: "no se pudo llegar al gateway",
	no_prompts: "el gateway devolvió una lista de preguntas vacía",
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

/**
 * Los insumos del generador: lo que recibió, lo que le falta y con qué categoría calibró.
 *
 * La categoría no es un insumo más: es la que decide si la biblioteca habla de esta marca o de una
 * consultora de marketing genérica. Por eso viaja aparte y con su `null` explícito —"la marca no la
 * declara"— en vez de esconderse detrás de un marcador.
 */
export interface GeneratorInputs {
	received: string[];
	missing: string[];
	/** La categoría que se le pasó al generador. `null` cuando la marca no declara ninguna. */
	category: string | null;
	/**
	 * De dónde salió `category`. Es lo que permite decir *"la declaraste vos"* en vez de *"la sacamos
	 * del DNA"*: la precedencia (declarada > DNA > marcador) es real y el operador tiene que poder
	 * saber cuál de las dos se usó sin adivinar. `null` en un texto armado a mano que no la declara.
	 */
	categorySource: LibraryCategorySource | null;
}

/** El marcador con el que trabaja el generador cuando la marca no declara categoría. */
export { CATEGORY_PLACEHOLDER };

/** Lo que el generador sí consume del proyecto. La categoría llega aparte, desde el contexto de marca. */
export interface BrandContextFields {
	shortDescription: string | null;
	productsAndServices: string[] | null;
	keywords: string[] | null;
}

/** Traduce el contexto de marca a insumos con nombre, para poder decir cuál falta. */
export function generatorInputsFromBrand(
	brand: BrandContextFields,
	category: string | null,
	categorySource: LibraryCategorySource | null = null,
): GeneratorInputs {
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
	const trimmed = category?.trim();
	return {
		received,
		missing,
		category: trimmed !== undefined && trimmed.length > 0 ? trimmed : null,
		categorySource,
	};
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
 * La línea de la categoría: **de dónde salió**, no solo cuál fue.
 *
 * Antes decía "la categoría tampoco se le pasa: usa «marketing/software» como marcador", como si fuera
 * un detalle. No lo es: es la diferencia entre una biblioteca calibrada para la marca y 50 prompts
 * genéricos que se bloquean 90 días. Así que cuando falta, se dice que falta **y** que la biblioteca
 * puede salir mal calibrada por eso; y cuando está, se dice si la declaró la marca en BeAOS o si
 * heredó el `industry` del DNA de Maasy, porque son dos cosas distintas y el operador tiene que saber
 * cuál se usó (y que declararla en BeAOS le gana a la del DNA).
 */
export function categoryNote(inputs: GeneratorInputs): string {
	if (inputs.category === null) {
		return `La marca no declara categoría: no la escribió en BeAOS (Configuración → Brand) ni trae \`industry\` el DNA de Maasy, así que el generador usa «${CATEGORY_PLACEHOLDER}» como marcador y las preguntas pueden salir mal calibradas por eso.`;
	}
	if (inputs.categorySource === "declared") {
		return `La categoría que se le pasó es «${inputs.category}»: la declara la marca en BeAOS.`;
	}
	if (inputs.categorySource === "dna") {
		return `La categoría que se le pasó es «${inputs.category}»: la marca no la declaró en BeAOS, así que se usa la del DNA de Maasy (\`industry\`).`;
	}
	return `La categoría que se le pasó es «${inputs.category}».`;
}

/**
 * Nombra el insumo que falta. Existe porque el genérico *"no devolvió una biblioteca usable"* ya mandó
 * a un agente a buscar el problema donde no estaba: si falta contexto, hay que decir cuál.
 */
export function generatorInputsNote(inputs: GeneratorInputs): string {
	const received = inputs.received.length > 0 ? inputs.received.join(", ") : "contexto de marca";
	const context =
		inputs.missing.length === 0
			? `El generador recibió ${received}.`
			: `Al proyecto le falta ${inputs.missing.join(", ")}: el generador no recibió ${received}.`;
	return `${context} ${categoryNote(inputs)}`;
}

/**
 * El aviso de antes de gastar: la generación **no se hizo** y hay que decirlo así.
 *
 * Existe porque generar 50 preguntas mal calibradas que después se bloquean 90 días es peor que no
 * generarlas: la lista es el instrumento con el que se comparan todas las mediciones, y cambiarla
 * después no es una opción. Se avisa antes de la llamada, no después.
 */
export function missingCategoryWarning(brandName: string): string {
	return `No se gastó la llamada: la marca «${brandName}» no declara categoría —no la escribiste en BeAOS (Configuración → Brand) ni viene \`industry\` en su DNA de Maasy—, así que el generador usaría «${CATEGORY_PLACEHOLDER}» como marcador y las ${LIBRARY_ASKED_FOR} preguntas pueden salir mal calibradas. Una lista mal calibrada se bloquea ${LIBRARY_LOCK_DAYS} días y pasa a ser el instrumento con el que se comparan todas las mediciones: por eso conviene declarar la categoría en Configuración → Brand (o resincronizar el DNA) antes de generarlas. Si igual querés generarlas con el marcador, confirmá.`;
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
	parts.push("Son candidatos, no las preguntas definitivas: no se guardan hasta que confirmes.");
	parts.push(
		"Al guardar se bloquean 90 días y se convierten en el instrumento con el que vas a comparar todas las mediciones; el worker las vuelve a chequear, así que la lista puede quedar con menos de las que ves acá.",
	);
	if (inputs !== null) parts.push(generatorInputsNote(inputs));
	return parts.join(" ");
}

/** Lo que se lee cuando NO volvió nada: la causa concreta, no un genérico. */
export function generationFailureMessage(report: LibraryGenerationReport, inputs: GeneratorInputs | null): string {
	const parts: string[] = [];
	if (report.failure !== null) {
		parts.push(`No hay preguntas de compra: ${FAILURE_TEXT[report.failure]}.`);
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
