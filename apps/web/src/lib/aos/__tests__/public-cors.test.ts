/**
 * Tests del CORS público de AOS.
 *
 * Lo que se prueba acá es la razón de ser de la lista blanca: que un origen nuestro pueda **leer** la
 * respuesta y que uno ajeno **no**, ni siquiera pareciéndose. El caso del origen parecido
 * (`https://be-aos.believe-global.com.evil.com`, el mismo host en `http://`, el mismo en mayúsculas)
 * es el test que le da sentido a no usar `*`.
 *
 * Además se manejan los handlers reales de las dos rutas: el `OPTIONS` completo (que no toca base ni
 * red) y el `POST` cortado en la validación del cuerpo, que es el camino donde el 400 tiene que
 * seguir siendo legible desde el navegador.
 */
import { describe, expect, it } from "vitest";
import { Route as AuditRoute } from "@/routes/api/v1/aos/audit";
import { Route as LeadRoute } from "@/routes/api/v1/aos/lead";
import { decidePublicQuota, rateLimitedResponse } from "../public-audit";
import {
	AOS_PUBLIC_CORS_ALLOWED_HEADERS,
	AOS_PUBLIC_CORS_METHODS,
	AOS_PUBLIC_CORS_ORIGINS_ENV,
	AOS_PUBLIC_EXPOSED_HEADERS,
	AOS_PUBLIC_PREFLIGHT_MAX_AGE_SECONDS,
	aosPublicCorsOrigins,
	corsHeadersForRequest,
	DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
	isAllowedPublicOrigin,
	parseCorsOrigins,
	publicCorsPreflightResponse,
	withPublicCors,
	withPublicCorsHandler,
} from "../public-cors";

const LANDING = "https://be-aos.believe-global.com";

/**
 * Las cinco que el widget de la landing necesita poder leer: ninguna es CORS-safelisted, así que sin
 * `Access-Control-Expose-Headers` el `fetch` cross-origin recibe los valores y no los ve.
 */
const CINCO_DE_LIMITE = [
	"RateLimit-Limit",
	"RateLimit-Remaining",
	"RateLimit-Reset",
	"RateLimit-Policy",
	"Retry-After",
];

/** Los intentos de colarse: por sufijo, por esquema y por mayúsculas. */
const LOOKALIKES = [
	"https://be-aos.believe-global.com.evil.com",
	"http://be-aos.believe-global.com",
	"HTTPS://BE-AOS.BELIEVE-GLOBAL.COM",
	"https://be-aos.believe-global.com:8443",
	"https://evil.com",
	"*",
	"null",
];

function requestWithOrigin(origin: string | null, method = "POST"): Request {
	const headers = new Headers();
	if (origin !== null) headers.set("Origin", origin);
	return new Request(`${LANDING}/api/v1/aos/audit`, { method, headers });
}

/** Las cabeceras `Access-Control-*` presentes, que es lo único que un navegador mira para leer. */
function corsHeaderNames(headers: Headers): string[] {
	return [...headers.keys()].filter((name) => name.toLowerCase().startsWith("access-control-"));
}

/**
 * Las cabeceras que la respuesta declara legibles, en el orden en que las enumera. `null` es "no hay
 * `Access-Control-Expose-Headers`", que es lo que tiene que pasarle a un origen ajeno.
 */
function exposedHeaders(headers: Headers): string[] | null {
	const raw = headers.get("Access-Control-Expose-Headers");
	return raw === null
		? null
		: raw
				.split(",")
				.map((name) => name.trim())
				.filter((name) => name.length > 0);
}

/**
 * Un 429 real, armado por el mismo camino que usa la ruta (`rateLimitedResponse`), con el cupo ya
 * pasado. El caso importa más que ningún otro: si el navegador no puede leer `Retry-After`, la
 * landing no puede decir *"podés volver en 45 min"*.
 */
function real429(): Response {
	const decision = decidePublicQuota({
		ipCount: 20,
		globalCount: 20,
		ipLimit: 20,
		globalLimit: 2000,
		now: new Date("2026-09-30T12:00:00.000Z"),
	});
	expect(decision.allowed).toBe(false);
	return rateLimitedResponse(decision, "Alcanzaste el límite de 20 auditorías por día.");
}

/** Handler tal como lo expone la ruta: `{ request, params }` y una `Response`. */
type Handler = (args: { request: Request; params: Record<string, string> }) => Promise<Response>;

interface PublicHandlers {
	OPTIONS: Handler;
	POST: Handler;
}

/**
 * Saca un handler del `Route` real, sin `!`.
 *
 * Que la ruta exista y declare el método es parte de lo que se prueba: si el `OPTIONS` desapareciera,
 * el test tiene que fallar con un mensaje, no con un `undefined is not a function`.
 */
function handlerOf(route: unknown, name: "OPTIONS" | "POST"): Handler {
	const handlers = (route as { options?: { server?: { handlers?: Record<string, unknown> } } }).options?.server
		?.handlers;
	const handler = handlers?.[name];
	if (typeof handler !== "function") throw new Error(`la ruta no declara el handler ${name}`);
	return handler as Handler;
}

function auditHandlers(): PublicHandlers {
	return { OPTIONS: handlerOf(AuditRoute, "OPTIONS"), POST: handlerOf(AuditRoute, "POST") };
}

function leadHandlers(): PublicHandlers {
	return { OPTIONS: handlerOf(LeadRoute, "OPTIONS"), POST: handlerOf(LeadRoute, "POST") };
}

function postJson(request: Request, body: unknown): Promise<Response> {
	const withBody = new Request(request.url, {
		method: "POST",
		headers: request.headers,
		body: JSON.stringify(body),
	});
	withBody.headers.set("content-type", "application/json");
	return auditHandlers().POST({ request: withBody, params: {} });
}

describe("parseCorsOrigins", () => {
	it("cae al default cuando la env no está o está vacía", () => {
		expect(parseCorsOrigins(undefined, DEFAULT_AOS_PUBLIC_CORS_ORIGINS)).toEqual([...DEFAULT_AOS_PUBLIC_CORS_ORIGINS]);
		expect(parseCorsOrigins("", DEFAULT_AOS_PUBLIC_CORS_ORIGINS)).toEqual([...DEFAULT_AOS_PUBLIC_CORS_ORIGINS]);
		expect(parseCorsOrigins("   ,  ", DEFAULT_AOS_PUBLIC_CORS_ORIGINS)).toEqual([...DEFAULT_AOS_PUBLIC_CORS_ORIGINS]);
	});

	it("parte por coma, saca espacios y deduplica", () => {
		expect(parseCorsOrigins(" https://uno.example , https://dos.example ,https://uno.example ", [])).toEqual([
			"https://uno.example",
			"https://dos.example",
		]);
	});
});

describe("aosPublicCorsOrigins", () => {
	it("el default son nuestros cuatro orígenes", () => {
		expect(aosPublicCorsOrigins({})).toEqual([
			"https://be-aos.believe-global.com",
			"https://www.be-aos.believe-global.com",
			"https://believe-global.com",
			"https://www.believe-global.com",
		]);
	});

	it("la lista sale de la env y reemplaza al default", () => {
		const env = { [AOS_PUBLIC_CORS_ORIGINS_ENV]: "https://otro.example" };
		expect(aosPublicCorsOrigins(env)).toEqual(["https://otro.example"]);
		// El default deja de estar permitido: la env reemplaza, no suma.
		expect(isAllowedPublicOrigin(LANDING, aosPublicCorsOrigins(env))).toBe(false);
		expect(isAllowedPublicOrigin("https://otro.example", aosPublicCorsOrigins(env))).toBe(true);
	});
});

describe("isAllowedPublicOrigin", () => {
	it("acepta los orígenes de la lista, exactos", () => {
		for (const origin of DEFAULT_AOS_PUBLIC_CORS_ORIGINS) {
			expect(isAllowedPublicOrigin(origin, DEFAULT_AOS_PUBLIC_CORS_ORIGINS)).toBe(true);
		}
	});

	it("rechaza los parecidos y la ausencia de origen", () => {
		for (const origin of LOOKALIKES) {
			expect(isAllowedPublicOrigin(origin, DEFAULT_AOS_PUBLIC_CORS_ORIGINS), origin).toBe(false);
		}
		expect(isAllowedPublicOrigin(null, DEFAULT_AOS_PUBLIC_CORS_ORIGINS)).toBe(false);
	});
});

describe("corsHeadersForRequest", () => {
	it("a un origen permitido le devuelve ESE origen, nunca `*`", () => {
		const headers = corsHeadersForRequest(requestWithOrigin(LANDING), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		expect(headers["Access-Control-Allow-Origin"]).toBe(LANDING);
		expect(headers["Access-Control-Allow-Origin"]).not.toBe("*");
		expect(headers.Vary).toBe("Origin");
	});

	it("expone exactamente las cinco cabeceras de límite, y solo esas", () => {
		const headers = corsHeadersForRequest(requestWithOrigin(LANDING), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		const declaradas = headers["Access-Control-Expose-Headers"];
		expect(declaradas).toBe(AOS_PUBLIC_EXPOSED_HEADERS);
		// El orden no importa para el navegador, pero el conjunto sí: se enumeran las cinco y ninguna más.
		expect(exposedHeaders(new Headers(headers))?.slice().sort()).toEqual([...CINCO_DE_LIMITE].sort());
		// Nada de `*`: el comodín expondría toda la respuesta y no hace falta.
		expect(declaradas).not.toContain("*");
	});

	it("a un origen ajeno no le devuelve ninguna cabecera de permiso", () => {
		for (const origin of LOOKALIKES) {
			const headers = corsHeadersForRequest(requestWithOrigin(origin), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
			expect(Object.keys(headers), origin).toEqual(["Vary"]);
			expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
			// Si no puede leer la respuesta, tampoco tiene por qué saber qué cabeceras exponemos.
			expect(headers["Access-Control-Expose-Headers"], origin).toBeUndefined();
			expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
		}
	});

	it("sin `Origin` (curl, un backend) no hay cabeceras CORS, pero sí `Vary: Origin`", () => {
		const headers = corsHeadersForRequest(requestWithOrigin(null), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		expect(Object.keys(headers)).toEqual(["Vary"]);
	});

	it("nunca habilita credenciales", () => {
		const headers = corsHeadersForRequest(requestWithOrigin(LANDING), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
	});
});

describe("publicCorsPreflightResponse", () => {
	it("al origen permitido: 204 con el origen, los métodos, las cabeceras y el max-age", async () => {
		const response = publicCorsPreflightResponse(
			requestWithOrigin(LANDING, "OPTIONS"),
			DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
		);
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);
		expect(response.headers.get("Access-Control-Allow-Methods")).toBe(AOS_PUBLIC_CORS_METHODS);
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe(AOS_PUBLIC_CORS_ALLOWED_HEADERS);
		expect(response.headers.get("Access-Control-Max-Age")).toBe(String(AOS_PUBLIC_PREFLIGHT_MAX_AGE_SECONDS));
		expect(response.headers.get("Vary")).toBe("Origin");
		expect(exposedHeaders(response.headers)).toEqual(CINCO_DE_LIMITE);
		expect(await response.text()).toBe("");
	});

	it("al origen ajeno: 204 igual, pero sin nada que autorice el POST", () => {
		for (const origin of LOOKALIKES) {
			const response = publicCorsPreflightResponse(
				requestWithOrigin(origin, "OPTIONS"),
				DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
			);
			expect(response.status, origin).toBe(204);
			expect(corsHeaderNames(response.headers), origin).toEqual([]);
			expect(response.headers.get("Access-Control-Expose-Headers"), origin).toBeNull();
			expect(response.headers.get("Vary")).toBe("Origin");
		}
	});
});

describe("withPublicCors", () => {
	it("aplica las cabeceras a un 400 y a un 429 ya construidos", () => {
		for (const status of [400, 429]) {
			const response = withPublicCors(
				Response.json({ error: "x" }, { status, headers: { "RateLimit-Limit": "20" } }),
				requestWithOrigin(LANDING),
				DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
			);
			expect(response.status).toBe(status);
			expect(response.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);
			expect(response.headers.get("RateLimit-Limit")).toBe("20");
			expect(exposedHeaders(response.headers)).toEqual(CINCO_DE_LIMITE);
		}
	});

	it("el 429 real sale con `Retry-After` y las cinco expuestas: es donde más importa", () => {
		const response = withPublicCors(real429(), requestWithOrigin(LANDING), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		expect(response.status).toBe(429);
		// La cabecera que la landing necesita para decir *cuándo* puede volver la persona.
		expect(response.headers.get("Retry-After")).not.toBeNull();
		expect(response.headers.get("RateLimit-Remaining")).toBe("0");
		expect(exposedHeaders(response.headers)).toEqual(CINCO_DE_LIMITE);
	});

	it("no toca un `Vary` que ya menciona `Origin`", () => {
		const response = withPublicCors(
			Response.json({}, { headers: { Vary: "Origin, Accept-Encoding" } }),
			requestWithOrigin(LANDING),
			DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
		);
		expect(response.headers.get("Vary")).toBe("Origin, Accept-Encoding");
	});

	it("a un origen ajeno no le agrega ninguna cabecera de permiso", () => {
		const response = withPublicCors(
			Response.json({ error: "x" }, { status: 400 }),
			requestWithOrigin("https://be-aos.believe-global.com.evil.com"),
			DEFAULT_AOS_PUBLIC_CORS_ORIGINS,
		);
		expect(corsHeaderNames(response.headers)).toEqual([]);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
		expect(response.headers.get("Vary")).toBe("Origin");
	});

	it("el 429 tampoco expone nada si el origen es ajeno", () => {
		const response = withPublicCors(real429(), requestWithOrigin("*"), DEFAULT_AOS_PUBLIC_CORS_ORIGINS);
		// Las cabeceras de límite viajan igual —son parte del contrato del endpoint— pero ese navegador
		// no las puede leer: lo único que pierde es el tercero, no nosotros.
		expect(response.headers.get("Retry-After")).not.toBeNull();
		expect(corsHeaderNames(response.headers)).toEqual([]);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
	});
});

describe("withPublicCorsHandler", () => {
	it("relee la env en cada pedido", async () => {
		let env: Record<string, string | undefined> = {};
		const handler = withPublicCorsHandler(
			async () => Response.json({ ok: true }),
			() => env,
		);

		const conDefault = await handler({ request: requestWithOrigin(LANDING), params: {} });
		expect(conDefault.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);

		// La misma instancia, otra env: el default deja de estar permitido y el nuevo origen entra.
		env = { [AOS_PUBLIC_CORS_ORIGINS_ENV]: "https://otro.example" };
		const conEnv = await handler({ request: requestWithOrigin(LANDING), params: {} });
		expect(corsHeaderNames(conEnv.headers)).toEqual([]);

		const conNuevoOrigen = await handler({ request: requestWithOrigin("https://otro.example"), params: {} });
		expect(conNuevoOrigen.headers.get("Access-Control-Allow-Origin")).toBe("https://otro.example");
	});
});

describe("route /api/v1/aos/audit", () => {
	it("el preflight del origen permitido sale por la ruta con 204 y su cabecera", async () => {
		const response = await auditHandlers().OPTIONS({
			request: requestWithOrigin(LANDING, "OPTIONS"),
			params: {},
		});
		expect(response.status).toBe(204);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);
		expect(response.headers.get("Access-Control-Allow-Headers")).toBe("content-type");
		expect(exposedHeaders(response.headers)).toEqual(CINCO_DE_LIMITE);
	});

	it("el preflight de un origen parecido sale 204 sin cabeceras CORS", async () => {
		for (const origin of LOOKALIKES) {
			const response = await auditHandlers().OPTIONS({
				request: requestWithOrigin(origin, "OPTIONS"),
				params: {},
			});
			expect(response.status, origin).toBe(204);
			expect(corsHeaderNames(response.headers), origin).toEqual([]);
		}
	});

	it("el 400 del POST también es legible desde el origen permitido", async () => {
		// Un cuerpo sin `url` corta en la validación: no toca base, ni red, ni cupo.
		const response = await postJson(requestWithOrigin(LANDING), {});
		expect(response.status).toBe(400);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);
		expect(response.headers.get("Vary")).toBe("Origin");
		// El 400 no trae cabeceras de límite, pero la exposición es parte del permiso: va igual, para que
		// la superficie no tenga que distinguir "no hay cupo que leer" de "no puedo leerlo".
		expect(exposedHeaders(response.headers)).toEqual(CINCO_DE_LIMITE);
	});

	it("el 400 del POST NO es legible desde un origen parecido", async () => {
		const response = await postJson(requestWithOrigin("https://be-aos.believe-global.com.evil.com"), {});
		expect(response.status).toBe(400);
		expect(corsHeaderNames(response.headers)).toEqual([]);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
	});

	it("sin `Origin` el POST responde como hoy, sin cabeceras CORS", async () => {
		const response = await postJson(requestWithOrigin(null), {});
		expect(response.status).toBe(400);
		expect(corsHeaderNames(response.headers)).toEqual([]);
		expect(response.headers.get("Access-Control-Expose-Headers")).toBeNull();
	});
});

describe("route /api/v1/aos/lead", () => {
	it("el preflight del origen permitido y el del ajeno", async () => {
		const permitido = await leadHandlers().OPTIONS({
			request: requestWithOrigin(LANDING, "OPTIONS"),
			params: {},
		});
		expect(permitido.status).toBe(204);
		expect(permitido.headers.get("Access-Control-Allow-Origin")).toBe(LANDING);
		expect(exposedHeaders(permitido.headers)).toEqual(CINCO_DE_LIMITE);

		const ajeno = await leadHandlers().OPTIONS({
			request: requestWithOrigin("http://be-aos.believe-global.com", "OPTIONS"),
			params: {},
		});
		expect(ajeno.status).toBe(204);
		expect(corsHeaderNames(ajeno.headers)).toEqual([]);
		expect(ajeno.headers.get("Access-Control-Expose-Headers")).toBeNull();
	});
});
