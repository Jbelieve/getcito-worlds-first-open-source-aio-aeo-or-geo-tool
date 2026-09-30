/**
 * POST /api/v1/aos/audit — la auditoría pública de BeAOS.
 *
 * Audita **cualquier URL** que mande el cliente y devuelve el AOS medido por el motor que ya usa el
 * worker (`@workspace/aos-aps/aos`), más lo que el propio sitio declara de sí mismo en su
 * `/.well-known/brand.json`: cuántos claims publica y si su firma Ed25519 verifica contra el
 * `keys.json` que él mismo sirve. Ese último dato es el diferenciador frente a la extensión vieja.
 *
 * Sin credencial y sin sesión, a propósito: la herramienta es pública. Lo que la sostiene no es un
 * token sino un límite diario por IP más un tope global, y un guardián anti-SSRF, porque acá el
 * servidor termina pidiendo URLs arbitrarias que manda un desconocido.
 *
 * **Credencial de verificación**: además del cupo público, hay una cabecera opcional
 * (`x-beaos-verify`, ver `@/lib/aos/public-audit`) que mueve el pedido a un bucket propio. Existe
 * porque el equipo y quien verifica el despliegue salen por la misma IP pública que los usuarios: sin
 * esto, una corrida de comprobación agota el cupo por IP de todos y el medidor deja de funcionar para
 * quien lo va a usar. No es un bypass —cambia la cuenta del contador, no las reglas: la IP se hashea
 * igual, el tope de `verify` la acota, y el tope global del servicio se gasta igual— y sin
 * `AOS_PUBLIC_VERIFY_SECRET` la cabecera no existe.
 *
 * No persiste nada: es una medición al paso, no una marca del sistema.
 *
 * **CORS**: la landing pública ("mide tu web") llama a este endpoint **desde el navegador del
 * visitante**, y por eso el POST y el preflight salen con la lista blanca de `AOS_PUBLIC_CORS_ORIGINS`.
 * El porqué de que la llamada viva en el navegador —y no en el backend de la landing— está escrito
 * en `@/lib/aos/public-cors`, que es donde se define la lista. No lo muevas sin leerlo.
 */
import { createFileRoute } from "@tanstack/react-router";
import { assertSafeAuditUrl, runAosAudit } from "@workspace/aos-aps/aos";
import {
	classifyPublicAuditUrlFailure,
	clientKeyFromHeaders,
	decidePublicQuota,
	type PublicAuditResponse,
	publicAuditBody,
	publicAuditLimits,
	publicAuditResponse,
	quotaLaneForRequest,
	rateLimitedResponse,
	rateLimitHeaders,
	validatePublicAuditUrl,
} from "@/lib/aos/public-audit";
import { publicCorsPreflightResponse, withPublicCorsHandler } from "@/lib/aos/public-cors";
import { consumePublicQuota } from "@/lib/aos/public-limit.server";
import { ApiError, createPublicApiHandler } from "@/lib/api/handler";

/**
 * Techo de tiempo total del pedido.
 *
 * El motor ya acota cada request (`timeoutMs`), pero hace decenas: sin un techo propio del endpoint
 * un sitio que responde lento en cada path puede estirar la respuesta mucho más de lo razonable.
 *
 * LÍMITE CONOCIDO: `runAosAudit` no acepta un `AbortSignal`, así que esto solo corta la *respuesta*;
 * los pedidos en vuelo siguen hasta su propio timeout por request. Cerrarlo bien pide propagar una
 * señal de cancelación por todo el motor.
 */
function totalTimeout(ms: number): { promise: Promise<never>; cancel: () => void } {
	let timer: ReturnType<typeof setTimeout> | undefined;
	const promise = new Promise<never>((_resolve, reject) => {
		timer = setTimeout(() => {
			reject(new ApiError(504, "Gateway Timeout", "La auditoría tardó demasiado. Probá de nuevo."));
		}, ms);
	});
	return { promise, cancel: () => clearTimeout(timer) };
}

export const Route = createFileRoute("/api/v1/aos/audit")({
	server: {
		handlers: {
			// El preflight del navegador: 204, con las cabeceras del contrato solo si el origen está
			// en la lista blanca. Un origen ajeno recibe el 204 pelado y su navegador corta el POST.
			OPTIONS: ({ request }) => publicCorsPreflightResponse(request),

			POST: withPublicCorsHandler(
				createPublicApiHandler({
					body: publicAuditBody,
					handle: async ({ body, request }): Promise<Response> => {
						const limits = publicAuditLimits();

						// 1. Validación barata y textual: si la URL está mal no gastamos cupo ni salimos a la red.
						//    Un dominio pelado se interpreta como `https://…` acá y sigue el camino normal: se
						//    tolera la forma, nunca el destino.
						const textual = validatePublicAuditUrl(body.url);
						if (textual.ok === false) {
							const rejection = classifyPublicAuditUrlFailure(textual);
							// El `code` distingue "no se pudo interpretar" de "queda afuera por seguridad". Sin él,
							// la extensión 2.1.0 le mostraba a un error de parseo el texto del guardián anti-SSRF.
							return Response.json(
								{ error: "Bad Request", message: rejection.message, code: rejection.code },
								{ status: 400 },
							);
						}

						// 2. El guardián anti-SSRF, con resolución DNS: el hostname tiene que resolver a
						//    direcciones públicas, no alcanza con que el texto no diga "localhost".
						const safe = await assertSafeAuditUrl(body.url);
						if (safe.ok === false) {
							const rejection = classifyPublicAuditUrlFailure(safe);
							// Un destino interno se rechaza sin contarle al cliente qué resolvió nuestro DNS.
							console.warn(`[aos-public] audit rechazado (${safe.kind}): ${safe.reason}`);
							return Response.json(
								{ error: "Bad Request", message: rejection.message, code: rejection.code },
								{ status: 400 },
							);
						}

						// 3. El cupo. Se gasta recién cuando el pedido es auditable de verdad.
						//    `cfOnlyIngress` sale de la env: apagado (lo medido hoy, el origen es alcanzable
						//    directo) la identidad es el salto que escribe Traefik; encendido, Cloudflare.
						//
						//    El carril sale de la credencial de verificación (`x-beaos-verify`). Sin
						//    `AOS_PUBLIC_VERIFY_SECRET` —o con la cabecera ausente o equivocada— el carril es
						//    `ip` y esta rama es idéntica a la de antes de que la credencial existiera: ese es
						//    el modo de fallar, y es el público. Ver `quotaLaneForRequest`.
						const snapshot = await consumePublicQuota(
							clientKeyFromHeaders(request.headers, { cfOnlyIngress: limits.cfOnlyIngress }),
							limits,
							quotaLaneForRequest(request.headers, limits),
						);
						const quota = decidePublicQuota(snapshot);
						if (quota.allowed === false) {
							const message =
								quota.reason === "global_limit"
									? "El audit público alcanzó su tope diario. Probá mañana."
									: `Alcanzaste el límite de ${quota.limit} auditorías por día.`;
							return rateLimitedResponse(quota, message);
						}

						// 4. El motor, tal como lo corre el worker. No se reescribe nada de la lógica.
						const { promise: timeout, cancel } = totalTimeout(limits.totalTimeoutMs);
						let result: Awaited<ReturnType<typeof runAosAudit>>;
						try {
							result = await Promise.race([
								runAosAudit({ url: safe.url.toString(), timeoutMs: limits.requestTimeoutMs }),
								timeout,
							]);
						} catch (error) {
							if (error instanceof ApiError) {
								return Response.json(
									{ error: error.error, message: error.message },
									{ status: error.status, headers: rateLimitHeaders(quota) },
								);
							}
							// El motor no falla por un sitio caído (sus probes devuelven null): llegar acá es un
							// bug nuestro o el caso raro de un DNS que cambió entre la validación y el pedido.
							console.error(`[aos-public] audit de ${safe.url.toString()} falló:`, error);
							throw error;
						} finally {
							cancel();
						}

						const payload: PublicAuditResponse = publicAuditResponse(result, new Date());
						return Response.json(payload, { headers: rateLimitHeaders(quota) });
					},
				}),
			),
		},
	},
});
