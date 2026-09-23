/**
 * APS Fase 0 — capture.
 *
 * Queries the real models (prompt x model x repetition) and keeps the raw text. It does not parse
 * anything: analysis is Fase 1 over the stored text, so the formula can be recomputed without paying
 * for the queries again.
 *
 * The model clients are injected, so the pipeline is testable with fakes and no run spends money by
 * accident. A provider failure becomes an empty answer, never a partial observation.
 */

import type { ApsQueryJob } from "./runPlan";
import { type CaptureOutcome, captureSummary } from "./runPlan";

export interface QueryTarget {
	/** Matches ApsQueryJob.model. */
	target: string;
	query: (prompt: string) => Promise<string | null>;
	/**
	 * Ceiling for THIS model, when it differs from the run-wide one.
	 *
	 * A chat API answers in seconds; a scraper that triggers an async snapshot and then polls it
	 * needs minutes. One run-wide ceiling can only be right for one of them, and when it is the
	 * fast one the slow model can never succeed: measured in production, every BrightData
	 * perplexity call was abandoned at 90s while the provider itself was still willing to poll for
	 * 520s, so a healthy snapshot had no way to win.
	 */
	timeoutMs?: number;
}

export interface CapturedAnswer {
	job: ApsQueryJob;
	response: string;
}

export interface CaptureFailure {
	job: ApsQueryJob;
	reason: string;
}

export interface CaptureReport {
	/** Only non-empty answers, ready to persist as observations. */
	answers: CapturedAnswer[];
	summary: CaptureOutcome;
	failures: CaptureFailure[];
}

export interface CaptureOptions {
	/** Parallel queries in flight. Kept low so a run does not hammer a provider. */
	concurrency?: number;
	/**
	 * Ceiling for a single query, used by every target that does not declare its own. Without it one
	 * hung provider call stalls the run: measured in production, a stuck BrightData call froze a run
	 * for fifteen minutes with three of the four models already answered.
	 */
	timeoutMs?: number;
}

const DEFAULT_CONCURRENCY = 4;
export const DEFAULT_CALL_TIMEOUT_MS = 90_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error(`${label}: sin respuesta en ${ms}ms`)), ms);
		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}

interface Slot {
	response: string;
	failure: CaptureFailure | null;
}

async function queryOne(
	job: ApsQueryJob,
	targets: Map<string, QueryTarget>,
	defaultTimeoutMs: number,
): Promise<Slot> {
	const target = targets.get(job.model);
	if (target === undefined) {
		return { response: "", failure: { job, reason: `No hay cliente configurado para "${job.model}".` } };
	}
	const timeoutMs = Math.max(1000, target.timeoutMs ?? defaultTimeoutMs);
	try {
		const response = await withTimeout(target.query(job.promptText), timeoutMs, job.model);
		return { response: typeof response === "string" ? response : "", failure: null };
	} catch (error) {
		return { response: "", failure: { job, reason: error instanceof Error ? error.message : String(error) } };
	}
}

/**
 * Runs every job and reports what came back. Order is preserved, so a job list can be zipped back
 * onto its answers.
 *
 * Jobs are pulled by `concurrency` workers from a shared cursor instead of sliced into fixed
 * batches. With batches, one slow model held up its whole batch — and because `fanOut` orders jobs
 * prompt → model → repetition, **every** batch contained one of each model, so a single stuck
 * provider throttled the entire run to its own timeout, batch after batch. With a pool the slow
 * call occupies one lane and the others keep going.
 */
export async function captureRun(
	jobs: ApsQueryJob[],
	targets: QueryTarget[],
	options: CaptureOptions = {},
): Promise<CaptureReport> {
	const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
	const defaultTimeoutMs = Math.max(1000, options.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS);
	const index = new Map(targets.map((target) => [target.target, target]));
	const slots: Array<Slot | undefined> = new Array(jobs.length).fill(undefined);

	/**
	 * Claim order is grouped by model, not by arrival position.
	 *
	 * `fanOut` emits jobs ordered prompt → model → repetition, so every group of `concurrency` jobs
	 * contains one of each model. Claiming them in that order pins a slow model to the SAME lane for
	 * the whole run — worse than the fixed batches it replaced. Grouping by model spends the fast
	 * models first and then throws every lane at the slow one, which is the only order that lets a
	 * run with one degraded provider finish.
	 */
	const claimOrder = jobs
		.map((job, position) => ({ job, position }))
		.sort((a, b) => (a.job.model === b.job.model ? a.position - b.position : a.job.model < b.job.model ? -1 : 1));
	let cursor = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			// Claimed synchronously, before any await: two lanes must never take the same entry.
			const claimed = claimOrder[cursor];
			cursor += 1;
			if (claimed === undefined) return;
			slots[claimed.position] = await queryOne(claimed.job, index, defaultTimeoutMs);
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));

	const responses: string[] = new Array(jobs.length).fill("");
	const failures: CaptureFailure[] = [];
	for (const [position, slot] of slots.entries()) {
		if (slot === undefined) continue;
		responses[position] = slot.response;
		if (slot.failure !== null) failures.push(slot.failure);
	}

	const answers: CapturedAnswer[] = [];
	for (const [position, job] of jobs.entries()) {
		const response = responses[position] ?? "";
		if (response.length > 0) answers.push({ job, response });
	}

	return { answers, summary: captureSummary(responses), failures };
}
