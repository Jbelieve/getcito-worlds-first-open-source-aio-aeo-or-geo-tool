/**
 * Consumo atómico del cupo diario del audit público.
 *
 * El contador vive en Postgres (`aos_public_usage`) y no en memoria: tiene que sobrevivir un
 * reinicio y ser el mismo para todas las instancias. Cada incremento es un solo
 * `insert ... on conflict do update ... where count < limite returning count`: si la condición no
 * se cumple, no vuelve ninguna fila y ese "sin filas" ES la decisión de bloquear, sin leer-y-después-
 * escribir y sin carrera entre instancias.
 *
 * Orden y reembolso: primero el cupo del cliente y después el global. Si el global rechaza, devolvemos
 * el cupo del cliente que ya habíamos gastado — si no, un tope global agotado consumiría el cupo
 * personal de quien ni llegó a ser atendido.
 *
 * ## Los dos carriles
 *
 * `lane: "ip"` es el cupo público, el de siempre. `lane: "verify"` es el del verificador y solo se
 * alcanza con la credencial correcta (`quotaLaneForRequest`). Entre uno y otro cambia **una sola
 * cosa**: el bucket del contador por cliente y su tope. La clave se hashea igual y el tope global es
 * el mismo, así que la cota agregada del servicio no se mueve y la credencial no es un bypass: es
 * otra cuenta para el mismo límite.
 */

import { db } from "@workspace/lib/db/db";
import { aosPublicUsage } from "@workspace/lib/db/schema";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
	GLOBAL_QUOTA_KEY,
	hashClientKey,
	PUBLIC_QUOTA_BUCKET,
	type PublicAuditLimits,
	type QuotaLane,
	type QuotaSnapshot,
	quotaBucketForLane,
	quotaConcentrationWarning,
	quotaLimitForLane,
	utcDay,
	VERIFY_QUOTA_BUCKET,
} from "./public-audit";

/** Bucket del tope del servicio entero. No es un cliente: es el contador de todos. */
const GLOBAL_BUCKET = "global";

/**
 * Buckets que cuentan como "un cliente" para la alarma de concentración. El global queda afuera a
 * propósito: no es un cliente, es el total del servicio, y siempre sería el que más consumió.
 */
const CLIENT_BUCKETS = [PUBLIC_QUOTA_BUCKET, VERIFY_QUOTA_BUCKET];

/**
 * Buckets ya avisados, para que la alarma no inunde el log: un bucket concentrado se avisa una vez
 * por proceso y por día, no una vez por pedido. Se vacía cuando cambia el día.
 */
const warnedConcentrations = new Set<string>();
let warnedDay: string | null = null;

/**
 * Lee el bucket de cliente que más consumió hoy y, si se está llevando más de un tercio del tope
 * global, lo deja dicho en el log.
 *
 * Es una lectura **de más**: una consulta indexada por request, contra un endpoint que ya hace
 * decenas de pedidos de red. Se paga a propósito, porque la alternativa —enterarse por el reclamo de
 * un usuario— es exactamente lo que pasó. Nunca bloquea nada y nunca puede tumbar una respuesta: si
 * la consulta falla, la request sigue igual que si no hubiera alarma.
 *
 * Mira los dos carriles de cliente (`ip` y `verify`), porque desde que existe la credencial los dos
 * gastan del mismo tope global: dejar el de verificación afuera sería justo no ver la corrida que
 * ahora puede llevarse el servicio por delante. El nombre del bucket viaja en el aviso para que quien
 * lo lea sepa si es el bug (una clave de IP colapsada) o una verificación con credencial, que es
 * esperable. El bucket `global` se excluye: no es un cliente y siempre sería el mayor.
 */
async function warnIfOneKeyConcentratesQuota(day: string, globalLimit: number): Promise<void> {
	try {
		const rows = await db
			.select({ bucket: aosPublicUsage.bucket, keyHash: aosPublicUsage.keyHash, count: aosPublicUsage.count })
			.from(aosPublicUsage)
			.where(and(inArray(aosPublicUsage.bucket, CLIENT_BUCKETS), eq(aosPublicUsage.day, day)))
			.orderBy(desc(aosPublicUsage.count))
			.limit(1);

		const top = rows[0];
		if (top === undefined) return;

		const warning = quotaConcentrationWarning({
			topCount: top.count,
			globalLimit,
			day,
			bucket: top.bucket,
		});
		if (warning === null) return;

		if (warnedDay !== day) {
			warnedDay = day;
			warnedConcentrations.clear();
		}
		const seen = `${day}:${top.bucket}:${top.keyHash}`;
		if (warnedConcentrations.has(seen)) return;
		warnedConcentrations.add(seen);
		console.warn(warning);
	} catch (error) {
		console.error("[aos-public] no pudimos revisar la concentración del cupo", error);
	}
}

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
 * `lane` elige la cuenta: el bucket de IP con su tope, o el bucket `verify` con el suyo. La clave se
 * hashea igual en los dos —misma sal, mismo SHA-256 de la IP— porque lo que cambia es a qué cuenta va
 * el pedido, no quién es el cliente: dentro de `verify` también se cuenta por IP. El tope global no
 * depende del carril: un pedido de verificación gasta del mismo pozo del servicio que uno público.
 *
 * Cuando el pedido se rechaza, el snapshot trae el límite que lo rechazó en el cupo que corresponde
 * y cero en el otro: así la misma regla pura da el mismo motivo que decidió la base, sin duplicar la
 * lógica del límite en dos lugares.
 */
export async function consumePublicQuota(
	clientKey: string,
	limits: PublicAuditLimits,
	lane: QuotaLane = "ip",
	now: Date = new Date(),
): Promise<QuotaSnapshot> {
	const day = utcDay(now);
	const keyHash = hashClientKey(clientKey, limits.ipSalt);
	const bucket = quotaBucketForLane(lane);
	const perKeyLimit = quotaLimitForLane(lane, limits);
	const base = { ipLimit: perKeyLimit, globalLimit: limits.global, now };

	const perKeyCount = await tryConsume(bucket, keyHash, day, perKeyLimit);
	// La alarma mira el día entero, no este pedido: por eso va después del consumo y sin importar el
	// resultado (el colapso de la clave se ve mejor justo cuando empiezan los rechazos).
	await warnIfOneKeyConcentratesQuota(day, limits.global);
	if (perKeyCount === null) {
		return { ...base, ipCount: perKeyLimit, globalCount: 0 };
	}

	const globalCount = await tryConsume(GLOBAL_BUCKET, GLOBAL_QUOTA_KEY, day, limits.global);
	if (globalCount === null) {
		// Se devuelve el cupo del carril que se gastó, no siempre el de IP: si no, una verificación
		// rechazada por el tope global le descontaría un pedido al cupo público de esa misma IP.
		await refund(bucket, keyHash, day);
		return { ...base, ipCount: 0, globalCount: limits.global };
	}

	return { ...base, ipCount: perKeyCount - 1, globalCount: globalCount - 1 };
}
