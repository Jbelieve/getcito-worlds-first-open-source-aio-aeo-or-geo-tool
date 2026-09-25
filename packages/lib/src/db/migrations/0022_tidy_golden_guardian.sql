CREATE TABLE "agent_brand_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"claim_id" text NOT NULL,
	"statement" text NOT NULL,
	"metric" text,
	"category" text,
	"boundary_applicable_for" text,
	"boundary_not_applicable_for" text,
	"confidence" text,
	"proof_type" text NOT NULL,
	"proof_title" text NOT NULL,
	"proof_summary" text,
	"proof_client" text,
	"verifiable_by" text,
	"confidentiality" text,
	"source_fragment" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_brand_claims" ADD CONSTRAINT "agent_brand_claims_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_brand_claims" ADD CONSTRAINT "agent_brand_claims_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_brand_claims_entity_claim_uidx" ON "agent_brand_claims" USING btree ("entity_id","claim_id");