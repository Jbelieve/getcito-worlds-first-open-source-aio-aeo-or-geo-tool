CREATE TABLE "aos_public_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"company" text,
	"url" text,
	"score" integer,
	"ip_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "aos_public_leads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "aos_public_usage" (
	"bucket" text NOT NULL,
	"key_hash" text NOT NULL,
	"day" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "aos_public_usage_bucket_key_hash_day_pk" PRIMARY KEY("bucket","key_hash","day")
);
--> statement-breakpoint
ALTER TABLE "aos_public_usage" ENABLE ROW LEVEL SECURITY;