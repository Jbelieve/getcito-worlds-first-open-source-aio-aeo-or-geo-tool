/**
 * APS Fase 1 — the judge.
 *
 * Reads a captured answer and extracts, through a structured judge, whether the brand appeared,
 * whether it was actually RECOMMENDED (not merely mentioned), its position, the open competitor
 * denominator, the sentiment and whether the answer cited something verifiable.
 *
 * The judge is an LLM, so its output is untrusted input: `normalizeVerdict` validates and clamps
 * every field before anything is persisted. A malformed verdict is dropped, never guessed at.
 */

export interface JudgeVerdict {
	appeared: boolean;
	recommended: boolean;
	position: number | null;
	sentiment0to100: number;
	grounded: boolean;
	competitorsMentioned: string[];
}

export interface JudgeInput {
	brandName: string;
	promptText: string;
	response: string;
}

export interface ApsJudge {
	/** Series identity: a change here means a new comparable series. */
	alias: string;
	version: string;
	pipelineVersion: string;
	/** Returns null when the judge could not produce a usable verdict. */
	analyze: (input: JudgeInput) => Promise<JudgeVerdict | null>;
}

/** Ported from Fase 1: the same question the Maasy judge answers. */
export function judgePrompt(brandName: string, promptText: string, response: string): string {
	return `Un usuario le preguntó a un asistente de IA (sin nombrar ninguna marca) lo siguiente:

"${promptText}"

El asistente respondió:

"${response}"

Analiza esta respuesta desde la perspectiva de la marca "${brandName}". Usa la tool record_analysis con tu análisis.`;
}

function asBoolean(value: unknown): boolean | null {
	return typeof value === "boolean" ? value : null;
}

function asCompetitors(value: unknown): string[] {
	if (Array.isArray(value) === false) return [];
	const seen = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== "string") continue;
		const name = entry.trim();
		if (name.length > 0) seen.add(name);
	}
	return [...seen];
}

/**
 * Validates a judge verdict. Returns null when the shape is unusable: a verdict that cannot be
 * trusted must not become an observation.
 */
export function normalizeVerdict(raw: unknown): JudgeVerdict | null {
	if (raw === null || typeof raw !== "object") return null;
	const record = raw as Record<string, unknown>;

	const appeared = asBoolean(record.appeared);
	const recommended = asBoolean(record.recommended);
	const grounded = asBoolean(record.grounded);
	if (appeared === null || recommended === null || grounded === null) return null;

	// Position only means something when the brand appeared. Anything below 1 is not a rank.
	const rawPosition = record.position;
	const position =
		appeared === false
			? null
			: typeof rawPosition === "number" && Number.isFinite(rawPosition) && rawPosition >= 1
				? Math.floor(rawPosition)
				: null;

	const rawSentiment = record.sentiment_0_100 ?? record.sentiment0to100;
	const sentiment =
		typeof rawSentiment === "number" && Number.isFinite(rawSentiment)
			? Math.max(0, Math.min(100, Math.round(rawSentiment)))
			: 50;

	return {
		appeared,
		recommended: appeared === false ? false : recommended,
		position,
		sentiment0to100: sentiment,
		grounded,
		competitorsMentioned: asCompetitors(record.competitors_mentioned ?? record.competitorsMentioned),
	};
}

export interface JudgedObservation {
	observationId: string;
	verdict: JudgeVerdict;
}

export interface JudgeRunReport {
	judged: JudgedObservation[];
	/** Observations whose verdict was unusable. They are not scored. */
	unjudged: Array<{ observationId: string; reason: string }>;
}

export interface PendingObservation {
	observationId: string;
	promptText: string;
	response: string;
}

/**
 * Analyses stored answers. Never re-queries a model: it only reads text that was already paid for.
 */
export async function judgeObservations(
	observations: PendingObservation[],
	brandName: string,
	judge: ApsJudge,
	options: { concurrency?: number } = {},
): Promise<JudgeRunReport> {
	const concurrency = Math.max(1, options.concurrency ?? 4);
	const judged: JudgedObservation[] = [];
	const unjudged: Array<{ observationId: string; reason: string }> = [];

	for (let start = 0; start < observations.length; start += concurrency) {
		const batch = observations.slice(start, start + concurrency);
		const results = await Promise.all(
			batch.map(async (observation) => {
				try {
					const verdict = await judge.analyze({
						brandName,
						promptText: observation.promptText,
						response: observation.response,
					});
					const normalized = normalizeVerdict(verdict);
					return normalized === null
						? {
								observationId: observation.observationId,
								verdict: null,
								reason: "El juez no devolvió un veredicto usable.",
							}
						: { observationId: observation.observationId, verdict: normalized, reason: null };
				} catch (error) {
					return {
						observationId: observation.observationId,
						verdict: null,
						reason: error instanceof Error ? error.message : String(error),
					};
				}
			}),
		);
		for (const result of results) {
			if (result.verdict === null) {
				unjudged.push({ observationId: result.observationId, reason: result.reason ?? "sin veredicto" });
			} else {
				judged.push({ observationId: result.observationId, verdict: result.verdict });
			}
		}
	}

	return { judged, unjudged };
}
