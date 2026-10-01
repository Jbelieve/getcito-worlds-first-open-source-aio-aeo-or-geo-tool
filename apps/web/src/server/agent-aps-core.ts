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
	type ApsCostComparison,
	apsBudgetConfigFromEnv,
	apsPricesFromEnv,
	canRegenerateLibrary,
	compareEstimatedToActual,
	GATEWAY_JUDGE_PIPELINE_VERSION,
	type GatewayCallCost,
	type GatewayJudgeConfig,
	type GatewayLibraryInput,
	type GeneratedLibrary,
	generateLibraryWithGateway,
	isLibraryUsable,
	judgeConfigFromEnv,
	LIBRARY_LOCK_DAYS,
	libraryConfigFromEnv,
	libraryLockWindow,
	type PreparedApsRun,
	prepareApsRun,
	type ResolvedLibraryCategory,
	readGatewayBudget,
	resolveLibraryCategory,
	sumProviderCallCosts,
	validateLibrary,
} from "@workspace/aos-aps/aps";
import {
	agentAosAudits,
	agentApsPromptLibraries,
	agentApsPrompts,
	agentApsRuns,
	agentBrandDnaSnapshots,
	agentBrandEntities,
} from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands, providerCalls } from "@workspace/lib/db/schema";
import { recordProviderCall } from "@workspace/lib/providers";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
	generationFailureMessage,
	generatorInputsFromBrand,
	LIBRARY_ASKED_FOR,
	missingCategoryWarning,
} from "@/lib/aps/library-message";
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
		.values({
			brandId: data.brandId,
			status: "planned",
			...prepared.run,
			// `numeric` viaja como string en Postgres y el dominio lo maneja como número: la
			// conversión se hace acá, en el borde, y en un solo lugar. El estimado se guarda en
			// la fila de la corrida porque es la mitad que hace falta para poder comparar,
			// después, contra lo que costó de verdad.
			estimatedCostUsd: prepared.run.estimatedCostUsd === null ? null : String(prepared.run.estimatedCostUsd),
		})
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

/**
 * Estimado contra real, por corrida.
 *
 * Existe porque el estimado y el real se guardan por separado y **nadie los
 * comparaba**: el precio de `APS_PRICES` sobrevivía sin que hubiera un número que
 * lo contradijera. Acá se leen las llamadas de cada corrida y se devuelve el
 * veredicto ya resuelto, para que la pantalla y el MCP no tengan cada uno su
 * propia versión de la misma cuenta.
 *
 * Se lee de `provider_calls` y no solo de las columnas de la corrida porque las
 * columnas se escriben al cerrar cada etapa: una corrida en curso tiene llamadas
 * registradas y todavía ningún total. Leer las llamadas es lo que hace que la
 * comparación sirva **también mientras la corrida está corriendo**.
 */
export async function costComparisonForRuns(
	runs: Array<{ id: string; estimatedCostUsd: string | null }>,
): Promise<Map<string, ApsCostComparison>> {
	const result = new Map<string, ApsCostComparison>();
	if (runs.length === 0) return result;
	const rows: Array<{ agentApsRunId: string | null; kind: string; costUsd: string | null }> = await db
		.select({ agentApsRunId: providerCalls.agentApsRunId, kind: providerCalls.kind, costUsd: providerCalls.costUsd })
		.from(providerCalls)
		.where(
			inArray(
				providerCalls.agentApsRunId,
				runs.map((run) => run.id),
			),
		);

	const byRun = new Map<string, Array<{ kind: string; costUsd: number | null }>>();
	for (const row of rows) {
		if (row.agentApsRunId === null) continue;
		const parsed = row.costUsd === null ? null : Number.parseFloat(row.costUsd);
		const list = byRun.get(row.agentApsRunId) ?? [];
		list.push({ kind: row.kind, costUsd: parsed === null || Number.isFinite(parsed) === false ? null : parsed });
		byRun.set(row.agentApsRunId, list);
	}

	for (const run of runs) {
		const calls = byRun.get(run.id) ?? [];
		const costOf = (filter: (kind: string) => boolean) =>
			sumProviderCallCosts(calls.filter((call) => filter(call.kind)).map((call) => ({ costUsd: call.costUsd })));
		const estimated = run.estimatedCostUsd === null ? null : Number.parseFloat(run.estimatedCostUsd);
		result.set(
			run.id,
			compareEstimatedToActual({
				estimatedUsd: estimated === null || Number.isFinite(estimated) === false ? null : estimated,
				measurement: costOf((kind) => kind !== "aps_judge"),
				judge: costOf((kind) => kind === "aps_judge"),
			}),
		);
	}
	return result;
}

/**
 * Genera la biblioteca y registra lo que costó.
 *
 * La generación de la biblioteca **también se factura** —es una llamada al gateway
 * de hasta 32.000 tokens de salida— y hasta ahora no dejaba rastro en ningún
 * lado: no es una llamada de corrida, así que `provider_calls` no la veía y el
 * gasto desaparecía. Se registra con `kind: "run"` porque es una llamada de
 * trabajo sobre la marca (no una investigación de onboarding) y sin
 * `agent_aps_run_id`, porque pasa **antes** de que exista la corrida: la
 * biblioteca se genera una vez y se usa en muchas corridas.
 *
 * El reporte se dispara apenas llega la respuesta, incluso cuando la generación
 * falla o sale truncada: esa llamada se pagó igual y es justamente la que más
 * duele, porque no produjo nada.
 */
export async function generateLibraryRecordingCost(
	input: GatewayLibraryInput,
	config: GatewayJudgeConfig,
	brandId: string,
): Promise<GeneratedLibrary> {
	let spend: GatewayCallCost | null = null;
	const generated = await generateLibraryWithGateway(input, config, fetch, (reported) => {
		spend = reported;
	});
	if (spend !== null) {
		const reported: GatewayCallCost = spend;
		await recordProviderCall({
			provider: "gateway",
			model: config.model,
			kind: "run",
			brandId,
			promptId: null,
			agentApsRunId: null,
			success: true,
			cost: {
				costUsd: reported.costUsd,
				pricingSource: reported.pricingSource,
				...(reported.usage === undefined ? {} : { usage: reported.usage }),
			},
		});
	}
	return generated;
}

export interface EnsurePromptLibraryInput {
	brandId: string;
	entityId: string;
	/**
	 * `true` reemplaza la biblioteca activa aunque esté dentro de los 90 días: es el `supersede` que ya
	 * existe, y arranca una serie nueva. `false` respeta el bloqueo y devuelve la activa tal cual.
	 */
	force?: boolean;
	/**
	 * `true` genera aunque la marca no declare categoría.
	 *
	 * Sin este flag, una entidad sin `industry` **no gasta la llamada**: se corta con el aviso de que la
	 * biblioteca puede salir mal calibrada. Es una decisión, no una traba: generar 50 prompts mal
	 * calibrados que después se bloquean 90 días es peor que no generarlos, y el llamador que sabe lo
	 * que hace puede confirmarlo explícitamente.
	 */
	confirmMissingCategory?: boolean;
}

export interface EnsurePromptLibraryResult {
	libraryId: string;
	version: number;
	/** `false` cuando ya había una activa y no se generó nada. */
	created: boolean;
	prompts: PromptLibraryPrompt[];
	/** Candidatos que el gateway propuso y la validación descartó. */
	rejected: number;
	/** La categoría con la que se calibró esta biblioteca. `null` cuando la marca no la declara. */
	category: string | null;
}

/**
 * Un error de negocio del núcleo (falta el gateway, la biblioteca está bloqueada, el gateway no
 * devolvió nada usable). Quien llama lo traduce a la respuesta de su puerta.
 */
export class PromptLibraryError extends Error {}

/**
 * La categoría con la que se calibra la biblioteca de una entidad, con la **precedencia** resuelta por
 * `resolveLibraryCategory` (declarada en BeAOS > `industry` del DNA de Maasy > marcador).
 *
 * Acá solo se leen las dos fuentes: la declarada es la columna `brands.category` —la que el operador
 * edita en Configuración → Brand, y la única que existe cuando el cliente no está en Maasy— y la
 * heredada es el `industry` del último DNA sincronizado de la entidad. La regla de cuál gana **no se
 * decide acá**, sino en `resolveLibraryCategory`, porque la puerta de la UI y la del MCP tienen que
 * resolver igual.
 *
 * `source: "placeholder"` es información, no un valor: significa que la marca no declara categoría por
 * ninguna vía y quien llama **tiene que decir que falta**, porque una biblioteca calibrada con una
 * categoría falsa sale genérica y se bloquea 90 días.
 */
export async function libraryCategoryForEntity(brandId: string, entityId: string): Promise<ResolvedLibraryCategory> {
	const [brand] = await db.select({ category: brands.category }).from(brands).where(eq(brands.id, brandId)).limit(1);
	const [snapshot] = await db
		.select({ payload: agentBrandDnaSnapshots.payload })
		.from(agentBrandDnaSnapshots)
		.where(and(eq(agentBrandDnaSnapshots.entityId, entityId), eq(agentBrandDnaSnapshots.brandId, brandId)))
		.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
		.limit(1);
	return resolveLibraryCategory({
		declared: brand?.category,
		dna: snapshot?.payload as Record<string, unknown> | undefined,
	});
}

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
			// No se genera nada: no hay categoría que informar. La de la biblioteca activa no se guardó
			// en su momento, así que decir otra cosa sería afirmar algo que no se puede comprobar.
			category: null,
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

	// La categoría con la que se calibra la biblioteca, **antes** de gastar la llamada: sale de la
	// precedencia declarada > DNA > marcador. Sin categoría, 50 prompts genéricos se bloquean 90 días y
	// pasan a ser el instrumento de todas las mediciones, así que se corta acá y se dice qué falta —y
	// dónde declararla— en vez de generar y avisar después. Quien sabe lo que hace lo confirma con
	// `confirmMissingCategory`.
	const resolved = await libraryCategoryForEntity(data.brandId, data.entityId);
	const category = resolved.category;
	if (resolved.source === "placeholder" && data.confirmMissingCategory !== true) {
		throw new PromptLibraryError(missingCategoryWarning(brand.name));
	}

	const brief = [
		brand.shortDescription,
		(brand.productsAndServices ?? []).join(", "),
		(brand.keywords ?? []).join(", "),
	]
		.filter((part): part is string => typeof part === "string" && part.length > 0)
		.join(" | ");
	const generated = await generateLibraryRecordingCost(
		{ brandName: brand.name, industry: category, brief: brief.length > 0 ? brief : null },
		config,
		data.brandId,
	);
	if (isLibraryUsable(generated) === false) {
		// La causa concreta, no un genérico: el consumidor de esta puerta es otro agente y un
		// "no devolvió una biblioteca usable" lo manda a buscar el problema donde no está.
		throw new PromptLibraryError(
			generationFailureMessage(
				{
					returned: generated.prompts.length + generated.rejected.length,
					usable: generated.prompts.length,
					rejected: generated.rejected,
					askedFor: LIBRARY_ASKED_FOR,
					failure: generated.failure,
				},
				generatorInputsFromBrand(brand, category, resolved.source),
			),
		);
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
		category,
	};
}
