import { createHash, createPrivateKey, createPublicKey, sign as signBytes } from "node:crypto";

function decodeSeed(value: string): Buffer | null {
const raw = value.trim();
if (raw.length === 0) return null;
if (/^[0-9a-fA-F]{64}$/.test(raw)) return Buffer.from(raw, "hex");
try {
const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
const buf = Buffer.from(normalized, "base64");
return buf.length >= 32 ? buf.subarray(0, 32) : null;
} catch {
return null;
}
}

function seedBytes(): Buffer | null {
const raw = process.env.BELIEVE_SIGNING_KEY_ED25519;
if (raw === undefined || raw.length === 0) return null;
return decodeSeed(raw);
}

function privateKeyFromSeed(seed: Buffer) {
const pkcs8Prefix = Buffer.from("302e020100300506032b657004220420", "hex");
return createPrivateKey({
key: Buffer.concat([pkcs8Prefix, seed]),
format: "der",
type: "pkcs8",
});
}

function publicKeyInfo(): { kid: string; publicKeyHex: string; publicKeyB64: string } | null {
const seed = seedBytes();
if (seed === null) return null;
const publicKey = createPublicKey(privateKeyFromSeed(seed));
const spki = publicKey.export({ format: "der", type: "spki" });
const raw = Buffer.from(spki).subarray(-32);
const kid = createHash("sha256").update(raw).digest("hex").slice(0, 16);
return {
kid,
publicKeyHex: raw.toString("hex"),
publicKeyB64: raw.toString("base64"),
};
}

export function hasSigningKey(): boolean {
return publicKeyInfo() !== null;
}

export function signDetached(body: string): {
alg: "Ed25519";
kid: string;
value: string;
public_key_url: string;
note: string;
} | null {
const seed = seedBytes();
if (seed === null) return null;
const info = publicKeyInfo();
if (info === null) return null;
const signature = signBytes(null, Buffer.from(body, "utf8"), privateKeyFromSeed(seed));
return {
alg: "Ed25519",
kid: info.kid,
value: signature.toString("base64"),
public_key_url: "/.well-known/keys.json",
note: "Firma Ed25519 sobre los bytes exactos de este documento. Verificable por cualquier agente contra la clave publica en public_key_url.",
};
}

export function buildKeysJson(createdAt = new Date().toISOString().slice(0, 10)): { keys: Array<Record<string, string>> } | null {
const info = publicKeyInfo();
if (info === null) return null;
return {
keys: [
{
key_id: "beaos-primary",
algorithm: "Ed25519",
public_key: info.publicKeyB64,
public_key_hex: info.publicKeyHex,
kid: info.kid,
created_at: createdAt,
status: "active",
},
],
};
}
