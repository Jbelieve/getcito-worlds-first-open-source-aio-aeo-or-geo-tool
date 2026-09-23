/**
 * Turns Getcito's measured targets into the capture stage's query clients.
 *
 * The provider call is injected instead of imported, for two reasons: the stage stays testable, and
 * the worker keeps owning the provider registry and its usage tracking. Getcito already records one
 * `provider_calls` row per call, so an APS run shows up in the admin usage table like any other run.
 */

import type { QueryTarget } from "./capture";

/**
 * Structurally identical to Getcito's ModelConfig. Declared here so this package does not need a
 * dependency on @workspace/config just for a shape.
 */
export interface MeasurementTargetConfig {
	model: string;
	provider: string;
	version?: string;
	webSearch: boolean;
	/**
	 * How long this model may take, when it needs more than the run-wide ceiling. A scraper that
	 * polls an async snapshot needs minutes where a chat API needs seconds, and one shared ceiling
	 * can only fit one of them. Undefined keeps the run-wide default.
	 */
	timeoutMs?: number;
}

export type ProviderInvoker = (config: MeasurementTargetConfig, prompt: string) => Promise<string>;

/**
 * One query client per model. Two configs sharing a model would collide in the fan-out (a job only
 * carries the model name), so the first wins and the duplicates are reported instead of hiding.
 */
export function queryTargetsFrom(
	configs: MeasurementTargetConfig[],
	invoke: ProviderInvoker,
): { targets: QueryTarget[]; duplicateModels: string[] } {
	const targets: QueryTarget[] = [];
	const duplicateModels: string[] = [];
	const seen = new Set<string>();

	for (const config of configs) {
		if (seen.has(config.model)) {
			duplicateModels.push(config.model);
			continue;
		}
		seen.add(config.model);
		targets.push({
			target: config.model,
			query: (prompt: string) => invoke(config, prompt),
			// Only when set: undefined leaves captureRun's run-wide ceiling in charge.
			...(config.timeoutMs === undefined ? {} : { timeoutMs: config.timeoutMs }),
		});
	}

	return { targets, duplicateModels };
}

/** The model names a run can actually measure, in configuration order. */
export function measurableModels(configs: MeasurementTargetConfig[]): string[] {
	const seen = new Set<string>();
	const models: string[] = [];
	for (const config of configs) {
		if (seen.has(config.model)) continue;
		seen.add(config.model);
		models.push(config.model);
	}
	return models;
}

/**
 * Per-model call ceilings, read from `APS_CALL_TIMEOUTS` (`"perplexity=600000"`, milliseconds).
 *
 * Exists because one run-wide ceiling cannot fit both kinds of provider: a chat API answers in
 * seconds while BrightData's perplexity path polls an async snapshot for up to 520s. With a single
 * 90s ceiling the provider was still willing to work when the capture had already given up, so that
 * model could never succeed — not because it was broken, but because we stopped waiting.
 *
 * Malformed entries are ignored instead of failing the run, and a model with no entry keeps the
 * run-wide default. A ceiling below one second is treated as a typo, not as a decision.
 */
export function callTimeoutsFromEnv(env: Record<string, string | undefined> = process.env): Record<string, number> {
	const raw = env.APS_CALL_TIMEOUTS?.trim();
	if (raw === undefined || raw.length === 0) return {};

	const ceilings: Record<string, number> = {};
	for (const entry of raw.split(",")) {
		const [model, value] = entry.split("=").map((part) => part.trim());
		if (model === undefined || model.length === 0 || value === undefined || value.length === 0) continue;
		const ms = Number(value);
		if (!Number.isFinite(ms) || ms < 1000) continue;
		ceilings[model] = Math.floor(ms);
	}
	return ceilings;
}

/** The same configs with each model's ceiling applied, leaving the rest untouched. */
export function withCallTimeouts<T extends { model: string }>(configs: T[], ceilings: Record<string, number>): T[] {
	return configs.map((config) => {
		const timeoutMs = ceilings[config.model];
		return timeoutMs === undefined ? config : { ...config, timeoutMs };
	});
}
