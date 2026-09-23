import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentAosAudits } from "@workspace/aos-aps/db/schema";
import type { RequirementResult, StandardsResult } from "@workspace/aos-aps/aos";
import type { ApsBreakdown } from "@workspace/aos-aps/preference";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { getBoss } from "@/lib/boss-client";

export const startAosAuditFn = createServerFn({ method: "POST" })
.validator(
z.object({
brandId: z.string().min(1),
url: z.string().url(),
entityId: z.string().uuid().optional(),
}),
)
.handler(async ({ data }) => {
const session = await requireAuthSession();
await requireOrgAccess(session.user.id, data.brandId);
const boss = await getBoss();
await boss.send("aos-audit", data);
return { ok: true };
});

export const getAosAuditsFn = createServerFn({ method: "POST" })
.validator(z.object({ brandId: z.string().min(1) }))
.handler(async ({ data }) => {
const session = await requireAuthSession();
await requireOrgAccess(session.user.id, data.brandId);
const rows = await db
.select()
.from(agentAosAudits)
.where(eq(agentAosAudits.brandId, data.brandId))
.orderBy(desc(agentAosAudits.createdAt))
.limit(10);
return rows.map((row) => ({
id: row.id,
brandId: row.brandId,
entityId: row.entityId,
url: row.url,
score: row.score,
band: row.band,
businessType: row.businessType,
standards: row.standards as StandardsResult | null,
probes: row.probes as Record<string, boolean> | null,
requirements: row.requirements as RequirementResult[] | null,
apsScore: row.apsScore,
apsBreakdown: row.apsBreakdown as ApsBreakdown | null,
scoringVersion: row.scoringVersion,
error: row.error,
createdAt: row.createdAt.toISOString(),
}));
});
