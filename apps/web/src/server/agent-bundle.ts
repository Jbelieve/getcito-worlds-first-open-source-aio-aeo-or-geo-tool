/**
 * Loads the publishable bundle for one entity. Shared by the delivery API (Maasy reads this and
 * hands it to a brand's be agent) and by the public well-known routes.
 *
 * Everything that decides what a consumer may receive lives here: the publication gate and the
 * requirement that brand.json exists. Callers turn a null into a 404; they never assemble a
 * partial bundle themselves.
 */
import { desc, eq } from "drizzle-orm";
import { db } from "@workspace/lib/db/db";
import { agentAssets, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { type AssetBundle, buildBundle } from "@workspace/aos-aps/server";

export async function loadAssetBundle(entityId: string): Promise<AssetBundle | null> {
	const entity = await db
		.select({
			id: agentBrandEntities.id,
			name: agentBrandEntities.name,
			websiteUrl: agentBrandEntities.websiteUrl,
			isPublished: agentBrandEntities.isPublished,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.id, entityId))
		.limit(1);
	const current = entity[0];
	if (current === undefined) return null;

	const rows = await db
		.select({
			path: agentAssets.path,
			type: agentAssets.type,
			content: agentAssets.content,
			createdAt: agentAssets.createdAt,
		})
		.from(agentAssets)
		.where(eq(agentAssets.entityId, entityId))
		.orderBy(desc(agentAssets.createdAt));

	return buildBundle(current, rows);
}
