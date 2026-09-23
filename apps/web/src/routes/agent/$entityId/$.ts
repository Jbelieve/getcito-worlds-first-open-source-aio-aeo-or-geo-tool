/**
 * Public agent surface: /agent/:entityId/* serves a published entity's asset bundle exactly as it
 * was signed, so an agent can read brand.json and verify it without talking to BeAOS's API.
 *
 * Used for brands that cannot mount files on their own domain (or while they wire a rewrite to
 * this origin). The asset path is taken from the URL suffix, which keeps the canonical
 * `/.well-known/...` shape without fighting the router's dot-segment syntax.
 *
 * Closed by default: an unpublished entity answers 404, and so does a missing brand.json.
 */
import { createFileRoute } from "@tanstack/react-router";
import { loadAssetBundle } from "@/server/agent-bundle";

function contentTypeFor(type: string): string {
	if (type.startsWith("text/") && type.includes("charset") === false) return `${type}; charset=utf-8`;
	return type;
}

export const Route = createFileRoute("/agent/$entityId/$")({
	server: {
		handlers: {
			GET: async ({ request, params }: { request: Request; params: Record<string, string> }) => {
				const entityId = params.entityId ?? "";
				const bundle = await loadAssetBundle(entityId);
				if (bundle === null) {
					return new Response("Not found\n", {
						status: 404,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}

				const prefix = `/agent/${entityId}`;
				const suffix = new URL(request.url).pathname.slice(prefix.length);
				const assetPath = decodeURIComponent(suffix);

				// An empty suffix is the index: what this entity publishes, and the hash of each file.
				if (assetPath.length === 0 || assetPath === "/") {
					return Response.json(
						{
							entityId: bundle.entityId,
							name: bundle.name,
							signed: bundle.signed,
							keyId: bundle.keyId,
							kid: bundle.kid,
							keysUri: bundle.keysUri ?? null,
							bundleSha256: bundle.bundleSha256,
							assets: bundle.assets.map((asset) => ({
								path: asset.path,
								type: asset.type,
								sha256: asset.sha256,
								bytes: asset.bytes,
							})),
						},
						{ headers: { "cache-control": "public, max-age=60" } },
					);
				}

				const asset = bundle.assets.find((entry) => entry.path === assetPath);
				if (asset === undefined) {
					return new Response("Not found\n", {
						status: 404,
						headers: { "content-type": "text/plain; charset=utf-8" },
					});
				}

				// Byte-exact: the same bytes the signature covers, with the hash for verification.
				return new Response(asset.content, {
					status: 200,
					headers: {
						"content-type": contentTypeFor(asset.type),
						"x-content-sha256": asset.sha256,
						"x-bundle-sha256": bundle.bundleSha256,
						"cache-control": "public, max-age=60",
					},
				});
			},
		},
	},
});
