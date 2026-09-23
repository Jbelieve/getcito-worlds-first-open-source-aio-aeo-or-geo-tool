import { generateKeyPairSync, verify as verifyBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
	buildKeysJson,
	decodeSigningMaterial,
	hasSigningKey,
	kidFromRawPublicKey,
	publicKeyRawFromSeed,
	signDetached,
	signingKeyInfo,
} from "./sign";

const originalKey = process.env.BELIEVE_SIGNING_KEY_ED25519;

afterEach(() => {
	if (originalKey === undefined) {
		delete process.env.BELIEVE_SIGNING_KEY_ED25519;
	} else {
		process.env.BELIEVE_SIGNING_KEY_ED25519 = originalKey;
	}
});

function newEd25519() {
	const { privateKey, publicKey } = generateKeyPairSync("ed25519");
	const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
	const rawPublic = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(-32);
	return { privateKey, publicKey, pkcs8, rawPublic };
}

describe("decodeSigningMaterial", () => {
	it("reads a 32-byte raw seed from base64 and hex", () => {
		const { privateKey } = newEd25519();
		const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }) as Buffer;
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

describe("signDetached", () => {
	it("signs the exact bytes with the key derived from PKCS#8 material", () => {
		const { pkcs8, publicKey, rawPublic } = newEd25519();
		process.env.BELIEVE_SIGNING_KEY_ED25519 = pkcs8.toString("base64");

		const body = JSON.stringify({ brand: { name: "Believe" } });
		const signature = signDetached(body);
		expect(signature).not.toBeNull();
		expect(signature?.alg).toBe("Ed25519");

		expect(verifyBytes(null, Buffer.from(body, "utf8"), publicKey, Buffer.from(signature?.value ?? "", "base64"))).toBe(true);
		// A signature is over the exact served bytes: one extra byte must break it.
		expect(verifyBytes(null, Buffer.from(`${body} `, "utf8"), publicKey, Buffer.from(signature?.value ?? "", "base64"))).toBe(
			false,
		);

		const info = signingKeyInfo();
		expect(info?.format).toBe("pkcs8");
		expect(info?.publicKeyB64).toBe(rawPublic.toString("base64"));
		expect(info?.kid).toBe(kidFromRawPublicKey(rawPublic));
		expect(publicKeyRawFromSeed(pkcs8.subarray(16)).equals(rawPublic)).toBe(true);
	});

	it("returns null when no signing key is configured", () => {
		delete process.env.BELIEVE_SIGNING_KEY_ED25519;
		expect(hasSigningKey()).toBe(false);
		expect(signDetached("{}")).toBeNull();
		expect(buildKeysJson()).toBeNull();
	});
});

describe("buildKeysJson", () => {
	it("publishes the spec fields an agent verifier looks for", () => {
		const { pkcs8, rawPublic } = newEd25519();
		process.env.BELIEVE_SIGNING_KEY_ED25519 = pkcs8.toString("base64");

		const keys = buildKeysJson("2026-07-11");
		expect(keys).not.toBeNull();
		const key = keys?.keys[0];
		expect(key).toMatchObject({
			key_id: "beaos-primary",
			kid: kidFromRawPublicKey(rawPublic),
			kty: "OKP",
			crv: "Ed25519",
			alg: "Ed25519",
			use: "sig",
			status: "active",
			created_at: "2026-07-11",
		});
		expect(Buffer.from(String(key?.public_key_b64), "base64")).toEqual(rawPublic);
		expect(key?.public_key).toBe(key?.public_key_b64);
		expect(key?.public_key_hex).toBe(rawPublic.toString("hex"));
	});
});
