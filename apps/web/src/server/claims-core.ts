/**
 * El núcleo de las pruebas de marca: leer la entidad con su paraguas, marcar qué se hereda y dar de alta,
 * editar, leer y borrar una prueba.
 *
 * Vive acá y no en la server function por la misma razón que `agent-assets-core`: la pantalla de Pruebas
 * y el MCP tienen que decidir **lo mismo**. Si cada puerta armara su propia lista de heredadas, la
 * pantalla podría decir "heredás 3" mientras el bundle declara 0, que es el error que este módulo existe
 * para impedir. Y si cada puerta validara el formulario por su cuenta, el MCP podría guardar una prueba
 * que la pantalla rechaza —o al revés—, que es la misma clase de error con otra cara.
 *
 * La regla —qué se hereda, qué gana, qué queda afuera— no se escribe acá: vive en
 * `@workspace/aos-aps/claims`, que es puro y se prueba sin base. Acá solo se leen filas, se valida con esa
 * regla y se serializan.
 */

import {
	type ClaimInput,
	ClaimInputError,
	inheritedRowsFor,
	normalizeClaimInput,
	resolveBundleClaims,
	type UmbrellaClaims,
} from "@workspace/aos-aps/claims";
import { type AgentBrandClaim, agentBrandClaims, agentBrandEntities } from "@workspace/aos-aps/db/schema";
import { findUmbrellaEntity } from "@workspace/aos-aps/provenance";
import { db } from "@workspace/lib/db/db";
import { and, asc, eq } from "drizzle-orm";
import { type ClaimTally, tallyClaims } from "@/lib/claims-guard";

export { type ClaimInput, ClaimInputError, type NormalizedClaim } from "@workspace/aos-aps/claims";

/** Todo lo que la UI y el MCP necesitan mostrar de una prueba, con las dos marcas de la herencia. */
export function serializeClaim(row: AgentBrandClaim) {
	return {
		id: row.id,
		claimId: row.claimId,
		statement: row.statement,
		metric: row.metric,
		category: row.category,
		boundaryApplicableFor: row.boundaryApplicableFor,
		boundaryNotApplicableFor: row.boundaryNotApplicableFor,
		confidence: row.confidence,
		proofType: row.proofType,
		proofTitle: row.proofTitle,
		proofSummary: row.proofSummary,
		proofClient: row.proofClient,
		verifiableBy: row.verifiableBy,
		confidentiality: row.confidentiality,
		sourceFragment: row.sourceFragment,
		status: row.status,
		/** Si las sub-entidades de esta marca pueden heredarla. Lo decide el operador. */
		inheritable: row.inheritable,
		/** La entidad de la que salió esta fila cuando es una copia heredada; null si es propia. */
		inheritedFromEntityId: row.inheritedFromEntityId,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export type SerializedClaim = ReturnType<typeof serializeClaim>;

export interface ClaimsContext {
	/** Las filas guardadas de la entidad consultada, propias y copias. */
	rows: AgentBrandClaim[];
	/** El paraguas del que hereda, con sus filas. `null` cuando la entidad **es** el paraguas. */
	umbrella: UmbrellaClaims | null;
	/** La entidad paraguas de la jerarquía, siempre presente (o se falla). */
	umbrellaEntity: { id: string; name: string };
	isUmbrella: boolean;
}

/** La entidad no está en la jerarquía de esa marca. Se distingue de una jerarquía rota a propósito. */
export class ClaimEntityNotFoundError extends Error {}

/**
 * Lee la entidad con su jerarquía y el paraguas del que hereda.
 *
 * Una entidad que **es** el paraguas no hereda de nadie: heredar de sí misma duplicaría sus pruebas.
 * Una jerarquía rota falla explícitamente en vez de inventar una raíz, igual que al firmar.
 */
export async function loadClaimsContext(brandId: string, entityId: string): Promise<ClaimsContext> {
	const hierarchy = await db
		.select({
			id: agentBrandEntities.id,
			parentEntityId: agentBrandEntities.parentEntityId,
			name: agentBrandEntities.name,
		})
		.from(agentBrandEntities)
		.where(eq(agentBrandEntities.brandId, brandId));
	const umbrellaEntity = findUmbrellaEntity(hierarchy, entityId);
	if (umbrellaEntity === null) {
		if (hierarchy.some((entity) => entity.id === entityId) === false) {
			throw new ClaimEntityNotFoundError(`La entidad "${entityId}" no existe en la marca "${brandId}".`);
		}
		throw new Error("Entity hierarchy is incomplete: no umbrella found");
	}

	const rows = await readEntityClaims(brandId, entityId);
	const isUmbrella = umbrellaEntity.id === entityId;
	const umbrella = isUmbrella
		? null
		: { claims: await readEntityClaims(brandId, umbrellaEntity.id), entityName: umbrellaEntity.name };
	return { rows, umbrella, umbrellaEntity: { id: umbrellaEntity.id, name: umbrellaEntity.name }, isUmbrella };
}

function readEntityClaims(brandId: string, entityId: string): Promise<AgentBrandClaim[]> {
	return db
		.select()
		.from(agentBrandClaims)
		.where(and(eq(agentBrandClaims.brandId, brandId), eq(agentBrandClaims.entityId, entityId)))
		.orderBy(asc(agentBrandClaims.createdAt));
}

/** Las pruebas que la entidad hereda de verdad, ya filtradas por la regla pura. */
export function inheritedClaimsOf(context: ClaimsContext): AgentBrandClaim[] {
	return inheritedRowsFor({ saved: context.rows, umbrella: context.umbrella ?? undefined });
}

/**
 * El desglose del bundle de la entidad: cuántas pruebas declara, cuántas prestadas y cuántas propias.
 *
 * Es el mismo cálculo que hace el generador —`resolveBundleClaims`— y no una copia: lo que muestra la
 * pantalla es lo que va a quedar firmado. Y el desglose sale de `tallyClaims` sobre esas pruebas, con la
 * misma marca que lee el candado: si la herencia se contara acá con una segunda regla, la pantalla podría
 * decir "heredás 3" mientras el bundle declara 0.
 */
export function bundleClaimTallyOf(context: ClaimsContext, dna: Record<string, unknown> | undefined): ClaimTally {
	const { claims } = resolveBundleClaims({ dna, saved: context.rows, umbrella: context.umbrella ?? undefined });
	return tallyClaims(claims);
}

export class ClaimNotFoundError extends Error {}

/**
 * Cambia la marca de heredable de una prueba.
 *
 * Solo toca esa columna: la afirmación, la prueba y el estado no se modifican desde acá. Una prueba que
 * no existe no se crea —marcar algo que no está sería inventar evidencia—.
 */
export async function setClaimInheritable(input: {
	brandId: string;
	entityId: string;
	claimId: string;
	inheritable: boolean;
}): Promise<SerializedClaim> {
	const claimId = input.claimId.trim();
	const [updated] = await db
		.update(agentBrandClaims)
		.set({ inheritable: input.inheritable, updatedAt: new Date() })
		.where(
			and(
				eq(agentBrandClaims.brandId, input.brandId),
				eq(agentBrandClaims.entityId, input.entityId),
				eq(agentBrandClaims.claimId, claimId),
			),
		)
		.returning();
	if (updated === undefined) {
		throw new ClaimNotFoundError(`No existe la prueba "${claimId}" en esa entidad.`);
	}
	return serializeClaim(updated);
}

/**
 * La entidad tiene que existir **y** ser de esa marca.
 *
 * No es una formalidad: sin este chequeo, un `entityId` de otra marca entraría igual —la clave foránea
 * apunta a la entidad, no al par marca/entidad— y la prueba quedaría escrita en una jerarquía que no es
 * la suya. El mensaje distingue "no existe" de "no es de esta marca" porque son dos errores distintos del
 * consumidor.
 */
async function assertEntityInBrand(brandId: string, entityId: string): Promise<void> {
	const [entity] = await db
		.select({ id: agentBrandEntities.id })
		.from(agentBrandEntities)
		.where(and(eq(agentBrandEntities.id, entityId), eq(agentBrandEntities.brandId, brandId)))
		.limit(1);
	if (entity === undefined) {
		throw new ClaimEntityNotFoundError(
			`La entidad "${entityId}" no existe en la marca "${brandId}". Un entityId de otra marca no se puede escribir desde acá.`,
		);
	}
}

export interface UpsertClaimInput extends ClaimInput {
	brandId: string;
	entityId: string;
	/**
	 * Si las sub-entidades pueden heredarla.
	 *
	 * Si no viene, **no se toca**: heredar es una decisión del operador y editarlo una prueba no puede
	 * borrarla de rebote. Un alta sin el campo nace con el default de la tabla (`false`).
	 */
	inheritable?: boolean;
}

export interface UpsertClaimResult {
	claim: SerializedClaim;
	/** `true` cuando la fila no existía. Guardar dos veces el mismo id actualiza; nunca duplica. */
	created: boolean;
	/** Lo que el estándar va a decir del perfil sin frenar el guardado. */
	warnings: string[];
}

/**
 * Da de alta o actualiza una prueba.
 *
 * Es la única secuencia de escritura: la pantalla y el MCP llaman a esto, así que no puede haber una
 * puerta que exija el `CLM-` y otra que no. Crear y editar son la misma operación porque el id es del
 * operador y hay unique por `(entity_id, claim_id)`: guardar dos veces lo que ya existe no duplica la
 * prueba, la corrige.
 *
 * La validación es pura y vive en `@workspace/aos-aps/claims`; acá solo se escribe.
 */
export async function upsertClaim(input: UpsertClaimInput): Promise<UpsertClaimResult> {
	await assertEntityInBrand(input.brandId, input.entityId);
	const { claim, warnings } = normalizeClaimInput(input);
	const { claimId, ...editable } = claim;
	// Lo editable es todo menos la identidad: marca, entidad y claim id son la clave de la fila, no un
	// campo del formulario.
	const inheritable = input.inheritable === undefined ? {} : { inheritable: input.inheritable };

	const [existing] = await db
		.select({ id: agentBrandClaims.id })
		.from(agentBrandClaims)
		.where(
			and(
				eq(agentBrandClaims.brandId, input.brandId),
				eq(agentBrandClaims.entityId, input.entityId),
				eq(agentBrandClaims.claimId, claimId),
			),
		)
		.limit(1);

	const [saved] = await db
		.insert(agentBrandClaims)
		.values({ brandId: input.brandId, entityId: input.entityId, claimId, ...editable, ...inheritable })
		.onConflictDoUpdate({
			target: [agentBrandClaims.entityId, agentBrandClaims.claimId],
			set: { ...editable, ...inheritable, updatedAt: new Date() },
		})
		.returning();

	if (saved === undefined) throw new Error("No se pudo guardar la prueba");
	return { claim: serializeClaim(saved), created: existing === undefined, warnings };
}

export interface DeleteClaimResult {
	/** `false` cuando no había nada que borrar. Borrar dos veces no es un error: es la misma intención. */
	deleted: boolean;
	claimId: string;
}

/** Borra una prueba de la entidad. No borra nada de otra entidad ni de otra marca. */
export async function deleteClaim(input: {
	brandId: string;
	entityId: string;
	claimId: string;
}): Promise<DeleteClaimResult> {
	await assertEntityInBrand(input.brandId, input.entityId);
	const claimId = input.claimId.trim();
	if (claimId.length === 0) throw new ClaimInputError('"claimId" es obligatorio y no puede quedar vacío.');
	const [deleted] = await db
		.delete(agentBrandClaims)
		.where(
			and(
				eq(agentBrandClaims.brandId, input.brandId),
				eq(agentBrandClaims.entityId, input.entityId),
				eq(agentBrandClaims.claimId, claimId),
			),
		)
		.returning({ id: agentBrandClaims.id });
	return { deleted: deleted !== undefined, claimId };
}

/**
 * Lee **una** prueba de la entidad, o `null` si no existe.
 *
 * Devuelve solo lo guardado en esa entidad: una prueba que la entidad hereda del paraguas no es una fila
 * suya y no se puede confundir con propia. Para ver las heredadas está `list_claims`.
 */
export async function getClaim(input: {
	brandId: string;
	entityId: string;
	claimId: string;
}): Promise<SerializedClaim | null> {
	await assertEntityInBrand(input.brandId, input.entityId);
	const claimId = input.claimId.trim();
	if (claimId.length === 0) throw new ClaimInputError('"claimId" es obligatorio y no puede quedar vacío.');
	const [row] = await db
		.select()
		.from(agentBrandClaims)
		.where(
			and(
				eq(agentBrandClaims.brandId, input.brandId),
				eq(agentBrandClaims.entityId, input.entityId),
				eq(agentBrandClaims.claimId, claimId),
			),
		)
		.limit(1);
	return row === undefined ? null : serializeClaim(row);
}
