/**
 * La página de AOS/APS del reporte.
 *
 * Vive en su propio archivo a propósito: el reporte de Getcito es un archivo del stream y la frontera del
 * fork dice que ahí solo se agrega. Así el reporte solo gana un import y una línea, y el merge del
 * upstream no encuentra nada que resolver.
 *
 * Los números de acá van en tinta de marca, no pintados por lo que valen, y el chip al lado dice si está
 * bien o mal: el mismo componente sirve para un 34 y para un 94. Esa es la regla de `status-tone`.
 *
 * Todo lo que se muestra lleva su fecha. El reporte es un documento fechado y el AOS/APS siguen
 * moviéndose: mostrar un AOS de hoy junto a un SoV de hace un mes sin decirlo sería mentir con números
 * reales.
 */

import { aosBand, apsBand } from "@/components/status-tone";
import type { ReportAgentContext } from "@/server/report-agent";

function formatDay(iso: string): string {
	try {
		return new Intl.DateTimeFormat("es", { year: "numeric", month: "long", day: "numeric" }).format(new Date(iso));
	} catch {
		return iso.slice(0, 10);
	}
}

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div className="border-l-[3px] border-believe-700 pl-3 mb-4">
			<h2 className="text-base font-semibold text-believe-900">{title}</h2>
			{subtitle !== undefined && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>}
		</div>
	);
}

function BandChip({ label, chip, solid }: { label: string; chip: string; solid: boolean }) {
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-semibold ${chip}`}
		>
			<span className={solid ? "text-[9px]" : "text-[9px] opacity-50"}>{solid ? "●" : "○"}</span>
			{label}
		</span>
	);
}

function AosBlock({ context }: { context: ReportAgentContext }) {
	const audit = context.audit;
	if (audit === null) {
		return (
			<div className="border border-dashed border-border rounded-lg p-6 mb-8">
				<div className="text-sm text-muted-foreground">
					Todavía no hay una auditoría AOS de esta marca. Se corre desde BeAOS, en la sección AOS.
				</div>
			</div>
		);
	}
	const meta = aosBand(audit.band);
	const summary = audit.summary;

	return (
		<div className="mb-8">
			<div className="flex items-start justify-between gap-6 mb-4">
				<div className="flex items-baseline gap-3">
					<span className="text-5xl font-extrabold tracking-tighter text-believe-900">{audit.score ?? "—"}</span>
					<div className="flex flex-col gap-1">
						<span className="text-xs font-semibold text-muted-foreground">AOS · Agent Operability Score</span>
						<BandChip label={meta.label} chip={meta.tone.chip} solid={meta.tone.solid} />
					</div>
				</div>
				<div className="text-right text-[10px] text-muted-foreground leading-relaxed">
					Auditado el {formatDay(audit.auditedAt)}
					{audit.scoringVersion !== null && <div className="font-mono">{audit.scoringVersion}</div>}
				</div>
			</div>

			<div className="w-full bg-muted rounded-full h-2 mb-5">
				<div
					className="h-2 rounded-full"
					style={{ width: `${Math.max(2, audit.score ?? 0)}%`, backgroundColor: meta.tone.mark }}
				/>
			</div>

			<div className="grid grid-cols-3 gap-3 mb-5">
				<div className="border border-border rounded-lg p-3">
					<div className="text-2xl font-bold text-believe-900">{summary.passing}</div>
					<div className="text-[10px] text-muted-foreground mt-0.5">Requisitos que cumplen</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-2xl font-bold text-believe-900">{summary.failing}</div>
					<div className="text-[10px] text-muted-foreground mt-0.5">Requieren trabajo</div>
				</div>
				<div className="border border-border rounded-lg p-3">
					<div className="text-2xl font-bold text-believe-900">{summary.notApplicable}</div>
					<div className="text-[10px] text-muted-foreground mt-0.5">No aplican a este negocio</div>
				</div>
			</div>

			{summary.nextSteps.length > 0 ? (
				<>
					{/* La única señal de la composición: qué hacer ahora. */}
					<div className="text-[10px] font-semibold uppercase tracking-[0.15em] mb-2 border-b-2 border-signal text-signal pb-1">
						Qué hacer ahora
					</div>
					<div className="space-y-1.5">
						{summary.nextSteps.map((step) => (
							<div key={step.id} className="flex items-center justify-between gap-4 border-b border-border/60 pb-1.5">
								<span className="text-xs text-foreground">{step.title}</span>
								<span className="text-xs font-semibold text-believe-900 whitespace-nowrap">
									+{step.gain?.toFixed(1)} {step.axis.toLowerCase() === "aps" ? "APS" : "AOS"}
								</span>
							</div>
						))}
					</div>
				</>
			) : (
				<div className="text-xs text-muted-foreground">
					No queda ningún requisito puntuado por resolver de los que se pudieron evaluar.
				</div>
			)}
		</div>
	);
}

function ApsBlock({ context }: { context: ReportAgentContext }) {
	const measurement = context.measurement;
	const declared = measurement?.declaredAps ?? context.audit?.declaredAps ?? null;

	return (
		<div>
			<SectionTitle
				title="Agent Preference (APS)"
				subtitle="Cuánto prefiere un asistente a esta marca. Son dos números distintos y no se suman: uno es lo que la marca declara y firma, el otro lo que los modelos responden."
			/>

			<div className="grid grid-cols-2 gap-4 mb-6">
				<div className="border border-border rounded-lg p-4">
					<div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Declarado</div>
					<div className="flex items-baseline gap-2">
						<span className="text-3xl font-bold text-believe-900">{declared ?? "—"}</span>
						<span className="text-[10px] text-muted-foreground">sobre los Claims &amp; Proofs que el sitio firma</span>
					</div>
				</div>
				<div className="border border-border rounded-lg p-4">
					<div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">Medido</div>
					{measurement === null ? (
						<div className="text-xs text-muted-foreground">
							Sin medición todavía. Se corre desde BeAOS, en la sección APS.
						</div>
					) : (
						<div className="flex items-baseline gap-2">
							<span className="text-3xl font-bold text-believe-900">{measurement.summary.best?.aps ?? "—"}</span>
							<span className="text-[10px] text-muted-foreground">
								mejor modelo, sobre {measurement.summary.models}{" "}
								{measurement.summary.models === 1 ? "modelo" : "modelos"}
							</span>
						</div>
					)}
				</div>
			</div>

			{measurement !== null && (
				<>
					<table className="w-full mb-4">
						<thead>
							<tr className="bg-muted/60 border-b border-border">
								<th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-left">
									Modelo
								</th>
								<th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
									APS
								</th>
								<th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
									Banda
								</th>
								<th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
									P10 – P90
								</th>
								<th className="py-2.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-center">
									Respuestas
								</th>
							</tr>
						</thead>
						<tbody>
							{[...measurement.scores]
								.sort((a, b) => b.aps - a.aps)
								.map((score) => {
									const meta = apsBand(score.band);
									return (
										<tr key={score.model} className="border-b border-border/60">
											<td className="py-2 px-3 text-xs">{score.model}</td>
											<td className="py-2 px-3 text-center text-xs font-bold text-believe-900">
												<span className="border-b-2 border-signal">{score.aps}</span>
											</td>
											<td className="py-2 px-3 text-center">
												<BandChip label={meta.label} chip={meta.tone.chip} solid={meta.tone.solid} />
											</td>
											<td className="py-2 px-3 text-center text-[11px] text-muted-foreground">
												{score.p10 !== null && score.p10 !== undefined && score.p90 !== null && score.p90 !== undefined
													? `${score.p10} – ${score.p90}`
													: "—"}
											</td>
											<td className="py-2 px-3 text-center text-[11px] text-muted-foreground">{score.observations}</td>
										</tr>
									);
								})}
						</tbody>
					</table>

					<div className="space-y-1 text-[11px] text-muted-foreground">
						{measurement.summary.spread !== null && measurement.summary.spread > 0 && (
							<div>
								La distancia entre el mejor y el peor modelo es de{" "}
								<strong className="text-foreground">{measurement.summary.spread} puntos</strong>
								{measurement.summary.distinctBands > 1
									? `, y caen en ${measurement.summary.distinctBands} bandas distintas: el resultado depende de a qué asistente le preguntes.`
									: "."}
							</div>
						)}
						{measurement.partial && (
							<div className="text-foreground font-medium">
								Medición parcial: la corrida respondió menos prompts de los que planeó
								{measurement.partialReason !== null ? ` (${measurement.partialReason})` : ""}. Se muestra tal como
								salió, no como si estuviera completa.
							</div>
						)}
						<div>
							Medido el {formatDay(measurement.capturedAt)}. La banda sale del APS, no del promedio: con pocos modelos
							el promedio esconde justo lo que importa.
						</div>
					</div>
				</>
			)}
		</div>
	);
}

/**
 * La página completa. Se inserta antes del cierre del reporte y no toca ninguna sección existente.
 */
export function ReportAgentPage({ context, brandName }: { context: ReportAgentContext; brandName: string }) {
	if (context.linked === false) {
		return (
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<SectionTitle title="Agent Readiness" subtitle="AOS y APS" />
				<div className="border border-dashed border-border rounded-lg p-6">
					<div className="text-sm text-foreground mb-1">Este reporte no está vinculado a una marca de BeAOS.</div>
					<div className="text-xs text-muted-foreground">
						El reporte guarda el nombre y la web de la marca, y con eso se busca su entidad. No se encontró ninguna con
						esa web ni ese nombre, así que no se muestra ningún AOS: mostrar el de otra marca sería peor que no mostrar
						nada. Se vincula creando la marca en BeAOS con la misma web.
					</div>
				</div>
			</div>
		);
	}

	return (
		<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
			<SectionTitle
				title="Agent Readiness"
				subtitle={`Cómo ve a ${brandName} un agente que llega por su cuenta: primero si puede operar la web, después si la prefiere.`}
			/>
			<AosBlock context={context} />
			<ApsBlock context={context} />
		</div>
	);
}
