/**
 * POST /api/v1/aos/lead — el formulario de la extensión pública.
 *
 * "Dejanos tu mail y te contactamos": en Maasy esto iba a un Supabase propio
 * (`landing-lead-capture`); acá queda en nuestra base para que Believe lo siga.
 *
 * Público y sin sesión, con el mismo límite por IP que el audit y el mismo tope global, porque un
 * formulario abierto sin cota es un buzón de spam. La respuesta es siempre `{ ok: true }`: no
 * devolvemos ni confirmamos nada del lead.
 *
 * **CORS**: lo manda el widget de la landing **desde el navegador del visitante**, con la misma lista
 * blanca que el audit (`AOS_PUBLIC_CORS_ORIGINS`). El porqué de que la llamada viva en el navegador
 * está en `@/lib/aos/public-cors`.
 */
import { createFileRoute } from "@tanstack/react-router";
import { db } from "@workspace/lib/db/db";
import { aosPublicLeads } from "@workspace/lib/db/schema";
import {
	clientKeyFromHeaders,
	decidePublicQuota,
	hashClientKey,
	publicAuditLimits,
	publicLeadBody,
	rateLimitedResponse,
	rateLimitHeaders,
} from "@/lib/aos/public-audit";
import { publicCorsPreflightResponse, withPublicCorsHandler } from "@/lib/aos/public-cors";
import { consumePublicQuota } from "@/lib/aos/public-limit.server";
import { createPublicApiHandler } from "@/lib/api/handler";

/** Un texto vacío es "no lo dejó", no un dato: se guarda como NULL. */
function orNull(value: string | undefined): string | null {
	return value === undefined || value.length === 0 ? null : value;
}

export const Route = createFileRoute("/api/v1/aos/lead")({
	server: {
		handlers: {
			// Preflight del formulario, igual que el del audit: 204, y las cabeceras solo al origen
			// permitido. El POST va con `content-type: application/json`, que es lo que se declara.
			OPTIONS: ({ request }) => publicCorsPreflightResponse(request),

			POST: withPublicCorsHandler(
				createPublicApiHandler({
					body: publicLeadBody,
					handle: async ({ body, request }): Promise<Response> => {
						const limits = publicAuditLimits();
						const clientKey = clientKeyFromHeaders(request.headers, { cfOnlyIngress: limits.cfOnlyIngress });
						const snapshot = await consumePublicQuota(clientKey, limits);
						const quota = decidePublicQuota(snapshot);
						if (quota.allowed === false) {
							const message =
								quota.reason === "global_limit"
									? "El servicio alcanzó su tope diario. Probá mañana."
									: `Alcanzaste el límite de ${quota.limit} envíos por día.`;
							return rateLimitedResponse(quota, message);
						}

						await db.insert(aosPublicLeads).values({
							email: body.email,
							name: orNull(body.name),
							company: orNull(body.company),
							url: orNull(body.url),
							score: body.score ?? null,
							// Nunca la IP en claro: el hash alcanza para detectar abuso y no acumula el dato.
							ipHash: hashClientKey(clientKey, limits.ipSalt),
						});

						return Response.json({ ok: true }, { headers: rateLimitHeaders(quota) });
					},
				}),
			),
		},
	},
});
