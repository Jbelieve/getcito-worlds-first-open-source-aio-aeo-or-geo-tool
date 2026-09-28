/**
 * El alta de una prueba: las reglas del estándar, escritas una sola vez.
 *
 * Existe porque BeAOS tiene **tres puertas** para guardar una prueba —la pantalla de Pruebas, el MCP y lo
 * que venga— y las tres tienen que decidir lo mismo. Antes la validación vivía en el validador `zod` de
 * `saveClaimFn`, así que el MCP habría necesitado su propia copia: dos listas de enums que se separan al
 * primer cambio. Acá no hay base ni red: es una función pura sobre el formulario, y por eso se prueba sin
 * levantar nada.
 *
 * Las reglas no se inventan: salen de `parseBrandProfile` (`../preference/profile.ts`), que es quien
 * valida el `brand.json` que BeAOS firma. Se distinguen dos niveles, como en el validador:
 *
 *   - **Error**: lo que el estándar rechaza con `level: "error"` y no se puede firmar (el patrón del
 *     `claim_id`, un `verifiable_by` fuera del enum, la afirmación vacía).
 *   - **Aviso**: lo que el estándar marca pero no frena (una prueba sin `verifiable_by` queda declarada
 *     como no verificable; un `boundary` incompleto es un error de perfil que el operador todavía puede
 *     completar). El aviso viaja en la respuesta para que quien escribe sepa qué va a decir el perfil,
 *     en vez de descubrirlo después de publicar.
 */

import {
	CLAIM_CATEGORIES,
	CLAIM_ID_PATTERN,
	type ClaimCategory,
	CONFIDENTIALITY,
	type Confidentiality,
	PROOF_TYPES,
	type ProofType,
	VERIFIABLE_BY,
	type VerifiableBy,
} from "../preference";

/** Los dos estados de una prueba. Solo `confirmed` entra al bundle; un borrador es trabajo en curso. */
export type ClaimStatus = "draft" | "confirmed";

export const CLAIM_STATUSES: ClaimStatus[] = ["draft", "confirmed"];

/**
 * Los tipos de prueba que BeAOS ya guarda y muestra en la pantalla de Pruebas.
 *
 * Son un vocabulario propio, más legible para el operador, y **no** coinciden con el enum del estándar:
 * `document`, `audit` y `other` no están en `PROOF_TYPES`. Se conservan porque hay filas guardadas con
 * esos valores y porque el operador los eligió: cambiarlos en silencio sería reescribir su declaración.
 */
export const BEAOS_PROOF_TYPES = ["case_study", "document", "testimonial", "audit", "other"] as const;

export type BeAosProofType = (typeof BEAOS_PROOF_TYPES)[number];

/**
 * Lo que el alta acepta como `proofType`: el vocabulario de BeAOS más el del estándar, sin repetidos.
 *
 * La unión es la decisión, y es explícita: un tipo del estándar (`aggregate_metric`, `third_party_review`,
 * `publication`, `credential`) se puede guardar y no genera ningún aviso; uno propio de BeAOS se guarda
 * pero el perfil lo va a firmar con un aviso `APS-CLAIM-01`. Rechazar el enum del estándar sería absurdo
 * —es el que valida el perfil— y rechazar el propio rompería las filas que ya existen.
 */
export const CLAIM_PROOF_TYPES: readonly (BeAosProofType | ProofType)[] = [
	...BEAOS_PROOF_TYPES,
	...PROOF_TYPES.filter((type) => (BEAOS_PROOF_TYPES as readonly string[]).includes(type) === false),
];

export type ClaimProofType = BeAosProofType | ProofType;

/** Un dato del formulario que no cumple el estándar. El mensaje lo lee un operador **y** un modelo. */
export class ClaimInputError extends Error {}

/** Los topes de largo del formulario. Son de BeAOS, no del estándar: evitan un campo que no se puede mostrar. */
const MAX_ID = 120;
const MAX_STATEMENT = 4000;
const MAX_TITLE = 400;
const MAX_NOTE = 4000;

/** Lo que llega para guardar. Todo lo opcional puede venir vacío: vacío y ausente son lo mismo —nada declarado—. */
export interface ClaimInput {
	/** El id estable que viaja al `brand.json`. Debe cumplir `CLM-[A-Z0-9-]+`. */
	claimId?: unknown;
	/** La afirmación, redactada por el humano. */
	statement?: unknown;
	status?: unknown;
	proofType?: unknown;
	proofTitle?: unknown;
	metric?: unknown;
	category?: unknown;
	boundaryApplicableFor?: unknown;
	boundaryNotApplicableFor?: unknown;
	confidence?: unknown;
	proofSummary?: unknown;
	proofClient?: unknown;
	verifiableBy?: unknown;
	confidentiality?: unknown;
	sourceFragment?: unknown;
}

/** Lo que se escribe en la fila: texto ya recortado, `null` donde no hay nada declarado. */
export interface NormalizedClaim {
	claimId: string;
	statement: string;
	status: ClaimStatus;
	proofType: ClaimProofType;
	proofTitle: string;
	metric: string | null;
	category: ClaimCategory | null;
	boundaryApplicableFor: string | null;
	boundaryNotApplicableFor: string | null;
	confidence: string | null;
	proofSummary: string | null;
	proofClient: string | null;
	verifiableBy: VerifiableBy | null;
	confidentiality: Confidentiality | null;
	sourceFragment: string | null;
}

export interface ClaimNormalization {
	claim: NormalizedClaim;
	/** Lo que el estándar va a decir del perfil sin frenar el guardado. */
	warnings: string[];
}

function cleanText(value: unknown, field: string, max: number): string | null {
	if (value === undefined || value === null) return null;
	if (typeof value !== "string") throw new ClaimInputError(`"${field}" tiene que ser un texto.`);
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > max) {
		throw new ClaimInputError(`"${field}" no puede pasar de ${max} caracteres (llegaron ${trimmed.length}).`);
	}
	return trimmed;
}

function requireText(value: unknown, field: string, max: number): string {
	const text = cleanText(value, field, max);
	if (text === null) throw new ClaimInputError(`"${field}" es obligatorio y no puede quedar vacío.`);
	return text;
}

/** Un valor de un conjunto cerrado. El mensaje lista lo aceptado, que es lo único accionable. */
function requireMember<T extends string>(value: unknown, field: string, values: readonly T[]): T {
	const text = requireText(value, field, MAX_ID);
	if ((values as readonly string[]).includes(text) === false) {
		throw new ClaimInputError(`"${field}" tiene que ser uno de: ${values.join(", ")}. Recibido: "${text}".`);
	}
	return text as T;
}

/** Un valor de un conjunto cerrado que puede no venir. Ausente es `null` —nada declarado—, no un error. */
function optionalMember<T extends string>(value: unknown, field: string, values: readonly T[]): T | null {
	const text = cleanText(value, field, MAX_ID);
	if (text === null) return null;
	if ((values as readonly string[]).includes(text) === false) {
		throw new ClaimInputError(`"${field}" tiene que ser uno de: ${values.join(", ")}. Recibido: "${text}".`);
	}
	return text as T;
}

/**
 * El id de la prueba: obligatorio **y** con el formato del estándar.
 *
 * Los dos motivos van en el mismo mensaje a propósito: un id vacío y un id mal escrito son el mismo
 * problema para quien lo lee —le falta el `CLM-`—, y el formato es lo único accionable.
 */
function requireClaimId(value: unknown): string {
	const raw = typeof value === "string" ? value.trim() : "";
	if (CLAIM_ID_PATTERN.test(raw) === false) {
		throw new ClaimInputError(
			`"claimId" es obligatorio y tiene que cumplir el formato CLM-[A-Z0-9-]+ (por ejemplo CLM-MARCA-100-PROYECTOS). Recibido: "${raw}".`,
		);
	}
	if (raw.length > MAX_ID) throw new ClaimInputError(`"claimId" no puede pasar de ${MAX_ID} caracteres.`);
	return raw;
}

/**
 * Valida y normaliza el formulario de una prueba.
 *
 * Es la única puerta: la pantalla, el MCP y lo que venga pasan por acá, así que la decisión de qué se
 * guarda no se puede separar entre las tres. Lanza `ClaimInputError` con el motivo en castellano; no
 * toca la base.
 */
export function normalizeClaimInput(input: ClaimInput): ClaimNormalization {
	const warnings: string[] = [];

	const claimId = requireClaimId(input.claimId);
	const status = requireMember(input.status, "status", CLAIM_STATUSES);

	const proofType = requireMember(input.proofType, "proofType", CLAIM_PROOF_TYPES);
	if ((PROOF_TYPES as readonly string[]).includes(proofType) === false) {
		// No frena: se guarda como el operador lo declaró, y el perfil lo va a marcar. Avisar acá es la
		// diferencia entre saberlo ahora y descubrirlo en la auditoría del sitio.
		warnings.push(
			`El proofType "${proofType}" no está en el enum del estándar (${PROOF_TYPES.join(", ")}): el perfil lo va a firmar con un aviso APS-CLAIM-01.`,
		);
	}

	const verifiableBy = optionalMember(input.verifiableBy, "verifiableBy", VERIFIABLE_BY);
	if (verifiableBy === null) {
		warnings.push("La prueba quedó sin `verifiableBy`: el estándar la marca como no verificable (APS-CLAIM-03).");
	}

	const boundaryApplicableFor = cleanText(input.boundaryApplicableFor, "boundaryApplicableFor", MAX_NOTE);
	const boundaryNotApplicableFor = cleanText(input.boundaryNotApplicableFor, "boundaryNotApplicableFor", MAX_NOTE);
	const missingBoundary = [
		...(boundaryApplicableFor === null ? ["boundaryApplicableFor"] : []),
		...(boundaryNotApplicableFor === null ? ["boundaryNotApplicableFor"] : []),
	];
	if (missingBoundary.length > 0) {
		warnings.push(
			`Falta ${missingBoundary.join(" y ")}: el estándar exige declarar el límite de la prueba (APS-CLAIM-02).`,
		);
	}

	return {
		claim: {
			claimId,
			statement: requireText(input.statement, "statement", MAX_STATEMENT),
			status,
			proofType,
			proofTitle: requireText(input.proofTitle, "proofTitle", MAX_TITLE),
			metric: cleanText(input.metric, "metric", MAX_NOTE),
			category: optionalMember(input.category, "category", CLAIM_CATEGORIES),
			boundaryApplicableFor,
			boundaryNotApplicableFor,
			confidence: cleanText(input.confidence, "confidence", MAX_NOTE),
			proofSummary: cleanText(input.proofSummary, "proofSummary", MAX_NOTE),
			proofClient: cleanText(input.proofClient, "proofClient", MAX_NOTE),
			verifiableBy,
			confidentiality: optionalMember(input.confidentiality, "confidentiality", CONFIDENTIALITY),
			sourceFragment: cleanText(input.sourceFragment, "sourceFragment", MAX_NOTE),
		},
		warnings,
	};
}
