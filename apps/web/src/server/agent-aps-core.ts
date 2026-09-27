/**
 * El núcleo de una corrida APS, sin sesión de navegador.
 *
 * Existe por la misma razón que `agent-assets-core`: hay **dos** puertas al mismo trabajo —la server
 * function que usa la UI y el MCP que consumen los demás productos— y dos copias del guardián de
 * presupuesto es exactamente cómo una corrida se dispara sin control. Acá vive el guardián, la lectura
 * de la biblioteca activa y el encolado del worker; las dos puertas solo autentican y delegan.
 *
 * Acá no hay autorización. Quien llama ya se autenticó.
 */

import {
	apsBudgetConfigFromEnv,
	apsPricesFromEnv,
	GATEWAY_JUDGE_PIPELINE_VERSION,
	judgeConfigFromEnv,
	type PreparedApsRun,
	prepareApsRun,
	readGatewayBudget,
} from "@workspace/aos-aps/aps";
import {
	agentAosAudits,
	agentApsPromptLibraries,
	agentApsPrompts,
	agentApsRuns,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { getBoss } from "@/lib/boss-client";

export interface ApsRunRequestInput {
	brandId: string;
	entityId: string;
	models?: string[];
	repetitions?: number;
	/** Lo que el gateway reporta gastado en el mes. Si falta, se lee del gateway. */
	spentThisMonthUsd?: number | null;
}

export interface ApsRunContext {
	entity: { id: string; name: string; websiteUrl: string | null };
	library: { id: string; version: number } | null;
	prompts: Array<{ id: string; text: string }>;
	capacidadAccion: number | null;
	judge: { alias: string; version: string; pipelineVersion: string };
	models: string[];
}

/**
 * Todo lo que una corrida necesita, leído una vez.
 *
 * El gasto del mes **no** se adivina: si el llamador no lo pasa, se le pide al gateway, que es quien
 * conoce el consumo real de la key que BeAOS usa. Un `null` desactiva el techo mensual, así que la
 * diferencia importa.
 */
export async function loadApsRunContext(data: ApsRunRequestInput): Promise<ApsRunContext> {
	const [entity] = await db
		.select({
			id: agentBrandEntities.id,
			name: agentBrandEntities.name,
			websiteUrl: agentBrandEntities.websiteUrl,
		})
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
		.limit(1);
	if (entity === undefined) throw new Error("Entity not found");

	const [library] = await db
		.select({ id: agentApsPromptLibraries.id, version: agentApsPromptLibraries.version })
		.from(agentApsPromptLibraries)
		.where(and(eq(agentApsPromptLibraries.entityId, data.entityId), eq(agentApsPromptLibraries.status, "active")))
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);

	const prompts =
		library === undefined
			? []
			: await db
					.select({ id: agentApsPrompts.id, text: agentApsPrompts.text })
					.from(agentApsPrompts)
					.where(and(eq(agentApsPrompts.libraryId, library.id), eq(agentApsPrompts.enabled, true)));

	// The AOS audit of the same site feeds the capacidad_accion dimension.
	const [audit] = await db
		.select({ score: agentAosAudits.score })
		.from(agentAosAudits)
		.where(eq(agentAosAudits.brandId, data.brandId))
		.orderBy(desc(agentAosAudits.createdAt))
		.limit(1);

	const judgeConfig = judgeConfigFromEnv();
	const models =
		data.models ??
		(process.env.SCRAPE_TARGETS ?? "")
			.split(",")
			.map((entry) => entry.split(":")[0]?.trim() ?? "")
			.filter((model) => model.length > 0);

	return {
		entity,
		library: library ?? null,
		prompts,
		capacidadAccion: audit?.score ?? null,
		judge: {
			alias: judgeConfig?.model ?? process.env.APS_JUDGE_MODEL?.trim() ?? "believe-deep",
			version: judgeConfig?.version ?? "unpinned",
			pipelineVersion: GATEWAY_JUDGE_PIPELINE_VERSION,
		},
		models,
	};
}

async function spentThisMonth(data: ApsRunRequestInput): Promise<number | null> {
	if (data.spentThisMonthUsd !== undefined) return data.spentThisMonthUsd;
	const gatewayConfig = judgeConfigFromEnv();
	if (gatewayConfig === null) return null;
	const budget = await readGatewayBudget(gatewayConfig);
	return budget?.spend ?? null;
}

/** What the operator sees before confirming: calls and dollars, with nothing written. */
export async function estimateApsRunForBrand(data: ApsRunRequestInput) {
	const context = await loadApsRunContext(data);
	const prepared = prepareApsRun({
		entity: context.entity,
		library: context.library,
		prompts: context.prompts,
		models: context.models,
		repetitions: data.repetitions ?? 3,
		capacidadAccion: context.capacidadAccion,
		judge: context.judge,
		prices: apsPricesFromEnv(),
		budgetConfig: apsBudgetConfigFromEnv(),
		spentThisMonthUsd: await spentThisMonth(data),
	});
	return {
		status: prepared.status,
		estimate: prepared.estimate,
		reasons: prepared.reasons,
		libraryVersion: context.library?.version ?? null,
		prompts: context.prompts.length,
		models: context.models,
		capacidadAccion: context.capacidadAccion,
	};
}

export type StartApsRunResult =
	| {
			ok: true;
			runId: string;
			status: string;
			models: string[];
			plannedCalls: number;
			estimate: NonNullable<PreparedApsRun["estimate"]>;
			libraryVersion: number;
			prompts: number;
	  }
	| {
			ok: false;
			reasons: string[];
			libraryVersion: number | null;
			prompts: number;
			models: string[];
	  };

/**
 * Encola una corrida. Falla cerrada: sin biblioteca activa, sin prompts, sin precio o con el techo
 * mensual superado devuelve `ok: false` con **todos** los motivos, nunca una corrida a medias.
 */
export async function startApsRunForBrand(data: ApsRunRequestInput): Promise<StartApsRunResult> {
	const context = await loadApsRunContext(data);
	const prepared = prepareApsRun({
		entity: context.entity,
		library: context.library,
		prompts: context.prompts,
		models: context.models,
		repetitions: data.repetitions ?? 3,
		capacidadAccion: context.capacidadAccion,
		judge: context.judge,
		prices: apsPricesFromEnv(),
		budgetConfig: apsBudgetConfigFromEnv(),
		spentThisMonthUsd: await spentThisMonth(data),
	});
	if (prepared.status === "blocked" || prepared.run === null || prepared.estimate === null) {
		return {
			ok: false,
			reasons: prepared.reasons,
			libraryVersion: context.library?.version ?? null,
			prompts: context.prompts.length,
			models: context.models,
		};
	}

	const [run] = await db
		.insert(agentApsRuns)
		.values({ brandId: data.brandId, status: "planned", ...prepared.run })
		.returning({ id: agentApsRuns.id });

	const boss = await getBoss();
	await boss.send("aps-query", { runId: run.id });
	return {
		ok: true,
		runId: run.id,
		status: "planned",
		models: prepared.run.models,
		plannedCalls: prepared.run.plannedCalls,
		estimate: prepared.estimate,
		libraryVersion: context.library?.version ?? 0,
		prompts: context.prompts.length,
	};
}
