CREATE TABLE "agent_aos_audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid,
	"url" text NOT NULL,
	"score" integer,
	"band" text,
	"business_type" text,
	"standards" json,
	"probes" json,
	"requirements" json,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_brand_entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"parent_entity_id" uuid,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"website_url" text,
	"maasy_project_id" text,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_aos_audits" ADD CONSTRAINT "agent_aos_audits_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aos_audits" ADD CONSTRAINT "agent_aos_audits_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_entities" ADD CONSTRAINT "agent_brand_entities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_entities" ADD CONSTRAINT "agent_brand_entities_parent_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("parent_entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;