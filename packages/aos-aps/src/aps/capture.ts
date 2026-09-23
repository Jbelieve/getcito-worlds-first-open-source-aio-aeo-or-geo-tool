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
}

const DEFAULT_CONCURRENCY = 4;

async function queryOne(
	job: ApsQueryJob,
	targets: Map<string, QueryTarget>,
	failures: CaptureFailure[],
): Promise<string> {
	const target = targets.get(job.model);
	if (target === undefined) {
		failures.push({ job, reason: `No hay cliente configurado para "${job.model}".` });
		return "";
	}
	try {
		const response = await target.query(job.promptText);
		return typeof response === "string" ? response : "";
	} catch (error) {
		failures.push({ job, reason: error instanceof Error ? error.message : String(error) });
		return "";
	}
}

/**
 * Runs every job and reports what came back. Order is preserved, so a job list can be zipped back
 * onto its answers.
 */
export async function captureRun(
	jobs: ApsQueryJob[],
	targets: QueryTarget[],
	options: CaptureOptions = {},
): Promise<CaptureReport> {
	const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
	const index = new Map(targets.map((target) => [target.target, target]));
	const failures: CaptureFailure[] = [];
	const responses: string[] = new Array(jobs.length).fill("");

	for (let start = 0; start < jobs.length; start += concurrency) {
		const batch = jobs.slice(start, start + concurrency);
		const batchResponses = await Promise.all(batch.map((job) => queryOne(job, index, failures)));
		for (const [offset, response] of batchResponses.entries()) {
			responses[start + offset] = response;
		}
	}

	const answers: CapturedAnswer[] = [];
	for (const [position, job] of jobs.entries()) {
		const response = responses[position] ?? "";
		if (response.length > 0) answers.push({ job, response });
	}

	return { answers, summary: captureSummary(responses), failures };
}
