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
 * La decisión es una función pura para poder probarla sin base ni red. El IO vive en el server fn.
 */

/**
 * Cuenta los claims de un `brand.json`.
 *
 * Devuelve `null` — y no `0` — cuando no hay archivo o no es JSON parseable. La diferencia importa:
 * "no pude leerlo" no es "no declara nada", y confundirlas bloquearía publicaciones legítimas.
 */
export function claimCount(content: string | null | undefined): number | null {
	if (typeof content !== "string" || content.trim().length === 0) return null;
	try {
		const parsed = JSON.parse(content) as { claims?: unknown };
		return Array.isArray(parsed.claims) ? parsed.claims.length : 0;
	} catch {
		return null;
	}
}

export interface ClaimsGuardDecision {
	/** true = no se publica. */
	blocked: boolean;
	/** Por qué se bloquea, en palabras del operador. */
	reason?: string;
	/** Qué no se pudo verificar. Se muestra pero no bloquea. */
	warning?: string;
}

/**
 * Decide si un bundle puede publicarse, comparando sus claims con los del perfil que el sitio sirve.
 *
 * Bloquea solo en el caso que importa: que el bundle **pierda** claims. Empates y mejoras pasan.
 * Cuando falta información para comparar, **no bloquea y avisa**: el guardián protege de una
 * regresión, no reemplaza la decisión del operador.
 */
export function claimsGuardDecision(fromBundle: number | null, fromLive: number | null): ClaimsGuardDecision {
	if (fromBundle === null) {
		return { blocked: false, warning: "No hay un brand.json generado para comparar: no pudimos verificar regresión de claims." };
	}
	if (fromLive === null) {
		return {
			blocked: false,
			warning: "No pudimos leer el perfil del sitio para comparar claims. Se publica sin esa verificación.",
		};
	}
	if (fromLive > fromBundle) {
		return {
			blocked: true,
			reason:
				`El perfil del sitio declara ${fromLive} claims y el bundle declara ${fromBundle}. ` +
				`Publicar así degradaría la evidencia verificable de la marca (y su APS declarado). ` +
				`Regenerá el bundle cuando los claims estén sincronizados, o corregí la fuente. ` +
				`Este guardián compara, no traduce texto: escribir claims por vos sería inventar evidencia.`,
		};
	}
	return { blocked: false };
}
