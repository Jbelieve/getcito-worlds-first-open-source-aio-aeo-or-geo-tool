import { describe, expect, it, vi } from "vitest";
import {
	describeTools,
	dispatch,
	isNotification,
	type McpTool,
	optionalInteger,
	parseMessage,
	requireBoolean,
	requireString,
	requireUuid,
	ToolInputError,
} from "../jsonrpc";

const echo: McpTool = {
	name: "echo",
	title: "Eco",
	description: "Devuelve lo que recibe.",
	inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
	handler: async (args) => ({ content: [{ type: "text", text: String(args.text) }] }),
};

const serverInfo = { name: "beaos", version: "1.0.0", instructions: "Empezá por list_brands." };
const options = { tools: [echo], serverInfo };

describe("parseMessage", () => {
	it("lee un mensaje JSON-RPC válido", () => {
		const parsed = parseMessage('{"jsonrpc":"2.0","id":1,"method":"ping"}');
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(parsed.request.method).toBe("ping");
	});

	it("un JSON roto es -32700 con id nulo", () => {
		const parsed = parseMessage("{no json");
		expect(parsed.ok).toBe(false);
		if (parsed.ok === false) {
			expect(parsed.response).toMatchObject({ id: null, error: { code: -32700 } });
		}
	});

	it("sin method es -32600", () => {
		const parsed = parseMessage('{"jsonrpc":"2.0","id":1}');
		expect(parsed.ok).toBe(false);
		if (parsed.ok === false) expect(parsed.response).toMatchObject({ error: { code: -32600 } });
	});

	it("rechaza una versión distinta de 2.0", () => {
		const parsed = parseMessage('{"jsonrpc":"1.0","id":1,"method":"ping"}');
		expect(parsed.ok).toBe(false);
		if (parsed.ok === false) expect(parsed.response).toMatchObject({ error: { code: -32600 } });
	});

	it("rechaza un id de tipo inválido", () => {
		const parsed = parseMessage('{"jsonrpc":"2.0","id":{"a":1},"method":"ping"}');
		expect(parsed.ok).toBe(false);
		if (parsed.ok === false) expect(parsed.response).toMatchObject({ error: { code: -32600 } });
	});

	it("acepta un id nulo (es una notificación)", () => {
		const parsed = parseMessage('{"jsonrpc":"2.0","id":null,"method":"notifications/initialized"}');
		expect(parsed.ok).toBe(true);
		if (parsed.ok) expect(isNotification(parsed.request)).toBe(true);
	});
});

describe("dispatch", () => {
	it("initialize devuelve la versión del protocolo y las capacidades", async () => {
		const response = await dispatch({ jsonrpc: "2.0", id: 1, method: "initialize" }, options);
		expect(response).toMatchObject({
			id: 1,
			result: {
				protocolVersion: "2025-06-18",
				capabilities: { tools: { listChanged: false } },
				serverInfo: { name: "beaos", version: "1.0.0" },
			},
		});
	});

	it("ping responde un resultado vacío", async () => {
		const response = await dispatch({ jsonrpc: "2.0", id: "a", method: "ping" }, options);
		expect(response).toMatchObject({ id: "a", result: {} });
	});

	it("tools/list describe los tools sin los handlers", async () => {
		const response = await dispatch({ jsonrpc: "2.0", id: 2, method: "tools/list" }, options);
		const result = (response as { result: { tools: Array<Record<string, unknown>> } }).result;
		expect(result.tools).toHaveLength(1);
		expect(result.tools[0]).toMatchObject({ name: "echo", title: "Eco", description: "Devuelve lo que recibe." });
		expect(result.tools[0]).not.toHaveProperty("handler");
		expect(result.tools[0]).toHaveProperty("inputSchema");
	});

	it("tools/call ejecuta el handler y devuelve su contenido", async () => {
		const response = await dispatch(
			{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { text: "hola" } } },
			options,
		);
		expect(response).toMatchObject({ result: { content: [{ type: "text", text: "hola" }] } });
	});

	it("un tool desconocido es -32602 y lista los que hay", async () => {
		const response = await dispatch({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "nope" } }, options);
		expect(response).toMatchObject({ error: { code: -32602 } });
		expect(JSON.stringify(response)).toContain("echo");
	});

	it("arguments que no es objeto es -32602", async () => {
		const response = await dispatch(
			{ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "echo", arguments: "texto" } },
			options,
		);
		expect(response).toMatchObject({ error: { code: -32602 } });
	});

	it("un método desconocido es -32601", async () => {
		const response = await dispatch({ jsonrpc: "2.0", id: 6, method: "resources/list" }, options);
		expect(response).toMatchObject({ error: { code: -32601 } });
	});

	it("un tool que revienta es contenido con isError, no un error de protocolo", async () => {
		const failing: McpTool = {
			name: "boom",
			description: "Falla.",
			inputSchema: { type: "object" },
			handler: async () => {
				throw new Error("se cayó la base");
			},
		};
		const response = await dispatch(
			{ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "boom" } },
			{ tools: [failing], serverInfo },
		);
		expect(response).not.toHaveProperty("error");
		expect(response).toMatchObject({ result: { isError: true } });
		expect(JSON.stringify(response)).toContain("se cayó la base");
	});

	it("una notificación no lleva respuesta", async () => {
		const response = await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }, options);
		expect(response).toBeNull();
		expect(isNotification({ jsonrpc: "2.0", method: "x" })).toBe(true);
	});

	it("una notificación no ejecuta tools", async () => {
		const handler = vi.fn(async () => ({ content: [{ type: "text" as const, text: "no" }] }));
		await dispatch(
			{ jsonrpc: "2.0", method: "tools/call", params: { name: "spy" } },
			{ tools: [{ name: "spy", description: "x", inputSchema: {}, handler }], serverInfo },
		);
		expect(handler).not.toHaveBeenCalled();
	});
});

describe("describeTools", () => {
	it("omite el título cuando no lo hay", () => {
		const [described] = describeTools([
			{ name: "a", description: "d", inputSchema: {}, handler: async () => ({ content: [] }) },
		]);
		expect(described).not.toHaveProperty("title");
	});
});

describe("lectura de argumentos", () => {
	it("requireString rechaza vacío y recorta", () => {
		expect(requireString({ a: "  hola  " }, "a")).toBe("hola");
		expect(() => requireString({ a: "   " }, "a")).toThrow(ToolInputError);
		expect(() => requireString({}, "a")).toThrow(/Falta "a"/);
	});

	it("requireUuid exige la forma de un UUID", () => {
		expect(requireUuid({ id: "0b6a1f2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b" }, "id")).toBe(
			"0b6a1f2e-3c4d-4e5f-8a9b-0c1d2e3f4a5b",
		);
		expect(() => requireUuid({ id: "default" }, "id")).toThrow(/UUID/);
	});

	it("requireBoolean no confunde el texto 'true' con true", () => {
		expect(requireBoolean({ p: false }, "p")).toBe(false);
		expect(() => requireBoolean({ p: "true" }, "p")).toThrow(ToolInputError);
	});

	it("optionalInteger usa el valor por defecto y respeta los límites", () => {
		expect(optionalInteger({}, "limit", { min: 1, max: 100, fallback: 20 })).toBe(20);
		expect(optionalInteger({ limit: 5 }, "limit", { min: 1, max: 100, fallback: 20 })).toBe(5);
		expect(() => optionalInteger({ limit: 500 }, "limit", { min: 1, max: 100, fallback: 20 })).toThrow(/entre 1 y 100/);
		expect(() => optionalInteger({ limit: 1.5 }, "limit", { min: 1, max: 100, fallback: 20 })).toThrow(/entero/);
	});
});
