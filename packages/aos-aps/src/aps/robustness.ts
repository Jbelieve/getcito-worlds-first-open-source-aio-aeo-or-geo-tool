/**
 * APS Fase 6 — robustness audit.
 *
 * Ported from MAASY's `aps-robustness-audit`. The Fase 1 judge reports `grounded` on its own word,
 * and 50-90% of LLM answers are not actually backed by the sources they cite. So grounding is
 * checked independently here, with a regex over the raw text rather than another model trusting
 * itself, and prompt-injection / strategic text sequences are flagged separately.
 */

export interface RobustnessRow {
	id: string;
	fullResponse: string | null;
	/** What the Fase 1 judge claimed. */
	judgeSaidGrounded: boolean | null;
}

/** A real citable source: a URL, a named domain, or an explicit attribution phrase. */
export const VERIFIABLE_SOURCE_PATTERN =
	/https?:\/\/|www\.[a-z0-9-]+\.[a-z]{2,}|\b[a-z0-9-]+\.(com|io|co|org|net)\b|según\s+[\w.]+|fuente:\s*[\w.]+/i;

/** Prompt injection / Strategic Text Sequences embedded in what should be a genuine answer. */
export const INJECTION_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
	{ pattern: /ignor[ae]\s+(todas\s+)?(las\s+)?instruccion/i, reason: "intento de ignorar instrucciones previas" },
	{ pattern: /ignore\s+(all\s+)?(previous|prior)\s+instructions/i, reason: "prompt injection en inglés" },
	{
		pattern: /system\s*prompt|you\s+are\s+now|disregard\s+the\s+above/i,
		reason: "intento de redefinir el rol del modelo",
	},
	{
		pattern: /calific[a|á]\s+esta\s+marca\s+con\s+(el\s+)?(m[aá]ximo|100|puntaje\s+perfecto)/i,
		reason: "intento de forzar un score perfecto",
	},
];

export function hasVerifiableSource(text: string | null): boolean {
	return typeof text === "string" && VERIFIABLE_SOURCE_PATTERN.test(text);
}

export function detectInjections(text: string | null): string[] {
	if (typeof text !== "string") return [];
	return INJECTION_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.reason);
}

export type RobustnessKind = "unsupported_grounding" | "injection";

export interface RobustnessFinding {
	observationId: string;
	kind: RobustnessKind;
	detail: string;
}

export interface RobustnessAudit {
	findings: RobustnessFinding[];
	/** Answers the judge called grounded with no citable source in the text. */
	unsupportedGrounded: number;
	/** Answers carrying injection patterns. */
	injections: number;
	/** Share of judge-grounded answers that had no source. */
	unsupportedRate: number;
	/** Observations that a score should not count, because the answer tried to steer it. */
	quarantinedIds: string[];
}

/**
 * Independent verification of the judge's grounding claim, plus injection flagging.
 *
 * `quarantinedIds` is a BeAOS addition: the ported function only flagged injections, but scoring a
 * manipulated answer lets an attacker move the number, so callers are given the ids to exclude.
 */
export function auditRobustness(rows: RobustnessRow[]): RobustnessAudit {
	const findings: RobustnessFinding[] = [];
	const quarantinedIds: string[] = [];
	let judgeGrounded = 0;
	let unsupportedGrounded = 0;
	let injections = 0;

	for (const row of rows) {
		const citation = hasVerifiableSource(row.fullResponse);
		if (row.judgeSaidGrounded === true) {
			judgeGrounded += 1;
			if (citation === false) {
				unsupportedGrounded += 1;
				findings.push({
					observationId: row.id,
					kind: "unsupported_grounding",
					detail: "El juez marcó grounded pero el texto no deja ninguna fuente citable.",
				});
			}
		}
		const reasons = detectInjections(row.fullResponse);
		if (reasons.length > 0) {
			injections += 1;
			quarantinedIds.push(row.id);
			findings.push({ observationId: row.id, kind: "injection", detail: reasons.join("; ") });
		}
	}

	return {
		findings,
		unsupportedGrounded,
		injections,
		unsupportedRate: judgeGrounded === 0 ? 0 : unsupportedGrounded / judgeGrounded,
		quarantinedIds,
	};
}

/**
 * The grounding value a score should use: the judge's claim only survives if the text backs it.
 * This is the correction the audit exists to make; without it `grounded` is self-reported.
 */
export function correctedGrounded(row: RobustnessRow): boolean {
	return row.judgeSaidGrounded === true && hasVerifiableSource(row.fullResponse);
}
