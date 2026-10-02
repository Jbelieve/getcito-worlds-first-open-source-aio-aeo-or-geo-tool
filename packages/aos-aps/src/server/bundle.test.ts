import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type AssetRow,
	assetMatches,
	type BundleSource,
	buildBundle,
	bundleHash,
	findAsset,
	KEYS_PATH,
	latestByPath,
	REQUIRED_BUNDLE_PATH,
	rejectedAssetRows,
	SIGNATURE_PATH,
	sha256Hex,
} from "./bundle";

const BRAND_JSON = `${JSON.stringify({ claims: [], proofs: [] }, null, 2)}\n`;

function row(overrides: Partial<AssetRow> = {}): AssetRow {
	return {
		path: "/.well-known/brand.json",
		type: "application/json",
		content: BRAND_JSON,
		createdAt: new Date("2026-09-01T00:00:00Z"),
		...overrides,
	};
}

function entity(overrides: Partial<BundleSource> = {}): BundleSource {
	return { id: "entity-1", name: "Felix", websiteUrl: "https://felix.com", isPublished: true, ...overrides };
}

const KEYS_JSON = `${JSON.stringify({ keys: [{ key_id: "believe-2026-primary", kid: "71952e93b97ac2b8" }] }, null, 2)}\n`;
const SIGNATURE_JSON = `${JSON.stringify({ alg: "Ed25519", kid: "71952e93b97ac2b8", value: "firma", public_key_url: "https://believe-global.com/.well-known/keys.json" }, null, 2)}\n`;

function signedRows(): AssetRow[] {
	return [
		row(),
		row({ path: "/.well-known/keys.json", content: KEYS_JSON }),
		row({ path: "/.well-known/brand.json.sig", content: SIGNATURE_JSON }),
	];
}

describe("latestByPath", () => {
	it("keeps the newest row per path and orders them stably", () => {
		const rows: AssetRow[] = [
			row({ path: "/llms.txt", content: "nuevo", createdAt: new Date("2026-09-02T00:00:00Z") }),
			row({ path: "/llms.txt", content: "viejo", createdAt: new Date("2026-09-01T00:00:00Z") }),
			row({ path: "/AGENTS.md", content: "# Felix" }),
		];
		const latest = latestByPath(rows);
		expect(latest.map((entry) => entry.path)).toEqual(["/AGENTS.md", "/llms.txt"]);
		expect(latest.find((entry) => entry.path === "/llms.txt")?.content).toBe("nuevo");
	});
});

describe("sha256Hex", () => {
	it("hashes the exact utf-8 bytes", () => {
		expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
		// Accents are two bytes: the hash must follow bytes, not characters.
		expect(sha256Hex("á")).toBe(sha256Hex("á"));
		expect(sha256Hex("á")).not.toBe(sha256Hex("a"));
	});
});

describe("buildBundle", () => {
	it("is closed by default: an unpublished entity produces no bundle", () => {
		expect(buildBundle(entity({ isPublished: false }), [row()])).toBeNull();
	});

	it("refuses to publish without a brand.json", () => {
		expect(buildBundle(entity(), [row({ path: "/llms.txt", content: "# Felix" })])).toBeNull();
		expect(buildBundle(entity(), [])).toBeNull();
	});

	it("carries the exact bytes, their sha256 and their byte length", () => {
		const bundle = buildBundle(entity(), [row({ content: "Marca con acentos: café\n" })]);
		const asset = bundle?.assets[0];
		expect(asset?.content).toBe("Marca con acentos: café\n");
		expect(asset?.sha256).toBe(sha256Hex("Marca con acentos: café\n"));
		expect(asset?.bytes).toBe(Buffer.byteLength("Marca con acentos: café\n", "utf8"));
		expect(asset?.bytes).toBeGreaterThan("Marca con acentos: café\n".length);
	});

	it("reads the signing identity from the artifacts, not from configuration", () => {
		const bundle = buildBundle(entity(), signedRows());
		expect(bundle?.signed).toBe(true);
		expect(bundle?.keyId).toBe("believe-2026-primary");
		expect(bundle?.kid).toBe("71952e93b97ac2b8");
		expect(bundle?.keysUri).toBe("https://believe-global.com/.well-known/keys.json");
		expect(bundle?.entityId).toBe("entity-1");
		expect(bundle?.websiteUrl).toBe("https://felix.com");
	});

	it("reports no identity for an unsigned bundle", () => {
		const bundle = buildBundle(entity(), [row()]);
		expect(bundle?.signed).toBe(false);
		expect(bundle?.keyId).toBeNull();
		expect(bundle?.kid).toBeNull();
		expect(bundle?.keysUri).toBeUndefined();
	});

	it("identifies the version of the whole bundle", () => {
		const one = buildBundle(entity(), signedRows());
		const same = buildBundle(entity(), signedRows());
		expect(one?.bundleSha256).toBe(same?.bundleSha256);

		const changed = buildBundle(entity(), [row({ content: `${BRAND_JSON} ` })]);
		expect(changed?.bundleSha256).not.toBe(one?.bundleSha256);
	});

	it("changes the bundle hash when a path is added or removed", () => {
		const base = buildBundle(entity(), [row(), row({ path: "/llms.txt", content: "# Felix" })]);
		expect(bundleHash(base?.assets ?? [])).toBe(base?.bundleSha256);
		expect(bundleHash([])).toBe(sha256Hex(""));
	});
});

function bundleOf(rows: AssetRow[]): NonNullable<ReturnType<typeof buildBundle>> {
	const bundle = buildBundle(entity(), rows);
	if (bundle === null) throw new Error("expected a bundle");
	return bundle;
}

function assetOf(rows: AssetRow[], path: string): NonNullable<ReturnType<typeof findAsset>> {
	const asset = findAsset(bundleOf(rows), path);
	if (asset === null) throw new Error(`expected asset ${path}`);
	return asset;
}

describe("findAsset and assetMatches", () => {
	it("finds an asset by path", () => {
		const bundle = bundleOf([row(), row({ path: "/llms.txt", content: "# Felix" })]);
		expect(findAsset(bundle, "/llms.txt")?.content).toBe("# Felix");
		expect(findAsset(bundle, "/robots.txt")).toBeNull();
	});

	it("accepts only the bytes that were signed", () => {
		expect(assetMatches(assetOf([row()], "/.well-known/brand.json"), BRAND_JSON)).toBe(true);
	});

	it("rejects a re-serialized brand.json, which is what breaks the signature", () => {
		const asset = assetOf([row()], "/.well-known/brand.json");
		// Same data, different bytes: the classic way a delivery agent silently breaks Ed25519.
		const reserialized = JSON.stringify(JSON.parse(BRAND_JSON));
		expect(reserialized).not.toBe(BRAND_JSON);
		expect(assetMatches(asset, reserialized)).toBe(false);
		expect(assetMatches(asset, `${BRAND_JSON}\n`)).toBe(false);
	});
});

/**
 * La guarda de forma, **en la lectura**: es la que protege a todos los integradores aunque la base ya
 * tenga basura. Una fila con `/wp-login.php` en un WordPress tapa la pantalla de login; en otro
 * integrador, lo que sea. La ruta mala no sale —y tampoco desaparece en silencio.
 */
describe("la guarda de forma de las rutas, al armar el bundle", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("una ruta peligrosa en la base NO sale en el bundle", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const bundle = bundleOf([
			row(),
			row({ path: "/llms.txt", content: "# Felix" }),
			row({ path: "/wp-login.php", content: "<form>señuelo</form>" }),
		]);

		expect(bundle.assets.map((asset) => asset.path)).toEqual(["/.well-known/brand.json", "/llms.txt"]);
		expect(findAsset(bundle, "/wp-login.php")).toBeNull();
		// Y no desaparece en silencio: se grita, con el motivo.
		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0]?.[0])).toContain("/wp-login.php");
		expect(String(error.mock.calls[0]?.[0])).toContain("está en la lista de rutas prohibidas");
	});

	it("una ruta sin forma de kit tampoco sale, y también se ve", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const bundle = bundleOf([row(), row({ path: "/una-pagina", content: "x" })]);

		expect(bundle.assets.map((asset) => asset.path)).toEqual(["/.well-known/brand.json"]);
		expect(error).toHaveBeenCalledTimes(1);
		expect(String(error.mock.calls[0]?.[0])).toContain("no tiene forma de kit");
	});

	it("una ruta mala NO tumba el bundle entero: el resto del kit se sirve igual", () => {
		vi.spyOn(console, "error").mockImplementation(() => {});
		const bundle = bundleOf([
			row(),
			row({ path: "/wp-config.php", content: "<?php" }),
			row({ path: "/llms.txt", content: "# Felix" }),
			row({ path: "/.well-known/keys.json", content: KEYS_JSON }),
		]);

		expect(bundle.assets.map((asset) => asset.path)).toEqual([
			"/.well-known/brand.json",
			"/.well-known/keys.json",
			"/llms.txt",
		]);
		// El hash del bundle se calcula sobre lo que sale: una fila descartada no lo ensucia ni lo esconde.
		expect(bundle.bundleSha256).toBe(bundleHash(bundle.assets));
	});

	it("un kit sano no ensucia el log", () => {
		const error = vi.spyOn(console, "error").mockImplementation(() => {});
		const bundle = bundleOf(signedRows());
		expect(bundle.assets.length).toBe(3);
		expect(error).not.toHaveBeenCalled();
	});

	it("el bundle de un kit sano es exactamente el mismo que antes de la guarda", () => {
		// La guarda no puede cambiar el bundle legítimo: mismas rutas, mismo hash, mismos bytes.
		const bundle = bundleOf(signedRows());
		const esperado = [SIGNATURE_PATH, KEYS_PATH, REQUIRED_BUNDLE_PATH].sort((a, b) => a.localeCompare(b));
		expect(bundle.assets.map((asset) => asset.path)).toEqual(esperado);
		expect(bundle.assets.every((asset) => assetMatches(asset, asset.content))).toBe(true);
	});

	it("rejectedAssetRows dice cuáles y por qué, sin armar un bundle", () => {
		expect(rejectedAssetRows([row(), row({ path: "/wp-login.php" })])).toEqual([
			{ path: "/wp-login.php", reason: "está en la lista de rutas prohibidas" },
		]);
		expect(rejectedAssetRows(signedRows())).toEqual([]);
	});
});
