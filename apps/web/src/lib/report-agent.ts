/**
 * Une un reporte con la auditoría AOS y la medición APS de la marca.
 *
 * El reporte no guarda a qué entidad pertenece: la tabla `reports` solo tiene el nombre de la marca y su
 * web. Así que el vínculo se resuelve por host, que es el dato que sí existe en los dos lados, y el
 * nombre queda como segunda opción. Es una función pura para poder probar la resolución sin base.
 *
 * Lo que se muestra es un **snapshot**: el reporte es un documento fechado y el AOS/APS siguen
 * moviéndose. Por eso el resumen lleva su propia fecha y el reporte la imprime: mezclar la foto del
 * reporte con un AOS medido tres semanas después sin decirlo sería mentir con números reales.
 */

/** El mínimo que necesitamos de una entidad para poder vincularla. */
export interface ReportEntityRef {
	id: string;
	name: string;
	websiteUrl: string | null;
	entityType: string;
	isPublished: boolean;
}

export interface ReportAgentTarget {
	website: string | null | undefined;
	name: string | null | undefined;
}

/** El host de una URL, sin `www.` y en minúscula. `null` si no es una URL usable. */
export function hostOf(url: string | null | undefined): string | null {
	if (typeof url !== "string" || url.trim().length === 0) return null;
	try {
		const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
		return parsed.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return null;
	}
}

function normalizedName(name: string | null | undefined): string | null {
	if (typeof name !== "string") return null;
	const trimmed = name.trim().toLowerCase();
	return trimmed.length === 0 ? null : trimmed;
}

/**
 * Encuentra la entidad del reporte.
 *
 * Gana el host exacto; si no, la que comparte el dominio registrable (`felix.com` contra
 * `www.felix.com` ya lo cubre `hostOf`, pero `tienda.felix.com` contra `felix.com` no); y recién
 * después el nombre. Si el reporte no se puede vincular, se devuelve `null` y el reporte lo dice: es
 * mejor que mostrar el AOS de otra marca.
 */
export function matchEntityForReport(entities: ReportEntityRef[], target: ReportAgentTarget): ReportEntityRef | null {
	if (entities.length === 0) return null;
	const targetHost = hostOf(target.website);

	if (targetHost !== null) {
		const exact = entities.find((entity) => hostOf(entity.websiteUrl) === targetHost);
		if (exact !== undefined) return exact;

		const targetRoot = registrableDomain(targetHost);
		if (targetRoot !== null) {
			const sameRoot = entities.find((entity) => {
				const host = hostOf(entity.websiteUrl);
				return host !== null && registrableDomain(host) === targetRoot;
			});
			if (sameRoot !== undefined) return sameRoot;
		}
	}

	const targetName = normalizedName(target.name);
	if (targetName !== null) {
		const byName = entities.find((entity) => normalizedName(entity.name) === targetName);
		if (byName !== undefined) return byName;
	}

	return null;
}

/**
 * El dominio registrable, con una aproximación deliberadamente conservadora: los dos últimos
 * segmentos, salvo los sufijos de dos niveles que sí conocemos (`com.co`, `com.mx`, …). No pretende
 * ser la Public Suffix List: sirve para no confundir `felix.com` con `felix.com.mx`, no para
 * parsear cualquier TLD.
 */
const TWO_LEVEL_SUFFIXES = new Set([
	"com.ar",
	"com.br",
	"com.co",
	"com.mx",
	"com.pe",
	"com.ve",
	"com.ec",
	"com.cl",
	"co.uk",
	"com.au",
]);

export function registrableDomain(host: string): string | null {
	const parts = host.toLowerCase().split(".").filter(Boolean);
	if (parts.length < 2) return null;
	const lastTwo = parts.slice(-2).join(".");
	if (parts.length >= 3 && TWO_LEVEL_SUFFIXES.has(lastTwo)) return parts.slice(-3).join(".");
	return lastTwo;
}

export interface ReportRequirement {
	id: string;
	title: string;
	axis: string;
	status: string;
	gain?: number;
	diagnostic?: boolean;
}

/**
 * Lee los requisitos guardados en la auditoría. El campo es `json`, así que se valida al leer: un
 * cambio de forma no puede romper el reporte entero.
 */
export function readRequirements(raw: unknown): ReportRequirement[] {
	if (Array.isArray(raw) === false) return [];
	const result: ReportRequirement[] = [];
	for (const entry of raw) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry as Record<string, unknown>;
		if (typeof record.id !== "string" || typeof record.status !== "string") continue;
		const requirement: ReportRequirement = {
			id: record.id,
			title: typeof record.title === "string" ? record.title : record.id,
			axis: typeof record.axis === "string" ? record.axis : "aos",
			status: record.status,
		};
		if (typeof record.gain === "number" && Number.isFinite(record.gain)) requirement.gain = record.gain;
		if (record.diagnostic === true) requirement.diagnostic = true;
		result.push(requirement);
	}
	return result;
}

export interface AosSummary {
	/** Solo los puntuados: un diagnóstico nunca puntúa y no puede contar como logro. */
	scored: number;
	passing: number;
	failing: number;
	notApplicable: number;
	/** Los que hoy fallan y más puntos devolverían, de mayor a menor. */
	nextSteps: ReportRequirement[];
}

/**
 * Resume una auditoría para el reporte.
 *
 * Los diagnósticos se excluyen de los conteos a propósito: si entraran, un reporte podría mostrar "18 de
 * 19 requisitos" cuando el score solo se mueve con 11. La cuenta tiene que coincidir con el número.
 */
export function summarizeAos(rawRequirements: unknown, limit = 4): AosSummary {
	const requirements = readRequirements(rawRequirements).filter((requirement) => requirement.diagnostic !== true);
	const passing = requirements.filter((requirement) => requirement.status === "pass");
	const failing = requirements.filter((requirement) => requirement.status === "fail");
	const notApplicable = requirements.filter(
		(requirement) => requirement.status === "n_a" || requirement.status === "na",
	);
	const nextSteps = [...failing]
		.filter((requirement) => requirement.gain !== undefined)
		.sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0))
		.slice(0, limit);
	return {
		scored: requirements.length,
		passing: passing.length,
		failing: failing.length,
		notApplicable: notApplicable.length,
		nextSteps,
	};
}

export interface ApsModelScore {
	model: string;
	aps: number;
	band: string;
	observations: number;
	partial: boolean;
	p10?: number | null;
	p50?: number | null;
	p90?: number | null;
}

export interface ApsSummary {
	/** Cuántos modelos respondieron. */
	models: number;
	best: ApsModelScore | null;
	worst: ApsModelScore | null;
	/** La distancia entre el mejor y el peor: si es ancha, la marca no es pareja entre asistentes. */
	spread: number | null;
	/** Cuántos modelos cayeron en bandas distintas. Más de una = el resultado depende de a quién le preguntes. */
	distinctBands: number;
	/** true si alguna corrida respondió menos prompts de los que planeó. */
	partial: boolean;
}

/**
 * Resume la medición APS.
 *
 * El promedio se evita a propósito: con 3 modelos el promedio esconde justo lo que importa —que uno
 * responde distinto del otro—. Se muestran el mejor, el peor y la distancia.
 */
export function summarizeAps(scores: ApsModelScore[]): ApsSummary {
	if (scores.length === 0) {
		return { models: 0, best: null, worst: null, spread: null, distinctBands: 0, partial: false };
	}
	const sorted = [...scores].sort((a, b) => b.aps - a.aps);
	const best = sorted[0] ?? null;
	const worst = sorted[sorted.length - 1] ?? null;
	return {
		models: scores.length,
		best,
		worst,
		spread: best !== null && worst !== null ? best.aps - worst.aps : null,
		distinctBands: new Set(scores.map((score) => score.band)).size,
		partial: scores.some((score) => score.partial),
	};
}
