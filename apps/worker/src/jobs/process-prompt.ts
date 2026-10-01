import { getDefaultDelayHours, PROCESS_PROMPT_JOB_POLICY, RUNS_PER_PROMPT } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import {
	type Brand,
	brands,
	type Competitor,
	citations,
	competitors,
	promptRuns,
	prompts,
} from "@workspace/lib/db/schema";
import {
	callCostFromResult,
	getProvider,
	type ModelConfig,
	type Provider,
	parseScrapeTargets,
	selectTargetsForBrand,
	withProviderCallTracking,
} from "@workspace/lib/providers";
import { failureBackoffHours } from "@workspace/lib/run-backoff";
import type { Citation } from "@workspace/lib/text-extraction";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import boss from "../boss";
import { trackWorkerEvent } from "../telemetry";

export interface ProcessPromptData {
	promptId: string;
	cadenceHours?: number; // Hours until next run (for self-rescheduling)
	/** Cycles in a row where every run failed, carried forward to size the backoff. */
	consecutiveFailures?: number;
}

interface PromptContext {
	prompt: typeof prompts.$inferSelect;
	brand: Brand;
	competitors: Competitor[];
}

/**
 * Schedule the next run for a prompt.
 *
 * Normally that's one cadence away; after a cycle where every run failed it's
 * the shorter backoff from failureBackoffHours, and `consecutiveFailures` rides
 * along on the job so the next failure can lengthen it again.
 */
async function scheduleNextRun(promptId: string, cadenceHours: number, consecutiveFailures: number): Promise<void> {
	const delayHours = failureBackoffHours(consecutiveFailures, cadenceHours);
	const startAfterSeconds = Math.round(delayHours * 60 * 60);

	try {
		await boss.send(
			"process-prompt",
			{ promptId, cadenceHours, consecutiveFailures },
			{
				singletonKey: `prompt-${promptId}`,
				singletonSeconds: startAfterSeconds, // Prevent duplicates until the next attempt is due
				startAfter: startAfterSeconds,
				...PROCESS_PROMPT_JOB_POLICY,
			},
		);
		const reason = consecutiveFailures > 0 ? ` (backing off after ${consecutiveFailures} failed cycle(s))` : "";
		console.log(`Scheduled next run for prompt ${promptId} in ${delayHours}h${reason}`);
	} catch (error) {
		console.error(`Failed to schedule next run for prompt ${promptId}:`, error);
		// Don't throw - we don't want to fail the job just because rescheduling failed
	}
}

async function getPromptContext(promptId: string): Promise<PromptContext | null> {
	const prompt = await db.query.prompts.findFirst({
		where: eq(prompts.id, promptId),
	});

	if (!prompt) {
		console.error(`Prompt not found: ${promptId}`);
		return null;
	}

	const brand = await db.query.brands.findFirst({
		where: eq(brands.id, prompt.brandId),
	});

	if (!brand) {
		console.error(`Brand not found: ${prompt.brandId}`);
		return null;
	}

	const brandCompetitors = await db.query.competitors.findMany({
		where: eq(competitors.brandId, prompt.brandId),
	});

	return {
		prompt,
		brand,
		competitors: brandCompetitors,
	};
}

function extractDomainFromUrl(urlOrDomain: string): string {
	try {
		const url = new URL(urlOrDomain.startsWith("http") ? urlOrDomain : `https://${urlOrDomain}`);
		return url.hostname.replace(/^www\./, "").toLowerCase();
	} catch {
		return urlOrDomain.replace(/^www\./, "").toLowerCase();
	}
}

function analyzeMentions(
	content: string,
	brand: Brand,
	competitorsList: Competitor[],
): {
	brandMentioned: boolean;
	competitorsMentioned: string[];
} {
	const contentLower = content.toLowerCase();

	const brandNames = [brand.name, ...(brand.aliases || [])].map((n) => n.toLowerCase());
	const brandDomains = [
		extractDomainFromUrl(brand.website),
		...(brand.additionalDomains || []).map(extractDomainFromUrl),
	];
	const brandMentioned =
		brandNames.some((n) => contentLower.includes(n)) || brandDomains.some((d) => contentLower.includes(d));

	const competitorsMentioned = competitorsList
		.filter((competitor) => {
			const names = [competitor.name, ...(competitor.aliases || [])].map((n) => n.toLowerCase());
			const nameMatch = names.some((n) => contentLower.includes(n));
			const domainMatch = (competitor.domains || []).some((d) => contentLower.includes(extractDomainFromUrl(d)));
			return nameMatch || domainMatch;
		})
		.map((competitor) => competitor.name);

	return { brandMentioned, competitorsMentioned };
}

async function savePromptRun(
	promptId: string,
	brandId: string,
	model: string,
	provider: string | null,
	version: string,
	webSearchEnabled: boolean,
	rawOutput: unknown,
	webQueries: string[],
	brandMentioned: boolean,
	competitorsMentioned: string[],
): Promise<{ id: string; createdAt: Date }> {
	const [result] = await db
		.insert(promptRuns)
		.values({
			promptId,
			brandId,
			model,
			provider,
			version,
			webSearchEnabled,
			rawOutput,
			webQueries,
			brandMentioned,
			competitorsMentioned,
		})
		.returning({ id: promptRuns.id, createdAt: promptRuns.createdAt });

	return result;
}

async function saveCitations(
	promptRunId: string,
	promptId: string,
	brandId: string,
	model: string,
	extracted: Citation[],
	createdAt: Date,
): Promise<void> {
	if (extracted.length === 0) return;

	await db.insert(citations).values(
		extracted.map((c) => ({
			promptRunId,
			promptId,
			brandId,
			model,
			url: c.url,
			domain: c.domain,
			title: c.title || null,
			citationIndex: c.citationIndex,
			createdAt,
		})),
	);
}

async function runModelIteration({
	promptId,
	promptValue,
	brand,
	competitorsList,
	config,
	providerImpl,
	runIndex,
}: {
	promptId: string;
	promptValue: string;
	brand: Brand;
	competitorsList: Competitor[];
	config: ModelConfig;
	providerImpl: Provider;
	runIndex: number;
}): Promise<void> {
	const logPrefix = `[${config.model}_${runIndex}]`;

	// Locale and web search silently degrade rather than fail: a provider with no
	// targetMarket geolocates from its own IP, and webSearch=false (no `:online`
	// in SCRAPE_TARGETS) means the model answers from training data with no
	// citations. Log what was actually sent so those two look different in the log.
	console.log(
		`${logPrefix} market=${brand.targetMarket ?? "none"} language=${brand.targetLanguage ?? "none"} webSearch=${config.webSearch}`,
	);

	const result = await withProviderCallTracking(
		{ provider: providerImpl.id, model: config.model, kind: "run", brandId: brand.id, promptId },
		() =>
			providerImpl.run(config.model, promptValue, {
				webSearch: config.webSearch,
				version: config.version,
				targetMarket: brand.targetMarket ?? undefined,
				targetLanguage: brand.targetLanguage ?? undefined,
			}),
		// Tokens y costo reales que reportó el proveedor. Un scraper no reporta
		// ninguno: la fila queda con `cost_usd` en null, que es "no lo sé".
		callCostFromResult,
	);

	// `webQueries` is stored exactly as the provider reported it — engines do
	// sometimes genuinely search the prompt verbatim, and that's real data. The
	// fan-out page excludes verbatim repeats at read time as a display rule;
	// providers whose query field is fabricated (DataForSEO) write the
	// `unavailable` sentinel in their own extractor instead.
	const { rawOutput, textContent, webQueries, citations: extractedCitations, modelVersion } = result;
	console.log(`${logPrefix} AI call completed, textContent length: ${textContent?.length ?? "null"}`);

	const safeTextContent = typeof textContent === "string" ? textContent : "";

	const { brandMentioned, competitorsMentioned } = analyzeMentions(safeTextContent, brand, competitorsList);

	const recordedVersion = modelVersion ?? config.version ?? config.provider;

	const { id: promptRunId, createdAt } = await savePromptRun(
		promptId,
		brand.id,
		config.model,
		config.provider,
		recordedVersion,
		config.webSearch,
		rawOutput,
		webQueries,
		brandMentioned,
		competitorsMentioned,
	);
	console.log(`${logPrefix} Saved prompt run ${promptRunId}`);

	await saveCitations(promptRunId, promptId, brand.id, config.model, extractedCitations, createdAt);
}

/**
 * Process a prompt - runs AI models and saves results.
 * This is a pg-boss job handler, called when a scheduled job fires.
 * After successful completion, schedules the next run.
 */
export async function processPromptJob(jobs: Job<ProcessPromptData>[]): Promise<void> {
	const scrapeConfigs = parseScrapeTargets(process.env.SCRAPE_TARGETS);

	// pg-boss v12 passes an array of jobs - process each one
	for (const job of jobs) {
		const { promptId } = job.data;
		const consecutiveFailures = job.data.consecutiveFailures ?? 0;
		console.log(`Processing prompt ${promptId}`);

		// Get prompt context
		const context = await getPromptContext(promptId);
		if (!context) {
			console.log(`Prompt ${promptId} not found, skipping (no reschedule)`);
			continue; // Job completes successfully - prompt was deleted, don't reschedule
		}

		const { prompt, brand, competitors: competitorsList } = context;

		// Read the cadence from the brand rather than from `job.data.cadenceHours`.
		// A job re-embeds its own cadence when it schedules the next run, so the
		// payload value is whatever was current when the *first* job in the chain
		// was created and it propagates forever - changing the delay override in the
		// admin panel would move the dashboard's idea of "overdue" while the actual
		// runs carried on at the old interval. The payload field is still written so
		// the value a run used stays visible in the job log; it is no longer read.
		const cadenceHours = brand.delayOverrideHours ?? getDefaultDelayHours();

		// Check if prompt and brand are enabled
		if (!prompt.enabled || !brand.enabled) {
			console.log(`Prompt ${promptId} or brand ${brand.id} is disabled, skipping but rescheduling`);
			// Still reschedule - the prompt might be enabled later
			await scheduleNextRun(promptId, cadenceHours, 0);
			continue;
		}

		const selectedConfigs = selectTargetsForBrand(scrapeConfigs, brand.enabledModels);
		if (selectedConfigs.length === 0) {
			console.log(`Prompt ${promptId} for brand ${brand.id} has no targets (brand.enabledModels=[])`);
		}

		console.log(`Processing prompt "${prompt.value}" for brand "${brand.name}"`);

		// Run all model iterations in parallel
		const runPromises: Promise<void>[] = [];
		// Same order as runPromises, so a rejection can name the model that failed
		// instead of an index into the (shorter) failures array.
		const runLabels: string[] = [];

		for (const config of selectedConfigs) {
			const providerImpl = getProvider(config.provider);
			for (let i = 0; i < RUNS_PER_PROMPT; i++) {
				runLabels.push(`${config.model}_${i + 1}`);
				runPromises.push(
					runModelIteration({
						promptId,
						promptValue: prompt.value,
						brand,
						competitorsList,
						config,
						providerImpl,
						runIndex: i + 1,
					}),
				);
			}
		}

		const results = await Promise.allSettled(runPromises);
		const failures = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");

		if (failures.length > 0) {
			const errorMessages = results
				.map((result, i) =>
					result.status === "rejected"
						? `[${runLabels[i]}] ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`
						: null,
				)
				.filter(Boolean)
				.join("; ");

			console.error(`Prompt ${promptId} had ${failures.length}/${runPromises.length} failed runs: ${errorMessages}`);
		}

		const successCount = runPromises.length - failures.length;
		console.log(`Completed prompt ${promptId}: ${successCount}/${runPromises.length} successful runs`);

		trackWorkerEvent("prompt_processed", {
			brand_id: brand.id,
			models: [...new Set(selectedConfigs.map((c) => c.model))],
			providers: [...new Set(selectedConfigs.map((c) => c.provider))],
			total_runs: runPromises.length,
			successful_runs: successCount,
			failed_runs: failures.length,
		});

		// A cycle where nothing came back means the targets themselves are failing,
		// so the next attempt backs off instead of running on cadence. Anything
		// that produced a run clears the streak. The backoff is capped at the
		// cadence, so a prompt that stays broken costs what a healthy one costs
		// rather than more.
		const failedCycles = runPromises.length > 0 && successCount === 0 ? consecutiveFailures + 1 : 0;
		await scheduleNextRun(promptId, cadenceHours, failedCycles);
	}
}
