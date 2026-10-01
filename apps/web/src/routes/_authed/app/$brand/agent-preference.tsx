import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useEffect, useState } from "react";
import { ApsRunBlock } from "@/components/aps-visual";
import { BLOCKING_TEXT } from "@/components/status-tone";
import { useBrand } from "@/hooks/use-brands";
import {
	CATEGORY_PLACEHOLDER,
	type GeneratorInputs,
	generateButtonLabel,
	generatorInputsNote,
	LIBRARY_ASKED_FOR,
	type LibraryGenerationReport,
	libraryReviewMessage,
} from "@/lib/aps/library-message";
import {
	estimateApsRunFn,
	generateApsLibraryFn,
	getApsLibraryFn,
	getApsRunsFn,
	getGatewayBudgetFn,
	saveApsLibraryFn,
	startApsRunFn,
} from "@/server/agent-aps";
import { listAgentEntitiesFn } from "@/server/agent-maasy";

export const Route = createFileRoute("/_authed/app/$brand/agent-preference")({
	component: AgentPreferencePage,
});

const KINDS: Array<{ key: string; label: string; target: number; hint: string }> = [
	{ key: "comparison", label: "Comparación", target: 50, hint: "“X vs Y”, “cuál me conviene”" },
	{ key: "use_case", label: "Caso de uso", target: 30, hint: "situaciones concretas de compra" },
	{ key: "category", label: "Categoría", target: 20, hint: "qué existe en la categoría" },
];

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
	// Lo que devolvió el gateway, para poder explicarlo. Antes acá solo vivía el total de descartes y el
	// motivo se perdía: la pantalla no podía decir por qué volvieron menos.
	const [report, setReport] = useState<LibraryGenerationReport | null>(null);
	const [inputs, setInputs] = useState<GeneratorInputs | null>(null);
	// La marca no declara categoría: no se gastó la llamada y el botón ofrece confirmarla igual.
	const [categoryUnconfirmed, setCategoryUnconfirmed] = useState(false);
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
		mutationFn: async (confirmMissingCategory: boolean) => {
			if (brandId === undefined) throw new Error("Brand no cargado");
			return generateApsLibraryFn({ data: { brandId, entityId, confirmMissingCategory } });
		},
		onSuccess: (result) => {
			setReport({
				returned: result.returned,
				usable: result.prompts.length,
				rejected: result.rejected,
				askedFor: result.askedFor,
				failure: result.failure,
			});
			setInputs(result.inputs);
			// El aviso de categoría no es una falla: no se gastó nada y el botón puede confirmarlo. Se
			// distingue de un error para no mandar al operador a buscar el problema donde no está.
			setCategoryUnconfirmed(result.categoryUnconfirmed === true);
			if (result.ok === false) {
				setError(result.reason);
				setCandidates([]);
				return;
			}
			setError(null);
			setCandidates(result.prompts);
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
	if (brand === undefined) return <div className={`text-sm ${BLOCKING_TEXT}`}>Brand no encontrado.</div>;

	const active = library.data?.library;
	const estimateData = estimate.data;

	return (
		<div className="space-y-6 max-w-5xl">
			<div>
				<h1 className="text-3xl font-bold">APS</h1>
				<p className="text-muted-foreground">
					Agent Preference Score: si los modelos te prefieren cuando un comprador pregunta sin nombrarte. Medido contra
					modelos reales con una biblioteca de preguntas de compra unaided, en corridas on-demand y con su varianza.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Entidad</CardTitle>
					<CardDescription>El APS se mide por entidad, con las preguntas de compra de esa entidad.</CardDescription>
				</CardHeader>
				<CardContent>
					<select
						className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
						value={entityId}
						onChange={(event) => setEntityId(event.target.value)}
					>
						<option value="">Selecciona una entidad</option>
						{(entities.data ?? []).map((entity) => (
							<option key={entity.id} value={entity.id}>
								{entity.name}
							</option>
						))}
					</select>
					{error && <p className={`pt-3 text-sm ${BLOCKING_TEXT}`}>{error}</p>}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					{/*
					 * El nombre visible de este instrumento es **preguntas de compra**, no "biblioteca de
					 * prompts": son lo que un comprador le *pide* a un chat, y lo que miden es si te
					 * prefieren. La otra mitad —lo que la gente *escribe* en un buscador— se llama
					 * Búsquedas y mide si te mencionan. La tabla y el código siguen diciendo `prompts`.
					 */}
					<CardTitle>1 · Preguntas de compra</CardTitle>
					<CardDescription>
						Son las preguntas que un comprador real le hace a un asistente de IA{" "}
						<span className="font-medium text-foreground">sin nombrar tu marca</span> — por ejemplo “¿Qué diferencia hay
						entre una consultora de marca tradicional y una que aplica neurociencia?”. De ahí sale si te prefieren de
						verdad: si la pregunta nombrara tu marca, la respuesta estaría contaminada y no mediría nada. Lo que la
						gente <span className="italic">escribe</span> en un buscador son las{" "}
						<span className="font-medium text-foreground">búsquedas</span> (sección Búsquedas): esas miden si te
						mencionan, no si te prefieren.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					{active === undefined || active === null ? (
						<p className="text-muted-foreground">Esta entidad todavía no tiene preguntas de compra activas.</p>
					) : (
						<div className="space-y-1">
							<p>
								Versión <span className="font-mono">{active.version}</span> · {active.promptCount} preguntas habilitadas
								·{" "}
								{Object.entries(library.data?.counts ?? {})
									.map(([kind, count]) => `${kind}: ${count}`)
									.join(" · ")}
							</p>
							<p className="text-xs text-muted-foreground">
								Bloqueada hasta {active.unlocksAt.slice(0, 10)} ·{" "}
								{library.data?.canRegenerate?.allowed ? "se puede regenerar" : "bloqueada"}
							</p>
						</div>
					)}

					<div className="flex flex-wrap gap-2 pt-1">
						<Button
							size="sm"
							variant="outline"
							onClick={() => generate.mutate(false)}
							disabled={generate.isPending || entityId.length === 0}
						>
							{generateButtonLabel(generate.isPending)}
						</Button>
						{categoryUnconfirmed && (
							<Button size="sm" variant="secondary" onClick={() => generate.mutate(true)} disabled={generate.isPending}>
								Generar igual, con el marcador
							</Button>
						)}
						{candidates.length > 0 && (
							<Button size="sm" onClick={() => save.mutate()} disabled={save.isPending}>
								{save.isPending ? "Guardando…" : `Guardar y bloquear 90 días (${candidates.length})`}
							</Button>
						)}
					</div>

					{/* El tope lo decide el gateway, no el botón: se dice ANTES de apretar, no cuando vuelven menos. */}
					<p className="text-xs text-muted-foreground">
						El botón le pide hasta {LIBRARY_ASKED_FOR} candidatos al gateway, y cuántos devuelve no lo decide BeAOS: la
						lista puede salir más corta. Nada se guarda hasta que confirmes — recién al guardar se bloquean 90 días.
					</p>
					{inputs !== null && !categoryUnconfirmed && (
						<p className="text-xs text-muted-foreground">{generatorInputsNote(inputs)}</p>
					)}
					{categoryUnconfirmed && (
						<p className="text-xs text-muted-foreground">
							No se gastó ninguna llamada: la generación se cortó antes de pedirla. Si confirmás, las preguntas salen
							calibradas con «{CATEGORY_PLACEHOLDER}» y se bloquean 90 días al guardarlas.
						</p>
					)}

					{candidates.length > 0 && (
						<div className="space-y-3 rounded-md border p-3">
							<p className="text-xs text-muted-foreground">
								{report === null
									? "Revisalos antes de guardar: al guardar se bloquean 90 días y se convierten en el instrumento con el que vas a comparar todas las mediciones."
									: libraryReviewMessage(report, inputs)}
							</p>
							{KINDS.map((kind) => {
								const items = candidates.filter((prompt) => prompt.kind === kind.key);
								if (items.length === 0) return null;
								const share = Math.round((items.length / candidates.length) * 100);
								return (
									<div key={kind.key} className="space-y-1">
										<p className="text-xs font-medium">
											{kind.label}{" "}
											<span className="font-normal text-muted-foreground">
												· {items.length} de {candidates.length} ({share}%, objetivo {kind.target}%) — {kind.hint}
											</span>
										</p>
										<ul className="max-h-40 space-y-0.5 overflow-y-auto pl-3 text-xs">
											{items.slice(0, 20).map((prompt) => (
												<li key={prompt.text} className="text-muted-foreground">
													· {prompt.text}
												</li>
											))}
										</ul>
									</div>
								);
							})}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>2 · Corrida</CardTitle>
					<CardDescription>
						Manda esas preguntas a los modelos reales y mide si te nombran, te recomiendan y con qué fuentes. Primero la
						estimación: nada se ejecuta ni se gasta hasta que confirmes.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					{gateway.data?.budget && (
						<p className="text-xs text-muted-foreground">
							Gateway ({gateway.data.budget.models.join(", ") || "sin bandas"}): gastado USD{" "}
							{gateway.data.budget.spend.toFixed(2)}
							{gateway.data.budget.maxBudget === null ? "" : ` de ${gateway.data.budget.maxBudget}`}
							{gateway.data.remainingUsd === null ? "" : ` · quedan USD ${gateway.data.remainingUsd.toFixed(2)}`}
							{gateway.data.budget.budgetResetAt === null
								? ""
								: ` · reinicia ${gateway.data.budget.budgetResetAt.slice(0, 10)}`}
						</p>
					)}
					{gateway.data?.configured === false && (
						<p className={`text-xs ${BLOCKING_TEXT}`}>
							Gateway sin configurar: la generación y el juez no van a funcionar.
						</p>
					)}
					<div className="flex flex-wrap gap-2">
						<Button
							size="sm"
							variant="outline"
							onClick={() => estimate.mutate()}
							disabled={estimate.isPending || entityId.length === 0}
						>
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
								{estimateData.status === "ready" ? "Listo para correr" : "Bloqueado"} ·{" "}
								{estimateData.estimate?.calls ?? 0} llamadas · {estimateData.prompts} prompts ·{" "}
								{estimateData.models.length} modelos ·{" "}
								{estimateData.estimate?.totalUsd === null || estimateData.estimate === null
									? "sin total en dólares"
									: `≈ USD ${estimateData.estimate.totalUsd}`}
							</p>
							{/* Los nombres, no solo la cantidad: la lista sale de SCRAPE_TARGETS y puede venir mas corta
    de lo que uno espera. Ver el modelo que falta antes de confirmar es la diferencia entre
    una corrida completa y una que despues hay que rehacer. */}
							<p className="text-muted-foreground">
								Modelos:{" "}
								<span className="font-mono text-foreground">{estimateData.models.join(", ") || "ninguno"}</span>
							</p>
							{estimateData.estimate !== null && estimateData.estimate.missingPrices.length > 0 && (
								<p className={BLOCKING_TEXT}>
									Sin precio para <span className="font-mono">{estimateData.estimate.missingPrices.join(", ")}</span>:
									un modelo sin precio bloquea la corrida en vez de gastar a ciegas.
								</p>
							)}
							<p className="text-muted-foreground">
								AOS usado como capacidad de acción: {estimateData.capacidadAccion ?? "sin auditoría"} · preguntas v
								{estimateData.libraryVersion ?? "—"}
							</p>
							{estimateData.reasons.length > 0 && <p className={BLOCKING_TEXT}>{estimateData.reasons.join(" ")}</p>}
						</div>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>3 · Resultados</CardTitle>
					<CardDescription>
						Un bloque por modelo: el APS nunca mezcla respuestas de modelos distintos, así que cada uno tiene su score,
						su banda y su distribución.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3 text-sm">
					{(runs.data ?? []).map((run, runIndex) => (
						<ApsRunBlock key={run.id} run={run} expanded={runIndex === 0} statusLabel={statusLabel(run.status)} />
					))}
					{(runs.data ?? []).length === 0 && (
						<p className="text-muted-foreground">
							Todavía no hay corridas. Generá las preguntas de compra y estimá la primera.
						</p>
					)}
				</CardContent>
			</Card>
		</div>
	);
}
