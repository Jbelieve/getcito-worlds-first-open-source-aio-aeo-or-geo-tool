CREATE TABLE "agent_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"path" text NOT NULL,
	"type" text NOT NULL,
	"content" text NOT NULL,
	"hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;