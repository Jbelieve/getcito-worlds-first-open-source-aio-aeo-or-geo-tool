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

export interface GatewayJudgeConfig {
	/** Base URL of the gateway, e.g. https://gateway.internal/v1 */
	url: string;
	key: string;
	/** Gateway band alias, e.g. "believe-deep". */
	model: string;
	/** Concrete model version behind the alias, recorded per run. */
	version: string;
	maxTokens?: number;
}

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

function endpoint(baseUrl: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
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
	const url = env.LLM_GATEWAY_URL?.trim();
	const key = (env.LLM_GATEWAY_KEY_BEAOS ?? env.LLM_GATEWAY_KEY_BEADS)?.trim();
	if (url === undefined || url.length === 0 || key === undefined || key.length === 0) return null;
	const model = env.APS_JUDGE_MODEL?.trim() ?? "believe-deep";
	return {
		url,
		key,
		model: model.length > 0 ? model : "believe-deep",
		version: env.APS_JUDGE_VERSION?.trim() ?? "unpinned",
	};
}

export function gatewayJudge(config: GatewayJudgeConfig, fetchImpl: typeof fetch = fetch): ApsJudge {
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
						max_tokens: config.maxTokens ?? 700,
						response_format: { type: "json_object" },
						messages: [
							{ role: "system", content: SYSTEM_PROMPT },
							{ role: "user", content: judgePrompt(brandName, promptText, response) },
						],
					}),
				});
				if (result.ok === false) return null;
				payload = await result.json();
			} catch {
				return null;
			}

			const content = (payload as { choices?: Array<{ message?: { content?: unknown } }> })?.choices?.[0]?.message
				?.content;
			if (typeof content !== "string") return null;
			const parsed = extractJsonObject(content);
			// Shape checking is normalizeVerdict's job; returning the object as-is keeps one validator.
			return parsed === null ? null : (parsed as never);
		},
	};
}
