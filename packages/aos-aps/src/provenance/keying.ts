/**
 * Key resolution for the provenance layer.
 *
 * Decision (Jorge, 2026-09): sub-brands inherit the canonical key of their umbrella brand.
 * A product entity never signs with a key of its own — the umbrella vouches for it, so the
 * profile of a sub-brand carries the umbrella `key_id` and points `key_ref.keys_uri` at the
 * umbrella's published keys.json.
 *
 * Private material stays in the vault. Today there is a single umbrella (Believe), so the key
 * arrives through the environment; the seam below is what a per-umbrella vault reference has to
 * plug into once BeAOS serves more than one umbrella.
 */

import { decodeSigningMaterial } from "./sign";

export interface SigningKey {
	/** Stable public identifier published in keys.json, e.g. believe-2026-primary. */
	keyId: string;
	/** Raw signing material exactly as stored in the vault. Never leaves the server. */
	material: string;
	/** Where an agent fetches the matching public key. */
	keysUri?: string;
}

export const DEFAULT_SIGNING_KEY_ID = "believe-2026-primary";
export const SIGNING_KEY_ENV_VAR = "BELIEVE_SIGNING_KEY_ED25519";
export const SIGNING_KEY_ID_ENV_VAR = "BELIEVE_SIGNING_KEY_ID";

/**
 * Reads the umbrella signing key from the environment. Returns null when the variable is
 * absent or holds material we cannot interpret, so the caller emits no signature instead of a
 * signature nobody can verify.
 */
export function signingKeyFromEnv(
	env: Record<string, string | undefined> = process.env,
	keysUri?: string,
): SigningKey | null {
	const material = env[SIGNING_KEY_ENV_VAR]?.trim();
	if (material === undefined || material.length === 0) return null;
	if (decodeSigningMaterial(material) === null) return null;
	const keyId = env[SIGNING_KEY_ID_ENV_VAR]?.trim();
	const key: SigningKey = { keyId: keyId !== undefined && keyId.length > 0 ? keyId : DEFAULT_SIGNING_KEY_ID, material };
	if (keysUri !== undefined) key.keysUri = keysUri;
	return key;
}

export interface EntityNode {
	id: string;
	/** null marks an umbrella: the root of an entity hierarchy. */
	parentEntityId: string | null;
}

/**
 * Walks up to the umbrella that owns an entity. The hierarchy is the one modelled by
 * agent_brand_entities: umbrella -> product -> product. Returns null when the chain is broken
 * (a parent that is not in the list), so a caller never signs with a guessed root.
 */
export function findUmbrellaEntity<T extends EntityNode>(entities: T[], entityId: string): T | null {
	const byId = new Map(entities.map((entity) => [entity.id, entity]));
	const seen = new Set<string>();
	let current = byId.get(entityId);
	if (current === undefined) return null;
	while (current.parentEntityId !== null) {
		if (seen.has(current.id)) return null; // cycle: refuse rather than loop
		seen.add(current.id);
		const parent = byId.get(current.parentEntityId);
		if (parent === undefined) return null; // broken chain
		current = parent;
	}
	return current;
}

/** The umbrella's canonical well-known location for keys.json, derived from its website. */
export function keysUriForWebsite(websiteUrl: string | null | undefined): string | undefined {
	if (typeof websiteUrl !== "string" || websiteUrl.trim().length === 0) return undefined;
	try {
		const url = new URL(websiteUrl);
		return `${url.protocol}//${url.host}/.well-known/keys.json`;
	} catch {
		return undefined;
	}
}

/**
 * Resolves the key that signs an entity's assets: always the umbrella's. `entityId` is the
 * entity being published, `entities` the full hierarchy of its brand.
 */
export function signingKeyForEntity<T extends EntityNode>(
	entities: T[],
	entityId: string,
	env: Record<string, string | undefined> = process.env,
): SigningKey | null {
	const umbrella = findUmbrellaEntity(entities, entityId);
	if (umbrella === null) return null;
	const websiteUrl = (umbrella as { websiteUrl?: string | null }).websiteUrl;
	return signingKeyFromEnv(env, keysUriForWebsite(websiteUrl));
}
