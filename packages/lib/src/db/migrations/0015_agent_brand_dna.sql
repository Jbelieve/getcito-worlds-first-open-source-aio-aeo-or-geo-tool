CREATE TABLE "agent_brand_dna_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"maasy_project_id" text NOT NULL,
	"source" text DEFAULT 'maasy-mcp' NOT NULL,
	"payload" json NOT NULL,
	"hash" text NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_brand_dna_snapshots" ADD CONSTRAINT "agent_brand_dna_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_dna_snapshots" ADD CONSTRAINT "agent_brand_dna_snapshots_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;