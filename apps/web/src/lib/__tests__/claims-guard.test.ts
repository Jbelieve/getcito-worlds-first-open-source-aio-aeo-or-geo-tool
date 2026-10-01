import { inheritedPrefix } from "@workspace/aos-aps/claims";
import { describe, expect, it } from "vitest";
import {
	type ClaimTally,
	claimsGuardDecision,
	claimTally,
	tallyClaims,
	websiteSourcesForClaims,
} from "../claims-guard";

/**
 * Una prueba propia: su resumen no declara ninguna herencia.
 *
 * Lleva la prueba anidada porque así la emite el generador (`claimFromRow`): el claim del perfil firmado
 * viaja con su `proofs[0]` adentro.
 */
function ownProof(id: string) {
	return {
		claim_id: `CLM-${id}`,
		statement: `La afirmación propia ${id}.`,
		linked_proofs: [`PRF-CLM-${id}`],
		proofs: [
			{
				proof_id: `PRF-CLM-${id}`,
				type: "document",
				title: `Prueba ${id}`,
				claim_refs: [`CLM-${id}`],
				evidence: { summary: `Resumen propio ${id}.` },
			},
		],
	};
}

/**
 * Una prueba prestada: la marca la escribe el generador con `inheritedPrefix`, no una copia de este test.
 *
 * Se arma con la función real del paquete a propósito: si la marca cambiara de forma, el candado tiene que
 * romper un test, no dejar de reconocerla en silencio.
 */
function borrowedProof(id: string, umbrellaName = "Believe") {
	return {
		claim_id: `CLM-${id}`,
		statement: "Más de 100 proyectos entregados.",
		linked_proofs: [`PRF-CLM-${id}`],
		proofs: [
			{
				proof_id: `PRF-CLM-${id}`,
				type: "document",
				title: "Antigüedad de la casa",
				claim_refs: [`CLM-${id}`],
				evidence: { summary: `${inheritedPrefix(umbrellaName)} Más de 100 proyectos entregados.` },
			},
		],
	};
}

function profile(...claims: unknown[]): string {
	return JSON.stringify({ claims });
}

/** El desglose tal como lo devuelve `claimTally`, para las decisiones armadas a mano. */
function tally(total: number, inherited = 0): ClaimTally {
	return { total, inherited, own: total - inherited };
}

describe("claimTally", () => {
	it("cuenta los claims de un brand.json, todos propios si no hay marca de herencia", () => {
		expect(claimTally(profile(ownProof("A"), ownProof("B")))).toEqual({ total: 2, inherited: 0, own: 2 });
	});

	it("separa las prestadas del paraguas de las propias", () => {
		// El caso real de BeAOS/BeScore: el perfil del sitio declara 6 = 5 propias + 1 prestada.
		const sitio = profile(
			ownProof("A"),
			ownProof("B"),
			ownProof("C"),
			ownProof("D"),
			ownProof("E"),
			borrowedProof("PARAGUAS"),
		);
		expect(claimTally(sitio)).toEqual({ total: 6, inherited: 1, own: 5 });
	});

	it("reconoce el prefijo sin nombre de paraguas", () => {
		const sinNombre = borrowedProof("PARAGUAS", "");
		expect(claimTally(profile(sinNombre))).toEqual({ total: 1, inherited: 1, own: 0 });
	});

	it("no confunde una prueba propia que menciona el paraguas a mitad del resumen", () => {
		// La marca es un prefijo, no una mención: una propia que hable del paraguas sigue siendo propia.
		const propia = {
			claim_id: "CLM-A",
			statement: "La afirmación propia A.",
			linked_proofs: ["PRF-CLM-A"],
			proofs: [
				{
					proof_id: "PRF-CLM-A",
					type: "document",
					title: "Prueba A",
					claim_refs: ["CLM-A"],
					evidence: { summary: "Trabajamos con el paraguas Believe desde 2019." },
				},
			],
		};
		expect(claimTally(profile(propia))).toEqual({ total: 1, inherited: 0, own: 1 });
	});

	it("un perfil sin claims declara cero, que es un dato", () => {
		expect(claimTally(JSON.stringify({ claims: [] }))).toEqual({ total: 0, inherited: 0, own: 0 });
		expect(claimTally(JSON.stringify({}))).toEqual({ total: 0, inherited: 0, own: 0 });
		expect(claimTally(JSON.stringify({ claims: "no es un arreglo" }))).toEqual({ total: 0, inherited: 0, own: 0 });
	});

	it("una lista de claims ya resuelta se desglosa igual (el bundle en memoria)", () => {
		expect(tallyClaims([ownProof("A"), borrowedProof("PARAGUAS")])).toEqual({ total: 2, inherited: 1, own: 1 });
		expect(tallyClaims(undefined)).toEqual({ total: 0, inherited: 0, own: 0 });
	});

	it("no poder leerlo NO es cero: es null", () => {
		// La diferencia importa: confundirlas bloquearia publicaciones legitimas.
		expect(claimTally(null)).toBeNull();
		expect(claimTally(undefined)).toBeNull();
		expect(claimTally("")).toBeNull();
		expect(claimTally("<html>404</html>")).toBeNull();
	});
});

describe("claimsGuardDecision", () => {
	it("bloquea cuando el bundle PIERDE pruebas propias respecto del sitio", () => {
		// El caso real: el sitio sirve 6 propias, el bundle generado declara 0.
		const decision = claimsGuardDecision(tally(0), tally(6));
		expect(decision.blocked).toBe(true);
		expect(decision.reason).toContain("6 pruebas propias");
		expect(decision.reason).toContain("el bundle declara 0");
	});

	it("deja pasar empates y mejoras", () => {
		expect(claimsGuardDecision(tally(6), tally(6)).blocked).toBe(false);
		expect(claimsGuardDecision(tally(7), tally(6)).blocked).toBe(false);
	});

	it("sin perfil vivo no bloquea: avisa", () => {
		const decision = claimsGuardDecision(tally(0), null);
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("No pudimos leer el perfil del sitio");
	});

	it("sin bundle generado no bloquea: avisa", () => {
		const decision = claimsGuardDecision(null, tally(6));
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("No hay un brand.json generado");
	});

	it("no traduce texto a claims: solo compara", () => {
		// Publicar un perfil sin claims cuando el sitio tampoco tiene ninguno es legitimo.
		expect(claimsGuardDecision(tally(0), tally(0))).toEqual({ blocked: false });
	});
});

describe("dejar de heredar no es una regresión (sacar el padre de un producto)", () => {
	it("el sitio declara 6 (5 propias + 1 prestada) y el bundle 5 propias: NO bloquea, y lo dice", () => {
		// El cambio honesto: al producto se le saca el padre Believe, así que su bundle deja de usar la
		// prueba prestada. Antes esto bloqueaba: el candado no distinguía "perdí una mía" de "dejé de usar
		// una que me prestaron".
		const decision = claimsGuardDecision(tally(5), tally(6, 1));
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("declaraba 1 prestada del paraguas y el bundle ya no las usa: se publica");
	});

	it("el sitio declara 6 y el bundle 4 propias: SIGUE bloqueando", () => {
		// Lo que el candado protege no se afloja: una propia perdida bloquea, heredada o no de por medio.
		const decision = claimsGuardDecision(tally(4), tally(6, 1));
		expect(decision.blocked).toBe(true);
		expect(decision.reason).toContain("5 pruebas propias");
		expect(decision.reason).toContain("el bundle declara 4");
		// Y el motivo nombra las prestadas para que quede claro que NO son la causa del bloqueo.
		expect(decision.reason).toContain("1 prestada del paraguas");
	});

	it("bloquea aunque el total no baje: una prestada nueva no tapa una propia perdida", () => {
		// El sitio: 5 propias + 1 prestada = 6. El bundle: 4 propias + 2 prestadas = 6. El total queda igual,
		// y aun así se perdió una prueba propia. La regla vieja (comparar totales) dejaba pasar esto.
		const decision = claimsGuardDecision(tally(6, 2), tally(6, 1));
		expect(decision.blocked).toBe(true);
		expect(decision.reason).toContain("el bundle declara 4");
	});

	it("si el bundle además mejora sus propias, avisa igual que dejó de heredar", () => {
		// No es una regresión, pero tampoco un silencio: el operador ve que la prestada salió del perfil.
		const decision = claimsGuardDecision(tally(7), tally(6, 1));
		expect(decision.blocked).toBe(false);
		expect(decision.warning).toContain("declaraba 1 prestada del paraguas");
	});

	it("si el bundle sigue usando las prestadas, no hay nada que avisar", () => {
		expect(claimsGuardDecision(tally(6, 1), tally(6, 1))).toEqual({ blocked: false });
	});
});

describe("las fuentes de la web para el candado (el agujero que se cerró)", () => {
	it("si la entidad tiene web, es ESA y ninguna otra", () => {
		// BeScore: un producto nuevo con su propia web. Su sitio todavia no publica claims, y eso NO
		// puede hacer que el candado lo compare contra la web corporativa de Believe.
		expect(
			websiteSourcesForClaims({
				entityWebsite: "https://bescore.believe-global.com",
				dnaWebsite: "https://dna.com",
				brandWebsite: "https://believe-global.com/",
			}),
		).toEqual(["https://bescore.believe-global.com"]);
	});
	it("solo cuando la entidad NO tiene web se cae al DNA y a la marca", () => {
		expect(
			websiteSourcesForClaims({
				entityWebsite: null,
				dnaWebsite: "https://dna.com",
				brandWebsite: "https://marca.com",
			}),
		).toEqual(["https://dna.com", "https://marca.com"]);
		expect(
			websiteSourcesForClaims({ entityWebsite: "   ", dnaWebsite: undefined, brandWebsite: "https://marca.com" }),
		).toEqual(["https://marca.com"]);
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
