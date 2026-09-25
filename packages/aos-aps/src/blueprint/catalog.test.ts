/**
 * Integridad del plan de implementación.
 *
 * El test que más importa es el segundo: comprueba cada `assetPath` contra lo que el generador **realmente
 * emite**, generando un bundle completo. El día que una ruta cambie, este test avisa en vez de dejar la
 * pantalla diciendo que un archivo está listo cuando ya no existe.
 */
import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateAgentAssets } from "../assets/generate";
import type { SigningKey } from "../provenance";
import { BLUEPRINT, type BlueprintItem, buildBlueprint } from "./catalog";

const KINDS = ["archivo", "servidor", "externo", "declinado"] as const;
const OWNERS = ["beaos", "dev", "dueno", "nadie"] as const;

/** Un bundle completo: todas las entradas que el generador sabe usar, para que emita todo lo que puede. */
function fullBundle(): ReturnType<typeof generateAgentAssets> {
	const { privateKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	const signing: SigningKey = { keyId: "blueprint-test", material: pkcs8.toString("base64") };
	return generateAgentAssets({
		name: "Example Co",
		websiteUrl: "https://example.com",
		industry: "software",
		brief: "Example Co vende software.",
		signing,
		mcpUrl: "https://example.com/mcp",
		mcpTools: [{ name: "ask", title: "Ask", description: "Pregunta de solo lectura." }],
		apiUrl: "https://example.com/api/v1",
		openApiUrl: "https://example.com/openapi.json",
		apiDocsUrl: "https://example.com/developers",
		apiStatusUrl: "https://example.com/api/v1/status",
		securityContact: "mailto:security@example.com",
		ardEntries: [
			{
				name: "brand-profile",
				namespace: "registry",
				type: "application/json",
				url: "https://example.com/.well-known/brand.json",
				representativeQueries: ["que hace example", "cual es el diferencial de example"],
			},
			{
				name: "server-card",
				namespace: "mcp",
				type: "application/mcp-server-card+json",
				url: "https://example.com/.well-known/mcp/server-card.json",
				representativeQueries: ["que tools tiene el mcp", "como llamo al mcp"],
			},
		],
	});
}

/** Todo el texto que ve una persona, junto: para comprobar que no quede vacío ni con un placeholder. */
function visibleText(item: BlueprintItem): string[] {
	return [item.id, item.title, item.why, ...item.steps, ...(item.spec ?? []), item.verify, item.snippet ?? ""].filter(
		(value) => value.length > 0,
	);
}

describe("BLUEPRINT", () => {
	it("los ids son únicos", () => {
		const ids = BLUEPRINT.map((item) => item.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it("todo ítem tiene título, motivo, pasos, verificación y tipo/dueño válidos", () => {
		for (const item of BLUEPRINT) {
			expect(item.id, item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
			expect(item.title.trim().length, item.id).toBeGreaterThan(0);
			expect(item.why.trim().length, item.id).toBeGreaterThan(0);
			expect(item.steps.length, item.id).toBeGreaterThan(0);
			for (const step of item.steps) expect(step.trim().length, item.id).toBeGreaterThan(0);
			expect(item.verify.trim().length, item.id).toBeGreaterThan(0);
			expect(KINDS, item.id).toContain(item.kind);
			expect(OWNERS, item.id).toContain(item.owner);
		}
	});

	it("cada tipo de trabajo tiene al menos un ítem, así la pantalla nunca muestra un grupo vacío", () => {
		for (const kind of KINDS) {
			expect(BLUEPRINT.filter((item) => item.kind === kind).length, kind).toBeGreaterThan(0);
		}
	});

	it("todo `assetPath` es una ruta que el generador realmente emite", () => {
		const emitted = new Set(fullBundle().map((asset) => asset.path));
		// Un sanity check del propio test: si el bundle dejara de traer sus rutas base, el resto no probaría nada.
		expect(emitted.size).toBeGreaterThanOrEqual(15);
		for (const item of BLUEPRINT) {
			if (item.assetPath === undefined) continue;
			expect(emitted.has(item.assetPath), `${item.id} → ${item.assetPath}`).toBe(true);
		}
	});

	it("lo que BeAOS dice generar es exactamente lo que el bundle emite", () => {
		const declared = new Set(BLUEPRINT.filter((item) => item.kind === "archivo").map((item) => item.assetPath ?? ""));
		// Las rutas que la pantalla marca "listo" tienen que ser las del bundle: ninguna inventada.
		const generatedByBeaos = [...declared].filter((path) => path.length > 0);
		expect(generatedByBeaos.length).toBeGreaterThan(0);
		const emitted = new Set(fullBundle().map((asset) => asset.path));
		for (const path of generatedByBeaos) expect(emitted.has(path), path).toBe(true);
	});

	it("ningún ítem declinado trae `assetPath`, y todos explican el motivo", () => {
		for (const item of BLUEPRINT.filter((entry) => entry.kind === "declinado")) {
			expect(item.assetPath, item.id).toBeUndefined();
			expect(item.owner, item.id).toBe("nadie");
			// El motivo tiene que estar en el `why` o en el `spec`, con la cita del documento.
			const motivo = [item.why, ...(item.spec ?? [])].join(" ");
			expect(motivo.length, item.id).toBeGreaterThan(120);
		}
	});

	it("un ítem de servidor o externo no promete un archivo generado", () => {
		for (const item of BLUEPRINT.filter((entry) => entry.kind === "servidor" || entry.kind === "externo")) {
			expect(item.assetPath, item.id).toBeUndefined();
		}
	});

	it("los ids de scanner son slugs estables y sin repetir dentro del mismo ítem", () => {
		for (const item of BLUEPRINT) {
			const ids = item.standardIds ?? [];
			expect(new Set(ids).size, item.id).toBe(ids.length);
			for (const id of ids) expect(id, item.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
		}
	});

	it("ningún texto visible queda vacío ni con un placeholder", () => {
		// Sin `i`: en español "Todo" (con T mayúscula y el resto minúscula) es una palabra legítima.
		const PLACEHOLDER = /\bTODO\b|\bFIXME\b|\bXXX\b|[Ll]orem ipsum|[Pp]laceholder/;
		for (const item of BLUEPRINT) {
			for (const text of visibleText(item)) {
				expect(text.trim().length, item.id).toBeGreaterThan(0);
				expect(PLACEHOLDER.test(text), `${item.id} → ${text}`).toBe(false);
			}
		}
	});

	it("los `snippet` declaran su lenguaje", () => {
		const LANGS = ["http", "json", "ts", "text"];
		for (const item of BLUEPRINT) {
			if (item.snippet === undefined) {
				expect(item.snippetLang, item.id).toBeUndefined();
				continue;
			}
			expect(LANGS, item.id).toContain(item.snippetLang);
			expect(item.snippet.trim().length, item.id).toBeGreaterThan(0);
		}
	});
});

describe("buildBlueprint", () => {
	const emittedPaths = fullBundle().map((asset) => asset.path);
	const withAssets = buildBlueprint({ assetPaths: emittedPaths });
	const empty = buildBlueprint({ assetPaths: [] });

	it("devuelve un estado por ítem, en el orden del catálogo", () => {
		expect(withAssets.length).toBe(BLUEPRINT.length);
		expect(withAssets.map((entry) => entry.item.id)).toEqual(BLUEPRINT.map((item) => item.id));
	});

	it("con todos los assets, todo lo que BeAOS genera queda listo", () => {
		for (const entry of withAssets) {
			if (entry.item.assetPath === undefined) continue;
			expect(entry.state, entry.item.id).toBe("listo");
		}
	});

	it("con la lista vacía, todo lo que BeAOS genera queda faltando", () => {
		for (const entry of empty) {
			if (entry.item.assetPath === undefined) continue;
			expect(entry.state, entry.item.id).toBe("falta");
		}
	});

	it("lo de servidor y lo externo siempre queda por verificar, con o sin assets", () => {
		for (const entry of [...withAssets, ...empty]) {
			if (entry.item.kind !== "servidor" && entry.item.kind !== "externo") continue;
			expect(entry.state, entry.item.id).toBe("por-verificar");
		}
	});

	it("lo declinado siempre queda declinado", () => {
		for (const entry of [...withAssets, ...empty]) {
			if (entry.item.kind !== "declinado") continue;
			expect(entry.state, entry.item.id).toBe("declinado");
		}
	});

	it("un asset suelto no marca listo lo que no le corresponde", () => {
		const onlyLlms = buildBlueprint({ assetPaths: ["/llms.txt"] });
		const stateOf = (id: string) => onlyLlms.find((entry) => entry.item.id === id)?.state;
		expect(stateOf("llms-txt")).toBe("listo");
		expect(stateOf("agents-md")).toBe("falta");
		expect(stateOf("api-catalog")).toBe("falta");
		expect(stateOf("mcp-origen")).toBe("por-verificar");
	});
});
