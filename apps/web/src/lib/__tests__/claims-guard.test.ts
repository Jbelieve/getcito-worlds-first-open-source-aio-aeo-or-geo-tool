import { describe, expect, it } from "vitest";
import { claimCount, claimsGuardDecision, websiteSourcesForClaims } from "../claims-guard";

describe("claimCount", () => {
	it("cuenta los claims de un brand.json", () => {
		expect(claimCount(JSON.stringify({ claims: [{ claim_id: "a" }, { claim_id: "b" }] }))).toBe(2);
	});

	it("un perfil sin claims declara cero, que es un dato", () => {
		expect(claimCount(JSON.stringify({ claims: [] }))).toBe(0);
		expect(claimCount(JSON.stringify({}))).toBe(0);
	});

	it("no poder leerlo NO es cero: es null", () => {
		// La diferencia importa: confundirlas bloquearia publicaciones legitimas.
		expect(claimCount(null)).toBeNull();
		expect(claimCount(undefined)).toBeNull();
		expect(claimCount("")).toBeNull();
		expect(claimCount("<html>404</html>")).toBeNull();
	});
});

describe("claimsGuardDecision", () => {
	it("bloquea cuando el bundle PIERDE claims respecto del sitio", () => {
		// El caso real: el sitio sirve 6, el bundle generado declara 0.
		const decision = claimsGuardDecision(0, 6);
		expect(decision.blocked).toBe(true);
		expect(decision.reason).toContain("6 claims");
		expect(decision.reason).toContain("0");
	});

	it("deja pasar empates y mejoras", () => {
		expect(claimsGuardDecision(6, 6).blocked).toBe(false);
		expect(claimsGuardDecision(7, 6).blocked).toBe(false);
	});

	it("sin perfil vivo no bloquea: avisa", () => {
		const decision = claimsGuardDecision(0, null);
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("No pudimos leer el perfil del sitio");
	});

	it("sin bundle generado no bloquea: avisa", () => {
		const decision = claimsGuardDecision(null, 6);
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("No hay un brand.json generado");
	});

	it("no traduce texto a claims: solo compara", () => {
		// Publicar un perfil sin claims cuando el sitio tampoco tiene ninguno es legitimo.
		expect(claimsGuardDecision(0, 0)).toEqual({ blocked: false });
	});
});

describe("las fuentes de la web para el candado (el agujero que se cerró)", () => {
	it("prefiere la entidad, después el DNA, y por último la marca", () => {
		expect(
			websiteSourcesForClaims({
				entityWebsite: "https://entidad.com",
				dnaWebsite: "https://dna.com",
				brandWebsite: "https://marca.com",
			}),
		).toEqual(["https://entidad.com", "https://dna.com", "https://marca.com"]);
	});

	it("el caso real de Believe: la entidad vacía y la marca llena", () => {
		// Esto es exactamente lo que había en producción: `website_url` vacío en la entidad.
		// Antes devolvía una sola fuente vacía y el candado abría.
		const sources = websiteSourcesForClaims({
			entityWebsite: null,
			dnaWebsite: undefined,
			brandWebsite: "https://believe-global.com/",
		});
		expect(sources).toEqual(["https://believe-global.com/"]);
		expect(sources.length).toBeGreaterThan(0);
	});

	it("descarta lo que no es texto, lo vacío y los repetidos", () => {
		expect(websiteSourcesForClaims({ entityWebsite: "   ", dnaWebsite: 42, brandWebsite: null })).toEqual([]);
		expect(
			websiteSourcesForClaims({
				entityWebsite: "https://misma.com",
				dnaWebsite: "https://misma.com",
				brandWebsite: null,
			}),
		).toEqual(["https://misma.com"]);
	});

	it("sin ninguna fuente devuelve vacío: ahí el aviso dice la verdad, no pudimos verificar", () => {
		expect(websiteSourcesForClaims({})).toEqual([]);
	});
});
