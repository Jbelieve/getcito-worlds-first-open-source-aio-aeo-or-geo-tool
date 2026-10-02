CREATE TABLE "prompt_run_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"prompt_id" uuid NOT NULL,
	"brand_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text,
	"run_index" integer NOT NULL,
	"cycle_date" text NOT NULL,
	"success" boolean NOT NULL,
	"error_message" text,
	"prompt_run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "prompt_run_attempts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aos_audits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_api_tokens" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aps_observations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aps_prompt_libraries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aps_prompts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_aps_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_brand_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_brand_dna_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "agent_brand_entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD COLUMN "requested_version" text;--> statement-breakpoint
ALTER TABLE "prompt_runs" ADD COLUMN "reported_model_version" text;--> statement-breakpoint
ALTER TABLE "agent_aps_observations" ADD COLUMN "model_version_reported" text;--> statement-breakpoint
ALTER TABLE "agent_aps_observations" ADD COLUMN "requested_model_version" text;--> statement-breakpoint
ALTER TABLE "prompt_run_attempts" ADD CONSTRAINT "prompt_run_attempts_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_run_attempts" ADD CONSTRAINT "prompt_run_attempts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "prompt_run_attempts_prompt_cycle_idx" ON "prompt_run_attempts" USING btree ("prompt_id","cycle_date");--> statement-breakpoint
CREATE INDEX "prompt_run_attempts_cycle_date_idx" ON "prompt_run_attempts" USING btree ("cycle_date");--> statement-breakpoint
CREATE INDEX "prompt_run_attempts_brand_id_idx" ON "prompt_run_attempts" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "prompt_run_attempts_prompt_run_id_idx" ON "prompt_run_attempts" USING btree ("prompt_run_id");