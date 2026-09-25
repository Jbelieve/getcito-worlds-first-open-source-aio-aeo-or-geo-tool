import { createServerFn } from "@tanstack/react-start";
import { buildBlueprint } from "@workspace/aos-aps/blueprint";
import { agentAssets, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";

/**
 * El plan de implementación de una entidad: todo lo que hay que hacer, lo genere BeAOS o no.
 *
 * Es de solo lectura y no inventa estados: las rutas de los assets salen de lo que la entidad tiene
 * generado de verdad (la última versión por `path`, igual que la pantalla de assets), y lo que se hace en
 * el servidor del cliente o fuera del sitio queda "por-verificar", porque saberlo exige medir el sitio
 * desde afuera. El catálogo y las reglas de estado viven en `@workspace/aos-aps/blueprint`, para que el
 * MCP propio y la UI no tengan dos copias del plan.
 */
export const getBlueprintFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const rows = await db
			.select({ path: agentAssets.path, createdAt: agentAssets.createdAt })
			.from(agentAssets)
			.where(and(eq(agentAssets.brandId, data.brandId), eq(agentAssets.entityId, data.entityId)))
			.orderBy(desc(agentAssets.createdAt));

		// La última versión por ruta es lo que existe hoy: una ruta regenerada no cuenta dos veces.
		const latestByPath = new Map<string, (typeof rows)[number]>();
		for (const row of rows) {
			if (latestByPath.has(row.path) === false) latestByPath.set(row.path, row);
		}
		const assetPaths = [...latestByPath.keys()];

		const entityRows = await db
			.select({ isPublished: agentBrandEntities.isPublished, publishedAt: agentBrandEntities.publishedAt })
			.from(agentBrandEntities)
			.where(and(eq(agentBrandEntities.brandId, data.brandId), eq(agentBrandEntities.id, data.entityId)))
			.limit(1);
		const entity = entityRows[0];

		return {
			items: buildBlueprint({ assetPaths }),
			published: entity?.isPublished ?? false,
			publishedAt: entity?.publishedAt?.toISOString() ?? null,
		};
	});
