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
 * No persiste nada: es una medición al paso, no una marca del sistema.
 */
import { createFileRoute } from "@tanstack/react-router";
import { assertSafeAuditUrl, runAosAudit } from "@workspace/aos-aps/aos";
import {
	clientKeyFromHeaders,
	decidePublicQuota,
	type PublicAuditResponse,
	publicAuditBody,
	publicAuditLimits,
	publicAuditResponse,
	rateLimitedResponse,
	rateLimitHeaders,
	validatePublicAuditUrl,
} from "@/lib/aos/public-audit";
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
			POST: createPublicApiHandler({
				body: publicAuditBody,
				handle: async ({ body, request }): Promise<Response> => {
					const limits = publicAuditLimits();

					// 1. Validación barata y textual: si la URL está mal no gastamos cupo ni salimos a la red.
					const textual = validatePublicAuditUrl(body.url);
					if (textual.ok === false) {
						throw new ApiError(400, "Bad Request", textual.reason);
					}

					// 2. El guardián anti-SSRF, con resolución DNS: el hostname tiene que resolver a
					//    direcciones públicas, no alcanza con que el texto no diga "localhost".
					const safe = await assertSafeAuditUrl(body.url);
					if (safe.ok === false) {
						// Un destino interno se rechaza sin contarle al cliente qué resolvió nuestro DNS.
						if (safe.kind === "blocked") {
							console.warn(`[aos-public] audit rechazado (${safe.kind}): ${safe.reason}`);
							throw new ApiError(400, "Bad Request", "No auditamos URLs que apunten a una red interna.");
						}
						throw new ApiError(400, "Bad Request", safe.reason);
					}

					// 3. El cupo. Se gasta recién cuando el pedido es auditable de verdad.
					const snapshot = await consumePublicQuota(clientKeyFromHeaders(request.headers), limits);
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
		},
	},
});
