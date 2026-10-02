/**
 * Shared report metrics computation module.
 * Provides Share of Voice (SoV) calculations and representative prompt selection
 * for both the report renderer and the report API.
 */
import { getModelMeta } from "./providers/models";
import type { CoverageCycle, CoverageSummary, RunCoverage } from "./run-coverage";
import { summarizeCoverage, summarizeCycleCoverage, unverifiableCoverage } from "./run-coverage";

// ---------- Types ----------

export interface ReportPromptRun {
	promptId: string;
	brandMentioned: boolean;
	competitorsMentioned: string[];
}

export interface ReportCompetitor {
	name: string;
	domain: string;
}

export interface PromptSoV {
	promptId: string;
	sov: number | null;
	brandMentionCount: number;
	totalRuns: number;
	totalCompetitorMentions: number;
	competitorMentions: Record<string, number>;
	/**
	 * Intentos planificados para este prompt. Igual a `totalRuns` cuando todo
	 * respondió; **mayor** cuando hubo fallos de proveedor.
	 *
	 * Opcional en el tipo por compatibilidad con quien arma el objeto a mano; **siempre
	 * presente** en lo que devuelve `computePromptSoV`.
	 */
	plannedRuns?: number;
	/** Intentos que fallaron y no dejaron fila de resultado. */
	failedRuns?: number;
	/**
	 * Menciones de marca sobre **intentos planeados**, 0-100, o `null` cuando el
	 * histórico no permite reconstruir el denominador.
	 *
	 * Es distinto de `sov` a propósito: `sov` responde "cuando el modelo contestó,
	 * ¿cuánto de la conversación fue de la marca?" (menciones / (marca + competidores))
	 * y `attemptShare` responde "de todo lo que intentamos medir, ¿en cuánto apareció
	 * la marca?". Un proveedor caído mueve la segunda y **no** la primera — tratarlo
	 * como "la marca no apareció" sería inventar un dato.
	 */
	attemptShare?: number | null;
	/** Cuántas corridas respondieron de cuántas se planearon. Nunca sale solo. */
	coverage?: CoverageSummary;
}

/**
 * Lo que quien ejecutó la medición sabe del ciclo: intentos planeados, exitosos y
 * fallidos. Ausente significa "no se registró", que es distinto de "no falló".
 */
export type PromptSoVCoverage = RunCoverage;

/**
 * Cruza el recuento de intentos con las filas observadas.
 *
 * La regla dura: sin cobertura registrada el denominador **no se inventa**, se declara
 * `unverifiable`. Y una cobertura declarada nunca encoge el denominador por debajo de
 * las filas que sí existen — un fallo que no se contó no puede abaratar el número.
 */
export function resolvePromptCoverage(
	observedRuns: number,
	coverage?: PromptSoVCoverage | null,
): { summary: CoverageSummary; plannedRuns: number; failedRuns: number } {
	if (coverage === undefined || coverage === null) {
		return { summary: unverifiableCoverage(), plannedRuns: observedRuns, failedRuns: 0 };
	}

	const planned = Math.max(coverage.planned, coverage.succeeded + coverage.failed, observedRuns);
	const summary = summarizeCoverage({ planned, succeeded: coverage.succeeded, failed: coverage.failed });

	if (summary.state === "no_data") {
		return { summary: unverifiableCoverage(), plannedRuns: observedRuns, failedRuns: 0 };
	}

	return { summary, plannedRuns: planned, failedRuns: coverage.failed };
}

/**
 * La marca mencionada sobre los intentos planeados.
 *
 * `null` cuando no hay intentos (y también cuando el histórico no permite saber
 * cuántos hubo): un `0` acá sería "la marca no apareció" sobre un denominador que no
 * conocemos, que es exactamente la familia de datos falsos que este módulo evita.
 */
export function shareOfAttempts(
	mentioned: number,
	plan: { plannedRuns: number; summary: CoverageSummary },
): number | null {
	if (plan.summary.state === "unverifiable" || plan.summary.state === "no_data") return null;
	if (plan.plannedRuns === 0) return null;
	return Math.round((mentioned / plan.plannedRuns) * 100);
}

export interface CompetitorSoV {
	name: string;
	sov: number;
	mentionCount: number;
}

export type PromptCategory = "strength" | "opportunity";

export interface SelectedPrompt {
	promptId: string;
	category: PromptCategory;
	sov: number | null;
}

// ---------- SoV Computation ----------

/**
 * Compute Share of Voice for a single prompt.
 * SoV = brand_mentions / (brand_mentions + total_competitor_mentions)
 * Returns null when denominator is 0 (no one mentioned).
 *
 * `coverage` es lo que se planificó y lo que falló. Sin él, `attemptShare` queda
 * `null` y `coverage.state` en `"unverifiable"`: el denominador histórico no se
 * reconstruye, se declara incompleto. Con él, `attemptShare` divide por los intentos.
 */
export function computePromptSoV(
	promptId: string,
	runs: ReportPromptRun[],
	competitors: ReportCompetitor[],
	coverage?: PromptSoVCoverage | null,
): PromptSoV {
	const promptRuns = runs.filter((r) => r.promptId === promptId);
	const totalRuns = promptRuns.length;
	const plan = resolvePromptCoverage(totalRuns, coverage);

	if (totalRuns === 0 && plan.summary.state === "no_data") {
		return {
			promptId,
			sov: null,
			brandMentionCount: 0,
			totalRuns: 0,
			totalCompetitorMentions: 0,
			competitorMentions: {},
			plannedRuns: plan.plannedRuns,
			failedRuns: plan.failedRuns,
			attemptShare: null,
			coverage: plan.summary,
		};
	}

	const brandMentionCount = promptRuns.filter((r) => r.brandMentioned).length;

	const competitorMentions: Record<string, number> = {};
	let totalCompetitorMentions = 0;

	for (const run of promptRuns) {
		if (run.competitorsMentioned) {
			for (const mentioned of run.competitorsMentioned) {
				if (competitors.some((c) => c.name === mentioned)) {
					competitorMentions[mentioned] = (competitorMentions[mentioned] || 0) + 1;
					totalCompetitorMentions++;
				}
			}
		}
	}

	const denominator = brandMentionCount + totalCompetitorMentions;
	const sov = denominator === 0 ? null : Math.round((brandMentionCount / denominator) * 100);

	return {
		promptId,
		sov,
		brandMentionCount,
		totalRuns,
		totalCompetitorMentions,
		competitorMentions,
		plannedRuns: plan.plannedRuns,
		failedRuns: plan.failedRuns,
		attemptShare: shareOfAttempts(brandMentionCount, plan),
		coverage: plan.summary,
	};
}

/**
 * Compute overall Share of Voice across all prompts.
 * Aggregates brand mentions and competitor mentions across all runs.
 */
export function computeOverallSoV(
	runs: ReportPromptRun[],
	competitors: ReportCompetitor[],
): number | null {
	let totalBrandMentions = 0;
	let totalCompetitorMentions = 0;

	for (const run of runs) {
		if (run.brandMentioned) totalBrandMentions++;
		if (run.competitorsMentioned) {
			for (const mentioned of run.competitorsMentioned) {
				if (competitors.some((c) => c.name === mentioned)) {
					totalCompetitorMentions++;
				}
			}
		}
	}

	const denominator = totalBrandMentions + totalCompetitorMentions;
	if (denominator === 0) return null;
	return Math.round((totalBrandMentions / denominator) * 100);
}

export interface ReportCoverage {
	/** Intentos planificados en toda la medición. */
	plannedRuns: number;
	/** Intentos de los que salió una respuesta. */
	succeededRuns: number;
	/** Intentos que fallaron y no dejaron fila. */
	failedRuns: number;
	/** Marca mencionada sobre intentos planeados, 0-100, o `null` sin denominador. */
	attemptShare: number | null;
	coverage: CoverageSummary;
}

/**
 * La cobertura de la medición entera, para publicarla al lado del porcentaje.
 *
 * Sin `cycles` (el histórico anterior a que se registraran los intentos) devuelve el
 * mismo `unverifiable` que un prompt suelto: el denominador no se puede reconstruir y
 * se declara, no se rellena.
 */
export function computeReportCoverage(runs: ReportPromptRun[], cycles: CoverageCycle[] = []): ReportCoverage {
	const mentioned = runs.filter((run) => run.brandMentioned).length;

	if (cycles.length === 0) {
		return {
			plannedRuns: runs.length,
			succeededRuns: runs.length,
			failedRuns: 0,
			attemptShare: null,
			coverage: unverifiableCoverage(),
		};
	}

	const summary = summarizeCycleCoverage(cycles);
	let plannedRuns = 0;
	let succeededRuns = 0;
	let failedRuns = 0;
	for (const cycle of cycles) {
		if (cycle.coverage === null) continue;
		plannedRuns += Math.max(cycle.coverage.planned, cycle.coverage.succeeded + cycle.coverage.failed);
		succeededRuns += cycle.coverage.succeeded;
		failedRuns += cycle.coverage.failed;
	}

	return {
		plannedRuns,
		succeededRuns,
		failedRuns,
		attemptShare: shareOfAttempts(mentioned, { plannedRuns, summary }),
		coverage: summary,
	};
}

/**
 * Compute per-competitor Share of Voice.
 */
export function computeCompetitorSoVs(
	runs: ReportPromptRun[],
	competitors: ReportCompetitor[],
): CompetitorSoV[] {
	let totalBrandMentions = 0;
	const competitorMentionCounts: Record<string, number> = {};

	for (const run of runs) {
		if (run.brandMentioned) totalBrandMentions++;
		if (run.competitorsMentioned) {
			for (const mentioned of run.competitorsMentioned) {
				if (competitors.some((c) => c.name === mentioned)) {
					competitorMentionCounts[mentioned] = (competitorMentionCounts[mentioned] || 0) + 1;
				}
			}
		}
	}

	const totalAllMentions = totalBrandMentions +
		Object.values(competitorMentionCounts).reduce((sum, c) => sum + c, 0);

	if (totalAllMentions === 0) return [];

	return competitors.map((comp) => {
		const mentionCount = competitorMentionCounts[comp.name] || 0;
		return {
			name: comp.name,
			sov: Math.round((mentionCount / totalAllMentions) * 100),
			mentionCount,
		};
	}).sort((a, b) => b.sov - a.sov);
}

// ---------- Prompt Selection ----------

/**
 * Select a representative mix of prompts: 2 strengths + 2 opportunities.
 *
 * Strengths: highest SoV prompts (brand is performing well).
 * Opportunities: prompts where competitors are active and brand has room to grow.
 *   - Prefer non-zero SoV opportunities (brand has some presence but competitors lead).
 *   - At most 1 zero-SoV prompt to avoid making the brand look invisible.
 *
 * If fewer than 2 in either bucket, fills from the other.
 */
export function selectRepresentativePrompts(
	promptSoVs: PromptSoV[],
	isBrandedFn: (promptId: string) => boolean,
): SelectedPrompt[] {
	// Prefer non-branded prompts as they're more representative of organic discovery
	const nonBranded = promptSoVs.filter((p) => !isBrandedFn(p.promptId));
	const pool = nonBranded.length >= 4 ? nonBranded : promptSoVs;

	// Strengths: highest SoV, prefer prompts where competitors are also active (more compelling)
	const strengths = pool
		.filter((p) => p.sov !== null && p.sov > 0)
		.sort((a, b) => {
			// Prefer prompts with competitor activity — winning against nobody isn't compelling
			const aHasComp = a.totalCompetitorMentions > 0 ? 1 : 0;
			const bHasComp = b.totalCompetitorMentions > 0 ? 1 : 0;
			if (bHasComp !== aHasComp) return bHasComp - aHasComp;
			return (b.sov ?? 0) - (a.sov ?? 0);
		});

	// Opportunities: have competitor mentions, sorted to prefer non-zero SoV first
	const nonZeroOpportunities = pool
		.filter((p) => p.totalCompetitorMentions > 0 && p.sov !== null && p.sov > 0)
		.sort((a, b) => {
			// Lowest brand SoV first (biggest room to grow), then most competitor activity
			const sovDiff = (a.sov ?? 0) - (b.sov ?? 0);
			if (sovDiff !== 0) return sovDiff;
			return b.totalCompetitorMentions - a.totalCompetitorMentions;
		});

	const zeroSovOpportunities = pool
		.filter((p) => p.totalCompetitorMentions > 0 && (p.sov === null || p.sov === 0))
		.sort((a, b) => b.totalCompetitorMentions - a.totalCompetitorMentions);

	const selected: SelectedPrompt[] = [];
	const usedIds = new Set<string>();

	// Pick up to 2 strengths
	for (const s of strengths) {
		if (selected.length >= 2) break;
		if (usedIds.has(s.promptId)) continue;
		selected.push({ promptId: s.promptId, category: "strength", sov: s.sov });
		usedIds.add(s.promptId);
	}

	// Pick opportunities: prefer non-zero SoV, allow at most 1 zero-SoV
	let zeroSovCount = 0;
	const opportunityCandidates = [...nonZeroOpportunities, ...zeroSovOpportunities];

	for (const o of opportunityCandidates) {
		if (selected.filter((s) => s.category === "opportunity").length >= 2) break;
		if (usedIds.has(o.promptId)) continue;
		const isZero = o.sov === null || o.sov === 0;
		if (isZero && zeroSovCount >= 1) continue;
		if (isZero) zeroSovCount++;
		selected.push({ promptId: o.promptId, category: "opportunity", sov: o.sov });
		usedIds.add(o.promptId);
	}

	// Fill remaining slots if we have fewer than 4
	if (selected.length < 4) {
		const remaining = [...strengths, ...nonZeroOpportunities, ...zeroSovOpportunities];
		for (const r of remaining) {
			if (selected.length >= 4) break;
			if (usedIds.has(r.promptId)) continue;
			const isZero = r.sov === null || r.sov === 0;
			if (isZero && zeroSovCount >= 1) continue;
			if (isZero) zeroSovCount++;
			const category: PromptCategory = (r.sov ?? 0) > 0 ? "strength" : "opportunity";
			selected.push({ promptId: r.promptId, category, sov: r.sov });
			usedIds.add(r.promptId);
		}
	}

	return selected.slice(0, 4);
}

// ---------- Rich Analysis ----------

/** A prompt run with full response data for deeper analysis. */
export interface FullPromptRun {
	promptId: string;
	promptValue: string;
	brandMentioned: boolean;
	competitorsMentioned: string[];
	webQueries: string[];
	textContent: string;
	model: string;
}

export interface ContentGap {
	promptValue: string;
	promptId: string;
	competitorsMentioned: string[];
	competitorCount: number;
}

export interface WebQueryInsight {
	query: string;
	count: number;
	brandMentionRate: number;
}

/**
 * Find content gaps: prompts where competitors are mentioned but the brand is not.
 * These are the highest-value opportunities for content creation.
 */
export function findContentGaps(
	runs: FullPromptRun[],
	maxResults: number = 5,
): ContentGap[] {
	// Group by promptId
	const byPrompt = new Map<string, FullPromptRun[]>();
	for (const run of runs) {
		if (!byPrompt.has(run.promptId)) byPrompt.set(run.promptId, []);
		byPrompt.get(run.promptId)!.push(run);
	}

	const gaps: ContentGap[] = [];

	for (const [promptId, promptRuns] of byPrompt) {
		const hasBrandMention = promptRuns.some((r) => r.brandMentioned);
		if (hasBrandMention) continue;

		const allCompetitors = new Set<string>();
		for (const run of promptRuns) {
			for (const comp of run.competitorsMentioned) {
				allCompetitors.add(comp);
			}
		}

		if (allCompetitors.size === 0) continue;

		gaps.push({
			promptValue: promptRuns[0].promptValue,
			promptId,
			competitorsMentioned: [...allCompetitors],
			competitorCount: allCompetitors.size,
		});
	}

	return gaps
		.sort((a, b) => b.competitorCount - a.competitorCount)
		.slice(0, maxResults);
}

/**
 * Extract top web search queries used by AI models and how often they led to brand mentions.
 */
export function analyzeWebQueries(
	runs: FullPromptRun[],
	maxResults: number = 10,
): WebQueryInsight[] {
	const queryStats = new Map<string, { count: number; brandMentions: number }>();

	for (const run of runs) {
		if (!run.webQueries) continue;
		for (const query of run.webQueries) {
			const normalized = (query || "").toLowerCase().trim();
			if (!normalized || normalized.length < 3) continue;
			if (!queryStats.has(normalized)) {
				queryStats.set(normalized, { count: 0, brandMentions: 0 });
			}
			const stats = queryStats.get(normalized)!;
			stats.count++;
			if (run.brandMentioned) stats.brandMentions++;
		}
	}

	return [...queryStats.entries()]
		.map(([query, stats]) => ({
			query,
			count: stats.count,
			brandMentionRate: stats.count > 0 ? Math.round((stats.brandMentions / stats.count) * 100) : 0,
		}))
		.sort((a, b) => b.count - a.count)
		.slice(0, maxResults);
}

/**
 * Analyze which competitors are mentioned most frequently and in which contexts.
 */
export function analyzeCompetitorFrequency(
	runs: FullPromptRun[],
	competitors: ReportCompetitor[],
): Array<{ name: string; mentionCount: number; promptCount: number; coMentionRate: number }> {
	const competitorStats = new Map<string, { mentions: number; prompts: Set<string>; coMentions: number }>();

	for (const comp of competitors) {
		competitorStats.set(comp.name, { mentions: 0, prompts: new Set(), coMentions: 0 });
	}

	for (const run of runs) {
		if (!run.competitorsMentioned) continue;
		for (const mentioned of run.competitorsMentioned) {
			const stats = competitorStats.get(mentioned);
			if (!stats) continue;
			stats.mentions++;
			stats.prompts.add(run.promptId);
			if (run.brandMentioned) stats.coMentions++;
		}
	}

	return competitors
		.map((comp) => {
			const stats = competitorStats.get(comp.name)!;
			return {
				name: comp.name,
				mentionCount: stats.mentions,
				promptCount: stats.prompts.size,
				coMentionRate: stats.mentions > 0 ? Math.round((stats.coMentions / stats.mentions) * 100) : 0,
			};
		})
		.sort((a, b) => b.mentionCount - a.mentionCount);
}

/**
 * Compute mention rate by AI engine (how often each engine mentions the brand).
 */
export function analyzeByEngine(
	runs: FullPromptRun[],
): Array<{ engine: string; totalRuns: number; brandMentions: number; mentionRate: number }> {
	const engineStats = new Map<string, { total: number; mentions: number }>();

	for (const run of runs) {
		const engine = run.model;
		if (!engineStats.has(engine)) engineStats.set(engine, { total: 0, mentions: 0 });
		const stats = engineStats.get(engine)!;
		stats.total++;
		if (run.brandMentioned) stats.mentions++;
	}

	// Legacy names from old reports, before model ids were normalized.
	const legacyAliases: Record<string, string> = {
		openai: "ChatGPT",
		anthropic: "Claude",
		google: "Google AI",
	};

	return [...engineStats.entries()]
		.map(([engine, stats]) => ({
			engine: legacyAliases[engine] ?? getModelMeta(engine).label,
			totalRuns: stats.total,
			brandMentions: stats.mentions,
			mentionRate: stats.total > 0 ? Math.round((stats.mentions / stats.total) * 100) : 0,
		}))
		.sort((a, b) => b.mentionRate - a.mentionRate);
}

// ---------- Report Unstable Stats ----------

/** Input shape for computing unstable report stats from rawOutput. */
export interface ReportRawPromptRuns {
	competitors: ReportCompetitor[];
	promptRuns: Array<{
		promptValue: string;
		/**
		 * Intentos planeados para este prompt.
		 *
		 * `undefined` en un reporte guardado antes de que se registrara: el denominador de
		 * ese histórico no se puede reconstruir y se declara incompleto, no se rellena.
		 */
		attempted?: number;
		runs: Array<{
			brandMentioned: boolean;
			competitorsMentioned: string[];
		}>;
	}>;
}

/**
 * La cobertura de proveedores de un reporte: cuántos intentos se planearon, cuántos
 * respondieron y el estado del punto.
 *
 * Un porcentaje sin esto es una opinión: un reporte con 6 de 9 corridas se veía igual
 * que uno con 9 de 9, y el SoV se calculaba sobre las 6.
 */
export interface ReportProviderCoverage {
	plannedRuns: number;
	succeededRuns: number;
	failedRuns: number;
	state: CoverageSummary["state"];
	/** "N de M corridas no respondieron", listo para mostrar. */
	label: string;
	/** Marca mencionada sobre intentos planeados, 0-1 float, o `null` sin denominador. */
	attemptShare: number | null;
	/** `false` cuando el reporte es anterior a que se registraran los intentos. */
	isCoverageVerifiable: boolean;
}

export interface UnstableCompetitorStats {
	name: string;
	sov: number;
	visibility: number;
	promptsWithMentions: number;
	promptRunsWithMentions: number;
}

export interface ReportUnstableStats {
	sov: number | null;
	visibility: number;
	totalPrompts: number;
	totalPromptRuns: number;
	promptsWithBrandMentions: number;
	promptRunsWithBrandMentions: number;
	competitors: UnstableCompetitorStats[];
	/**
	 * Cobertura de proveedores de la medición. Viaja al lado de `sov` para que el número
	 * nunca salga solo: un SoV sobre 6 de 9 corridas no es un SoV completo.
	 */
	providerResponse: ReportProviderCoverage;
}

export interface UnstableCompetitorStats {
	name: string;
	sov: number;
	visibility: number;
	promptsWithMentions: number;
	promptRunsWithMentions: number;
}

export interface ReportUnstableStats {
	sov: number | null;
	visibility: number;
	totalPrompts: number;
	totalPromptRuns: number;
	promptsWithBrandMentions: number;
	promptRunsWithBrandMentions: number;
	competitors: UnstableCompetitorStats[];
}

/**
 * Compute derived stats from report raw output.
 * These are marked "unstable" because the format may change.
 *
 * - sov: brand_mentions / (brand_mentions + competitor_mentions), 0-1 float
 * - visibility: brand_mentions / total_prompt_runs, 0-1 float (how often the brand appears at all)
 * - competitors[].sov: competitor_mentions / total_mentions, 0-1 float
 * - competitors[].promptsWithMentions: number of prompts where this competitor was mentioned
 * - competitors[].promptRunsWithMentions: number of prompt runs where this competitor was mentioned
 * - competitors[].visibility: prompt runs with this competitor / total prompt runs, 0-1 float
 * - providerResponse: cuántos intentos se planearon y cuántos no respondieron. Un
 *   `sov` sin esto es un número que parece completo.
 */
export function computeReportUnstableStats(raw: ReportRawPromptRuns): ReportUnstableStats {
	// Flatten all runs into ReportPromptRun[]
	const runs: ReportPromptRun[] = [];
	let totalPromptRuns = 0;
	const promptsWithBrand = new Set<number>();
	/**
	 * Denominador honesto: la suma de intentos planeados. `null` en cuanto un prompt no
	 * lo declare — un reporte viejo no se puede completar hacia atrás.
	 */
	let plannedPromptRuns: number | null = 0;

	// Track per-competitor: which prompts and how many runs mention them
	const competitorPrompts = new Map<string, Set<number>>();
	const competitorRunCounts = new Map<string, number>();

	raw.promptRuns.forEach((pr, promptIndex) => {
		let promptHasBrand = false;
		const observedForPrompt = pr.runs.length;
		if (plannedPromptRuns !== null) {
			if (typeof pr.attempted !== "number" || Number.isFinite(pr.attempted) === false) {
				plannedPromptRuns = null;
			} else {
				// Un `attempted` menor que lo observado no puede encoger el denominador.
				plannedPromptRuns += Math.max(pr.attempted, observedForPrompt);
			}
		}
		for (const run of pr.runs) {
			runs.push({
				promptId: `prompt-${promptIndex + 1}`,
				brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned,
			});
			totalPromptRuns++;
			if (run.brandMentioned) promptHasBrand = true;
			for (const comp of run.competitorsMentioned) {
				if (!competitorPrompts.has(comp)) competitorPrompts.set(comp, new Set());
				competitorPrompts.get(comp)!.add(promptIndex);
				competitorRunCounts.set(comp, (competitorRunCounts.get(comp) || 0) + 1);
			}
		}
		if (promptHasBrand) promptsWithBrand.add(promptIndex);
	});

	// Compute SoV directly as 0-1 floats (avoid intermediate integer rounding)
	const brandMentionCount = runs.filter((r) => r.brandMentioned).length;
	let totalCompetitorMentions = 0;
	for (const run of runs) {
		for (const mentioned of run.competitorsMentioned) {
			if (raw.competitors.some((c) => c.name === mentioned)) {
				totalCompetitorMentions++;
			}
		}
	}
	const totalAllMentions = brandMentionCount + totalCompetitorMentions;

	const sov = totalAllMentions === 0 ? null : brandMentionCount / totalAllMentions;
	const visibility = totalPromptRuns === 0 ? 0 : brandMentionCount / totalPromptRuns;

	return {
		sov,
		visibility,
		totalPrompts: raw.promptRuns.length,
		totalPromptRuns,
		promptsWithBrandMentions: promptsWithBrand.size,
		promptRunsWithBrandMentions: brandMentionCount,
		providerResponse: buildReportProviderCoverage(plannedPromptRuns, totalPromptRuns, brandMentionCount),
		competitors: totalAllMentions === 0 ? [] : raw.competitors.map((comp) => {
			const promptRunsWithMentions = competitorRunCounts.get(comp.name) || 0;
			return {
				name: comp.name,
				sov: promptRunsWithMentions / totalAllMentions,
				visibility: totalPromptRuns === 0 ? 0 : promptRunsWithMentions / totalPromptRuns,
				promptsWithMentions: competitorPrompts.get(comp.name)?.size || 0,
				promptRunsWithMentions,
			};
		}).sort((a, b) => b.sov - a.sov),
	};
}

/**
 * La cobertura de proveedores del reporte.
 *
 * Sin `planned` (reporte guardado antes de que se registraran los intentos) el estado es
 * `unverifiable`: el denominador histórico no se reconstruye y se declara incompleto, igual
 * que el total de costo que no se puede cerrar.
 */
function buildReportProviderCoverage(
	planned: number | null,
	observed: number,
	mentioned: number,
): ReportProviderCoverage {
	if (planned === null) {
		return {
			plannedRuns: observed,
			succeededRuns: observed,
			failedRuns: 0,
			state: "unverifiable",
			label: unverifiableCoverage().label,
			attemptShare: null,
			isCoverageVerifiable: false,
		};
	}

	const failed = Math.max(0, planned - observed);
	const summary = summarizeCoverage({ planned, succeeded: observed, failed });
	const denominator = Math.max(planned, observed);

	return {
		plannedRuns: denominator,
		succeededRuns: observed,
		failedRuns: failed,
		state: summary.state,
		label: summary.label,
		attemptShare: denominator === 0 ? null : mentioned / denominator,
		isCoverageVerifiable: summary.isCoverageVerifiable,
	};
}

// ---------- Display Helpers ----------

export function getSoVColor(sov: number | null): string {
	if (sov === null) return "text-gray-400";
	if (sov >= 40) return "text-emerald-600";
	if (sov >= 20) return "text-amber-500";
	return "text-rose-500";
}

export function getSoVBadgeClasses(sov: number | null): { variant: "default" | "secondary" | "destructive"; className: string } {
	if (sov === null || sov < 20) return { variant: "destructive", className: "bg-rose-500 hover:bg-rose-500 text-white" };
	if (sov < 40) return { variant: "secondary", className: "bg-amber-500 hover:bg-amber-500 text-white" };
	return { variant: "default", className: "bg-emerald-600 hover:bg-emerald-600 text-white" };
}

export function getSoVLevel(sov: number | null): { label: string; description: string } {
	if (sov === null) return { label: "No Data", description: "No mentions detected." };
	if (sov >= 40) return { label: "Strong", description: "Your brand leads the conversation." };
	if (sov >= 20) return { label: "Moderate", description: "Room for improvement." };
	return { label: "Low", description: "Competitors dominate this space." };
}
