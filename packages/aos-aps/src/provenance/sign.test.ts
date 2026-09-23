import { generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { signingKeyFromEnv } from "./keying";
import {
	buildKeysJson,
	decodeSigningMaterial,
	hasSigningKey,
	kidFromRawPublicKey,
	publicKeyRawFromSeed,
	signDetached,
	signingKeyInfo,
} from "./sign";

function newEd25519() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	const rawPublic = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
	return { privateKey, publicKey, pkcs8, rawPublic };
}

function keyFromEnvRecord(record: Record<string, string>): NonNullable<ReturnType<typeof signingKeyFromEnv>> {
	const key = signingKeyFromEnv(record);
	if (key === null) throw new Error("expected a signing key");
	return key;
}

describe("decodeSigningMaterial", () => {
	it("reads a 32-byte raw seed from base64 and hex", () => {
		const { pkcs8 } = newEd25519();
		const seed = pkcs8.subarray(16);

		expect(decodeSigningMaterial(seed.toString("base64"))).toEqual({ seed, format: "seed" });
		expect(decodeSigningMaterial(seed.toString("hex"))).toEqual({ seed, format: "seed" });
	});

	it("takes the seed from the tail of a 48-byte PKCS#8 blob", () => {
		const { pkcs8 } = newEd25519();
		expect(pkcs8.length).toBe(48);

		const decoded = decodeSigningMaterial(pkcs8.toString("base64"));
		expect(decoded?.format).toBe("pkcs8");
		expect(decoded?.seed.equals(pkcs8.subarray(16, 48))).toBe(true);
		// The previous implementation used the first 32 bytes, which silently derived a wrong key.
		expect(decoded?.seed.equals(pkcs8.subarray(0, 32))).toBe(false);
	});

	it("reads the seed from a 64-byte libsodium-style secret key", () => {
		const { pkcs8 } = newEd25519();
		const secretKey = Buffer.concat([pkcs8.subarray(16), Buffer.alloc(32, 7)]);
		expect(decodeSigningMaterial(secretKey.toString("base64"))).toEqual({
			seed: pkcs8.subarray(16),
			format: "secret_key",
		});
	});

	it("fails closed on material it cannot interpret", () => {
		expect(decodeSigningMaterial("")).toBeNull();
		expect(decodeSigningMaterial("   ")).toBeNull();
		expect(decodeSigningMaterial(Buffer.alloc(16, 1).toString("base64"))).toBeNull();
		expect(decodeSigningMaterial(Buffer.alloc(20, 1).toString("base64"))).toBeNull();
		// 48 bytes that are not a PKCS#8 Ed25519 blob must not be guessed at.
		expect(decodeSigningMaterial(Buffer.alloc(48, 3).toString("base64"))).toBeNull();
	});
});

describe("signingKeyFromEnv", () => {
	it("defaults the key id to the umbrella key and accepts overrides", () => {
		const { pkcs8 } = newEd25519();
		const material = pkcs8.toString("base64");

		expect(signingKeyFromEnv({ BELIEVE_SIGNING_KEY_ED25519: material })).toEqual({
			keyId: "believe-2026-primary",
			material,
		});
		expect(signingKeyFromEnv({ BELIEVE_SIGNING_KEY_ED25519: material, BELIEVE_SIGNING_KEY_ID: "otra-marca" })).toEqual({
			keyId: "otra-marca",
			material,
		});
	});

	it("carries the umbrella keys uri when given", () => {
		const { pkcs8 } = newEd25519();
		const key = signingKeyFromEnv(
			{ BELIEVE_SIGNING_KEY_ED25519: pkcs8.toString("base64") },
			"https://believe-global.com/.well-known/keys.json",
		);
		expect(key?.keysUri).toBe("https://believe-global.com/.well-known/keys.json");
	});

	it("returns null when the variable is absent or unusable", () => {
		expect(signingKeyFromEnv({})).toBeNull();
		expect(signingKeyFromEnv({ BELIEVE_SIGNING_KEY_ED25519: "   " })).toBeNull();
		expect(signingKeyFromEnv({ BELIEVE_SIGNING_KEY_ED25519: Buffer.alloc(48, 3).toString("base64") })).toBeNull();
	});
});

describe("signDetached", () => {
	it("signs the exact bytes with the key derived from PKCS#8 material", () => {
		const { pkcs8, publicKey, rawPublic } = newEd25519();
		const key = keyFromEnvRecord({ BELIEVE_SIGNING_KEY_ED25519: pkcs8.toString("base64") });

		const body = JSON.stringify({ brand: { name: "Believe" } });
		const signature = signDetached(body, key);
		expect(signature).not.toBeNull();
		expect(signature?.alg).toBe("Ed25519");
		expect(signature?.public_key_url).toBe("/.well-known/keys.json");

		expect(verifyBytes(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(signature?.value ?? "", "base64"))).toBe(
			true,
		);
		// A signature is over the exact served bytes: one extra byte must break it.
		expect(
			verifyBytes(null, Buffer.from(`${body} `, "utf8"), publicKey, Buffer.from(signature?.value ?? "", "base64")),
		).toBe(false);

		const info = signingKeyInfo(key);
		expect(info?.format).toBe("pkcs8");
		expect(info?.keyId).toBe("believe-2026-primary");
		expect(info?.publicKeyB64).toBe(rawPublic.toString("base64"));
		expect(info?.kid).toBe(kidFromRawPublicKey(rawPublic));
		expect(publicKeyRawFromSeed(pkcs8.subarray(16)).equals(rawPublic)).toBe(true);
	});

	it("points the signature at the umbrella keys uri so a sub-brand verifies against the umbrella", () => {
		const { pkcs8 } = newEd25519();
		const key = keyFromEnvRecord({ BELIEVE_SIGNING_KEY_ED25519: pkcs8.toString("base64") });
		const withUri = { ...key, keysUri: "https://believe-global.com/.well-known/keys.json" };
		expect(signDetached("{}", withUri)?.public_key_url).toBe("https://believe-global.com/.well-known/keys.json");
	});

	it("returns null when no signing key is configured", () => {
		expect(hasSigningKey(null)).toBe(false);
		const unusable = { keyId: "x", material: Buffer.alloc(48, 3).toString("base64") };
		expect(hasSigningKey(unusable)).toBe(false);
		expect(signDetached("{}", unusable)).toBeNull();
		expect(buildKeysJson(unusable)).toBeNull();
	});
});

describe("buildKeysJson", () => {
	it("publishes the umbrella key id and the field names agents already read", () => {
		const { pkcs8, rawPublic } = newEd25519();
		const key = keyFromEnvRecord({ BELIEVE_SIGNING_KEY_ED25519: pkcs8.toString("base64") });

		const keys = buildKeysJson(key, "2026-07-11");
		expect(keys).not.toBeNull();
		const entry = keys?.keys[0];
		expect(entry).toMatchObject({
			key_id: "believe-2026-primary",
			kid: kidFromRawPublicKey(rawPublic),
			kty: "OKP",
			crv: "Ed25519",
			alg: "Ed25519",
			algorithm: "Ed25519",
			use: "sig",
			status: "active",
			created_at: "2026-07-11",
		});
		expect(Buffer.from(String(entry?.public_key_b64), "base64")).toEqual(rawPublic);
		expect(entry?.public_key).toBe(entry?.public_key_b64);
		expect(entry?.public_key_hex).toBe(rawPublic.toString("hex"));
	});
});
