/**
 * El contrato del plugin de WordPress: la versión que muestra el panel y el ZIP que se descarga.
 *
 * Tres cosas se prueban acá, y las tres son sobre el mismo riesgo —que el panel ofrezca algo distinto a
 * lo que el repositorio empaqueta—:
 *
 *   1. **La versión**. La que muestra Configuración → Brand (horneada por Vite desde la cabecera del
 *      plugin) contra la cabecera, leída del archivo, y contra el empaquetador, corrido con `--version`.
 *      Es lo que impide que la pantalla diga `v0.1.0` mientras la cabecera dice otra cosa, o que el ZIP
 *      se llame distinto a lo que el panel muestra.
 *   2. **La URL de descarga**. La ruta que usa el botón es la que el empaquetador publica en el JSON que
 *      se sirve, y no lleva la versión adentro: el enlace del panel no cambia en cada release.
 *   3. **El ZIP**. Se arma de verdad (con `--public`, como en el build) y se mira adentro: tiene que traer
 *      la carpeta `beaos-aos/` con los cuatro `.php` y el `README.md`, y **no** traer `tests/` ni
 *      `.wp-local/` —los tests leen archivos del repositorio que adentro de un WordPress no existen—.
 *      Además se comprueba que los bytes servidos sean idénticos a los de la release: mismo `sha256`.
 *
 * La lista de lo que tiene que entrar está escrita **acá**, no tomada del empaquetador: si alguien saca un
 * archivo del ZIP, el test lo dice en vez de dar por bueno lo que el script haga.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { WP_PLUGIN_DOWNLOAD_PATH, WP_PLUGIN_VERSION, WP_PLUGIN_VERSION_PATH } from "@/lib/aos/wordpress-plugin";
import {
	parseWpPluginVersion,
	readWpPluginVersion,
	WP_PLUGIN_FILES,
	WP_PLUGIN_HEADER,
	wpPluginZipName,
} from "../../../../../../scripts/beaos-wp-plugin.mjs";

const REPO_ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const RELEASE_SCRIPT = join(REPO_ROOT, "scripts", "release-wordpress-plugin.mjs");
const PUBLIC_DIR = join(REPO_ROOT, "apps", "web", "public");

/** Lo que el ZIP tiene que traer: la carpeta del plugin, los cuatro `.php` y el README. Nada más. */
const ZIP_ENTRIES = [
	"beaos-aos/beaos-aos.php",
	"beaos-aos/beaos-aos-pure.php",
	"beaos-aos/class-beaos-mcp.php",
	"beaos-aos/uninstall.php",
	"beaos-aos/README.md",
];

// El test arma el ZIP de verdad y en el envoltorio de Electron del harness cada proceso hijo tarda
// algunos segundos. Esa demora no es una falla del empaquetador.
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

function node(script: string, args: string[]): string {
	return execFileSync("node", [script, ...args], { encoding: "utf8" });
}

function sha256(file: string): string {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Un directorio descartable para el ZIP versionado: el test no ensucia `dist/`. */
function outDir(): string {
	return mkdtempSync(join(tmpdir(), "beaos-aos-zip-"));
}

/** `unzip` no está en todos lados (en la imagen Docker no está); sin él no se puede mirar adentro. */
const unzipAvailable = (() => {
	try {
		execFileSync("unzip", ["-v"], { stdio: "ignore" });
		return true;
	} catch {
		return false;
	}
})();

describe("la versión del plugin: el panel y la cabecera", () => {
	it("la que muestra el panel es la de la cabecera del plugin, no una copia", () => {
		expect(WP_PLUGIN_VERSION).toBe(readWpPluginVersion());
		expect(WP_PLUGIN_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
	});

	it("la versión sale del archivo del plugin: si se mueve, esto falla", () => {
		expect(WP_PLUGIN_HEADER).toBe("apps/beaos-wordpress/beaos-aos.php");
		expect(readFileSync(join(REPO_ROOT, WP_PLUGIN_HEADER), "utf8")).toContain(`Version: ${WP_PLUGIN_VERSION}`);
	});

	it("el empaquetador lee la misma versión (el ZIP no puede llamarse distinto al panel)", () => {
		expect(node(RELEASE_SCRIPT, ["--version"]).trim()).toBe(WP_PLUGIN_VERSION);
	});

	it("lee la línea Version: y no se confunde con los otros campos de la cabecera", () => {
		expect(
			parseWpPluginVersion(`<?php
/**
 * Plugin Name: Version: 9.9.9
 * Requires at least: 6.0
 * Version: 0.4.2
 * Text Domain: beaos-aos
 */
`),
		).toBe("0.4.2");
	});

	it("tira si no hay cabecera legible o la versión no tiene la forma x.y.z", () => {
		expect(() => parseWpPluginVersion("<?php\n// sin cabecera\n")).toThrow(/Version/);
		expect(() => parseWpPluginVersion("* Version: v1.0.0\n")).toThrow(/x\.y\.z/);
		expect(() => parseWpPluginVersion("* Version: 1.0\n")).toThrow(/x\.y\.z/);
	});

	it("lee la cabecera de un repositorio cualquiera, no de una ruta fija", () => {
		const root = mkdtempSync(join(tmpdir(), "beaos-wp-"));
		mkdirSync(dirname(join(root, WP_PLUGIN_HEADER)), { recursive: true });
		writeFileSync(join(root, WP_PLUGIN_HEADER), "<?php\n/**\n * Version: 3.2.1\n */\n", "utf8");
		expect(readWpPluginVersion(root)).toBe("3.2.1");
	});
});

describe("el ZIP que ofrece el panel", () => {
	it("trae la carpeta beaos-aos/ con los .php y el README, y ningún test", () => {
		const out = outDir();
		node(RELEASE_SCRIPT, ["--out", out, "--public"]);

		const zip = join(out, wpPluginZipName(WP_PLUGIN_VERSION));
		expect(WP_PLUGIN_FILES).toEqual(ZIP_ENTRIES.map((entry) => basename(entry)));

		const bytes = readFileSync(zip).toString("latin1");
		for (const entry of ZIP_ENTRIES) expect(bytes).toContain(entry);
		for (const prohibido of ["/tests/", ".wp-local", "beaos-wordpress/"]) {
			expect(bytes).not.toContain(prohibido);
		}

		if (unzipAvailable) {
			const entries = execFileSync("unzip", ["-Z1", zip], { encoding: "utf8" })
				.split("\n")
				.map((line) => line.trim())
				.filter((line) => line !== "" && !line.endsWith("/"));
			expect(entries.sort()).toEqual([...ZIP_ENTRIES].sort());
		}
	});

	it("los bytes que se sirven son los de la release, y el JSON dice cuáles", () => {
		const out = outDir();
		node(RELEASE_SCRIPT, ["--out", out, "--public"]);

		const release = join(out, wpPluginZipName(WP_PLUGIN_VERSION));
		const served = join(PUBLIC_DIR, basename(WP_PLUGIN_DOWNLOAD_PATH));
		const manifest = JSON.parse(readFileSync(join(PUBLIC_DIR, basename(WP_PLUGIN_VERSION_PATH)), "utf8")) as Record<
			string,
			unknown
		>;

		expect(sha256(served)).toBe(sha256(release));
		expect(manifest.sha256).toBe(sha256(release));
		expect(manifest.version).toBe(WP_PLUGIN_VERSION);
		expect(manifest.file).toBe(wpPluginZipName(WP_PLUGIN_VERSION));
		expect(manifest.download).toBe(WP_PLUGIN_DOWNLOAD_PATH);
	});

	it("el enlace de descarga no lleva la versión: el panel no cambia de link en cada release", () => {
		expect(WP_PLUGIN_DOWNLOAD_PATH).toBe("/beaos-aos.zip");
		expect(WP_PLUGIN_DOWNLOAD_PATH).not.toContain(WP_PLUGIN_VERSION);
		expect(WP_PLUGIN_VERSION_PATH).toBe("/beaos-aos-version.json");
	});
});
