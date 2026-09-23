import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useBrand } from "@/hooks/use-brands";
import { listAgentEntitiesFn } from "@/server/agent-maasy";
import {
estimateApsRunFn,
generateApsLibraryFn,
getGatewayBudgetFn,
getApsLibraryFn,
getApsRunsFn,
saveApsLibraryFn,
startApsRunFn,
} from "@/server/agent-aps";

export const Route = createFileRoute("/_authed/app/$brand/agent-preference")({
component: AgentPreferencePage,
});

const BANDS: Record<string, { label: string; className: string }> = {
agent_native: { label: "Agent-Native", className: "text-emerald-600" },
agent_ready: { label: "Agent-Ready", className: "text-emerald-600" },
agent_visible: { label: "Agent-Visible", className: "text-amber-600" },
agent_opaque: { label: "Agent-Opaque", className: "text-orange-600" },
agent_blind: { label: "Agent-Blind", className: "text-red-600" },
};

function bandLabel(band: string): string {
return BANDS[band]?.label ?? band;
}

function bandColor(band: string): string {
return BANDS[band]?.className ?? "text-muted-foreground";
}

function statusLabel(status: string): string {
const labels: Record<string, string> = {
planned: "Planificada",
capturing: "Capturando respuestas",
parsing: "Analizando con el juez",
scoring: "Puntuando",
done: "Completa",
failed: "Fallida",
budget_exceeded: "Frenada por presupuesto",
};
return labels[status] ?? status;
}

function AgentPreferencePage() {
const { brand, isLoading } = useBrand();
const [entityId, setEntityId] = useState("");
const [error, setError] = useState<string | null>(null);
const [candidates, setCandidates] = useState<Array<{ text: string; kind: string; funnelStage: string }>>([]);
const [rejectedCount, setRejectedCount] = useState(0);
const brandId = brand?.id;

const entities = useQuery({
queryKey: ["agent-entities", brandId],
queryFn: () => listAgentEntitiesFn({ data: { brandId: brandId ?? "" } }),
enabled: Boolean(brandId),
});

useEffect(() => {
if (entityId.length === 0 && entities.data !== undefined && entities.data.length > 0) {
setEntityId(entities.data[0].id);
}
}, [entities.data, entityId]);

const library = useQuery({
queryKey: ["aps-library", brandId, entityId],
queryFn: () => getApsLibraryFn({ data: { brandId: brandId ?? "", entityId } }),
enabled: Boolean(brandId && entityId),
});

const gateway = useQuery({
queryKey: ["aps-gateway-budget"],
queryFn: () => getGatewayBudgetFn(),
staleTime: 60_000,
});

const runs = useQuery({
queryKey: ["aps-runs", brandId],
queryFn: () => getApsRunsFn({ data: { brandId: brandId ?? "" } }),
enabled: Boolean(brandId),
refetchInterval: 5000,
});

const generate = useMutation({
mutationFn: async () => {
if (brandId === undefined) throw new Error("Brand no cargado");
return generateApsLibraryFn({ data: { brandId } });
},
onSuccess: (result) => {
if (result.ok === false) {
setError(result.reason);
setCandidates([]);
return;
}
setError(null);
setCandidates(result.prompts);
setRejectedCount(result.rejected.length);
},
onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : "No se pudo generar"),
});

const save = useMutation({
mutationFn: async () => {
if (brandId === undefined || entityId.length === 0) throw new Error("Selecciona una entidad");
return saveApsLibraryFn({
data: {
brandId,
entityId,
prompts: candidates.map((prompt) => ({
text: prompt.text,
kind: prompt.kind as "comparison" | "use_case" | "category",
funnelStage: prompt.funnelStage as "awareness" | "consideration" | "decision",
})),
},
});
},
onSuccess: async () => {
setError(null);
setCandidates([]);
await library.refetch();
},
onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : "No se pudo guardar"),
});

const estimate = useMutation({
mutationFn: async () => {
if (brandId === undefined || entityId.length === 0) throw new Error("Selecciona una entidad");
return estimateApsRunFn({ data: { brandId, entityId } });
},
});

const start = useMutation({
mutationFn: async () => {
if (brandId === undefined || entityId.length === 0) throw new Error("Selecciona una entidad");
return startApsRunFn({ data: { brandId, entityId } });
},
onSuccess: async (result) => {
if (result.ok === false) {
setError(result.reasons.join(" "));
return;
}
setError(null);
await runs.refetch();
},
onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : "No se pudo iniciar"),
});

if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
if (brand === undefined) return <div className="text-sm text-red-600">Brand no encontrado.</div>;

const active = library.data?.library;
const estimateData = estimate.data;

return (
<div className="space-y-6 max-w-5xl">
<div>
<h1 className="text-3xl font-bold">Agent Preference</h1>
<p className="text-muted-foreground">
APS medido contra modelos reales: biblioteca de prompts unaided, corridas on-demand y su varianza.
</p>
</div>

<Card>
<CardHeader>
<CardTitle>Entidad</CardTitle>
<CardDescription>El APS se mide por entidad, con la biblioteca de esa entidad.</CardDescription>
</CardHeader>
<CardContent>
<select
className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
value={entityId}
onChange={(event) => setEntityId(event.target.value)}
>
<option value="">Selecciona una entidad</option>
{(entities.data ?? []).map((entity) => (
<option key={entity.id} value={entity.id}>{entity.name}</option>
))}
</select>
{error && <p className="pt-3 text-sm text-red-600">{error}</p>}
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Biblioteca de prompts</CardTitle>
<CardDescription>
El instrumento de medición. Se bloquea 90 días: mientras dura el lock la serie es comparable.
</CardDescription>
</CardHeader>
<CardContent className="space-y-3 text-sm">
{active === undefined || active === null ? (
<p className="text-muted-foreground">Esta entidad todavía no tiene biblioteca activa.</p>
) : (
<div className="space-y-1">
<p>
Versión <span className="font-mono">{active.version}</span> · {active.promptCount} prompts habilitados ·{" "}
{Object.entries(library.data?.counts ?? {}).map(([kind, count]) => `${kind}: ${count}`).join(" · ")}
</p>
<p className="text-xs text-muted-foreground">
Bloqueada hasta {active.unlocksAt.slice(0, 10)} ·{" "}
{library.data?.canRegenerate?.allowed ? "se puede regenerar" : "bloqueada"}
</p>
</div>
)}

<div className="flex flex-wrap gap-2 pt-1">
<Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>
{generate.isPending ? "Generando…" : "Generar 50 prompts unaided"}
</Button>
{candidates.length > 0 && (
<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
{save.isPending ? "Guardando…" : `Guardar y bloquear (${candidates.length})`}
</Button>
)}
</div>

{candidates.length > 0 && (
<div className="space-y-2 rounded-md border p-3">
<div className="flex gap-3 text-xs text-muted-foreground">
<span>{candidates.length} candidatos</span>
<span>{rejectedCount} descartados por el generador</span>
<span>La validación unaided corre al guardar</span>
</div>
<ul className="max-h-64 space-y-1 overflow-y-auto text-xs">
{candidates.slice(0, 60).map((prompt) => (
<li key={prompt.text} className="flex gap-2">
<code className="font-mono text-muted-foreground">{prompt.kind}</code>
<span>{prompt.text}</span>
</li>
))}
</ul>
</div>
)}
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Corrida on-demand</CardTitle>
<CardDescription>
Primero la estimación; nada se ejecuta ni se gasta hasta que confirmes.
</CardDescription>
</CardHeader>
<CardContent className="space-y-3 text-sm">
{gateway.data?.budget && (
<p className="text-xs text-muted-foreground">
Gateway ({gateway.data.budget.models.join(", ") || "sin bandas"}): gastado USD{" "}
{gateway.data.budget.spend.toFixed(2)}
{gateway.data.budget.maxBudget === null ? "" : ` de ${gateway.data.budget.maxBudget}`}
{gateway.data.remainingUsd === null ? "" : ` · quedan USD ${gateway.data.remainingUsd.toFixed(2)}`}
{gateway.data.budget.budgetResetAt === null ? "" : ` · reinicia ${gateway.data.budget.budgetResetAt.slice(0, 10)}`}
</p>
)}
{gateway.data?.configured === false && (
<p className="text-xs text-amber-600">Gateway sin configurar: la generacion y el juez no van a funcionar.</p>
)}
<div className="flex flex-wrap gap-2">
<Button size="sm" variant="outline" onClick={() => estimate.mutate()} disabled={estimate.isPending || entityId.length === 0}>
{estimate.isPending ? "Estimando…" : "Estimar corrida"}
</Button>
<Button
size="sm"
onClick={() => start.mutate()}
disabled={start.isPending || entityId.length === 0 || estimateData?.status !== "ready"}
>
{start.isPending ? "Iniciando…" : "Confirmar y ejecutar"}
</Button>
</div>

{estimateData && (
<div className="space-y-1 rounded-md border p-3 text-xs">
<p>
{estimateData.status === "ready" ? "Listo para correr" : "Bloqueado"} · {estimateData.estimate?.calls ?? 0} llamadas ·{" "}
{estimateData.prompts} prompts · {estimateData.models.length} modelos ·{" "}
{estimateData.estimate?.totalUsd === null || estimateData.estimate === null
? "sin total en dólares"
: `≈ USD ${estimateData.estimate.totalUsd}`}
</p>
<p className="text-muted-foreground">
AOS usado como capacidad de acción: {estimateData.capacidadAccion ?? "sin auditoría"} · biblioteca v
{estimateData.libraryVersion ?? "—"}
</p>
{estimateData.reasons.length > 0 && <p className="text-amber-600">{estimateData.reasons.join(" ")}</p>}
</div>
)}
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Corridas</CardTitle>
<CardDescription>Una fila por modelo: el APS nunca mezcla respuestas de modelos distintos.</CardDescription>
</CardHeader>
<CardContent className="space-y-3 text-sm">
{(runs.data ?? []).map((run) => (
<div key={run.id} className="space-y-2 border-b py-3 last:border-b-0">
<div className="flex flex-wrap items-center justify-between gap-2">
<span className="text-muted-foreground">
{new Date(run.createdAt).toLocaleString()} · {statusLabel(run.status)} · {run.completedCalls}/{run.plannedCalls} llamadas
</span>
<span className="font-mono text-xs">
v{run.promptLibraryVersion} · {run.judgeModelAlias}@{run.judgeModelVersion} · {run.measurementVersion}
</span>
</div>
{run.repetitionsReduced && (
<p className="text-xs text-amber-600">Medición parcial: se redujeron las repeticiones para entrar en el presupuesto.</p>
)}
{run.error && <p className="text-xs text-red-600">{run.error}</p>}
{run.scores.length > 0 && (
<ul className="space-y-1 text-xs">
{run.scores.map((score) => (
<li key={score.model} className="flex flex-wrap items-center gap-2">
<code className="font-mono">{score.model}</code>
<span className={`font-semibold ${bandColor(score.band)}`}>{score.aps}</span>
<span className={bandColor(score.band)}>{bandLabel(score.band)}</span>
<span className="text-muted-foreground">
P10 {score.p10 ?? "—"} · P50 {score.p50 ?? "—"} · P90 {score.p90 ?? "—"} · P(recomendación){" "}
{score.recommendationProbability ?? "—"}% · {score.observations} respuestas
</span>
</li>
))}
</ul>
)}
</div>
))}
{(runs.data ?? []).length === 0 && (
<p className="text-muted-foreground">Todavía no hay corridas. Genera la biblioteca y estima la primera.</p>
)}
</CardContent>
</Card>
</div>
);
}
