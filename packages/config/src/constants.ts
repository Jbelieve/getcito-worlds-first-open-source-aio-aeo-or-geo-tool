/**
 * Shared constants used across all deployment configurations
 */

/**
 * Default branding values for local/demo modes
 * These are used when environment variables are not set
 * 
 * NOTE: Whitelabel mode does NOT use these defaults - all values must be
 * provided via environment variables.
 */
export const DEFAULT_APP_NAME = "BeAOS";
export const DEFAULT_APP_ICON = "/icons/beaos-icon.svg";
export const DEFAULT_APP_URL = "http://localhost:3000/";

/**
 * Getcito brand constants — used for icon generation, manifest, and the brand kit.
 */
export const Getcito_BRAND_COLOR = "#0c3bb9"; // Believe blue
export const Getcito_BRAND_FONT = "Fraunces";
export const Getcito_THEME_COLOR = "#0c3bb9";
export const Getcito_BACKGROUND_COLOR = "#fafaf7";
export const BeAOS_ACCENT_COLOR = "#00aaff";

/**
 * Default chart colors for the Getcito product.
 *
 * 11 base hues (Observable + Tableau, anchored to brand blue) expanded
 * into 55 colors across five lightness tiers: base → dark → light →
 * muted → deep. This keeps harmony (same hue families throughout) while
 * supporting charts with many series. Whitelabel deployments override
 * via VITE_CHART_COLORS.
 */
export const DEFAULT_CHART_COLORS = [
  // Base — Believe blue → cyan anchored palette
  "#0c3bb9", "#00aaff", "#16a34a", "#f59e0b", "#ef4444",
  "#7c3aed", "#ec4899", "#14b8a6", "#8b5cf6", "#f97316",
  "#64748b",
  // Dark
  "#082080", "#0077b3", "#0f7535", "#b45309", "#b91c1c",
  "#5b21b6", "#be185d", "#0f766e", "#6d28d9", "#c2410c",
  "#475569",
  // Light
  "#6d94e8", "#6ed0ff", "#6fbe7f", "#fbc76a", "#f88877",
  "#b282ed", "#f877a9", "#6ec4c0", "#b7a4f4", "#fbbf77",
  "#a9b3c6",
  // Muted
  "#5178cd", "#4fa6c9", "#62936c", "#d0aa49", "#ea8e80",
  "#ae87de", "#eb84ac", "#5f9b98", "#957fc9", "#dc9b62",
  "#8e9ab4",
  // Deep
  "#0e3486", "#005e91", "#1e5229", "#84620b", "#7f1d1d",
  "#4c1d95", "#831843", "#134e4a", "#4c1d95", "#7c2d12",
  "#334155",
];
