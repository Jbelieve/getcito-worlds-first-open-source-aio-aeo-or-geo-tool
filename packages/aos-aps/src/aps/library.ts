/**
 * APS Fase 4 — the unaided prompt library.
 *
 * Ported from MAASY's `aps-prompt-library-generate`. The library is the measuring instrument: it is
 * generated once, locked for 90 days and then re-measured, because a time series is only comparable
 * while the prompt does not change (Fase 3 measures variance over the SAME prompt).
 *
 * Hard rule: a prompt that names the brand contaminates the signal. It is validated and discarded
 * before it is ever persisted.
 */

import { normalizeForMatch } from "../preference/profile";

export const LIBRARY_LOCK_DAYS = 90;
export const LIBRARY_TARGET_TOTAL = 50;
export const LIBRARY_TARGET_RANGE = { min: 40, max: 60 } as const;
/** Mix of the design blueprint: half comparison, a third use case, the rest category. */
export const LIBRARY_MIX = { comparison: 0.5, use_case: 0.3, category: 0.2 } as const;

export type PromptKind = keyof typeof LIBRARY_MIX;
export type FunnelStage = "awareness" | "consideration" | "decision";

export const PROMPT_KINDS: PromptKind[] = ["comparison", "use_case", "category"];
export const FUNNEL_STAGES: FunnelStage[] = ["awareness", "consideration", "decision"];

export interface LibraryPromptInput {
	text: string;
	kind: PromptKind;
	funnelStage: FunnelStage;
}

export type RejectionReason = "empty" | "names_brand" | "duplicate" | "unknown_kind" | "unknown_funnel_stage";

export interface RejectedPrompt {
	text: string;
	reason: RejectionReason;
}

export interface LibraryValidation {
	accepted: LibraryPromptInput[];
	rejected: RejectedPrompt[];
	/** Accepted prompts per kind. */
	counts: Record<PromptKind, number>;
	/** Observed share per kind, over accepted prompts. */
	mix: Record<PromptKind, number>;
	/** Whether the accepted mix is within tolerance of LIBRARY_MIX. */
	mixWithinTolerance: boolean;
	/** Whether the accepted total sits inside LIBRARY_TARGET_RANGE. */
	sizeWithinRange: boolean;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the prompt does not name the brand. Matching is accent- and case-insensitive and
 * word-bounded, so a brand called "ON" does not reject every prompt containing "con".
 */
export function isUnaided(text: string, brandTerms: string[]): boolean {
	const haystack = normalizeForMatch(text);
	for (const term of brandTerms) {
		const needle = normalizeForMatch(term).trim();
		if (needle.length < 2) continue;
		if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(haystack)) return false;
	}
	return true;
}

/** Validates a generated library before it is persisted. Nothing is silently dropped silently. */
export function validateLibrary(
	prompts: LibraryPromptInput[],
	brandTerms: string[],
	tolerance = 0.1,
): LibraryValidation {
	const accepted: LibraryPromptInput[] = [];
	const rejected: RejectedPrompt[] = [];
	const seen = new Set<string>();

	for (const prompt of prompts) {
		const text = typeof prompt.text === "string" ? prompt.text.trim() : "";
		if (text.length === 0) {
			rejected.push({ text, reason: "empty" });
			continue;
		}
		if (PROMPT_KINDS.includes(prompt.kind) === false) {
			rejected.push({ text, reason: "unknown_kind" });
			continue;
		}
		if (FUNNEL_STAGES.includes(prompt.funnelStage) === false) {
			rejected.push({ text, reason: "unknown_funnel_stage" });
			continue;
		}
		if (isUnaided(text, brandTerms) === false) {
			rejected.push({ text, reason: "names_brand" });
			continue;
		}
		const key = normalizeForMatch(text);
		if (seen.has(key)) {
			rejected.push({ text, reason: "duplicate" });
			continue;
		}
		seen.add(key);
		accepted.push({ text, kind: prompt.kind, funnelStage: prompt.funnelStage });
	}

	const counts: Record<PromptKind, number> = { comparison: 0, use_case: 0, category: 0 };
	for (const prompt of accepted) counts[prompt.kind] += 1;
	const total = accepted.length;
	const mix: Record<PromptKind, number> = {
		comparison: total === 0 ? 0 : counts.comparison / total,
		use_case: total === 0 ? 0 : counts.use_case / total,
		category: total === 0 ? 0 : counts.category / total,
	};
	const mixWithinTolerance = PROMPT_KINDS.every((kind) => Math.abs(mix[kind] - LIBRARY_MIX[kind]) <= tolerance);

	return {
		accepted,
		rejected,
		counts,
		mix,
		mixWithinTolerance,
		sizeWithinRange: total >= LIBRARY_TARGET_RANGE.min && total <= LIBRARY_TARGET_RANGE.max,
	};
}

export interface LibraryLock {
	lockedAt: string;
	unlocksAt: string;
	lockDays: number;
}

/** A library is locked from creation for LIBRARY_LOCK_DAYS: the instrument must not move. */
export function libraryLockWindow(createdAt: Date, lockDays = LIBRARY_LOCK_DAYS): LibraryLock {
	const unlocks = new Date(createdAt.getTime());
	unlocks.setUTCDate(unlocks.getUTCDate() + lockDays);
	return { lockedAt: createdAt.toISOString(), unlocksAt: unlocks.toISOString(), lockDays };
}

export function isLibraryLocked(lock: { unlocksAt: string }, now = new Date()): boolean {
	return now.getTime() < new Date(lock.unlocksAt).getTime();
}

export interface RegenerationVerdict {
	allowed: boolean;
	unlocksAt: string;
	reason: string;
}

/**
 * Regeneration is refused while the lock holds, unless the caller explicitly supersedes the
 * library (a new version, which starts a new comparable series).
 */
export function canRegenerateLibrary(
	lock: { unlocksAt: string },
	now = new Date(),
	supersede = false,
): RegenerationVerdict {
	if (supersede) {
		return {
			allowed: true,
			unlocksAt: lock.unlocksAt,
			reason: "Se reemplaza la biblioteca explicitamente: empieza una serie nueva.",
		};
	}
	if (isLibraryLocked(lock, now)) {
		return {
			allowed: false,
			unlocksAt: lock.unlocksAt,
			reason: `La biblioteca esta bloqueada hasta ${lock.unlocksAt}; cambiar el prompt rompe la comparabilidad.`,
		};
	}
	return { allowed: true, unlocksAt: lock.unlocksAt, reason: "El bloqueo de 90 dias venció." };
}
