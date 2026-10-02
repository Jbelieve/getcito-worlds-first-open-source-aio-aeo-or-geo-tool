#!/usr/bin/env node
/**
 * Arma el ZIP **instalable** del plugin de WordPress de BeAOS.
 *
 *   node scripts/release-wordpress-plugin.mjs              # dist/beaos-aos-<version>.zip (la release)
 *   node scripts/release-wordpress-plugin.mjs --public     # y además la copia que sirve BeAOS
 *   node scripts/release-wordpress-plugin.mjs --version    # imprime la versión y no arma nada
 *
 * Es el hermano de `scripts/release-extension.sh` y sigue su criterio: la lista de lo que va al paquete
 * es explícita (vive en `scripts/beaos-wp-plugin.mjs`, con el porqué), la versión sale de la fuente de
 * verdad —la cabecera del plugin, que es la que WordPress muestra y la que lee el panel— y el script
 * imprime el tamaño, el `sha256` y el contenido para que se pueda verificar sin abrir el archivo.
 *
 * **La carpeta de adentro es `beaos-aos/`**: WordPress descomprime en `wp-content/plugins/` y el plugin
 * tiene que quedar en su propia carpeta. No se asume: se verifica sobre el ZIP ya escrito.
 *
 * **Por qué está en Node y no en bash como `release-extension.sh`.** El ZIP tiene que existir en el
 * deploy, y el deploy de BeAOS es una imagen Docker (`docker/Dockerfile`, etapa `builder`) que corre
 * `pnpm --filter @workspace/web build` sobre `node:24-bookworm-slim`: ahí hay Node, pero **no hay binario
 * `zip`**. `archiver` ya es dependencia de `apps/web` (lo usa `generate-brand-kit.tsx`), así que el
 * empaquetador lo resuelve de ahí con `createRequire` en vez de sumar otra dependencia al repositorio.
 *
 * Con `--public` deja, además, lo que sirve BeAOS con URL estable:
 *
 *   apps/web/public/beaos-aos.zip               (los mismos bytes, con el nombre sin versión)
 *   apps/web/public/beaos-aos-version.json      (para consultar qué versión se está sirviendo)
 *
 * Los dos están en `.gitignore`: el repositorio es público y un ZIP commiteado engorda el repo y se
 * desincroniza del código. Los genera el build del panel (`apps/web/package.json`), así que la copia
 * servida siempre es la del código que se está desplegando.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	createWriteStream,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	readWpPluginVersion,
	WP_PLUGIN_FILES,
	WP_PLUGIN_HEADER,
	WP_PLUGIN_SLUG,
	wpPluginRepoRoot,
	wpPluginZipName,
} from "./beaos-wp-plugin.mjs";

const ROOT = wpPluginRepoRoot();
const PLUGIN_DIR = dirname(resolve(ROOT, WP_PLUGIN_HEADER));
const PUBLIC_DIR = join(ROOT, "apps", "web", "public");

function sha256(file) {
	return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/** Corre `unzip` si está en el PATH; devuelve `null` cuando no está (en la imagen Docker no está). */
function unzip(args) {
	try {
		return execFileSync("unzip", args, { encoding: "utf8" });
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		throw error;
	}
}

/**
 * Verifica el ZIP ya escrito: que sea un ZIP válido y que adentro esté **exactamente** lo que tiene que
 * estar.
 *
 * Con `unzip` disponible (la máquina de quien desarrolla, un runner de CI) la lista de entradas se lee
 * del archivo y se compara contra la esperada, y `unzip -t` confirma que los bytes se descomprimen. Sin
 * `unzip` —el build de Docker— queda la comprobación de que los nombres esperados estén en el directorio
 * central del ZIP (los nombres no se comprimen: están en los bytes tal cual) y de que no haya aparecido
 * ni `tests/` ni `.wp-local/`. La primera es la buena; la segunda evita que el build publique un ZIP con
 * los tests adentro sin decirlo.
 */
function verifyZip(zipFile, expected) {
	const listing = unzip(["-Z1", zipFile]);
	if (listing !== null) {
		const entries = listing
			.split("\n")
			.map((line) => line.trim())
			.filter((line) => line !== "" && !line.endsWith("/"));
		const sobra = entries.filter((entry) => !expected.includes(entry));
		const falta = expected.filter((entry) => !entries.includes(entry));
		if (sobra.length > 0 || falta.length > 0) {
			throw new Error(
				`el ZIP no tiene lo que tiene que tener (falta: ${falta.join(", ") || "nada"}; sobra: ${sobra.join(", ") || "nada"})`,
			);
		}
		const test = unzip(["-t", zipFile]);
		if (test === null || !/No errors detected/.test(test)) {
			throw new Error("unzip -t no dio OK sobre el ZIP recién armado");
		}
		return { entries, integrity: "unzip -t: No errors detected in compressed data" };
	}

	const bytes = readFileSync(zipFile).toString("latin1");
	for (const entry of expected) {
		if (!bytes.includes(entry)) throw new Error(`el ZIP no contiene la entrada ${entry}`);
	}
	if (bytes.includes("/tests/") || bytes.includes(".wp-local")) {
		throw new Error("el ZIP trae tests/ o .wp-local/, que no se instalan");
	}
	return { entries: expected, integrity: "sin unzip en el PATH: se verificaron los nombres" };
}

// La fecha de los archivos dentro del ZIP, fija a propósito: con la fecha real de cada archivo, dos
// builds del mismo código dan `sha256` distintos y la descarga no se puede comparar contra el adjunto del
// release. Con una fecha fija, el ZIP es reproducible byte a byte a partir de los mismos archivos.
const ZIP_ENTRY_DATE = new Date("2020-01-01T00:00:00Z");

async function buildZip(zipFile) {
	for (const file of WP_PLUGIN_FILES) {
		if (!existsSync(join(PLUGIN_DIR, file))) {
			throw new Error(`falta ${join(PLUGIN_DIR, file)}`);
		}
	}

	// `archiver` es dependencia de `apps/web` (la usa `generate-brand-kit.tsx`), no de la raíz. Se
	// resuelve desde el `package.json` de la app en vez de sumar otra dependencia al repositorio.
	const require = createRequire(join(ROOT, "apps", "web", "package.json"));
	const { ZipArchive } = await import(pathToFileURL(require.resolve("archiver")).href);

	mkdirSync(dirname(zipFile), { recursive: true });
	rmSync(zipFile, { force: true });

	const archive = new ZipArchive({ zlib: { level: 9 } });
	const output = createWriteStream(zipFile);
	const done = new Promise((res, rej) => {
		output.on("close", res);
		archive.on("error", rej);
	});
	archive.pipe(output);

	// La carpeta de adentro es el slug: `wp-content/plugins/beaos-aos/`.
	for (const file of WP_PLUGIN_FILES) {
		archive.file(join(PLUGIN_DIR, file), { name: `${WP_PLUGIN_SLUG}/${file}`, date: ZIP_ENTRY_DATE });
	}

	await archive.finalize();
	await done;
}

/** Los bytes que sirve BeAOS, con URL estable, y el JSON para consultar la versión. */
function writePublicCopies(zipFile, version, digest, bytes) {
	mkdirSync(PUBLIC_DIR, { recursive: true });
	const served = join(PUBLIC_DIR, `${WP_PLUGIN_SLUG}.zip`);
	// Se copia el archivo ya verificado, no se arma otro: así el `sha256` que publica el JSON es el de
	// los bytes que se descargan, y no el de un ZIP hermano que podría diferir.
	copyFileSync(zipFile, served);
	if (sha256(served) !== digest) {
		throw new Error("la copia que se sirve no es idéntica al ZIP de la release");
	}

	const manifest = join(PUBLIC_DIR, `${WP_PLUGIN_SLUG}-version.json`);
	writeFileSync(
		manifest,
		`${JSON.stringify(
			{
				plugin: WP_PLUGIN_SLUG,
				version,
				file: wpPluginZipName(version),
				download: `/${WP_PLUGIN_SLUG}.zip`,
				sha256: digest,
				bytes,
			},
			null,
			2,
		)}\n`,
		"utf8",
	);
	return { served, manifest };
}

function parseArgs(argv) {
	const args = { out: join(ROOT, "dist"), public: false, quiet: false, version: false };
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === "--public") args.public = true;
		else if (arg === "--quiet") args.quiet = true;
		else if (arg === "--version") args.version = true;
		else if (arg === "--out") {
			const value = argv[++i];
			if (value === undefined) throw new Error("--out necesita un directorio");
			args.out = resolve(ROOT, value);
		} else if (arg === "--help" || arg === "-h") args.help = true;
		else throw new Error(`no conozco el argumento ${arg}`);
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (args.help) {
		console.log(
			"uso: node scripts/release-wordpress-plugin.mjs [--public] [--out <dir>] [--quiet] [--version]",
		);
		return;
	}

	const version = readWpPluginVersion();

	// El modo consulta no arma nada: lo usa el test que compara esta lectura con la del panel.
	if (args.version) {
		console.log(version);
		return;
	}

	const expected = WP_PLUGIN_FILES.map((file) => `${WP_PLUGIN_SLUG}/${file}`);
	const zipFile = join(args.out, wpPluginZipName(version));

	await buildZip(zipFile);
	const { entries, integrity } = verifyZip(zipFile, expected);
	const digest = sha256(zipFile);
	const bytes = statSync(zipFile).size;

	const served = args.public ? writePublicCopies(zipFile, version, digest, bytes) : null;

	console.log(`zip:      ${zipFile}`);
	console.log(`tamaño:   ${bytes} bytes (${Math.round(bytes / 1024)} KB)`);
	console.log(`versión:  ${version}`);
	console.log(`sha256:   ${digest}`);
	console.log(`integridad: ${integrity}`);
	if (served !== null) {
		console.log(`servido:  ${served.served}  →  /${WP_PLUGIN_SLUG}.zip`);
		console.log(`versión:  ${served.manifest}  →  /${WP_PLUGIN_SLUG}-version.json`);
	}
	if (!args.quiet) {
		console.log("contenido:");
		for (const entry of entries) console.log(`  ${entry}`);
	}
}

// Solo cuando se lo corre como script: importarlo (por ejemplo desde un test) no arma nada.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	await main().catch((error) => {
		console.error(`ERROR: ${error.message}`);
		process.exitCode = 1;
	});
}
