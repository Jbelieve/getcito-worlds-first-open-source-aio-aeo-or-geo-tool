import type { Job } from "pg-boss";
import { runAosAudit } from "@workspace/aos-aps/aos";
import { db } from "@workspace/lib/db/db";
import { agentAosAudits } from "@workspace/aos-aps/db/schema";

export interface AosAuditData {
brandId: string;
entityId?: string;
url: string;
}

export async function aosAuditJob(jobs: Job<AosAuditData>[]): Promise<{ ok: boolean }> {
const [job] = jobs;
if (job === undefined) throw new Error("aos-audit handler received an empty batch");
const { brandId, entityId, url } = job.data;
try {
const result = await runAosAudit({ url });
await db.insert(agentAosAudits).values({
brandId,
entityId: entityId ?? null,
url: result.url,
score: result.score,
band: result.band,
businessType: result.businessType,
standards: result.standards,
probes: result.probes,
requirements: result.standards.requirements,
apsScore: result.aps?.aps ?? null,
apsBreakdown: result.aps,
scoringVersion: result.aps?.scoring_version ?? null,
});
return { ok: true };
} catch (error) {
const message = error instanceof Error ? error.message : String(error);
await db.insert(agentAosAudits).values({
brandId,
entityId: entityId ?? null,
url,
error: message,
});
console.error(`[aos-audit] ${url}: ${message}`);
return { ok: false };
}
}
