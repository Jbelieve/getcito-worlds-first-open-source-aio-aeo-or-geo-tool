import { createHash, createPrivateKey, createPublicKey, sign as signBytes } from "node:crypto";
import type { SigningKey } from "./keying";

/**
 * Ed25519 signing for the AOS/APS provenance layer.
 * Spec: aos-aps-standard spec/signing.md
 *
 * The private key never leaves the signer; only the public key is published at /.well-known/keys.json.
 * Key material and the published key id arrive as an explicit SigningKey so that sub-brands can be
 * signed with their umbrella's key (see ./keying.ts).
 */

/** PKCS#8 DER prefix for an Ed25519 private key: the 32-byte seed is the tail. */
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
/** SPKI DER prefix for an Ed25519 public key: the 32-byte raw key is the tail. */
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type SigningMaterialFormat = "seed" | "pkcs8" | "secret_key";

export interface SigningMaterial {
	seed: Buffer;
	format: SigningMaterialFormat;
}

/**
 * Accepts the signing material in the shapes an operator can realistically put in a vault:
 *   - 32-byte raw seed (hex or base64),
 *   - 48-byte PKCS#8 DER (Ed25519 private key blob),
 *   - 64-byte libsodium-style secret key (seed || public key) — only the seed is used.
 *
 * Unrecognized lengths fail closed: deriving a key from the wrong 32 bytes would silently
 * produce signatures that never verify against the published key.
 */
export function decodeSigningMaterial(value: string): SigningMaterial | null {
	const raw = value.trim();
	if (raw.length === 0) return null;
	if (/^[0-9a-fA-F]{64}$/.test(raw)) return { seed: Buffer.from(raw, "hex"), format: "seed" };

	const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
	const buf = Buffer.from(normalized, "base64");
	if (buf.length === 32) return { seed: buf, format: "seed" };
	if (buf.length === 48) {
		if (buf.subarray(0, 16).equals(PKCS8_ED25519_PREFIX)) {
			return { seed: buf.subarray(16, 48), format: "pkcs8" };
		}
		return null;
	}
	if (buf.length === 64) return { seed: buf.subarray(0, 32), format: "secret_key" };
	return null;
}

export function privateKeyFromSeed(seed: Buffer) {
	return createPrivateKey({
		key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]),
		format: "der",
		type: "pkcs8",
	});
}

export function publicKeyRawFromSeed(seed: Buffer): Buffer {
	const publicKey = createPublicKey(privateKeyFromSeed(seed));
	const spki = publicKey.export({ format: "der", type: "spki" });
	return Buffer.from(spki).subarray(SPKI_ED25519_PREFIX.length);
}

/** kid is a stable hash of the public key (spec/signing.md). */
export function kidFromRawPublicKey(raw: Buffer): string {
	return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export interface SigningKeyInfo {
	keyId: string;
	kid: string;
	publicKeyHex: string;
	publicKeyB64: string;
	format: SigningMaterialFormat;
}

export function signingKeyInfo(key: SigningKey): SigningKeyInfo | null {
	const material = decodeSigningMaterial(key.material);
	if (material === null) return null;
	const raw = publicKeyRawFromSeed(material.seed);
	return {
		keyId: key.keyId,
		kid: kidFromRawPublicKey(raw),
		publicKeyHex: raw.toString("hex"),
		publicKeyB64: raw.toString("base64"),
		format: material.format,
	};
}

export function hasSigningKey(key: SigningKey | null): boolean {
	return key !== null && decodeSigningMaterial(key.material) !== null;
}

export interface DetachedSignature {
	alg: "Ed25519";
	kid: string;
	value: string;
	public_key_url: string;
	note: string;
}

export function signDetached(body: string, key: SigningKey): DetachedSignature | null {
	const material = decodeSigningMaterial(key.material);
	if (material === null) return null;
	const info = signingKeyInfo(key);
	if (info === null) return null;
	const signature = signBytes(null, Buffer.from(body, "utf8"), privateKeyFromSeed(material.seed));
	return {
		alg: "Ed25519",
		kid: info.kid,
		value: signature.toString("base64"),
		public_key_url: key.keysUri ?? "/.well-known/keys.json",
		note: "Firma Ed25519 sobre los bytes exactos de este documento. Verificable por cualquier agente contra la clave publica en public_key_url.",
	};
}

export interface KeysJson {
	keys: Array<Record<string, string>>;
}

/**
 * `/.well-known/keys.json` in the shape spec/signing.md publishes, plus the field names already
 * live at believe-global.com (`public_key`, `algorithm`). `key_id` is the umbrella's, so a
 * sub-brand publishes the same identity its umbrella signs with.
 */
export function buildKeysJson(key: SigningKey, createdAt = new Date().toISOString().slice(0, 10)): KeysJson | null {
	const info = signingKeyInfo(key);
	if (info === null) return null;
	return {
		keys: [
			{
				key_id: info.keyId,
				kid: info.kid,
				kty: "OKP",
				crv: "Ed25519",
				alg: "Ed25519",
				algorithm: "Ed25519",
				use: "sig",
				public_key_b64: info.publicKeyB64,
				public_key_hex: info.publicKeyHex,
				public_key: info.publicKeyB64,
				created_at: createdAt,
				status: "active",
			},
		],
	};
}
