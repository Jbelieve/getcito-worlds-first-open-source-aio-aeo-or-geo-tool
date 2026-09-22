import { createPublicKey, verify as verifySignature } from "node:crypto";

const USER_AGENT = "BeAOS-AOS-Audit/0.1 (+https://beaos.believe-global.com)";

async function fetchText(url: string, timeoutMs: number): Promise<string | null> {
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), timeoutMs);
try {
const response = await fetch(url, {
redirect: "follow",
signal: controller.signal,
headers: { "user-agent": USER_AGENT, accept: "*/*" },
});
if (response.ok === false) return null;
return await response.text();
} catch {
return null;
} finally {
clearTimeout(timer);
}
}

interface SignatureFile {
value?: unknown;
kid?: unknown;
}

interface KeyFile {
keys?: Array<Record<string, unknown>>;
}

function publicKeyValue(entry: Record<string, unknown>): string {
const candidates = [entry.public_key, entry.public_key_b64, entry.public_key_hex];
for (const candidate of candidates) {
if (typeof candidate === "string" && candidate.length > 0) return candidate;
}
return "";
}

export async function verifyBrandSignature(base: URL, timeoutMs: number): Promise<boolean> {
const brandBody = await fetchText(new URL("/.well-known/brand.json", base).toString(), timeoutMs);
if (brandBody === null || brandBody.length === 0) return false;

const signatureBody = await fetchText(new URL("/.well-known/brand.json.sig", base).toString(), timeoutMs);
if (signatureBody === null || signatureBody.length === 0) return false;

const keysBody = await fetchText(new URL("/.well-known/keys.json", base).toString(), timeoutMs);
if (keysBody === null || keysBody.length === 0) return false;

try {
const signatureJson = JSON.parse(signatureBody) as SignatureFile;
const signatureValue = typeof signatureJson.value === "string" ? signatureJson.value.trim() : "";
if (signatureValue.length === 0) return false;

const keysJson = JSON.parse(keysBody) as KeyFile;
const keys = Array.isArray(keysJson.keys) ? keysJson.keys : [];
const kid = typeof signatureJson.kid === "string" ? signatureJson.kid : undefined;
const selected = kid === undefined ? keys[0] : keys.find((entry) => entry.kid === kid) ?? keys[0];
if (selected === undefined) return false;

const rawKey = publicKeyValue(selected);
if (rawKey.length === 0) return false;
const publicKeyBytes = /^[0-9a-fA-F]{64}$/.test(rawKey)
? Buffer.from(rawKey, "hex")
: Buffer.from(rawKey.replace(/-/g, "+").replace(/_/g, "/"), "base64");
if (publicKeyBytes.length !== 32) return false;

const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
const publicKey = createPublicKey({
key: Buffer.concat([spkiPrefix, publicKeyBytes]),
format: "der",
type: "spki",
});
return verifySignature(null, Buffer.from(brandBody, "utf8"), publicKey, Buffer.from(signatureValue, "base64"));
} catch {
return false;
}
}
