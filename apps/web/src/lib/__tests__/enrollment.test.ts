/**
 * El código de conexión: el formato y las decisiones, sin base ni red.
 *
 * Lo que se prueba acá es la mitad que se puede probar como función: que el código tenga la entropía y
 * la forma del contrato, que el hash y el prefijo sean los que el script en bash también calcula, y que
 * la decisión de canje rechace lo que tiene que rechazar. La garantía de un solo uso **no** se prueba
 * acá —vive en el `UPDATE ... WHERE used_at IS NULL RETURNING` de `enrollment.server.ts`, y una función
 * pura no puede probar una carrera—: eso se verifica contra un Postgres real.
 */
import { describe, expect, it } from "vitest";
import {
	ENROLLMENT_CODE_BYTES,
	ENROLLMENT_PREFIX_LENGTH,
	ENROLLMENT_REJECTION_MESSAGE,
	ENROLLMENT_TTL_HOURS,
	enrollmentExpiry,
	evaluateEnrollmentCode,
	generateEnrollmentCode,
	hashEnrollmentCode,
	prefixOfEnrollmentCode,
} from "@/lib/enrollment";

/**
 * El vector fijo, el mismo que usa `beaos-enroll-scripts.test.ts`: si el formato se desvía en un lado,
 * se ve en los dos.
 */
const GOLDEN_CODE = "beaos_test_token";
const GOLDEN_PREFIX = "beaos_te";
const GOLDEN_HASH = "cfda004146265aeeba4021e29492ebbad7a3088b830b38e52841786550aafa64";

/** `beaos_` + 32 caracteres de base64url (24 bytes), sin padding. */
const CODE_SHAPE = /^beaos_[A-Za-z0-9_-]{32}$/;

describe("el código de conexión", () => {
	it("tiene la forma del contrato: beaos_ + base64url de 24 bytes, sin padding", () => {
		for (let i = 0; i < 50; i++) {
			expect(generateEnrollmentCode()).toMatch(CODE_SHAPE);
		}
	});

	it("no se repite: 200 códigos, 200 distintos", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i++) seen.add(generateEnrollmentCode());
		expect(seen.size).toBe(200);
	});

	it("los 24 bytes son 192 bits: no es un número decorativo", () => {
		// 32 caracteres base64url son 24 bytes. Si alguien lo baja "para que sea más corto", esto falla.
		expect(ENROLLMENT_CODE_BYTES).toBe(24);
		expect(generateEnrollmentCode().slice("beaos_".length)).toHaveLength(32);
	});

	it("el hash es el sha256 en hex del código, y el prefijo son los primeros 8", () => {
		expect(hashEnrollmentCode(GOLDEN_CODE)).toBe(GOLDEN_HASH);
		expect(prefixOfEnrollmentCode(GOLDEN_CODE)).toBe(GOLDEN_PREFIX);
		expect(ENROLLMENT_PREFIX_LENGTH).toBe(8);
	});

	it("el hash no depende del entorno: el mismo código da el mismo hash", () => {
		expect(hashEnrollmentCode(GOLDEN_CODE)).toBe(hashEnrollmentCode(GOLDEN_CODE));
		expect(hashEnrollmentCode(GOLDEN_CODE)).not.toBe(hashEnrollmentCode(`${GOLDEN_CODE} `));
	});
});

describe("la decisión de canje", () => {
	const now = new Date("2026-10-02T12:00:00.000Z");

	it("un código sin usar y sin vencer se puede canjear", () => {
		expect(evaluateEnrollmentCode({ expiresAt: new Date("2026-10-03T12:00:00.000Z"), usedAt: null }, now)).toBeNull();
	});

	it("uno ya usado se rechaza, y se reporta como usado", () => {
		expect(
			evaluateEnrollmentCode(
				{ expiresAt: new Date("2026-10-03T12:00:00.000Z"), usedAt: new Date("2026-10-02T11:00:00.000Z") },
				now,
			),
		).toBe("used");
	});

	it("uno vencido se rechaza", () => {
		expect(evaluateEnrollmentCode({ expiresAt: new Date("2026-10-02T11:59:59.000Z"), usedAt: null }, now)).toBe(
			"expired",
		);
	});

	it("el vencimiento es inclusive: en el mismo instante ya no sirve", () => {
		expect(evaluateEnrollmentCode({ expiresAt: new Date(now.getTime()), usedAt: null }, now)).toBe("expired");
	});

	it("si está usado y vencido, gana 'usado': el hecho relevante es que el canje ocurrió", () => {
		expect(
			evaluateEnrollmentCode(
				{ expiresAt: new Date("2026-10-01T00:00:00.000Z"), usedAt: new Date("2026-09-30T00:00:00.000Z") },
				now,
			),
		).toBe("used");
	});

	it("el mensaje de rechazo es UNO solo: no distingue cuál de los tres motivos fue", () => {
		// Distinguirlos le confirmaría a quien prueba cuáles códigos existen. El test lo fija como contrato.
		expect(ENROLLMENT_REJECTION_MESSAGE).toContain("no existe");
		expect(ENROLLMENT_REJECTION_MESSAGE).toContain("ya venció");
		expect(ENROLLMENT_REJECTION_MESSAGE).toContain("ya se usó");
	});

	it("el vencimiento por defecto son 24 horas desde el reloj que se le pasa", () => {
		expect(ENROLLMENT_TTL_HOURS).toBe(24);
		expect(enrollmentExpiry(now).toISOString()).toBe("2026-10-03T12:00:00.000Z");
		expect(enrollmentExpiry(now, 1).toISOString()).toBe("2026-10-02T13:00:00.000Z");
	});
});
