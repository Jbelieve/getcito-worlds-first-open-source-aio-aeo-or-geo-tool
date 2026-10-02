/**
 * The publishable asset bundle: what a delivery agent (Maasy MCP -> the brand's be agent) receives
 * and mounts on a site.
 *
 * Three invariants:
 *   1. Closed by default. An entity that is not explicitly published produces no bundle, and an
 *      entity with no brand.json is not publishable — there is nothing for an agent to verify.
 *   2. Byte-exact delivery. The Ed25519 signature covers the exact bytes of brand.json, so the
 *      bundle carries the content verbatim plus its sha256. A consumer that re-serializes the JSON
 *      breaks the signature; the hash is there to catch that before the file reaches a website.
 *   3. Only kit-shaped routes leave. `agent_assets.path` had no `CHECK` and this function copied every
 *      row into the bundle, so a row inserted by a refactor, a seed, an import or a manual `INSERT`
 *      reached the client's website — `/wp-login.php` there means **covering the login screen**. The
 *      shape guard runs here, on the way out, which is the side that protects every integrator even
 *      when the database is already dirty.
 */

import { createHash } from "node:crypto";
import { isKitRoute, kitRouteRejectionReason } from "../assets/kit-routes";

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
	/** Whether the bundle carries a detached signature an agent can verify. */
	signed: boolean;
	/** Published key id an agent must see in keys.json, e.g. believe-2026-primary. */
	keyId: string | null;
	/** Stable hash of the public key that signed these bytes. */
	kid: string | null;
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
export const KEYS_PATH = "/.well-known/keys.json";
export const SIGNATURE_PATH = "/.well-known/brand.json.sig";

export interface SigningIdentity {
	signed: boolean;
	/** Human-readable key id as published in keys.json, e.g. believe-2026-primary. */
	keyId: string | null;
	/** Stable hash of the public key, as published in keys.json and carried by the signature. */
	kid: string | null;
	/** Where the matching public key lives, taken from the signature itself. */
	keysUri: string | null;
}

function parseJson(content: string): Record<string, unknown> | null {
	try {
		const parsed = JSON.parse(content);
		return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
	} catch {
		return null;
	}
}

/**
 * Reads the signing identity out of the bundle's own artifacts instead of the current environment:
 * keys.json carries key_id and kid, brand.json.sig carries public_key_url. Deriving it from config
 * would let the manifest claim a key that did not sign these bytes.
 */
export function signingIdentityFromAssets(assets: BundleAsset[]): SigningIdentity {
	const identity: SigningIdentity = { signed: false, keyId: null, kid: null, keysUri: null };

	const keysAsset = assets.find((asset) => asset.path === KEYS_PATH);
	if (keysAsset !== undefined) {
		const keys = parseJson(keysAsset.content)?.keys;
		const first = Array.isArray(keys) ? (keys[0] as Record<string, unknown> | undefined) : undefined;
		if (first !== undefined) {
			if (typeof first.key_id === "string") identity.keyId = first.key_id;
			if (typeof first.kid === "string") identity.kid = first.kid;
		}
	}

	const signatureAsset = assets.find((asset) => asset.path === SIGNATURE_PATH);
	if (signatureAsset !== undefined) {
		const signature = parseJson(signatureAsset.content);
		identity.signed = signature !== null && typeof signature.value === "string";
		if (typeof signature?.public_key_url === "string") identity.keysUri = signature.public_key_url;
		if (identity.kid === null && typeof signature?.kid === "string") identity.kid = signature.kid;
	}

	return identity;
}

/**
 * Las rutas de las filas que la guarda de forma ya **no** acepta: la última versión de cada una, con su
 * motivo. Debería ser siempre vacío; no lo es cuando la base quedó con basura (una versión vieja del
 * generador, un seed, un `INSERT` a mano).
 *
 * Se expone aparte de `buildBundle()` por dos razones: se puede probar sin armar un bundle, y un
 * llamador que quiera contarlas no tiene que adivinar qué se descartó. El bundle no las lleva.
 */
export function rejectedAssetRows(rows: AssetRow[]): Array<{ path: string; reason: string }> {
	const out: Array<{ path: string; reason: string }> = [];
	for (const row of latestByPath(rows)) {
		if (isKitRoute(row.path) === false) out.push({ path: row.path, reason: kitRouteRejectionReason(row.path) });
	}
	return out;
}

/**
 * Builds the bundle a delivery agent may mount. Returns null when the entity is not published or
 * when the required brand.json is missing: the caller answers 404, never a partial bundle.
 *
 * Una ruta que no tiene forma de kit **no sale**, y tampoco desaparece en silencio: se anota en el log
 * del servidor con su motivo. Del lado de BeAOS una ruta así es un bug nuestro, no un dato del cliente,
 * y el log es lo que hace que alguien se entere. Se emite **una** línea por bundle (con todas las rutas
 * malas juntas) y no una por ruta: la primera es un grito, la segunda inunda el log de un endpoint que
 * se pide en cada request.
 *
 * Una ruta mala **no** tumba el bundle: tirarlo entero por una fila envenenada cambiaría un bug de una
 * ruta por una caída del kit completo, que es peor. El resto del kit se sigue sirviendo.
 */
export function buildBundle(entity: BundleSource, rows: AssetRow[]): AssetBundle | null {
	if (entity.isPublished !== true) return null;

	const malas = rejectedAssetRows(rows);
	if (malas.length > 0) {
		console.error(
			`[aos-aps] ${malas.length} ruta(s) de agent_assets con forma que el kit no acepta y que NO se sirven (bug nuestro, revisar la base): ` +
				malas.map((mala) => `${mala.path} (${mala.reason})`).join(", "),
		);
	}

	const assets: BundleAsset[] = latestByPath(rows)
		.filter((row) => isKitRoute(row.path))
		.map((row) => ({
			path: row.path,
			type: row.type,
			content: row.content,
			sha256: sha256Hex(row.content),
			bytes: Buffer.byteLength(row.content, "utf8"),
		}));
	if (assets.some((asset) => asset.path === REQUIRED_BUNDLE_PATH) === false) return null;

	const identity = signingIdentityFromAssets(assets);
	const bundle: AssetBundle = {
		entityId: entity.id,
		name: entity.name,
		websiteUrl: entity.websiteUrl,
		signed: identity.signed,
		keyId: identity.keyId,
		kid: identity.kid,
		bundleSha256: bundleHash(assets),
		assets,
	};
	if (identity.keysUri !== null) bundle.keysUri = identity.keysUri;
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
