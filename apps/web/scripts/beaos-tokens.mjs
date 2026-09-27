#!/usr/bin/env node
/**
 * Administración de las credenciales por producto del MCP de BeAOS.
 *
 * El MCP acepta un token de `agent_api_tokens` por producto, además de los `ADMIN_API_KEYS` compartidos.
 * Este script es la única vía para crearlos y revocarlos sin tocar la base a mano:
 *
 *   node apps/web/scripts/beaos-tokens.mjs create autex
 *   node apps/web/scripts/beaos-tokens.mjs list
 *   node apps/web/scripts/beaos-tokens.mjs revoke beaos_ab
 *
 * El token en claro se imprime **una sola vez**, al crearlo. En la base queda su sha256: si se pierde,
 * no se recupera, se revoca y se crea otro. Es a propósito — un token que se puede volver a leer es un
 * token que se puede filtrar desde la base.
 *
 * No depende del código TypeScript a propósito: un script de operación tiene que poder correr aunque la
 * app no compile. Habla SQL contra la tabla y nada más.
 */
import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../../..");

const USAGE = `Uso:
  beaos-tokens.mjs create <nombre>   Crea un token para un producto (imprime el token UNA vez)
  beaos-tokens.mjs list              Lista los tokens con su prefijo, uso y estado
  beaos-tokens.mjs revoke <prefijo>  Revoca un token por su prefijo
  beaos-tokens.mjs --help

Variables: DATABASE_URL (si falta, se lee de apps/web/.env o .env del repo).`;

/** Un lector de `.env` mínimo: no vale la pena una dependencia para esto. */
function readEnvFile(path) {
	if (existsSync(path) === false) return {};
	const values = {};
	for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
		if (match === null) continue;
		let value = match[2].trim();
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1);
		}
		values[match[1]] = value;
	}
	return values;
}

function databaseUrl() {
	if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim().length > 0) return process.env.DATABASE_URL.trim();
	for (const file of ["apps/web/.env", ".env", "apps/web/.env.local", ".env.local"]) {
		const values = readEnvFile(resolve(REPO_ROOT, file));
		if (values.DATABASE_URL && values.DATABASE_URL.trim().length > 0) return values.DATABASE_URL.trim();
	}
	console.error("Falta DATABASE_URL. Definila en el entorno o en apps/web/.env.");
	process.exit(1);
}

function hashToken(token) {
	return createHash("sha256").update(token, "utf8").digest("hex");
}

function formatDate(value) {
	return value === null || value === undefined ? "—" : new Date(value).toISOString();
}

async function withClient(run) {
	const client = new pg.Client({ connectionString: databaseUrl() });
	await client.connect();
	try {
		return await run(client);
	} finally {
		await client.end();
	}
}

async function create(name) {
	if (typeof name !== "string" || name.trim().length === 0) {
		console.error("create necesita el nombre del producto, por ejemplo: create autex");
		process.exit(1);
	}
	const token = `beaos_${randomBytes(24).toString("base64url")}`;
	const tokenHash = hashToken(token);
	const prefix = token.slice(0, 8);
	await withClient(async (client) => {
		await client.query("insert into agent_api_tokens (name, token_hash, prefix) values ($1, $2, $3)", [
			name.trim(),
			tokenHash,
			prefix,
		]);
	});
	console.log(`Token creado para "${name.trim()}" (prefijo ${prefix}).`);
	console.log("");
	console.log(`  ${token}`);
	console.log("");
	console.log("Guardalo AHORA: se guardó sólo su sha256 y no se puede volver a mostrar.");
	console.log(`Para revocarlo: node apps/web/scripts/beaos-tokens.mjs revoke ${prefix}`);
}

async function list() {
	const rows = await withClient(async (client) => {
		const result = await client.query(
			"select name, prefix, id, created_at, last_used_at, revoked_at from agent_api_tokens order by created_at desc",
		);
		return result.rows;
	});
	if (rows.length === 0) {
		console.log("No hay tokens creados. El MCP sigue aceptando ADMIN_API_KEYS.");
		return;
	}
	console.log(`${rows.length} token(s):`);
	for (const row of rows) {
		const state = row.revoked_at === null ? "activo" : `revocado ${formatDate(row.revoked_at)}`;
		console.log(
			`  ${row.prefix}  ${String(row.name).padEnd(12)}  ${state.padEnd(26)} último uso: ${formatDate(row.last_used_at)}`,
		);
	}
}

async function revoke(prefix) {
	if (typeof prefix !== "string" || prefix.trim().length === 0) {
		console.error("revoke necesita el prefijo del token, por ejemplo: revoke beaos_ab");
		process.exit(1);
	}
	const rows = await withClient(async (client) => {
		const result = await client.query(
			"update agent_api_tokens set revoked_at = now() where prefix = $1 and revoked_at is null returning name, prefix",
			[prefix.trim()],
		);
		return result.rows;
	});
	if (rows.length === 0) {
		console.error(`No hay ningún token activo con el prefijo "${prefix.trim()}".`);
		process.exit(1);
	}
	for (const row of rows) console.log(`Revocado: ${row.prefix} (${row.name}).`);
}

const [command, argument] = process.argv.slice(2);

switch (command) {
	case "create":
		await create(argument);
		break;
	case "list":
		await list();
		break;
	case "revoke":
		await revoke(argument);
		break;
	case "--help":
	case "-h":
	case undefined:
		console.log(USAGE);
		break;
	default:
		console.error(`Comando desconocido: ${command}`);
		console.log(USAGE);
		process.exit(1);
}
