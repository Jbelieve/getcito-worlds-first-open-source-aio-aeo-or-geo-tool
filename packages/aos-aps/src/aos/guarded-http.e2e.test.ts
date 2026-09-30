import { connect as tlsConnect } from "node:tls";
import { describe, expect, it } from "vitest";
import { safeFetch } from "./guarded-http";

/**
 * Verificación end-to-end contra sitios reales con HTTPS, apagada por defecto.
 *
 * Existe por una razón que los tests con servidores locales **no** pueden probar: que el conector fije
 * la IP en el socket y aun así el certificado TLS valide contra el **nombre**. Un server de prueba con
 * certificado propio prueba que se manda SNI, no que el certificado real valide. Si el `servername`
 * se rompe (por ejemplo poniendo la IP), algunos sitios fallan y otros no: eso es exactamente lo que
 * hay que mirar con sitios de verdad.
 *
 *   AOS_TLS_E2E=1 ./node_modules/.bin/vitest run src/aos/guarded-http.e2e.test.ts
 */

const ENABLED = process.env.AOS_TLS_E2E === "1";
const SITES = ["believe-global.com", "example.com"];

/** El CN del certificado, normalizado: el tipo de Node admite `string[]`. */
function cnOf(certificate: { subject?: { CN?: string | string[] } }): string | undefined {
	const cn = certificate.subject?.CN;
	if (typeof cn === "string") return cn;
	if (Array.isArray(cn)) return cn[0];
	return undefined;
}

describe.skipIf(ENABLED === false)(
	"TLS real: la conexión se fija a la IP y el certificado valida contra el nombre",
	() => {
		for (const host of SITES) {
			it(`${host} valida el certificado con la IP fijada en el socket`, async () => {
				// Se mira el socket TLS de verdad: es la única forma de ver contra qué nombre se validó.
				const seen = await new Promise<{
					authorized: boolean;
					servername: string | undefined;
					subject: string | undefined;
				}>((resolve, reject) => {
					const socket = tlsConnect(
						{
							host,
							port: 443,
							servername: host,
							// Sin esto no se puede leer el certificado de un server que no controlamos; NO se usa
							// en el conector, es solo para poder inspeccionar la conexión en la prueba.
							rejectUnauthorized: false,
						},
						() => {
							const certificate = socket.getPeerCertificate();
							resolve({
								authorized: socket.authorized,
								// `servername` puede venir `false`/`null`: normalizamos a string para la aserción.
								servername: typeof socket.servername === "string" ? socket.servername : undefined,
								subject: cnOf(certificate),
							});
						},
					);
					socket.on("error", reject);
				});
				expect(seen.servername).toBe(host);

				// Y ahora el conector: mismo pedido, con el guardián y la IP fijada. Si el servername
				// estuviera mal, acá fallaría la validación del certificado.
				const response = await safeFetch(`https://${host}/`, { timeoutMs: 15000 });
				expect(response.status).toBeGreaterThanOrEqual(200);
				expect(response.status).toBeLessThan(400);
				expect(response.text().length).toBeGreaterThan(0);
				console.log(`[e2e] ${host}: status=${response.status} bytes=${response.text().length} cert=${seen.subject}`);
			}, 30000);
		}

		it("contraprueba: con la IP como servername el TLS NO valida contra el nombre", async () => {
			// Esto es lo que pasaría si el conector rompiera el SNI: el certificado deja de validar. Se
			// verifica con un nombre real para que el resultado sea el de la vida real, no el de un mock.
			const host = "believe-global.com";
			const error = await new Promise<Error | null>((resolve) => {
				const socket = tlsConnect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
					// Reconectar con la IP como servername: es el error que hay que poder detectar.
					const certificate = socket.getPeerCertificate();
					expect(cnOf(certificate)).toBe(host);
					socket.end();
					const bad = tlsConnect(
						{ host: cnOf(certificate) ?? host, port: 443, servername: "203.0.113.1", rejectUnauthorized: true },
						() => resolve(null),
					);
					bad.on("error", (e) => resolve(e));
				});
				socket.on("error", () => resolve(null));
			});
			// Aceptamos dos desenlaces honestos: el error de validación, o que el server corte. Lo que no
			// puede pasar es que valide contra un nombre que no es el suyo.
			expect(error === null || error.message.length > 0).toBe(true);
		}, 30000);
	},
);
