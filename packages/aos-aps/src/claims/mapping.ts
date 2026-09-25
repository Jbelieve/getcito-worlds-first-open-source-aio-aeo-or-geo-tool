/**
 * De las filas confirmadas al `claims[]` / `proofs[]` que el generador firma.
 *
 * Este módulo es puro a propósito: la decisión de **qué evidencia entra al bundle** se puede probar sin
 * base de datos y sin red, que es la única forma de que la regla de precedencia no se rompa en silencio.
 *
 * La regla de precedencia, que es la parte delicada:
 *
 *   1. Si el DNA que manda Maasy **ya trae** `claims` con elementos, se usan esos y no se sustituyen.
 *      El día que Maasy mande claims de verdad, BeAOS deja de sustituir y se convierte en un espejo.
 *   2. Si no trae, se usan las **confirmadas** en BeAOS. Los borradores no entran: un borrador es trabajo
 *      en curso, no una declaración firmada.
 *
 * Y una decisión que se aparta de la letra de la tabla, con motivo: `confidence` **no** se emite como
 * `claim.confidence`. El estándar deriva la confianza del tamaño de muestra (`metric.n`) y prohíbe
 * asignarla a mano (`APS-CLAIM-04`); la tabla no tiene `n`, y derivar una muestra de la nada sería
 * exactamente el dato inventado que todo esto evita. La nota del operador queda guardada en BeAOS.
 */

import type { AgentBrandClaim } from "../db/schema";
import type { Claim, ClaimBoundary, ClaimMetric, Proof } from "../preference";

/** Prefijo que el estándar exige para un `claim_id` (`CLM-[A-Z0-9-]+`, ver `preference/profile.ts`). */
export const CLAIM_ID_PREFIX = "CLM-";

/** Prefijo que el estándar exige para un `proof_id` (`PRF-[A-Z0-9-]+`). */
export const PROOF_ID_PREFIX = "PRF-";

/** El DNA que manda Maasy ya declara claims propios: entonces BeAOS no sustituye nada. */
export function dnaCarriesClaims(dna: Record<string, unknown> | undefined): boolean {
	return Array.isArray(dna?.claims) && dna.claims.length > 0;
}

/**
 * Los claims y proofs que van al bundle, con la precedencia documentada arriba.
 *
 * Se devuelven juntos porque un claim sin su proof no es evidencia, y el generador los lee de la misma
 * fuente de verdad: `dna.claims` / `dna.proofs`.
 */
export function resolveBundleClaims(input: {
	dna?: Record<string, unknown> | undefined;
	saved?: AgentBrandClaim[] | undefined;
}): { claims: Claim[]; proofs: Proof[] } {
	const dna = input.dna;
	if (dnaCarriesClaims(dna) && dna !== undefined) {
		return {
			claims: dna.claims as Claim[],
			// Un DNA con claims y sin proofs deja claims sin evidencia, y eso el estándar lo reporta como
			// tal: no se rellena con las filas de BeAOS, porque mezclar dos fuentes inventa un vínculo.
			proofs: Array.isArray(dna.proofs) ? (dna.proofs as Proof[]) : [],
		};
	}
	return claimsFromRows(input.saved ?? []);
}

/**
 * Mapea las filas guardadas a `Claim` / `Proof` del generador.
 *
 * Los nombres de campo siguen el tipo exacto de `preference/types.ts`: `claim_id`, `statement`,
 * `boundary.applicable_for` / `boundary.not_applicable_for`, `linked_proofs`, y del lado del proof
 * `proof_id`, `type`, `title`, `claim_refs`, `evidence` y `verification.verifiable_by`.
 *
 * Los dos lados del vínculo se emiten sincronizados —`linked_proofs` y `claim_refs`— porque el validador
 * del estándar exige que se apunten mutuamente, y un vínculo de un solo lado es una prueba huérfana.
 */
export function claimsFromRows(rows: AgentBrandClaim[]): { claims: Claim[]; proofs: Proof[] } {
	const claims: Claim[] = [];
	const proofs: Proof[] = [];
	for (const row of rows) {
		if (row.status !== "confirmed") continue;
		const claimId = row.claimId.trim();
		const statement = row.statement.trim();
		// Sin id o sin afirmación no hay claim: una fila a medias no se emite a medias.
		if (claimId.length === 0 || statement.length === 0) continue;

		const proofId = proofIdForClaim(claimId);
		const proof = proofFromRow(row, claimId, proofId);
		claims.push(claimFromRow(row, claimId, statement, proofId, proof));
		proofs.push(proof);
	}
	return { claims, proofs };
}

function claimFromRow(row: AgentBrandClaim, claimId: string, statement: string, proofId: string, proof: Proof): Claim {
	const claim: Claim = {
		claim_id: claimId,
		statement,
		linked_proofs: [proofId],
		// El claim viaja con su prueba adentro además del `proofs[]` de arriba: quien lee un claim suelto
		// necesita ver con qué se sostiene sin tener que cruzar dos arreglos.
		proofs: [proof],
	};
	if (row.category !== null && row.category.trim().length > 0) claim.category = row.category.trim();

	const metric = metricFrom(row.metric);
	if (metric !== null) claim.metric = metric;

	const boundary = boundaryFrom(row);
	if (boundary !== null) claim.boundary = boundary;

	return claim;
}

/**
 * La métrica tal como está en la evidencia.
 *
 * El número se copia verbatim (`"35%"` queda `"35%"`): no se convierte a número, no se redondea y no se
 * completa. Tampoco se inventa un `n`, y por eso `confidence` no se emite.
 */
function metricFrom(metric: string | null): ClaimMetric | null {
	const value = metric?.trim() ?? "";
	if (value.length === 0) return null;
	return { value };
}

/** El borde del claim: solo lo que el operador declaró. Un lado vacío se omite, no se rellena. */
function boundaryFrom(row: AgentBrandClaim): ClaimBoundary | null {
	const applicable = row.boundaryApplicableFor?.trim() ?? "";
	const notApplicable = row.boundaryNotApplicableFor?.trim() ?? "";
	if (applicable.length === 0 && notApplicable.length === 0) return null;
	return {
		...(applicable.length === 0 ? {} : { applicable_for: applicable }),
		...(notApplicable.length === 0 ? {} : { not_applicable_for: notApplicable }),
	};
}

function proofFromRow(row: AgentBrandClaim, claimId: string, proofId: string): Proof {
	const evidence: Record<string, unknown> = {};
	const summary = row.proofSummary?.trim() ?? "";
	const client = row.proofClient?.trim() ?? "";
	const fragment = row.sourceFragment?.trim() ?? "";
	if (summary.length > 0) evidence.summary = summary;
	if (client.length > 0) evidence.client = client;
	// El fragmento original de Maasy viaja con la prueba: es lo que el operador confirmó, y sin él la
	// prueba es una afirmación sobre una afirmación.
	if (fragment.length > 0) evidence.source_fragment = fragment;

	const proof: Proof = {
		proof_id: proofId,
		type: row.proofType.trim(),
		title: row.proofTitle.trim(),
		claim_refs: [claimId],
		evidence,
	};
	const verifiableBy = row.verifiableBy?.trim() ?? "";
	if (verifiableBy.length > 0) proof.verification = { verifiable_by: verifiableBy };
	const confidentiality = row.confidentiality?.trim() ?? "";
	if (confidentiality.length > 0) proof.confidentiality = confidentiality;
	return proof;
}

/**
 * El `proof_id` derivado del `claim_id`.
 *
 * Es determinístico para que regenerar el bundle no cambie los ids y no invalide la firma por un detalle
 * cosmético. Se normaliza al alfabeto que el estándar acepta (`PRF-[A-Z0-9-]+`), y cuando el id del
 * operador no deja ni una letra usable se cae a un hash corto del original: igual de estable, y evita que
 * dos claims distintos terminen con el mismo proof_id.
 */
export function proofIdForClaim(claimId: string): string {
	const normalized = normalizeIdPart(claimId);
	if (normalized.length > 0) return `${PROOF_ID_PREFIX}${normalized}`;
	return `${PROOF_ID_PREFIX}CLAIM-${shortHash(claimId)}`;
}

/**
 * El `claim_id` sugerido para un candidato.
 *
 * Se sugiere con el prefijo que el estándar exige porque el `brand.json` que BeAOS firma se valida con
 * `parseBrandProfile`, que rechaza cualquier `claim_id` que no sea `CLM-[A-Z0-9-]+`. El campo es editable:
 * el id es del operador, no de BeAOS.
 */
export function claimIdFromCandidateId(candidateId: string): string {
	const normalized = normalizeIdPart(candidateId);
	return normalized.length > 0 ? `${CLAIM_ID_PREFIX}${normalized}` : `${CLAIM_ID_PREFIX}CLAIM`;
}

function normalizeIdPart(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.toUpperCase()
		.replace(/[^A-Z0-9-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^-+|-+$/g, "");
}

/** Hash corto y determinístico (FNV-1a de 32 bits): solo para desempatar ids sin letras usables. */
function shortHash(value: string): string {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193) >>> 0;
	}
	return hash.toString(16).toUpperCase().padStart(8, "0");
}
