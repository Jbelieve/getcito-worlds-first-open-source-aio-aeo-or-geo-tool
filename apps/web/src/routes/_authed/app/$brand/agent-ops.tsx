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
Mide el AOS del sitio: descubrimiento, identidad, capacidades y ejecución.
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
</li>
))}
</ul>
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
