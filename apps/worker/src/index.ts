import * as Sentry from "@sentry/node";
import { PROCESS_PROMPT_JOB_POLICY } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { getProvider, parseScrapeTargets, validateScrapeTargets } from "@workspace/lib/providers";
import { type SQL, sql } from "drizzle-orm";
import boss from "./boss";
import { registerHandlers } from "./handlers";
import { shutdownTelemetry } from "./telemetry";

if (process.env.SENTRY_DSN) {
	Sentry.init({
		dsn: process.env.SENTRY_DSN,
		environment: process.env.ENVIRONMENT || "development",
		tracesSampleRate: 1.0,
	});
}

async function main() {
	console.log("Starting pg-boss worker...");

	// Fail fast on misconfigured SCRAPE_TARGETS — surfaces unknown providers,
	// missing API keys, and per-provider target errors before any job runs.
	validateScrapeTargets(parseScrapeTargets(process.env.SCRAPE_TARGETS), getProvider);
	console.log("SCRAPE_TARGETS validated");

	boss.on("error", (error) => {
		console.error("pg-boss error:", error);
		Sentry.withScope((scope) => {
			scope.setTag("source", "pg-boss-internal");
			Sentry.captureException(error);
		});
	});

	// Start pg-boss (creates schema if needed)
	await boss.start();
	console.log("pg-boss started");

	// Queues are created if absent (required in pg-boss v12) and then reconciled,
	// because `createQueue` is ON CONFLICT DO NOTHING and v12's `updateQueue`
	// only covers dead-letter settings. Without the reconcile, editing anything
	// below has no effect on a database where the queue already exists: the old
	// values silently persist and the change looks applied but isn't.
	const queueOptions = [
		// Shared with the web app and the maintenance job, which enqueue the same
		// queue with per-job options that would otherwise override this.
		{ name: "process-prompt", ...PROCESS_PROMPT_JOB_POLICY },
		{
			name: "generate-report",
			retryLimit: 3,
			retryDelay: 60,
			retryBackoff: true,
			expireInSeconds: 60 * 60, // 1 hour timeout for reports
		},
		{
			name: "analyze-brand",
			retryLimit: 1,
			retryDelay: 10,
			retryBackoff: false,
			expireInSeconds: 60 * 15, // 15 minute timeout for onboarding brand analysis
		},
		{
			name: "aos-audit",
			retryLimit: 2,
			retryDelay: 30,
			retryBackoff: true,
			expireInSeconds: 60 * 5,
		},
		// APS runs are on demand and chained. aps-query fans out to real models, so it gets a long
		// timeout; the rest are database and judge work over answers that were already paid for.
		// No retries on the two paid stages: a retry would re-spend money on the same call.
		{
			name: "aps-prompt-library",
			retryLimit: 1,
			retryDelay: 30,
			retryBackoff: false,
			expireInSeconds: 60 * 5,
		},
		{
			name: "aps-query",
			retryLimit: 0,
			expireInSeconds: 60 * 60,
		},
		{
			name: "aps-parse",
			retryLimit: 0,
			expireInSeconds: 60 * 30,
		},
		{
			name: "aps-score",
			retryLimit: 1,
			retryDelay: 30,
			retryBackoff: false,
			expireInSeconds: 60 * 5,
		},
		{
			name: "schedule-maintenance",
			retryLimit: 3,
			retryDelay: 300, // 5 minutes between retries
			retryBackoff: true,
			expireInSeconds: 60 * 30, // 30 minute timeout
		},
		...(process.env.DEPLOYMENT_MODE === "whitelabel"
			? [
					{
						name: "sync-auth0-memberships",
						retryLimit: 3,
						retryDelay: 60,
						retryBackoff: true,
						expireInSeconds: 60 * 10,
					},
				]
			: []),
	];

	for (const { name, ...options } of queueOptions) {
		await boss.createQueue(name, options);
		// Only the columns actually provided are updated. Drizzle drops `undefined` parameters, so
		// writing all four would leave a dangling comma (`retry_delay = ,`) and the worker would
		// refuse to start — reachable by any queue that omits one option.
		const assignments = [
			options.retryLimit === undefined ? null : sql`retry_limit = ${options.retryLimit}`,
			options.retryDelay === undefined ? null : sql`retry_delay = ${options.retryDelay}`,
			options.retryBackoff === undefined ? null : sql`retry_backoff = ${options.retryBackoff}`,
			options.expireInSeconds === undefined ? null : sql`expire_seconds = ${options.expireInSeconds}`,
		].filter((assignment): assignment is SQL => assignment !== null);
		if (assignments.length === 0) continue;
		await db.execute(sql`
			UPDATE pgboss.queue
			SET ${sql.join(assignments, sql`, `)}
			WHERE name = ${name}
		`);
	}
	console.log("Queues created");

	await boss.schedule(
		"schedule-maintenance",
		"*/5 * * * *",
		{ source: "scheduled" },
		{ tz: "UTC" },
	);
	console.log("Scheduled maintenance job (every 5 minutes)");

	if (process.env.DEPLOYMENT_MODE === "whitelabel") {
		await boss.schedule(
			"sync-auth0-memberships",
			"*/15 * * * *",
			{ source: "scheduled" },
			{ tz: "UTC" },
		);
		console.log("Scheduled Auth0 membership sync (every 15 minutes)");
	}

	// Register job handlers
	await registerHandlers(boss);
	console.log("All handlers registered, worker is ready");
}

main().catch(async (error) => {
	Sentry.captureException(error);
	console.error("Failed to start worker:", error);
	await Sentry.flush(2000);
	process.exit(1);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
	console.log("Received SIGTERM, shutting down gracefully...");
	await boss.stop({ graceful: true, timeout: 30000 });
	await Promise.all([Sentry.flush(2000), shutdownTelemetry()]);
	console.log("Worker stopped");
	process.exit(0);
});

process.on("SIGINT", async () => {
	console.log("Received SIGINT, shutting down gracefully...");
	await boss.stop({ graceful: true, timeout: 30000 });
	await Promise.all([Sentry.flush(2000), shutdownTelemetry()]);
	console.log("Worker stopped");
	process.exit(0);
});
