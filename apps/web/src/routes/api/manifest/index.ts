/**
 * /api/manifest - Dynamic Web App Manifest
 *
 * Generates a manifest.json tailored to the current deployment mode:
 *   - Whitelabel: single 128×128 icon from the configured icon URL
 *   - Local/Demo (Getcito): static SVG icons committed to public/icons/
 *
 * Branding values (name, theme color, etc.) are read from server config
 * so they stay in sync with the rest of the app.
 */
import { createFileRoute } from "@tanstack/react-router";
import {
	DEFAULT_APP_ICON,
	DEFAULT_APP_LOCKUP,
	DEFAULT_APP_NAME,
	Getcito_BACKGROUND_COLOR,
	Getcito_THEME_COLOR,
} from "@workspace/config/constants";
import { getDeployment } from "@/lib/config/server";

interface ManifestIcon {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}

function buildManifest(): object {
	const deployment = getDeployment();
	const { branding } = deployment;
	const hasCustomIcon = branding.icon !== DEFAULT_APP_ICON;

	let icons: ManifestIcon[];

	if (hasCustomIcon) {
		icons = [
			{
				src: branding.icon,
				sizes: "128x128",
				type: "image/png",
			},
		];
	} else {
		icons = [
			{
				src: "/icons/beaos-icon.svg",
				sizes: "any",
				type: "image/svg+xml",
			},
			{
				src: "/icons/beaos-icon.svg",
				sizes: "any",
				type: "image/svg+xml",
				purpose: "maskable",
			},
		];
	}

	const themeColor = hasCustomIcon ? "#000000" : Getcito_THEME_COLOR;
	// El nombre de la app instalada sigue la misma regla que el título de la pestaña: donde la marca
	// no se puede dibujar, se escribe. `short_name` queda corto porque es la etiqueta del ícono.
	const appName = branding.name === DEFAULT_APP_NAME ? DEFAULT_APP_LOCKUP : branding.name;

	return {
		short_name: branding.name,
		name: `${appName} - AI Search Optimization`,
		icons,
		start_url: ".",
		display: "standalone",
		theme_color: themeColor,
		background_color: Getcito_BACKGROUND_COLOR,
	};
}

export const Route = createFileRoute("/api/manifest/")({
	server: {
		handlers: {
			GET: () => {
				const manifest = buildManifest();
				return new Response(JSON.stringify(manifest, null, 2), {
					headers: {
						"Content-Type": "application/manifest+json",
						"Cache-Control": "public, max-age=3600",
					},
				});
			},
		},
	},
});
