import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useBrand } from "@/hooks/use-brands";
import { getAosAuditsFn, startAosAuditFn } from "@/server/agent-ops";

export const Route = createFileRoute("/_authed/app/$brand/agent-ops")({
component: AgentOpsPage,
});

function scoreColor(score: number | null | undefined): string {
if (score === null || score === undefined) return "text-muted-foreground";
if (score >= 80) return "text-emerald-600";
if (score >= 60) return "text-amber-600";
if (score >= 35) return "text-orange-600";
return "text-red-600";
}

function ApsMetric({ label, value }: { label: string; value: number }) {
return (
<div className="rounded-md border px-2 py-1">
<div className="text-muted-foreground">{label}</div>
<div className="font-mono text-sm">{value.toFixed(2)}</div>
</div>
);
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

if (isLoading) {
return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
}

if (brand === undefined) {
return <div className="text-sm text-red-600">Brand no encontrado.</div>;
}

const latest = audits.data?.[0];

return (
<div className="space-y-6 max-w-5xl">
<div>
<h1 className="text-3xl font-bold">Agent Ops</h1>
<p className="text-muted-foreground">
Mide el AOS (operabilidad) y el APS (preferencia) del sitio: descubrimiento, identidad, capacidades, evidencia y firma.
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
{error && <p className="text-sm text-red-600">{error}</p>}
</CardContent>
</Card>

{latest && (
<Card>
<CardHeader>
<CardTitle>Último resultado</CardTitle>
<CardDescription>{latest.url}</CardDescription>
</CardHeader>
<CardContent className="space-y-4">
{latest.error && <p className="text-sm text-red-600">Error: {latest.error}</p>}
<div className="flex items-end gap-3">
<span className={`text-5xl font-bold ${scoreColor(latest.score)}`}>{latest.score ?? "—"}</span>
<span className="pb-2 text-sm font-medium text-muted-foreground">{latest.band ?? "Sin banda"}</span>
</div>
{latest.requirements && (
<ul className="space-y-2 text-sm">
{latest.requirements.map((requirement) => (
<li key={requirement.id} className="flex items-center gap-2">
<span>{requirement.status === "pass" ? "✅" : requirement.status === "n_a" ? "⬜" : "❌"}</span>
<code className="font-mono text-xs">{requirement.id}</code>
<span>{requirement.title}</span>
{requirement.diagnostic ? <span className="text-xs text-muted-foreground">· diagnóstico</span> : null}
</li>
))}
</ul>
)}
</CardContent>
</Card>
)}

{latest && (
<Card>
<CardHeader>
<CardTitle>Agent Preference Score</CardTitle>
<CardDescription>
APS del perfil servido en /.well-known/brand.json: claims, boundaries, proofs y firma Ed25519.
</CardDescription>
</CardHeader>
<CardContent className="space-y-3">
{latest.apsBreakdown && latest.apsScore !== null ? (
<>
<div className="flex items-end gap-3">
<span className={`text-5xl font-bold ${scoreColor(latest.apsScore)}`}>{latest.apsScore}</span>
<span className="pb-2 text-sm font-medium text-muted-foreground">
APS · {latest.scoringVersion ?? latest.apsBreakdown.scoring_version}
</span>
</div>
<div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
<ApsMetric label="Cobertura de proofs" value={latest.apsBreakdown.proof_coverage} />
<ApsMetric label="Cobertura de boundaries" value={latest.apsBreakdown.boundary_coverage} />
<ApsMetric label="Fuerza de evidencia" value={latest.apsBreakdown.evidence_strength} />
<ApsMetric label="Smoke penalty" value={latest.apsBreakdown.smoke_penalty} />
</div>
<p className="text-xs text-muted-foreground">
{latest.apsBreakdown.claims} claims · {latest.apsBreakdown.proofs} proofs · {latest.apsBreakdown.unproven_claims} sin proof ·{" "}
{latest.apsBreakdown.claims_without_boundary} sin boundary real
{latest.apsBreakdown.signed_provenance_applied ? " · firma verificada (signed_provenance 0.8)" : ""}
</p>
{latest.apsBreakdown.findings.length > 0 && (
<ul className="space-y-1 text-xs">
{latest.apsBreakdown.findings.slice(0, 6).map((finding, index) => (
<li key={`${finding.code}-${finding.ref ?? index}`} className="flex gap-2">
<span className={finding.level === "error" ? "text-red-600" : "text-amber-600"}>
{finding.level === "error" ? "✕" : "!"}
</span>
<code className="font-mono">{finding.code}</code>
<span className="text-muted-foreground">{finding.message}</span>
</li>
))}
</ul>
)}
</>
) : (
<p className="text-sm text-muted-foreground">
Sin APS: el sitio no sirve un brand.json con claims[] y proofs[]. Un perfil sin claims no se puntúa
como perfecto, se reporta como no medido.
</p>
)}
</CardContent>
</Card>
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
<span className={`font-semibold ${scoreColor(audit.score)}`}>{audit.score ?? "—"} {audit.band ?? ""}</span>
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
