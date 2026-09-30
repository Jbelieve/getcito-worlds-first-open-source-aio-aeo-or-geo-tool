import { createPublicKey, verify as verifySignature } from "node:crypto";
import { safeFetch } from "./guarded-http";
import type { LookupFn } from "./ssrf";

/**
 * Agent-side verification of /.well-known/brand.json. Spec: aos-aps-standard spec/signing.md
 *
 *   sig   = fetch(/.well-known/brand.json.sig)
 *   body  = fetch(/.well-known/brand.json)          # exact bytes
 *   pub   = fetch(sig.public_key_url).keys[kid == sig.kid].public_key
 *   valid = Ed25519.verify(sig.value, body, pub)
 *
 * Los pedidos son al mismo origen que ya validó el guardián, pero salen por `safeFetch` y no por el
 * `fetch` global: un 302 de `/.well-known/keys.json` a `http://169.254.169.254/` es un SSRF con la URL
 * destino elegida por el sitio auditado, y con el `fetch` global entraba sin validación.
 * (El `public_key_url` del spec no se sigue a propósito: la clave se busca en el `keys.json` del mismo
 * origen, así que la firma nunca puede mandarnos a buscar una clave a otro lado.)
 */

const USER_AGENT = "BeAOS-AOS-Audit/0.1 (+https://beaos.believe-global.com)";
const SPKI_ED25519_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Firmas y opciones de la verificación.
 *
 * `lookup` es el resolutor inyectable de los tests. `fetchText` existe por una razón concreta: estas
 * pruebas levantan un servidor en `127.0.0.1`, y el guardián —con razón— no deja pedir la loopback.
 * El guardián no se relaja para el test: se inyecta el pedido, y el test sigue probando lo que tiene
 * que probar (que la firma Ed25519 verifique sobre los bytes servidos), no el guardián.
 */
export interface SignatureVerifyOptions {
	lookup?: LookupFn;
	fetchText?: (url: string, timeoutMs: number, lookup?: LookupFn) => Promise<string | null>;
}

/** Sale por el guardián: conexión a la IP validada, y cada redirect revalidado. */
async function fetchText(url: string, timeoutMs: number, lookup?: LookupFn): Promise<string | null> {
	try {
		const response = await safeFetch(url, {
			timeoutMs,
			followRedirects: true,
			lookup,
			headers: { "user-agent": USER_AGENT, accept: "*/*" },
		});
		if (response.ok === false) return null;
		return response.text();
	} catch {
		return null;
	}
}

interface SignatureFile {
	value?: unknown;
	kid?: unknown;
	public_key_url?: unknown;
}

interface KeyFile {
	keys?: Array<Record<string, unknown>>;
}

function publicKeyValue(entry: Record<string, unknown>): string {
	const candidates = [entry.public_key_b64, entry.public_key, entry.public_key_hex];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.length > 0) return candidate;
	}
	return "";
}

function rawPublicKeyBytes(value: string): Buffer | null {
	if (/^[0-9a-fA-F]{64}$/.test(value)) return Buffer.from(value, "hex");
	const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
	const bytes = Buffer.from(normalized, "base64");
	return bytes.length === 32 ? bytes : null;
}

export interface SignatureVerification {
	valid: boolean;
	kid: string | null;
	reason: string | null;
}

/**
 * Verifies the detached signature. `brandBody` is the exact served text of brand.json when the
 * caller already fetched it: re-fetching could verify different bytes than the ones reported.
 *
 * `lookup` es el resolutor inyectable de los tests: la clave del arreglo anti-rebinding es que la
 * validación y la conexión usen el mismo, y que la conexión vaya a la IP validada.
 */
export async function verifyBrandSignatureDetailed(
	base: URL,
	timeoutMs: number,
	brandBody?: string,
	options: SignatureVerifyOptions = {},
): Promise<SignatureVerification> {
	const fetchFile = options.fetchText ?? fetchText;
	const body =
		brandBody ?? (await fetchFile(new URL("/.well-known/brand.json", base).toString(), timeoutMs, options.lookup));
	if (body === null || body.length === 0) return { valid: false, kid: null, reason: "brand.json not served" };

	const signatureBody = await fetchFile(
		new URL("/.well-known/brand.json.sig", base).toString(),
		timeoutMs,
		options.lookup,
	);
	if (signatureBody === null || signatureBody.length === 0) {
		return { valid: false, kid: null, reason: "brand.json.sig not served" };
	}

	const keysBody = await fetchFile(new URL("/.well-known/keys.json", base).toString(), timeoutMs, options.lookup);
	if (keysBody === null || keysBody.length === 0) return { valid: false, kid: null, reason: "keys.json not served" };

	try {
		const signatureJson = JSON.parse(signatureBody) as SignatureFile;
		const signatureValue = typeof signatureJson.value === "string" ? signatureJson.value.trim() : "";
		if (signatureValue.length === 0) return { valid: false, kid: null, reason: "signature value is empty" };

		const keysJson = JSON.parse(keysBody) as KeyFile;
		const keys = Array.isArray(keysJson.keys) ? keysJson.keys : [];
		if (keys.length === 0) return { valid: false, kid: null, reason: "keys.json has no keys" };

		const kid = typeof signatureJson.kid === "string" ? signatureJson.kid : undefined;
		// A signature whose kid matches no published key cannot be attributed: never fall back
		// to an unrelated key, or a rotated/retired signature would read as valid.
		const selected = kid === undefined ? keys[0] : keys.find((entry) => entry.kid === kid);
		if (selected === undefined) return { valid: false, kid: kid ?? null, reason: "no published key matches kid" };

		const rawKey = publicKeyValue(selected);
		const publicKeyBytes = rawPublicKeyBytes(rawKey);
		if (publicKeyBytes === null) return { valid: false, kid: kid ?? null, reason: "public key is not 32 raw bytes" };

		const publicKey = createPublicKey({
			key: Buffer.concat([SPKI_ED25519_PREFIX, publicKeyBytes]),
			format: "der",
			type: "spki",
		});
		const signature = Buffer.from(signatureValue, "base64");
		const valid = signature.length === 64 && verifySignature(null, Buffer.from(body, "utf8"), publicKey, signature);
		return { valid, kid: kid ?? null, reason: valid ? null : "signature does not verify" };
	} catch {
		return { valid: false, kid: null, reason: "malformed signature or keys document" };
	}
}

export async function verifyBrandSignature(
	base: URL,
	timeoutMs: number,
	brandBody?: string,
	options: SignatureVerifyOptions = {},
): Promise<boolean> {
	const result = await verifyBrandSignatureDetailed(base, timeoutMs, brandBody, options);
	return result.valid;
}
