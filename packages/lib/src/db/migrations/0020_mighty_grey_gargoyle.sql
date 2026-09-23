ALTER TABLE "agent_aps_runs" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "agent_aps_runs" ADD COLUMN "partial_reason" text;--> statement-breakpoint
ALTER TABLE "agent_aps_scores" ADD COLUMN "partial" boolean DEFAULT false NOT NULL;