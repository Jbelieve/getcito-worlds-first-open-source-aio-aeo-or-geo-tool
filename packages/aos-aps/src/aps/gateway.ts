/**
 * APS Fase 1 judge over the internal gateway (BeGateway / LiteLLM), which is OpenAI-compatible.
 *
 * MAASY asked its judge through a tool call. The gateway path asks for the same fields as JSON
 * instead, so the judge schema travels in the system prompt. That difference is real and is recorded
 * in `pipelineVersion`, because a judge whose output format changed is a different comparable series.
 *
 * The verdict this returns is untrusted input: `normalizeVerdict` in ./judge.ts validates it before
 * anything is persisted.
 */

import { type ApsJudge, judgePrompt } from "./judge";
import {
	FUNNEL_STAGES,
	type FunnelStage,
	LIBRARY_MIX,
	LIBRARY_TARGET_TOTAL,
	type LibraryPromptInput,
	PROMPT_KINDS,
	type PromptKind,
} from "./library";

export interface GatewayJudgeConfig {
	/** Base URL of the gateway, e.g. https://gateway.internal/v1 */
	url: string;
	key: string;
	/** Gateway band alias, e.g. "believe-deep". */
	model: string;
	/** Concrete model version behind the alias, recorded per run. */
	version: string;
	/**
	 * Room for the answer PLUS the model's reasoning, because the reasoning is billed and counted
	 * against this limit. Measured against the live gateway: a judge call spent ~940 reasoning
	 * tokens before writing ~136 characters of JSON, so 700 returned nothing at all.
	 */
	maxTokens?: number;
}

/** Measured default: enough for the reasoning plus the verdict, with headroom. */
export const JUDGE_MAX_TOKENS = 3000;
/**
 * Measured default for a full library: 50 prompts spent ~3.7k tokens reasoning and ~6.3k writing,
 * so 4000 truncated the JSON and the whole generation was thrown away.
 */
export const LIBRARY_MAX_TOKENS = 8000;

/** Distinguishes this JSON-mode judge from MAASY's tool-call judge in the persisted series. */
export const GATEWAY_JUDGE_PIPELINE_VERSION = "gateway-json-v1";

const SYSTEM_PROMPT = `Sos un analista que evalua respuestas de asistentes de IA desde la perspectiva de una marca.

Devuelve SOLO un objeto JSON con exactamente estos campos:
{
  "appeared": boolean,      // ¿la marca fue mencionada, aunque sea de pasada?
  "recommended": boolean,   // ¿fue RECOMENDADA explícitamente, no solo mencionada o comparada?
  "position": integer|null, // posición en la lista (1 = primera). null si no aplica o no apareció.
  "sentiment_0_100": integer, // 0 muy negativo, 100 muy positivo. 50 si no apareció.
  "grounded": boolean,      // ¿cita fuentes verificables (sitios, reviews, datos) o solo afirma?
  "competitors_mentioned": string[] // todas las otras marcas mencionadas
}

Reglas: una marca que no apareció no puede estar recomendada. Si no hay ranking explícito, position es null. No agregues texto fuera del JSON.`;

function base(baseUrl: string): string {
	return baseUrl.replace(/\/+$/, "");
}

function endpoint(baseUrl: string): string {
	return `${base(baseUrl)}/chat/completions`;
}

/**
 * What the gateway reports about the key: the real spend in its budget window and the ceiling.
 * LiteLLM answers this without an inference call, so asking is free.
 */
export interface GatewayBudget {
	spend: number;
	maxBudget: number | null;
	budgetDuration: string | null;
	budgetResetAt: string | null;
	/** Bands the key can call, e.g. believe-fast / believe-smart / believe-deep. */
	models: string[];
}

/**
 * Cost of a single call, as the gateway already computed it. Reading it beats pricing a model by
 * hand: this is the billed number, margins and discounts included.
 */
export function gatewaySpendFromHeaders(headers: Headers): number | null {
	const raw = headers.get("x-litellm-response-cost");
	if (raw === null || raw.length === 0) return null;
	const usd = Number.parseFloat(raw);
	return Number.isFinite(usd) && usd >= 0 ? usd : null;
}

export async function readGatewayBudget(
	config: GatewayJudgeConfig,
	fetchImpl: typeof fetch = fetch,
): Promise<GatewayBudget | null> {
	let payload: unknown;
	try {
		const response = await fetchImpl(`${base(config.url)}/key/info`, {
			method: "GET",
			headers: { authorization: `Bearer ${config.key}` },
		});
		if (response.ok === false) return null;
		payload = await response.json();
	} catch {
		return null;
	}

	const info = (payload as { info?: Record<string, unknown> })?.info;
	if (info === undefined) return null;
	const number = (value: unknown): number | null =>
		typeof value === "number" && Number.isFinite(value) ? value : null;
	const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
	return {
		spend: number(info.spend) ?? 0,
		maxBudget: number(info.max_budget),
		budgetDuration: text(info.budget_duration),
		budgetResetAt: text(info.budget_reset_at),
		models: Array.isArray(info.models) ? info.models.filter((entry): entry is string => typeof entry === "string") : [],
	};
}

/** The model may wrap the JSON in prose or fences; take the first object it produced. */
export function extractJsonObject(content: string): unknown {
	const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = (fenced?.[1] ?? content).trim();
	try {
		return JSON.parse(candidate);
	} catch {
		const start = candidate.indexOf("{");
		const end = candidate.lastIndexOf("}");
		if (start === -1 || end <= start) return null;
		try {
			return JSON.parse(candidate.slice(start, end + 1));
		} catch {
			return null;
		}
	}
}

/**
 * The judge runs inside the gateway, so its identity comes from the environment. `version` must be
 * pinned: without it the persisted series cannot tell a model update apart from a real change in the
 * data.
 */
export function judgeConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayJudgeConfig | null {
	// An empty variable must fall through to the temporary key: a rendered .env commonly carries
	// `LLM_GATEWAY_KEY_BEAOS=` until the dedicated key exists, and `??` alone would treat that as set.
	const firstSet = (...values: Array<string | undefined>): string | undefined =>
		values.map((value) => value?.trim()).find((value) => value !== undefined && value.length > 0);
	const url = firstSet(env.LLM_GATEWAY_URL);
	const key = firstSet(env.LLM_GATEWAY_KEY_BEAOS, env.LLM_GATEWAY_KEY_BEADS);
	if (url === undefined || key === undefined) return null;
	const maxTokens = Number.parseInt(firstSet(env.APS_JUDGE_MAX_TOKENS) ?? "", 10);
	return {
		url,
		key,
		model: firstSet(env.APS_JUDGE_MODEL) ?? "believe-deep",
		version: firstSet(env.APS_JUDGE_VERSION) ?? "unpinned",
		maxTokens: Number.isFinite(maxTokens) && maxTokens > 0 ? maxTokens : JUDGE_MAX_TOKENS,
	};
}

/** Reports what each call actually cost, so a run can carry its real spend beside its estimate. */
export type SpendReporter = (usd: number) => void;

export function gatewayJudge(
	config: GatewayJudgeConfig,
	fetchImpl: typeof fetch = fetch,
	onSpend?: SpendReporter,
): ApsJudge {
	return {
		alias: config.model,
		version: config.version,
		pipelineVersion: GATEWAY_JUDGE_PIPELINE_VERSION,
		analyze: async ({ brandName, promptText, response }) => {
			let payload: unknown;
			try {
				const result = await fetchImpl(endpoint(config.url), {
					method: "POST",
					headers: { "content-type": "application/json", authorization: `Bearer ${config.key}` },
					body: JSON.stringify({
						model: config.model,
						temperature: 0,
						max_tokens: config.maxTokens ?? JUDGE_MAX_TOKENS,
						response_format: { type: "json_object" },
						messages: [
							{ role: "system", content: SYSTEM_PROMPT },
							{ role: "user", content: judgePrompt(brandName, promptText, response) },
						],
					}),
				});
				if (result.ok === false) return null;
				// The billed cost of this exact call, when the gateway reports it.
				const spend = gatewaySpendFromHeaders(result.headers);
				if (spend !== null && onSpend !== undefined) onSpend(spend);
				payload = await result.json();
			} catch {
				return null;
			}

			const choice = (payload as { choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }> })
				?.choices?.[0];
			// Truncated output is not a verdict: the model ran out of room mid-answer.
			if (choice?.finish_reason === "length") return null;
			const content = choice?.message?.content;
			if (typeof content !== "string") return null;
			const parsed = extractJsonObject(content);
			// Shape checking is normalizeVerdict's job; returning the object as-is keeps one validator.
			return parsed === null ? null : (parsed as never);
		},
	};
}

/**
 * APS Fase 4 generation over the same gateway.
 *
 * The generator is told the brand only to calibrate the category, never to name it: a prompt that
 * names the brand contaminates the signal, and the library stage rejects it anyway. What comes back
 * is still only a candidate list — the operator reviews it before it is persisted and locked.
 */
export const LIBRARY_GENERATOR_PIPELINE_VERSION = "gateway-library-json-v1";

const LIBRARY_SYSTEM_PROMPT = `Generas bibliotecas de prompts de compra que un usuario real le haria a un asistente de IA.

Reglas duras:
- Los prompts NO nombran ninguna marca. El contexto de marca sirve solo para calibrar la categoria.
- Cada prompt es una consulta de compra genuina, en espanol.
- Devuelve SOLO JSON: { "prompts": [ { "text": string, "kind": "comparison"|"use_case"|"category", "funnel_stage": "awareness"|"consideration"|"decision" } ] }
- Mezcla objetivo: 50% comparison, 30% use_case, 20% category.
- No agregues texto fuera del JSON.`;

/**
 * Generation runs on a cheaper band than the judge: writing prompts is authoring work, not the
 * measurement judgement, and the operator reviews the candidate list before anything is locked.
 */
export function libraryConfigFromEnv(env: Record<string, string | undefined> = process.env): GatewayJudgeConfig | null {
	const judge = judgeConfigFromEnv(env);
	if (judge === null) return null;
	const model = env.APS_LIBRARY_MODEL?.trim();
	return { ...judge, model: model !== undefined && model.length > 0 ? model : "believe-smart" };
}

export interface GatewayLibraryInput {
	brandName: string;
	industry?: string | null;
	brief?: string | null;
	total?: number;
}

export interface GeneratedLibrary {
	prompts: LibraryPromptInput[];
	/** Candidates the model produced that are not usable as they came. */
	rejected: Array<{ text: string; reason: string }>;
}

function buildLibraryPrompt(input: GatewayLibraryInput, total: number): string {
	const comparison = Math.round(total * LIBRARY_MIX.comparison);
	const useCase = Math.round(total * LIBRARY_MIX.use_case);
	const category = total - comparison - useCase;
	return `Genera ${total} prompts de compra para la categoria "${input.industry ?? "marketing/software"}".
Contexto de la marca (SOLO para calibrar la categoria, NUNCA para nombrarla en los prompts): ${input.brief ?? "sin brief adicional"}.
Cantidades exactas: ${comparison} comparison, ${useCase} use_case, ${category} category.`;
}

function asLibraryPrompt(value: unknown): LibraryPromptInput | null {
	if (value === null || typeof value !== "object") return null;
	const record = value as Record<string, unknown>;
	const text = typeof record.text === "string" ? record.text.trim() : "";
	const kind = record.kind;
	const funnelStage = record.funnel_stage ?? record.funnelStage;
	if (text.length === 0) return null;
	if (PROMPT_KINDS.includes(kind as PromptKind) === false) return null;
	if (FUNNEL_STAGES.includes(funnelStage as FunnelStage) === false) return null;
	return { text, kind: kind as PromptKind, funnelStage: funnelStage as FunnelStage };
}

/**
 * Asks the gateway for a candidate library. Returns null when the call or the payload is unusable, so
 * the caller reports a failure instead of persisting half a library.
 */
export async function generateLibraryWithGateway(
	input: GatewayLibraryInput,
	config: GatewayJudgeConfig,
	fetchImpl: typeof fetch = fetch,
): Promise<GeneratedLibrary | null> {
	const total = input.total ?? LIBRARY_TARGET_TOTAL;
	let payload: unknown;
	try {
		const response = await fetchImpl(endpoint(config.url), {
			method: "POST",
			headers: { "content-type": "application/json", authorization: `Bearer ${config.key}` },
			body: JSON.stringify({
				model: config.model,
				temperature: 0.7,
				max_tokens: config.maxTokens ?? LIBRARY_MAX_TOKENS,
				response_format: { type: "json_object" },
				messages: [
					{ role: "system", content: LIBRARY_SYSTEM_PROMPT },
					{ role: "user", content: buildLibraryPrompt(input, total) },
				],
			}),
		});
		if (response.ok === false) return null;
		payload = await response.json();
	} catch {
		return null;
	}

	const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message?.content;
	if (typeof content !== "string") return null;
	const parsed = extractJsonObject(content) as { prompts?: unknown } | null;
	if (parsed === null || Array.isArray(parsed.prompts) === false) return null;

	const prompts: LibraryPromptInput[] = [];
	const rejected: Array<{ text: string; reason: string }> = [];
	for (const candidate of parsed.prompts) {
		const prompt = asLibraryPrompt(candidate);
		if (prompt === null) {
			const text =
				candidate !== null &&
				typeof candidate === "object" &&
				typeof (candidate as { text?: unknown }).text === "string"
					? String((candidate as { text: string }).text)
					: "";
			rejected.push({ text, reason: "kind, funnel_stage o texto invalido" });
			continue;
		}
		prompts.push(prompt);
	}
	return prompts.length === 0 ? null : { prompts, rejected };
}
