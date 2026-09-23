import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useBrand } from "@/hooks/use-brands";
import { listAgentEntitiesFn } from "@/server/agent-maasy";
import { generateAgentAssetsFn, getAgentAssetsFn, setAgentEntityPublishedFn } from "@/server/agent-assets";

export const Route = createFileRoute("/_authed/app/$brand/agent-assets")({
component: AgentAssetsPage,
});

function AgentAssetsPage() {
const { brand, isLoading } = useBrand();
const [entityId, setEntityId] = useState("");
const [error, setError] = useState<string | null>(null);
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

const assets = useQuery({
queryKey: ["agent-assets", brandId, entityId],
queryFn: () => getAgentAssetsFn({ data: { brandId: brandId ?? "", entityId } }),
enabled: Boolean(brandId && entityId),
});

const generate = useMutation({
mutationFn: async () => {
if (brandId === undefined || entityId.length === 0) throw new Error("Selecciona una entidad");
return generateAgentAssetsFn({ data: { brandId, entityId } });
},
onSuccess: async () => {
setError(null);
await assets.refetch();
},
onError: (mutationError) => {
setError(mutationError instanceof Error ? mutationError.message : "No se pudieron generar los assets");
},
});

const selected = (entities.data ?? []).find((entity) => entity.id === entityId);

const togglePublished = useMutation({
mutationFn: async () => {
if (brandId === undefined || selected === undefined) throw new Error("Selecciona una entidad");
return setAgentEntityPublishedFn({ data: { brandId, entityId, published: selected.isPublished === false } });
},
onSuccess: async () => {
setError(null);
await entities.refetch();
},
onError: (mutationError) => {
setError(mutationError instanceof Error ? mutationError.message : "No se pudo cambiar la publicación");
},
});

function download(asset: { path: string; type: string; content: string }) {
const blob = new Blob([asset.content], { type: asset.type });
const url = URL.createObjectURL(blob);
const anchor = document.createElement("a");
anchor.href = url;
anchor.download = asset.path.split("/").pop() ?? "asset.txt";
anchor.click();
URL.revokeObjectURL(url);
}

if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
if (brand === undefined) return <div className="text-sm text-red-600">Brand no encontrado.</div>;

return (
<div className="space-y-6 max-w-5xl">
<div>
<h1 className="text-3xl font-bold">Agent Assets</h1>
<p className="text-muted-foreground">Genera llms.txt, AGENTS.md, agent-card.json y brand.json firmado.</p>
</div>

<Card>
<CardHeader>
<CardTitle>Generar assets</CardTitle>
<CardDescription>Selecciona la entidad y genera los archivos base.</CardDescription>
</CardHeader>
<CardContent className="space-y-3">
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
<div className="flex gap-2">
<Button onClick={() => generate.mutate()} disabled={generate.isPending || entityId.length === 0}>
{generate.isPending ? "Generando…" : "Generar assets"}
</Button>
</div>
{error && <p className="text-sm text-red-600">{error}</p>}
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Publicación</CardTitle>
<CardDescription>
Cerrado por defecto: nada se entrega a un agente hasta que lo publiques. Un perfil sin publicar
no se sirve, y uno firmado con la llave equivocada tampoco debería publicarse.
</CardDescription>
</CardHeader>
<CardContent className="flex items-center justify-between gap-3">
<span className="text-sm">
{selected === undefined
? "Selecciona una entidad"
: selected.isPublished
? `Publicado${selected.publishedAt ? ` el ${selected.publishedAt.slice(0, 10)}` : ""}`
: "Sin publicar"}
</span>
<Button
size="sm"
variant={selected?.isPublished ? "outline" : "default"}
onClick={() => togglePublished.mutate()}
disabled={selected === undefined || togglePublished.isPending}
>
{selected?.isPublished ? "Despublicar" : "Publicar"}
</Button>
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Assets generados</CardTitle>
<CardDescription>Última versión por archivo.</CardDescription>
</CardHeader>
<CardContent className="space-y-2 text-sm">
{(assets.data ?? []).map((asset) => (
<div key={asset.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
<div className="min-w-0">
<div className="font-mono text-xs">{asset.path}</div>
<div className="text-xs text-muted-foreground">{asset.type} · {asset.hash.slice(0, 12)}</div>
</div>
<Button size="sm" variant="outline" onClick={() => download(asset)}>Descargar</Button>
</div>
))}
{(assets.data ?? []).length === 0 && <p className="text-muted-foreground">Todavía no hay assets generados.</p>}
</CardContent>
</Card>
</div>
);
}
