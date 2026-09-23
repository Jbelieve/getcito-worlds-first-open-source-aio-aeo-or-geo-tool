/**
 * The publishable asset bundle: what a delivery agent (Maasy MCP -> the brand's be agent) receives
 * and mounts on a site.
 *
 * Two invariants:
 *   1. Closed by default. An entity that is not explicitly published produces no bundle, and an
 *      entity with no brand.json is not publishable — there is nothing for an agent to verify.
 *   2. Byte-exact delivery. The Ed25519 signature covers the exact bytes of brand.json, so the
 *      bundle carries the content verbatim plus its sha256. A consumer that re-serializes the JSON
 *      breaks the signature; the hash is there to catch that before the file reaches a website.
 */

import { createHash } from "node:crypto";

export interface AssetRow {
	path: string;
	type: string;
	content: string;
	createdAt: Date;
}

export interface BundleAsset {
	path: string;
	type: string;
	/** Exact bytes to write, as text. Never re-serialize before comparing sha256. */
	content: string;
	sha256: string;
	bytes: number;
}

export interface AssetBundle {
	entityId: string;
	name: string;
	websiteUrl: string | null;
	/** Published key id an agent must see in keys.json, e.g. believe-2026-primary. */
	keyId: string | null;
	/** Where the matching public key is published. */
	keysUri?: string;
	/** Identifies this exact set of bytes, so a consumer can tell whether it already mounted it. */
	bundleSha256: string;
	assets: BundleAsset[];
}

export interface BundleSource {
	id: string;
	name: string;
	websiteUrl: string | null;
	isPublished: boolean;
}

export function sha256Hex(content: string): string {
	return createHash("sha256").update(Buffer.from(content, "utf8")).digest("hex");
}

/** Latest generated version of each path, newest first in the input. */
export function latestByPath(rows: AssetRow[]): AssetRow[] {
	const seen = new Map<string, AssetRow>();
	for (const row of rows) {
		if (seen.has(row.path) === false) seen.set(row.path, row);
	}
	return [...seen.values()].sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Bundle identity: the hash of every path with the hash of its bytes, in a stable order. Two runs
 * that produce identical assets share a bundle hash even if the JSON timestamps differ inside.
 */
export function bundleHash(assets: BundleAsset[]): string {
	const manifest = assets.map((asset) => `${asset.path}\n${asset.sha256}`).join("\n");
	return sha256Hex(manifest);
}

export const REQUIRED_BUNDLE_PATH = "/.well-known/brand.json";

/**
 * Builds the bundle a delivery agent may mount. Returns null when the entity is not published or
 * when the required brand.json is missing: the caller answers 404, never a partial bundle.
 */
export function buildBundle(
	entity: BundleSource,
	rows: AssetRow[],
	signing?: { keyId: string; keysUri?: string } | null,
): AssetBundle | null {
	if (entity.isPublished !== true) return null;

	const assets: BundleAsset[] = latestByPath(rows).map((row) => ({
		path: row.path,
		type: row.type,
		content: row.content,
		sha256: sha256Hex(row.content),
		bytes: Buffer.byteLength(row.content, "utf8"),
	}));
	if (assets.some((asset) => asset.path === REQUIRED_BUNDLE_PATH) === false) return null;

	const bundle: AssetBundle = {
		entityId: entity.id,
		name: entity.name,
		websiteUrl: entity.websiteUrl,
		keyId: signing?.keyId ?? null,
		bundleSha256: bundleHash(assets),
		assets,
	};
	if (signing?.keysUri !== undefined) bundle.keysUri = signing.keysUri;
	return bundle;
}

export function findAsset(bundle: AssetBundle, path: string): BundleAsset | null {
	return bundle.assets.find((asset) => asset.path === path) ?? null;
}

/**
 * Verifies that what a consumer is about to mount is exactly what was signed. Returns false for
 * any drift, which is how a re-serialized brand.json gets caught before it reaches a website.
 */
export function assetMatches(asset: BundleAsset, content: string): boolean {
	return sha256Hex(content) === asset.sha256;
}
