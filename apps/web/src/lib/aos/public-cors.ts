/**
 * CORS de las dos superficies públicas de AOS: `/api/v1/aos/audit` y `/api/v1/aos/lead`.
 *
 * ## Por qué esto existe: el widget llama desde el NAVEGADOR, no desde el backend
 *
 * El "mide tu web" de la landing pide el AOS **desde el navegador del visitante**, con `fetch`
 * contra `POST /api/v1/aos/audit`. Eso es una decisión, no un detalle de implementación.
 *
 * El cupo del audit es **por IP** (más un tope global). Si la landing llamara al endpoint desde su
 * propio backend, todos los visitantes llegarían con la IP del servidor de la landing: el cupo
 * diario sería uno solo para todo el mundo y el medidor se agotaría con los primeros que lo usen.
 * Llamando desde el navegador, cada visitante gasta **su propia IP** y el cupo se reparte solo, que
 * es exactamente como está dimensionado.
 *
 * Y por eso hace falta CORS: una página web no tiene los privilegios de `host_permissions` que sí
 * tiene la extensión. Sin `Access-Control-Allow-Origin`, el navegador del visitante **recibe** la
 * respuesta pero no puede leerla. La extensión no necesita nada de esto y no se toca.
 *
 * ⚠️ NO muevas esta llamada al backend de la landing "para evitar el CORS". El CORS se resuelve con
 * esta lista blanca; el cupo por IP no se resuelve de ninguna otra forma.
 *
 * ## Lista blanca, no `*`
 *
 * El origen se compara **exacto** contra `AOS_PUBLIC_CORS_ORIGINS` (separada por comas). Ni `*` ni
 * prefijos ni normalización: `https://be-aos.believe-global.com.evil.com`, la misma URL en `http://`
 * y la misma en MAYÚSCULAS quedan afuera. Los navegadores mandan el `Origin` ya normalizado en
 * minúsculas, así que la comparación exacta no le saca nada a un cliente legítimo y sí cierra los
 * parecidos.
 *
 * Un origen que no está en la lista **no recibe ninguna cabecera CORS**, pero el pedido se procesa
 * igual: el servidor no es un portero y la lista blanca no es autenticación. Lo único que logra un
 * tercero es que **su** navegador no pueda leer nuestra respuesta; no queremos que un sitio ajeno
 * embeba nuestro medidor y se quede con el cupo.
 *
 * Y nada de `Access-Control-Allow-Credentials`: estos endpoints no tienen cookies ni sesión, así que
 * no hace falta habilitar credenciales.
 */

/** Nombre de la env que define la lista blanca. Registrada en `packages/config/src/env-registry.ts`. */
export const AOS_PUBLIC_CORS_ORIGINS_ENV = "AOS_PUBLIC_CORS_ORIGINS";

/**
 * Orígenes nuestros, los cuatro de siempre: el host de la landing, su `www`, y el dominio raíz de
 * Believe con y sin `www`.
 */
export const DEFAULT_AOS_PUBLIC_CORS_ORIGINS: readonly string[] = [
	"https://be-aos.believe-global.com",
	"https://www.be-aos.believe-global.com",
	"https://believe-global.com",
	"https://www.believe-global.com",
];

/** Cuánto puede cachear el navegador el preflight: un día, que es lo que dura este contrato. */
export const AOS_PUBLIC_PREFLIGHT_MAX_AGE_SECONDS = 86_400;

/** Métodos y cabeceras que declara el preflight. El POST lleva `content-type: application/json`. */
export const AOS_PUBLIC_CORS_METHODS = "POST, OPTIONS";
export const AOS_PUBLIC_CORS_ALLOWED_HEADERS = "content-type";

/** Un mapa de cabeceras plano. El `Response` de la plataforma lo normaliza a minúsculas. */
export type CorsHeaderMap = Record<string, string>;

/** El entorno, tal como llega a `process.env`: un mapa de strings opcionales. */
export type CorsEnv = Record<string, string | undefined>;

/**
 * Parte la lista de la env. Ausente o vacía cae al default, igual que el resto de la config de AOS
 * (ver `publicAuditLimits`): un `""` accidental no puede dejar al widget sin poder leer su propia
 * respuesta.
 */
export function parseCorsOrigins(raw: string | undefined, fallback: readonly string[]): string[] {
	if (raw === undefined) return [...fallback];
	const origins = [
		...new Set(
			raw
				.split(",")
				.map((origin) => origin.trim())
				.filter((origin) => origin.length > 0),
		),
	];
	return origins.length === 0 ? [...fallback] : origins;
}

/** Lee la lista blanca de la env. */
export function aosPublicCorsOrigins(
	env: CorsEnv = process.env,
	fallback: readonly string[] = DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
): string[] {
	return parseCorsOrigins(env[AOS_PUBLIC_CORS_ORIGINS_ENV], fallback);
}

/**
 * ¿Este origen está permitido? Comparación exacta y sensible a mayúsculas, a propósito.
 *
 * Un `Origin` en mayúsculas solo lo puede escribir un cliente que no es un navegador (los navegadores
 * normalizan), así que rechazarlo no le quita nada a un visitante real y evita que una comparación
 * laxa se convierta en una puerta de atrás.
 */
export function isAllowedPublicOrigin(origin: string | null, allowedOrigins: readonly string[]): origin is string {
	return origin !== null && allowedOrigins.includes(origin);
}

/**
 * Cabeceras CORS de una respuesta cualquiera del endpoint.
 *
 * `Vary: Origin` va **siempre**, incluso cuando el origen no está permitido y no hay
 * `Access-Control-Allow-Origin` que aplicar: sin esa variación, una caché intermedia puede servirle
 * a un origen la respuesta que se armó para otro. `Vary` es una directiva de caché, no una cabecera
 * de permiso: que esté en la respuesta de un tercero no le habilita nada.
 *
 * Sin `Origin` (un `curl`, el backend de otro servicio) la respuesta no lleva ninguna cabecera
 * `Access-Control-*`: no hay navegador que necesite leerla.
 */
export function corsHeadersForRequest(request: Request, allowedOrigins: readonly string[]): CorsHeaderMap {
	const origin = request.headers.get("origin");
	const headers: CorsHeaderMap = { Vary: "Origin" };
	if (isAllowedPublicOrigin(origin, allowedOrigins)) {
		// El origen tal cual vino: nunca `*`, porque con lista blanca no hace falta y `*` le abriría
		// la lectura a cualquier sitio.
		headers["Access-Control-Allow-Origin"] = origin;
	}
	return headers;
}

export interface PreflightOptions {
	methods: string;
	headers: string;
	maxAgeSeconds: number;
}

/**
 * Respuesta al preflight: **204** siempre, con las cabeceras del método, las cabeceras permitidas y
 * el `Access-Control-Max-Age` **solo si el origen está permitido**.
 *
 * Un origen ajeno recibe el 204 pelado: el pedido no se rechaza —no somos un portero— pero su
 * navegador no encuentra con qué autorizar el POST y lo corta él.
 */
export function publicCorsPreflight(
	request: Request,
	allowedOrigins: readonly string[],
	options: PreflightOptions,
): Response {
	const headers = corsHeadersForRequest(request, allowedOrigins);
	if (headers["Access-Control-Allow-Origin"] !== undefined) {
		headers["Access-Control-Allow-Methods"] = options.methods;
		headers["Access-Control-Allow-Headers"] = options.headers;
		headers["Access-Control-Max-Age"] = String(options.maxAgeSeconds);
	}
	return new Response(null, { status: 204, headers });
}

/** Preflight del widget, con los métodos y cabeceras que declara este contrato. */
export function publicCorsPreflightResponse(
	request: Request,
	allowedOrigins: readonly string[] = aosPublicCorsOrigins(),
): Response {
	return publicCorsPreflight(request, allowedOrigins, {
		methods: AOS_PUBLIC_CORS_METHODS,
		headers: AOS_PUBLIC_CORS_ALLOWED_HEADERS,
		maxAgeSeconds: AOS_PUBLIC_PREFLIGHT_MAX_AGE_SECONDS,
	});
}

/**
 * Aplica las cabeceras CORS a una respuesta que ya existe y la devuelve.
 *
 * Se usa envolviendo **todo** el handler, no solo el camino feliz: el 400 con `code`
 * (`invalid_url` / `blocked_url`) y el 429 con las cabeceras `RateLimit-*` también tienen que ser
 * legibles desde el navegador, o el widget no puede contarle al visitante qué pasó.
 */
export function withPublicCors(response: Response, request: Request, allowedOrigins: readonly string[]): Response {
	for (const [name, value] of Object.entries(corsHeadersForRequest(request, allowedOrigins))) {
		if (name.toLowerCase() === "vary") {
			const existing = response.headers.get("Vary") ?? "";
			if (!existing.toLowerCase().includes("origin")) response.headers.append("Vary", value);
			continue;
		}
		response.headers.set(name, value);
	}
	return response;
}

/** Handler tal como lo expone una ruta de TanStack: `{ request, params }` y una `Response`. */
export type CorsWrappedHandler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>;

/**
 * Envuelve el handler completo del endpoint para que **toda** respuesta salga con su CORS.
 *
 * La lista se relee en cada pedido a propósito: así `AOS_PUBLIC_CORS_ORIGINS` se puede cambiar sin
 * reconstruir el bundle, y los tests pueden moverla y ver el efecto.
 */
export function withPublicCorsHandler(
	handler: CorsWrappedHandler,
	env: () => CorsEnv = () => process.env,
): CorsWrappedHandler {
	return async (args) => withPublicCors(await handler(args), args.request, aosPublicCorsOrigins(env()));
}
