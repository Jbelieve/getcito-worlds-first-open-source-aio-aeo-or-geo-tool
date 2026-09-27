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
	canRegenerateLibrary,
	GATEWAY_JUDGE_PIPELINE_VERSION,
	generateLibraryWithGateway,
	judgeConfigFromEnv,
	LIBRARY_LOCK_DAYS,
	libraryConfigFromEnv,
	libraryLockWindow,
	type PreparedApsRun,
	prepareApsRun,
	readGatewayBudget,
	validateLibrary,
} from "@workspace/aos-aps/aps";
import {
	agentAosAudits,
	agentApsPromptLibraries,
	agentApsPrompts,
	agentApsRuns,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
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

export interface PromptLibraryPrompt {
	id: string;
	text: string;
	kind: string;
	funnelStage: string | null;
	enabled: boolean;
}

export interface EnsurePromptLibraryInput {
	brandId: string;
	entityId: string;
	/**
	 * `true` reemplaza la biblioteca activa aunque esté dentro de los 90 días: es el `supersede` que ya
	 * existe, y arranca una serie nueva. `false` respeta el bloqueo y devuelve la activa tal cual.
	 */
	force?: boolean;
}

export interface EnsurePromptLibraryResult {
	libraryId: string;
	version: number;
	/** `false` cuando ya había una activa y no se generó nada. */
	created: boolean;
	prompts: PromptLibraryPrompt[];
	/** Candidatos que el gateway propuso y la validación descartó. */
	rejected: number;
}

/**
 * Un error de negocio del núcleo (falta el gateway, la biblioteca está bloqueada, el gateway no
 * devolvió nada usable). Quien llama lo traduce a la respuesta de su puerta.
 */
export class PromptLibraryError extends Error {}

async function readLibraryPrompts(libraryId: string): Promise<PromptLibraryPrompt[]> {
	const rows = await db
		.select({
			id: agentApsPrompts.id,
			text: agentApsPrompts.text,
			kind: agentApsPrompts.kind,
			funnelStage: agentApsPrompts.funnelStage,
			enabled: agentApsPrompts.enabled,
		})
		.from(agentApsPrompts)
		.where(eq(agentApsPrompts.libraryId, libraryId));
	return rows.map((row) => ({
		id: row.id,
		text: row.text,
		kind: row.kind,
		funnelStage: row.funnelStage ?? null,
		enabled: row.enabled,
	}));
}

/**
 * Asegura la biblioteca de prompts APS de una entidad: genera y persiste una si no tiene activa.
 *
 * Es la puerta síncrona del MCP, y por eso **no encola** el job `aps-prompt-library` como la UI: el
 * consumidor pidió los prompts y hay que devolverlos con id. La persistencia es la misma secuencia que
 * hace el worker —versión siguiente, `status: superseded` para la anterior, validación de prompts que
 * nombran la marca y bloqueo de 90 días— así que las dos vías producen la misma serie comparable; no
 * hay un mecanismo paralelo. La validación y el lock salen de `@workspace/aos-aps/aps`, no de acá.
 */
export async function ensurePromptLibraryForEntity(data: EnsurePromptLibraryInput): Promise<EnsurePromptLibraryResult> {
	const [entity] = await db
		.select({ id: agentBrandEntities.id })
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
		.limit(1);
	if (entity === undefined) {
		throw new PromptLibraryError(
			`La entidad "${data.entityId}" no existe en la marca "${data.brandId}". Mirá get_brand para ver las entidades.`,
		);
	}

	const [active] = await db
		.select({ id: agentApsPromptLibraries.id, version: agentApsPromptLibraries.version })
		.from(agentApsPromptLibraries)
		.where(and(eq(agentApsPromptLibraries.entityId, data.entityId), eq(agentApsPromptLibraries.status, "active")))
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);
	if (active !== undefined && data.force !== true) {
		return {
			libraryId: active.id,
			version: active.version,
			created: false,
			prompts: await readLibraryPrompts(active.id),
			rejected: 0,
		};
	}

	const config = libraryConfigFromEnv();
	if (config === null) {
		throw new PromptLibraryError(
			"Falta LLM_GATEWAY_URL o la key del gateway: sin eso la biblioteca no se puede generar.",
		);
	}
	const [brand] = await db.select().from(brands).where(eq(brands.id, data.brandId)).limit(1);
	if (brand === undefined) {
		throw new PromptLibraryError(`No existe la marca "${data.brandId}". Creamela primero con ensure_brand.`);
	}

	const brief = [
		brand.shortDescription,
		(brand.productsAndServices ?? []).join(", "),
		(brand.keywords ?? []).join(", "),
	]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join(" | ");
	const generated = await generateLibraryWithGateway(
		{ brandName: brand.name, industry: null, brief: brief.length > 0 ? brief : null },
		config,
	);
	if (generated === null) {
		throw new PromptLibraryError("El gateway no devolvió una biblioteca usable.");
	}

	const [latest] = await db
		.select({
			id: agentApsPromptLibraries.id,
			version: agentApsPromptLibraries.version,
			unlocksAt: agentApsPromptLibraries.unlocksAt,
		})
		.from(agentApsPromptLibraries)
		.where(eq(agentApsPromptLibraries.entityId, data.entityId))
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);
	if (latest !== undefined) {
		// Mismo veredicto que el worker: sin `supersede` una biblioteca bloqueada no se toca.
		const verdict = canRegenerateLibrary(
			{ unlocksAt: latest.unlocksAt.toISOString() },
			new Date(),
			data.force === true,
		);
		if (verdict.allowed === false) throw new PromptLibraryError(verdict.reason);
	}

	const validation = validateLibrary(generated.prompts, [brand.name, ...(brand.aliases ?? [])]);
	if (validation.accepted.length === 0) {
		const reasons = validation.rejected
			.slice(0, 5)
			.map((entry) => `${entry.reason}: ${entry.text.slice(0, 60)}`)
			.join("; ");
		throw new PromptLibraryError(`El gateway no devolvió ningún prompt usable. ${reasons}`);
	}

	const nextVersion = (latest?.version ?? 0) + 1;
	const lock = libraryLockWindow(new Date(), LIBRARY_LOCK_DAYS);
	const [library] = await db
		.insert(agentApsPromptLibraries)
		.values({
			brandId: data.brandId,
			entityId: data.entityId,
			version: nextVersion,
			status: "active",
			lockedAt: new Date(lock.lockedAt),
			unlocksAt: new Date(lock.unlocksAt),
		})
		.returning({ id: agentApsPromptLibraries.id });
	if (latest !== undefined) {
		await db
			.update(agentApsPromptLibraries)
			.set({ status: "superseded" })
			.where(eq(agentApsPromptLibraries.id, latest.id));
	}

	const inserted = await db
		.insert(agentApsPrompts)
		.values(
			validation.accepted.map((prompt) => ({
				libraryId: library.id,
				text: prompt.text,
				kind: prompt.kind,
				funnelStage: prompt.funnelStage,
			})),
		)
		.returning({
			id: agentApsPrompts.id,
			text: agentApsPrompts.text,
			kind: agentApsPrompts.kind,
			funnelStage: agentApsPrompts.funnelStage,
			enabled: agentApsPrompts.enabled,
		});

	return {
		libraryId: library.id,
		version: nextVersion,
		created: true,
		prompts: inserted.map((row) => ({
			id: row.id,
			text: row.text,
			kind: row.kind,
			funnelStage: row.funnelStage ?? null,
			enabled: row.enabled,
		})),
		rejected: validation.rejected.length,
	};
}
