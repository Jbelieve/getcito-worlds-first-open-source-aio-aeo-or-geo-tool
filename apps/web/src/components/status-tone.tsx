/**
 * Cómo dicen las superficies de AOS y APS "bien / a medias / falta", en la paleta de Believe.
 *
 * El brandbook da seis tokens y prohíbe inventar valores hex. El semáforo verde/ámbar/rojo que estas
 * pantallas usaban antes eran cuatro hues inventados haciendo un solo trabajo, y por eso chocaba con
 * el resto del sistema. Ese trabajo lo hacen ahora tres canales, cada uno con un solo significado:
 *
 *   azul  — cuánto hay.      Rampa ordinal: más azul, más cumplido. El mejor estado es azul pleno; el
 *                            peor no tiene azul, queda gris. El color ordena, no juzga.
 *   tinta — qué tan grave.   Peso, no tono: lo que bloquea se escribe en tinta plena, lo demás en
 *                            tinta mute. Funciona sin distinguir colores, porque es contraste.
 *   cian  — qué hacer ahora. La única señal. El brandbook permite dos apariciones por composición:
 *                            acá vive en el próximo paso y en el subrayado del número grande.
 *
 * Dos reglas sostienen esto y conviene no romperlas:
 *
 *   1. Un número nunca se pinta por lo que vale. El número es un dato y va en tinta; el chip al lado
 *      es el que dice si está bien o mal. Así el mismo componente sirve para un 34 y para un 94.
 *   2. Un estado nunca depende solo del color. Cada estado lleva su palabra y su glifo, así que se
 *      entiende en una impresión en blanco y negro o con daltonismo.
 *
 * Antes de este módulo había cuatro copias del mapeo banda→color (una por pantalla), que es
 * exactamente por qué la paleta se había desviado. Ahora hay una.
 */
import type { ReactNode } from "react";

/** Cuánto hay. `none` es ausencia, no alarma: lo que falta se ve por vacío, no por rojo. */
export type Level = "full" | "high" | "mid" | "low" | "none" | "unknown";

export interface StatusTone {
	/** Color del número o de la etiqueta cuando el tono sí es el mensaje. */
	text: string;
	/** Borde y fondo, para un chip o un bloque. */
	chip: string;
	/** Fondo suelto, para una tarjeta que se tiñe. */
	bg: string;
	/** Borde suelto, para una tarjeta que se tiñe. */
	border: string;
	/** Relleno de una marca: el trazo del anillo, el punto, la barra. Derivado de los dos azules. */
	mark: string;
	/** Lleno o hueco. Es lo que hace que el estado sobreviva sin color. */
	solid: boolean;
}

const BLUE_700 = "#0c3bb9";
const BLUE_700_RGB = "12, 59, 185";
const INK_900_RGB = "26, 26, 26";

/**
 * La rampa. El único valor que no sale de un token es la opacidad, que es una derivación de
 * Believe Blue 700 — nunca un hex nuevo.
 */
export const STATUS_TONE: Record<Level, StatusTone> = {
	full: {
		text: "text-primary",
		chip: "border-primary/30 bg-primary/10 text-primary",
		bg: "bg-primary/10",
		border: "border-primary/30",
		mark: BLUE_700,
		solid: true,
	},
	high: {
		text: "text-primary",
		chip: "border-primary/20 bg-primary/5 text-primary",
		bg: "bg-primary/5",
		border: "border-primary/20",
		mark: `rgba(${BLUE_700_RGB}, 0.72)`,
		solid: true,
	},
	mid: {
		text: "text-foreground",
		chip: "border-border bg-muted text-foreground",
		bg: "bg-muted",
		border: "border-border",
		mark: `rgba(${BLUE_700_RGB}, 0.45)`,
		solid: false,
	},
	low: {
		text: "text-muted-foreground",
		chip: "border-border bg-muted text-muted-foreground",
		bg: "bg-muted",
		border: "border-border",
		mark: `rgba(${BLUE_700_RGB}, 0.22)`,
		solid: false,
	},
	none: {
		text: "text-muted-foreground",
		chip: "border-dashed border-foreground/25 bg-transparent text-foreground",
		bg: "bg-transparent",
		border: "border-dashed border-foreground/25",
		mark: `rgba(${INK_900_RGB}, 0.30)`,
		solid: false,
	},
	unknown: {
		text: "text-muted-foreground",
		chip: "border-dashed border-border bg-transparent text-muted-foreground",
		bg: "bg-transparent",
		border: "border-dashed border-border",
		mark: `rgba(${INK_900_RGB}, 0.16)`,
		solid: false,
	},
};

export function toneOf(level: Level | undefined): StatusTone {
	return STATUS_TONE[level ?? "unknown"];
}

/**
 * Lo que bloquea: tinta plena, sin color. Es el registro más fuerte del sistema y no necesita un hues
 * nuevo — sobre una pantalla donde lo que falta está en gris, el negro lleno ya se lee como alarma.
 */
export const BLOCKING_TEXT = "text-foreground font-medium";
export const BLOCKING_BLOCK = "border-foreground/20 bg-muted/60 text-foreground";

/** La única señal permitida. Dos apariciones por composición como máximo. */
export const SIGNAL_BAR = "bg-signal";
export const SIGNAL_RULE = "border-signal";

export const AOS_BANDS: Record<string, { label: string; level: Level }> = {
	"Agent-Operable": { label: "Operable", level: "full" },
	"Agent-Attemptable": { label: "Intentable", level: "high" },
	"Agent-Blocked": { label: "Bloqueado", level: "mid" },
	"Agent-Inert": { label: "Inerte", level: "low" },
};

export const APS_BANDS: Record<string, { label: string; level: Level }> = {
	agent_native: { label: "Agent-Native", level: "full" },
	agent_ready: { label: "Agent-Ready", level: "high" },
	agent_visible: { label: "Agent-Visible", level: "mid" },
	agent_opaque: { label: "Agent-Opaque", level: "low" },
	agent_blind: { label: "Agent-Blind", level: "none" },
};

export interface BandMeta {
	label: string;
	level: Level;
	tone: StatusTone;
}

function metaFor(bands: Record<string, { label: string; level: Level }>, band: string | null | undefined): BandMeta {
	const entry = band === null || band === undefined ? undefined : bands[band];
	const level = entry?.level ?? "unknown";
	return { label: entry?.label ?? (band ?? "Sin dato"), level, tone: toneOf(level) };
}

export function aosBand(band: string | null | undefined): BandMeta {
	return metaFor(AOS_BANDS, band);
}

export function apsBand(band: string | null | undefined): BandMeta {
	return metaFor(APS_BANDS, band);
}

/**
 * 0-100 → nivel. Los cortes son la regla de negocio de cada superficie y viven donde se usan: el AOS
 * usa cuatro escalones, la visibilidad heredada de Getcito usa tres, y por eso `mid` es opcional.
 */
export function levelFromScore(score: number, cuts: { full: number; high: number; mid?: number }): Level {
	if (score >= cuts.full) return "full";
	if (score >= cuts.high) return "high";
	if (cuts.mid !== undefined && score >= cuts.mid) return "mid";
	return score > 0 ? "low" : "none";
}

export type StageStatus = "listo" | "a medias" | "bloqueado" | "sin datos";

export const STAGE_LEVEL: Record<StageStatus, Level> = {
	listo: "full",
	"a medias": "mid",
	bloqueado: "none",
	"sin datos": "unknown",
};

export const STAGE_LABEL: Record<StageStatus, string> = {
	listo: "LISTO",
	"a medias": "A MEDIAS",
	bloqueado: "BLOQUEADO",
	"sin datos": "SIN DATOS",
};

export type RequirementStatus = "pass" | "fail" | "n_a";

/** Glifo y tono de un chequeo. El ✕ en tinta llena es la marca de lo que falta: sin rojo. */
export const REQUIREMENT_GLYPH: Record<RequirementStatus, string> = { pass: "✓", fail: "✕", n_a: "—" };
export const REQUIREMENT_TONE: Record<RequirementStatus, string> = {
	pass: "text-primary",
	fail: "text-foreground",
	n_a: "text-muted-foreground",
};

/**
 * La etiqueta técnica de Believe: mono, mayúscula, tracking abierto. Marca lo que es metadato,
 * índice o referencia — incluido un estado como "parcial", que se dice, no se pinta.
 */
export const MONO_LABEL = "font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground";

/**
 * El eyebrow de Believe: mono, mayúscula, tracking abierto. Marca lo que es etiqueta o índice y no
 * compite con el titular en Fraunces.
 */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
	return <p className={`${MONO_LABEL} font-medium ${className ?? ""}`}>{children}</p>;
}

/** Una banda, con la palabra y una marca llena o hueca. */
export function BandChip({ label, level, className }: { label: string; level: Level; className?: string }) {
	const tone = toneOf(level);
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium ${tone.chip} ${className ?? ""}`}
		>
			<span
				className="h-1.5 w-1.5 shrink-0 rounded-full"
				style={tone.solid ? { backgroundColor: tone.mark } : { border: `1px solid ${tone.mark}` }}
			/>
			{label}
		</span>
	);
}
