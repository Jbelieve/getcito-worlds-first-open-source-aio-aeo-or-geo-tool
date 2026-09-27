/**
 * La sincronización del Brand DNA, sin sesión de navegador.
 *
 * Compartida entre la server function de la UI y el MCP por la misma razón que el resto de los núcleos:
 * una sola lectura del proyecto de Maasy y una sola escritura del snapshot. `hasClaims` se calcula acá
 * y no en cada puerta porque es el dato que dice si el DNA trazó afirmaciones verificables —hoy Maasy no
 * las manda, y decirlo es más útil que devolver un objeto vacío como si las hubiera traído—.
 */

import { createHash } from "node:crypto";
import { agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { getMaasyBrandContext } from "@workspace/aos-aps/maasy";
import { db } from "@workspace/lib/db/db";
import { and, eq } from "drizzle-orm";

export interface DnaSyncResult {
	hash: string;
	syncedAt: Date;
	/** Si el DNA trajo `claims`. Hoy Maasy no los manda: `false` es la respuesta honesta, no un error. */
	hasClaims: boolean;
	maasyProjectId: string;
}

/** Lee el contexto de Maasy de una entidad y guarda el snapshot. `projectId` se resuelve de la entidad si falta. */
export async function syncAgentDnaForEntity(
	brandId: string,
	entityId: string,
	projectId?: string,
): Promise<DnaSyncResult> {
	const [entity] = await db
		.select({ id: agentBrandEntities.id, maasyProjectId: agentBrandEntities.maasyProjectId })
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
		.limit(1);
	if (entity === undefined) throw new Error("Entity not found");

	const resolved = (projectId ?? entity.maasyProjectId ?? "").trim();
	if (resolved.length === 0) {
		throw new Error(
			`La entidad ${entityId} no tiene un proyecto de Maasy vinculado. Vincularlo primero (linkMaasyProject / ensure_entity con maasyProjectId) es lo que habilita el DNA.`,
		);
	}

	const payload = await getMaasyBrandContext(resolved);
	const serialized = JSON.stringify(payload);
	const hash = createHash("sha256").update(serialized).digest("hex");
	const [snapshot] = await db
		.insert(agentBrandDnaSnapshots)
		.values({ brandId, entityId, maasyProjectId: resolved, payload, hash })
		.returning({ syncedAt: agentBrandDnaSnapshots.syncedAt });

	const claims = (payload as Record<string, unknown>).claims;
	return {
		hash,
		syncedAt: snapshot.syncedAt,
		hasClaims: Array.isArray(claims) && claims.length > 0,
		maasyProjectId: resolved,
	};
}
