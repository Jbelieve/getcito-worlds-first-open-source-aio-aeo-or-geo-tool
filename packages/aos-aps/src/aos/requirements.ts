/**
 * AOS/APS requirements rubric.
 *
 * The SCORED list is a one-to-one port of MAASY's `_shared/aos-standards-check.ts` — ids, strengths,
 * signals and weights included — because BeAOS and the Maasy audit must report the SAME number for
 * the same site. Maasy deliberately scores a live-checkable subset of spec.json v0.1.0; adding the
 * rest here moved the denominator and produced a different score for the same site.
 *
 * The remaining spec.json requirements are checked as `EXTENDED_REQUIREMENTS` and reported as
 * diagnostics only. They never change `aos_standards` or `aps_standards`.
 */

export type BusinessType = "brand" | "product_api";
export type Axis = "AOS" | "APS";
export type Strength = "MUST" | "SHOULD" | "MAY";
export type Status = "pass" | "fail" | "n_a";

export interface RequirementDef {
	id: string;
	axis: Axis;
	strength: Strength;
	title: string;
	applies: BusinessType[];
	signal: string;
}

/** Scored subset. Identical to the Maasy checker, element for element. */
export const REQUIREMENTS: RequirementDef[] = [
	{
		id: "AOS-DISC-01",
		axis: "AOS",
		strength: "SHOULD",
		title: "llms.txt",
		applies: ["brand", "product_api"],
		signal: "llms_txt",
	},
	{
		id: "AOS-DISC-03",
		axis: "AOS",
		strength: "SHOULD",
		title: "AGENTS.md",
		applies: ["brand", "product_api"],
		signal: "agents_md",
	},
	{
		id: "AOS-DISC-04",
		axis: "AOS",
		strength: "MUST",
		title: "robots.txt + sitemap",
		applies: ["brand", "product_api"],
		signal: "robots_sitemap",
	},
	{
		id: "AOS-CONT-01",
		axis: "AOS",
		strength: "SHOULD",
		title: "JSON-LD identity",
		applies: ["brand", "product_api"],
		signal: "jsonld",
	},
	{
		id: "AOS-IDEN-01",
		axis: "AOS",
		strength: "MUST",
		title: "A2A Agent Card",
		applies: ["brand", "product_api"],
		signal: "agent_card",
	},
	{
		id: "AOS-IDEN-02",
		axis: "AOS",
		strength: "SHOULD",
		title: "Agent permissions",
		applies: ["brand", "product_api"],
		signal: "agent_permissions",
	},
	{
		id: "AOS-CAPA-01",
		axis: "AOS",
		strength: "SHOULD",
		title: "MCP Server Card",
		applies: ["brand", "product_api"],
		signal: "mcp_server_card",
	},
	{
		id: "AOS-API-01",
		axis: "AOS",
		strength: "MUST",
		title: "Public API / OpenAPI",
		applies: ["product_api"],
		signal: "openapi",
	},
	{
		id: "APS-CLAIM-01",
		axis: "APS",
		strength: "MUST",
		title: "brand.json Claims & Proofs",
		applies: ["brand", "product_api"],
		signal: "brand_json",
	},
	{
		id: "APS-PROV-02",
		axis: "APS",
		strength: "SHOULD",
		title: "Public key (keys.json)",
		applies: ["brand", "product_api"],
		signal: "keys_json",
	},
	{
		id: "APS-PROV-01",
		axis: "APS",
		strength: "SHOULD",
		title: "Ed25519 signature verifies",
		applies: ["brand", "product_api"],
		signal: "signature_valid",
	},
];

/**
 * The rest of spec.json v0.1.0, checked for the report but excluded from the score. A fail here is
 * a real gap against the published standard; it is simply not part of the number Maasy also produces.
 */
export const EXTENDED_REQUIREMENTS: RequirementDef[] = [
	{
		id: "AOS-DISC-02",
		axis: "AOS",
		strength: "MAY",
		title: "llms-full.txt",
		applies: ["brand", "product_api"],
		signal: "llms_full_txt",
	},
	{
		id: "AOS-CONT-02",
		axis: "AOS",
		strength: "SHOULD",
		title: "Proof objects as structured data",
		applies: ["brand", "product_api"],
		signal: "proof_objects",
	},
	{
		id: "AOS-CONT-03",
		axis: "AOS",
		strength: "MAY",
		title: "Markdown content negotiation",
		applies: ["brand", "product_api"],
		signal: "markdown_negotiation",
	},
	{
		id: "AOS-CAPA-02",
		axis: "AOS",
		strength: "SHOULD",
		title: "NLWeb /ask endpoint",
		applies: ["brand", "product_api"],
		signal: "nlweb_ask",
	},
	{
		id: "APS-CLAIM-02",
		axis: "APS",
		strength: "MUST",
		title: "Mandatory boundary",
		applies: ["brand", "product_api"],
		signal: "claim_boundaries",
	},
	{
		id: "APS-CLAIM-03",
		axis: "APS",
		strength: "MUST",
		title: "Proofs link to claims",
		applies: ["brand", "product_api"],
		signal: "proofs_link_claims",
	},
	{
		id: "APS-CLAIM-04",
		axis: "APS",
		strength: "MUST",
		title: "Derived confidence",
		applies: ["brand", "product_api"],
		signal: "derived_confidence",
	},
	{
		id: "APS-PROV-03",
		axis: "APS",
		strength: "MAY",
		title: "Web Bot Auth",
		applies: ["brand", "product_api"],
		signal: "http_message_signatures",
	},
];

const STRENGTH_WEIGHT: Record<Strength, number> = { MUST: 3, SHOULD: 2, MAY: 1 };

export interface Probes {
	[signal: string]: boolean;
}

/**
 * Lo que observamos para cada señal, en una línea, indexado por señal.
 *
 * Es PRESENTACIÓN: viaja con cada requerimiento para que el reporte muestre la evidencia en vez de un
 * tilde pelado. No participa de ningún puntaje — el score sigue saliendo solo de `probes`, que es lo
 * que lo mantiene idéntico al de Maasy.
 */
export type EvidenceMap = Record<string, string>;

/** Strong signal only: a brand must not be graded as an API just because it has a website. */
export function classifyBusinessType(signals: {
	hasOpenApi?: boolean;
	hasPublicApi?: boolean;
	industryIsApiProduct?: boolean;
}): BusinessType {
	if (signals.hasOpenApi || signals.hasPublicApi || signals.industryIsApiProduct) return "product_api";
	return "brand";
}

export interface RequirementResult {
	id: string;
	axis: Axis;
	strength: Strength;
	title: string;
	status: Status;
	/** True for the extended checks: reported, never scored. */
	diagnostic?: boolean;
	/** Lo que vimos al comprobarlo. Presentación: no cambia ningún puntaje. */
	evidence?: string;
	/**
	 * Puntos de AOS/APS que devolvería si pasa. Solo en los puntuados que hoy fallan: un diagnóstico
	 * nunca puntúa, así que no tiene puntos que ganar y no aparece acá.
	 */
	gain?: number;
}

export interface StandardsResult {
	business_type: BusinessType;
	requirements: RequirementResult[];
	/**
	 * El desglose por eje del que salen `aos_standards` y `aps_standards`. Es la MISMA cuenta: los dos
	 * sub-scores son el `percent` de cada eje de acá, así que no pueden separarse.
	 */
	breakdown: AxisBreakdown[];
	aos_standards: number;
	aps_standards: number;
	signature_verified: boolean;
}

/**
 * El desglose por eje: de dónde sale cada sub-score.
 *
 * Es el equivalente honesto del `breakdown` por niveles de la extensión vieja de Maasy (inventario /
 * declaración N1 / ejecutabilidad DOM N2 / ejecución programática N3 / confiabilidad). Aquellos
 * cinco niveles son del AOS v1, un rubric que **este motor no corre**: acá no se mide DOM, ni
 * formularios, ni ejecución programática, ni confiabilidad por probes — no hay forma de calcularlos
 * sin inventar números. Lo que sí se puede desglosar sin inventar nada es lo que el score ya usa:
 * cada eje del estándar, con el peso ganado sobre el peso que aplica.
 *
 * Se calcula **acá y no en el cliente** a propósito: el día que cambie `STRENGTH_WEIGHT`, el desglose
 * cambia con él y el popup sigue mostrando el número del motor. Dos implementaciones del AOS se
 * separan; una sola, no.
 *
 * Solo mira los checks puntuados: los `diagnostic` no pesan y un `n_a` no aplica a este tipo de
 * negocio, así que ninguno de los dos entra en el denominador.
 */
export interface AxisBreakdown {
	axis: Axis;
	/** Checks del eje que pasan. */
	passed: number;
	/** Checks del eje que fallan. */
	failed: number;
	/** Checks del eje que no aplican a este tipo de negocio. */
	notApplicable: number;
	/** `passed + failed`: los que entran en el peso. */
	applicable: number;
	earnedWeight: number;
	maxWeight: number;
	/** El sub-score del eje, 0–100. Es el mismo número que `aos_standards` / `aps_standards`. */
	percent: number;
}

/** Orden fijo de los ejes: el desglose no se reordena según quién sacó más. */
const AXES: readonly Axis[] = ["AOS", "APS"];

export function breakdownByAxis(results: RequirementResult[]): AxisBreakdown[] {
	return AXES.map((axis) => {
		const own = results.filter((r) => r.axis === axis);
		const applicable = own.filter((r) => r.status !== "n_a");
		const earnedWeight = applicable.reduce(
			(sum, r) => sum + (r.status === "pass" ? STRENGTH_WEIGHT[r.strength] : 0),
			0,
		);
		const maxWeight = applicable.reduce((sum, r) => sum + STRENGTH_WEIGHT[r.strength], 0);
		return {
			axis,
			passed: applicable.filter((r) => r.status === "pass").length,
			failed: applicable.filter((r) => r.status === "fail").length,
			notApplicable: own.length - applicable.length,
			applicable: applicable.length,
			earnedWeight,
			maxWeight,
			// Sin checks que apliquen no hay nada que medir y el eje vale 0, igual que antes.
			percent: maxWeight === 0 ? 0 : Math.round((earnedWeight / maxWeight) * 100),
		};
	});
}

function evaluate(
	defs: RequirementDef[],
	probes: Probes,
	businessType: BusinessType,
	diagnostic = false,
	evidence?: EvidenceMap,
): RequirementResult[] {
	return defs.map((def) => {
		const applies = def.applies.includes(businessType);
		const status: Status = applies === false ? "n_a" : probes[def.signal] ? "pass" : "fail";
		const result: RequirementResult = { id: def.id, axis: def.axis, strength: def.strength, title: def.title, status };
		if (diagnostic) result.diagnostic = true;
		const observed = evidence?.[def.signal];
		if (observed !== undefined && observed.length > 0) result.evidence = observed;
		return result;
	});
}

/**
 * Los puntos que devolvería cada check puntuado que hoy falla, sobre 100.
 *
 * Es lo que convierte "lo que falta" en un plan ordenado por impacto en vez de una lista. El
 * denominador son los checks PUNTUADOS que aplican a este tipo de negocio: los diagnósticos y los
 * `n_a` quedan afuera, así que un diagnóstico nunca infla el denominador ni se lleva puntos ajenos.
 *
 * Propiedad que sostiene el cálculo: la suma de las ganancias de los que fallan es, redondeo mediante,
 * `100 - score`. Hay un test que lo verifica.
 */
export function estimateGains(results: RequirementResult[]): RequirementResult[] {
	const scored = results.filter((result) => result.diagnostic !== true && result.status !== "n_a");
	const maxByAxis = new Map<Axis, number>();
	for (const result of scored) {
		maxByAxis.set(result.axis, (maxByAxis.get(result.axis) ?? 0) + STRENGTH_WEIGHT[result.strength]);
	}
	return results.map((result) => {
		if (result.diagnostic === true || result.status !== "fail") return result;
		const max = maxByAxis.get(result.axis) ?? 0;
		if (max === 0) return result;
		return { ...result, gain: Math.round((STRENGTH_WEIGHT[result.strength] / max) * 1000) / 10 };
	});
}

/** The scored evaluation: the same output the Maasy audit produces for the same probes. */
export function evaluateStandards(probes: Probes, businessType: BusinessType, evidence?: EvidenceMap): StandardsResult {
	const requirements = estimateGains(evaluate(REQUIREMENTS, probes, businessType, false, evidence));
	// Los dos sub-scores SALEN del desglose: así el número y su explicación no pueden discrepar.
	const breakdown = breakdownByAxis(requirements);
	const axisPercent = (axis: Axis): number => breakdown.find((entry) => entry.axis === axis)?.percent ?? 0;
	return {
		business_type: businessType,
		requirements,
		breakdown,
		aos_standards: axisPercent("AOS"),
		aps_standards: axisPercent("APS"),
		signature_verified: Boolean(probes.signature_valid),
	};
}

/** Diagnostic-only evaluation of the rest of the standard. Never feeds a score. */
export function evaluateExtended(
	probes: Probes,
	businessType: BusinessType,
	evidence?: EvidenceMap,
): RequirementResult[] {
	return evaluate(EXTENDED_REQUIREMENTS, probes, businessType, true, evidence);
}
