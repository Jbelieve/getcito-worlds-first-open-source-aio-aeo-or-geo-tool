import type { ModelConfig } from "@workspace/config/scrape-targets";
import type { z } from "zod";
import type { Citation } from "../text-extraction";

// Canonical definition lives next to the SCRAPE_TARGETS parser in
// @workspace/config; re-exported here so provider code keeps importing it
// from "./types".
export type { ModelConfig };

/**
 * Lo que el proveedor reporta de **consumo**: los tokens de la llamada.
 *
 * Existe porque el costo real de los modelos que **no pasan por el gateway** sale de acá: sin
 * tarifa del modelo, los tokens solos no dan dólares, pero sin tokens no hay ni siquiera con qué
 * calcularlo el día que la tarifa exista. Guardar el token y decir "el costo no se puede derivar
 * sin tarifa" es el único camino honesto; inventar el precio no.
 *
 * Todos los campos son opcionales porque "no reportó" es distinto de "cero": un `undefined` no se
 * convierte en `0`.
 */
export interface ProviderUsage {
	promptTokens?: number;
	completionTokens?: number;
	/** Razonamiento, cuando el modelo lo separa. Es costo puro y se comía el tope entero. */
	reasoningTokens?: number;
}

export interface ScrapeResult {
	textContent: string;
	rawOutput: unknown;
	webQueries: string[];
	citations: Citation[];
	modelVersion?: string;
	/** Consumo que reportó el proveedor. Ausente cuando no lo reporta (scrapers). */
	usage?: ProviderUsage;
	/**
	 * Costo que el proveedor **informa él mismo** en su respuesta, en USD. Solo OpenRouter lo hace
	 * hoy. El gateway no llega por acá: su costo está en un header, que se lee aparte.
	 */
	costUsd?: number;
}

export interface ProviderOptions {
	webSearch?: boolean;
	version?: string;
	targetMarket?: string;
	targetLanguage?: string;
}

export interface StructuredResearchOptions<T> {
	prompt: string;
	schema: z.ZodType<T>;
	version?: string;
	/**
	 * Whether the model may use its web-search tool. Defaults to true (the
	 * onboarding research path). Set false for a single completion over context
	 * supplied entirely in the prompt — no tools, no agent loop.
	 */
	webSearch?: boolean;
	/**
	 * The brand's locale, same two fields as {@link ProviderOptions}. Structured
	 * research assembles its own request, so a provider that drops these
	 * generates every brand in the model's default language and market even
	 * though tracked-prompt runs honor them.
	 */
	targetMarket?: string;
	targetLanguage?: string;
}

export interface StructuredResearchResult<T> {
	object: T;
	/** Resolved model id (after any `:online` suffixing etc.). */
	modelVersion?: string;
	/**
	 * Consumo y costo que reportó el proveedor, igual que en `ScrapeResult`.
	 *
	 * El onboarding también gasta y hasta ahora no guardaba ni los tokens: la
	 * llamada quedaba registrada sin ningún dato de consumo, así que no había
	 * forma de saber qué costó. Un camino que **sí** puede reportarlo no puede
	 * dejarlo sin capturar.
	 */
	usage?: ProviderUsage;
	costUsd?: number;
}

export interface Provider {
	id: string;
	name: string;
	isConfigured(): boolean;
	run(model: string, prompt: string, options?: ProviderOptions): Promise<ScrapeResult>;
	/** Validate a target config. Returns an error message if invalid, null if valid.
	 *  Omit for providers that accept any model (runtime validation only). */
	validateTarget?(config: ModelConfig): string | null;

	/**
	 * Run a single research call that returns a Zod-validated structured value.
	 * Each direct API provider implements this using the most idiomatic combo.
	 * Scraper providers don't implement this, and at least one direct api
	 * provider is required.
	 */
	runStructuredResearch?<T>(options: StructuredResearchOptions<T>): Promise<StructuredResearchResult<T>>;
}

export interface TestResult {
	success: boolean;
	latencyMs: number;
	error?: string;
	sampleOutput?: string;
}
