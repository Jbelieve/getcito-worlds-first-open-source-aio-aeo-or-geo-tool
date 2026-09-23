/**
 * /api/v1/agent-assets/:entityId — the bundle a delivery agent may mount.
 *
 * GET returns every asset with its exact bytes, its sha256 and the signing identity read from the
 * signed artifacts themselves. Maasy wraps this in its MCP gateway and the brand's be agent mounts
 * the files on its own site; nothing here may be re-serialized, or the Ed25519 signature breaks.
 *
 * Answers 404 while the entity is unpublished: the gate is closed by default.
 *
 * Protected by API key authentication.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { ApiError, createApiHandler } from "@/lib/api/handler";
import { loadAssetBundle } from "@/server/agent-bundle";

export const Route = createFileRoute("/api/v1/agent-assets/$entityId")({
	server: {
		handlers: {
			GET: createApiHandler({
				params: z.object({ entityId: z.string().uuid() }),
				handle: async ({ params }) => {
					const bundle = await loadAssetBundle(params.entityId);
					if (bundle === null) {
						throw new ApiError(404, "Not Found", `No published asset bundle for entity "${params.entityId}".`);
					}
					return bundle;
				},
			}),
		},
	},
});
