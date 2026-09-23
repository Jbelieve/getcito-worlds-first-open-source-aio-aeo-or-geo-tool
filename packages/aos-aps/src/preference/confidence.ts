/**
 * Derived confidence. Spec: scoring.md
 *
 * confidence = clamp(1 - 1/sqrt(n), 0.5, 0.95) for n >= 2, else null.
 * Confidence is never self-assigned: a single named case is not a sample.
 */

/** Markers emitted by the standard in place of missing human input, e.g. "⚠ CONFIRMAR: ...". */
export function isMarker(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	return trimmed.startsWith("⚠") || trimmed.startsWith("⚠️");
}

export function isRealString(value: unknown): boolean {
	if (typeof value !== "string") return false;
	const trimmed = value.trim();
	return trimmed.length > 0 && isMarker(trimmed) === false;
}

/** Metric sample size: only a finite number counts. Marker strings do not. */
export function sampleSize(metric: unknown): number | null {
	if (metric === null || typeof metric !== "object") return null;
	const n = (metric as { n?: unknown }).n;
	if (typeof n === "number" && Number.isFinite(n)) return n;
	return null;
}

export function deriveConfidence(n: number | null | undefined): number | null {
	if (typeof n !== "number" || Number.isFinite(n) === false || n < 2) return null;
	const raw = 1 - 1 / Math.sqrt(n);
	return Math.min(0.95, Math.max(0.5, raw));
}

export function confidenceMatches(expected: number | null, actual: unknown): boolean {
	if (expected === null) return actual === null || actual === undefined;
	if (typeof actual !== "number" || Number.isFinite(actual) === false) return false;
	return Math.abs(expected - actual) < 1e-3;
}
