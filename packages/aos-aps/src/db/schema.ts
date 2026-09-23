import { boolean, integer, json, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { brands } from "@workspace/lib/db/schema";

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
});

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
