import type { AosAuditResult } from "@workspace/aos-aps/aos";
import { describe, expect, it } from "vitest";
import {
	classifyPublicAuditUrlFailure,
	clientKeyFromHeaders,
	DEFAULT_AUDITS_PER_DAY,
	DEFAULT_AUDITS_PER_DAY_GLOBAL,
	decidePublicQuota,
	hashClientKey,
	publicAuditBody,
	publicAuditLimits,
	publicAuditResponse,
	publicLeadBody,
	QUOTA_WINDOW_SECONDS,
	quotaConcentrationThreshold,
	quotaConcentrationWarning,
	rateLimitedResponse,
	rateLimitHeaders,
	secondsUntilUtcMidnight,
	utcDay,
	validatePublicAuditUrl,
} from "../public-audit";

/**
 * Todo lo de este archivo es puro: la decisión del límite y el guardián de URL son parte del
 * contrato, así que se prueban como funciones y no contra una base ni contra la red.
 */

const NOW = new Date("2026-03-14T22:30:00.000Z");

function headers(values: Record<string, string>): Headers {
	const headers = new Headers();
	for (const [name, value] of Object.entries(values)) headers.set(name, value);
	return headers;
}

describe("publicAuditLimits", () => {
	it("usa los defaults cuando el entorno está vacío", () => {
		const limits = publicAuditLimits({});
		expect(limits.perIp).toBe(DEFAULT_AUDITS_PER_DAY);
		expect(limits.global).toBe(DEFAULT_AUDITS_PER_DAY_GLOBAL);
		expect(limits.ipSalt).toBe("");
	});

	it("el tope global queda por encima del individual: el global es la cota real", () => {
		expect(DEFAULT_AUDITS_PER_DAY_GLOBAL).toBeGreaterThan(DEFAULT_AUDITS_PER_DAY);
	});

	it("lee las variables del entorno", () => {
		const limits = publicAuditLimits({
			AOS_PUBLIC_AUDITS_PER_DAY: "5",
			AOS_PUBLIC_AUDITS_PER_DAY_GLOBAL: "50",
			AOS_PUBLIC_AUDIT_TOTAL_TIMEOUT_MS: "9000",
			AOS_PUBLIC_IP_SALT: "sal-secreta",
		});
		expect(limits.perIp).toBe(5);
		expect(limits.global).toBe(50);
		expect(limits.totalTimeoutMs).toBe(9000);
		expect(limits.ipSalt).toBe("sal-secreta");
	});

	it("`cfOnlyIngress` está apagado salvo que se declare explícitamente", () => {
		// Apagado es el default medido: el origen de hoy es alcanzable directo, así que confiar en
		// `cf-connecting-ip` sería regalar la evasión del cupo por IP.
		expect(publicAuditLimits({}).cfOnlyIngress).toBe(false);
		expect(publicAuditLimits({ AOS_PUBLIC_CF_ONLY_INGRESS: "" }).cfOnlyIngress).toBe(false);
		expect(publicAuditLimits({ AOS_PUBLIC_CF_ONLY_INGRESS: "false" }).cfOnlyIngress).toBe(false);
		expect(publicAuditLimits({ AOS_PUBLIC_CF_ONLY_INGRESS: "true" }).cfOnlyIngress).toBe(true);
		expect(publicAuditLimits({ AOS_PUBLIC_CF_ONLY_INGRESS: "1" }).cfOnlyIngress).toBe(true);
	});

	it("una env inválida cae al default en vez de apagar el límite", () => {
		const limits = publicAuditLimits({
			AOS_PUBLIC_AUDITS_PER_DAY: "0",
			AOS_PUBLIC_AUDITS_PER_DAY_GLOBAL: "-3",
			AOS_PUBLIC_AUDIT_TOTAL_TIMEOUT_MS: "no-es-un-numero",
		});
		expect(limits.perIp).toBe(DEFAULT_AUDITS_PER_DAY);
		expect(limits.global).toBe(DEFAULT_AUDITS_PER_DAY_GLOBAL);
		expect(limits.totalTimeoutMs).toBe(20_000);
	});
});

/**
 * La cadena de producción, tal como se midió el 2026-09-30 capturando en la interfaz del contenedor
 * (ver el comentario largo de `clientKeyFromHeaders`).
 *
 * Lo que importa de estas pruebas es que **el bug no vuelva**: si la fuente de IP colapsa en un
 * valor constante, dos clientes distintos comparten los 20 pedidos y se rompe para todos.
 */
describe("clientKeyFromHeaders", () => {
	describe("cadena medida: cliente → Traefik → app, sin Cloudflare", () => {
		it("toma el único salto de x-forwarded-for, que es la IP del cliente", () => {
			// Así llegó la petición real: un solo salto, ya reescrito por Traefik.
			expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "198.51.100.7", "x-real-ip": "198.51.100.7" }))).toBe(
				"198.51.100.7",
			);
		});

		it("ignora cf-connecting-ip: en esta cadena no lo escribe nadie y el cliente lo puede inventar", () => {
			// Medido: `cf-connecting-ip: 9.9.9.9` mandada por el cliente llegó intacta al endpoint,
			// mientras XFF y X-Real-IP fueron sobrescritas. Confiar en ella sería un bucket nuevo por
			// pedido, o sea cupo infinito para quien la falsifique.
			expect(clientKeyFromHeaders(headers({ "cf-connecting-ip": "9.9.9.9" }))).toBe("unknown");
			expect(clientKeyFromHeaders(headers({ "cf-connecting-ip": "9.9.9.9", "x-forwarded-for": "198.51.100.7" }))).toBe(
				"198.51.100.7",
			);
		});

		it("con varios saltos toma el último: es el que dejó el proxy que sí controlamos", () => {
			expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "1.2.3.4, 5.6.7.8, 9.10.11.12" }))).toBe("9.10.11.12");
		});
	});

	describe("detrás de Cloudflare (AOS_PUBLIC_CF_ONLY_INGRESS)", () => {
		const cf = { cfOnlyIngress: true };

		it("con solo cf-connecting-ip, esa es la IP del cliente", () => {
			expect(clientKeyFromHeaders(headers({ "cf-connecting-ip": "203.0.113.10" }), cf)).toBe("203.0.113.10");
		});

		it("cf-connecting-ip manda sobre el salto del proxy, que es constante", () => {
			// Es el caso que rompía todo: para Cloudflare el último salto de XFF es el POP, igual para
			// todos; el cliente está en cf-connecting-ip.
			expect(
				clientKeyFromHeaders(
					headers({ "cf-connecting-ip": "203.0.113.10", "x-forwarded-for": "172.71.0.9, 10.0.1.43" }),
					cf,
				),
			).toBe("203.0.113.10");
		});

		it("sin cf-connecting-ip cae al respaldo: el último salto de x-forwarded-for", () => {
			expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "203.0.113.10" }), cf)).toBe("203.0.113.10");
			expect(clientKeyFromHeaders(headers({}), cf)).toBe("unknown");
		});

		it("dos clientes distintos NO comparten bucket (la regresión del cupo colapsado)", () => {
			// Mismo proxy, mismo XFF constante; lo único distinto es el cliente.
			const porProxy = { "x-forwarded-for": "10.0.1.43" };
			const uno = clientKeyFromHeaders(headers({ ...porProxy, "cf-connecting-ip": "203.0.113.10" }), cf);
			const dos = clientKeyFromHeaders(headers({ ...porProxy, "cf-connecting-ip": "203.0.113.11" }), cf);

			expect(uno).toBe("203.0.113.10");
			expect(dos).toBe("203.0.113.11");
			expect(uno).not.toBe(dos);
			// Y la clave que llega a la base también es distinta: no comparten los 20 pedidos.
			expect(hashClientKey(uno, "sal")).not.toBe(hashClientKey(dos, "sal"));
		});
	});

	it("sin cabecera cae en un bucket compartido, que es el modo de fallar seguro", () => {
		expect(clientKeyFromHeaders(headers({}))).toBe("unknown");
		expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "   " }))).toBe("unknown");
		expect(clientKeyFromHeaders(headers({ "x-forwarded-for": ", ," }))).toBe("unknown");
	});

	it("normaliza corchetes, puerto y zona", () => {
		expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "1.2.3.4:5678" }))).toBe("1.2.3.4");
		expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "[2001:db8::1]:443" }))).toBe("2001:db8::1");
		expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "fe80::1%en0" }))).toBe("fe80::1");
	});
});

describe("alarma de concentración del cupo", () => {
	it("el umbral es un tercio del tope global", () => {
		expect(quotaConcentrationThreshold(DEFAULT_AUDITS_PER_DAY_GLOBAL)).toBe(667);
		expect(quotaConcentrationThreshold(3)).toBe(1);
		expect(quotaConcentrationThreshold(1)).toBe(1);
	});

	it("no dice nada mientras ningún bucket se acerque al umbral", () => {
		expect(quotaConcentrationWarning({ topCount: 666, globalLimit: 2000, day: "2026-09-30" })).toBeNull();
		expect(quotaConcentrationWarning({ topCount: 20, globalLimit: 2000, day: "2026-09-30" })).toBeNull();
	});

	it("avisa cuando una sola clave se lleva más de un tercio del servicio", () => {
		const warning = quotaConcentrationWarning({ topCount: 667, globalLimit: 2000, day: "2026-09-30" });
		expect(warning).not.toBeNull();
		// El aviso tiene que traer los números y el día: sin eso no se puede investigar.
		expect(warning).toContain("667");
		expect(warning).toContain("2000");
		expect(warning).toContain("2026-09-30");
	});

	it("es un aviso, no un bloqueo: nombra el caso legítimo y el patológico", () => {
		const warning = quotaConcentrationWarning({ topCount: 900, globalLimit: 2000, day: "2026-09-30" });
		// Una oficina con NAT es legítima; una clave constante es el bug. El log no elige por su cuenta.
		expect(warning).toMatch(/NAT/);
		expect(warning).toMatch(/constante/);
	});
});

describe("hashClientKey", () => {
	it("es estable y no revela la IP", () => {
		const hash = hashClientKey("1.2.3.4", "sal");
		expect(hash).toBe(hashClientKey("1.2.3.4", "sal"));
		expect(hash).toHaveLength(64);
		expect(hash).not.toContain("1.2.3.4");
	});

	it("la sal cambia el hash: sin sal, un IPv4 es enumerable", () => {
		expect(hashClientKey("1.2.3.4", "sal")).not.toBe(hashClientKey("1.2.3.4", "otra-sal"));
	});
});

describe("ventana diaria", () => {
	it("el día es UTC", () => {
		expect(utcDay(new Date("2026-03-14T23:59:59.999Z"))).toBe("2026-03-14");
		expect(utcDay(new Date("2026-03-15T00:00:00.000Z"))).toBe("2026-03-15");
	});

	it("los segundos hasta la medianoche UTC son los que se prometen en RateLimit-Reset", () => {
		expect(secondsUntilUtcMidnight(new Date("2026-03-14T23:59:30.000Z"))).toBe(30);
		expect(secondsUntilUtcMidnight(new Date("2026-03-14T00:00:00.000Z"))).toBe(QUOTA_WINDOW_SECONDS);
		// En el borde nunca devolvemos 0: un reset de 0 invita a reintentar en el acto.
		expect(secondsUntilUtcMidnight(new Date("2026-03-14T23:59:59.999Z"))).toBe(1);
	});
});

describe("decidePublicQuota", () => {
	const base = { ipLimit: 20, globalLimit: 2000, now: NOW };

	it("dentro del límite: permite y descuenta", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 5, globalCount: 100 });
		expect(decision).toMatchObject({ allowed: true, reason: "ok", limit: 20, remaining: 14 });
		expect(decision.retryAfterSeconds).toBeNull();
	});

	it("justo antes del límite: el último pedido pasa", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 19, globalCount: 100 });
		expect(decision).toMatchObject({ allowed: true, remaining: 0 });
	});

	it("en el límite: rechaza", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 20, globalCount: 100 });
		expect(decision).toMatchObject({ allowed: false, reason: "ip_limit", limit: 20, remaining: 0 });
		expect(decision.retryAfterSeconds).toBeGreaterThan(0);
	});

	it("pasado el límite: sigue rechazando", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 25, globalCount: 100 });
		expect(decision).toMatchObject({ allowed: false, reason: "ip_limit" });
	});

	it("el tope global frena aunque la IP tenga cupo de sobra", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 0, globalCount: 2000 });
		expect(decision).toMatchObject({ allowed: false, reason: "global_limit", limit: 2000, remaining: 0 });
	});

	it("cuando los dos topes están pasados, el motivo reportado es el global", () => {
		// El global es el que de verdad frena el servicio: reportar el cupo personal escondería la causa.
		const decision = decidePublicQuota({ ...base, ipCount: 99, globalCount: 2000 });
		expect(decision.reason).toBe("global_limit");
		expect(decision.limit).toBe(2000);
	});

	it("`remaining` nunca promete más de lo que el tope global va a honrar", () => {
		const decision = decidePublicQuota({ ...base, ipCount: 0, globalCount: 1995 });
		expect(decision).toMatchObject({ allowed: true, limit: 20, remaining: 4 });
	});

	it("`retryAfter` existe solo cuando se rechaza", () => {
		expect(decidePublicQuota({ ...base, ipCount: 0, globalCount: 0 }).retryAfterSeconds).toBeNull();
		expect(decidePublicQuota({ ...base, ipCount: 20, globalCount: 0 }).retryAfterSeconds).toBe(
			secondsUntilUtcMidnight(NOW),
		);
	});
});

describe("rateLimitHeaders", () => {
	it("emite las cinco cabeceras con el formato del contrato", () => {
		const decision = decidePublicQuota({
			ipLimit: 3,
			globalLimit: 100,
			ipCount: 0,
			globalCount: 0,
			now: new Date("2026-03-14T23:59:15.000Z"),
		});
		const result = rateLimitHeaders(decision);
		expect(result["RateLimit-Policy"]).toBe('"aos-audit";q=3;w=86400');
		expect(result.RateLimit).toBe('"aos-audit";r=2;t=45');
		expect(result["RateLimit-Limit"]).toBe("3");
		expect(result["RateLimit-Remaining"]).toBe("2");
		expect(result["RateLimit-Reset"]).toBe("45");
	});

	it("no manda Retry-After cuando el pedido pasa", () => {
		const decision = decidePublicQuota({ ipLimit: 20, globalLimit: 2000, ipCount: 0, globalCount: 0, now: NOW });
		expect(rateLimitHeaders(decision)["Retry-After"]).toBeUndefined();
	});

	it("en el 429 manda Retry-After con los segundos exactos", () => {
		const decision = decidePublicQuota({ ipLimit: 20, globalLimit: 2000, ipCount: 20, globalCount: 0, now: NOW });
		expect(rateLimitHeaders(decision)["Retry-After"]).toBe("5400");
	});

	it("el 429 es 429 y trae las cabeceras", async () => {
		const decision = decidePublicQuota({ ipLimit: 20, globalLimit: 2000, ipCount: 20, globalCount: 0, now: NOW });
		const response = rateLimitedResponse(decision, "Alcanzaste el límite de 20 auditorías por día.");
		expect(response.status).toBe(429);
		expect(response.headers.get("RateLimit-Limit")).toBe("20");
		expect(response.headers.get("RateLimit-Remaining")).toBe("0");
		expect(Number(response.headers.get("Retry-After"))).toBeGreaterThan(0);
		expect(await response.json()).toMatchObject({ error: "Too Many Requests" });
	});
});

describe("validatePublicAuditUrl", () => {
	it("acepta una URL pública", () => {
		expect(validatePublicAuditUrl("https://example.com/blog").ok).toBe(true);
	});

	it("rechaza esquemas que no son http/https", () => {
		expect(validatePublicAuditUrl("file:///etc/passwd").ok).toBe(false);
		expect(validatePublicAuditUrl("ftp://example.com").ok).toBe(false);
	});

	it("rechaza localhost, rangos privados y metadatos de nube", () => {
		for (const raw of [
			"http://localhost:3000/",
			"http://127.0.0.1/",
			"http://[::1]/",
			"http://10.1.2.3/",
			"http://172.20.5.5/",
			"http://192.168.1.1/",
			"http://169.254.169.254/latest/meta-data/",
			"http://servicio.internal/",
			"http://algo.local/",
			"http://2130706433/",
			"http://[::ffff:169.254.169.254]/",
		]) {
			expect(validatePublicAuditUrl(raw).ok, raw).toBe(false);
		}
	});

	it("acepta una IP pública como literal", () => {
		expect(validatePublicAuditUrl("http://93.184.216.34/").ok).toBe(true);
	});

	/**
	 * El arreglo urgente: la extensión 2.1.0 que está en review manda el dominio pelado, y con el
	 * guardián viejo eso era un 400 para *cualquier* sitio. Si estas dos pruebas pasan, la extensión
	 * que ya está publicada empieza a funcionar sin subir nada nuevo.
	 */
	it("acepta un dominio pelado y lo normaliza a https", () => {
		const result = validatePublicAuditUrl("bescore.believe-global.com");
		expect(result.ok).toBe(true);
		expect(result.ok === true && result.url.toString()).toBe("https://bescore.believe-global.com/");
	});

	it("conserva el path del dominio pelado: no se audita la home en lugar de la página", () => {
		const result = validatePublicAuditUrl("bescore.believe-global.com/precios");
		expect(result.ok).toBe(true);
		expect(result.ok === true && result.url.toString()).toBe("https://bescore.believe-global.com/precios");
	});

	it("un dominio pelado interno se rechaza igual que uno con esquema", () => {
		for (const raw of ["localhost", "localhost:3000", "127.0.0.1", "10.1.2.3", "169.254.169.254"]) {
			const result = validatePublicAuditUrl(raw);
			expect(result.ok, raw).toBe(false);
			expect(result.ok === false && result.kind, raw).toBe("blocked");
		}
	});
});

describe("classifyPublicAuditUrlFailure", () => {
	it("distingue 'no se pudo interpretar' de 'queda afuera por seguridad'", () => {
		const noSePudoLeer = classifyPublicAuditUrlFailure({ kind: "invalid", reason: "cualquiera" });
		const afuera = classifyPublicAuditUrlFailure({ kind: "blocked", reason: "cualquiera" });

		expect(noSePudoLeer.code).toBe("invalid_url");
		expect(afuera.code).toBe("blocked_url");
		expect(noSePudoLeer.message).not.toBe(afuera.message);
		// El texto del parseo habla de la forma; el del bloqueo, de la seguridad. No se confunden.
		expect(noSePudoLeer.message).toMatch(/interpretar/);
		expect(afuera.message).toMatch(/red interna/);
		expect(noSePudoLeer.message).not.toMatch(/red interna/);
	});

	it("un host que no resuelve se cuenta como bloqueado: desde afuera es lo mismo", () => {
		expect(classifyPublicAuditUrlFailure({ kind: "unresolved", reason: "ENOTFOUND" }).code).toBe("blocked_url");
	});

	it("no filtra el motivo real de un rechazo del guardián", () => {
		const rejection = classifyPublicAuditUrlFailure({ kind: "blocked", reason: '"sitio.com" resuelve a 10.0.0.7' });
		expect(rejection.message).not.toMatch(/10\.0\.0\.7|resuelve/);
	});
});

describe("publicAuditResponse", () => {
	function auditResult(overrides?: Partial<AosAuditResult>): AosAuditResult {
		return {
			url: "https://example.com/",
			operatorDetected: false,
			businessType: "brand",
			probes: {},
			standards: {
				business_type: "brand",
				aos_standards: 62,
				aps_standards: 40,
				signature_verified: true,
				breakdown: [
					{
						axis: "AOS",
						passed: 4,
						failed: 3,
						notApplicable: 1,
						applicable: 7,
						earnedWeight: 10,
						maxWeight: 16,
						percent: 62,
					},
					{
						axis: "APS",
						passed: 1,
						failed: 2,
						notApplicable: 0,
						applicable: 3,
						earnedWeight: 3,
						maxWeight: 7,
						percent: 40,
					},
				],
				requirements: [
					{
						id: "AOS-DISC-01",
						axis: "AOS",
						strength: "SHOULD",
						title: "llms.txt",
						status: "fail",
						evidence: "/llms.txt responde 404.",
						gain: 22.2,
					},
				],
			},
			extended: [
				{
					id: "AOS-DISC-02",
					axis: "AOS",
					strength: "MAY",
					title: "llms-full.txt",
					status: "fail",
					diagnostic: true,
				},
			],
			discoveryFiles: {},
			hasMcpOrOpenApi: false,
			aps: {
				aps: 41,
				scoring_version: "1.0.0",
				proof_coverage: 1,
				boundary_coverage: 1,
				evidence_strength: 1,
				smoke_penalty: 0,
				claims: 3,
				proofs: 2,
				unproven_claims: 1,
				claims_without_boundary: 0,
				unlinked_proofs: 0,
				smoke_hits: [],
				signed_provenance_applied: true,
				weights: { proof_coverage: 40, boundary_coverage: 30, evidence_strength: 20, smoke: 10 },
				findings: [],
			},
			score: 62,
			band: "Agent-Attemptable",
			...overrides,
		};
	}

	it("devuelve score, banda, tipo y los requerimientos con evidencia y ganancia", () => {
		const payload = publicAuditResponse(auditResult(), NOW);
		expect(payload).toMatchObject({
			url: "https://example.com/",
			score: 62,
			band: "Agent-Attemptable",
			businessType: "brand",
			declaredAps: 41,
			claims: 3,
			signatureVerified: true,
			auditedAt: "2026-03-14T22:30:00.000Z",
		});
		expect(payload.requirements).toHaveLength(2);
		expect(payload.requirements[0]?.evidence).toBe("/llms.txt responde 404.");
		expect(payload.requirements[0]?.gain).toBe(22.2);
		// Los diagnósticos viajan marcados: son parte del reporte, nunca del score.
		expect(payload.requirements[1]?.diagnostic).toBe(true);
	});

	it("sin brand.json publica declaredAps null y cero claims, no ceros inventados", () => {
		const payload = publicAuditResponse(auditResult({ aps: null }), NOW);
		expect(payload.declaredAps).toBeNull();
		expect(payload.claims).toBe(0);
	});

	it("signatureVerified refleja lo que dijo el motor", () => {
		const result = auditResult();
		result.standards.signature_verified = false;
		expect(publicAuditResponse(result, NOW).signatureVerified).toBe(false);
	});

	it("agrega los sub-scores por eje y el desglose, tal cual los calculó el motor", () => {
		const payload = publicAuditResponse(auditResult(), NOW);
		expect(payload.aosStandards).toBe(62);
		expect(payload.apsStandards).toBe(40);
		expect(payload.score).toBe(payload.aosStandards);
		expect(payload.breakdown.map((entry) => entry.axis)).toEqual(["AOS", "APS"]);
		// El endpoint no recalcula: publica el `percent` del motor, con su peso ganado y su máximo.
		expect(payload.breakdown[0]).toMatchObject({ axis: "AOS", earnedWeight: 10, maxWeight: 16, percent: 62 });
		expect(payload.breakdown[1]).toMatchObject({ axis: "APS", earnedWeight: 3, maxWeight: 7, percent: 40 });
	});

	it("el APS del estándar y el APS declarado son dos números distintos y no se pisan", () => {
		const payload = publicAuditResponse(auditResult(), NOW);
		// `apsStandards` es el APS del estándar: cuántos requisitos del eje APS cumple el sitio, un
		// chequeo del sitio. `declaredAps` es lo que el sitio dice de sí mismo. (Antes este test decía
		// "medido": el nombre era el bug, porque el tercer APS —el medido contra modelos— no pasa por acá.)
		expect(payload.apsStandards).toBe(40);
		expect(payload.declaredAps).toBe(41);
		expect(payload.apsStandards).not.toBe(payload.declaredAps);
	});

	it("botBeacon es null: no hay fuente y no se inventa un número", () => {
		// BeAOS no tiene ingest de tráfico agéntico. El campo viaja null para que el hueco sea
		// explícito y verificable, en vez de un cero que se leería como "no te visitó ningún agente".
		expect(publicAuditResponse(auditResult(), NOW).botBeacon).toBeNull();
	});

	it("no cambia ninguno de los campos que la extensión 2.0.0 ya leía", () => {
		const payload = publicAuditResponse(auditResult(), NOW);
		// Congelado a propósito: si alguno cambia de nombre o de forma, la 2.0.0 deja de funcionar.
		expect(Object.keys(payload).sort()).toEqual(
			[
				"apsStandards",
				"auditedAt",
				"aosStandards",
				"band",
				"botBeacon",
				"breakdown",
				"businessType",
				"claims",
				"declaredAps",
				"requirements",
				"score",
				"signatureVerified",
				"url",
			].sort(),
		);
		expect(payload.requirements).toHaveLength(2);
		expect(payload.claims).toBe(3);
		expect(payload.businessType).toBe("brand");
	});
});

describe("publicAuditBody", () => {
	it("exige una url no vacía", () => {
		expect(publicAuditBody.safeParse({}).success).toBe(false);
		expect(publicAuditBody.safeParse({ url: "   " }).success).toBe(false);
		expect(publicAuditBody.safeParse({ url: "https://example.com/" }).data).toEqual({ url: "https://example.com/" });
	});

	it("recorta la url y rechaza las larguísimas", () => {
		expect(publicAuditBody.safeParse({ url: " https://example.com/ " }).data).toEqual({
			url: "https://example.com/",
		});
		expect(publicAuditBody.safeParse({ url: `https://example.com/${"a".repeat(2100)}` }).success).toBe(false);
	});
});

describe("publicLeadBody", () => {
	it("normaliza el mail antes de validarlo: un espacio de más no es un 400", () => {
		const parsed = publicLeadBody.safeParse({ email: "  JORGE@Example.COM " });
		expect(parsed.success).toBe(true);
		expect(parsed.data?.email).toBe("jorge@example.com");
	});

	it("rechaza lo que no es un mail", () => {
		for (const email of ["", "no-es-mail", "sin@dominio", "@example.com", "a b@example.com"]) {
			expect(publicLeadBody.safeParse({ email }).success, email).toBe(false);
		}
	});

	it("acepta los campos opcionales del formulario", () => {
		const parsed = publicLeadBody.safeParse({
			email: "lead@example.com",
			name: "  Jorge  ",
			company: "Believe",
			url: "https://example.com/",
			score: 62,
		});
		expect(parsed.success).toBe(true);
		expect(parsed.data?.name).toBe("Jorge");
		expect(parsed.data?.score).toBe(62);
	});

	it("un score fuera de 0..100 se rechaza", () => {
		expect(publicLeadBody.safeParse({ email: "a@b.com", score: 101 }).success).toBe(false);
		expect(publicLeadBody.safeParse({ email: "a@b.com", score: -1 }).success).toBe(false);
	});
});
