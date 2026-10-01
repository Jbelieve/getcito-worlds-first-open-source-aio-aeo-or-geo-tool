/**
 * Guardián de regresión de claims, en el gate de publicación.
 *
 * El caso real que lo motivó: el DNA que BeAOS sincroniza trae `claims[]` vacío y la evidencia como
 * texto libre (`client_results`, y `references_summary` = "23 referencias subidas (sin analizar)").
 * El bundle que BeAOS genera declara entonces **0 claims**, mientras el sitio sirve **6** y su APS
 * declarado es 94. Publicarlo tal cual degradaría la evidencia verificable del cliente **en
 * silencio**, y el gate lo dejaría pasar porque hoy solo mira que el archivo exista.
 *
 * Deliberadamente NO convierte texto en claims: eso sería inventar evidencia, y el estándar lo
 * prohíbe explícitamente ("AOS links proofs, it does not create them"). Compara y bloquea; la fuente
 * se arregla donde corresponde.
 *
 * Y distingue **propias de prestadas**, que es la segunda lección: el candado protege la evidencia que
 * esta entidad declara, no la que le prestó el paraguas. Cuando el operador le saca el padre a un
 * producto, el bundle deja de heredar y su conteo **baja a propósito**; eso no es una regresión y
 * bloquearlo sería frenar el cambio honesto. La marca de "prestada" no se adivina ni se resta: se lee
 * la que el generador escribe en el perfil (`[Heredada del paraguas …]`, ver
 * `@workspace/aos-aps/claims/mapping`), la misma de los dos lados de la comparación.
 *
 * La decisión es una función pura para poder probarla sin base ni red. El IO vive en el server fn.
 */

import { INHERITED_PREFIX_LABEL } from "@workspace/aos-aps/claims/mapping";

/**
 * El arranque exacto con el que el perfil firmado declara una prueba prestada.
 *
 * Se arma con el literal del generador y no con una copia propia: si la marca cambiara, el candado
 * dejaría de reconocerla **en silencio**, que es la peor forma de romper un guardián. Sin corchete de
 * cierre, porque el prefijo viaja con nombre de paraguas (`[Heredada del paraguas Believe]`) y sin él
 * (`[Heredada del paraguas]`).
 */
const INHERITED_MARK = `[${INHERITED_PREFIX_LABEL}`;

/**
 * El desglose de un `brand.json`: cuántas pruebas declara, cuántas son prestadas y cuántas propias.
 *
 * Los tres números salen del mismo parseo porque el candado necesita los tres: comparar solo totales
 * fue lo que lo hizo indistinguir "perdí una prueba mía" de "dejé de usar una que me prestaron".
 */
export interface ClaimTally {
	/** Todo lo que el perfil declara. */
	total: number;
	/** Las que viajan marcadas como heredadas del paraguas. */
	inherited: number;
	/** Las propias de esta entidad: `total - inherited`. Son las que el candado protege. */
	own: number;
}

/**
 * Desglosa los claims de un `brand.json` sin parsear: sirve cuando la lista ya está en memoria —el
 * bundle que el generador acaba de resolver— y evita que el mismo conteo se escriba dos veces.
 *
 * Un valor que no es una lista declara cero: eso es un dato, no un fallo de lectura.
 */
export function tallyClaims(claims: unknown): ClaimTally {
	if (Array.isArray(claims) === false) return { total: 0, inherited: 0, own: 0 };
	const inherited = claims.filter(isInheritedClaim).length;
	return { total: claims.length, inherited, own: claims.length - inherited };
}

/**
 * Desglosa los claims de un `brand.json`.
 *
 * Devuelve `null` — y no ceros — cuando no hay archivo o no es JSON parseable. La diferencia importa:
 * "no pude leerlo" no es "no declara nada", y confundirlas bloquearía publicaciones legítimas.
 *
 * Un perfil sin `claims[]` sí declara cero: eso es un dato, no un fallo de lectura.
 */
export function claimTally(content: string | null | undefined): ClaimTally | null {
	if (typeof content !== "string" || content.trim().length === 0) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(content);
	} catch {
		return null;
	}
	if (typeof parsed !== "object" || parsed === null) return { total: 0, inherited: 0, own: 0 };
	return tallyClaims((parsed as { claims?: unknown }).claims);
}

/**
 * ¿Esta prueba del perfil viaja marcada como prestada?
 *
 * La marca vive en `evidence.summary`, y el claim del perfil firmado lleva su prueba adentro
 * (`proofs[0]`, ver `claimFromRow`), así que se mira ahí. Se acepta también un `evidence` colgado del
 * propio claim por si el perfil lo declara así.
 *
 * Es deliberadamente estricto: solo cuenta la marca exacta que escribe el generador, al principio del
 * resumen. Ante la duda —una marca rara, un resumen editado a mano— la prueba cuenta como **propia**,
 * que es el lado que bloquea. Un falso "prestada" dejaría pasar una pérdida de evidencia propia; un
 * falso "propia" solo pide que el operador mire.
 */
function isInheritedClaim(claim: unknown): boolean {
	if (typeof claim !== "object" || claim === null) return false;
	const record = claim as { evidence?: unknown; proofs?: unknown };
	if (hasInheritedMark(record.evidence)) return true;
	if (Array.isArray(record.proofs) === false) return false;
	return record.proofs.some((proof) => {
		if (typeof proof !== "object" || proof === null) return false;
		return hasInheritedMark((proof as { evidence?: unknown }).evidence);
	});
}

function hasInheritedMark(evidence: unknown): boolean {
	if (typeof evidence !== "object" || evidence === null) return false;
	const summary = (evidence as { summary?: unknown }).summary;
	return typeof summary === "string" && summary.startsWith(INHERITED_MARK);
}

export interface ClaimsGuardDecision {
	/** true = no se publica. */
	blocked: boolean;
	/** Por qué se bloquea, en palabras del operador. */
	reason?: string;
	/** Qué no se pudo verificar, o qué cambió sin ser una regresión. Se muestra pero no bloquea. */
	warning?: string;
}

/**
 * Las webs donde puede estar el perfil del sitio, en orden de preferencia.
 *
 * Existe por un agujero real: el candado miraba **un solo** campo, la web de la entidad, y ese campo
 * estaba vacío en la entidad de Believe. Con la web vacía no se podía leer el perfil del sitio, y "no
 * pude leerlo" **no bloquea** —así está diseñado, para no frenar publicaciones legítimas cuando el sitio
 * está caído—. El resultado era que la protección desaparecía justo cuando más hacía falta.
 *
 * La web de una marca vive en tres lugares y ninguno es obligatorio: la entidad (lo más específico), el
 * DNA que sincroniza Maasy, y la marca. Se devuelven todas, en ese orden, y el llamador prueba una por
 * una. Es una función pura para poder probar la precedencia sin base ni red.
 */
export function websiteSourcesForClaims(input: {
	entityWebsite?: string | null;
	dnaWebsite?: unknown;
	brandWebsite?: string | null;
}): string[] {
	// La web de la ENTIDAD, si existe, es LA web: no se sustituye por otra.
	//
	// El error que esto corrige: la cadena probaba entidad -> DNA -> marca y se quedaba con la primera
	// que RESPONDIERA. Con BeScore eso comparó el bundle de un producto nuevo contra la web corporativa
	// de Believe --que sirve 6 claims-- y el candado bloqueó una publicacion legitima por un sitio que
	// BeScore no es. El respaldo tiene que rellenar un campo VACIO, no cambiar de sitio.
	const entity = typeof input.entityWebsite === "string" ? input.entityWebsite.trim() : "";
	if (entity.length > 0) return [entity];

	// Solo cuando la entidad no tiene web cargada se busca donde vive el resto de la identidad.
	const candidates = [input.dnaWebsite, input.brandWebsite];
	const sources: string[] = [];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") continue;
		const trimmed = candidate.trim();
		if (trimmed.length === 0 || sources.includes(trimmed)) continue;
		sources.push(trimmed);
	}
	return sources;
}

/**
 * Decide si un bundle puede publicarse, comparando sus pruebas **propias** con las del perfil que el
 * sitio sirve.
 *
 * La regla, en una línea: se bloquea cuando el bundle pierde pruebas propias. Nada más.
 *
 *   - Empates y mejoras de propias pasan.
 *   - Perder prestadas **no** bloquea: es lo que pasa al sacarle el padre a un producto, y el perfil
 *     queda más chico a propósito. Se avisa, con el número, en vez de callarlo.
 *   - Perder propias bloquea igual que siempre, incluso si el total no baja (una prestada nueva puede
 *     tapar la pérdida de una propia). Ese es el agujero que el candado existe para tapar.
 *   - Cuando falta información para comparar, **no bloquea y avisa**: el guardián protege de una
 *     regresión, no reemplaza la decisión del operador.
 */
export function claimsGuardDecision(fromBundle: ClaimTally | null, fromLive: ClaimTally | null): ClaimsGuardDecision {
	if (fromBundle === null) {
		return {
			blocked: false,
			warning: "No hay un brand.json generado para comparar: no pudimos verificar regresión de claims.",
		};
	}
	if (fromLive === null) {
		return {
			blocked: false,
			warning: "No pudimos leer el perfil del sitio para comparar claims. Se publica sin esa verificación.",
		};
	}
	if (fromLive.own > fromBundle.own) {
		// Las prestadas se nombran aparte para que el operador vea que NO son la causa del bloqueo: el
		// problema es una prueba propia, y eso no se arregla regenerando la herencia.
		const borrowedNote =
			fromLive.inherited > 0
				? ` (el sitio además declara ${fromLive.inherited} prestada${fromLive.inherited === 1 ? "" : "s"} del paraguas, que no cuentan como propias)`
				: "";
		return {
			blocked: true,
			reason:
				`El perfil del sitio declara ${fromLive.own} pruebas propias y el bundle declara ${fromBundle.own}${borrowedNote}. ` +
				`Publicar así degradaría la evidencia verificable de la marca (y su APS declarado). ` +
				`Regenerá el bundle cuando los claims estén sincronizados, o corregí la fuente. ` +
				`Este guardián compara, no traduce texto: escribir claims por vos sería inventar evidencia.`,
		};
	}
	if (fromLive.inherited > fromBundle.inherited) {
		const dropped = fromLive.inherited - fromBundle.inherited;
		return {
			blocked: false,
			warning:
				`El perfil del sitio declaraba ${dropped} prestada${dropped === 1 ? "" : "s"} del paraguas y el bundle ya no las usa: se publica. ` +
				`Dejar de heredar no es perder evidencia propia: las ${fromBundle.own} pruebas propias del bundle siguen declaradas.`,
		};
	}
	return { blocked: false };
}
