import path from "node:path";
import { fileURLToPath } from "node:url";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import { defineConfig } from "vitest/config";
import { readWpPluginVersion } from "../../scripts/beaos-wp-plugin.mjs";
import pkg from "./package.json" with { type: "json" };

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version),
		// La misma definición que `vite.config.ts`, de la misma fuente: la cabecera del plugin.
		__BEAOS_PLUGIN_VERSION__: JSON.stringify(readWpPluginVersion()),
	},
	resolve: {
		alias: {
			"@/": `${path.resolve(dirname, "./src")}/`,
		},
	},
	test: {
		projects: [
			{
				extends: true,
				test: {
					name: "unit",
					include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
				},
			},
			{
				extends: true,
				plugins: [storybookTest({ configDir: path.join(dirname, ".storybook") })],
				test: {
					name: "storybook",
					browser: {
						enabled: true,
						headless: true,
						provider: playwright({}),
						instances: [{ browser: "chromium" }],
					},
				},
			},
		],
	},
});
