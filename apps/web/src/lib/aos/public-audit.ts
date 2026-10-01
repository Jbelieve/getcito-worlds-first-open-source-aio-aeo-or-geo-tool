/**
 * Piezas puras del audit público: límites, cabeceras, clave de cliente y forma de la respuesta.
 *
 * Todo lo de acá se prueba sin base y sin red a propósito: la decisión del límite es parte del
 * contrato, así que tiene que poder verificarse como una función, no como un efecto.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import {
	type AosAuditResult,
	type AxisBreakdown,
	type RequirementResult,
	type UrlTextGuardResult,
	validateAuditUrl,
} from "@workspace/aos-aps/aos";
import { z } from "zod";

/** Nombre de la política en las cabeceras `RateLimit-Policy` / `RateLimit`. */
export const PUBLIC_AUDIT_POLICY = "aos-audit";

/** Ventana del límite: un día UTC. */
export const QUOTA_WINDOW_SECONDS = 86_400;

/** Clave del bucket global: no es una IP, es el contador del servicio entero. */
export const GLOBAL_QUOTA_KEY = "__global__";

/** Cupo diario por IP. Suficiente para usar la extensión todo el día sin convertirla en un scraping service. */
export const DEFAULT_AUDITS_PER_DAY = 20;

/** Tope diario del servicio: la cota que sostiene cuando la identidad del cliente no alcanza. */
export const DEFAULT_AUDITS_PER_DAY_GLOBAL = 2000;

/**
 * Cupo diario por IP de la **credencial de verificación** (`AOS_PUBLIC_VERIFY_PER_DAY`).
 *
 * Es generoso a propósito —1000 frente a los 20 del cupo público— porque quien lo usa es el equipo
 * verificando el despliegue, y para eso hacen falta ráfagas: cada corrida de comprobación son decenas
 * de pedidos seguidos. No es "sin límite": sigue siendo por IP y sigue contando contra el tope global
 * del servicio (ver `consumePublicQuota`), así que la cota agregada del servicio no cambia.
 */
export const DEFAULT_VERIFY_AUDITS_PER_DAY = 1000;

/**
 * Cabecera de la credencial de verificación: `x-beaos-verify`.
 *
 * ## Por qué este nombre
 *
 * `x-` porque es una cabecera propia, fuera de los estándares. **No** se usa `Authorization`: esa
 * cabecera tiene semántica de autenticación (un proxy o un WAF puede tratarla distinto, un cliente
 * puede mandarla por costumbre, y un `WWW-Authenticate` en la respuesta prometería un esquema de auth
 * que no existe). Acá no hay identidad ni autorización: la credencial **solo mueve el pedido a otra
 * cuenta de cupo**.
 *
 * `beaos` porque el espacio de cabeceras sin prefijo es de todos: ya hay `x-verify-*` de otros
 * productos y CDNs, y un nombre genérico se cruzaría con el de un tercero en la cadena de proxies.
 *
 * `verify` porque dice para qué es, y es lo que permite que quien lea un log o un `curl` entienda el
 * pedido sin tener que buscar el código.
 *
 * ## Lo que esta cabecera NO es
 *
 * No autentica al usuario, no da acceso a ningún dato privado y no saltea ninguna regla: solo cambia
 * el bucket del contador (ver `quotaLaneForRequest` y `consumePublicQuota`). Y no está en
 * `AOS_PUBLIC_CORS_ALLOWED_HEADERS`, así que un navegador ajeno no puede mandarla: un `fetch` con
 * esta cabecera dispara un preflight que la lista blanca de CORS no autoriza. El secreto se queda
 * fuera de la web, y a propósito.
 */
export const VERIFY_HEADER = "x-beaos-verify";

/**
 * Divisor del tope global que marca la **concentración** de una sola clave.
 *
 * Es la señal que habría avisado a tiempo del incidente del 2026-09-30: si un único bucket de IP
 * se lleva más de un tercio del cupo del servicio entero, o hay una oficina con NAT (legítimo) o la
 * clave de cliente colapsó en un valor constante y el cupo "por IP" dejó de ser por IP.
 */
export const QUOTA_CONCENTRATION_DIVISOR = 3;

/** Techo de tiempo total del pedido de audit. */
export const DEFAULT_AUDIT_TOTAL_TIMEOUT_MS = 20_000;

/** Timeout por request dentro del audit (el motor hace decenas de pedidos). */
export const DEFAULT_AUDIT_REQUEST_TIMEOUT_MS = 4_000;

export interface PublicAuditLimits {
	perIp: number;
	global: number;
	totalTimeoutMs: number;
	requestTimeoutMs: number;
	ipSalt: string;
	/**
	 * Declara que el único camino al origen es Cloudflare. Ver `clientKeyFromHeaders`.
	 *
	 * Apagado por default a propósito: encendido sin haber restringido el firewall a los rangos de
	 * Cloudflare, `cf-connecting-ip` se vuelve la forma más barata de evadir el cupo por IP.
	 */
	cfOnlyIngress: boolean;
	/**
	 * Secreto de la credencial de verificación (`AOS_PUBLIC_VERIFY_SECRET`), ya recortado.
	 *
	 * **Vacío significa que la función no existe**: sin secreto, todo pedido —con cabecera, sin
	 * cabecera o con una inventada— va al bucket de IP y la respuesta es idéntica a la de antes de
	 * que esto existiera. Ver `verifySecretMatches` y `quotaLaneForRequest`.
	 */
	verifySecret: string;
	/** Cupo diario por IP dentro del bucket `verify` (`AOS_PUBLIC_VERIFY_PER_DAY`). */
	verifyPerIp: number;
}

/** `"true"` o `"1"` encienden; cualquier otra cosa (incluido vacío y ausente) apaga. */
function envFlag(raw: string | undefined): boolean {
	const value = raw?.trim().toLowerCase();
	return value === "true" || value === "1";
}

function positiveInt(raw: string | undefined, fallback: number): number {
	if (raw === undefined || raw.trim().length === 0) return fallback;
	const value = Number(raw);
	if (Number.isFinite(value) === false || value <= 0) return fallback;
	return Math.floor(value);
}

/** Configuración por env, con los defaults documentados. Pura: recibe el mapa de entorno. */
export function publicAuditLimits(env: Record<string, string | undefined> = process.env): PublicAuditLimits {
	return {
		perIp: positiveInt(env.AOS_PUBLIC_AUDITS_PER_DAY, DEFAULT_AUDITS_PER_DAY),
		global: positiveInt(env.AOS_PUBLIC_AUDITS_PER_DAY_GLOBAL, DEFAULT_AUDITS_PER_DAY_GLOBAL),
		totalTimeoutMs: positiveInt(env.AOS_PUBLIC_AUDIT_TOTAL_TIMEOUT_MS, DEFAULT_AUDIT_TOTAL_TIMEOUT_MS),
		requestTimeoutMs: positiveInt(env.AOS_PUBLIC_AUDIT_REQUEST_TIMEOUT_MS, DEFAULT_AUDIT_REQUEST_TIMEOUT_MS),
		ipSalt: env.AOS_PUBLIC_IP_SALT ?? "",
		cfOnlyIngress: envFlag(env.AOS_PUBLIC_CF_ONLY_INGRESS),
		// Se recorta la env para que un espacio o un salto de línea colado en el archivo de entorno no
		// deje la credencial inutilizable. El valor de la cabecera ya llega sin espacios: el protocolo
		// HTTP los quita, así que los dos lados se comparan con la misma regla.
		verifySecret: env.AOS_PUBLIC_VERIFY_SECRET?.trim() ?? "",
		verifyPerIp: positiveInt(env.AOS_PUBLIC_VERIFY_PER_DAY, DEFAULT_VERIFY_AUDITS_PER_DAY),
	};
}

/**
 * ¿La cabecera presentada es la credencial?
 *
 * La comparación es en **tiempo constante** y sobre **digestos del mismo largo**, y las dos partes
 * importan:
 *
 *  · `timingSafeEqual` compara byte a byte sin cortar en la primera diferencia, así que el tiempo de
 *    respuesta no delata cuántos bytes del prefijo acertó quien prueba. Con `===` (o con
 *    `crypto.timingSafeEqual` sobre los strings crudos) el tiempo diría, byte a byte, qué tan cerca
 *    estuvo: es justo la clase de fuga que convierte un secreto largo en uno adivinable por partes.
 *  · `timingSafeEqual` **exige longitudes iguales** y tira si no lo son. Hashear las dos partes a
 *    SHA-256 primero normaliza el largo a 32 bytes, así que un secreto de otro largo no rompe nada
 *    (ni entra por un `try/catch` que alguien podría olvidar) y tampoco se filtra el largo del
 *    secreto real, que es la mitad del trabajo de quien lo adivina.
 *
 * Un secreto vacío apaga la función: devuelve `false` sin comparar, y por lo tanto **no existe**.
 */
export function verifySecretMatches(presented: string | null, secret: string): boolean {
	if (secret.length === 0) return false;
	if (presented === null) return false;
	const presentedDigest = createHash("sha256").update(presented, "utf8").digest();
	const secretDigest = createHash("sha256").update(secret, "utf8").digest();
	return timingSafeEqual(presentedDigest, secretDigest);
}

/**
 * Bucket del contador al que va un pedido.
 *
 * `"ip"` es el cupo público de siempre. `"verify"` es el cupo del verificador, que **solo** se alcanza
 * con la credencial correcta. Cabecera ausente, vacía o equivocada → `"ip"`: el modo de fallar es
 * siempre el público, nunca el privilegiado.
 *
 * La IP se sigue hasheando igual en los dos carriles (`hashClientKey`, en `consumePublicQuota`): lo
 * que cambia entre uno y otro es la cuenta, no la identidad ni las reglas.
 */
export type QuotaLane = "ip" | "verify";

/** El carril de cupo que le corresponde a este pedido, según la cabecera y el secreto configurado. */
export function quotaLaneForRequest(headers: Headers, limits: PublicAuditLimits): QuotaLane {
	return verifySecretMatches(headers.get(VERIFY_HEADER), limits.verifySecret) ? "verify" : "ip";
}

/** Bucket del cupo público por IP en la tabla del contador (`aos_public_usage`). */
export const PUBLIC_QUOTA_BUCKET = "ip";

/**
 * Bucket del verificador. Es el corazón del arreglo: un bucket **distinto**, con su propio tope por
 * IP, para que verificar el despliegue no consuma el cupo de los usuarios reales.
 */
export const VERIFY_QUOTA_BUCKET = "verify";

/** Bucket del contador al que va un carril. Función pura para poder probarlo sin base. */
export function quotaBucketForLane(lane: QuotaLane): string {
	return lane === "verify" ? VERIFY_QUOTA_BUCKET : PUBLIC_QUOTA_BUCKET;
}

/** Tope por IP del carril. Pura, por la misma razón que `quotaBucketForLane`. */
export function quotaLimitForLane(lane: QuotaLane, limits: PublicAuditLimits): number {
	return lane === "verify" ? limits.verifyPerIp : limits.perIp;
}

/** Opciones de la extracción de la IP. Hoy una sola: si Cloudflare es el único ingreso. */
export interface ClientKeyOptions {
	/**
	 * `true` **solo** si el firewall del origen ya restringe el ingreso a los rangos de Cloudflare.
	 * Ver la precedencia completa en `clientKeyFromHeaders`.
	 */
	cfOnlyIngress?: boolean;
}

/**
 * Clave de cliente a partir de las cabeceras.
 *
 * ## Qué llega de verdad (medido, producción, 2026-09-30)
 *
 * El tráfico de la extensión entra `cliente → Traefik (coolify-proxy en contabo-believe) → app`, y
 * el host del endpoint (`beaos.believe-global.com`, el de `BEAOS_API_URL`) **no pasa por
 * Cloudflare**: resuelve a la IP del propio VPS (la misma desde 1.1.1.1, 8.8.8.8 y 9.9.9.9), la
 * respuesta no trae `cf-ray` ni `server: cloudflare`, y el certificado es Let's Encrypt del host.
 *
 * Capturado en la interfaz del contenedor mientras entraba tráfico real (una Chrome de la extensión
 * y un `curl` de prueba), esto es exactamente lo que recibe el endpoint:
 *
 * ```text
 * Host: beaos.believe-global.com
 * X-Forwarded-For: 198.51.100.7     ← un solo salto: la IP real del cliente
 * X-Real-Ip: 198.51.100.7           ← lo mismo
 * X-Forwarded-Proto: https
 * (sin cf-ray, sin cf-connecting-ip, sin `server: cloudflare`)
 * ```
 *
 * (Las IPs de los ejemplos van anonimizadas en los rangos de documentación de la RFC 5737; lo medido
 * es un solo salto, el mismo valor en las dos cabeceras.)
 *
 * Y una petición con `X-Forwarded-For: 1.2.3.4` + `X-Real-IP: 5.6.7.8` + `cf-connecting-ip: 9.9.9.9`
 * llegó así: las dos primeras **sobrescritas** por Traefik con la IP real (corre con
 * `forwardedHeaders.insecure` en false, el default, así que descarta lo que manda el cliente) y
 * `cf-connecting-ip` **intacta, tal cual la escribió el cliente**. O sea: en esta cadena
 * `cf-connecting-ip` no lo emite nadie y cualquiera puede inventarlo.
 *
 * ## Precedencia, en el orden en que entra el tráfico
 *
 * 1. **`cf-connecting-ip`, solo si `cfOnlyIngress` está declarado** (`AOS_PUBLIC_CF_ONLY_INGRESS`).
 *    Detrás de Cloudflare ese header es el correcto: Cloudflare lo sobrescribe en el borde, así que
 *    el cliente no lo controla y el último salto de XFF (la IP del POP) sería el ruido. Pero esa
 *    garantía es **de red, no de cabecera**: un `cf-ray` también se puede escribir a mano desde
 *    afuera, así que la bandera se enciende recién cuando el firewall solo deja entrar a Cloudflare.
 *    Si el header no viniera, cae al paso 2.
 * 2. **El último salto de `x-forwarded-for`**: es el valor que escribe el proxy que sí controlamos.
 *    Con la cadena medida hay un solo salto, así que "último" = la IP del cliente, y no es
 *    falsificable porque Traefik reemplaza la cabecera entera en vez de confiar en la del cliente.
 * 3. **`unknown`**: sin cabecera, todos comparten un bucket. Es el modo de fallar seguro —el cupo por
 *    IP se agota rápido y el tope global, que nunca se toca, sigue siendo la cota real— y la alarma
 *    de `quotaConcentrationWarning` lo delata en los logs.
 */
export function clientKeyFromHeaders(headers: Headers, options: ClientKeyOptions = {}): string {
	if (options.cfOnlyIngress === true) {
		const cloudflare = headers.get("cf-connecting-ip");
		if (cloudflare !== null && cloudflare.trim().length > 0) return normalizeIpText(cloudflare);
	}
	const forwarded = headers.get("x-forwarded-for");
	if (forwarded === null || forwarded.trim().length === 0) return "unknown";
	const hops = forwarded
		.split(",")
		.map((hop) => hop.trim())
		.filter((hop) => hop.length > 0);
	const last = hops.at(-1);
	if (last === undefined) return "unknown";
	return normalizeIpText(last);
}

/** `[::1]`, `1.2.3.4:5678` y `fe80::1%en0` son la misma IP que su forma limpia. */
export function normalizeIpText(raw: string): string {
	let value = raw.trim();
	if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);
	value = value.split("%")[0] ?? value;
	const withPort = /^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/.exec(value);
	if (withPort?.[1] !== undefined) return withPort[1];
	const bracketed = /^\[(.+)\]:\d+$/.exec(raw.trim());
	if (bracketed?.[1] !== undefined) return bracketed[1];
	return value;
}

/**
 * SHA-256 de la clave de cliente. Nunca guardamos la IP en claro: con el hash alcanza para contar y
 * no acumulamos datos personales. La sal (`AOS_PUBLIC_IP_SALT`) es lo que hace que el hash no sea
 * enumerable — un IPv4 sin sal son 2^32 valores y se revierte en segundos.
 */
export function hashClientKey(clientKey: string, salt: string): string {
	return createHash("sha256").update(`${salt}:${clientKey}`).digest("hex");
}

/** Día UTC en `YYYY-MM-DD`: la ventana del límite es el día calendario, no una sliding window. */
export function utcDay(now: Date): string {
	return now.toISOString().slice(0, 10);
}

/** Segundos hasta la próxima medianoche UTC, nunca menos de 1. */
export function secondsUntilUtcMidnight(now: Date): number {
	const nextMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0);
	return Math.max(1, Math.ceil((nextMidnight - now.getTime()) / 1000));
}

/** Un tercio del tope global, redondeado hacia arriba y nunca menor a 1. */
export function quotaConcentrationThreshold(globalLimit: number): number {
	return Math.max(1, Math.ceil(globalLimit / QUOTA_CONCENTRATION_DIVISOR));
}

export interface QuotaConcentration {
	/** Pedidos que ya lleva el bucket de cliente que más consumió hoy. */
	topCount: number;
	globalLimit: number;
	/** Día UTC, para que el aviso diga de cuándo habla. */
	day: string;
	/**
	 * Bucket del que habla el aviso (`ip` o `verify`), cuando quien lo llama lo sabe.
	 *
	 * Va aparte porque la lectura es distinta: un bucket `ip` concentrado delata el bug (la clave de
	 * cliente colapsó en un valor constante) o un NAT; uno `verify` concentrado es una corrida de
	 * verificación con credencial, que es esperable. Sin el nombre, quien lee el log no puede
	 * distinguirlas y la alarma pierde lo único que la hace accionable.
	 */
	bucket?: string;
}

/**
 * Alarma de concentración: el texto que va al log cuando **una sola clave** se está llevando el
 * servicio por delante, o `null` si todavía no.
 *
 * Es a propósito un **aviso, no un bloqueo**. Dos casos legítimos producen la misma señal (una
 * oficina entera detrás de un NAT, un cliente que de verdad audita mucho), así que la decisión de
 * cortar no se automatiza: se le cuenta a quien opera, con el número y el día, para que mire de
 * dónde sale la IP antes de tocar el cupo.
 *
 * Lo que sí distingue sin ambigüedad es el caso que ya nos pasó: si la clave colapsó en un valor
 * constante —un proxy nuevo, una cabecera que desaparece—, **todos** los pedidos del mundo entran en
 * un bucket y este umbral se cruza mucho antes que el tope global, que es justo lo que se quiere
 * ver venir.
 */
export function quotaConcentrationWarning(input: QuotaConcentration): string | null {
	const threshold = quotaConcentrationThreshold(input.globalLimit);
	if (input.topCount < threshold) return null;
	const where =
		input.bucket === undefined ? "un solo bucket de IP" : `el bucket \`${input.bucket}\` de un solo cliente`;
	return (
		`[aos-public] ALERTA de concentración: ${where} lleva ${input.topCount} pedidos de los ` +
		`${input.globalLimit} del tope global (umbral ${threshold}) el ${input.day}. O es un cliente detrás de NAT ` +
		"(legítimo), o es la corrida de verificación con credencial (esperada), o la clave de cliente colapsó en " +
		"un valor constante y el cupo por IP dejó de ser por IP. Revisá de dónde sale la IP " +
		"(AOS_PUBLIC_CF_ONLY_INGRESS / cabeceras del proxy) antes de tocar el cupo."
	);
}

export type QuotaReason = "ok" | "ip_limit" | "global_limit";

export interface QuotaDecision {
	allowed: boolean;
	reason: QuotaReason;
	/** Cupo que corresponde a la política que decide (la del bloqueo, o la de la IP). */
	limit: number;
	/** Pedidos que le quedan a esta IP después de este, acotado también por el tope global. */
	remaining: number;
	resetSeconds: number;
	/** Solo cuando se rechaza: lo que hay que esperar. */
	retryAfterSeconds: number | null;
}

export interface QuotaSnapshot {
	/** Pedidos ya consumidos por este cliente hoy, antes de este pedido. */
	ipCount: number;
	/** Pedidos ya consumidos en total hoy, antes de este pedido. */
	globalCount: number;
	ipLimit: number;
	globalLimit: number;
	now: Date;
}

/**
 * La decisión del límite, en una función.
 *
 * El tope global se evalúa primero: cuando los dos están pasados, el motivo que se reporta es el
 * global, porque es el que de verdad frena el servicio. `remaining` toma el mínimo de los dos cupos
 * para que las cabeceras nunca prometan más de lo que el sistema va a honrar.
 */
export function decidePublicQuota(snapshot: QuotaSnapshot): QuotaDecision {
	const globalExceeded = snapshot.globalCount >= snapshot.globalLimit;
	const ipExceeded = snapshot.ipCount >= snapshot.ipLimit;
	const allowed = globalExceeded === false && ipExceeded === false;
	const reason: QuotaReason = globalExceeded ? "global_limit" : ipExceeded ? "ip_limit" : "ok";
	const resetSeconds = secondsUntilUtcMidnight(snapshot.now);
	return {
		allowed,
		reason,
		limit: reason === "global_limit" ? snapshot.globalLimit : snapshot.ipLimit,
		remaining: allowed
			? Math.max(0, Math.min(snapshot.ipLimit - snapshot.ipCount - 1, snapshot.globalLimit - snapshot.globalCount - 1))
			: 0,
		resetSeconds,
		retryAfterSeconds: allowed ? null : resetSeconds,
	};
}

/**
 * Las cinco cabeceras del contrato (draft-ietf-httpapi-ratelimit-headers + la tríada clásica), y
 * `Retry-After` **solo** cuando se rechaza, que es cuando tiene sentido esperar.
 *
 * **El cupo que reflejan es el que decide, no siempre el público.** Con la credencial de verificación
 * válida, `RateLimit-Limit` dice el cupo de `verify` y `RateLimit-Remaining` lo que le queda a esa IP
 * dentro de ese bucket. Se eligió así porque unas cabeceras que dijeran 20 mientras el pedido se
 * decide contra 1000 serían una mentira del contrato: quien tiene la credencial vería `Remaining: 0`
 * con el cupo de `verify` intacto, o al revés.
 *
 * ¿Delata el bucket? No a quien no corresponde: la diferencia **solo** es observable presentando el
 * secreto correcto, o sea por alguien que ya está autorizado a saberlo. Sin cabecera, con cabecera
 * equivocada o con la función apagada, estas cabeceras son exactamente las de hoy. Y la política sigue
 * llamándose `aos-audit` en los dos carriles: no se anuncia un bucket nuevo ni se cambia el contrato.
 */
export function rateLimitHeaders(
	decision: QuotaDecision,
	policy: string = PUBLIC_AUDIT_POLICY,
): Record<string, string> {
	const headers: Record<string, string> = {
		"RateLimit-Policy": `"${policy}";q=${decision.limit};w=${QUOTA_WINDOW_SECONDS}`,
		RateLimit: `"${policy}";r=${decision.remaining};t=${decision.resetSeconds}`,
		"RateLimit-Limit": String(decision.limit),
		"RateLimit-Remaining": String(decision.remaining),
		"RateLimit-Reset": String(decision.resetSeconds),
	};
	if (decision.retryAfterSeconds !== null) headers["Retry-After"] = String(decision.retryAfterSeconds);
	return headers;
}

/** Cabeceras del 429: las mismas cinco más el `Retry-After`. */
export function rateLimitedResponse(decision: QuotaDecision, message: string): Response {
	return Response.json({ error: "Too Many Requests", message }, { status: 429, headers: rateLimitHeaders(decision) });
}

/** Mezcla las cabeceras de límite en una respuesta que ya existe. */
export function withRateLimitHeaders(response: Response, decision: QuotaDecision): Response {
	for (const [name, value] of Object.entries(rateLimitHeaders(decision))) {
		response.headers.set(name, value);
	}
	return response;
}

/**
 * Validación de la URL pública: la del guardián anti-SSRF, sin aflojar nada. Vive acá para que la
 * ruta y sus tests tengan un único punto de entrada.
 *
 * La forma sí se tolera: un dominio pelado (`ejemplo.com`, `ejemplo.com/precios`) entra como
 * `https://ejemplo.com`. El destino, no: sigue pasando por el guardián completo.
 *
 * Devuelve el resultado **textual** (`UrlTextGuardResult`), no el de `assertSafeAuditUrl`: acá no se
 * resolvió DNS, así que no hay direcciones validadas que prometer.
 */
export function validatePublicAuditUrl(raw: string): UrlTextGuardResult {
	return validateAuditUrl(raw);
}

/**
 * Códigos del rechazo de una dirección, para el cuerpo del 400.
 *
 * Existen porque los dos motivos son **distintos y no se pueden confundir**: `invalid_url` es "no
 * pudimos interpretar eso como una dirección" (un error de forma, que el usuario arregla
 * escribiéndola bien) y `blocked_url` es "esa dirección queda afuera por seguridad" (un destino
 * interno, que no se arregla reescribiéndolo). El texto solo ya se confundía: la extensión 2.1.0
 * mapeaba *cualquier* 400 al texto del guardián, así que un error de parseo se le mostraba al
 * usuario como si hubiera auditado `localhost`.
 *
 * Va **al lado** de `error` y `message`, no en su lugar: el contrato de éxito y las claves que ya
 * viajaban quedan igual.
 */
export type PublicAuditErrorCode = "invalid_url" | "blocked_url";

export interface PublicAuditUrlRejection {
	code: PublicAuditErrorCode;
	message: string;
}

/**
 * Traduce el rechazo del guardián a lo que el 400 le dice al cliente.
 *
 * `blocked` no publica el motivo real: contarlo revelaría qué resolvió nuestro DNS. `unresolved` se
 * trata igual que `blocked` de cara al cliente —desde afuera, "no resuelve" y "resuelve a algo
 * interno" no se distinguen— y el detalle queda en el log del servidor.
 */
export function classifyPublicAuditUrlFailure(failure: {
	kind: "invalid" | "blocked" | "unresolved";
	reason: string;
}): PublicAuditUrlRejection {
	if (failure.kind === "invalid") {
		return {
			code: "invalid_url",
			message:
				"No pudimos interpretar esa dirección. Probá con una URL (https://ejemplo.com) o un dominio (ejemplo.com).",
		};
	}
	return {
		code: "blocked_url",
		message: "No auditamos URLs que apunten a una red interna.",
	};
}

/** Cuerpo del audit público. */
export const publicAuditBody = z.object({
	url: z.string("url is required").trim().min(1, "url is required").max(2048, "url must be at most 2048 characters"),
});

/**
 * Cuerpo del formulario de lead.
 *
 * El mail se normaliza **antes** de validarlo: si el formato se chequea primero, un espacio de más
 * al pegar la dirección convierte un lead en un 400. Se guarda en minúsculas para que el mismo mail
 * no entre dos veces con distinta capitalización.
 */
export const publicLeadBody = z.object({
	email: z
		.string("email is required")
		.transform((value) => value.trim().toLowerCase())
		.pipe(z.email("email must be a valid address").max(320, "email is too long")),
	name: z.string().trim().max(200, "name is too long").optional(),
	company: z.string().trim().max(200, "company is too long").optional(),
	/** URL auditada, cuando el lead sale del resultado de un audit. */
	url: z.string().trim().max(2048, "url is too long").optional(),
	/** Score que estaba viendo el usuario, para priorizar el seguimiento. */
	score: z.int("score must be an integer").min(0).max(100).optional(),
});

/** Requerimiento tal como lo devuelve el motor, con los diagnósticos incluidos. */
export type PublicAuditRequirements = RequirementResult[];

/** El desglose por eje, tal cual lo calcula el motor. El endpoint no lo recalcula ni lo redondea. */
export type PublicAuditBreakdown = AxisBreakdown[];

/**
 * Tráfico agéntico real observado sobre la URL auditada.
 *
 * **HOY SIEMPRE ES `null`, y es a propósito.** En Maasy este bloque salía de su propio instrumento:
 * una tabla `bot_beacon_hits` que se llenaba con los user-agents que pasaban por los sitios que
 * Maasy instrumenta (clasificados por `_shared/bot-detection.ts`: GPTBot, Claude-User…) más los
 * intentos terminales de `aos_operator_tasks`, agregados por dominio por la función
 * `bot_beacon_summary(domain, days)`.
 *
 * Eso es dato **de Maasy, no del sitio**: existe solo para dominios por los que ya pasó su tráfico.
 * BeAOS no tiene ningún ingest de tráfico agéntico — ni tabla, ni middleware, ni clasificador de
 * user-agents — así que para una URL arbitraria no hay nada que medir. Devolver ceros, o un número
 * derivado de otra cosa, sería inventar un dato de venta. El hueco se declara: el campo existe, está
 * tipado, y su valor es `null` mientras no haya una fuente real que lo llene.
 *
 * Lo que sí es real y verificable sobre el perfil del sitio es `declaredAps`, `claims` y
 * `signatureVerified`, que sí viajan.
 */
export interface PublicBotBeacon {
	windowDays: number;
	/** Hits de crawl de agentes IA en la ventana. */
	crawlHits: number;
	distinctAgents: number;
	topAgents: { agentName: string; category: string | null; hits: number }[];
	/** Intentos de operación con agente, y cuántos terminaron mal. */
	operationAttempts: number;
	operationFailures: number;
}

export interface PublicAuditResponse {
	url: string;
	score: number;
	band: string;
	businessType: AosAuditResult["businessType"];
	requirements: PublicAuditRequirements;
	/**
	 * Sub-scores por eje, del motor. `aosStandards` es el mismo número que `score` (el AOS es el
	 * puntaje de operabilidad); `apsStandards` es el **APS del estándar**: cuántos requisitos del eje
	 * APS cumple el sitio —claim/proofs publicados y firma verificable—, o sea un chequeo del sitio y
	 * **no** una medición contra modelos. Tampoco es `declaredAps`, que es lo que el sitio declara
	 * sobre sí mismo.
	 *
	 * Son **tres** números distintos que se llaman "APS" y ninguno es el otro: el declarado (lo que el
	 * sitio firma), este (los requisitos del estándar que cumple) y el medido (una corrida real contra
	 * modelos, que cuesta plata y no vive acá). El nombre del campo no cambia porque la extensión y la
	 * landing ya lo consumen así: lo que cambia es cómo se muestra y cómo se documenta.
	 */
	aosStandards: number;
	apsStandards: number;
	/** El desglose por eje: inventario del peso ganado y del que aplica, por eje. */
	breakdown: PublicAuditBreakdown;
	/**
	 * APS que el sitio declara en su `/.well-known/brand.json`; `null` si no lo publica.
	 */
	declaredAps: number | null;
	/** Cuántos claims declara su brand.json. Cero si no publica ninguno. */
	claims: number;
	/** ¿La firma Ed25519 de su brand.json verifica contra el `keys.json` que él mismo publica? */
	signatureVerified: boolean;
	/**
	 * Tráfico agéntico observado. **Siempre `null` hoy**: BeAOS no instrumenta el tráfico de sitios
	 * de terceros. El campo viaja para que el hueco sea explícito y verificable en vez de silencioso.
	 */
	botBeacon: PublicBotBeacon | null;
	auditedAt: string;
}

/**
 * Traduce el resultado del motor a la respuesta pública.
 *
 * Devuelve exactamente lo que el motor midió más lo que el sitio publica sobre sí mismo: nada de
 * esto es dato privado nuestro, y por eso el endpoint puede ser anónimo.
 *
 * Todo lo que se agrega es **aditivo**: los campos que la extensión 2.0.0 ya leía (`url`, `score`,
 * `band`, `businessType`, `requirements`, `declaredAps`, `claims`, `signatureVerified`, `auditedAt`)
 * conservan nombre y forma.
 */
export function publicAuditResponse(result: AosAuditResult, auditedAt: Date): PublicAuditResponse {
	return {
		url: result.url,
		score: result.score,
		band: result.band,
		businessType: result.businessType,
		// Los diagnósticos viajan con los puntuados, igual que en la fila que guarda el worker.
		requirements: [...result.standards.requirements, ...result.extended],
		aosStandards: result.standards.aos_standards,
		apsStandards: result.standards.aps_standards,
		breakdown: result.standards.breakdown,
		declaredAps: result.aps?.aps ?? null,
		claims: result.aps?.claims ?? 0,
		signatureVerified: result.standards.signature_verified,
		// Sin ingest de tráfico agéntico no hay dato. Ver `PublicBotBeacon`.
		botBeacon: null,
		auditedAt: auditedAt.toISOString(),
	};
}
