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

export type AgentBrandEntity = typeof agentBrandEntities.$inferSelect;
export type NewAgentBrandEntity = typeof agentBrandEntities.$inferInsert;
export type AgentAosAudit = typeof agentAosAudits.$inferSelect;
export type NewAgentAosAudit = typeof agentAosAudits.$inferInsert;
export type AgentBrandDnaSnapshot = typeof agentBrandDnaSnapshots.$inferSelect;
export type NewAgentBrandDnaSnapshot = typeof agentBrandDnaSnapshots.$inferInsert;
