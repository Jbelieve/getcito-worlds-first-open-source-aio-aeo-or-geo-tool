/**
 * El mismo token, producido por dos implementaciones que no se hablan.
 *
 * En el servidor no hay `node`: las credenciales por producto del MCP se administran con
 * `scripts/beaos-token.sh` (bash + openssl + el `psql` del contenedor de la base). En una máquina con
 * node se administran con `apps/web/scripts/beaos-tokens.mjs`. Las dos escriben en `agent_api_tokens`
 * el mismo `prefix` y el mismo `token_hash`, y el middleware valida contra ese formato: si una se
 * desvía, los tokens creados por esa vía dejan de entrar —o entran sólo por una—. Eso no se ve hasta
 * que un producto se queda afuera, así que se prueba acá.
 *
 * Este test corre las **dos implementaciones de verdad** (los subcomandos de diagnóstico `hash` y
 * `new-token`, que no leen `DATABASE_URL` ni tocan la base) y compara la salida. El vector fijo sale de
 * `api-tokens.test.ts`: si alguien cambia el formato en los tres lados a la vez, igual se ve.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));
const BASH_SCRIPT = `${REPO_ROOT}scripts/beaos-token.sh`;
const NODE_SCRIPT = `${REPO_ROOT}apps/web/scripts/beaos-tokens.mjs`;

// Este archivo SPAWNEA node y manipula el PATH, asi que sus pruebas tardan mas que el default de
// 5 s (el wrapper de Electron del harness tarda ~2,6 s por llamada). Esa demora no es una falla del
// codigo que se prueba; el timeout default la convertia en un fallo intermitente.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const GOLDEN_TOKEN = "beaos_test_token";
const GOLDEN_PREFIX = "beaos_te";
const GOLDEN_HASH = "cfda004146265aeeba4021e29492ebbad7a3088b830b38e52841786550aafa64";

/** `beaos_` + 32 caracteres de base64url (24 bytes), sin padding. */
const TOKEN_SHAPE = /^beaos_[A-Za-z0-9_-]{32}$/;
const HASH_SHAPE = /^[0-9a-f]{64}$/;
const PREFIX_LENGTH = 8;

function runNode(args: string[]): string {
	return execFileSync("node", [NODE_SCRIPT, ...args], { encoding: "utf8" }).trim();
}

function runBash(args: string[]): string {
	return execFileSync("bash", [BASH_SCRIPT, ...args], { encoding: "utf8" }).trim();
}

/** El prefijo y el hash que una implementación le calcula a un token. */
function formatWith(run: (args: string[]) => string, token: string): { prefix: string; hash: string } {
	const [prefix = "", hash = ""] = run(["hash", token]).split(/\s+/);
	return { prefix, hash };
}

const implementations = [
	{ label: "bash (scripts/beaos-token.sh)", run: runBash },
	{ label: "node (apps/web/scripts/beaos-tokens.mjs)", run: runNode },
];

describe("formato del token del MCP: bash y node", () => {
	for (const { label, run } of implementations) {
		it(`${label}: el token de ejemplo da el prefijo y el sha256 del contrato`, () => {
			const { prefix, hash } = formatWith(run, GOLDEN_TOKEN);
			expect(prefix).toBe(GOLDEN_PREFIX);
			expect(prefix).toHaveLength(PREFIX_LENGTH);
			expect(hash).toBe(GOLDEN_HASH);
			expect(hash).toMatch(HASH_SHAPE);
		});

		it(`${label}: el token nuevo tiene la forma del contrato (24 bytes, sin padding)`, () => {
			const token = run(["new-token"]);
			expect(token).toMatch(TOKEN_SHAPE);
			expect(token).not.toContain("=");
			// 32 caracteres de base64url son 24 bytes exactos. Si acá dieran 23 o 25, el token tendría
			// otra entropía que la que dice el contrato (y `atob` tiraría si hubiera un carácter ajeno
			// al alfabeto).
			const decoded = atob(token.slice("beaos_".length).replace(/-/g, "+").replace(/_/g, "/"));
			expect(decoded).toHaveLength(24);
		});
	}

	it("las dos implementaciones coinciden token por token", () => {
		// Uno generado por cada lado (se cruzan los dos generadores, no sólo los dos hashers) y dos
		// con caracteres que sólo aparecen en base64url: si el hash se calculara sobre otra cosa —un
		// salto de línea de más, por ejemplo— acá se ve.
		const tokens = [runBash(["new-token"]), runNode(["new-token"]), "beaos_AB-cd_ef0123456789", "beaos_x"];
		for (const token of tokens) {
			expect(formatWith(runBash, token)).toStrictEqual(formatWith(runNode, token));
		}
	});

	it("las dos implementaciones coinciden sin repetirse", () => {
		// `new-token` no puede devolver el mismo token dos veces: si openssl dejara de ser aleatorio,
		// dos productos compartirían credencial y el hash las volvería indistinguibles.
		const tokens = new Set([...Array(8)].map(() => runBash(["new-token"])));
		expect(tokens.size).toBe(8);
	});
});

/**
 * El motivo del script de bash: que corra donde no hay node.
 *
 * Acá hay node, así que la única forma de probarlo es sacarlo del `PATH` y dejar sólo lo que el
 * servidor tiene (bash, openssl, dirname, tr, awk). Si alguien mete una dependencia de node en
 * `scripts/beaos-token.sh`, este test es el que se cae.
 */
describe("scripts/beaos-token.sh sin node", () => {
	const sandbox = mkdtempSync(join(tmpdir(), "beaos-token-sin-node-"));

	// bash con ruta absoluta: adentro de la caja no está en el PATH.
	const bashBinary = execFileSync("sh", ["-c", "command -v bash"], { encoding: "utf8" }).trim();
	for (const binary of ["dirname", "openssl", "tr", "awk"]) {
		const path = execFileSync("sh", ["-c", `command -v ${binary}`], { encoding: "utf8" }).trim();
		symlinkSync(path, join(sandbox, binary));
	}

	afterAll(() => {
		rmSync(sandbox, { recursive: true, force: true });
	});

	function runWithoutNode(args: string[]): string {
		// El resto del entorno se hereda; lo único que se saca es node, que es lo que el servidor no tiene.
		return execFileSync(bashBinary, [BASH_SCRIPT, ...args], {
			encoding: "utf8",
			env: { ...process.env, PATH: sandbox },
		}).trim();
	}

	it("genera un token válido sin node en el PATH", () => {
		const token = runWithoutNode(["new-token"]);
		expect(token).toMatch(TOKEN_SHAPE);
	});

	it("hashea igual que node, sin node en el PATH", () => {
		expect(formatWith(runWithoutNode, GOLDEN_TOKEN)).toStrictEqual(formatWith(runNode, GOLDEN_TOKEN));
	});
});
