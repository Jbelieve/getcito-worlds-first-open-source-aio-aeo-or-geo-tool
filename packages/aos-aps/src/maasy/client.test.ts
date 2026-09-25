import { describe, expect, it } from "vitest";
import { maasyAuthHeaders } from "./client";

describe("la credencial de Maasy", () => {
	it("prefiere la API key, que no expira", () => {
		const headers = maasyAuthHeaders({ MAASY_MCP_API_KEY: "permanente", MAASY_MCP_TOKEN: "oauth_viejo" });
		expect(headers).toEqual({ "x-api-key": "permanente" });
		expect(headers).not.toHaveProperty("authorization");
	});

	it("cae al token OAuth si no hay API key, para no romper una instalación vieja", () => {
		expect(maasyAuthHeaders({ MAASY_MCP_TOKEN: "oauth_viejo" })).toEqual({
			authorization: "Bearer oauth_viejo",
		});
	});

	it("ignora lo vacío y lo que son solo espacios", () => {
		expect(maasyAuthHeaders({ MAASY_MCP_API_KEY: "   ", MAASY_MCP_TOKEN: "oauth" })).toEqual({
			authorization: "Bearer oauth",
		});
		expect(() => maasyAuthHeaders({ MAASY_MCP_API_KEY: "  " })).toThrow(/Falta la credencial/);
	});

	it("si no hay ninguna, lo dice claro y nombra la que no expira", () => {
		expect(() => maasyAuthHeaders({})).toThrow(/MAASY_MCP_API_KEY/);
	});
});
