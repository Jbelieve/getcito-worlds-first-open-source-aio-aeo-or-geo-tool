import { brands } from "@workspace/lib/db/schema";
import {
	type AnyPgColumn,
	boolean,
	integer,
	json,
	numeric,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";

export const agentBrandEntities = pgTable("agent_brand_entities", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	parentEntityId: uuid("parent_entity_id").references((): AnyPgColumn => agentBrandEntities.id, {
		onDelete: "cascade",
	}),
	entityType: text("entity_type").$type<"umbrella" | "product">().notNull(),
	name: text("name").notNull(),
	websiteUrl: text("website_url"),
	maasyProjectId: text("maasy_project_id"),
	isPrimary: boolean("is_primary").default(false).notNull(),
	/**
	 * Publication gate. Nothing is served or handed to a delivery agent until an operator
	 * publishes the entity explicitly: closed by default, so a half-configured profile (or one
	 * signed with a wrong key) never reaches an agent.
	 */
	isPublished: boolean("is_published").default(false).notNull(),
	publishedAt: timestamp("published_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true })
		.defaultNow()
		.$onUpdate(() => new Date())
		.notNull(),
}).enableRLS();

export const agentAosAudits = pgTable("agent_aos_audits", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id").references(() => agentBrandEntities.id, { onDelete: "cascade" }),
	url: text("url").notNull(),
	score: integer("score"),
	band: text("band"),
	businessType: text("business_type"),
	standards: json("standards"),
	probes: json("probes"),
	requirements: json("requirements"),
	/** Spec APS from the served Claims & Proofs layer. Null when no usable brand.json was served. */
	apsScore: integer("aps_score"),
	apsBreakdown: json("aps_breakdown"),
	/** Scoring algorithm version, so a formula change never mixes incomparable history. */
	scoringVersion: text("scoring_version"),
	error: text("error"),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const agentBrandDnaSnapshots = pgTable("agent_brand_dna_snapshots", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id")
		.references(() => agentBrandEntities.id, { onDelete: "cascade" })
		.notNull(),
	maasyProjectId: text("maasy_project_id").notNull(),
	source: text("source").default("maasy-mcp").notNull(),
	payload: json("payload").notNull(),
	hash: text("hash").notNull(),
	syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const agentAssets = pgTable("agent_assets", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id")
		.references(() => agentBrandEntities.id, { onDelete: "cascade" })
		.notNull(),
	path: text("path").notNull(),
	type: text("type").notNull(),
	content: text("content").notNull(),
	hash: text("hash").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Los claims que BeAOS **confirmó con un humano**, con la prueba que los sostiene.
 *
 * Existe por un caso real: Maasy manda la evidencia de la marca en prosa (`client_results`,
 * `testimonials`, `social_proof_count`, `references_summary`) y **no tiene** `claims` ni `proofs` en su
 * modelo, así que el bundle salía con 0 claims mientras el sitio servía 6. BeAOS no puede convertir esa
 * prosa en claims solo: *"AOS links proofs, it does not create them"*, y un dato inventado en la capa de
 * confianza es peor que su ausencia.
 *
 * Por eso esta tabla es el humano en el medio: BeAOS **muestra** el fragmento original de Maasy y el
 * operador **confirma** qué es un claim, lo redacta y dice con qué documento se prueba. El texto de
 * `sourceFragment` se guarda tal cual llegó, para que se vea qué se confirmó y no haya que confiar en
 * la memoria de nadie.
 *
 * Solo las filas `confirmed` entran al bundle: un borrador es trabajo en curso, no una declaración
 * firmada.
 */
export const agentBrandClaims = pgTable(
	"agent_brand_claims",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		brandId: text("brand_id")
			.references(() => brands.id, { onDelete: "cascade" })
			.notNull(),
		entityId: uuid("entity_id")
			.references(() => agentBrandEntities.id, { onDelete: "cascade" })
			.notNull(),
		/** El id estable que viaja al `brand.json` como `claim_id`. Lo elige el operador. */
		claimId: text("claim_id").notNull(),
		/** La afirmación, redactada por el humano. No se genera sola. */
		statement: text("statement").notNull(),
		/** El número tal como está en la evidencia (`"35%"`), sin normalizar ni completar. */
		metric: text("metric"),
		category: text("category"),
		/** Cuándo SÍ aplica el claim. */
		boundaryApplicableFor: text("boundary_applicable_for"),
		/** Cuándo NO aplica. */
		boundaryNotApplicableFor: text("boundary_not_applicable_for"),
		/**
		 * La confianza que declara el operador. Se guarda como texto y **no** se emite como
		 * `claim.confidence`: el estándar deriva la confianza del tamaño de muestra (`metric.n`) y
		 * prohíbe asignarla a mano, así que un número propio sería un dato inventado.
		 */
		confidence: text("confidence"),
		/** `case_study` | `document` | `testimonial` | `audit` | `other`. */
		proofType: text("proof_type").notNull(),
		proofTitle: text("proof_title").notNull(),
		proofSummary: text("proof_summary"),
		proofClient: text("proof_client"),
		/** Cómo lo comprueba un agente. El enum del estándar vive en `preference/types.ts`. */
		verifiableBy: text("verifiable_by"),
		confidentiality: text("confidentiality"),
		/** El texto original de Maasy que el operador confirmó. Copia literal, no un resumen. */
		sourceFragment: text("source_fragment"),
		status: text("status").$type<"draft" | "confirmed">().default("draft").notNull(),
		/**
		 * Si las sub-entidades de esta marca pueden heredar la prueba.
		 *
		 * Lo decide el operador, y es la línea que no se puede cruzar sola: una prueba de marca
		 * (metodología, antigüedad, "más de 100 proyectos") se puede heredar; un caso de cliente
		 * **no**, porque la sub-entidad estaría afirmando que hizo algo que no hizo. Por defecto
		 * `false`: heredar es una decisión explícita, nunca un descuido.
		 */
		inheritable: boolean("inheritable").default(false).notNull(),
		/**
		 * La entidad de la que salió esta fila cuando es una **copia heredada**. Null en una fila
		 * propia. Apunta a la entidad de origen para poder auditar de dónde salió una afirmación que
		 * hoy se firma en otro perfil. La herencia viva se resuelve contra el paraguas en el momento
		 * de generar (`resolveBundleClaims`); esta columna es la trazabilidad de una copia
		 * materializada, no la fuente de la regla.
		 */
		inheritedFromEntityId: uuid("inherited_from_entity_id").references(() => agentBrandEntities.id, {
			onDelete: "cascade",
		}),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.defaultNow()
			.$onUpdate(() => new Date())
			.notNull(),
	},
	(table) => [uniqueIndex("agent_brand_claims_entity_claim_uidx").on(table.entityId, table.claimId)],
).enableRLS();

/**
 * APS Fase 4 — the measuring instrument. Locked for 90 days: while a library is locked its prompts
 * must not change, because the time series is only comparable over the same prompt.
 */
export const agentApsPromptLibraries = pgTable("agent_aps_prompt_libraries", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id")
		.references(() => agentBrandEntities.id, { onDelete: "cascade" })
		.notNull(),
	version: integer("version").notNull(),
	status: text("status").$type<"active" | "superseded">().default("active").notNull(),
	lockedAt: timestamp("locked_at", { withTimezone: true }).defaultNow().notNull(),
	unlocksAt: timestamp("unlocks_at", { withTimezone: true }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

export const agentApsPrompts = pgTable("agent_aps_prompts", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	libraryId: uuid("library_id")
		.references(() => agentApsPromptLibraries.id, { onDelete: "cascade" })
		.notNull(),
	/** Unaided: validated to not name the brand before it is persisted. */
	text: text("text").notNull(),
	kind: text("kind").$type<"comparison" | "use_case" | "category">().notNull(),
	funnelStage: text("funnel_stage").$type<"awareness" | "consideration" | "decision">().notNull(),
	enabled: boolean("enabled").default(true).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * One measurement run. Versions are fixed per run, never per observation: a judge or formula change
 * starts a new comparable series instead of silently mixing history.
 */
export const agentApsRuns = pgTable("agent_aps_runs", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	brandId: text("brand_id")
		.references(() => brands.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id")
		.references(() => agentBrandEntities.id, { onDelete: "cascade" })
		.notNull(),
	libraryId: uuid("library_id")
		.references(() => agentApsPromptLibraries.id, { onDelete: "cascade" })
		.notNull(),
	status: text("status")
		.$type<"planned" | "capturing" | "parsing" | "scoring" | "done" | "failed" | "budget_exceeded">()
		.default("planned")
		.notNull(),
	models: text("models").array().notNull(),
	requestedRepetitions: integer("requested_repetitions").notNull(),
	effectiveRepetitions: integer("effective_repetitions").notNull(),
	/** A reduced run is a partial measurement and must be presented as such. */
	repetitionsReduced: boolean("repetitions_reduced").default(false).notNull(),
	/**
	 * The run scored fewer answers than it planned. The score is still useful — the calls were paid
	 * for — but it is never presented as a complete measurement.
	 */
	partial: boolean("partial").default(false).notNull(),
	partialReason: text("partial_reason"),
	plannedCalls: integer("planned_calls").notNull(),
	completedCalls: integer("completed_calls").default(0).notNull(),
	/** AOS score feeding the capacidad_accion dimension. */
	capacidadAccion: integer("capacidad_accion"),
	/**
	 * Lo que la corrida **estimó** antes de gastar, en USD. Sale de `estimateApsRun` y de los
	 * precios de `APS_PRICES`; es el número que el operador aprobó al confirmar.
	 */
	estimatedCostUsd: numeric("estimated_cost_usd", { precision: 18, scale: 10 }),
	/**
	 * Lo que la corrida **costó de verdad**, en USD: la suma de `provider_calls.cost_usd` de sus
	 * llamadas de medición. Es el número que hoy no existía en ningún lado, y por eso el precio de
	 * `APS_PRICES` sobrevivía sin que nadie lo notara.
	 *
	 * **Null cuando el costo está incompleto**, y ahí es donde está el cuidado: si alguna llamada
	 * quedó sin costo, un total parcial no se guarda como si fuera el total. El dato incompleto se
	 * declara incompleto en `unpricedCalls` en vez de mentir con un número que parece terminado.
	 */
	actualMeasurementUsd: numeric("actual_measurement_usd", { precision: 18, scale: 10 }),
	/** Costo real de las llamadas del juez (el gateway las factura y las informa). */
	actualJudgeUsd: numeric("actual_judge_usd", { precision: 18, scale: 10 }),
	/**
	 * Cuántas llamadas de la corrida quedaron **sin costo conocido**. Junto a los tres números de
	 * arriba es lo que hace legible el dato: un total sin esta cuenta no se puede distinguir de un
	 * total completo.
	 */
	unpricedCalls: integer("unpriced_calls"),
	/** Total de llamadas que la corrida efectivamente registró (medición + juez). */
	costedCalls: integer("costed_calls"),
	estimation: json("estimation"),
	budgetReasons: json("budget_reasons"),
	scoringVersion: text("scoring_version").notNull(),
	measurementVersion: text("measurement_version").notNull(),
	judgeModelAlias: text("judge_model_alias").notNull(),
	judgeModelVersion: text("judge_model_version").notNull(),
	judgePipelineVersion: text("judge_pipeline_version").notNull(),
	promptLibraryVersion: integer("prompt_library_version").notNull(),
	error: text("error"),
	startedAt: timestamp("started_at", { withTimezone: true }),
	finishedAt: timestamp("finished_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Fase 0 capture then Fase 1 analysis, kept in one row on purpose: the raw answer is stored once and
 * re-analysed in place, so a formula change never pays for the queries again.
 */
export const agentApsObservations = pgTable("agent_aps_observations", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	runId: uuid("run_id")
		.references(() => agentApsRuns.id, { onDelete: "cascade" })
		.notNull(),
	promptId: uuid("prompt_id")
		.references(() => agentApsPrompts.id, { onDelete: "cascade" })
		.notNull(),
	model: text("model").notNull(),
	/**
	 * El modelo que **contestó**, cuando el proveedor lo informa. `null` es "el
	 * proveedor no lo dijo" — y nunca se rellena con `model`, que es el **pedido**:
	 * el pedido y la respuesta son dos hechos distintos.
	 *
	 * Existe porque el invocador descartaba `result.modelVersion`
	 * (`apps/worker/src/jobs/aps-query.ts`), así que un APS por scraper afirmaba
	 * implícitamente que había contestado el modelo que pedimos, sin haberlo
	 * comprobado. Si un dataset cambia de motor por detrás, la serie histórica lo
	 * mostraba como estable.
	 *
	 * El matiz honesto: los scrapers muchas veces no lo informan (BrightData devuelve
	 * `record?.model ?? undefined`; DataForSEO solía caer al nombre pedido y afirmaba
	 * un modelo que no sabía). Donde no está, `null`.
	 */
	modelVersionReported: text("model_version_reported"),
	/** La versión del alias que se pidió, separada de la que contestó. */
	requestedModelVersion: text("requested_model_version"),
	runIndex: integer("run_index").notNull(),
	promptText: text("prompt_text").notNull(),
	fullResponse: text("full_response"),
	appeared: boolean("appeared"),
	recommended: boolean("recommended"),
	position: integer("position"),
	sentiment0to100: integer("sentiment_0_100"),
	/** Judge claim. The robustness audit corrects it against the raw text. */
	grounded: boolean("grounded"),
	/** Independent check: does the raw text carry a citable source? */
	sourceVerified: boolean("source_verified"),
	injectionFlags: json("injection_flags"),
	competitorsMentioned: json("competitors_mentioned"),
	judgeModelAlias: text("judge_model_alias"),
	judgeModelVersion: text("judge_model_version"),
	analyzedAt: timestamp("analyzed_at", { withTimezone: true }),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/** One row per model: a denominator never mixes models. */
export const agentApsScores = pgTable("agent_aps_scores", {
	id: uuid("id").defaultRandom().primaryKey().notNull(),
	runId: uuid("run_id")
		.references(() => agentApsRuns.id, { onDelete: "cascade" })
		.notNull(),
	entityId: uuid("entity_id")
		.references(() => agentBrandEntities.id, { onDelete: "cascade" })
		.notNull(),
	model: text("model").notNull(),
	aps: integer("aps").notNull(),
	band: text("band").notNull(),
	subMetrics: json("sub_metrics").notNull(),
	dimensions: json("dimensions").notNull(),
	p10: integer("p10"),
	p50: integer("p50"),
	p90: integer("p90"),
	/**
	 * The bootstrap samples behind P10/P50/P90, so the distribution can be drawn from the run that
	 * actually happened instead of re-simulating it on read.
	 */
	distribution: json("distribution"),
	recommendationProbability: integer("recommendation_probability"),
	observations: integer("observations").notNull(),
	/** This score came from a run that answered fewer prompts than it planned. */
	partial: boolean("partial").default(false).notNull(),
	scoringVersion: text("scoring_version").notNull(),
	measurementVersion: text("measurement_version").notNull(),
	judgeModelAlias: text("judge_model_alias").notNull(),
	judgeModelVersion: text("judge_model_version").notNull(),
	promptLibraryVersion: integer("prompt_library_version").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}).enableRLS();

/**
 * Credencial por producto para el MCP.
 *
 * Hasta ahora todos los consumidores compartían `ADMIN_API_KEYS`: no había identidad por producto ni
 * forma de revocarle la clave a uno solo sin cambiársela a todos. Acá vive un token **por producto**,
 * guardado como **sha256** —el token en claro no se persiste nunca— y con su `prefix` de 8 caracteres
 * para poder identificarlo en un listado sin revelarlo.
 *
 * `lastUsedAt` se actualiza cuando el token autentica, así que un token viejo se puede detectar por uso
 * y no sólo por fecha de creación. `revokedAt` no borra la fila: una revocación se audita.
 */
export const agentApiTokens = pgTable(
	"agent_api_tokens",
	{
		id: uuid("id").defaultRandom().primaryKey().notNull(),
		/** El producto dueño del token: "autex", "maasy". */
		name: text("name").notNull(),
		/** sha256 en hex del token. El token en claro nunca se guarda. */
		tokenHash: text("token_hash").notNull(),
		/** Los primeros 8 caracteres, para reconocerlo en un listado. */
		prefix: text("prefix").notNull(),
		createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
		lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
		revokedAt: timestamp("revoked_at", { withTimezone: true }),
	},
	(table) => [uniqueIndex("agent_api_tokens_token_hash_uidx").on(table.tokenHash)],
).enableRLS();

export type AgentApiToken = typeof agentApiTokens.$inferSelect;
export type NewAgentApiToken = typeof agentApiTokens.$inferInsert;

export type AgentApsPromptLibrary = typeof agentApsPromptLibraries.$inferSelect;
export type NewAgentApsPromptLibrary = typeof agentApsPromptLibraries.$inferInsert;
export type AgentApsPrompt = typeof agentApsPrompts.$inferSelect;
export type NewAgentApsPrompt = typeof agentApsPrompts.$inferInsert;
export type AgentApsRun = typeof agentApsRuns.$inferSelect;
export type NewAgentApsRun = typeof agentApsRuns.$inferInsert;
export type AgentApsObservation = typeof agentApsObservations.$inferSelect;
export type NewAgentApsObservation = typeof agentApsObservations.$inferInsert;
export type AgentApsScore = typeof agentApsScores.$inferSelect;
export type NewAgentApsScore = typeof agentApsScores.$inferInsert;

export type AgentBrandEntity = typeof agentBrandEntities.$inferSelect;
export type NewAgentBrandEntity = typeof agentBrandEntities.$inferInsert;
export type AgentAosAudit = typeof agentAosAudits.$inferSelect;
export type NewAgentAosAudit = typeof agentAosAudits.$inferInsert;
export type AgentBrandDnaSnapshot = typeof agentBrandDnaSnapshots.$inferSelect;
export type NewAgentBrandDnaSnapshot = typeof agentBrandDnaSnapshots.$inferInsert;
export type AgentAsset = typeof agentAssets.$inferSelect;
export type NewAgentAsset = typeof agentAssets.$inferInsert;
export type AgentBrandClaim = typeof agentBrandClaims.$inferSelect;
export type NewAgentBrandClaim = typeof agentBrandClaims.$inferInsert;
