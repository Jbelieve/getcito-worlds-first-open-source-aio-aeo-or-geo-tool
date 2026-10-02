CREATE TABLE "agent_enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code_hash" text NOT NULL,
	"prefix" text NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"label" text,
	"created_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_token_id" uuid
);
--> statement-breakpoint
ALTER TABLE "agent_enrollment_codes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_enrollment_codes" ADD CONSTRAINT "agent_enrollment_codes_used_token_id_agent_api_tokens_id_fk" FOREIGN KEY ("used_token_id") REFERENCES "public"."agent_api_tokens"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_enrollment_codes_code_hash_uidx" ON "agent_enrollment_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE INDEX "agent_enrollment_codes_brand_id_idx" ON "agent_enrollment_codes" USING btree ("brand_id");--> statement-breakpoint
CREATE POLICY "beaos_brand_isolation" ON "agent_enrollment_codes" AS PERMISSIVE FOR ALL TO public USING ("agent_enrollment_codes"."brand_id" = current_setting('beaos.brand_id', true)) WITH CHECK ("agent_enrollment_codes"."brand_id" = current_setting('beaos.brand_id', true));