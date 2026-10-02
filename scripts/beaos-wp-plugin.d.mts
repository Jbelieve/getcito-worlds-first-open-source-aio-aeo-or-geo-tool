/**
 * Los tipos del contrato del plugin de WordPress de BeAOS (`beaos-wp-plugin.mjs`).
 *
 * El módulo es JavaScript plano porque lo cargan Node (el empaquetador y la configuración de Vite) y
 * Vitest tal cual se escribe; estos tipos existen para que TypeScript lo pueda importar sin `any` en la
 * configuración de Vite y en los tests.
 */

/** El slug del plugin: la carpeta de adentro del ZIP. */
export declare const WP_PLUGIN_SLUG: string;

/** El archivo de la cabecera, relativo a la raíz del repositorio. */
export declare const WP_PLUGIN_HEADER: string;

/** Los archivos que se instalan (los `.php` del plugin y el `README.md`). */
export declare const WP_PLUGIN_FILES: readonly string[];

/** La raíz del repositorio, resuelta desde la ubicación de `beaos-wp-plugin.mjs`. */
export declare function wpPluginRepoRoot(): string;

/** La versión declarada en la cabecera del plugin, leída del texto del archivo. */
export declare function parseWpPluginVersion(header: string): string;

/** La versión del plugin, leída de la cabecera del repositorio (o de `repoRoot`, para los tests). */
export declare function readWpPluginVersion(repoRoot?: string): string;

/** El nombre del ZIP versionado de la release. */
export declare function wpPluginZipName(version: string): string;
