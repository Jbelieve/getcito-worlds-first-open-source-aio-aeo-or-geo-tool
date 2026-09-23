/**
 * /api/v1/agent-assets/:entityId/raw?path=/.well-known/brand.json — one asset, byte for byte.
 *
 * The body is the exact content that was signed, with its sha256 in `x-content-sha256` so the
 * consumer can prove it wrote what it received. Used when a mount step wants a single file (or a
 * streaming write) instead of the whole manifest.
 *
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ApiError, createApiHandler } from "@/lib/api/handler";
import { loadAssetBundle } from "@/server/agent-bundle";

export const Route = createFileRoute("/api/v1/agent-assets/$entityId/raw")({
	server: {
		handlers: {
			GET: createApiHandler({
				handle: async ({ params, request }) => {
					const assetPath = new URL(request.url).searchParams.get("path");
					if (assetPath === null || assetPath.length === 0) {
						throw new ApiError(400, "Validation Error", "A ?path= query parameter is required.");
					}
					const bundle = await loadAssetBundle(params.entityId ?? "");
					if (bundle === null) {
						throw new ApiError(404, "Not Found", `No published asset bundle for entity "${params.entityId}".`);
					}
					const asset = bundle.assets.find((entry) => entry.path === assetPath);
					if (asset === undefined) {
						throw new ApiError(404, "Not Found", `Asset "${assetPath}" is not part of this bundle.`);
					}
					return new Response(asset.content, {
						status: 200,
						headers: {
							"content-type": asset.type,
							"x-content-sha256": asset.sha256,
							"x-bundle-sha256": bundle.bundleSha256,
						},
					});
				},
			}),
		},
	},
});
