/**
 * La guarda de forma de las rutas del kit, y su atadura con el otro lado.
 *
 * Tres cosas se prueban acá, y las tres son sobre el mismo riesgo:
 *
 *   1. **La regla**: el corpus compartido (`KIT_ROUTE_VECTORS`) da el veredicto que `isKitRoute()` tiene
 *      que devolver. Es la misma lista que lee `apps/beaos-wordpress/tests/pure.php` para verificar la
 *      lista blanca del plugin: un caso nuevo se agrega una sola vez y los dos lados lo cumplen.
 *   2. **El generador**: las 15 rutas que el kit emite hoy pasan la guarda. Si mañana el generador emite
 *      una ruta de más, esto falla y dice cuál.
 *   3. **El `CHECK` de la base**: la lista explícita de rutas prohibidas **no** está en el SQL (sería una
 *      copia sin poder de decisión), así que acá se prueba que cada una de sus entradas ya cae por la
 *      forma —termina en `.php` o está fuera de la forma del kit—. Si alguien agrega una prohibida que no
 *      cumpla eso, el `CHECK` dejaría de ser equivalente a la regla y este test lo dice.
 */

import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { SigningKey } from "../provenance";
import { generateAgentAssets } from "./generate";
import {
	isKitRoute,
	KIT_DENIED_PATHS,
	KIT_PATH_MAX_LENGTH,
	KIT_ROOT_PATHS,
	KIT_ROUTE_VECTORS,
	kitRouteRejectionReason,
} from "./kit-routes";

/** La carpeta de este test, para poder leer `kit-routes.ts` como texto (lo que hace el test de PHP). */
const AQUI = fileURLToPath(new URL(".", import.meta.url));

/** La misma clave efímera que usa `generate.test.ts`: el generador necesita una para firmar. */
function newSigningKey(): SigningKey {
	const { privateKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	return { keyId: "believe-2026-primary", material: pkcs8.toString("base64") };
}

describe("isKitRoute", () => {
	it("el corpus compartido da el veredicto que la guarda tiene que dar", () => {
		const discrepancias = KIT_ROUTE_VECTORS.filter(([path, esperado]) => isKitRoute(path) !== esperado).map(
			([path, esperado]) =>
				`${path}: esperado ${esperado}, salió ${isKitRoute(path)} (${kitRouteRejectionReason(path)})`,
		);
		expect(discrepancias).toEqual([]);
	});

	it("el corpus no es una lista de juguete: tiene rechazos y aceptaciones de sobra", () => {
		expect(KIT_ROUTE_VECTORS.length).toBeGreaterThanOrEqual(30);
		expect(KIT_ROUTE_VECTORS.filter(([, esperado]) => esperado).length).toBeGreaterThanOrEqual(15);
		expect(KIT_ROUTE_VECTORS.filter(([, esperado]) => esperado === false).length).toBeGreaterThanOrEqual(20);
	});

	it("rechaza por el tope de largo, que no puede vivir en el corpus (no es un literal)", () => {
		const larga = `/.well-known/${"a".repeat(KIT_PATH_MAX_LENGTH)}`;
		expect(larga.length).toBeGreaterThan(KIT_PATH_MAX_LENGTH);
		expect(isKitRoute(larga)).toBe(false);
		expect(kitRouteRejectionReason(larga)).toBe(`es más larga que ${KIT_PATH_MAX_LENGTH} caracteres`);

		// Justo en el tope, y con forma de kit, sí pasa: el límite es `> 256`, no `>= 256`.
		const justa = `/.well-known/${"a".repeat(KIT_PATH_MAX_LENGTH - "/.well-known/".length)}`;
		expect(justa.length).toBe(KIT_PATH_MAX_LENGTH);
		expect(isKitRoute(justa)).toBe(true);
	});

	it("el motivo del rechazo dice cuál de las reglas se rompió", () => {
		expect(kitRouteRejectionReason("/wp-login.php")).toBe("está en la lista de rutas prohibidas");
		expect(kitRouteRejectionReason("/una-pagina/")).toBe("no tiene forma de kit");
		expect(kitRouteRejectionReason("llms.txt")).toBe("no es una ruta absoluta");
		expect(kitRouteRejectionReason("/../x")).toBe("tiene ..");
		expect(kitRouteRejectionReason("")).toBe("no es la ruta de un archivo");
		expect(kitRouteRejectionReason("/")).toBe("no es la ruta de un archivo");
		expect(kitRouteRejectionReason("/.well-known/ñ.json")).toBe("tiene caracteres que ninguna ruta del kit usa");
		expect(kitRouteRejectionReason("/llms.txt")).toBe("");
	});
});

describe("la lista explícita de prohibidas y el CHECK de la base", () => {
	/**
	 * El `CHECK` de `agent_assets.path` **no** repite la lista de prohibidas: sería una cuarta copia sin
	 * poder de decisión. Se puede omitir porque cada entrada ya cae por la forma. Esto lo verifica, y el
	 * día que deje de ser cierto el `CHECK` y `isKitRoute()` dejarían de ser equivalentes.
	 */
	it("cada ruta prohibida ya cae por la forma: .php o fuera del kit", () => {
		const sinCobertura = KIT_DENIED_PATHS.filter((denied) => {
			const terminadoEnPhp = denied.toLowerCase().endsWith(".php");
			const fueraDeLaForma = KIT_ROOT_PATHS.includes(denied) === false && denied.startsWith("/.well-known/") === false;
			return terminadoEnPhp === false && fueraDeLaForma === false;
		});
		expect(sinCobertura).toEqual([]);
		expect(KIT_DENIED_PATHS.length).toBe(22);
	});

	it("ninguna prohibida es, a la vez, una ruta legítima del kit", () => {
		for (const root of KIT_ROOT_PATHS) expect(KIT_DENIED_PATHS).not.toContain(root);
	});
});

describe("el corpus que lee el test de PHP", () => {
	/**
	 * `apps/beaos-wordpress/tests/pure.php` lee este archivo **como texto**: busca las tuplas con una
	 * expresión regular, una por línea. Si el formato cambia (una entrada partida en dos líneas, una
	 * plantilla en vez de un literal), el parser de PHP deja de ver casos y el test de allá pasaría
	 * verificando menos de lo que cree. Esto reproduce ese parser y exige que vea **todas** las entradas,
	 * en orden: es la garantía de que la atadura entre los dos lados sigue entera.
	 */
	it("el parser de PHP puede leer todas las entradas del corpus", () => {
		const fuente = readFileSync(`${AQUI}kit-routes.ts`, "utf8");
		const bloque = fuente.slice(fuente.indexOf("export const KIT_ROUTE_VECTORS"));
		const leidas: Array<[string, boolean]> = [];
		for (const linea of bloque.split(/\r?\n/)) {
			const match = /^\s*\["([^"]*)",\s*(true|false)\],/.exec(linea);
			if (match !== null) leidas.push([match[1] ?? "", match[2] === "true"]);
		}
		expect(leidas).toEqual(KIT_ROUTE_VECTORS.map(([path, expected]) => [path, expected]));
		expect(leidas.length).toBe(KIT_ROUTE_VECTORS.length);
	});
});

describe("el generador y la guarda", () => {
	it("las 15 rutas que el kit emite hoy pasan la guarda", () => {
		const signing = newSigningKey();
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			industry: "Marketing",
			brief: "Marketing como sistema de preferencia.",
			mcpUrl: "https://believe-global.com/mcp",
			apiUrl: "https://believe-global.com/api/v1",
			openApiUrl: "https://believe-global.com/openapi.json",
			securityContact: "mailto:security@believe-global.com",
			ardEntries: [
				{
					name: "brand-profile",
					namespace: "brand",
					type: "application/json",
					url: "https://believe-global.com/.well-known/brand.json",
					representativeQueries: ["que hace believe", "quien es believe"],
				},
			],
			dna: { business_description: "Believe instala sistemas de preferencia." },
			signing,
		});

		expect(assets.length).toBe(15);
		const rechazadas = assets.filter((asset) => isKitRoute(asset.path) === false).map((asset) => asset.path);
		expect(rechazadas).toEqual([]);
		// Las anclas: el test no puede pasar por tener una lista vacía.
		expect(assets.map((asset) => asset.path)).toContain("/llms.txt");
		expect(assets.map((asset) => asset.path)).toContain("/.well-known/brand.json");
	});

	it("la guarda no acepta una ruta del core, que es lo que puede tapar el login", () => {
		expect(isKitRoute("/wp-login.php")).toBe(false);
		expect(isKitRoute("/wp-admin/options-general.php")).toBe(false);
		// Y el caso que el corpus documenta como agujero histórico, ahora cerrado.
		expect(isKitRoute("/index.php")).toBe(false);
	});
});
