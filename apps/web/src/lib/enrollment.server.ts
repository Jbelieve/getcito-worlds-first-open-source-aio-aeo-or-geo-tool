/**
 * El canje del código de conexión, contra la base.
 *
 * Acá vive la única cosa que no se puede negociar de este flujo: **un código se canjea una sola vez**,
 * y ni siquiera dos requests simultáneos pueden ganar los dos.
 *
 * ## Cómo se garantiza
 *
 * El endpoint es público y no tiene credencial previa, así que el código *es* la credencial. Un código
 * que se puede canjear dos veces es un token de producto gratis para quien lo vio pasar: el agujero
 * que hay que no tener.
 *
 * La garantía no es "leer, ver que `usedAt` es null y después escribir" —eso es una carrera, y con dos
 * requests en paralelo los dos leen null y los dos emiten—. Es **una sola sentencia**:
 *
 * ```sql
 * update agent_enrollment_codes
 *    set used_at = now()
 *  where code_hash = $1
 *    and used_at is null
 *    and expires_at > now()
 * returning brand_id, entity_id
 * ```
 *
 * Quién gana la fila es quién emite el token, y lo decide Postgres. El segundo, con la transacción
 * cerrada de la mano, ve la fila ya actualizada, su `WHERE` no da y **no recibe fila**: se queda sin
 * token. Si los dos llegan en el mismo instante, el segundo **espera el lock de la fila** y reevalúa el
 * `WHERE` contra la versión confirmada, así que tampoco gana. No hay ventana entre el chequeo y la
 * marca porque son la misma operación.
 *
 * La marca de uso y el alta del token van en la **misma transacción**: si el alta falla, la marca se
 * revierte y el código sigue sirviendo. Un código marcado como usado sin token emitido sería un código
 * perdido por un error de red.
 *
 * `expires_at > now()` usa el reloj de la **base**, no el del proceso web: un servidor con el reloj
 * corrido no puede convertir un código vencido en uno válido.
 */

import { agentApiTokens, agentEnrollmentCodes } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { generateApiToken, hashApiToken, prefixOfToken } from "./api-tokens";
import {
	ENROLLMENT_TTL_HOURS,
	enrollmentExpiry,
	generateEnrollmentCode,
	hashEnrollmentCode,
	prefixOfEnrollmentCode,
} from "./enrollment";

export interface CreatedEnrollmentCode {
	/** El código en claro. **Se devuelve una sola vez y no se guarda.** */
	code: string;
	prefix: string;
	brandId: string;
	entityId: string;
	expiresAt: Date;
}

export interface CreateEnrollmentCodeInput {
	brandId: string;
	entityId: string;
	/** Para qué sitio es, en palabras del operador. Trazabilidad, no seguridad. */
	label?: string | null;
	createdBy?: string | null;
	ttlHours?: number;
	now?: Date;
}

/**
 * Genera un código para una marca y una entidad. Devuelve el código en claro **una sola vez**: en la
 * base queda su sha256 y nada más.
 */
export async function createEnrollmentCode(input: CreateEnrollmentCodeInput): Promise<CreatedEnrollmentCode> {
	const now = input.now ?? new Date();
	const code = generateEnrollmentCode();
	const prefix = prefixOfEnrollmentCode(code);
	const expiresAt = enrollmentExpiry(now, input.ttlHours ?? ENROLLMENT_TTL_HOURS);

	await db.insert(agentEnrollmentCodes).values({
		codeHash: hashEnrollmentCode(code),
		prefix,
		brandId: input.brandId,
		entityId: input.entityId,
		label: input.label ?? null,
		createdBy: input.createdBy ?? null,
		expiresAt,
	});

	return { code, prefix, brandId: input.brandId, entityId: input.entityId, expiresAt };
}

export type RedeemEnrollmentResult =
	| { status: "ok"; token: string; brandId: string; entityId: string }
	/** El código no existe, ya venció o ya se usó. **Los tres son lo mismo de cara al cliente.** */
	| { status: "notfound" };

/**
 * Canjea un código y emite el token de producto, o no hace nada.
 *
 * El nombre del token lleva el prefijo de la **entidad**, no el del código, para que revocar "todos los
 * de esta marca" sea un `like 'wordpress-<brand>-%'` y no una adivinanza.
 */
export async function redeemEnrollmentCode(code: string, now: Date = new Date()): Promise<RedeemEnrollmentResult> {
	const codeHash = hashEnrollmentCode(code);

	return db.transaction(async (tx) => {
		// 1. La marca de uso, atómica. `isNull(usedAt)` y `expiresAt > now()` viven en el WHERE: la fila
		//    que vuelve es la que este pedido ganó, y nadie más la puede ganar.
		const [claimed] = await tx
			.update(agentEnrollmentCodes)
			.set({ usedAt: now })
			.where(
				and(
					eq(agentEnrollmentCodes.codeHash, codeHash),
					isNull(agentEnrollmentCodes.usedAt),
					sql`${agentEnrollmentCodes.expiresAt} > now()`,
				),
			)
			.returning({ brandId: agentEnrollmentCodes.brandId, entityId: agentEnrollmentCodes.entityId });

		// Sin fila no hay canje. No se distingue el motivo: ver `ENROLLMENT_REJECTION_MESSAGE`.
		if (claimed === undefined) return { status: "notfound" as const };

		// 2. El token de producto, en la misma transacción. Si esto falla, la marca de uso se revierte.
		const token = generateApiToken();
		const [issued] = await tx
			.insert(agentApiTokens)
			.values({
				name: `wordpress-${claimed.brandId}-${claimed.entityId.slice(0, 8)}`,
				tokenHash: hashApiToken(token),
				prefix: prefixOfToken(token),
			})
			.returning({ id: agentApiTokens.id });

		// 3. Dejar dicho qué token emitió este código, para poder revocar los dos juntos.
		if (issued !== undefined) {
			await tx
				.update(agentEnrollmentCodes)
				.set({ usedTokenId: issued.id })
				.where(eq(agentEnrollmentCodes.codeHash, codeHash));
		}

		return { status: "ok" as const, token, brandId: claimed.brandId, entityId: claimed.entityId };
	});
}

/** Una fila del listado de códigos, sin el código (que no existe en la base). */
export interface EnrollmentCodeRow {
	prefix: string;
	label: string | null;
	brandId: string;
	entityId: string;
	createdAt: Date;
	expiresAt: Date;
	usedAt: Date | null;
}

/** Los códigos de una marca, del más nuevo al más viejo. Para el listado y para el script. */
export async function listEnrollmentCodes(brandId?: string): Promise<EnrollmentCodeRow[]> {
	const query = db
		.select({
			prefix: agentEnrollmentCodes.prefix,
			label: agentEnrollmentCodes.label,
			brandId: agentEnrollmentCodes.brandId,
			entityId: agentEnrollmentCodes.entityId,
			createdAt: agentEnrollmentCodes.createdAt,
			expiresAt: agentEnrollmentCodes.expiresAt,
			usedAt: agentEnrollmentCodes.usedAt,
		})
		.from(agentEnrollmentCodes)
		.orderBy(desc(agentEnrollmentCodes.createdAt));

	return brandId === undefined ? query : query.where(eq(agentEnrollmentCodes.brandId, brandId));
}

/**
 * Revoca (marca como usado) un código que todavía no se canjeó. Devuelve `true` si había algo que
 * revocar.
 *
 * Es la salida para un código que se filtró antes de usarse: se marca usado y deja de canjear. No
 * revoca el token de un código ya canjeado —eso es `agent_api_tokens`, y es otra acción, a propósito:
 * revocar el código no debe dar de baja la credencial de un sitio que ya está funcionando.
 */
export async function revokeEnrollmentCode(prefix: string, now: Date = new Date()): Promise<boolean> {
	const rows = await db
		.update(agentEnrollmentCodes)
		.set({ usedAt: now })
		.where(and(eq(agentEnrollmentCodes.prefix, prefix), isNull(agentEnrollmentCodes.usedAt)))
		.returning({ prefix: agentEnrollmentCodes.prefix });
	return rows.length > 0;
}
