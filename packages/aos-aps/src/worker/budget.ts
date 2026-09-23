/**
 * APS run budget: estimate before spending, and refuse rather than degrade.
 *
 * Two rules from the standard and the integration blueprint:
 *   1. Never downgrade the measurement layer to a cheaper LLM. Repetitions may be reduced; the
 *      models that answer the prompts may not be substituted.
 *   2. No partial score is ever presented as a complete run.
 *
 * A missing price is never guessed: the estimate reports which models need a price instead of
 * inventing a number, and the run does not start until they are configured.
 *
 * The measurement layer is a deliberate, bounded event, not a sweep: it is triggered on demand,
 * so the guards here are per run and per month, never per day.
 */

export interface ApsBudgetConfig {
	maxPrompts: number;
	maxModels: number;
	maxRepetitions: number;
	maxCallsPerRun: number;
	/** Hard ceiling for a single run. Null means no monetary ceiling configured. */
	runBudgetUsd: number | null;
	/** Hard ceiling for the calendar month. Null means no monetary ceiling configured. */
	monthBudgetUsd: number | null;
	policy: "stop" | "reduce_repetitions";
}

export const APS_BUDGET_DEFAULTS: ApsBudgetConfig = {
	maxPrompts: 50,
	maxModels: 3,
	maxRepetitions: 3,
	maxCallsPerRun: 450,
	runBudgetUsd: null,
	monthBudgetUsd: null,
	policy: "stop",
};

function positiveInt(value: string | undefined, fallback: number): number {
	if (value === undefined || value.trim().length === 0) return fallback;
	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function optionalUsd(value: string | undefined): number | null {
	if (value === undefined || value.trim().length === 0) return null;
	const parsed = Number.parseFloat(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function apsBudgetConfigFromEnv(env: Record<string, string | undefined> = process.env): ApsBudgetConfig {
	return {
		maxPrompts: positiveInt(env.APS_MAX_PROMPTS, APS_BUDGET_DEFAULTS.maxPrompts),
		maxModels: positiveInt(env.APS_MAX_MODELS, APS_BUDGET_DEFAULTS.maxModels),
		maxRepetitions: positiveInt(env.APS_MAX_REPETITIONS, APS_BUDGET_DEFAULTS.maxRepetitions),
		maxCallsPerRun: positiveInt(env.APS_MAX_CALLS_PER_RUN, APS_BUDGET_DEFAULTS.maxCallsPerRun),
		runBudgetUsd: optionalUsd(env.APS_RUN_BUDGET_USD),
		monthBudgetUsd: optionalUsd(env.APS_MONTH_BUDGET_USD),
		policy: env.APS_BUDGET_POLICY === "reduce_repetitions" ? "reduce_repetitions" : "stop",
	};
}

/** Price of one call, in USD, for a measurement target or for the internal judge model. */
export interface ProviderPrice {
	target: string;
	usdPerCall: number;
}

/**
 * Prices in `APS_PRICES`, as `target=usd` pairs: "chatgpt=0.02,believe-deep=0.0005".
 *
 * They come from configuration rather than a guess, and a target left out stays out, so the
 * estimator reports it as unpriced and the run blocks. That is the intended behaviour until a real
 * run has been measured and priced.
 */
export function apsPricesFromEnv(env: Record<string, string | undefined> = process.env): ProviderPrice[] {
	const raw = env.APS_PRICES?.trim();
	if (raw === undefined || raw.length === 0) return [];
	const prices: ProviderPrice[] = [];
	for (const entry of raw.split(",")) {
		const [target, value] = entry.split("=");
		const name = target?.trim() ?? "";
		const usd = Number.parseFloat(value?.trim() ?? "");
		if (name.length === 0 || Number.isFinite(usd) === false || usd < 0) continue;
		prices.push({ target: name, usdPerCall: usd });
	}
	return prices;
}

export interface ApsRunRequest {
	/** Size of the locked prompt library. */
	prompts: number;
	/** Measurement targets, e.g. "chatgpt:openai-api:gpt-5.5:online". */
	models: string[];
	repetitions: number;
	/** Internal judge that parses each answer, e.g. "believe-deep". */
	judgeModel?: string;
}

export interface ApsRunEstimate {
	prompts: number;
	models: number;
	repetitions: number;
	/** Measurement calls: prompts x models x repetitions. This is the expensive layer. */
	calls: number;
	/** Judge calls, one per answer parsed. */
	judgeCalls: number;
	measurementUsd: number | null;
	judgeUsd: number | null;
	totalUsd: number | null;
	/** Targets with no configured price. When non-empty, no USD total is reported. */
	missingPrices: string[];
}

function round2(value: number): number {
	return Math.round(value * 100) / 100;
}

export function estimateApsRun(request: ApsRunRequest, prices: ProviderPrice[]): ApsRunEstimate {
	const index = new Map(prices.map((entry) => [entry.target, entry.usdPerCall]));
	const models = request.models.length;
	const calls = request.prompts * models * request.repetitions;
	const missing = new Set<string>();

	let measurementUsd: number | null = 0;
	for (const model of request.models) {
		const price = index.get(model);
		if (price === undefined) {
			missing.add(model);
			measurementUsd = null;
			continue;
		}
		if (measurementUsd !== null) measurementUsd += price * request.prompts * request.repetitions;
	}

	const hasJudge = request.judgeModel !== undefined && request.judgeModel.length > 0;
	let judgeUsd: number | null = null;
	if (hasJudge) {
		const judgePrice = index.get(request.judgeModel ?? "");
		if (judgePrice === undefined) {
			missing.add(request.judgeModel ?? "");
		} else {
			judgeUsd = judgePrice * calls;
		}
	}

	const totalUsd =
		measurementUsd === null || (hasJudge && judgeUsd === null) ? null : round2(measurementUsd + (judgeUsd ?? 0));

	return {
		prompts: request.prompts,
		models,
		repetitions: request.repetitions,
		calls,
		judgeCalls: calls,
		measurementUsd: measurementUsd === null ? null : round2(measurementUsd),
		judgeUsd: judgeUsd === null ? null : round2(judgeUsd),
		totalUsd,
		missingPrices: [...missing],
	};
}

export type ApsBudgetDecisionKind = "allow" | "stop" | "reduce_repetitions";

export interface ApsBudgetDecision {
	decision: ApsBudgetDecisionKind;
	/** Repetitions the run may actually use. 0 when stopped; below the request only under reduce_repetitions. */
	effectiveRepetitions: number;
	estimate: ApsRunEstimate;
	/** Empty when allowed; every blocking condition otherwise. */
	reasons: string[];
}

function fits(
	request: ApsRunRequest,
	prices: ProviderPrice[],
	config: ApsBudgetConfig,
	spentThisMonthUsd: number | null,
) {
	const estimate = estimateApsRun(request, prices);
	const withinCalls = estimate.calls <= config.maxCallsPerRun;
	const withinRun =
		config.runBudgetUsd === null || (estimate.totalUsd ?? Number.POSITIVE_INFINITY) <= config.runBudgetUsd;
	const withinMonth =
		config.monthBudgetUsd === null ||
		spentThisMonthUsd === null ||
		(estimate.totalUsd ?? Number.POSITIVE_INFINITY) <= config.monthBudgetUsd - spentThisMonthUsd;
	return { estimate, fits: withinCalls && withinRun && withinMonth, withinCalls, withinRun, withinMonth };
}

/**
 * Decides whether a run may start. Fails closed: an unpriced model, an oversized library, a
 * breached ceiling or an unknown month spend all stop the run instead of producing a partial score.
 */
export function decideApsBudget(
	request: ApsRunRequest,
	prices: ProviderPrice[],
	config: ApsBudgetConfig,
	spentThisMonthUsd: number | null = null,
): ApsBudgetDecision {
	const estimate = estimateApsRun(request, prices);

	if (request.prompts <= 0 || request.models.length === 0 || request.repetitions <= 0) {
		return {
			decision: "stop",
			effectiveRepetitions: 0,
			estimate,
			reasons: ["La corrida no tiene prompts, modelos o repeticiones."],
		};
	}

	const structural: string[] = [];
	if (request.prompts > config.maxPrompts) {
		structural.push(`La biblioteca tiene ${request.prompts} prompts y el máximo es ${config.maxPrompts}.`);
	}
	if (request.models.length > config.maxModels) {
		structural.push(`La corrida usa ${request.models.length} modelos y el máximo es ${config.maxModels}.`);
	}
	if (request.repetitions > config.maxRepetitions) {
		structural.push(`La corrida usa ${request.repetitions} repeticiones y el máximo es ${config.maxRepetitions}.`);
	}
	if (estimate.missingPrices.length > 0) {
		structural.push(`Faltan precios para: ${estimate.missingPrices.join(", ")}.`);
	}
	if (structural.length > 0) {
		return { decision: "stop", effectiveRepetitions: 0, estimate, reasons: structural };
	}

	const full = fits(request, prices, config, spentThisMonthUsd);
	if (full.fits) {
		return { decision: "allow", effectiveRepetitions: request.repetitions, estimate, reasons: [] };
	}

	const pressure: string[] = [];
	if (full.withinCalls === false) {
		pressure.push(`La corrida son ${estimate.calls} llamadas y el máximo es ${config.maxCallsPerRun}.`);
	}
	if (full.withinRun === false) {
		pressure.push(`La corrida cuesta USD ${estimate.totalUsd} y el techo por corrida es USD ${config.runBudgetUsd}.`);
	}
	if (full.withinMonth === false) {
		pressure.push(
			`Acumulado del mes USD ${round2((spentThisMonthUsd ?? 0) + (estimate.totalUsd ?? 0))} sobre el techo de USD ${config.monthBudgetUsd}.`,
		);
	}

	// Reducing repetitions is the only allowed adaptation: the measurement models never change.
	if (config.policy === "reduce_repetitions") {
		for (let repetitions = request.repetitions - 1; repetitions >= 1; repetitions -= 1) {
			const candidate = fits({ ...request, repetitions }, prices, config, spentThisMonthUsd);
			if (candidate.fits) {
				return {
					decision: "reduce_repetitions",
					effectiveRepetitions: repetitions,
					estimate: candidate.estimate,
					reasons: [...pressure, `Se reduce a ${repetitions} repeticiones para entrar en el presupuesto.`],
				};
			}
		}
		pressure.push("Ni con 1 repetición entra en el presupuesto.");
	}

	return { decision: "stop", effectiveRepetitions: 0, estimate, reasons: pressure };
}
