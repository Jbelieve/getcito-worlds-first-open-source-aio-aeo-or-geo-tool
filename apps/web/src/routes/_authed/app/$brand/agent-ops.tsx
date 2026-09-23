import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { useBrand } from "@/hooks/use-brands";
import { getAosAuditsFn, startAosAuditFn } from "@/server/agent-ops";
import {
	type AosRequirement,
	AosChecklist,
	AosJourney,
	AosNextStep,
	AosScoreRing,
	AosStatusPill,
	aosDiagnosis,
	stageSummaries,
} from "@/components/aos-visual";
import { BLOCKING_TEXT, aosBand, levelFromScore, toneOf } from "@/components/status-tone";

export const Route = createFileRoute("/_authed/app/$brand/agent-ops")({
	component: AgentOpsPage,
});

/** Los cortes de banda del AOS. La regla vive acá, el color vive en status-tone. */
const AOS_CUTS = { full: 80, high: 60, mid: 35 };

function scoreColor(score: number | null | undefined): string {
	if (score === null || score === undefined) return "text-muted-foreground";
	return toneOf(levelFromScore(score, AOS_CUTS)).text;
}

function AgentOpsPage() {
	const { brand, isLoading } = useBrand();
	const [url, setUrl] = useState("");
	const [error, setError] = useState<string | null>(null);
	const brandId = brand?.id;

	useEffect(() => {
		if (brand?.website && url.length === 0) setUrl(brand.website);
	}, [brand?.website, url.length]);

	const audits = useQuery({
		queryKey: ["aos-audits", brandId],
		queryFn: () => getAosAuditsFn({ data: { brandId: brandId ?? "" } }),
		enabled: Boolean(brandId),
		refetchInterval: 4000,
	});

	const start = useMutation({
		mutationFn: async () => {
			if (brandId === undefined) throw new Error("Brand not loaded");
			return startAosAuditFn({ data: { brandId, url } });
		},
		onSuccess: async () => {
			setError(null);
			await audits.refetch();
		},
		onError: (mutationError) => {
			setError(mutationError instanceof Error ? mutationError.message : "No se pudo iniciar la auditoría");
		},
	});

	if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
	if (brand === undefined) return <div className={`text-sm ${BLOCKING_TEXT}`}>Brand no encontrado.</div>;

	const latest = audits.data?.[0];
	const requirements = (latest?.requirements ?? []) as AosRequirement[];
	const scored = requirements.filter((requirement) => requirement.diagnostic !== true);
	const failing = scored.filter((requirement) => requirement.status === "fail");
	const stages = stageSummaries(requirements);
	const stagesDone = stages.filter((stage) => stage.status === "listo").length;
	const score = latest?.score ?? null;
	const bandName = latest?.band ?? "";
	const signatureVerified = latest?.standards?.signature_verified === true;

	return (
		<div className="space-y-6 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold">AOS</h1>
				<p className="text-muted-foreground">
					Agent Operability Score: si un agente puede encontrarte, entenderte, operarte y verificarte. Mismo número
					que la auditoría de Maasy.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Auditar sitio</CardTitle>
					<CardDescription>Corre el AOS sobre la URL principal de la marca.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-col gap-2 sm:flex-row">
						<Input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://mi-marca.com" />
						<Button onClick={() => start.mutate()} disabled={start.isPending || url.length === 0}>
							{start.isPending ? "Auditando…" : "Auditar AOS"}
						</Button>
					</div>
					{error && <p className={`text-sm ${BLOCKING_TEXT}`}>{error}</p>}
				</CardContent>
			</Card>

			{latest && (
				<>
					<Card>
						<CardContent className="space-y-5 pt-6">
							{latest.error && <p className={`text-sm ${BLOCKING_TEXT}`}>Error: {latest.error}</p>}
							<div className="flex flex-wrap items-center gap-6">
								<AosScoreRing score={score ?? 0} band={bandName} />
								<div className="min-w-[16rem] flex-1 space-y-3">
									<AosStatusPill band={bandName} />
									<p className="text-sm">{aosDiagnosis(score ?? 0, failing)}</p>
									<p className="text-xs text-muted-foreground">
										{stagesDone} de {stages.length} etapas hacia “el agente te prefiere”
										{latest.businessType === "product_api" ? " · se evalúa como producto/API" : " · se evalúa como marca"}
										{" · "}
										{failing.length === 0 ? "sin pendientes" : `${failing.length} ${failing.length === 1 ? "pendiente" : "pendientes"}`}
									</p>
									<Button variant="outline" size="sm" asChild>
										<a href={latest.url} target="_blank" rel="noreferrer">
											Ver en la página
										</a>
									</Button>
								</div>
							</div>
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>El camino de un agente</CardTitle>
							<CardDescription>
								Cada etapa se puntúa con los requerimientos que le importan a ese paso. Los puntos salen del rubric;
								lo que no puntúa se marca como tal.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-6">
							<AosJourney stages={stages} />
							<AosNextStep failing={failing} />
						</CardContent>
					</Card>

					<Card>
						<CardHeader>
							<CardTitle>Detalle técnico</CardTitle>
							<CardDescription>
								Estándar AOS/APS v0.1.0 · {latest.businessType === "product_api" ? "marca / producto-API" : "marca / servicio"} ·
								{" "}
								{signatureVerified ? "firma Ed25519 verificada" : "sin firma verificable"}
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-5">
							<AosChecklist requirements={requirements} />

							{latest.apsBreakdown && latest.apsScore !== null && (
								<div className="space-y-2 rounded-lg border p-4">
									<p className="text-sm font-medium">
										APS del perfil declarado: {latest.apsScore}
										<span className="ml-2 text-xs font-normal text-muted-foreground">
											según los claims y proofs que el sitio sirve y firma
										</span>
									</p>
									<div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
										<span className="text-muted-foreground">
											Cobertura de proofs: <span className="font-medium text-foreground">{latest.apsBreakdown.proof_coverage}</span>
										</span>
										<span className="text-muted-foreground">
											Boundaries: <span className="font-medium text-foreground">{latest.apsBreakdown.boundary_coverage}</span>
										</span>
										<span className="text-muted-foreground">
											Fuerza de evidencia: <span className="font-medium text-foreground">{latest.apsBreakdown.evidence_strength}</span>
										</span>
										<span className="text-muted-foreground">
											Smoke penalty: <span className="font-medium text-foreground">{latest.apsBreakdown.smoke_penalty}</span>
										</span>
									</div>
									<p className="text-xs text-muted-foreground">
										{latest.apsBreakdown.claims} claims · {latest.apsBreakdown.proofs} proofs ·{" "}
										{latest.apsBreakdown.unproven_claims} sin proof · {latest.apsBreakdown.claims_without_boundary} sin boundary real
										{latest.apsBreakdown.signed_provenance_applied ? " · la firma válida sube la evidencia a 0.8" : ""}
									</p>
									<p className="text-xs text-muted-foreground">
										Esto es lo que el sitio <span className="font-medium text-foreground">declara</span>. El APS de la sección APS
										mide además si los modelos te <span className="font-medium text-foreground">prefieren</span> de verdad.
									</p>
								</div>
							)}
						</CardContent>
					</Card>
				</>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Historial</CardTitle>
					<CardDescription>Últimas auditorías AOS de esta marca.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					{(audits.data ?? []).map((audit) => (
						<div key={audit.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
							<span className="truncate text-muted-foreground">{audit.url}</span>
							<span className="flex items-center gap-2">
								<span className={`font-semibold ${scoreColor(audit.score)}`}>{audit.score ?? "—"}</span>
								<span className={`text-xs ${aosBand(audit.band).tone.text}`}>{aosBand(audit.band).label}</span>
							</span>
						</div>
					))}
					{(audits.data ?? []).length === 0 && (
						<p className="text-muted-foreground">Todavía no hay auditorías. Corre la primera arriba.</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
