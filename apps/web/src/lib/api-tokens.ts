/**
 * La credencial del MCP, por producto.
 *
 * Hasta ahora todos los consumidores compartían `ADMIN_API_KEYS`: no había identidad por producto ni
 * forma de revocar a uno solo. Acá vive la validación que acepta **dos** cosas:
 *
 * 1. Un token de `agent_api_tokens`, identificado por su **sha256** —el token en claro no se guarda ni
 *    se puede recuperar—, con nombre de producto y `lastUsedAt` que se actualiza al usarlo. Revocado es
 *    un 401 claro y **no** cae al fallback: si un producto fue revocado, no sigue entrando por la puerta
 *    de atrás.
 * 2. Los `ADMIN_API_KEYS` de siempre, para no romper a Maasy ni a lo que ya funcionaba.
 *
 * La evaluación es pura salvo por las dos dependencias inyectables (`lookup` y `adminKeys`), así que se
 * prueba sin base. La base solo aparece en `lookupAgentApiToken` y `touchAgentApiToken`.
 */

import { createHash, randomBytes } from "node:crypto";
import { agentApiTokens } from "@workspace/aos-aps/db/schema";
import { db } from "@workspace/lib/db/db";
import { eq } from "drizzle-orm";
import { evaluateApiKeyAuth, getAdminApiKeys } from "@/lib/auth/policies";

/** Los primeros 8 caracteres: alcanzan para identificar el token en un listado sin revelarlo. */
export const TOKEN_PREFIX_LENGTH = 8;

/** sha256 en hex. Es lo único que se persiste; el token en claro existe una sola vez, al crearlo. */
export function hashApiToken(token: string): string {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

export function prefixOfToken(token: string): string {
	return token.slice(0, TOKEN_PREFIX_LENGTH);
}

/** El token que se imprime una sola vez. `beaos_` para que se reconozca de un vistazo en un log. */
export function generateApiToken(): string {
	return `beaos_${randomBytes(24).toString("base64url")}`;
}

export interface AgentApiTokenRecord {
	id: string;
	name: string;
	prefix: string;
	revokedAt: Date | null;
}

export type ApiTokenLookup = (tokenHash: string) => Promise<AgentApiTokenRecord | undefined>;

export type TokenAuthResult =
	| { ok: true; source: "token"; tokenId: string; name: string; prefix: string }
	| { ok: true; source: "admin" }
	| { ok: false; reason: "missing" | "revoked" | "unknown"; message: string };

export interface ApiTokenDeps {
	lookup: ApiTokenLookup;
	adminKeys: string[];
}

/**
 * Decide si un token entra. Orden a propósito: primero la tabla (identidad por producto) y recién
 * después la lista compartida. Un token revocado corta acá y no llega al fallback.
 */
export async function authenticateApiToken(
	token: string | null | undefined,
	deps: ApiTokenDeps,
): Promise<TokenAuthResult> {
	const value = token?.trim() ?? "";
	if (value.length === 0) {
		return {
			ok: false,
			reason: "missing",
			message: "Falta el token: mandá `Authorization: Bearer <token>` o `x-api-key: <token>`.",
		};
	}

	const record = await deps.lookup(hashApiToken(value));
	if (record !== undefined) {
		if (record.revokedAt !== null) {
			return {
				ok: false,
				reason: "revoked",
				message: `El token "${record.prefix}…" del producto "${record.name}" está revocado.`,
			};
		}
		return { ok: true, source: "token", tokenId: record.id, name: record.name, prefix: record.prefix };
	}

	if (evaluateApiKeyAuth(`Bearer ${value}`, deps.adminKeys) === "allow") {
		return { ok: true, source: "admin" };
	}

	return {
		ok: false,
		reason: "unknown",
		message: "Token desconocido: no está en agent_api_tokens ni en ADMIN_API_KEYS.",
	};
}

/** El token del request, del `Authorization: Bearer` o del `x-api-key` que mandan muchos clientes MCP. */
export function tokenFromRequest(request: Request): string | null {
	const authorization = request.headers.get("authorization");
	if (authorization !== null) {
		const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
		if (match !== null) {
			const token = (match[1] ?? "").trim();
			if (token.length > 0) return token;
		}
	}
	const apiKey = request.headers.get("x-api-key");
	if (apiKey !== null && apiKey.trim().length > 0) return apiKey.trim();
	return null;
}

/** La lectura real de la tabla, por hash. */
export async function lookupAgentApiToken(tokenHash: string): Promise<AgentApiTokenRecord | undefined> {
	const [row] = await db
		.select({
			id: agentApiTokens.id,
			name: agentApiTokens.name,
			prefix: agentApiTokens.prefix,
			revokedAt: agentApiTokens.revokedAt,
		})
		.from(agentApiTokens)
		.where(eq(agentApiTokens.tokenHash, tokenHash))
		.limit(1);
	return row;
}

/** Marca el token como usado. Falla en silencio a propósito: un fallo acá no debe tumbar la llamada. */
export async function touchAgentApiToken(id: string): Promise<void> {
	try {
		await db.update(agentApiTokens).set({ lastUsedAt: new Date() }).where(eq(agentApiTokens.id, id));
	} catch (error) {
		console.warn("[mcp] no se pudo actualizar lastUsedAt:", error);
	}
}

/** La puerta completa: extrae el token del request, lo valida y registra el uso si es de la tabla. */
export async function authenticateMcpRequest(request: Request): Promise<TokenAuthResult> {
	const result = await authenticateApiToken(tokenFromRequest(request), {
		lookup: lookupAgentApiToken,
		adminKeys: getAdminApiKeys(),
	});
	if (result.ok && result.source === "token") await touchAgentApiToken(result.tokenId);
	return result;
}
