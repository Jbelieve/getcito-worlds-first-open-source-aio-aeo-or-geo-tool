/**
 * El mismo código, producido por dos implementaciones que no se hablan.
 *
 * El código de conexión se genera por dos puertas: el servidor
 * (`apps/web/src/lib/enrollment.ts`, que es lo que corre el botón de Configuración → Brand) y el script
 * en bash (`scripts/beaos-enroll.sh`, porque el servidor de producción **no tiene node**). Las dos
 * escriben en `agent_enrollment_codes` el mismo `prefix` y el mismo `code_hash`, y el endpoint de canje
 * valida contra ese hash: si una se desvía, los códigos creados por esa vía dejan de canjear —y el
 * plugin de un cliente se queda sin poder conectarse—. Eso no se ve hasta que falla, así que se prueba
 * acá.
 *
 * Este test corre la **implementación de bash de verdad** (los subcomandos de diagnóstico `hash` y
 * `new-code`, que no leen `DATABASE_URL` ni tocan la base) y compara contra el módulo del servidor.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { generateEnrollmentCode, hashEnrollmentCode, prefixOfEnrollmentCode } from "@/lib/enrollment";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const BASH_SCRIPT = `${REPO_ROOT}scripts/beaos-enroll.sh`;

// Este archivo SPAWNEA openssl por bash, así que sus pruebas tardan más que el default de 5 s (el
// wrapper de Electron del harness tarda ~2,6 s por llamada). Esa demora no es una falla del código.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const GOLDEN_CODE = "beaos_test_token";
const GOLDEN_PREFIX = "beaos_te";
const GOLDEN_HASH = "cfda004146265aeeba4021e29492ebbad7a3088b830b38e52841786550aafa64";

const CODE_SHAPE = /^beaos_[A-Za-z0-9_-]{32}$/;
const HASH_SHAPE = /^[0-9a-f]{64}$/;

function runBash(args: string[]): string {
	return execFileSync("bash", [BASH_SCRIPT, ...args], { encoding: "utf8" }).trim();
}

function formatWithBash(code: string): { prefix: string; hash: string } {
	const [prefix = "", hash = ""] = runBash(["hash", code]).split(/\s+/);
	return { prefix, hash };
}

describe("formato del código de conexión: servidor y bash", () => {
	it("el vector fijo da el mismo prefijo y el mismo sha256 en los dos lados", () => {
		expect(formatWithBash(GOLDEN_CODE)).toEqual({ prefix: GOLDEN_PREFIX, hash: GOLDEN_HASH });
		expect(prefixOfEnrollmentCode(GOLDEN_CODE)).toBe(GOLDEN_PREFIX);
		expect(hashEnrollmentCode(GOLDEN_CODE)).toBe(GOLDEN_HASH);
	});

	it("el código nuevo de bash tiene la forma del contrato", () => {
		const code = runBash(["new-code"]);
		expect(code).toMatch(CODE_SHAPE);
		expect(code.slice("beaos_".length)).toHaveLength(32);
	});

	it("el sha256 que calcula bash es el que calcula el servidor, para sus propios códigos", () => {
		for (let i = 0; i < 3; i++) {
			const code = runBash(["new-code"]);
			expect(formatWithBash(code).hash).toMatch(HASH_SHAPE);
			expect(formatWithBash(code).hash).toBe(hashEnrollmentCode(code));
			expect(formatWithBash(code).prefix).toBe(prefixOfEnrollmentCode(code));
		}
	});

	it("los dos lados generan códigos distintos (no hay un literal compartido)", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 5; i++) {
			seen.add(runBash(["new-code"]));
			seen.add(generateEnrollmentCode());
		}
		expect(seen.size).toBe(10);
	});
});
