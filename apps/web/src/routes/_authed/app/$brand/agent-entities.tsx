import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useBrand } from "@/hooks/use-brands";
import { linkMaasyProjectFn, listAgentEntitiesFn, listMaasyBrandsFn } from "@/server/agent-maasy";

export const Route = createFileRoute("/_authed/app/$brand/agent-entities")({
component: AgentEntitiesPage,
});

function AgentEntitiesPage() {
const { brand, isLoading } = useBrand();
const [maasyBrands, setMaasyBrands] = useState<{ id: string; name: string }[]>([]);
const [error, setError] = useState<string | null>(null);
const brandId = brand?.id;

const entities = useQuery({
queryKey: ["agent-entities", brandId],
queryFn: () => listAgentEntitiesFn({ data: { brandId: brandId ?? "" } }),
enabled: Boolean(brandId),
});

const link = useMutation({
mutationFn: async (brand: { id: string; name: string }) => {
if (brandId === undefined) throw new Error("Brand not loaded");
return linkMaasyProjectFn({
data: {
brandId,
projectId: brand.id,
name: brand.name,
entityType: "product",
isPrimary: false,
},
});
},
onSuccess: async () => {
setError(null);
await entities.refetch();
},
onError: (mutationError) => {
setError(mutationError instanceof Error ? mutationError.message : "No se pudo vincular");
},
});

async function loadMaasy() {
try {
setError(null);
const brands = await listMaasyBrandsFn();
setMaasyBrands(brands);
} catch (loadError) {
setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las marcas de Maasy");
}
}

if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
if (brand === undefined) return <div className="text-sm text-red-600">Brand no encontrado.</div>;

return (
<div className="space-y-6 max-w-5xl">
<div>
<h1 className="text-3xl font-bold">Agent Entities</h1>
<p className="text-muted-foreground">
Vincula proyectos de Maasy a esta marca para traer su Brand DNA por MCP.
</p>
</div>

<Card>
<CardHeader>
<CardTitle>Entidades vinculadas</CardTitle>
<CardDescription>Proyectos Maasy asociados a {brand.name}.</CardDescription>
</CardHeader>
<CardContent className="space-y-2 text-sm">
{(entities.data ?? []).map((entity) => (
<div key={entity.id} className="flex items-center justify-between border-b py-2 last:border-b-0">
<span>{entity.name}</span>
<span className="font-mono text-xs text-muted-foreground">{entity.maasyProjectId ?? "—"}</span>
</div>
))}
{(entities.data ?? []).length === 0 && <p className="text-muted-foreground">Todavía no hay entidades vinculadas.</p>}
</CardContent>
</Card>

<Card>
<CardHeader>
<CardTitle>Marcas en Maasy</CardTitle>
<CardDescription>Descubre y vincula proyectos de Maasy.</CardDescription>
</CardHeader>
<CardContent className="space-y-3">
<Button variant="outline" onClick={() => void loadMaasy()}>Cargar marcas Maasy</Button>
{error && <p className="text-sm text-red-600">{error}</p>}
{maasyBrands.map((maasyBrand) => (
<div key={maasyBrand.id} className="flex items-center justify-between border-b py-2 text-sm last:border-b-0">
<span>{maasyBrand.name}</span>
<Button size="sm" variant="outline" onClick={() => link.mutate(maasyBrand)} disabled={link.isPending}>
Vincular
</Button>
</div>
))}
</CardContent>
</Card>
</div>
);
}
