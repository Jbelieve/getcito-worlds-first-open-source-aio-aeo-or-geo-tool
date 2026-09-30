/**
 * Tests de la credencial de verificación del audit público.
 *
 * El incidente que los origina: el equipo y quien verifica el despliegue salen por la **misma IP
 * pública**, así que una corrida de comprobación agotó el cupo diario por IP y el medidor dejó de
 * funcionar para el usuario real. La credencial mueve esos pedidos a un bucket propio.
 *
 * Lo que se prueba acá, en orden de importancia:
 *   1. que **sin** el secreto configurado la cabecera se ignore por completo (la función no existe);
 *   2. que una cabecera **inválida** caiga al bucket público —el modo de fallar seguro, nunca al revés—;
 *   3. que con la cabecera válida el pedido vaya al bucket `verify`, con su propio tope;
 *   4. que un secreto de otro largo no reviente la comparación;
 *   5. que el secreto no aparezca en ninguna respuesta.
 */
import { describe, expect, it, vi } from "vitest";
import { Route as AuditRoute } from "@/routes/api/v1/aos/audit";
import {
	DEFAULT_AUDITS_PER_DAY,
	DEFAULT_AUDITS_PER_DAY_GLOBAL,
	DEFAULT_VERIFY_AUDITS_PER_DAY,
	decidePublicQuota,
	PUBLIC_QUOTA_BUCKET,
	publicAuditLimits,
	quotaBucketForLane,
	quotaLaneForRequest,
	quotaLimitForLane,
	rateLimitedResponse,
	rateLimitHeaders,
	VERIFY_HEADER,
	VERIFY_QUOTA_BUCKET,
	verifySecretMatches,
} from "../public-audit";

const SECRET = "un-secreto-de-verificacion-largo-y-aleatorio-0123456789";

function headers(values: Record<string, string> = {}): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(values)) headers.set(name, value);
	return headers;
}

/** Los límites como los vería el endpoint con el secreto configurado. */
function limitsWithSecret(secret = SECRET) {
	return publicAuditLimits({ AOS_PUBLIC_VERIFY_SECRET: secret });
}

describe("publicAuditLimits: la env de verificación", () => {
	it("sin `AOS_PUBLIC_VERIFY_SECRET` el secreto queda vacío: la función no existe", () => {
		expect(publicAuditLimits({}).verifySecret).toBe("");
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_SECRET: "" }).verifySecret).toBe("");
		// Un valor de solo espacios es indistinguible de ausente: un archivo de entorno con un espacio
		// colado no puede encender la credencial con un secreto que nadie conoce.
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_SECRET: "   " }).verifySecret).toBe("");
	});

	it("recorta la env: un salto de línea colado no deja la credencial inutilizable", () => {
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_SECRET: `  ${SECRET}\n` }).verifySecret).toBe(SECRET);
	});

	it("el tope de `verify` tiene su propio default generoso y no toca el público", () => {
		const limits = publicAuditLimits({});
		expect(limits.verifyPerIp).toBe(DEFAULT_VERIFY_AUDITS_PER_DAY);
		expect(limits.perIp).toBe(DEFAULT_AUDITS_PER_DAY);
		// El del verificador es más ancho que el público —para eso está— y el global sigue siendo la cota.
		expect(limits.verifyPerIp).toBeGreaterThan(limits.perIp);
		expect(limits.verifyPerIp).toBeLessThan(DEFAULT_AUDITS_PER_DAY_GLOBAL);
	});

	it("lee `AOS_PUBLIC_VERIFY_PER_DAY` y una env inválida cae al default, no a cero", () => {
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_PER_DAY: "300" }).verifyPerIp).toBe(300);
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_PER_DAY: "0" }).verifyPerIp).toBe(DEFAULT_VERIFY_AUDITS_PER_DAY);
		expect(publicAuditLimits({ AOS_PUBLIC_VERIFY_PER_DAY: "no-es-un-numero" }).verifyPerIp).toBe(
			DEFAULT_VERIFY_AUDITS_PER_DAY,
		);
	});
});

describe("verifySecretMatches: comparación en tiempo constante", () => {
	it("acepta solo el secreto exacto", () => {
		expect(verifySecretMatches(SECRET, SECRET)).toBe(true);
		expect(verifySecretMatches(`${SECRET}x`, SECRET)).toBe(false);
		expect(verifySecretMatches(SECRET.slice(0, -1), SECRET)).toBe(false);
		expect(verifySecretMatches("", SECRET)).toBe(false);
		expect(verifySecretMatches(null, SECRET)).toBe(false);
	});

	it("un secreto de largo distinto no revienta: `timingSafeEqual` exige largos iguales", () => {
		// El bug clásico: pasar los strings crudos a `timingSafeEqual` tira `RangeError` cuando los
		// largos difieren. Hashear a SHA-256 antes normaliza el largo a 32 bytes, así que ninguno de
		// estos casos puede tirar — y ninguno puede dejar la request en un 500.
		const largos = ["", "x", "x".repeat(31), SECRET, "y".repeat(64), "z".repeat(4096)];
		for (const candidate of largos) {
			expect(() => verifySecretMatches(candidate, SECRET), `largo ${candidate.length}`).not.toThrow();
			expect(verifySecretMatches(candidate, SECRET), `largo ${candidate.length}`).toBe(candidate === SECRET);
		}
	});

	it("un secreto vacío apaga la función: nada lo hace coincidir", () => {
		// Ni siquiera presentar la cadena vacía, que es lo que haría un `===` ingenuo.
		expect(verifySecretMatches("", "")).toBe(false);
		expect(verifySecretMatches(null, "")).toBe(false);
		expect(verifySecretMatches(SECRET, "")).toBe(false);
	});

	it("no se delata el prefijo: un acierto parcial no se distingue de un yerro total", () => {
		// No se puede medir el tiempo en un test unitario, pero sí el contrato: la función devuelve
		// exactamente lo mismo (`false`) para un prefijo correcto que para un valor sin relación, así
		// que no hay ninguna señal observable aparte del resultado booleano.
		const prefijo = SECRET.slice(0, 8);
		expect(verifySecretMatches(prefijo, SECRET)).toBe(verifySecretMatches("nada-que-ver", SECRET));
		expect(verifySecretMatches(prefijo, SECRET)).toBe(false);
	});
});

describe("quotaLaneForRequest: el carril de cada pedido", () => {
	it("con la cabecera válida el pedido va al carril `verify`", () => {
		const limits = limitsWithSecret();
		expect(quotaLaneForRequest(headers({ [VERIFY_HEADER]: SECRET }), limits)).toBe("verify");
		// El nombre de la cabecera es insensible a mayúsculas, como cualquier cabecera HTTP.
		expect(quotaLaneForRequest(headers({ "X-BeaOS-Verify": SECRET }), limits)).toBe("verify");
	});

	it("CON LA CABECERA INVÁLIDA el pedido va al carril público: falla seguro", () => {
		// Es el caso que importa. Cualquier cosa que no sea el secreto exacto tiene que terminar en el
		// cupo público, nunca en el privilegiado.
		const limits = limitsWithSecret();
		for (const candidate of [
			"",
			"otra-cosa",
			"un-secreto-de-verificacion-largo-y-aleatorio-01234567", // un carácter menos
			"un-secreto-de-verificacion-largo-y-aleatorio-012345679", // un carácter distinto
			SECRET.toUpperCase(),
			`${SECRET}extra`,
		]) {
			expect(quotaLaneForRequest(headers({ [VERIFY_HEADER]: candidate }), limits), candidate).toBe("ip");
		}
	});

	it("el espacio de más lo recorta el protocolo, no nosotros: no hay normalización propia", () => {
		// `Headers` ya quita los espacios del borde, así que un `curl` con un espacio no es un intento
		// distinto. Se deja dicho para que nadie agregue un `.trim()` propio en la comparación: la
		// regla es "el valor tal como llega", y llega recortado.
		const limits = limitsWithSecret();
		expect(quotaLaneForRequest(headers({ [VERIFY_HEADER]: ` ${SECRET} ` }), limits)).toBe("verify");
	});

	it("sin cabecera el pedido va al carril público", () => {
		expect(quotaLaneForRequest(headers(), limitsWithSecret())).toBe("ip");
	});

	it("sin `AOS_PUBLIC_VERIFY_SECRET` la cabecera se ignora por completo", () => {
		// La función no existe: da igual qué traiga la cabecera, incluso el valor que sería el secreto.
		const limits = publicAuditLimits({});
		expect(quotaLaneForRequest(headers({ [VERIFY_HEADER]: SECRET }), limits)).toBe("ip");
		expect(quotaLaneForRequest(headers({ [VERIFY_HEADER]: "cualquier-cosa" }), limits)).toBe("ip");
		expect(quotaLaneForRequest(headers(), limits)).toBe("ip");
	});
});

describe("los buckets y topes de cada carril", () => {
	it("el carril `verify` usa un bucket propio, separado del público", () => {
		// El arreglo entero depende de esto: si los dos carriles cayeran en el mismo bucket, la
		// credencial no cambiaría nada y el incidente volvería igual.
		expect(quotaBucketForLane("verify")).toBe(VERIFY_QUOTA_BUCKET);
		expect(quotaBucketForLane("ip")).toBe(PUBLIC_QUOTA_BUCKET);
		expect(VERIFY_QUOTA_BUCKET).not.toBe(PUBLIC_QUOTA_BUCKET);
	});

	it("cada carril tiene su propio tope por IP", () => {
		const limits = limitsWithSecret();
		expect(quotaLimitForLane("verify", limits)).toBe(DEFAULT_VERIFY_AUDITS_PER_DAY);
		expect(quotaLimitForLane("ip", limits)).toBe(DEFAULT_AUDITS_PER_DAY);
		expect(quotaLimitForLane("verify", limits)).not.toBe(quotaLimitForLane("ip", limits));
	});

	it("las REGLAS no cambian: la decisión es la misma función, con el tope del carril", () => {
		// Con la misma cuenta consumida, el veredicto del carril `verify` es el que corresponde a su
		// tope. No hay una rama privilegiada que permita saltarse el límite.
		const limits = limitsWithSecret();
		const now = new Date("2026-03-14T22:30:00.000Z");
		const enVerify = decidePublicQuota({
			ipCount: DEFAULT_VERIFY_AUDITS_PER_DAY,
			globalCount: 0,
			ipLimit: quotaLimitForLane("verify", limits),
			globalLimit: limits.global,
			now,
		});
		expect(enVerify).toMatchObject({ allowed: false, reason: "ip_limit", limit: DEFAULT_VERIFY_AUDITS_PER_DAY });
		// Y el tope global sigue frenando desde los dos carriles, también desde `verify`.
		const global = decidePublicQuota({
			ipCount: 0,
			globalCount: limits.global,
			ipLimit: quotaLimitForLane("verify", limits),
			globalLimit: limits.global,
			now,
		});
		expect(global).toMatchObject({ allowed: false, reason: "global_limit", limit: limits.global });
	});
});

describe("el secreto no aparece en ninguna respuesta", () => {
	const secrets = [SECRET];

	it("ni en las cabeceras de límite ni en el cuerpo del 429", async () => {
		const limits = limitsWithSecret();
		const decision = decidePublicQuota({
			ipCount: DEFAULT_VERIFY_AUDITS_PER_DAY,
			globalCount: 0,
			ipLimit: quotaLimitForLane("verify", limits),
			globalLimit: limits.global,
			now: new Date("2026-03-14T22:30:00.000Z"),
		});

		const headerText = JSON.stringify(rateLimitHeaders(decision));
		const response = rateLimitedResponse(decision, `Alcanzaste el límite de ${decision.limit} auditorías por día.`);
		const responseText = JSON.stringify([...response.headers.entries()]);
		const bodyText = await response.text();

		for (const secret of secrets) {
			expect(headerText).not.toContain(secret);
			expect(responseText).not.toContain(secret);
			expect(bodyText).not.toContain(secret);
		}
		// La política sigue llamándose igual en los dos carriles: no se anuncia un bucket nuevo.
		expect(response.headers.get("RateLimit-Policy")).toContain('"aos-audit"');
	});

	it("el carril `verify` refleja su propio cupo, y solo lo ve quien presentó el secreto", () => {
		// Decisión documentada: las cabeceras dicen el cupo que de verdad decide. La diferencia solo es
		// observable presentando la credencial correcta; sin ella las cabeceras son las de siempre.
		const limits = limitsWithSecret();
		const now = new Date("2026-03-14T22:30:00.000Z");
		const publico = decidePublicQuota({
			ipCount: 0,
			globalCount: 0,
			ipLimit: quotaLimitForLane("ip", limits),
			globalLimit: limits.global,
			now,
		});
		const verificado = decidePublicQuota({
			ipCount: 0,
			globalCount: 0,
			ipLimit: quotaLimitForLane("verify", limits),
			globalLimit: limits.global,
			now,
		});
		expect(rateLimitHeaders(publico)["RateLimit-Limit"]).toBe(String(DEFAULT_AUDITS_PER_DAY));
		expect(rateLimitHeaders(verificado)["RateLimit-Limit"]).toBe(String(DEFAULT_VERIFY_AUDITS_PER_DAY));
	});
});

/**
 * La prueba de respuesta real: se maneja el handler de la ruta con el secreto presente en la
 * cabecera. El cuerpo sin `url` corta en la validación del cuerpo, así que no toca base ni red — y
 * aun así es una respuesta completa del endpoint, con sus cabeceras, sobre la que se puede afirmar
 * que el secreto no viaja de vuelta. Un `console.warn` del camino de rechazo tampoco lo imprime.
 */
describe("route /api/v1/aos/audit: el secreto no vuelve en la respuesta", () => {
	function postAudit(url: string, headerValue: string): Promise<Response> {
		const request = new Request("https://beaos.believe-global.com/api/v1/aos/audit", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				origin: "https://be-aos.believe-global.com",
				[VERIFY_HEADER]: headerValue,
			},
			body: JSON.stringify({ url }),
		});
		const handlers = (AuditRoute as { options?: { server?: { handlers?: Record<string, unknown> } } }).options?.server
			?.handlers;
		const handler = handlers?.POST;
		if (typeof handler !== "function") throw new Error("la ruta no declara el handler POST");
		return (handler as (args: { request: Request; params: Record<string, string> }) => Promise<Response>)({
			request,
			params: {},
		});
	}

	it("el 400 de una URL inválida, con la credencial válida, no refleja el secreto", async () => {
		vi.stubEnv("AOS_PUBLIC_VERIFY_SECRET", SECRET);
		try {
			// La ruta lee la env por el mismo camino que esto: si el stub no estuviera vivo, la
			// credencial no existiría y el test de abajo no probaría nada.
			expect(publicAuditLimits().verifySecret).toBe(SECRET);
			const response = await postAudit("esto no es una direccion", SECRET);
			expect(response.status).toBe(400);

			const allHeaders = JSON.stringify([...response.headers.entries()]);
			const body = await response.text();
			expect(allHeaders).not.toContain(SECRET);
			expect(body).not.toContain(SECRET);
			// El cuerpo del 400 sigue siendo el del contrato: `error`, `message` y `code`.
			expect(JSON.parse(body)).toMatchObject({ code: "invalid_url" });
			// Y la cabecera de la credencial no se refleja ni se anuncia de ninguna forma.
			expect([...response.headers.keys()].map((name) => name.toLowerCase())).not.toContain(VERIFY_HEADER);
		} finally {
			vi.unstubAllEnvs();
		}
	});

	it("con la credencial equivocada la respuesta es la misma que sin credencial", async () => {
		vi.stubEnv("AOS_PUBLIC_VERIFY_SECRET", SECRET);
		try {
			const conEquivocada = await postAudit("esto no es una direccion", "no-es-el-secreto");
			const sinCabecera = await postAudit("esto no es una direccion", "");
			const texto = async (response: Response) => ({
				status: response.status,
				body: await response.text(),
				cors: response.headers.get("Access-Control-Allow-Origin"),
			});
			const equivocada = await texto(conEquivocada);
			expect(equivocada).toEqual(await texto(sinCabecera));
			expect(equivocada.body).not.toContain("no-es-el-secreto");
		} finally {
			vi.unstubAllEnvs();
		}
	});
});
