/**
 * El registro de tools, como contrato.
 *
 * No prueba los handlers —eso necesita base— sino lo que un cliente MCP lee antes de llamar: que los
 * nombres no se repitan, que todos declaren un `inputSchema` de objeto, que cada campo obligatorio esté
 * descrito y que las acciones peligrosas pidan explícitamente lo que necesitan.
 */
import { describe, expect, it } from "vitest";
import { describeTools } from "../jsonrpc";
import { BEAOS_MCP_SERVER, BEAOS_MCP_TOOLS } from "../tools";

describe("registro de tools del MCP de BeAOS", () => {
	it("los nombres son únicos", () => {
		const names = BEAOS_MCP_TOOLS.map((tool) => tool.name);
		expect(new Set(names).size).toBe(names.length);
	});

	it("cada tool declara descripción y un inputSchema de objeto", () => {
		for (const tool of BEAOS_MCP_TOOLS) {
			expect(tool.description.length, `${tool.name} sin descripción`).toBeGreaterThan(20);
			expect(tool.inputSchema.type, `${tool.name} sin type`).toBe("object");
			expect(tool.inputSchema.properties, `${tool.name} sin properties`).toBeTypeOf("object");
		}
	});

	it("cada tool declara título, que es lo que lee un cliente MCP", () => {
		for (const tool of BEAOS_MCP_TOOLS) {
			expect(tool.title, `${tool.name} sin título`).toBeTypeOf("string");
			expect(tool.title?.length ?? 0).toBeGreaterThan(3);
		}
	});

	it("cada campo obligatorio está declarado en properties", () => {
		for (const tool of BEAOS_MCP_TOOLS) {
			const properties = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
			const required = (tool.inputSchema.required ?? []) as string[];
			for (const field of required) {
				expect(properties, `${tool.name}: "${field}" es obligatorio pero no está descrito`).toHaveProperty(field);
			}
		}
	});

	it("las herramientas de acción piden marca, entidad y el flag explícito", () => {
		const requiredOf = (name: string) => BEAOS_MCP_TOOLS.find((tool) => tool.name === name)?.inputSchema.required;
		expect(requiredOf("generate_agent_assets")).toEqual(["brandId", "entityId"]);
		expect(requiredOf("publish_agent_assets")).toEqual(["brandId", "entityId", "published"]);
	});

	it("las acciones de alta piden lo mínimo para ser idempotentes y no inventar datos", () => {
		const requiredOf = (name: string) => BEAOS_MCP_TOOLS.find((tool) => tool.name === name)?.inputSchema.required;
		expect(requiredOf("ensure_brand")).toEqual(["name", "website"]);
		expect(requiredOf("ensure_entity")).toEqual(["brandId", "name", "entityType"]);
		expect(requiredOf("start_aps_run")).toEqual(["brandId", "entityId"]);
		expect(requiredOf("sync_brand_dna")).toEqual(["brandId", "entityId"]);
	});

	it("están las lecturas que necesita un producto consumidor", () => {
		const names = BEAOS_MCP_TOOLS.map((tool) => tool.name);
		for (const expected of [
			"list_brands",
			"get_brand",
			"get_aos_audit",
			"list_aps_runs",
			"get_aps_score_detail",
			"get_agent_bundle",
			"get_agent_asset",
		]) {
			expect(names).toContain(expected);
		}
	});

	it("están las lecturas heredadas de Getcito, y todas exigen una marca", () => {
		const requiredOf = (name: string) => BEAOS_MCP_TOOLS.find((tool) => tool.name === name)?.inputSchema.required;
		const heredadas = [
			"list_prompts",
			"list_competitors",
			"get_visibility",
			"get_share_of_voice",
			"list_citations",
			"get_query_fanout",
			"get_opportunities",
			"list_reports",
		];
		for (const name of heredadas) {
			expect(requiredOf(name), `${name} no existe`).toContain("brandId");
		}
	});

	it("el registro completo es el esperado: nada se cae por accidente", () => {
		expect(BEAOS_MCP_TOOLS.map((tool) => tool.name).sort()).toEqual(
			[
				"ensure_brand",
				"ensure_entity",
				"generate_agent_assets",
				"get_agent_asset",
				"get_agent_bundle",
				"get_aos_audit",
				"get_aps_score_detail",
				"get_brand",
				"get_opportunities",
				"get_query_fanout",
				"get_share_of_voice",
				"get_visibility",
				"list_aps_runs",
				"list_brands",
				"list_citations",
				"list_competitors",
				"list_prompts",
				"list_reports",
				"publish_agent_assets",
				"start_aps_run",
				"sync_brand_dna",
			].sort(),
		);
	});

	it("el servidor se identifica y explica por dónde empezar", () => {
		expect(BEAOS_MCP_SERVER.name).toBe("beaos");
		expect(BEAOS_MCP_SERVER.instructions).toContain("list_brands");
	});

	it("lo que se publica por el protocolo no expone los handlers", () => {
		for (const described of describeTools(BEAOS_MCP_TOOLS)) {
			expect(described).not.toHaveProperty("handler");
		}
	});
});
