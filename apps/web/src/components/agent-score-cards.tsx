/**
 * AOS and APS at the top of the overview.
 *
 * These are the two numbers the product exists to move, so they get the same weight as the
 * visibility hero: a big score, its band, and the one thing to do about it. Everything else about
 * the agent surface (requirements, runs, assets) lives in its own section.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { IconInfoCircle, IconArrowRight } from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Progress } from "@workspace/ui/components/progress";
import { Skeleton } from "@workspace/ui/components/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { getAgentOverviewFn } from "@/server/agent-overview";
import { ApsMiniBand } from "@/components/aps-visual";
import { BandChip, MONO_LABEL, apsBand, aosBand } from "@/components/status-tone";

function titleWithTooltip(title: string, tooltip: string) {
	return (
		<CardTitle className="text-sm font-medium flex items-center gap-1.5">
			{title}
			<Tooltip>
				<TooltipTrigger asChild>
					<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
				</TooltipTrigger>
				<TooltipContent className="max-w-xs text-sm font-normal">{tooltip}</TooltipContent>
			</Tooltip>
		</CardTitle>
	);
}

function BigScore({ score }: { score: number }) {
	return (
		<span
			className="font-display font-semibold tracking-tight tabular-nums text-believe-900"
			style={{ fontSize: "clamp(2rem, 4vw, 3.25rem)" }}
		>
			{score}
		</span>
	);
}

function EmptySection({ message, to, cta, brandId }: { message: string; to: string; cta: string; brandId: string }) {
	return (
		<div className="flex flex-col items-start gap-2 py-2">
			<p className="text-sm text-muted-foreground">{message}</p>
			<Link
				to={to}
				params={{ brand: brandId }}
				className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
			>
				{cta}
				<IconArrowRight className="h-3.5 w-3.5" />
			</Link>
		</div>
	);
}

export function AgentScoreCards({ brandId }: { brandId: string | undefined }) {
	const { data, isLoading } = useQuery({
		queryKey: ["agent-overview", brandId],
		queryFn: () => getAgentOverviewFn({ data: { brandId: brandId ?? "" } }),
		enabled: Boolean(brandId),
	});

	if (isLoading || brandId === undefined) {
		return (
			<div className="grid gap-3 lg:grid-cols-2">
				<Card className="shadow-none py-4">
					<CardContent>
						<Skeleton className="h-24 w-full" />
					</CardContent>
				</Card>
				<Card className="shadow-none py-4">
					<CardContent>
						<Skeleton className="h-24 w-full" />
					</CardContent>
				</Card>
			</div>
		);
	}

	const aos = data?.aos ?? null;
	const aps = data?.aps ?? null;

	return (
		<section className="space-y-2">
			<h2 className="text-sm font-medium text-muted-foreground">Cómo te leen los agentes</h2>
			<div className="grid gap-3 lg:grid-cols-2">
				<Card className="shadow-none flex flex-col gap-3 py-4">
					<CardHeader className="gap-1">
						{titleWithTooltip(
							"AOS — Agent Operability",
							"Si un agente puede operar tu sitio: descubrimiento, identidad, capacidades y ejecución. El mismo número que reporta la auditoría de Maasy.",
						)}
					</CardHeader>
					<CardContent className="space-y-3">
						{aos === null ? (
							<EmptySection
								brandId={brandId}
								message="Todavía no auditamos el sitio."
								to="/app/$brand/agent-ops"
								cta="Correr la primera auditoría"
							/>
						) : (
							<>
								<div className="flex items-end gap-3">
									<BigScore score={aos.score} />
									<div className="pb-1.5 space-y-1">
										<BandChip label={aosBand(aos.band).label} level={aosBand(aos.band).level} />
										<p className="text-xs text-muted-foreground">
											{aos.passed} de {aos.applicable} requerimientos · {aos.businessType === "product_api" ? "producto/API" : "marca"}
										</p>
									</div>
								</div>
								<Progress value={aos.score} className="h-1.5" />
								{aos.failing.length > 0 ? (
									<div className="space-y-1.5">
										<p className="text-xs font-medium text-muted-foreground">Lo que falta</p>
										<div className="flex flex-wrap gap-1.5">
											{aos.failing.map((requirement) => (
												<span
													key={requirement.id}
													className="rounded-full border border-dashed border-foreground/25 px-2.5 py-0.5 text-xs text-foreground"
												>
													{requirement.title}
												</span>
											))}
										</div>
									</div>
								) : (
									<p className="text-xs text-muted-foreground">Sin pendientes en el rubric puntuado.</p>
								)}
								{aos.diagnosticsFailing > 0 && (
									<p className="text-xs text-muted-foreground">
										+{aos.diagnosticsFailing} chequeos del estándar fuera del puntaje (diagnóstico).
									</p>
								)}
								<Link
									to="/app/$brand/agent-ops"
									params={{ brand: brandId }}
									className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
								>
									Ver AOS
									<IconArrowRight className="h-3.5 w-3.5" />
								</Link>
							</>
						)}
					</CardContent>
				</Card>

				<Card className="shadow-none flex flex-col gap-3 py-4">
					<CardHeader className="gap-1">
						{titleWithTooltip(
							"APS — Agent Preference",
							"Si los modelos te prefieren y te recomiendan cuando un comprador pregunta sin nombrarte. Se mide contra modelos reales, no se declara.",
						)}
					</CardHeader>
					<CardContent className="space-y-3">
						{aps === null ? (
							<EmptySection
								brandId={brandId}
								message="Todavía no medimos la preferencia."
								to="/app/$brand/agent-preference"
								cta="Medir APS"
							/>
						) : (
							<>
								<div className="flex items-end gap-3">
									<BigScore score={aps.aps} />
									<div className="pb-1.5 space-y-1">
										<BandChip label={apsBand(aps.band).label} level={apsBand(aps.band).level} />
										<p className="text-xs text-muted-foreground">
											{new Date(aps.createdAt).toLocaleDateString()} · {aps.answered} de {aps.planned} respuestas
										</p>
									</div>
								</div>
								<Progress value={aps.aps} className="h-1.5" />
								<div className="space-y-1">
									{aps.models.map((model) => (
										<div key={model.model} className="flex items-center gap-2 text-xs">
											<span className="w-32 truncate font-mono">{model.model}</span>
											<span className="font-semibold tabular-nums text-believe-900">{model.aps}</span>
											<ApsMiniBand aps={model.aps} p10={model.p10} p90={model.p90} />
											<span className="text-muted-foreground">
												{model.observations} respuestas
												{model.recommendationProbability === null ? "" : ` · P(recomendación) ${model.recommendationProbability}%`}
											</span>
										</div>
									))}
								</div>
								{aps.partial && (
									<p className="text-xs text-muted-foreground">
										<span className={MONO_LABEL}>parcial</span> · {aps.partialReason ?? `${aps.answered} de ${aps.planned}`}
									</p>
								)}
								<Link
									to="/app/$brand/agent-preference"
									params={{ brand: brandId }}
									className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
								>
									Ver APS
									<IconArrowRight className="h-3.5 w-3.5" />
								</Link>
							</>
						)}
					</CardContent>
				</Card>
			</div>
		</section>
	);
}
