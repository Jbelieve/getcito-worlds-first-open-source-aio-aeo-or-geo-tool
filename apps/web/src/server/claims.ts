import { createServerFn } from "@tanstack/react-start";
import { dnaCarriesClaims, proposeClaimCandidates } from "@workspace/aos-aps/claims";
import { agentBrandClaims, agentBrandDnaSnapshots, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { CLAIM_CATEGORIES, CONFIDENTIALITY, VERIFIABLE_BY } from "@workspace/aos-aps/preference";
import { db } from "@workspace/lib/db/db";
import { brands } from "@workspace/lib/db/schema";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { websiteSourcesForClaims } from "@/lib/claims-guard";
import { liveClaimCountFrom } from "@/server/agent-assets-core";
import {
	bundleClaimCountOf,
	ClaimNotFoundError,
	inheritedClaimsOf,
	loadClaimsContext,
	type SerializedClaim,
	serializeClaim,
	setClaimInheritable,
} from "@/server/claims-core";

/**
 * La puerta de la UI para las pruebas de la marca.
 *
 * La decisión de qué entra al bundle no vive acá: vive en `@workspace/aos-aps/claims`, que es puro y se
 * prueba sin base ni red. Esta server function solo autoriza, lee y escribe. Si la regla de precedencia
 * estuviera escrita dos veces —una para la pantalla y otra para el generador—, la pantalla podría decir
 * que el bundle declara 6 cuando el bundle declara 0, que es exactamente el error que hay que evitar.
 */

/** Los cinco tipos de prueba que el operador puede elegir. */
const PROOF_TYPE = z.enum(["case_study", "document", "testimonial", "audit", "other"]);

/** Un campo de texto opcional: vacío y ausente son lo mismo —nada declarado—, y así se guarda. */
const optionalText = z
	.string()
	.max(4000)
	.optional()
	.transform((value) => (value === undefined || value.trim().length === 0 ? null : value.trim()));

export type { SerializedClaim };

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
	.validator(
		z.object({
			brandId: z.string().min(1),
			entityId: z.string().uuid(),
			claimId: z.string().min(1).max(120),
			statement: z.string().min(1).max(4000),
			metric: optionalText,
			category: z.enum(CLAIM_CATEGORIES).optional(),
			boundaryApplicableFor: optionalText,
			boundaryNotApplicableFor: optionalText,
			confidence: optionalText,
			proofType: PROOF_TYPE,
			proofTitle: z.string().min(1).max(400),
			proofSummary: optionalText,
			proofClient: optionalText,
			// El enum es el del estándar: un `verifiable_by` fuera de la lista es un error del validador, y
			// el perfil que BeAOS firma no debería salir con errores que ya sabemos cómo evitar.
			verifiableBy: z.enum(VERIFIABLE_BY).optional(),
			confidentiality: z.enum(CONFIDENTIALITY).optional(),
			sourceFragment: optionalText,
			status: z.enum(["draft", "confirmed"]),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const claimId = data.claimId.trim();
		const statement = data.statement.trim();

		// Lo editable es todo menos la identidad: marca, entidad y claim id son la clave de la fila, no un
		// campo de este formulario.
		const editable = {
			statement,
			metric: data.metric,
			category: data.category ?? null,
			boundaryApplicableFor: data.boundaryApplicableFor,
			boundaryNotApplicableFor: data.boundaryNotApplicableFor,
			confidence: data.confidence,
			proofType: data.proofType,
			proofTitle: data.proofTitle.trim(),
			proofSummary: data.proofSummary,
			proofClient: data.proofClient,
			verifiableBy: data.verifiableBy ?? null,
			confidentiality: data.confidentiality ?? null,
			sourceFragment: data.sourceFragment,
			status: data.status,
		};
		const values = { brandId: data.brandId, entityId: data.entityId, claimId, ...editable };

		// Un solo camino: crear y editar son la misma operación, porque el id del claim es del operador y
		// guardar dos veces lo que ya existe no puede duplicar la prueba.
		const [saved] = await db
			.insert(agentBrandClaims)
			.values(values)
			.onConflictDoUpdate({
				target: [agentBrandClaims.entityId, agentBrandClaims.claimId],
				set: { ...editable, updatedAt: new Date() },
			})
			.returning();

		if (saved === undefined) throw new Error("No se pudo guardar la prueba");
		return serializeClaim(saved);
	});

export const deleteClaimFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string().min(1), entityId: z.string().uuid(), claimId: z.string().min(1) }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);
		await db
			.delete(agentBrandClaims)
			.where(
				and(
					eq(agentBrandClaims.brandId, data.brandId),
					eq(agentBrandClaims.entityId, data.entityId),
					eq(agentBrandClaims.claimId, data.claimId.trim()),
				),
			);
		return { ok: true };
	});
