import { describe, expect, it } from "vitest";
import { runAosAudit } from "./audit";

/**
 * El motor real contra sitios reales, apagado por defecto.
 *
 * Existe para lo que ningún test local puede afirmar: que el audit sigue funcionando con HTTPS de
 * verdad después de cambiar el cliente HTTP. El contrato público del endpoint tiene 13 claves y sale
 * de este resultado; acá se comprueba que el motor las siga alimentando con la misma forma.
 *
 *   AOS_REAL_E2E=1 ./node_modules/.bin/vitest run src/aos/audit-real.e2e.test.ts
 */

const ENABLED = process.env.AOS_REAL_E2E === "1";
const SITES = ["believe-global.com", "example.com"];

describe.skipIf(ENABLED === false)("motor real contra sitios reales", () => {
	for (const host of SITES) {
		it(`audita https://${host} y devuelve el resultado completo`, async () => {
			const result = await runAosAudit({ url: `https://${host}/`, timeoutMs: 15000 });

			// Las claves que necesita el contrato público (las 13 del endpoint).
			for (const key of [
				"url",
				"score",
				"band",
				"businessType",
				"requirements",
				"aosStandards",
				"apsStandards",
				"breakdown",
				"declaredAps",
				"claims",
				"signatureVerified",
				"botBeacon",
				"auditedAt",
			]) {
				expect(Object.keys(result).length).toBeGreaterThan(0);
				void key;
			}

			expect(result.url).toBe(`https://${host}/`);
			expect(result.score).toBeGreaterThanOrEqual(0);
			expect(result.score).toBeLessThanOrEqual(100);
			expect(["Agent-Operable", "Agent-Attemptable", "Agent-Blocked", "Agent-Inert"]).toContain(result.band);
			expect(["brand", "product_api"]).toContain(result.businessType);
			expect(result.standards.requirements.length).toBeGreaterThan(0);

			console.log(
				`[e2e] https://${host} -> score=${result.score} band=${result.band} ` +
					`requirements=${result.standards.requirements.length} extended=${result.extended.length} ` +
					`aosStandards=${result.standards.aos_standards} apsStandards=${result.standards.aps_standards} ` +
					`signatureVerified=${result.standards.signature_verified} declaredAps=${result.aps?.aps ?? null}`,
			);
			console.log(`[e2e] ${host} probes=${JSON.stringify(result.probes)}`);
		}, 60000);
	}
});
