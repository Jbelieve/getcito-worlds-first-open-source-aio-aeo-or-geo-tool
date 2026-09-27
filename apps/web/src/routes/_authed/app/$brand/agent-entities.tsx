import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useState } from "react";
import { BLOCKING_TEXT } from "@/components/status-tone";
import { useBrand } from "@/hooks/use-brands";
import { hostOf } from "@/lib/report-agent";
import {
	createAgentEntityFn,
	getAgentDnaSnapshotsFn,
	linkMaasyProjectFn,
	listAgentEntitiesFn,
	listMaasyBrandsFn,
	syncAgentDnaFn,
} from "@/server/agent-maasy";

export const Route = createFileRoute("/_authed/app/$brand/agent-entities")({
	component: AgentEntitiesPage,
});

type EntityType = "umbrella" | "product";

const EMPTY_FORM = {
	name: "",
	website: "",
	entityType: "product" as EntityType,
	parentEntityId: "",
	maasyProjectId: "",
};

const FIELD_CLASS = "h-9 w-full rounded-md border border-input bg-background px-3 text-sm";

function AgentEntitiesPage() {
	const { brand, isLoading } = useBrand();
	const [maasyBrands, setMaasyBrands] = useState<{ id: string; name: string }[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [form, setForm] = useState(EMPTY_FORM);
	// Se llena cuando la web o el proyecto ya son de una entidad de la marca. La creación es idempotente
	// (por host y por proyecto de Maasy), así que en vez de duplicar se reusa esa entidad: hay que decirlo
	// y pedir confirmación antes de pisarla.
	const [confirming, setConfirming] = useState<{
		entityId: string;
		name: string;
		reason: "web" | "maasy";
	} | null>(null);
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
					entityType: (entities.data ?? []).length === 0 ? "umbrella" : "product",
					isPrimary: (entities.data ?? []).length === 0,
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

	/** La entidad de la marca que ya reclama esa web o ese proyecto, si existe. */
	function existingMatch(): { entityId: string; name: string; reason: "web" | "maasy" } | null {
		const list = entities.data ?? [];
		const host = hostOf(form.website);
		if (host !== null) {
			const byHost = list.find((entity) => hostOf(entity.websiteUrl) === host);
			if (byHost !== undefined) return { entityId: byHost.id, name: byHost.name, reason: "web" };
		}
		const project = form.maasyProjectId.trim();
		if (project.length > 0) {
			const byProject = list.find((entity) => entity.maasyProjectId === project);
			if (byProject !== undefined) return { entityId: byProject.id, name: byProject.name, reason: "maasy" };
		}
		return null;
	}

	const create = useMutation({
		mutationFn: async () => {
			if (brandId === undefined) throw new Error("Brand not loaded");
			return createAgentEntityFn({
				data: {
					brandId,
					name: form.name.trim(),
					entityType: form.entityType,
					websiteUrl: form.website.trim().length > 0 ? form.website.trim() : undefined,
					parentEntityId: form.parentEntityId.length > 0 ? form.parentEntityId : undefined,
					maasyProjectId: form.maasyProjectId.trim().length > 0 ? form.maasyProjectId.trim() : undefined,
				},
			});
		},
		onSuccess: async (result) => {
			setError(null);
			setNotice(
				result.created
					? `Entidad creada: ${result.entityId}.`
					: `Entidad existente reusada y actualizada: ${result.entityId}.`,
			);
			setConfirming(null);
			setForm(EMPTY_FORM);
			await entities.refetch();
		},
		onError: (mutationError) => {
			setError(mutationError instanceof Error ? mutationError.message : "No se pudo crear la entidad");
		},
	});

	function updateForm(patch: Partial<typeof EMPTY_FORM>) {
		setForm((current) => ({ ...current, ...patch }));
		setConfirming(null);
		setNotice(null);
	}

	function submit() {
		setError(null);
		setNotice(null);
		if (form.name.trim().length === 0) {
			setError("El nombre de la entidad es obligatorio.");
			return;
		}
		const match = existingMatch();
		if (match !== null && confirming?.entityId !== match.entityId) {
			setConfirming(match);
			return;
		}
		create.mutate();
	}

	const dnaSnapshots = useQuery({
		queryKey: ["agent-dna", brandId],
		queryFn: () => getAgentDnaSnapshotsFn({ data: { brandId: brandId ?? "" } }),
		enabled: Boolean(brandId),
	});

	const syncDna = useMutation({
		mutationFn: async (entity: { id: string; maasyProjectId: string | null }) => {
			if (brandId === undefined || entity.maasyProjectId === null) throw new Error("Entidad sin proyecto Maasy");
			return syncAgentDnaFn({ data: { brandId, entityId: entity.id, projectId: entity.maasyProjectId } });
		},
		onSuccess: async () => {
			setError(null);
			await dnaSnapshots.refetch();
		},
		onError: (mutationError) => {
			setError(mutationError instanceof Error ? mutationError.message : "No se pudo sincronizar Brand DNA");
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
	if (brand === undefined) return <div className={`text-sm ${BLOCKING_TEXT}`}>Brand no encontrado.</div>;

	return (
		<div className="space-y-6 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold">Agent Entities</h1>
				<p className="text-muted-foreground">
					Crea entidades a mano o vincula proyectos de Maasy; las dos vías traen su Brand DNA por MCP.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Crear entidad</CardTitle>
					<CardDescription>
						Para las entidades que no están en Maasy. Si la web o el proyecto ya pertenecen a una entidad de{" "}
						{brand.name}, se reusa esa en vez de duplicarla.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="grid gap-3 sm:grid-cols-2">
						<label className="space-y-1 text-sm">
							<span className="text-muted-foreground">Nombre</span>
							<input
								className={FIELD_CLASS}
								value={form.name}
								onChange={(event) => updateForm({ name: event.target.value })}
								placeholder="Autex Porsche Center"
							/>
						</label>
						<label className="space-y-1 text-sm">
							<span className="text-muted-foreground">Web (opcional)</span>
							<input
								className={FIELD_CLASS}
								value={form.website}
								onChange={(event) => updateForm({ website: event.target.value })}
								placeholder="https://autex.porsche.com"
							/>
						</label>
						<label className="space-y-1 text-sm">
							<span className="text-muted-foreground">Tipo</span>
							<select
								className={FIELD_CLASS}
								value={form.entityType}
								onChange={(event) => updateForm({ entityType: event.target.value as EntityType })}
							>
								<option value="umbrella">Paraguas</option>
								<option value="product">Producto</option>
							</select>
						</label>
						<label className="space-y-1 text-sm">
							<span className="text-muted-foreground">Entidad padre (opcional)</span>
							<select
								className={FIELD_CLASS}
								value={form.parentEntityId}
								onChange={(event) => updateForm({ parentEntityId: event.target.value })}
							>
								<option value="">Sin padre</option>
								{(entities.data ?? []).map((entity) => (
									<option key={entity.id} value={entity.id}>
										{entity.name}
									</option>
								))}
							</select>
						</label>
						<label className="space-y-1 text-sm">
							<span className="text-muted-foreground">Proyecto de Maasy (opcional)</span>
							<input
								className={FIELD_CLASS}
								value={form.maasyProjectId}
								onChange={(event) => updateForm({ maasyProjectId: event.target.value })}
								placeholder="id del proyecto en Maasy"
							/>
						</label>
					</div>

					{confirming !== null && (
						<p className="text-sm text-muted-foreground">
							{confirming.reason === "web"
								? `Ya hay una entidad de la marca con esa web: «${confirming.name}».`
								: `Ese proyecto de Maasy ya está vinculado a «${confirming.name}».`}{" "}
							Se va a usar esa entidad y actualizarla, no se crea una duplicada. Confirmá para seguir.
						</p>
					)}

					<div className="flex gap-2">
						<Button
							onClick={() => submit()}
							disabled={create.isPending || form.name.trim().length === 0}
							variant={confirming !== null ? "outline" : "default"}
						>
							{create.isPending ? "Creando…" : confirming !== null ? "Confirmar y usar esa entidad" : "Crear entidad"}
						</Button>
						{confirming !== null && (
							<Button variant="outline" onClick={() => setConfirming(null)} disabled={create.isPending}>
								Cancelar
							</Button>
						)}
					</div>
					{notice && <p className="text-sm text-muted-foreground">{notice}</p>}
					{error && <p className={`text-sm ${BLOCKING_TEXT}`}>{error}</p>}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Entidades de la marca</CardTitle>
					<CardDescription>Las que existen hoy, vengan de la UI o de Maasy.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					{(entities.data ?? []).map((entity) => {
						const snapshot = dnaSnapshots.data?.find((item) => item.entityId === entity.id);
						return (
							<div key={entity.id} className="flex items-center justify-between gap-3 border-b py-2 last:border-b-0">
								<div className="min-w-0">
									<div>{entity.name}</div>
									<div className="font-mono text-xs text-muted-foreground">
										{entity.websiteUrl ?? "sin web"} · {entity.maasyProjectId ?? "sin Maasy"}
									</div>
									{snapshot && (
										<div className="text-xs text-muted-foreground">
											DNA: {snapshot.syncedAt.slice(0, 10)} · {snapshot.hash.slice(0, 8)}
										</div>
									)}
								</div>
								<Button
									size="sm"
									variant="outline"
									onClick={() => syncDna.mutate(entity)}
									disabled={syncDna.isPending || entity.maasyProjectId === null}
								>
									Sync DNA
								</Button>
							</div>
						);
					})}
					{(entities.data ?? []).length === 0 && (
						<p className="text-muted-foreground">Todavía no hay entidades vinculadas.</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Marcas en Maasy</CardTitle>
					<CardDescription>Descubre y vincula proyectos de Maasy.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<Button variant="outline" onClick={() => void loadMaasy()}>
						Cargar marcas Maasy
					</Button>
					{maasyBrands.map((maasyBrand) => (
						<div
							key={maasyBrand.id}
							className="flex items-center justify-between border-b py-2 text-sm last:border-b-0"
						>
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
