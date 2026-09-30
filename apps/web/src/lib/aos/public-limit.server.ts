/**
 * Consumo atómico del cupo diario del audit público.
 *
 * El contador vive en Postgres (`aos_public_usage`) y no en memoria: tiene que sobrevivir un
 * reinicio y ser el mismo para todas las instancias. Cada incremento es un solo
 * `insert ... on conflict do update ... where count < limite returning count`: si la condición no
 * se cumple, no vuelve ninguna fila y ese "sin filas" ES la decisión de bloquear, sin leer-y-después-
 * escribir y sin carrera entre instancias.
 *
 * Orden y reembolso: primero el cupo por IP y después el global. Si el global rechaza, devolvemos el
 * cupo por IP que ya habíamos gastado — si no, un tope global agotado consumiría el cupo personal de
 * quien ni llegó a ser atendido.
 */

import { db } from "@workspace/lib/db/db";
import { aosPublicUsage } from "@workspace/lib/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { GLOBAL_QUOTA_KEY, hashClientKey, type PublicAuditLimits, type QuotaSnapshot, utcDay } from "./public-audit";

/** Buckets del contador. `ip` es el cupo del cliente; `global`, el del servicio entero. */
const IP_BUCKET = "ip";
const GLOBAL_BUCKET = "global";

/**
 * Intenta gastar un cupo. Devuelve el total ya consumido (contando este pedido) o `null` si el
 * límite ya estaba alcanzado.
 */
async function tryConsume(bucket: string, keyHash: string, day: string, limit: number): Promise<number | null> {
	const rows = await db
		.insert(aosPublicUsage)
		.values({ bucket, keyHash, day, count: 1 })
		.onConflictDoUpdate({
			target: [aosPublicUsage.bucket, aosPublicUsage.keyHash, aosPublicUsage.day],
			set: { count: sql`${aosPublicUsage.count} + 1`, updatedAt: new Date() },
			// La condición vive en el UPDATE: si no se cumple no hay fila devuelta y el cupo no se gasta.
			setWhere: sql`${aosPublicUsage.count} < ${limit}`,
		})
		.returning({ count: aosPublicUsage.count });
	const first = rows[0];
	return first === undefined ? null : first.count;
}

/** Devuelve un cupo gastado. Se usa solo cuando el segundo límite rechaza después del primero. */
async function refund(bucket: string, keyHash: string, day: string): Promise<void> {
	try {
		await db
			.update(aosPublicUsage)
			.set({ count: sql`${aosPublicUsage.count} - 1` })
			.where(
				and(
					eq(aosPublicUsage.bucket, bucket),
					eq(aosPublicUsage.keyHash, keyHash),
					eq(aosPublicUsage.day, day),
					sql`${aosPublicUsage.count} > 0`,
				),
			);
	} catch (error) {
		// Un reembolso fallido no puede tumbar una respuesta: a lo sumo cobra un cupo de más.
		console.error("[aos-public] no pudimos devolver el cupo", error);
	}
}

/**
 * Gasta un pedido del cupo diario y devuelve el estado ANTES del pedido, que es lo que consume la
 * regla pura `decidePublicQuota`.
 *
 * Cuando el pedido se rechaza, el snapshot trae el límite que lo rechazó en el cupo que corresponde
 * y cero en el otro: así la misma regla pura da el mismo motivo que decidió la base, sin duplicar la
 * lógica del límite en dos lugares.
 */
export async function consumePublicQuota(
	clientKey: string,
	limits: PublicAuditLimits,
	now: Date = new Date(),
): Promise<QuotaSnapshot> {
	const day = utcDay(now);
	const ipKeyHash = hashClientKey(clientKey, limits.ipSalt);
	const base = { ipLimit: limits.perIp, globalLimit: limits.global, now };

	const ipCount = await tryConsume(IP_BUCKET, ipKeyHash, day, limits.perIp);
	if (ipCount === null) {
		return { ...base, ipCount: limits.perIp, globalCount: 0 };
	}

	const globalCount = await tryConsume(GLOBAL_BUCKET, GLOBAL_QUOTA_KEY, day, limits.global);
	if (globalCount === null) {
		await refund(IP_BUCKET, ipKeyHash, day);
		return { ...base, ipCount: 0, globalCount: limits.global };
	}

	return { ...base, ipCount: ipCount - 1, globalCount: globalCount - 1 };
}
