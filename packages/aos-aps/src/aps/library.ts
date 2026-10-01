/**
 * APS Fase 4 — the unaided prompt library.
 *
 * Ported from MAASY's `aps-prompt-library-generate`. The library is the measuring instrument: it is
 * generated once, locked for 90 days and then re-measured, because a time series is only comparable
 * while the prompt does not change (Fase 3 measures variance over the SAME prompt).
 *
 * Hard rule: a prompt that names the brand contaminates the signal. It is validated and discarded
 * before it is ever persisted.
 */

import { normalizeForMatch } from "../preference/profile";

export const LIBRARY_LOCK_DAYS = 90;
export const LIBRARY_TARGET_TOTAL = 50;
export const LIBRARY_TARGET_RANGE = { min: 40, max: 60 } as const;
/** Mix of the design blueprint: half comparison, a third use case, the rest category. */
export const LIBRARY_MIX = { comparison: 0.5, use_case: 0.3, category: 0.2 } as const;

/**
 * El marcador con el que el generador trabaja cuando la marca no declara categoría.
 *
 * Vive acá —y no en la pantalla— porque lo usan dos cosas que no pueden discrepar: el prompt que se
 * le manda al modelo (`buildLibraryPrompt`, en ./gateway) y el mensaje que le explica al operador qué
 * categoría se usó. Si el texto cambia en un solo lado, la pantalla diría una cosa y el modelo
 * habría recibido otra.
 */
export const CATEGORY_PLACEHOLDER = "marketing/software";

export type PromptKind = keyof typeof LIBRARY_MIX;
export type FunnelStage = "awareness" | "consideration" | "decision";

export const PROMPT_KINDS: PromptKind[] = ["comparison", "use_case", "category"];
export const FUNNEL_STAGES: FunnelStage[] = ["awareness", "consideration", "decision"];

export interface LibraryPromptInput {
	text: string;
	kind: PromptKind;
	funnelStage: FunnelStage;
}

/**
 * La forma canónica de una categoría declarada: texto, sin espacios sobrantes, no vacío.
 *
 * Es la única normalización que existe para las dos fuentes (BeAOS y Maasy): si cada una recortara a
 * su manera, una categoría con espacios pasaría en una puerta y no en la otra, y la biblioteca se
 * calibraría distinto según de dónde viniera.
 */
export function normalizeLibraryCategory(value: unknown): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * La categoría con la que se calibra la biblioteca, leída del contexto de marca de Maasy.
 *
 * El campo es `industry`, y no es una invención de este módulo: es el que el contexto de marca trae
 * (`MaasyBrandContext.industry`, la clave de arriba del payload que BeAOS guarda en
 * `agent_brand_dna_snapshots.payload`) y el mismo que ya viaja al `brand.json` servido como
 * `brand.industry` en `generateAgentAssets`.
 *
 * Devuelve `null` —nunca un marcador— cuando la marca no la declara o viene vacía: quien llama
 * decide qué decir, y decir "no la declaró" es distinto de inventar una. Una biblioteca calibrada
 * con una categoría falsa sale genérica y después se bloquea 90 días, así que el silencio no es una
 * opción aceptable.
 */
export function categoryFromBrandContext(payload: Record<string, unknown> | null | undefined): string | null {
	return normalizeLibraryCategory(payload?.industry);
}

/** De dónde salió la categoría con la que se calibra la biblioteca. */
export type LibraryCategorySource = "declared" | "dna" | "placeholder";

export interface ResolvedLibraryCategory {
	/**
	 * La categoría efectiva. `null` significa que la marca no la declara por ninguna vía; quien llama
	 * decide si avisa o si genera con `CATEGORY_PLACEHOLDER`, pero **no puede inventar una**.
	 */
	category: string | null;
	source: LibraryCategorySource;
}

/**
 * La categoría con la que se calibra la biblioteca, con la **precedencia explícita**. El orden es la
 * regla, no un detalle de implementación:
 *
 *  1. **`declared`** — la categoría que la marca declara en BeAOS (columna `brands.category`,
 *     editable en Configuración → Brand). Manda sobre todo lo demás porque es la que un humano
 *     escribió para **esta** marca en **este** producto, y es la única que existe cuando la marca no
 *     está en Maasy: BeAOS tiene que poder medir clientes que no son de Maasy, y con el DNA como
 *     única fuente la biblioteca de esos clientes salía calibrada con el marcador genérico.
 *  2. **`dna`** — el `industry` del último DNA sincronizado. Es la red de seguridad para quien ya
 *     tiene Maasy: no tiene que escribir la categoría dos veces. Se usa **solo** si la marca no la
 *     declaró en BeAOS, porque una declaración explícita siempre gana a un dato heredado.
 *  3. **`placeholder`** — ninguna de las dos. `category` vuelve `null` y `source` lo dice, para que
 *     quien llama muestre el aviso de que puede salir mal calibrada en vez de calibrar en silencio
 *     con `CATEGORY_PLACEHOLDER`.
 *
 * Los tres casos se resuelven acá y no en la pantalla a propósito: la puerta de la UI y la del MCP
 * tienen que resolver igual, o la misma marca generaría dos bibliotecas calibradas distinto.
 */
export function resolveLibraryCategory(input: {
	/** La categoría declarada en BeAOS (`brands.category`). */
	declared?: unknown;
	/** El payload del DNA de Maasy, de donde sale `industry`. */
	dna?: Record<string, unknown> | null | undefined;
}): ResolvedLibraryCategory {
	const declared = normalizeLibraryCategory(input.declared);
	if (declared !== null) return { category: declared, source: "declared" };

	const inherited = categoryFromBrandContext(input.dna);
	if (inherited !== null) return { category: inherited, source: "dna" };

	return { category: null, source: "placeholder" };
}

export type RejectionReason = "empty" | "names_brand" | "duplicate" | "unknown_kind" | "unknown_funnel_stage";

export interface RejectedPrompt {
	text: string;
	reason: RejectionReason;
}

export interface LibraryValidation {
	accepted: LibraryPromptInput[];
	rejected: RejectedPrompt[];
	/** Accepted prompts per kind. */
	counts: Record<PromptKind, number>;
	/** Observed share per kind, over accepted prompts. */
	mix: Record<PromptKind, number>;
	/** Whether the accepted mix is within tolerance of LIBRARY_MIX. */
	mixWithinTolerance: boolean;
	/** Whether the accepted total sits inside LIBRARY_TARGET_RANGE. */
	sizeWithinRange: boolean;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the prompt does not name the brand. Matching is accent- and case-insensitive and
 * word-bounded, so a brand called "ON" does not reject every prompt containing "con".
 */
export function isUnaided(text: string, brandTerms: string[]): boolean {
	const haystack = normalizeForMatch(text);
	for (const term of brandTerms) {
		const needle = normalizeForMatch(term).trim();
		if (needle.length < 2) continue;
		if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(haystack)) return false;
	}
	return true;
}

/** Validates a generated library before it is persisted. Nothing is silently dropped silently. */
export function validateLibrary(
	prompts: LibraryPromptInput[],
	brandTerms: string[],
	tolerance = 0.1,
): LibraryValidation {
	const accepted: LibraryPromptInput[] = [];
	const rejected: RejectedPrompt[] = [];
	const seen = new Set<string>();

	for (const prompt of prompts) {
		const text = typeof prompt.text === "string" ? prompt.text.trim() : "";
		if (text.length === 0) {
			rejected.push({ text, reason: "empty" });
			continue;
		}
		if (PROMPT_KINDS.includes(prompt.kind) === false) {
			rejected.push({ text, reason: "unknown_kind" });
			continue;
		}
		if (FUNNEL_STAGES.includes(prompt.funnelStage) === false) {
			rejected.push({ text, reason: "unknown_funnel_stage" });
			continue;
		}
		if (isUnaided(text, brandTerms) === false) {
			rejected.push({ text, reason: "names_brand" });
			continue;
		}
		const key = normalizeForMatch(text);
		if (seen.has(key)) {
			rejected.push({ text, reason: "duplicate" });
			continue;
		}
		seen.add(key);
		accepted.push({ text, kind: prompt.kind, funnelStage: prompt.funnelStage });
	}

	const counts: Record<PromptKind, number> = { comparison: 0, use_case: 0, category: 0 };
	for (const prompt of accepted) counts[prompt.kind] += 1;
	const total = accepted.length;
	const mix: Record<PromptKind, number> = {
		comparison: total === 0 ? 0 : counts.comparison / total,
		use_case: total === 0 ? 0 : counts.use_case / total,
		category: total === 0 ? 0 : counts.category / total,
	};
	const mixWithinTolerance = PROMPT_KINDS.every((kind) => Math.abs(mix[kind] - LIBRARY_MIX[kind]) <= tolerance);

	return {
		accepted,
		rejected,
		counts,
		mix,
		mixWithinTolerance,
		sizeWithinRange: total >= LIBRARY_TARGET_RANGE.min && total <= LIBRARY_TARGET_RANGE.max,
	};
}

export interface LibraryLock {
	lockedAt: string;
	unlocksAt: string;
	lockDays: number;
}

/** A library is locked from creation for LIBRARY_LOCK_DAYS: the instrument must not move. */
export function libraryLockWindow(createdAt: Date, lockDays = LIBRARY_LOCK_DAYS): LibraryLock {
	const unlocks = new Date(createdAt.getTime());
	unlocks.setUTCDate(unlocks.getUTCDate() + lockDays);
	return { lockedAt: createdAt.toISOString(), unlocksAt: unlocks.toISOString(), lockDays };
}

export function isLibraryLocked(lock: { unlocksAt: string }, now = new Date()): boolean {
	return now.getTime() < new Date(lock.unlocksAt).getTime();
}

export interface RegenerationVerdict {
	allowed: boolean;
	unlocksAt: string;
	reason: string;
}

/**
 * Regeneration is refused while the lock holds, unless the caller explicitly supersedes the
 * library (a new version, which starts a new comparable series).
 */
export function canRegenerateLibrary(
	lock: { unlocksAt: string },
	now = new Date(),
	supersede = false,
): RegenerationVerdict {
	if (supersede) {
		return {
			allowed: true,
			unlocksAt: lock.unlocksAt,
			reason: "Se reemplaza la biblioteca explicitamente: empieza una serie nueva.",
		};
	}
	if (isLibraryLocked(lock, now)) {
		return {
			allowed: false,
			unlocksAt: lock.unlocksAt,
			reason: `La biblioteca esta bloqueada hasta ${lock.unlocksAt}; cambiar el prompt rompe la comparabilidad.`,
		};
	}
	return { allowed: true, unlocksAt: lock.unlocksAt, reason: "El bloqueo de 90 dias venció." };
}
