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
		const generate = BEAOS_MCP_TOOLS.find((tool) => tool.name === "generate_agent_assets");
		const publish = BEAOS_MCP_TOOLS.find((tool) => tool.name === "publish_agent_assets");
		expect(generate?.inputSchema.required).toEqual(["brandId", "entityId"]);
		expect(publish?.inputSchema.required).toEqual(["brandId", "entityId", "published"]);
	});

	it("están las lecturas que necesita un producto consumidor", () => {
		const names = BEAOS_MCP_TOOLS.map((tool) => tool.name);
		for (const expected of [
			"list_brands",
			"get_brand",
			"get_aos_audit",
			"list_aps_runs",
			"get_agent_bundle",
			"get_agent_asset",
		]) {
			expect(names).toContain(expected);
		}
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
