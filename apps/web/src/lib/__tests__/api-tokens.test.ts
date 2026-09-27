/**
 * La credencial por producto, probada sin base.
 *
 * `authenticateApiToken` recibe el `lookup` inyectado, así que los cuatro casos que importan —token
 * válido, revocado, desconocido y el fallback a `ADMIN_API_KEYS`— se prueban con una tabla de mentira.
 */
import { describe, expect, it, vi } from "vitest";
import {
	type AgentApiTokenRecord,
	type ApiTokenLookup,
	authenticateApiToken,
	generateApiToken,
	hashApiToken,
	prefixOfToken,
	tokenFromRequest,
} from "../api-tokens";

const VALID_TOKEN = "beaos_test_token";
const ADMIN_KEY = "admin-key-de-siempre";

function record(overrides: Partial<AgentApiTokenRecord> = {}): AgentApiTokenRecord {
	return { id: "t1", name: "autex", prefix: "beaos_te", revokedAt: null, ...overrides };
}

/** Un lookup que responde sólo por el hash del token dado. */
function lookupFor(token: string, row: AgentApiTokenRecord): ApiTokenLookup {
	return async (hash) => (hash === hashApiToken(token) ? row : undefined);
}

const admin = { adminKeys: [ADMIN_KEY] };

describe("hashApiToken", () => {
	it("es sha256 en hex y no guarda el token en claro", () => {
		expect(hashApiToken("beaos_test_token")).toBe("cfda004146265aeeba4021e29492ebbad7a3088b830b38e52841786550aafa64");
		expect(hashApiToken("otro")).not.toBe(hashApiToken("beaos_test_token"));
		expect(hashApiToken("x")).toHaveLength(64);
	});

	it("el prefijo son los primeros 8 caracteres", () => {
		expect(prefixOfToken("beaos_abcdefgh")).toBe("beaos_ab");
	});

	it("generateApiToken no repite y no expone el hash", () => {
		const a = generateApiToken();
		const b = generateApiToken();
		expect(a).not.toBe(b);
		expect(a.startsWith("beaos_")).toBe(true);
		expect(a).not.toContain(hashApiToken(a));
	});
});

describe("authenticateApiToken", () => {
	it("acepta un token válido de la tabla y dice de qué producto es", async () => {
		const result = await authenticateApiToken(VALID_TOKEN, {
			lookup: lookupFor(VALID_TOKEN, record()),
			...admin,
		});
		expect(result).toEqual({ ok: true, source: "token", tokenId: "t1", name: "autex", prefix: "beaos_te" });
	});

	it("rechaza un token revocado y NO cae al fallback", async () => {
		// El mismo texto es también una ADMIN_API_KEY: aun así, revocado gana.
		const result = await authenticateApiToken(ADMIN_KEY, {
			lookup: lookupFor(ADMIN_KEY, record({ id: "t2", revokedAt: new Date("2026-01-01T00:00:00Z") })),
			adminKeys: [ADMIN_KEY],
		});
		expect(result.ok).toBe(false);
		if (result.ok === false) {
			expect(result.reason).toBe("revoked");
			expect(result.message).toContain("autex");
		}
	});

	it("rechaza un token desconocido cuando tampoco está en ADMIN_API_KEYS", async () => {
		const result = await authenticateApiToken("token-inventado", { lookup: async () => undefined, ...admin });
		expect(result.ok).toBe(false);
		if (result.ok === false) expect(result.reason).toBe("unknown");
	});

	it("cae a ADMIN_API_KEYS cuando el token no está en la tabla", async () => {
		const result = await authenticateApiToken(ADMIN_KEY, { lookup: async () => undefined, ...admin });
		expect(result).toEqual({ ok: true, source: "admin" });
	});

	it("sin token es un error explícito y no consulta la tabla", async () => {
		const lookup = vi.fn(async () => undefined);
		const missing = await authenticateApiToken(undefined, { lookup, ...admin });
		expect(missing.ok).toBe(false);
		if (missing.ok === false) expect(missing.reason).toBe("missing");
		const blank = await authenticateApiToken("   ", { lookup, ...admin });
		expect(blank.ok).toBe(false);
		expect(lookup).not.toHaveBeenCalled();
	});

	it("sin ADMIN_API_KEYS configuradas, un token desconocido no entra", async () => {
		const result = await authenticateApiToken("cualquiera", { lookup: async () => undefined, adminKeys: [] });
		expect(result.ok).toBe(false);
	});
});

describe("tokenFromRequest", () => {
	it("lee el Authorization: Bearer", () => {
		const request = new Request("https://beaos.test/mcp", { headers: { authorization: "Bearer abc123" } });
		expect(tokenFromRequest(request)).toBe("abc123");
	});

	it("lee x-api-key, que es como lo mandan muchos clientes MCP", () => {
		const request = new Request("https://beaos.test/mcp", { headers: { "x-api-key": "def456" } });
		expect(tokenFromRequest(request)).toBe("def456");
	});

	it("sin headers devuelve null", () => {
		expect(tokenFromRequest(new Request("https://beaos.test/mcp"))).toBeNull();
	});

	it("un Bearer vacío no se confunde con un token", () => {
		const request = new Request("https://beaos.test/mcp", { headers: { authorization: "Bearer   " } });
		expect(tokenFromRequest(request)).toBeNull();
	});
});
