import { createServerFn } from "@tanstack/react-start";
import { dnaCarriesClaims, proposeClaimCandidates } from "@workspace/aos-aps/claims";
import { agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { websiteSourcesForClaims } from "@/lib/claims-guard";
import { liveClaimCountFrom } from "@/server/agent-assets-core";
import {
	bundleClaimCountOf,
	ClaimEntityNotFoundError,
	ClaimInputError,
	ClaimNotFoundError,
	deleteClaim,
	inheritedClaimsOf,
	loadClaimsContext,
	type SerializedClaim,
	serializeClaim,
	setClaimInheritable,
	upsertClaim,
} from "@/server/claims-core";

/**
 * La puerta de la UI para las pruebas de la marca.
 *
 * La decisión de qué entra al bundle no vive acá: vive en `@workspace/aos-aps/claims`, que es puro y se
 * prueba sin base ni red. Esta server function solo autoriza y delega en `claims-core`, que es el mismo
 * núcleo que usa el MCP. Si la regla de precedencia estuviera escrita dos veces —una para la pantalla y
 * otra para el generador—, la pantalla podría decir que el bundle declara 6 cuando el bundle declara 0,
 * que es exactamente el error que hay que evitar. Y lo mismo vale para el formulario: las reglas de
 * `claimId`, `verifiableBy`, `status` y `proofType` viven en el núcleo, no en un validador paralelo que
 * se separa al primer cambio.
 */

export type { SerializedClaim };

/**
 * La forma del formulario, sin las reglas.
 *
 * El `zod` declara tipos y deja pasar: los enums, el patrón del `CLM-` y los topes de largo se validan en
 * `normalizeClaimInput`, que es la puerta única. Un segundo validador acá sería la copia que este trabajo
 * vino a borrar. Solo `entityId` se valida en el transporte, porque un id que no es UUID no llega ni a la
 * consulta.
 */
const claimPayload = z.object({
	brandId: z.string().min(1),
	entityId: z.string().uuid(),
	claimId: z.string(),
	statement: z.string(),
	metric: z.string().nullish(),
	category: z.string().nullish(),
	boundaryApplicableFor: z.string().nullish(),
	boundaryNotApplicableFor: z.string().nullish(),
	confidence: z.string().nullish(),
	proofType: z.string(),
	proofTitle: z.string(),
	proofSummary: z.string().nullish(),
	proofClient: z.string().nullish(),
	verifiableBy: z.string().nullish(),
	confidentiality: z.string().nullish(),
	sourceFragment: z.string().nullish(),
	status: z.string(),
});

/** Un error que el operador puede corregir se muestra tal cual; lo demás es un fallo de verdad. */
function asUserFacingError(error: unknown): unknown {
	if (error instanceof ClaimInputError || error instanceof ClaimEntityNotFoundError) return new Error(error.message);
	return error;
}

export const listClaimsFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		// Los candidatos salen del último contexto de marca que mandó Maasy, que es la única fuente de la
		// evidencia en prosa. Sin snapshot no hay candidatos: no se inventan.
		const [snapshot] = await db
			.select({ payload: agentBrandDnaSnapshots.payload })
			.from(agentBrandDnaSnapshots)
			.where(and(eq(agentBrandDnaSnapshots.entityId, data.entityId), eq(agentBrandDnaSnapshots.brandId, data.brandId)))
			.orderBy(desc(agentBrandDnaSnapshots.syncedAt))
			.limit(1);
		const payload = snapshot?.payload as Record<string, unknown> | undefined;
		const dna =
			typeof payload?.dna === "object" && payload.dna !== null ? (payload.dna as Record<string, unknown>) : undefined;

		// La entidad, su paraguas y las pruebas de los dos. La lista de heredadas sale de la misma regla
		// pura que usa el generador, no de una segunda interpretación.
		const context = await loadClaimsContext(data.brandId, data.entityId);

		// Cuántas pruebas sirve el sitio HOY. Se prueban las tres webs de la marca —entidad, DNA y marca—
		// porque la de la entidad puede estar vacía, y con la web vacía el candado no puede comparar.
		const [entity] = await db
			.select({ websiteUrl: agentBrandEntities.websiteUrl })
			.from(agentBrandEntities)
			.where(and(eq(agentBrandEntities.id, data.entityId), eq(agentBrandEntities.brandId, data.brandId)))
			.limit(1);
		const [brand] = await db
			.select({ website: brands.website })
			.from(brands)
			.where(eq(brands.id, data.brandId))
			.limit(1);
		const liveClaimCount = await liveClaimCountFrom(
			websiteSourcesForClaims({
				entityWebsite: entity?.websiteUrl,
				dnaWebsite: payload?.website_url,
				brandWebsite: brand?.website,
			}),
		);

		const bundleClaimCount = bundleClaimCountOf(context, dna);

		return {
			candidates: proposeClaimCandidates(payload),
			claims: context.rows.map(serializeClaim),
			// Lo que esta entidad hereda, ya filtrado. La pantalla lo muestra como heredado y no lo deja
			// editar desde acá: se edita en el paraguas.
			inheritedClaims: inheritedClaimsOf(context).map(serializeClaim),
			umbrella: { id: context.umbrellaEntity.id, name: context.umbrellaEntity.name },
			isUmbrella: context.isUmbrella,
			liveClaimCount,
			bundleClaimCount,
			// Si el DNA ya declara claims, los confirmados acá no entran al bundle: la pantalla tiene que
			// poder decirlo, o el contador miente.
			claimsSource: dnaCarriesClaims(dna) ? ("maasy" as const) : ("beaos" as const),
		};
	});

/**
 * La marca de heredable: la decisión que no se puede tomar sola.
 *
 * Es una server function aparte del guardado porque es otra cosa: no cambia la afirmación, cambia
 * quiénes pueden firmarla. La explicación de cuándo marcarla vive en la pantalla, al lado del control.
 */
export const setClaimInheritableFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string().min(1),
			entityId: z.string().uuid(),
			claimId: z.string().min(1).max(120),
			inheritable: z.boolean(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		try {
			return await setClaimInheritable(data);
		} catch (error) {
			if (error instanceof ClaimNotFoundError) throw new Error(error.message);
			throw error;
		}
	});

export const saveClaimFn = createServerFn({ method: "POST" })
	.validator(claimPayload)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		try {
			// El alta entera —validación, entidad de la marca, insert-or-update— vive en el núcleo: es la
			// misma operación que expone el MCP, no una parecida.
			const { claim } = await upsertClaim(data);
			return claim;
		} catch (error) {
			throw asUserFacingError(error);
		}
	});

export const deleteClaimFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid(), claimId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		try {
			return await deleteClaim(data);
		} catch (error) {
			throw asUserFacingError(error);
		}
	});
