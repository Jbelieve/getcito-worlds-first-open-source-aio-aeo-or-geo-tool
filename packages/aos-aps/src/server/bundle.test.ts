import { describe, expect, it } from "vitest";
import {
	type AssetRow,
	type BundleSource,
	assetMatches,
	buildBundle,
	bundleHash,
	findAsset,
	latestByPath,
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

const SIGNING = { keyId: "believe-2026-primary", keysUri: "https://believe-global.com/.well-known/keys.json" };

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
		const bundle = buildBundle(entity(), [row({ content: "Marca con acentos: café\n" })], SIGNING);
		const asset = bundle?.assets[0];
		expect(asset?.content).toBe("Marca con acentos: café\n");
		expect(asset?.sha256).toBe(sha256Hex("Marca con acentos: café\n"));
		expect(asset?.bytes).toBe(Buffer.byteLength("Marca con acentos: café\n", "utf8"));
		expect(asset?.bytes).toBeGreaterThan("Marca con acentos: café\n".length);
	});

	it("carries the umbrella identity a consumer must publish", () => {
		const bundle = buildBundle(entity(), [row()], SIGNING);
		expect(bundle?.keyId).toBe("believe-2026-primary");
		expect(bundle?.keysUri).toBe("https://believe-global.com/.well-known/keys.json");
		expect(bundle?.entityId).toBe("entity-1");
		expect(bundle?.websiteUrl).toBe("https://felix.com");
	});

	it("reports no key identity when the bundle was signed without one", () => {
		const bundle = buildBundle(entity(), [row()], null);
		expect(bundle?.keyId).toBeNull();
		expect(bundle?.keysUri).toBeUndefined();
	});

	it("identifies the version of the whole bundle", () => {
		const one = buildBundle(entity(), [row()], SIGNING);
		const same = buildBundle(entity(), [row()], SIGNING);
		expect(one?.bundleSha256).toBe(same?.bundleSha256);

		const changed = buildBundle(entity(), [row({ content: `${BRAND_JSON} ` })], SIGNING);
		expect(changed?.bundleSha256).not.toBe(one?.bundleSha256);
	});

	it("changes the bundle hash when a path is added or removed", () => {
		const base = buildBundle(entity(), [row(), row({ path: "/llms.txt", content: "# Felix" })], SIGNING);
		expect(bundleHash(base?.assets ?? [])).toBe(base?.bundleSha256);
		expect(bundleHash([])).toBe(sha256Hex(""));
	});
});

function bundleOf(rows: AssetRow[]): NonNullable<ReturnType<typeof buildBundle>> {
	const bundle = buildBundle(entity(), rows, SIGNING);
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
