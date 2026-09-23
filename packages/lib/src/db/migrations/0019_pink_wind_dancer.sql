CREATE TABLE "agent_aps_observations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"prompt_id" uuid NOT NULL,
	"model" text NOT NULL,
	"run_index" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"full_response" text,
	"appeared" boolean,
	"recommended" boolean,
	"position" integer,
	"sentiment_0_100" integer,
	"grounded" boolean,
	"source_verified" boolean,
	"injection_flags" json,
	"competitors_mentioned" json,
	"judge_model_alias" text,
	"judge_model_version" text,
	"analyzed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_aps_prompt_libraries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"unlocks_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_aps_prompts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"library_id" uuid NOT NULL,
	"text" text NOT NULL,
	"kind" text NOT NULL,
	"funnel_stage" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_aps_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"brand_id" text NOT NULL,
	"entity_id" uuid NOT NULL,
	"library_id" uuid NOT NULL,
	"status" text DEFAULT 'planned' NOT NULL,
	"models" text[] NOT NULL,
	"requested_repetitions" integer NOT NULL,
	"effective_repetitions" integer NOT NULL,
	"repetitions_reduced" boolean DEFAULT false NOT NULL,
	"planned_calls" integer NOT NULL,
	"completed_calls" integer DEFAULT 0 NOT NULL,
	"capacidad_accion" integer,
	"estimation" json,
	"budget_reasons" json,
	"scoring_version" text NOT NULL,
	"measurement_version" text NOT NULL,
	"judge_model_alias" text NOT NULL,
	"judge_model_version" text NOT NULL,
	"judge_pipeline_version" text NOT NULL,
	"prompt_library_version" integer NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_aps_scores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"model" text NOT NULL,
	"aps" integer NOT NULL,
	"band" text NOT NULL,
	"sub_metrics" json NOT NULL,
	"dimensions" json NOT NULL,
	"p10" integer,
	"p50" integer,
	"p90" integer,
	"recommendation_probability" integer,
	"observations" integer NOT NULL,
	"scoring_version" text NOT NULL,
	"measurement_version" text NOT NULL,
	"judge_model_alias" text NOT NULL,
	"judge_model_version" text NOT NULL,
	"prompt_library_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_aps_observations" ADD CONSTRAINT "agent_aps_observations_run_id_agent_aps_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_aps_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_observations" ADD CONSTRAINT "agent_aps_observations_prompt_id_agent_aps_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."agent_aps_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_prompt_libraries" ADD CONSTRAINT "agent_aps_prompt_libraries_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_prompt_libraries" ADD CONSTRAINT "agent_aps_prompt_libraries_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_prompts" ADD CONSTRAINT "agent_aps_prompts_library_id_agent_aps_prompt_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."agent_aps_prompt_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD CONSTRAINT "agent_aps_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD CONSTRAINT "agent_aps_runs_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD CONSTRAINT "agent_aps_runs_library_id_agent_aps_prompt_libraries_id_fk" FOREIGN KEY ("library_id") REFERENCES "public"."agent_aps_prompt_libraries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_scores" ADD CONSTRAINT "agent_aps_scores_run_id_agent_aps_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_aps_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_aps_scores" ADD CONSTRAINT "agent_aps_scores_entity_id_agent_brand_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."agent_brand_entities"("id") ON DELETE cascade ON UPDATE no action;