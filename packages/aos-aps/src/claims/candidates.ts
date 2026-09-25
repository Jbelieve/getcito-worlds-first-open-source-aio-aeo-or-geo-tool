/**
 * Candidatos a claim: lo que Maasy YA manda, mostrado tal cual, para que un humano decida.
 *
 * El problema que resuelve: el contexto de marca de Maasy trae la evidencia **en prosa** —resultados de
 * cliente con cifras, testimonios, un conteo de proyectos, un resumen de referencias sin analizar— y
 * **no tiene** `claims` ni `proofs` en su modelo. El bundle salía entonces con 0 claims mientras el sitio
 * servía 6, y el candado de publicación lo bloqueaba con razón.
 *
 * BeAOS no puede convertir esa prosa en claims solo. El estándar lo dice: *"AOS links proofs, it does not
 * create them"*. Si BeAOS redacta un claim a partir de una frase, inventa evidencia, y un dato inventado
 * en la capa de confianza es peor que su ausencia: destruye lo único que la marca está vendiendo, que es
 * que lo que dice se puede verificar.
 *
 * Así que este módulo **no decide**: propone. Devuelve el fragmento original sin tocar, los números que
 * ya estaban escritos en él, y por qué puede ser un claim. El operador confirma, redacta y dice con qué
 * documento se prueba. La diferencia con un parser automático es la de un formulario contra una firma.
 *
 * Reglas duras, y son el punto entero del módulo:
 *   1. `fragment` es copia literal del texto de Maasy. No se reescribe, no se resume, no se traduce.
 *   2. `suggestedMetric` sale de los dígitos que YA están en el fragmento. Si no hay número, va vacío.
 *   3. `suggestedStatement` es una **propuesta marcada como propuesta**, no una afirmación de BeAOS.
 */

/**
 * Un candidato a claim: evidencia que Maasy ya declara, lista para que un operador la confirme.
 *
 * `id` es estable y sale del campo y del índice de la ocurrencia, así que el mismo contexto produce los
 * mismos ids y la UI no pierde el formulario abierto cuando se vuelve a sincronizar el DNA.
 */
export interface ClaimCandidate {
	/** Estable, derivado del campo y el índice de la ocurrencia. */
	id: string;
	/** `"client_results"` | `"testimonials"` | `"social_proof_count"` | `"references_summary"`. */
	sourceField: string;
	/** EL TEXTO ORIGINAL, sin tocar. */
	fragment: string;
	/** Los números que YA están en el fragmento, extraídos, no inventados. Vacío si no hay. */
	suggestedMetric?: string;
	/** Una propuesta de redacción, marcada como propuesta. */
	suggestedStatement?: string;
	suggestedProofType: string;
	/** Qué documento podría probarlo. */
	suggestedProofHint?: string;
	/** Por qué es candidato, en humano. */
	why: string;
}

/** Los campos de Maasy que traen evidencia en prosa, en el orden en que se muestran a igual fuerza. */
export const CLAIM_SOURCE_FIELDS = [
	"client_results",
	"social_proof_count",
	"testimonials",
	"references_summary",
] as const;

/**
 * Un fragmento más corto que esto no puede ser un claim: es un nombre, una etiqueta o un resto de
 * formato. El piso existe para que la lista de candidatos no se llene de ruido —no para descartar
 * evidencia, que el operador puede escribir a mano igual.
 */
const MIN_FRAGMENT_LENGTH = 12;

/** Una propuesta siempre se ve como propuesta: si el operador no la edita, se nota que no la escribió. */
const PROPOSAL_PREFIX = "[Propuesta] ";

/**
 * Los números escritos en el fragmento.
 *
 * El lookbehind evita morder la parte numérica de una palabra (`MAAS2` no aporta un `2`) y el `%` viaja
 * pegado porque cambia el significado: `35` y `35%` no son lo mismo.
 */
const NUMBER_PATTERN = /(?<![\p{L}\d])\d+(?:[.,]\d+)?\s*%?/gu;

/** Un bullet o una numeración de lista: es formato del texto, no texto de Maasy. */
const LIST_MARKER_PATTERN = /^\s*(?:[-*•–—]|\d+[.)])\s+/;

/** El resumen de referencias dice que hay documentos que nadie abrió. Eso es información accionable. */
const UNANALYZED_PATTERN = /sin\s+analizar|sin\s+revisar|no\s+analizad|pendiente[s]?\s+de\s+an[aá]lisis/i;

interface SourceSpec {
	field: (typeof CLAIM_SOURCE_FIELDS)[number];
	proofType: string;
	proofHint: string;
	/** Por qué el fragmento es candidato, con los números ya extraídos. */
	why: (numbers: string[]) => string;
}

/**
 * Cómo se lee cada campo, en palabras del operador.
 *
 * El `why` dice la verdad incómoda cuando corresponde: sin número no hay métrica, y poner una sería
 * inventarla. Decirlo es más útil que dejar el campo vacío sin explicación.
 */
const SOURCE_SPECS: SourceSpec[] = [
	{
		field: "client_results",
		proofType: "case_study",
		proofHint: "Un caso de cliente, reporte de resultados o captura que muestre esas cifras.",
		why: (numbers) =>
			numbers.length === 0
				? "Resultado de cliente que Maasy ya declara, en prosa. No trae cifras, así que la métrica queda vacía: completarla sería inventarla."
				: `Resultado de cliente con cifras que ya están en la fuente (${numbers.join(", ")}). Es la materia prima de un claim verificable: el número lo puso Maasy, no BeAOS.`,
	},
	{
		field: "social_proof_count",
		proofType: "document",
		proofHint: "Un registro de proyectos instalados, certificados o clientes activos.",
		why: (numbers) =>
			numbers.length === 0
				? "Volumen declarado por Maasy, sin cifra legible en el fragmento. Un claim de alcance sin número no dice nada."
				: `Volumen declarado por Maasy (${numbers.join(", ")}). Es un dato agregado, no un resultado: sirve como claim de alcance, no de desempeño.`,
	},
	{
		field: "testimonials",
		proofType: "testimonial",
		proofHint: "El testimonio original, publicado o firmado por el cliente que lo dijo.",
		why: (numbers) =>
			numbers.length === 0
				? "Testimonio de cliente en prosa. Sin número no hay métrica, pero puede sostener un claim de experiencia o de método."
				: `Testimonio de cliente con cifras (${numbers.join(", ")}). Ojo: un testimonio prueba que el cliente lo dijo, no que el resultado sea generalizable.`,
	},
	{
		field: "references_summary",
		proofType: "document",
		proofHint: "Las referencias subidas a Maasy: hay que abrirlas y elegir cuál prueba este claim.",
		why: (numbers) =>
			numbers.length === 0
				? "Resumen de referencias que Maasy declara."
				: `Resumen de referencias que Maasy declara (${numbers.join(", ")}).`,
	},
];

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && Array.isArray(value) === false
		? (value as Record<string, unknown>)
		: undefined;
}

/** Un fragmento válido: texto con algo adentro, no un espacio ni una etiqueta de tres letras. */
function usableFragment(value: string): string | undefined {
	const trimmed = value.trim();
	return trimmed.length >= MIN_FRAGMENT_LENGTH ? trimmed : undefined;
}

/**
 * Corta un texto en fragmentos por los límites que el propio texto ya tiene: saltos de línea, bullets y
 * final de oración. No reformula nada: cada fragmento sigue siendo el texto literal de Maasy, recortado
 * en un borde que ya existía.
 */
function fragmentsOfText(text: string): string[] {
	const fragments: string[] = [];
	for (const rawLine of text.split(/\r?\n/)) {
		// El guion del bullet es formato de la lista, no una palabra de Maasy.
		const line = rawLine.replace(LIST_MARKER_PATTERN, "").trim();
		if (line.length === 0) continue;
		for (const sentence of line.split(/(?<=[.!?…])\s+/)) {
			const fragment = usableFragment(sentence);
			if (fragment !== undefined) fragments.push(fragment);
		}
	}
	return fragments;
}

/**
 * Los fragmentos de un valor de Maasy.
 *
 * Un objeto se recorre por sus valores de texto: son palabras de Maasy, no nuestras. La longitud mínima
 * filtra lo que no es evidencia —un nombre de cliente suelto, un id— sin borrar nada que sí lo sea.
 */
function fragmentsOfValue(value: unknown, depth = 0): string[] {
	if (typeof value === "string") return fragmentsOfText(value);
	if (Array.isArray(value)) {
		const fragments: string[] = [];
		for (const entry of value) fragments.push(...fragmentsOfValue(entry, depth + 1));
		return fragments;
	}
	const record = asRecord(value);
	if (record === undefined || depth > 1) return [];
	const fragments: string[] = [];
	for (const entry of Object.values(record)) fragments.push(...fragmentsOfValue(entry, depth + 1));
	return fragments;
}

/** Los números que ya están escritos en el fragmento, sin duplicados y en el orden en que aparecen. */
export function numbersInFragment(fragment: string): string[] {
	const found: string[] = [];
	for (const match of fragment.matchAll(NUMBER_PATTERN)) {
		const value = (match[0] ?? "").replace(/\s+/g, "");
		if (value.length === 0 || found.includes(value)) continue;
		found.push(value);
	}
	return found;
}

function isUnanalyzedReferences(value: unknown): boolean {
	return typeof value === "string" && UNANALYZED_PATTERN.test(value);
}

/**
 * El candidato de las referencias sin analizar.
 *
 * Es distinto de los demás y por eso se emite aparte: no afirma nada sobre la marca, dice que hay N
 * documentos que podrían probar claims y que **nadie los abrió**. Es lo más accionable de todo el
 * contexto —cada referencia puede ser la prueba de un claim— y por eso no se le pone `suggestedMetric`
 * aunque el texto tenga un número: ese número cuenta documentos, no resultados, y mostrarlo como métrica
 * de un claim sería confundir las dos cosas.
 */
function unanalyzedReferencesCandidate(fragment: string, documents: string[]): ClaimCandidate {
	const count = documents[0];
	return {
		id: "references_summary-unanalyzed",
		sourceField: "references_summary",
		fragment,
		suggestedStatement: `${PROPOSAL_PREFIX}Hay ${count ?? "varias"} referencias subidas que todavía no se analizaron.`,
		suggestedProofType: "document",
		suggestedProofHint:
			count === undefined
				? "Están entre las referencias subidas a Maasy: hay que abrirlas y elegir cuál prueba cada claim."
				: `Está entre las ${count} referencias subidas a Maasy: hay que abrirlas y elegir cuál prueba cada claim.`,
		why:
			count === undefined
				? "Maasy declara referencias subidas y **sin analizar**. Son documentos que podrían probar claims y hoy nadie los abrió: es información accionable, no un claim."
				: `Maasy declara ${count} referencias subidas y **sin analizar**. Son ${count} documentos que podrían probar claims y hoy nadie los abrió: es información accionable, no un claim.`,
	};
}

/**
 * Propone candidatos a claim a partir del contexto de marca de Maasy.
 *
 * Recorre los campos que traen evidencia en prosa, arriba del contexto **y** dentro de `dna`, porque el
 * contexto real de Believe anida ahí `client_results` y `testimonials`. Devuelve los fragmentos
 * literales, ordenados por fuerza de la evidencia: los que ya tienen un número primero.
 *
 * No inventa nada: no hay números que no estuvieran escritos, no hay fragmentos que no vinieran del
 * contexto, y no hay afirmaciones que BeAOS firme.
 */
export function proposeClaimCandidates(context: unknown): ClaimCandidate[] {
	const record = asRecord(context);
	if (record === undefined) return [];
	const dna = asRecord(record.dna);

	const scored: Array<{ candidate: ClaimCandidate; rank: number; order: number }> = [];
	const counters = new Map<string, number>();
	const seenFragments = new Map<string, Set<string>>();
	let order = 0;

	for (const spec of SOURCE_SPECS) {
		// El campo puede venir arriba del contexto o dentro de `dna`. Se miran los dos: el contexto real
		// de Believe anida `client_results` y `testimonials` en `dna`.
		const values: unknown[] = [];
		if (record[spec.field] !== undefined) values.push(record[spec.field]);
		if (dna !== undefined && dna[spec.field] !== undefined) values.push(dna[spec.field]);
		if (values.length === 0) continue;

		const unanalyzed = values.filter(isUnanalyzedReferences);
		if (unanalyzed.length > 0) {
			const fragment = (unanalyzed[0] as string).trim();
			scored.push({
				candidate: unanalyzedReferencesCandidate(fragment, numbersInFragment(fragment)),
				// El número cuenta documentos, no resultados: no lo hace más fuerte que una cifra de negocio.
				rank: 1,
				order: order++,
			});
			continue;
		}

		for (const value of values) {
			for (const fragment of fragmentsOfValue(value)) {
				const seen = seenFragments.get(spec.field) ?? new Set<string>();
				// El mismo texto arriba y dentro de `dna` es un candidato, no dos.
				if (seen.has(fragment)) continue;
				seen.add(fragment);
				seenFragments.set(spec.field, seen);

				const numbers = numbersInFragment(fragment);
				const index = counters.get(spec.field) ?? 0;
				counters.set(spec.field, index + 1);
				scored.push({
					candidate: {
						id: `${spec.field}-${index}`,
						sourceField: spec.field,
						fragment,
						suggestedMetric: numbers.length === 0 ? undefined : numbers.join(", "),
						// No se reformula el fragmento: reformular sería redactar la afirmación por el
						// operador. Se propone tal cual, marcado, para que él lo edite con criterio.
						suggestedStatement: `${PROPOSAL_PREFIX}${fragment}`,
						suggestedProofType: spec.proofType,
						suggestedProofHint: spec.proofHint,
						why: spec.why(numbers),
					},
					rank: numbers.length === 0 ? 1 : 0,
					order: order++,
				});
			}
		}
	}

	// Fuerza primero (los que tienen número), después el orden de los campos y al final el orden en que
	// Maasy los manda. Es estable a propósito: la lista no baila entre sincronizaciones.
	const fieldRank = new Map<string, number>(CLAIM_SOURCE_FIELDS.map((field, index) => [field, index]));
	return scored
		.sort((left, right) => {
			if (left.rank !== right.rank) return left.rank - right.rank;
			const byField =
				(fieldRank.get(left.candidate.sourceField) ?? 0) - (fieldRank.get(right.candidate.sourceField) ?? 0);
			return byField !== 0 ? byField : left.order - right.order;
		})
		.map((entry) => entry.candidate);
}
