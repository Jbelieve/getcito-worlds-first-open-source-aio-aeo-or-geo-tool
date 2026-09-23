/**
 * aps-prompt-library — APS Fase 4 wired to the database.
 *
 * Persists a validated library and locks it. The generation call itself is a thin gateway call on
 * top; this handler owns the part that must not be wrong: the unaided validation and the 90 day lock,
 * because a prompt that changes mid-series makes every comparison invalid.
 */
import type { Job } from "pg-boss";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { agentApsPromptLibraries, agentApsPrompts } from "@workspace/aos-aps/db/schema";
import {
	type FunnelStage,
	LIBRARY_LOCK_DAYS,
	type LibraryPromptInput,
	type PromptKind,
	canRegenerateLibrary,
	libraryLockWindow,
	validateLibrary,
} from "@workspace/aos-aps/aps";

export interface ApsPromptLibraryData {
	brandId: string;
	entityId: string;
	/** Candidate prompts, validated before anything is persisted. */
	prompts: Array<{ text: string; kind: PromptKind; funnelStage: FunnelStage }>;
	supersede?: boolean;
}

export interface ApsPromptLibraryResult {
	ok: boolean;
	libraryId?: string;
	version?: number;
	accepted?: number;
	rejected?: number;
	reasons?: string[];
}

export async function apsPromptLibraryJob(jobs: Job<ApsPromptLibraryData>[]): Promise<ApsPromptLibraryResult> {
	const [job] = jobs;
	if (job === undefined) throw new Error("aps-prompt-library handler received an empty batch");
	const { brandId, entityId, prompts, supersede } = job.data;

	const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
	if (brand === undefined) throw new Error(`Brand "${brandId}" not found`);

	const [current] = await db
		.select()
		.from(agentApsPromptLibraries)
		.where(eq(agentApsPromptLibraries.entityId, entityId))
		.orderBy(desc(agentApsPromptLibraries.version))
		.limit(1);

	const nextVersion = (current?.version ?? 0) + 1;
	if (current !== undefined) {
		const verdict = canRegenerateLibrary(
			{ unlocksAt: current.unlocksAt.toISOString() },
			new Date(),
			supersede === true,
		);
		if (verdict.allowed === false) {
			console.log(`[aps-prompt-library] refused for ${entityId}: ${verdict.reason}`);
			return { ok: false, reasons: [verdict.reason] };
		}
	}

	const terms = [brand.name, ...(brand.aliases ?? [])];
	const validation = validateLibrary(prompts as LibraryPromptInput[], terms);
	if (validation.accepted.length === 0) {
		const reasons = validation.rejected.map((entry) => `${entry.reason}: ${entry.text.slice(0, 60)}`);
		console.error(`[aps-prompt-library] no usable prompt for ${entityId}`);
		return { ok: false, reasons };
	}

	const lock = libraryLockWindow(new Date(), LIBRARY_LOCK_DAYS);
	const [library] = await db
		.insert(agentApsPromptLibraries)
		.values({
			brandId,
			entityId,
			version: nextVersion,
			status: "active",
			lockedAt: new Date(lock.lockedAt),
			unlocksAt: new Date(lock.unlocksAt),
		})
		.returning({ id: agentApsPromptLibraries.id });

	if (current !== undefined) {
		await db
			.update(agentApsPromptLibraries)
			.set({ status: "superseded" })
			.where(eq(agentApsPromptLibraries.id, current.id));
	}

	await db.insert(agentApsPrompts).values(
		validation.accepted.map((prompt) => ({
			libraryId: library.id,
			text: prompt.text,
			kind: prompt.kind,
			funnelStage: prompt.funnelStage,
		})),
	);

	console.log(
		`[aps-prompt-library] ${entityId} v${nextVersion}: ${validation.accepted.length} prompts, ${validation.rejected.length} rejected, locked until ${lock.unlocksAt}`,
	);

	return {
		ok: true,
		libraryId: library.id,
		version: nextVersion,
		accepted: validation.accepted.length,
		rejected: validation.rejected.length,
		reasons: validation.mixWithinTolerance ? [] : ["El mix de la biblioteca esta fuera de tolerancia."],
	};
}
