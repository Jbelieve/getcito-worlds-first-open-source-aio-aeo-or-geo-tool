/**
 * El límite por IP del canje de códigos de conexión.
 *
 * `POST /api/v1/enroll` es público y el código es la única credencial, así que sin límite sería una
 * puerta a fuerza bruta. Lo que se prueba acá es que **no se construyó un segundo contador**: el canje
 * es un carril más del mismo `aos_public_usage` que ya usa el audit público —misma clave de IP hasheada,
 * mismo día UTC, mismo `insert ... on conflict ... where count < limite`, mismas cabeceras
 * `RateLimit-*`— con su bucket y sus topes propios.
 *
 * Y se prueba lo que hace que el carril sirva: que los pozos **no se mezclen**. Un intento de canje no
 * puede gastarle el cupo de auditorías a la misma IP, ni una campaña de auditorías puede dejar a los
 * clientes sin poder conectar su WordPress.
 */
import { describe, expect, it } from "vitest";
import {
	DEFAULT_AUDITS_PER_DAY,
	DEFAULT_AUDITS_PER_DAY_GLOBAL,
	DEFAULT_ENROLL_PER_DAY,
	DEFAULT_ENROLL_PER_DAY_GLOBAL,
	decidePublicQuota,
	ENROLL_POLICY,
	ENROLL_QUOTA_BUCKET,
	PUBLIC_QUOTA_BUCKET,
	publicAuditLimits,
	quotaBucketForLane,
	quotaGlobalLimitForLane,
	quotaLimitForLane,
	rateLimitHeaders,
	rateLimitedResponse,
	VERIFY_QUOTA_BUCKET,
} from "@/lib/aos/public-audit";

describe("el carril `enroll` del contador", () => {
	it("usa un bucket propio, en la misma tabla", () => {
		expect(quotaBucketForLane("enroll")).toBe(ENROLL_QUOTA_BUCKET);
		// Los tres carriles son buckets distintos de la misma tabla: no hay un segundo contador y no se
		// pisan entre sí.
		expect(new Set([ENROLL_QUOTA_BUCKET, PUBLIC_QUOTA_BUCKET, VERIFY_QUOTA_BUCKET]).size).toBe(3);
	});

	it("tiene su propio tope por IP, más chico que el del audit", () => {
		const limits = publicAuditLimits({});
		expect(quotaLimitForLane("enroll", limits)).toBe(DEFAULT_ENROLL_PER_DAY);
		expect(quotaLimitForLane("enroll", limits)).toBeLessThan(quotaLimitForLane("ip", limits));
		// Y no le mueve el cupo a nadie: el del audit sigue igual.
		expect(quotaLimitForLane("ip", limits)).toBe(DEFAULT_AUDITS_PER_DAY);
	});

	it("no comparte el pozo global del servicio: frenar el canje no apaga el medidor", () => {
		const limits = publicAuditLimits({});
		expect(quotaGlobalLimitForLane("enroll", limits)).toBe(DEFAULT_ENROLL_PER_DAY_GLOBAL);
		expect(quotaGlobalLimitForLane("ip", limits)).toBe(DEFAULT_AUDITS_PER_DAY_GLOBAL);
		expect(quotaGlobalLimitForLane("verify", limits)).toBe(DEFAULT_AUDITS_PER_DAY_GLOBAL);
		expect(quotaGlobalLimitForLane("enroll", limits)).not.toBe(quotaGlobalLimitForLane("ip", limits));
	});

	it("los topes se configuran por env, con los defaults documentados", () => {
		const limits = publicAuditLimits({
			AOS_PUBLIC_ENROLL_PER_DAY: "3",
			AOS_PUBLIC_ENROLL_PER_DAY_GLOBAL: "50",
		});
		expect(quotaLimitForLane("enroll", limits)).toBe(3);
		expect(quotaGlobalLimitForLane("enroll", limits)).toBe(50);
	});

	it("un valor inválido en la env cae al default, no a cero", () => {
		// Un `0` o un `abc` en la env no puede dejar el endpoint abierto sin límite ni cerrado para todos.
		for (const raw of ["0", "-5", "abc", ""]) {
			const limits = publicAuditLimits({ AOS_PUBLIC_ENROLL_PER_DAY: raw });
			expect(quotaLimitForLane("enroll", limits)).toBe(DEFAULT_ENROLL_PER_DAY);
		}
	});

	it("las reglas son las mismas: la decisión es la misma función del audit", () => {
		const limits = publicAuditLimits({});
		const now = new Date("2026-03-14T22:30:00.000Z");
		const agotado = decidePublicQuota({
			ipCount: quotaLimitForLane("enroll", limits),
			globalCount: 0,
			ipLimit: quotaLimitForLane("enroll", limits),
			globalLimit: quotaGlobalLimitForLane("enroll", limits),
			now,
		});
		expect(agotado).toMatchObject({ allowed: false, reason: "ip_limit", limit: DEFAULT_ENROLL_PER_DAY });
		// Rechazado: con `Retry-After`, que es lo que el plugin le muestra al operador.
		expect(agotado.retryAfterSeconds).toBeGreaterThan(0);

		const global = decidePublicQuota({
			ipCount: 0,
			globalCount: quotaGlobalLimitForLane("enroll", limits),
			ipLimit: quotaLimitForLane("enroll", limits),
			globalLimit: quotaGlobalLimitForLane("enroll", limits),
			now,
		});
		expect(global).toMatchObject({ allowed: false, reason: "global_limit", limit: DEFAULT_ENROLL_PER_DAY_GLOBAL });
	});

	it("un intento permitido deja el cupo que corresponde a su carril", () => {
		const limits = publicAuditLimits({});
		const now = new Date("2026-03-14T22:30:00.000Z");
		const primero = decidePublicQuota({
			ipCount: 0,
			globalCount: 0,
			ipLimit: quotaLimitForLane("enroll", limits),
			globalLimit: quotaGlobalLimitForLane("enroll", limits),
			now,
		});
		expect(primero.allowed).toBe(true);
		// Nueve intentos más y todavía entra; el décimo ya no. Es el cupo chico del canje, no el del audit.
		expect(primero.remaining).toBe(DEFAULT_ENROLL_PER_DAY - 1);
	});

	it("las cabeceras `RateLimit-*` salen de la misma función, con la política del canje", () => {
		const limits = publicAuditLimits({});
		const decision = decidePublicQuota({
			ipCount: 0,
			globalCount: 0,
			ipLimit: quotaLimitForLane("enroll", limits),
			globalLimit: quotaGlobalLimitForLane("enroll", limits),
			now: new Date("2026-03-14T22:30:00.000Z"),
		});
		const headers = rateLimitHeaders(decision, ENROLL_POLICY);
		expect(headers["RateLimit-Policy"]).toContain(ENROLL_POLICY);
		expect(headers["RateLimit-Limit"]).toBe(String(DEFAULT_ENROLL_PER_DAY));
		// El contrato es el mismo que el del audit: las cinco cabeceras, y `Retry-After` sólo al rechazar.
		expect(Object.keys(headers).sort()).toEqual([
			"RateLimit",
			"RateLimit-Limit",
			"RateLimit-Policy",
			"RateLimit-Remaining",
			"RateLimit-Reset",
		]);
		expect(headers["Retry-After"]).toBeUndefined();
	});

	it("el 429 dice `enroll`, no `aos-audit`: quien lee el log tiene que saber de qué límite es", async () => {
		const limits = publicAuditLimits({});
		const agotado = decidePublicQuota({
			ipCount: quotaLimitForLane("enroll", limits),
			globalCount: 0,
			ipLimit: quotaLimitForLane("enroll", limits),
			globalLimit: quotaGlobalLimitForLane("enroll", limits),
			now: new Date("2026-03-14T22:30:00.000Z"),
		});
		const response = rateLimitedResponse(
			agotado,
			"Alcanzaste el límite de 10 intentos de conexión por día.",
			ENROLL_POLICY,
		);
		expect(response.status).toBe(429);
		expect(response.headers.get("RateLimit-Policy")).toContain(ENROLL_POLICY);
		expect(response.headers.get("RateLimit-Policy")).not.toContain("aos-audit");
		expect(response.headers.get("Retry-After")).not.toBeNull();
		await expect(response.json()).resolves.toMatchObject({ error: "Too Many Requests" });

		// Y el default sigue siendo el del audit: el contrato de la extensión pública no cambió.
		const porDefecto = rateLimitedResponse(agotado, "…");
		expect(porDefecto.headers.get("RateLimit-Policy")).toContain("aos-audit");
	});
});
