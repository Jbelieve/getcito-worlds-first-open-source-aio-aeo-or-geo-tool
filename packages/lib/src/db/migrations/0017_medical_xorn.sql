ALTER TABLE "agent_aos_audits" ADD COLUMN "aps_score" integer;--> statement-breakpoint
ALTER TABLE "agent_aos_audits" ADD COLUMN "aps_breakdown" json;--> statement-breakpoint
ALTER TABLE "agent_aos_audits" ADD COLUMN "scoring_version" text;