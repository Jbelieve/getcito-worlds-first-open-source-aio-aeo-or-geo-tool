import { generateKeyPairSync } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { generateAgentAssets } from "../assets";
import type { SigningKey } from "../provenance";
import { verifyBrandSignature, verifyBrandSignatureDetailed } from "./signature";

/** A bundle as it would be published at the well-known paths. */
function bundle(signing: SigningKey): Record<string, string> {
	const assets = generateAgentAssets({ name: "Believe", websiteUrl: "https://believe-global.com", signing });
	const files: Record<string, string> = {};
	for (const asset of assets) files[asset.path] = asset.content;
	return files;
}

function newSigningKey(): SigningKey {
	const { privateKey } = generateKeyPairSync("ed25519");
	return {
		keyId: "believe-2026-primary",
		material: (privateKey.export({ format: "der", type: "pkcs8" }) as Buffer).toString("base64"),
	};
}

async function serve(files: Record<string, string>): Promise<{ base: URL; close: () => Promise<void> }> {
	const server: Server = createServer((request, response) => {
		const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
		const body = files[path];
		if (body === undefined) {
			response.writeHead(404, { "content-type": "text/plain" });
			response.end("not found");
			return;
		}
		response.writeHead(200, { "content-type": path.endsWith(".json") ? "application/json" : "text/plain" });
		response.end(body);
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		base: new URL(`http://127.0.0.1:${port}`),
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

/**
 * Pedido sin guardián, solo para el test.
 *
 * El servidor de la prueba escucha en `127.0.0.1`, y el guardián anti-SSRF —con razón— no deja pedir
 * la loopback. La salida no es relajar el guardián sino inyectar el pedido: estos tests prueban que la
 * firma Ed25519 verifique sobre los bytes servidos, no el guardián. El camino de producción sale por
 * `safeFetch`, y el guardián tiene sus propios tests.
 */
async function localFetchText(url: string, timeoutMs: number): Promise<string | null> {
	try {
		const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
		if (response.ok === false) return null;
		return await response.text();
	} catch {
		return null;
	}
}

const INJECTED = { fetchText: localFetchText };

describe("verifyBrandSignatureDetailed", () => {
	it("verifies the detached signature an agent would fetch", async () => {
		const { base, close } = await serve(bundle(newSigningKey()));
		try {
			const result = await verifyBrandSignatureDetailed(base, 2000, undefined, INJECTED);
			expect(result.valid).toBe(true);
			expect(result.reason).toBeNull();
			expect(result.kid).not.toBeNull();
			expect(await verifyBrandSignature(base, 2000, undefined, INJECTED)).toBe(true);
		} finally {
			await close();
		}
	});

	it("rejects bytes that were changed after signing", async () => {
		const files = bundle(newSigningKey());
		files["/.well-known/brand.json"] = `${files["/.well-known/brand.json"]} `;
		const { base, close } = await serve(files);
		try {
			const result = await verifyBrandSignatureDetailed(base, 2000, undefined, INJECTED);
			expect(result.valid).toBe(false);
			expect(result.reason).toBe("signature does not verify");
		} finally {
			await close();
		}
	});

	it("never falls back to a key whose kid does not match", async () => {
		const files = bundle(newSigningKey());
		const keys = JSON.parse(files["/.well-known/keys.json"]);
		keys.keys[0].kid = "0000000000000000";
		files["/.well-known/keys.json"] = JSON.stringify(keys);
		const { base, close } = await serve(files);
		try {
			const result = await verifyBrandSignatureDetailed(base, 2000, undefined, INJECTED);
			expect(result.valid).toBe(false);
			expect(result.reason).toBe("no published key matches kid");
		} finally {
			await close();
		}
	});

	it("reports missing provenance documents", async () => {
		const files = bundle(newSigningKey());
		delete files["/.well-known/brand.json.sig"];
		const { base, close } = await serve(files);
		try {
			expect((await verifyBrandSignatureDetailed(base, 2000, undefined, INJECTED)).reason).toBe(
				"brand.json.sig not served",
			);
		} finally {
			await close();
		}

		const withoutBrand = bundle(newSigningKey());
		delete withoutBrand["/.well-known/brand.json"];
		withoutBrand["/x"] = "";
		const second = await serve(withoutBrand);
		try {
			expect((await verifyBrandSignatureDetailed(second.base, 2000, undefined, INJECTED)).reason).toBe(
				"brand.json not served",
			);
		} finally {
			await second.close();
		}
	});
});
