/**
 * APS, presented for a person.
 *
 * The pipeline already answers "how preferred is this brand" with a score, five weighted dimensions
 * and a bootstrap distribution. This turns that into something readable: the band, the shape of the
 * distribution, and where the score comes from dimension by dimension — so a marketer can see why
 * the number is what it is instead of trusting a lone figure.
 *
 * Dos APS conviven y no hay que confundirlas: el APS del perfil declarado (claims y proofs, que se
 * calcula sin costo) y el APS medido contra modelos reales, que es el que se muestra acá.
 *
 * El color no decora: el número va en tinta de marca, la banda lleva la rampa azul, y el cian es el
 * subrayado del número — la única señal de la sección. Ver status-tone.tsx.
 */
import { Bar, BarChart, Cell, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartTooltip, type ChartConfig } from "@workspace/ui/components/chart";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";
import { BandChip, BLOCKING_TEXT, MONO_LABEL, SIGNAL_BAR, apsBand } from "@/components/status-tone";

/** The five dimensions, with the weight each one carries. Labels are the product's words. */
const DIMENSIONS: Array<{ key: string; label: string; weight: number; hint: string }> = [
	{
		key: "discoverabilidad_agentica",
		label: "Descubrimiento",
		weight: 25,
		hint: "Cuántas veces te nombran en las respuestas a prompts de compra.",
	},
	{
		key: "inteligencia_estructurada",
		label: "Inteligencia estructurada",
		weight: 20,
		hint: "Si las respuestas que te mencionan citan fuentes verificables.",
	},
	{
		key: "capacidad_accion",
		label: "Capacidad de acción",
		weight: 20,
		hint: "Tu AOS: si un agente puede operar el sitio. Sale de la auditoría real.",
	},
	{
		key: "autoridad_fuente",
		label: "Autoridad de fuente",
		weight: 20,
		hint: "Posición en el ranking y cuántos competidores aparecen a tu lado.",
	},
	{
		key: "reputacion_agentica",
		label: "Reputación agéntica",
		weight: 15,
		hint: "Si te recomiendan explícitamente y con qué sentimiento.",
	},
];

const SUB_METRICS: Array<{ key: string; label: string; percent: boolean; hint: string }> = [
	{ key: "coverage", label: "Cobertura", percent: true, hint: "Proporción de respuestas donde aparecés." },
	{ key: "recommendationRate", label: "Recomendación", percent: true, hint: "Proporción donde te recomiendan explícitamente." },
	{ key: "sovPosWeight", label: "Posición", percent: true, hint: "Peso por lugar: 1º vale 1, 2º la mitad, y así." },
	{ key: "sentimentAvg", label: "Sentimiento", percent: true, hint: "Tono de la narrativa cuando aparecés (0-100)." },
	{ key: "groundingRate", label: "Grounding", percent: true, hint: "Respuestas con fuentes citables verificadas contra el texto." },
	{
		key: "competitorBreadth",
		label: "Amplitud competitiva",
		percent: true,
		hint: "Cuanto más alto, menos competidores aparecen junto a vos.",
	},
];

function InfoHint({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
			</TooltipTrigger>
			<TooltipContent className="max-w-xs text-sm font-normal">{text}</TooltipContent>
		</Tooltip>
	);
}

/** Bins the samples so the shape of the bootstrap distribution is visible. */
export function binSamples(samples: number[], buckets = 18): Array<{ range: string; count: number; from: number }> {
	if (samples.length === 0) return [];
	const min = Math.min(...samples);
	const max = Math.max(...samples);
	if (min === max) return [{ range: String(min), count: samples.length, from: min }];
	const width = (max - min) / buckets;
	const bins = Array.from({ length: buckets }, (_, index) => {
		const from = min + index * width;
		return { range: String(Math.round(from)), count: 0, from };
	});
	for (const sample of samples) {
		const index = Math.min(buckets - 1, Math.floor((sample - min) / width));
		const bin = bins[index];
		if (bin !== undefined) bin.count += 1;
	}
	return bins.filter((bin) => bin.count > 0);
}

/** The distribution of the bootstrap: one bar per bucket of resampled APS values. */
export function ApsDistributionChart({ samples, aps }: { samples: number[]; aps: number }) {
	const bins = binSamples(samples);
	const config: ChartConfig = { count: { label: "Muestras", color: "var(--primary)" } };

	if (bins.length === 0) return null;
	if (bins.length === 1) {
		return (
			<div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs text-muted-foreground">
				La distribución necesita <span className="font-medium text-foreground">2 o más repeticiones</span> por prompt.
				Con una sola, todas las remuestras dan el mismo valor ({aps}), así que no hay varianza que mostrar. El
				puntaje sigue siendo válido: es la foto de esa corrida.
			</div>
		);
	}

	return (
		<div className="space-y-1">
			<div className="flex items-center justify-between text-xs">
				<span className="flex items-center gap-1 font-medium text-muted-foreground">
					Distribución de {samples.length} remuestras <InfoHint text="Bootstrap sobre la varianza de las repeticiones: remuestrea una respuesta por prompt, 500 veces, y recalcula el APS." />
				</span>
				<span className={MONO_LABEL}>P10 · P50 · P90</span>
			</div>
			<ChartContainer config={config} className="h-32 w-full">
				<BarChart data={bins} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
					<XAxis dataKey="range" tickLine={false} axisLine={false} fontSize={10} />
					<YAxis hide />
					<ChartTooltip
						content={({ active, payload }) => {
							if (active !== true || payload === undefined || payload.length === 0) return null;
							const bin = payload[0]?.payload as { range: string; count: number } | undefined;
							if (bin === undefined) return null;
							return (
								<div className="rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
									APS ≈ {bin.range} · {bin.count} remuestras
								</div>
							);
						}}
					/>
					<Bar dataKey="count" radius={[2, 2, 0, 0]}>
						{bins.map((bin) => (
							<Cell
								key={bin.range}
								fill="var(--primary)"
								fillOpacity={Math.abs(bin.from - aps) <= 3 ? 0.95 : 0.35}
							/>
						))}
					</Bar>
				</BarChart>
			</ChartContainer>
		</div>
	);
}

/** A band small enough to sit inline in a table row. */
export function ApsMiniBand({ aps, p10, p90 }: { aps: number; p10: number | null; p90: number | null }) {
	if (p10 === null || p90 === null) return null;
	const clamp = (value: number) => Math.max(0, Math.min(100, value));
	const left = clamp(p10);
	const width = Math.max(2, clamp(p90) - left);
	return (
		<span className="relative inline-block h-1.5 w-16 shrink-0 rounded-full bg-muted align-middle">
			<span className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: `${left}%`, width: `${width}%` }} />
			<span className="absolute inset-y-[-2px] w-0.5 rounded-full bg-primary" style={{ left: `${clamp(aps)}%` }} />
		</span>
	);
}

/** The band, minimal: a rail from P10 to P90 with the point score marked. */
export function ApsBand({ aps, p10, p50, p90 }: { aps: number; p10: number | null; p50: number | null; p90: number | null }) {
	if (p10 === null || p50 === null || p90 === null) return null;
	const left = Math.max(0, Math.min(100, p10));
	const right = Math.max(0, Math.min(100, p90));
	const width = Math.max(2, right - left);
	const point = Math.max(0, Math.min(100, aps));
	const mid = Math.max(0, Math.min(100, p50));
	return (
		<div className="space-y-1">
			<div className="relative h-2 w-full rounded-full bg-muted">
				<div className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: `${left}%`, width: `${width}%` }} />
				<div className="absolute inset-y-[-2px] w-0.5 bg-primary/70" style={{ left: `${mid}%` }} title={`P50 ${p50}`} />
				<div className="absolute inset-y-[-3px] w-1 rounded-full bg-primary" style={{ left: `${point}%` }} title={`APS ${aps}`} />
			</div>
			<div className="flex justify-between">
				<span className={MONO_LABEL}>P10 {p10}</span>
				<span className={MONO_LABEL}>P50 {p50}</span>
				<span className={MONO_LABEL}>P90 {p90}</span>
			</div>
		</div>
	);
}

/** Where the score comes from, dimension by dimension. */
export function ApsDimensionBars({ dimensions }: { dimensions: Record<string, number | null> | null }) {
	if (dimensions === null) return null;
	return (
		<div className="space-y-2">
			{DIMENSIONS.map((dimension) => {
				const value = dimensions[dimension.key];
				const present = typeof value === "number";
				return (
					<div key={dimension.key} className="space-y-1">
						<div className="flex items-center gap-1.5 text-xs">
							<span className="font-medium">{dimension.label}</span>
							<span className="font-mono text-[10px] text-muted-foreground">peso {dimension.weight}</span>
							<InfoHint text={dimension.hint} />
							<span className={`ml-auto tabular-nums ${present ? "font-semibold" : "text-muted-foreground"}`}>
								{present ? Math.round(value) : "sin dato"}
							</span>
						</div>
						<div className="h-1.5 w-full rounded-full bg-muted">
							<div
								className="h-1.5 rounded-full bg-primary"
								style={{ width: `${present ? Math.max(0, Math.min(100, value)) : 0}%` }}
							/>
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** The six sub-metrics the dimensions are built from. */
export function ApsSubMetrics({ subMetrics }: { subMetrics: Record<string, number> | null }) {
	if (subMetrics === null) return null;
	return (
		<div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3">
			{SUB_METRICS.map((metric) => {
				const raw = subMetrics[metric.key];
				if (typeof raw !== "number") return null;
				return (
					<div key={metric.key} className="flex items-center gap-1.5">
						<span className="text-muted-foreground">{metric.label}</span>
						<InfoHint text={metric.hint} />
						<span className="ml-auto font-medium tabular-nums">
							{metric.percent ? `${Math.round(raw * 100)}%` : raw}
						</span>
					</div>
				);
			})}
		</div>
	);
}

/**
 * Recommended share of the band, for the section header. El número es el dato de la sección y va en
 * tinta de marca con el subrayado cian del brandbook: la única señal acá.
 */
export function ApsHeadline({
	aps,
	band,
	recommendationProbability,
	observations,
	models,
}: {
	aps: number;
	band: string;
	recommendationProbability: number | null;
	observations: number;
	models: number;
}) {
	const meta = apsBand(band);
	return (
		<div className="flex flex-wrap items-end gap-4">
			<div className="flex items-end gap-3">
				<span className="relative inline-block">
					<span
						className="font-display font-semibold tracking-tight tabular-nums text-believe-900"
						style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)", lineHeight: 1 }}
					>
						{aps}
					</span>
					<span className={`absolute -bottom-2 left-0 h-1.5 w-[120px] ${SIGNAL_BAR}`} />
				</span>
				<div className="space-y-1 pb-1">
					<BandChip label={meta.label} level={meta.level} />
					<p className={MONO_LABEL}>
						{observations} respuestas · {models} {models === 1 ? "modelo" : "modelos"}
					</p>
				</div>
			</div>
			{recommendationProbability !== null && (
				<div className="pb-1">
					<p className={MONO_LABEL}>Probabilidad de recomendación</p>
					<p className="font-display text-2xl font-semibold tabular-nums text-believe-900">
						{recommendationProbability}
						<span className="text-base text-muted-foreground">%</span>
					</p>
				</div>
			)}
		</div>
	);
}

export interface ApsScoreView {
	model: string;
	aps: number;
	band: string;
	p10: number | null;
	p50: number | null;
	p90: number | null;
	recommendationProbability: number | null;
	observations: number;
	partial?: boolean;
	dimensions: Record<string, number | null> | null;
	subMetrics: Record<string, number> | null;
	distribution: number[] | null;
}

export interface ApsRunView {
	id: string;
	createdAt: string;
	/**
	 * The models the run planned. Shown because the plan is derived from SCRAPE_TARGETS and can come
	 * out shorter than the operator expects — a run once measured two models out of four and nothing
	 * on screen said so.
	 */
	models?: string[];
	completedCalls: number;
	plannedCalls: number;
	partial: boolean;
	partialReason: string | null;
	repetitionsReduced: boolean;
	error: string | null;
	promptLibraryVersion: number;
	judgeModelAlias: string;
	judgeModelVersion: string;
	measurementVersion: string;
	scores: ApsScoreView[];
}

function bandFromScore(aps: number): string {
	if (aps >= 85) return "agent_native";
	if (aps >= 70) return "agent_ready";
	if (aps >= 50) return "agent_visible";
	if (aps >= 25) return "agent_opaque";
	return "agent_blind";
}

/** The brand rollup: mean of per-model scores that were each normalized on their own answers. */
export function rollupOf(scores: ApsScoreView[]): { aps: number; band: string } | null {
	if (scores.length === 0) return null;
	const aps = Math.round(scores.reduce((sum, score) => sum + score.aps, 0) / scores.length);
	return { aps, band: bandFromScore(aps) };
}

/**
 * One run, presented. The newest run opens fully (headline, band, dimensions, distribution); older
 * runs stay compact so the history does not bury the current number.
 *
 * Una corrida parcial se dice, no se pinta: el estado va en la etiqueta mono, porque el color acá
 * está reservado para cuánto hay y no para advertir.
 */
export function ApsRunBlock({ run, expanded, statusLabel }: { run: ApsRunView; expanded: boolean; statusLabel: string }) {
	const rollup = rollupOf(run.scores);
	return (
		<div className="space-y-3 border-b pb-6 last:border-b-0 last:pb-0">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<span className="text-muted-foreground">
					{new Date(run.createdAt).toLocaleString()} · {statusLabel} · {run.completedCalls}/{run.plannedCalls} llamadas
					{run.models !== undefined && run.models.length > 0 && (
						<>
							{" · "}
							<span className={MONO_LABEL}>{run.models.join(" ")}</span>
						</>
					)}
				</span>
				<span className="font-mono text-xs text-muted-foreground">
					v{run.promptLibraryVersion} · {run.judgeModelAlias}@{run.judgeModelVersion} · {run.measurementVersion}
				</span>
			</div>
			{run.repetitionsReduced && (
				<p className="text-xs text-muted-foreground">
					<span className={MONO_LABEL}>parcial</span> · se redujeron las repeticiones para entrar en el presupuesto.
				</p>
			)}
			{run.partial && run.partialReason && (
				<p className="text-xs text-muted-foreground">
					<span className={MONO_LABEL}>parcial</span> · {run.partialReason} El score es de la muestra, no del total
					planificado.
				</p>
			)}
			{run.error && <p className={`text-xs ${BLOCKING_TEXT}`}>{run.error}</p>}

			{run.scores.length > 0 && expanded && rollup !== null && (
				<ApsHeadline
					aps={rollup.aps}
					band={rollup.band}
					recommendationProbability={
						run.scores.some((score) => score.recommendationProbability !== null)
							? Math.round(
									run.scores.reduce((sum, score) => sum + (score.recommendationProbability ?? 0), 0) / run.scores.length,
								)
							: null
					}
					observations={run.completedCalls}
					models={run.scores.length}
				/>
			)}

			{run.scores.length > 0 && (
				<div className="space-y-3">
					{run.scores.map((score) => {
						const meta = apsBand(score.band);
						return (
							<div key={score.model} className="space-y-3 rounded-lg border p-4">
								<div className="flex flex-wrap items-end justify-between gap-2">
									<div className="flex items-end gap-2">
										<code className="font-mono text-sm">{score.model}</code>
										<span className="font-display text-3xl font-semibold tabular-nums text-believe-900">
											{score.aps}
										</span>
										<BandChip label={meta.label} level={meta.level} className="mb-1" />
									</div>
									<div className="text-right text-xs text-muted-foreground">
										<p>
											{score.observations} respuestas
											{score.recommendationProbability === null
												? ""
												: ` · recomendación ${score.recommendationProbability}%`}
										</p>
										{score.partial === true && <p className={MONO_LABEL}>parcial</p>}
									</div>
								</div>

								<ApsBand aps={score.aps} p10={score.p10} p50={score.p50} p90={score.p90} />
								{expanded && (
									<div className="grid gap-4 lg:grid-cols-2">
										<div className="space-y-3">
											<p className="text-xs font-medium text-muted-foreground">De dónde sale el score</p>
											<ApsDimensionBars dimensions={score.dimensions} />
										</div>
										<div className="space-y-3">
											<ApsDistributionChart samples={score.distribution ?? []} aps={score.aps} />
											<div className="space-y-1.5">
												<p className="text-xs font-medium text-muted-foreground">Sub-métricas medidas</p>
												<ApsSubMetrics subMetrics={score.subMetrics} />
											</div>
										</div>
									</div>
								)}
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
}
