/**
 * POST /api/v1/enroll — el canje del código de conexión por el token del sitio.
 *
 * **Público, sin credencial, a propósito.** El que llama es un WordPress recién instalado que todavía
 * no tiene token: el código *es* la credencial. Por eso este endpoint no puede exigir `ADMIN_API_KEYS`
 * —sería mandar la llave maestra al sitio del cliente, que es exactamente lo que este flujo existe
 * para evitar— ni un token de producto, que es justamente lo que viene a buscar.
 *
 * Lo que lo sostiene en lugar de una credencial previa son dos cosas, y ninguna es opcional:
 *
 * 1. **El código se canjea una sola vez.** La marca de uso es una sola sentencia atómica
 *    (`redeemEnrollmentCode`, en `@/lib/enrollment.server`) dentro de la misma transacción que emite
 *    el token. Dos canjes simultáneos no pueden ganar los dos.
 * 2. **Límite por IP y tope del servicio**, reusando el contador del audit público: el mismo
 *    `aos_public_usage`, el mismo hash de la IP, el mismo día UTC y las mismas cabeceras
 *    `RateLimit-*`, con un bucket propio (`enroll`). `lane: "enroll"` en `consumePublicQuota`.
 *
 * La respuesta trae `{ token, brandId, entityId }` **una sola vez**: el token no se guarda en claro y
 * no se puede volver a pedir. Si el WordPress lo pierde, se genera otro código.
 *
 * El rechazo es **un solo mensaje** para los tres motivos —inexistente, vencido, ya usado—: decir cuál
 * de los tres fue le confirmaría a quien prueba si el código existió. El motivo real queda en el log.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
	clientKeyFromHeaders,
	decidePublicQuota,
	ENROLL_POLICY,
	publicAuditLimits,
	rateLimitedResponse,
	rateLimitHeaders,
} from "@/lib/aos/public-audit";
import { consumePublicQuota } from "@/lib/aos/public-limit.server";
import { createPublicApiHandler } from "@/lib/api/handler";
import { ENROLLMENT_REJECTION_ERROR, ENROLLMENT_REJECTION_MESSAGE } from "@/lib/enrollment";
import { redeemEnrollmentCode } from "@/lib/enrollment.server";

/**
 * Cuerpo del canje. El tope de largo es 200 y no 38 (el largo real del código) a propósito: un código
 * mal copiado con espacios o con un salto de línea tiene que llegar al rechazo del canje —un 400 con
 * el mensaje único— y no morir en la validación del esquema con un mensaje que hable de largos.
 * Así el atacante tampoco puede distinguir "formato raro" de "no existe".
 */
export const enrollBody = z.object({
	code: z.string("code is required").trim().min(1, "code is required").max(200, "code is too long"),
});

export const Route = createFileRoute("/api/v1/enroll")({
	server: {
		handlers: {
			POST: createPublicApiHandler({
				body: enrollBody,
				handle: async ({ body, request }): Promise<Response> => {
					const limits = publicAuditLimits();

					// 1. El cupo, ANTES de tocar la base. Se gasta en cada intento, incluso en uno que va a
					//    fallar: si solo contaran los aciertos, probar códigos sería gratis y el límite no
					//    frenaría nada. Es el mismo `consumePublicQuota` del audit, con el carril `enroll`.
					const snapshot = await consumePublicQuota(
						clientKeyFromHeaders(request.headers, { cfOnlyIngress: limits.cfOnlyIngress }),
						limits,
						"enroll",
					);
					const quota = decidePublicQuota(snapshot);
					if (quota.allowed === false) {
						const message =
							quota.reason === "global_limit"
								? "El canje de códigos alcanzó su tope diario. Probá más tarde."
								: `Alcanzaste el límite de ${quota.limit} intentos de conexión por día.`;
						return rateLimitedResponse(quota, message, ENROLL_POLICY);
					}

					// 2. El canje. Devuelve el token una sola vez, o nada.
					const result = await redeemEnrollmentCode(body.code);
					if (result.status === "notfound") {
						// El motivo real —inexistente, vencido o ya usado— no viaja: ver el comentario de arriba.
						console.warn(`[enroll] código rechazado (prefijo ${body.code.slice(0, 8)}…)`);
						return Response.json(
							{ error: ENROLLMENT_REJECTION_ERROR, message: ENROLLMENT_REJECTION_MESSAGE },
							{ status: 400, headers: rateLimitHeaders(quota, ENROLL_POLICY) },
						);
					}

					return Response.json(
						{ token: result.token, brandId: result.brandId, entityId: result.entityId },
						{ headers: rateLimitHeaders(quota, ENROLL_POLICY) },
					);
				},
			}),
		},
	},
});
