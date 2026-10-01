ALTER TABLE "provider_calls" ADD COLUMN "cost_usd" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "pricing_source" text;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "prompt_tokens" integer;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "completion_tokens" integer;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "reasoning_tokens" integer;--> statement-breakpoint
ALTER TABLE "provider_calls" ADD COLUMN "agent_aps_run_id" uuid;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "estimated_cost_usd" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "actual_measurement_usd" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "actual_judge_usd" numeric(18, 10);--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "unpriced_calls" integer;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "costed_calls" integer;--> statement-breakpoint
CREATE INDEX "provider_calls_agent_aps_run_id_idx" ON "provider_calls" USING btree ("agent_aps_run_id");