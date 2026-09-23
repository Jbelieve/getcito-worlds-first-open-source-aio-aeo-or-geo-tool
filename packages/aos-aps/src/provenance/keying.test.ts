import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { findUmbrellaEntity, keysUriForWebsite, signingKeyForEntity } from "./keying";

function material(): string {
	const { privateKey } = generateKeyPairSync("ed25519");
	return (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64");
}

const hierarchy = [
	{ id: "believe", parentEntityId: null, websiteUrl: "https://believe-global.com" },
	{ id: "felix", parentEntityId: "believe", websiteUrl: "https://felix.com" },
	{ id: "pawers", parentEntityId: "believe", websiteUrl: "https://pawers.co" },
	{ id: "felix-linea", parentEntityId: "felix", websiteUrl: "https://felix.com/linea" },
];

describe("findUmbrellaEntity", () => {
	it("returns the root for a direct product and for a nested one", () => {
		expect(findUmbrellaEntity(hierarchy, "felix")?.id).toBe("believe");
		expect(findUmbrellaEntity(hierarchy, "felix-linea")?.id).toBe("believe");
	});

	it("returns the entity itself when it already is the umbrella", () => {
		expect(findUmbrellaEntity(hierarchy, "believe")?.id).toBe("believe");
	});

	it("refuses a broken chain instead of guessing a root", () => {
		expect(findUmbrellaEntity(hierarchy, "no-existe")).toBeNull();
		expect(findUmbrellaEntity([{ id: "huerfano", parentEntityId: "fantasma" }], "huerfano")).toBeNull();
	});

	it("refuses a cyclic hierarchy instead of looping", () => {
		const cyclic = [
			{ id: "a", parentEntityId: "b" },
			{ id: "b", parentEntityId: "a" },
		];
		expect(findUmbrellaEntity(cyclic, "a")).toBeNull();
	});
});

describe("keysUriForWebsite", () => {
	it("points at the umbrella well-known location", () => {
		expect(keysUriForWebsite("https://believe-global.com")).toBe("https://believe-global.com/.well-known/keys.json");
		expect(keysUriForWebsite("https://believe-global.com/algo")).toBe(
			"https://believe-global.com/.well-known/keys.json",
		);
	});

	it("returns undefined for missing or invalid input", () => {
		expect(keysUriForWebsite(null)).toBeUndefined();
		expect(keysUriForWebsite("")).toBeUndefined();
		expect(keysUriForWebsite("no-es-una-url")).toBeUndefined();
	});
});

describe("signingKeyForEntity", () => {
	it("signs a sub-brand with the umbrella key and the umbrella keys uri", () => {
		const env = { BELIEVE_SIGNING_KEY_ED25519: material(), BELIEVE_SIGNING_KEY_ID: "believe-2026-primary" };
		const forProduct = signingKeyForEntity(hierarchy, "felix", env);
		const forUmbrella = signingKeyForEntity(hierarchy, "believe", env);

		expect(forProduct?.keysUri).toBe("https://believe-global.com/.well-known/keys.json");
		expect(forProduct?.material).toBe(forUmbrella?.material);
		expect(forProduct?.keyId).toBe("believe-2026-primary");
		// The sub-brand's own site is never the issuer.
		expect(forProduct?.keysUri).not.toContain("felix.com");
	});

	it("returns null when there is no umbrella to inherit from", () => {
		const env = { BELIEVE_SIGNING_KEY_ED25519: material() };
		expect(signingKeyForEntity([{ id: "suelto", parentEntityId: "fantasma" }], "suelto", env)).toBeNull();
		expect(signingKeyForEntity(hierarchy, "felix", {})).toBeNull();
	});
});
