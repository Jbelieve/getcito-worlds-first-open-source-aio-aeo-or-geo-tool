import { createServerFn } from "@tanstack/react-start";
import { agentAssets } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { generateAssetsForEntity, setEntityPublished } from "@/server/agent-assets-core";

/**
 * La puerta de la UI. Toda la lógica vive en `agent-assets-core`, porque el MCP de BeAOS entra por la
 * otra puerta —token de API— y necesita el mismo trabajo, no una copia.
 */
export const generateAgentAssetsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return generateAssetsForEntity(data.brandId, data.entityId);
	});

export const setAgentEntityPublishedFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			entityId: z.string().uuid(),
			published: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		return setEntityPublished(data.brandId, data.entityId, data.published);
	});

export const getAgentAssetsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		const rows = await db
			.select()
			.from(agentAssets)
			.where(and(eq(agentAssets.brandId, data.brandId), eq(agentAssets.entityId, data.entityId)))
			.orderBy(desc(agentAssets.createdAt));
		const latestByPath = new Map<string, (typeof rows)[number]>();
		for (const row of rows) {
			if (latestByPath.has(row.path) === false) latestByPath.set(row.path, row);
		}
		return [...latestByPath.values()].map((row) => ({
			id: row.id,
			path: row.path,
			type: row.type,
			content: row.content,
			hash: row.hash,
			createdAt: row.createdAt.toISOString(),
		}));
	});
