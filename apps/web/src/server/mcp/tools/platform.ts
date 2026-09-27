/**
 * La mitad heredada de Getcito: lo que BeAOS ya medía antes de AOS y APS.
 *
 * Prompts monitoreados, competidores, visibilidad, share of voice, citas, fan-out de consultas,
 * oportunidades y reportes viven en las tablas heredadas (`prompts`, `competitors`, `prompt_runs`,
 * `citations`, `brand_opportunities`, `reports`). El MCP no las exponía y Jorge lo pidió explícito:
 * *"el MCP expone solo AOS y APS y no lo que traemos portado de Getcito... debemos exponer lo máximo
 * posible."*
 *
 * Dos reglas para todos los tools de este archivo:
 *
 * 1. **Todo se lee por marca.** Ninguno devuelve filas de marcas distintas mezcladas; el `brandId` es la
 *    entrada obligatoria. La única tabla sin `brand_id` es `reports`, y por eso `list_reports` vincula
 *    cada reporte por nombre normalizado o por host de la web (ver `reportMatchesBrand`).
 * 2. **Nada pesa cientos de KB.** `prompt_runs.raw_output` y `reports.raw_output` son enormes —hay un
 *    502 en la historia del repo causado por serializarlos— y por eso no se devuelven nunca. Lo que se
 *    devuelve es agregado, acotado, y cuando se recorta se dice.
 */

import { db } from "@workspace/lib/db/db";
import {
	brandOpportunities,
	brands,
	citations,
	competitors,
	promptRuns,
	prompts,
	reports,
} from "@workspace/lib/db/schema";
import { and, count, desc, eq, gte, ilike, or, type SQL, sql } from "drizzle-orm";
import { hostOf, normalizeBrandName, reportMatchesBrand } from "@/lib/report-agent";
import type { McpTool } from "../jsonrpc";
import {
	optionalBoolean,
	optionalInteger,
	optionalString,
	optionalUuid,
	requireString,
	ToolInputError,
	textResult,
} from "../jsonrpc";
import { MAX_LIMIT, rankCounts, readCompetitorNames, truncateText } from "./helpers";

const MAX_DAYS = 365;

/** La marca tiene que existir: devolver una tabla vacía por un id mal escrito es peor que decirlo. */
async function loadBrand(brandId: string): Promise<{ id: string; name: string; website: string }> {
	const [brand] = await db
		.select({ id: brands.id, name: brands.name, website: brands.website })
		.from(brands)
		.where(eq(brands.id, brandId))
		.limit(1);
	if (brand === undefined) {
		throw new ToolInputError(`No existe la marca "${brandId}". Mirá list_brands para ver los ids disponibles.`);
	}
	return brand;
}

function sinceFrom(days: number): Date {
	return new Date(Date.now() - days * 86_400_000);
}

/** `sum(...)` de Postgres llega como texto por el driver; se normaliza acá y no en cada tool. */
function toNumber(value: unknown): number {
	if (typeof value === "number") return value;
	if (typeof value === "string") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : 0;
	}
	return 0;
}

function rate(part: number, total: number): number {
	return total === 0 ? 0 : Math.round((part / total) * 1000) / 1000;
}

const promptsColumns = {
	id: prompts.id,
	value: prompts.value,
	enabled: prompts.enabled,
	tags: prompts.tags,
	systemTags: prompts.systemTags,
	createdAt: prompts.createdAt,
};

const listPrompts: McpTool = {
	name: "list_prompts",
	title: "Listar los prompts monitoreados",
	description:
		"Lista los prompts que BeAOS monitorea para una marca en los motores de IA: su texto, si están habilitados, y sus etiquetas propias y de sistema (por ejemplo `branded` y `unbranded`). Usalo para saber sobre qué preguntas se mide la visibilidad antes de leer get_visibility o get_share_of_voice.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			enabledOnly: { type: "boolean", description: "Si es true, sólo los prompts habilitados. Por defecto, todos." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántos prompts devolver (por defecto 100).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: MAX_LIMIT });
		const enabledOnly = optionalBoolean(args, "enabledOnly") ?? false;
		const where = enabledOnly
			? and(eq(prompts.brandId, brandId), eq(prompts.enabled, true))
			: eq(prompts.brandId, brandId);
		const rows = await db
			.select(promptsColumns)
			.from(prompts)
			.where(where)
			.orderBy(desc(prompts.createdAt))
			.limit(limit);
		const payload = {
			brandId,
			count: rows.length,
			prompts: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
		};
		return textResult(
			`"${brand.name}" tiene ${rows.length} prompts${enabledOnly ? " habilitados" : ""} (se devuelven hasta ${limit}).`,
			payload,
		);
	},
};

const listCompetitors: McpTool = {
	name: "list_competitors",
	title: "Listar los competidores",
	description:
		"Lista los competidores configurados de una marca, con sus dominios y alias. Es el set que define contra quién se calcula el share of voice y qué marcas se reconocen en las menciones; si falta uno, su voz no aparece en ninguna lectura.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántos competidores devolver (por defecto 100).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: MAX_LIMIT });
		const rows = await db
			.select({
				id: competitors.id,
				name: competitors.name,
				domains: competitors.domains,
				aliases: competitors.aliases,
				createdAt: competitors.createdAt,
			})
			.from(competitors)
			.where(eq(competitors.brandId, brandId))
			.orderBy(competitors.name)
			.limit(limit);
		const payload = {
			brandId,
			count: rows.length,
			competitors: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
		};
		return textResult(`"${brand.name}" tiene ${rows.length} competidores configurados.`, payload);
	},
};

const getVisibility: McpTool = {
	name: "get_visibility",
	title: "Leer la visibilidad en motores de IA",
	description:
		"Resume las menciones de una marca en las respuestas de los motores de IA: cuántas corridas hubo, en cuántas se nombró a la marca y la tasa de mención, con el desglose por modelo y por prompt. Es la lectura base de visibilidad; para comparar contra competidores está get_share_of_voice. Aclaración honesta: una corrida sin mención no significa que el modelo no conozca la marca, sólo que no la nombró en esa respuesta.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			sinceDays: {
				type: "integer",
				minimum: 1,
				maximum: MAX_DAYS,
				description: "Ventana hacia atrás en días (por defecto 30).",
			},
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántos prompts devolver en el detalle (por defecto 50).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const sinceDays = optionalInteger(args, "sinceDays", { min: 1, max: MAX_DAYS, fallback: 30 });
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 50 });
		const since = sinceFrom(sinceDays);
		const window = and(eq(promptRuns.brandId, brandId), gte(promptRuns.createdAt, since));

		const [totals] = await db
			.select({
				runs: count(),
				mentions: sql<number>`sum(case when ${promptRuns.brandMentioned} then 1 else 0 end)`,
				webSearchRuns: sql<number>`sum(case when ${promptRuns.webSearchEnabled} then 1 else 0 end)`,
			})
			.from(promptRuns)
			.where(window);

		const byModel = await db
			.select({
				model: promptRuns.model,
				runs: count(),
				mentions: sql<number>`sum(case when ${promptRuns.brandMentioned} then 1 else 0 end)`,
				webSearchRuns: sql<number>`sum(case when ${promptRuns.webSearchEnabled} then 1 else 0 end)`,
			})
			.from(promptRuns)
			.where(window)
			.groupBy(promptRuns.model)
			.orderBy(desc(count()));

		const byPrompt = await db
			.select({
				promptId: promptRuns.promptId,
				value: prompts.value,
				runs: count(),
				mentions: sql<number>`sum(case when ${promptRuns.brandMentioned} then 1 else 0 end)`,
			})
			.from(promptRuns)
			.innerJoin(prompts, eq(prompts.id, promptRuns.promptId))
			.where(window)
			.groupBy(promptRuns.promptId, prompts.value)
			.orderBy(desc(count()))
			.limit(limit);

		const totalRuns = toNumber(totals?.runs);
		const totalMentions = toNumber(totals?.mentions);
		const payload = {
			brandId,
			sinceDays,
			totals: {
				runs: totalRuns,
				mentions: totalMentions,
				mentionRate: rate(totalMentions, totalRuns),
				runsWithWebSearch: toNumber(totals?.webSearchRuns),
			},
			byModel: byModel.map((row) => ({
				model: row.model,
				runs: toNumber(row.runs),
				mentions: toNumber(row.mentions),
				mentionRate: rate(toNumber(row.mentions), toNumber(row.runs)),
				runsWithWebSearch: toNumber(row.webSearchRuns),
			})),
			byPrompt: byPrompt.map((row) => ({
				promptId: row.promptId,
				prompt: row.value,
				runs: toNumber(row.runs),
				mentions: toNumber(row.mentions),
				mentionRate: rate(toNumber(row.mentions), toNumber(row.runs)),
			})),
			promptsTruncated: byPrompt.length === limit,
		};
		return textResult(
			`En los últimos ${sinceDays} días, "${brand.name}" se nombró en ${totalMentions} de ${totalRuns} corridas (tasa ${payload.totals.mentionRate}). El detalle por modelo y por prompt va en structuredContent.`,
			payload,
		);
	},
};

const getShareOfVoice: McpTool = {
	name: "get_share_of_voice",
	title: "Leer el share of voice",
	description:
		"Compara cuánto se nombra a la marca contra sus competidores en las respuestas de los modelos, agregando `brandMentioned` y los competidores mencionados en cada corrida. Devuelve el ranking con menciones y porcentaje. IMPORTANTE: el resultado depende del set de competidores configurado para la marca —una marca que no está en la lista no aparece, y sacarla o agregarla mueve los porcentajes de todos—. Usalo para responder '¿quién domina las respuestas en esta categoría?'.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			sinceDays: {
				type: "integer",
				minimum: 1,
				maximum: MAX_DAYS,
				description: "Ventana hacia atrás en días (por defecto 30).",
			},
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántas marcas devolver en el ranking (por defecto 25).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const sinceDays = optionalInteger(args, "sinceDays", { min: 1, max: MAX_DAYS, fallback: 30 });
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 25 });
		const since = sinceFrom(sinceDays);

		const [rows, configured] = await Promise.all([
			db
				.select({ brandMentioned: promptRuns.brandMentioned, competitorsMentioned: promptRuns.competitorsMentioned })
				.from(promptRuns)
				.where(and(eq(promptRuns.brandId, brandId), gte(promptRuns.createdAt, since))),
			db.select({ name: competitors.name }).from(competitors).where(eq(competitors.brandId, brandId)),
		]);

		let brandMentions = 0;
		const counts = new Map<string, number>();
		for (const competitor of configured) counts.set(competitor.name, 0);
		for (const row of rows) {
			if (row.brandMentioned) brandMentions += 1;
			for (const name of readCompetitorNames(row.competitorsMentioned)) {
				counts.set(name, (counts.get(name) ?? 0) + 1);
			}
		}

		const competitorMentions = [...counts.values()].reduce((sum, value) => sum + value, 0);
		const totalMentions = brandMentions + competitorMentions;
		const ranking = [
			{ name: brand.name, mentions: brandMentions, isBrand: true },
			...[...counts.entries()].map(([name, mentions]) => ({ name, mentions, isBrand: false })),
		]
			.filter((entry) => entry.mentions > 0 || entry.isBrand)
			.map((entry) => ({
				...entry,
				sharePct: totalMentions === 0 ? 0 : Math.round((entry.mentions / totalMentions) * 1000) / 10,
			}))
			.sort((a, b) => (a.mentions === b.mentions ? a.name.localeCompare(b.name) : b.mentions - a.mentions))
			.slice(0, limit);

		const payload = {
			brandId,
			sinceDays,
			runs: rows.length,
			brandMentions,
			mentionRate: rate(brandMentions, rows.length),
			totalMentions,
			configuredCompetitors: configured.length,
			ranking,
			note: "El share of voice depende del set de competidores configurado: sólo se cuentan las marcas de esa lista más las que el modelo nombró y se pudieron leer.",
		};
		return textResult(
			`Sobre ${rows.length} corridas, "${brand.name}" acumula ${brandMentions} menciones de ${totalMentions} totales. El ranking depende del set de competidores configurado (${configured.length}).`,
			payload,
		);
	},
};

const listCitations: McpTool = {
	name: "list_citations",
	title: "Listar las fuentes citadas",
	description:
		"Lista las fuentes que los modelos citaron al responder los prompts de una marca: dominio, URL, título y modelo, con filtros por modelo y por dominio. Devuelve las citas más recientes (acotadas) y el ranking de dominios más citados. No devuelve la respuesta cruda de la que salen: esa pesa cientos de KB.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			sinceDays: {
				type: "integer",
				minimum: 1,
				maximum: MAX_DAYS,
				description: "Ventana hacia atrás en días (por defecto 30).",
			},
			model: { type: "string", description: "Filtra por un modelo puntual, por ejemplo `chatgpt`." },
			domain: { type: "string", description: "Filtra por dominio o parte del dominio, por ejemplo `wikipedia.org`." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántas citas devolver (por defecto 100).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const sinceDays = optionalInteger(args, "sinceDays", { min: 1, max: MAX_DAYS, fallback: 30 });
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: MAX_LIMIT });
		const model = optionalString(args, "model");
		const domain = optionalString(args, "domain");
		const since = sinceFrom(sinceDays);

		const conditions = [eq(citations.brandId, brandId), gte(citations.createdAt, since)];
		if (model !== undefined) conditions.push(eq(citations.model, model));
		if (domain !== undefined) conditions.push(ilike(citations.domain, `%${domain}%`));
		const where = and(...conditions);

		const [totals, rows, topDomains] = await Promise.all([
			db.select({ total: count() }).from(citations).where(where),
			db
				.select({
					domain: citations.domain,
					url: citations.url,
					title: citations.title,
					model: citations.model,
					createdAt: citations.createdAt,
				})
				.from(citations)
				.where(where)
				.orderBy(desc(citations.createdAt))
				.limit(limit),
			db
				.select({ domain: citations.domain, mentions: count() })
				.from(citations)
				.where(where)
				.groupBy(citations.domain)
				.orderBy(desc(count()))
				.limit(15),
		]);

		const total = toNumber(totals[0]?.total);
		const payload = {
			brandId,
			sinceDays,
			total,
			returned: rows.length,
			truncated: total > rows.length,
			filters: { model: model ?? null, domain: domain ?? null },
			citations: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
			topDomains: topDomains.map((row) => ({ domain: row.domain, mentions: toNumber(row.mentions) })),
		};
		return textResult(
			`"${brand.name}": ${total} citas en ${sinceDays} días${model === undefined ? "" : ` para ${model}`}${domain === undefined ? "" : ` en dominios que contienen "${domain}"`}. Se devuelven las ${rows.length} más recientes${total > rows.length ? " (recortado)" : ""}.`,
			payload,
		);
	},
};

const getQueryFanout: McpTool = {
	name: "get_query_fanout",
	title: "Leer las búsquedas que disparan los prompts",
	description:
		"Devuelve las búsquedas web que los motores ejecutan por dentro cuando responden un prompt (el fan-out): las consultas más frecuentes y, si pasás `promptId`, las de ese prompt puntual. Sirve para ver por qué superficies busca el modelo. Ojo: los motores que no exponen sus búsquedas aportan corridas sin consultas, así que un total bajo puede significar cobertura, no ausencia.",
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			promptId: {
				type: "string",
				description: "UUID de un prompt puntual (ver list_prompts) para acotar el fan-out.",
			},
			sinceDays: {
				type: "integer",
				minimum: 1,
				maximum: MAX_DAYS,
				description: "Ventana hacia atrás en días (por defecto 30).",
			},
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántas consultas devolver (por defecto 50).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const promptId = optionalUuid(args, "promptId");
		const sinceDays = optionalInteger(args, "sinceDays", { min: 1, max: MAX_DAYS, fallback: 30 });
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 50 });
		const since = sinceFrom(sinceDays);

		let scopedPrompt: { id: string; value: string } | null = null;
		if (promptId !== undefined) {
			const [row] = await db
				.select({ id: prompts.id, value: prompts.value })
				.from(prompts)
				.where(and(eq(prompts.id, promptId), eq(prompts.brandId, brandId)))
				.limit(1);
			if (row === undefined) {
				throw new ToolInputError(`El prompt ${promptId} no pertenece a la marca "${brandId}".`);
			}
			scopedPrompt = row;
		}

		const conditions = [eq(promptRuns.brandId, brandId), gte(promptRuns.createdAt, since)];
		if (promptId !== undefined) conditions.push(eq(promptRuns.promptId, promptId));

		const rows = await db
			.select({ promptId: promptRuns.promptId, webQueries: promptRuns.webQueries })
			.from(promptRuns)
			.where(and(...conditions));

		const counts = new Map<string, number>();
		const perPrompt = new Map<string, { runs: number; withQueries: number; queries: Map<string, number> }>();
		let runsWithQueries = 0;
		let totalQueries = 0;
		for (const row of rows) {
			const queries = Array.isArray(row.webQueries) ? row.webQueries.filter((query) => query.trim().length > 0) : [];
			if (queries.length > 0) runsWithQueries += 1;
			totalQueries += queries.length;
			const bucket = perPrompt.get(row.promptId) ?? { runs: 0, withQueries: 0, queries: new Map<string, number>() };
			bucket.runs += 1;
			if (queries.length > 0) bucket.withQueries += 1;
			for (const query of queries) {
				counts.set(query, (counts.get(query) ?? 0) + 1);
				bucket.queries.set(query, (bucket.queries.get(query) ?? 0) + 1);
			}
			perPrompt.set(row.promptId, bucket);
		}

		const promptValues =
			promptId === undefined
				? await db.select({ id: prompts.id, value: prompts.value }).from(prompts).where(eq(prompts.brandId, brandId))
				: [];
		const valueById = new Map(promptValues.map((row) => [row.id, row.value]));

		const payload = {
			brandId,
			sinceDays,
			prompt: scopedPrompt,
			runs: rows.length,
			runsWithQueries,
			coverageRate: rate(runsWithQueries, rows.length),
			totalQueries,
			uniqueQueries: counts.size,
			topQueries: rankCounts(counts, limit),
			byPrompt: [...perPrompt.entries()]
				.map(([id, bucket]) => ({
					promptId: id,
					prompt: valueById.get(id) ?? null,
					runs: bucket.runs,
					runsWithQueries: bucket.withQueries,
					uniqueQueries: bucket.queries.size,
					topQuery: rankCounts(bucket.queries, 1)[0] ?? null,
				}))
				.sort((a, b) => b.uniqueQueries - a.uniqueQueries)
				.slice(0, limit),
		};
		return textResult(
			scopedPrompt === null
				? `"${brand.name}": ${counts.size} consultas únicas en ${rows.length} corridas (${runsWithQueries} trajeron búsquedas).`
				: `Prompt "${scopedPrompt.value}": ${counts.size} consultas únicas en ${rows.length} corridas (${runsWithQueries} trajeron búsquedas).`,
			payload,
		);
	},
};

/** La forma mínima del informe de oportunidades que se publica. El resto se queda en la base. */
interface StoredOpportunity {
	category?: unknown;
	title?: unknown;
	why?: unknown;
	relatedPrompts?: unknown;
	yourCitations?: unknown;
	competitorCitations?: unknown;
}
interface StoredOpportunitiesReport {
	summary?: unknown;
	risks?: unknown;
	opportunities?: unknown;
}

const MAX_OPPORTUNITIES = 20;

function countArray(value: unknown): number {
	return Array.isArray(value) ? value.length : 0;
}

const getOpportunities: McpTool = {
	name: "get_opportunities",
	title: "Leer el informe de oportunidades",
	description:
		"Devuelve el último informe de oportunidades generado para una marca: el resumen, las oportunidades priorizadas por categoría con su porqué, y los riesgos. Es un documento fechado que se regenera desde la pantalla de Oportunidades, no una lectura en vivo. Las citas y los prompts asociados a cada oportunidad se resumen (conteos), no se devuelven completos: el informe entero puede pesar cientos de KB.",
	inputSchema: {
		type: "object",
		properties: { brandId: { type: "string", description: "Id de la marca (ver list_brands)." } },
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const [latest] = await db
			.select({
				id: brandOpportunities.id,
				report: brandOpportunities.report,
				model: brandOpportunities.model,
				createdAt: brandOpportunities.createdAt,
			})
			.from(brandOpportunities)
			.where(eq(brandOpportunities.brandId, brandId))
			.orderBy(desc(brandOpportunities.createdAt))
			.limit(1);
		if (latest === undefined) {
			return textResult(
				`"${brand.name}" todavía no tiene un informe de oportunidades generado. Se genera desde la pantalla de Oportunidades.`,
				{ found: false, brandId },
			);
		}

		const report = (latest.report ?? {}) as StoredOpportunitiesReport;
		const rawOpportunities = Array.isArray(report.opportunities) ? (report.opportunities as StoredOpportunity[]) : [];
		const opportunities = rawOpportunities.slice(0, MAX_OPPORTUNITIES).map((entry) => {
			const why = truncateText(entry.why, 600);
			return {
				category: typeof entry.category === "string" ? entry.category : "sin categoría",
				title: typeof entry.title === "string" ? entry.title : "(sin título)",
				why: why.text,
				whyTruncated: why.truncated,
				relatedPrompts: countArray(entry.relatedPrompts),
				yourCitations: countArray(entry.yourCitations),
				competitorCitations: countArray(entry.competitorCitations),
			};
		});
		const byCategory: Record<string, number> = {};
		for (const entry of opportunities) byCategory[entry.category] = (byCategory[entry.category] ?? 0) + 1;

		const payload = {
			brandId,
			reportId: latest.id,
			generatedAt: latest.createdAt.toISOString(),
			model: latest.model,
			summary: Array.isArray(report.summary)
				? (report.summary as unknown[]).map((line) => truncateText(line, 400).text)
				: [],
			risks: Array.isArray(report.risks) ? (report.risks as unknown[]).map((line) => truncateText(line, 400).text) : [],
			opportunities,
			byCategory,
			opportunitiesTruncated: rawOpportunities.length > MAX_OPPORTUNITIES,
		};
		return textResult(
			`Informe de "${brand.name}" del ${payload.generatedAt}: ${rawOpportunities.length} oportunidades (se devuelven ${opportunities.length}) y ${payload.risks.length} riesgos.`,
			payload,
		);
	},
};

const listReports: McpTool = {
	name: "list_reports",
	title: "Listar los reportes de una marca",
	description:
		'Lista los reportes generados de una marca: id, nombre, estado, cuándo se creó y cuándo terminó. NO devuelve el `rawOutput`, que es el contenido completo del reporte y pesa cientos de KB (en la historia del repo llegó a tumbar la respuesta con un 502): para el contenido, el consumidor usa el id. La tabla heredada `reports` no guarda `brandId`, así que el vínculo se resuelve por **nombre normalizado** (minúsculas, sin espacios sobrantes) **o por host de la web**: por eso un reporte guardado como "Believe Global" aparece al listar la marca "Believe" cuando comparten la web. Límite: un reporte cuyo nombre y cuya web no coincidan con la marca sigue sin poder vincularse; no se adivina por parecido.',
	inputSchema: {
		type: "object",
		properties: {
			brandId: { type: "string", description: "Id de la marca (ver list_brands)." },
			limit: {
				type: "integer",
				minimum: 1,
				maximum: MAX_LIMIT,
				description: "Cuántos reportes devolver (por defecto 20).",
			},
		},
		required: ["brandId"],
		additionalProperties: false,
	},
	handler: async (args) => {
		const brandId = requireString(args, "brandId");
		const brand = await loadBrand(brandId);
		const limit = optionalInteger(args, "limit", { min: 1, max: MAX_LIMIT, fallback: 20 });

		// El prefiltro en SQL tiene que ser un superconjunto barato de `reportMatchesBrand`, porque el
		// nombre normalizado y el host se terminan de comparar en JS. Alcanza con: nombre normalizado
		// igual, o la web conteniendo el host (el `LIKE` puede traer de más; el JS lo descarta).
		const normalizedName = normalizeBrandName(brand.name);
		const host = hostOf(brand.website);
		const conditions: SQL[] = [];
		if (normalizedName !== null) {
			conditions.push(sql`btrim(regexp_replace(lower(${reports.brandName}), '\\s+', ' ', 'g')) = ${normalizedName}`);
		}
		if (host !== null) conditions.push(ilike(reports.brandWebsite, `%${host}%`));

		if (conditions.length === 0) {
			const payload = {
				brandId,
				count: 0,
				reports: [],
				note: "Sin `rawOutput` a propósito: es enorme. El contenido se lee por id en la app.",
			};
			return textResult(`"${brand.name}" no tiene nombre ni web usables para vincular reportes.`, payload);
		}

		const candidates = await db
			.select({
				id: reports.id,
				brandName: reports.brandName,
				brandWebsite: reports.brandWebsite,
				status: reports.status,
				createdAt: reports.createdAt,
				completedAt: reports.completedAt,
			})
			.from(reports)
			.where(or(...conditions))
			.orderBy(desc(reports.createdAt));
		const rows = candidates
			.filter((row) => reportMatchesBrand({ brandName: row.brandName, brandWebsite: row.brandWebsite }, brand))
			.slice(0, limit);
		const payload = {
			brandId,
			count: rows.length,
			reports: rows.map((row) => ({
				...row,
				createdAt: row.createdAt.toISOString(),
				completedAt: row.completedAt?.toISOString() ?? null,
			})),
			note: "Sin `rawOutput` a propósito: es enorme. El contenido se lee por id en la app.",
		};
		return textResult(
			`"${brand.name}": ${rows.length} reportes (se devuelven hasta ${limit}), sin el contenido crudo.`,
			payload,
		);
	},
};

export const platformTools: McpTool[] = [
	listPrompts,
	listCompetitors,
	getVisibility,
	getShareOfVoice,
	listCitations,
	getQueryFanout,
	getOpportunities,
	listReports,
];
