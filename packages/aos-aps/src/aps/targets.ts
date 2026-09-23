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
		targets.push({ target: config.model, query: (prompt: string) => invoke(config, prompt) });
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
