/**
 * Los tests del mapeo: de las filas confirmadas al `claims[]` / `proofs[]` que el generador firma.
 *
 * Acá vive la regla que más caro sale si se rompe: **el borrador no entra al bundle**. Un borrador que se
 * publica es trabajo en curso presentado como declaración firmada.
 */
import { describe, expect, it } from "vitest";
import { generateAgentAssets } from "../assets/generate";
import type { AgentBrandClaim } from "../db/schema";
import { parseBrandProfile } from "../preference";
import {
	claimIdFromCandidateId,
	claimsFromRows,
	dnaCarriesClaims,
	inheritedPrefix,
	inheritedRowsFor,
	proofIdForClaim,
	resolveBundleClaims,
} from "./mapping";

function row(overrides: Partial<AgentBrandClaim> = {}): AgentBrandClaim {
	return {
		id: "00000000-0000-4000-8000-000000000001",
		brandId: "believe",
		entityId: "00000000-0000-4000-8000-0000000000aa",
		claimId: "CLM-BE-35-CONVERSION",
		statement: "Aumento promedio de 35% en tasa de conversión tras instalar el sistema MAAS™.",
		metric: "35%",
		category: "outcome",
		boundaryApplicableFor: "Clientes con el sistema instalado y medición previa.",
		boundaryNotApplicableFor: "Cuentas sin línea base medida.",
		confidence: "alta",
		proofType: "case_study",
		proofTitle: "Caso Believe · conversión",
		proofSummary: "Reporte de resultados del programa de instalación.",
		proofClient: "Believe",
		verifiableBy: "signed_client",
		confidentiality: "anonymized",
		sourceFragment: "Aumento promedio de 35% en tasa de conversión…",
		status: "confirmed",
		inheritable: false,
		inheritedFromEntityId: null,
		createdAt: new Date("2026-09-25T00:00:00.000Z"),
		updatedAt: new Date("2026-09-25T00:00:00.000Z"),
		...overrides,
	};
}

describe("claimsFromRows", () => {
	it("mapea la fila a los nombres de campo exactos del estándar", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		expect(claims).toHaveLength(1);
		expect(proofs).toHaveLength(1);

		const claim = claims[0];
		expect(claim?.claim_id).toBe("CLM-BE-35-CONVERSION");
		expect(claim?.statement).toBe("Aumento promedio de 35% en tasa de conversión tras instalar el sistema MAAS™.");
		expect(claim?.category).toBe("outcome");
		expect(claim?.metric).toEqual({ value: "35%" });
		expect(claim?.boundary).toEqual({
			applicable_for: "Clientes con el sistema instalado y medición previa.",
			not_applicable_for: "Cuentas sin línea base medida.",
		});
		expect(claim?.linked_proofs).toEqual(["PRF-CLM-BE-35-CONVERSION"]);

		const proof = proofs[0];
		expect(proof?.proof_id).toBe("PRF-CLM-BE-35-CONVERSION");
		expect(proof?.type).toBe("case_study");
		expect(proof?.title).toBe("Caso Believe · conversión");
		expect(proof?.claim_refs).toEqual(["CLM-BE-35-CONVERSION"]);
		expect(proof?.evidence).toEqual({
			summary: "Reporte de resultados del programa de instalación.",
			client: "Believe",
			source_fragment: "Aumento promedio de 35% en tasa de conversión…",
		});
		expect(proof?.verification).toEqual({ verifiable_by: "signed_client" });
		expect(proof?.confidentiality).toBe("anonymized");
	});

	it("los dos lados del vínculo se apuntan mutuamente", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		const claimId = claims[0]?.claim_id;
		const proofId = proofs[0]?.proof_id;
		expect(claims[0]?.linked_proofs).toContain(proofId);
		expect(proofs[0]?.claim_refs).toContain(claimId);
	});

	it("el claim viaja con su prueba adentro, además del proofs[] de arriba", () => {
		const { claims, proofs } = claimsFromRows([row()]);
		const nested = (claims[0] as { proofs?: unknown[] } | undefined)?.proofs ?? [];
		expect(nested).toHaveLength(1);
		expect(nested[0]).toEqual(proofs[0]);
	});

	it("no emite la confianza: el estándar la deriva del tamaño de muestra", () => {
		// La fila tiene `confidence: "alta"`, pero `metric` no declara `n`, así que la confianza derivada
		// es null y una asignada a mano sería un dato inventado (APS-CLAIM-04).
		const { claims } = claimsFromRows([row({ confidence: "0.9" })]);
		expect(claims[0]?.confidence).toBeUndefined();
	});

	it("sin métrica no inventa un valor, y sin borde no inventa un borde", () => {
		const { claims } = claimsFromRows([
			row({ metric: null, boundaryApplicableFor: null, boundaryNotApplicableFor: null }),
		]);
		expect(claims[0]?.metric).toBeUndefined();
		expect(claims[0]?.boundary).toBeUndefined();
	});

	it("un borrador no entra, y mezclado con confirmadas solo entran las confirmadas", () => {
		const drafts = claimsFromRows([row({ status: "draft" })]);
		expect(drafts.claims).toHaveLength(0);
		expect(drafts.proofs).toHaveLength(0);

		const mixed = claimsFromRows([
			row({ claimId: "CLM-A", status: "confirmed" }),
			row({ claimId: "CLM-B", status: "draft" }),
			row({ claimId: "CLM-C", status: "confirmed" }),
		]);
		expect(mixed.claims.map((claim) => claim.claim_id)).toEqual(["CLM-A", "CLM-C"]);
		expect(mixed.proofs).toHaveLength(2);
	});

	it("una fila sin id o sin afirmación no se emite a medias", () => {
		expect(claimsFromRows([row({ claimId: "   " })]).claims).toHaveLength(0);
		expect(claimsFromRows([row({ statement: "" })]).claims).toHaveLength(0);
	});

	it("deriva ids con la forma que el estándar exige", () => {
		expect(proofIdForClaim("be-35-conversion")).toBe("PRF-BE-35-CONVERSION");
		expect(proofIdForClaim("CLM-BE-35")).toBe("PRF-CLM-BE-35");
		// Un id sin letras usables cae a un hash estable, no a un proof_id vacío.
		const hashed = proofIdForClaim("···");
		expect(hashed.startsWith("PRF-CLAIM-")).toBe(true);
		expect(proofIdForClaim("···")).toBe(hashed);

		expect(claimIdFromCandidateId("client_results-0")).toBe("CLM-CLIENT-RESULTS-0");
	});
});

describe("resolveBundleClaims", () => {
	it("si el DNA ya trae claims, se usan esos y no se sustituyen", () => {
		const dnaClaims = [{ claim_id: "CLM-DEL-DNA", statement: "La marca lo declara." }];
		const resolved = resolveBundleClaims({ dna: { claims: dnaClaims, proofs: [] }, saved: [row()] });
		expect(resolved.claims).toEqual(dnaClaims);
		expect(dnaCarriesClaims({ claims: dnaClaims })).toBe(true);
	});

	it("un dna.claims vacío no cuenta como claims propios: se usan las confirmadas", () => {
		const resolved = resolveBundleClaims({ dna: { claims: [], proofs: [] }, saved: [row()] });
		expect(resolved.claims).toHaveLength(1);
		expect(dnaCarriesClaims({ claims: [] })).toBe(false);
	});

	it("sin claims en el DNA se usan solo las confirmadas de BeAOS", () => {
		const resolved = resolveBundleClaims({
			dna: { client_results: "35%" },
			saved: [row(), row({ claimId: "CLM-X", status: "draft" })],
		});
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-BE-35-CONVERSION"]);
	});
});

/**
 * La herencia. Es la parte que más caro sale si se rompe en silencio: una sub-entidad firmando como
 * propio un caso de cliente que hizo la marca es una mentira verificable.
 */
describe("herencia del paraguas", () => {
	const UMBRELLA_ENTITY = "00000000-0000-4000-8000-0000000000bb";

	/** Una prueba de marca heredable: metodología, antigüedad o volumen, nunca un caso de cliente. */
	function brandRow(overrides: Partial<AgentBrandClaim> = {}): AgentBrandClaim {
		return row({
			entityId: UMBRELLA_ENTITY,
			claimId: "CLM-MARCA-100-PROYECTOS",
			statement: "Más de 100 proyectos entregados desde 2019.",
			metric: "100",
			proofType: "aggregate_metric",
			proofTitle: "Volumen histórico de la marca",
			proofSummary: "Más de 100 proyectos entregados.",
			proofClient: null,
			sourceFragment: "Más de 100 proyectos entregados desde 2019.",
			inheritable: true,
			...overrides,
		});
	}

	const umbrellaOf = (claims: AgentBrandClaim[], entityName = "Believe") => ({ claims, entityName });

	interface EmittedProof {
		proof_id?: string;
		claim_refs?: string[];
		evidence?: Record<string, unknown>;
	}
	interface EmittedClaim {
		claim_id?: string;
		statement?: string;
		linked_proofs?: string[];
		proofs?: EmittedProof[];
	}

	/** El `brand.json` real, generado por el mismo camino que firma el bundle. */
	function brandJson(input: {
		saved?: AgentBrandClaim[];
		umbrella?: { claims: AgentBrandClaim[]; entityName: string };
	}): { claims: EmittedClaim[]; proofs: EmittedProof[] } {
		const dna = { business_description: "Believe instala sistemas de preferencia." };
		const resolved = resolveBundleClaims({ dna, ...input });
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna: { ...dna, ...resolved },
		});
		const brand = assets.find((asset) => asset.path === "/.well-known/brand.json");
		return JSON.parse(brand?.content ?? "{}") as { claims: EmittedClaim[]; proofs: EmittedProof[] };
	}

	it("hereda solo lo marcado heredable", () => {
		const resolved = resolveBundleClaims({
			saved: [row({ claimId: "CLM-PROPIA" })],
			umbrella: umbrellaOf([
				brandRow(),
				// Un caso de cliente de la marca: si no está marcado, no se hereda. Es la línea roja.
				row({
					entityId: UMBRELLA_ENTITY,
					claimId: "CLM-CASO-CLIENTE",
					proofType: "case_study",
					inheritable: false,
				}),
			]),
		});
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-PROPIA", "CLM-MARCA-100-PROYECTOS"]);
	});

	it("no hereda nada cuando el paraguas no tiene nada marcado", () => {
		const resolved = resolveBundleClaims({
			saved: [row({ claimId: "CLM-PROPIA" })],
			umbrella: umbrellaOf([brandRow({ inheritable: false })]),
		});
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-PROPIA"]);
		expect(inheritedRowsFor({ saved: [], umbrella: umbrellaOf([brandRow({ inheritable: false })]) })).toEqual([]);
	});

	it("el propio gana sobre el heredado con el mismo id, y no se duplica el id", () => {
		const resolved = resolveBundleClaims({
			saved: [row({ claimId: "CLM-COMPARTIDA", statement: "La afirmación propia de esta entidad." })],
			umbrella: umbrellaOf([brandRow({ claimId: "CLM-COMPARTIDA" })]),
		});
		expect(resolved.claims).toHaveLength(1);
		expect(resolved.claims[0]?.statement).toBe("La afirmación propia de esta entidad.");
		expect(resolved.proofs.map((proof) => proof.proof_id)).toEqual(["PRF-CLM-COMPARTIDA"]);
		// Y la que sobrevive no lleva marca de heredada: es propia.
		expect(resolved.proofs[0]?.evidence?.summary).toBe("Reporte de resultados del programa de instalación.");
	});

	it("un borrador propio con el mismo id no le roba el lugar a la heredada confirmada", () => {
		// El desempate del punto 3 es contra las propias que entran al bundle. Un borrador no emite nada,
		// así que dejarlo ganar perdería en silencio una prueba que la marca sí confirmó.
		const resolved = resolveBundleClaims({
			saved: [row({ claimId: "CLM-MARCA-100-PROYECTOS", status: "draft" })],
			umbrella: umbrellaOf([brandRow()]),
		});
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-MARCA-100-PROYECTOS"]);
		expect(resolved.proofs[0]?.evidence?.summary).toBe(
			"[Heredada del paraguas Believe] Más de 100 proyectos entregados.",
		);
	});

	it("los borradores no entran, ni propios ni heredados", () => {
		const resolved = resolveBundleClaims({
			saved: [row({ claimId: "CLM-BORRADOR-PROPIO", status: "draft" })],
			umbrella: umbrellaOf([brandRow({ claimId: "CLM-BORRADOR-HEREDADO", status: "draft" })]),
		});
		expect(resolved.claims).toHaveLength(0);
		expect(resolved.proofs).toHaveLength(0);
	});

	it("el prefijo de heredada aparece en el summary y en el source_fragment emitidos", () => {
		const { claims, proofs } = brandJson({ saved: [], umbrella: umbrellaOf([brandRow()]) });
		expect(claims).toHaveLength(1);

		const proof = proofs[0];
		expect(proof?.evidence?.summary).toBe("[Heredada del paraguas Believe] Más de 100 proyectos entregados.");
		expect(proof?.evidence?.source_fragment).toBe(
			"[Heredada del paraguas Believe] Más de 100 proyectos entregados desde 2019.",
		);
		// El vínculo sigue siendo de los dos lados, con el prefijo o sin él.
		expect(proof?.claim_refs).toEqual(["CLM-MARCA-100-PROYECTOS"]);
		expect(claims[0]?.linked_proofs).toEqual(["PRF-CLM-MARCA-100-PROYECTOS"]);

		// El prefijo también viaja dentro de la prueba anidada del claim: es el mismo objeto.
		expect(claims[0]?.proofs?.[0]?.evidence?.summary).toBe(
			"[Heredada del paraguas Believe] Más de 100 proyectos entregados.",
		);
	});

	it("sin resumen el prefijo va igual, y sin fragmento no inventa uno", () => {
		const { proofs } = brandJson({
			saved: [],
			umbrella: umbrellaOf([brandRow({ proofSummary: null, sourceFragment: null })]),
		});
		expect(proofs[0]?.evidence?.summary).toBe("[Heredada del paraguas Believe]");
		expect(proofs[0]?.evidence).not.toHaveProperty("source_fragment");
	});

	it("sin nombre de paraguas el prefijo igual declara la herencia", () => {
		expect(inheritedPrefix("  ")).toBe("[Heredada del paraguas]");
		expect(inheritedPrefix(undefined)).toBe("[Heredada del paraguas]");
		expect(inheritedPrefix("Autex")).toBe("[Heredada del paraguas Autex]");
	});

	it("el DNA de Maasy tiene prioridad absoluta, también sobre lo heredado", () => {
		const dnaClaims = [{ claim_id: "CLM-DEL-DNA", statement: "La marca lo declara." }];
		const resolved = resolveBundleClaims({
			dna: { claims: dnaClaims, proofs: [] },
			saved: [row({ claimId: "CLM-PROPIA" })],
			umbrella: umbrellaOf([brandRow()]),
		});
		expect(resolved.claims).toEqual(dnaClaims);
		expect(resolved.claims.some((claim) => claim.claim_id === "CLM-MARCA-100-PROYECTOS")).toBe(false);
		expect(resolved.proofs).toEqual([]);
	});

	it("una copia heredada con `inheritedFromEntityId` viaja marcada, no como propia", () => {
		const copy = row({
			claimId: "CLM-MARCA-100-PROYECTOS",
			inheritable: true,
			inheritedFromEntityId: UMBRELLA_ENTITY,
		});
		const resolved = resolveBundleClaims({ saved: [copy], umbrella: umbrellaOf([]) });
		expect(resolved.claims.map((claim) => claim.claim_id)).toEqual(["CLM-MARCA-100-PROYECTOS"]);
		expect(resolved.proofs[0]?.evidence?.summary).toBe(
			"[Heredada del paraguas Believe] Reporte de resultados del programa de instalación.",
		);
	});

	it("el perfil con heredadas no suma errores del validador del estándar", () => {
		const errorsOf = (input: {
			saved?: AgentBrandClaim[];
			umbrella?: { claims: AgentBrandClaim[]; entityName: string };
		}) => parseBrandProfile(brandJson(input)).findings.filter((finding) => finding.level === "error");

		const ownOnly = errorsOf({ saved: [row({ claimId: "CLM-PROPIA" })] });
		const withInherited = errorsOf({ saved: [row({ claimId: "CLM-PROPIA" })], umbrella: umbrellaOf([brandRow()]) });
		// El prefijo de heredada va al `evidence.summary`, que el validador no evalúa: no agrega findings.
		expect(withInherited.length).toBeLessThanOrEqual(ownOnly.length);
		// Y el perfil heredado en sí no suma errores propios.
		expect(errorsOf({ saved: [], umbrella: umbrellaOf([brandRow()]) })).toEqual([]);
	});
});

describe("el bundle declara lo que hay, ni más ni menos", () => {
	function brandJsonClaims(rows: AgentBrandClaim[]): number {
		const dna = { business_description: "Believe instala sistemas de preferencia." };
		const resolved = resolveBundleClaims({ dna, saved: rows });
		const assets = generateAgentAssets({
			name: "Believe",
			websiteUrl: "https://believe-global.com",
			dna: { ...dna, ...resolved },
		});
		const brand = assets.find((asset) => asset.path === "/.well-known/brand.json");
		const parsed = JSON.parse(brand?.content ?? "{}") as { claims?: unknown[]; proofs?: unknown[] };
		return parsed.claims?.length ?? 0;
	}

	it("declara N claims cuando hay N confirmadas", () => {
		expect(brandJsonClaims([row({ claimId: "CLM-A" }), row({ claimId: "CLM-B" })])).toBe(2);
	});

	it("declara 0 cuando todas son borradores", () => {
		expect(brandJsonClaims([row({ claimId: "CLM-A", status: "draft" })])).toBe(0);
	});

	it("con el DNA real de Maasy (sin claims) y una confirmada, el bundle deja de estar vacío", () => {
		expect(brandJsonClaims([row()])).toBe(1);
	});
});
