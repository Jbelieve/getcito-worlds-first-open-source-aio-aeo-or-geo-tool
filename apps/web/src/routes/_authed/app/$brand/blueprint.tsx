import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import type { BlueprintKind, BlueprintOwner, BlueprintStatus } from "@workspace/aos-aps/blueprint";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { useEffect, useState } from "react";
import { BandChip, BLOCKING_TEXT, type Level, MONO_LABEL } from "@/components/status-tone";
import { useBrand } from "@/hooks/use-brands";
import { listAgentEntitiesFn } from "@/server/agent-maasy";
import { getBlueprintFn } from "@/server/blueprint";

/**
 * El plan de implementación, en pantalla.
 *
 * Lo lee alguien de marketing y se lo pasa a un desarrollador, así que no muestra nada crudo: cada ítem
 * dice qué es, para qué sirve, de quién es el trabajo y cómo comprobar que quedó hecho. Los estados salen
 * del servidor y son honestos a propósito: una cosa es un archivo que BeAOS generó, otra es lo que hay que
 * construir en el sitio, y otra lo que se resuelve afuera. Solo lo primero se puede afirmar desde acá.
 */
export const Route = createFileRoute("/_authed/app/$brand/blueprint")({
	component: BlueprintPage,
});

/** Estado → palabra y tono. El color ordena; la palabra es lo que dice el estado. */
const STATE_META: Record<BlueprintStatus["state"], { label: string; level: Level }> = {
	listo: { label: "Listo", level: "full" },
	falta: { label: "Falta", level: "none" },
	"por-verificar": { label: "Por verificar", level: "unknown" },
	declinado: { label: "No se hace", level: "low" },
};

/** De quién es el trabajo, en palabras de quien lo va a leer. */
const OWNER_LABEL: Record<BlueprintOwner, string> = {
	beaos: "Lo hace BeAOS",
	dev: "Lo hace tu desarrollador",
	dueno: "Lo hacés vos",
	nadie: "No se hace",
};

const SUMMARY: Array<{ state: BlueprintStatus["state"]; label: string; hint: string }> = [
	{ state: "listo", label: "Listos", hint: "ya generados y en el bundle" },
	{ state: "falta", label: "Faltan", hint: "los genera BeAOS y todavía no existen" },
	{ state: "por-verificar", label: "Por verificar", hint: "en tu web o fuera de ella: hay que medirlo" },
	{ state: "declinado", label: "Declinados", hint: "decidimos no hacerlos, y decimos por qué" },
];

const GROUPS: Array<{ kind: BlueprintKind; title: string; description: string }> = [
	{
		kind: "archivo",
		title: "Lo que BeAOS ya genera",
		description:
			"Archivos que BeAOS produce con tus datos y publica en el bundle de la entidad. Si figuran como listos, existen; si faltan, se generan desde la pantalla de Agent Assets.",
	},
	{
		kind: "servidor",
		title: "Lo que hay que hacer en tu web",
		description:
			"Esto no es un archivo suelto: vive en el servidor de tu sitio (cabeceras, negociación de contenido, una API, un MCP). Lo implementa quien mantiene la web y solo se confirma midiendo el sitio desde afuera.",
	},
	{
		kind: "externo",
		title: "Lo que hay que hacer fuera de tu web",
		description:
			"Ningún archivo del sitio resuelve esto: son cuentas, registros y publicaciones que solo puede hacer el dueño de la marca. Están acá para que no se pierdan, no porque BeAOS los haga.",
	},
	{
		kind: "declinado",
		title: "Lo que decidimos NO hacer",
		description:
			"Estándares que evaluamos y decidimos no implementar, con el motivo. No son tareas pendientes: son decisiones tomadas, y sirven para no volver a discutirlas.",
	},
];

function BlueprintCard({ entry }: { entry: BlueprintStatus }) {
	const { item, state } = entry;
	const meta = STATE_META[state];
	return (
		<Card>
			<CardHeader>
				<div className="flex flex-wrap items-center gap-2">
					<BandChip label={meta.label} level={meta.level} />
					<span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium">
						{OWNER_LABEL[item.owner]}
					</span>
					{item.assetPath === undefined ? null : <span className={`${MONO_LABEL} font-mono`}>{item.assetPath}</span>}
				</div>
				<CardTitle className="text-lg text-believe-900">{item.title}</CardTitle>
				<CardDescription>{item.why}</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4 text-sm">
				<div>
					<p className={MONO_LABEL}>Qué hay que hacer, en orden</p>
					<ol className="mt-1 list-decimal space-y-1 pl-5">
						{item.steps.map((step) => (
							<li key={step}>{step}</li>
						))}
					</ol>
				</div>

				{item.spec === undefined || item.spec.length === 0 ? null : (
					<div className="rounded-md border border-border bg-muted/40 p-3">
						<p className={MONO_LABEL}>El detalle exacto</p>
						<ul className="mt-1 space-y-1 font-mono text-xs text-muted-foreground">
							{item.spec.map((detail) => (
								<li key={detail}>· {detail}</li>
							))}
						</ul>
					</div>
				)}

				{item.snippet === undefined ? null : <SnippetBlock snippet={item.snippet} lang={item.snippetLang} />}

				<div className="rounded-md border border-believe-700/30 bg-muted/40 p-3">
					<p className={MONO_LABEL}>Cómo comprobar que quedó</p>
					<p className="mt-1 text-muted-foreground">{item.verify}</p>
				</div>
			</CardContent>
		</Card>
	);
}

function SnippetBlock({ snippet, lang }: { snippet: string; lang?: string }) {
	const [copied, setCopied] = useState(false);

	async function copy(): Promise<void> {
		try {
			await navigator.clipboard.writeText(snippet);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	}

	return (
		<div>
			<div className="flex flex-wrap items-center justify-between gap-2">
				<p className={MONO_LABEL}>Para copiar y pegar{lang === undefined ? "" : ` · ${lang}`}</p>
				<Button size="sm" variant="outline" onClick={copy}>
					{copied ? "Copiado" : "Copiar"}
				</Button>
			</div>
			<pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted/60 p-3 font-mono text-xs">
				{snippet}
			</pre>
		</div>
	);
}

function BlueprintPage() {
	const { brand, isLoading } = useBrand();
	const [entityId, setEntityId] = useState("");
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

	const plan = useQuery({
		queryKey: ["blueprint", brandId, entityId],
		queryFn: () => getBlueprintFn({ data: { brandId: brandId ?? "", entityId } }),
		enabled: Boolean(brandId && entityId),
	});

	if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
	if (brand === undefined) return <div className={`text-sm ${BLOCKING_TEXT}`}>Brand no encontrado.</div>;

	const items = plan.data?.items ?? [];
	const counts: Record<BlueprintStatus["state"], number> = { listo: 0, falta: 0, "por-verificar": 0, declinado: 0 };
	for (const entry of items) counts[entry.state] += 1;
	const selected = (entities.data ?? []).find((entity) => entity.id === entityId);

	const nextStep =
		counts.falta > 0
			? "Los assets que faltan los genera BeAOS: se hacen desde la pantalla de Agent Assets y después vuelven a figurar acá como listos."
			: counts["por-verificar"] > 0
				? "Lo que queda no lo genera BeAOS: vive en tu web o fuera de ella. Pasale esta lista a quien mantiene el sitio."
				: "No queda nada pendiente para esta entidad en este plan.";

	return (
		<div className="max-w-5xl space-y-6">
			<div>
				<h1 className="text-3xl font-bold">Plan de implementación</h1>
				<p className="text-muted-foreground">
					Todo lo que hay que hacer para que los agentes de IA puedan usar la marca: lo que BeAOS ya genera, lo que hay
					que construir en tu web y lo que se resuelve fuera de ella. No todo lo hace BeAOS.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Entidad</CardTitle>
					<CardDescription>El plan es por entidad: cada una tiene su propio bundle y su propio sitio.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
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
					<p className="text-sm text-muted-foreground">
						{selected === undefined
							? "Seleccioná una entidad para ver su plan."
							: selected.isPublished
								? `Publicado${selected.publishedAt === null ? "" : ` el ${selected.publishedAt.slice(0, 10)}`}: el bundle de esta entidad está disponible para los agentes.`
								: "Sin publicar: los archivos existen, pero nada se entrega a un agente hasta que lo publiques."}
					</p>
				</CardContent>
			</Card>

			{plan.isError && <p className={`text-sm ${BLOCKING_TEXT}`}>No se pudo cargar el plan de esta entidad.</p>}
			{plan.isPending && entityId.length > 0 && <p className="text-sm text-muted-foreground">Cargando el plan…</p>}

			{items.length > 0 && (
				<>
					<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
						{SUMMARY.map((entry) => (
							<div key={entry.state} className="rounded-md border border-border bg-muted/40 p-3">
								<p className={MONO_LABEL}>{entry.label}</p>
								<p className="mt-1 text-2xl font-semibold text-believe-900">{counts[entry.state]}</p>
								<p className="text-xs text-muted-foreground">{entry.hint}</p>
							</div>
						))}
					</div>

					<p className="text-sm">
						<span className={`${MONO_LABEL} font-medium text-signal`}>Próximo paso</span>{" "}
						<span className="text-muted-foreground">{nextStep}</span>
					</p>
				</>
			)}

			{GROUPS.map((group) => {
				const entries = items.filter((entry) => entry.item.kind === group.kind);
				if (entries.length === 0) return null;
				return (
					<section key={group.kind} className="space-y-3">
						<div className="border-l-2 border-believe-700 pl-3">
							<h2 className="text-xl font-semibold text-believe-900">{group.title}</h2>
							<p className="text-sm text-muted-foreground">{group.description}</p>
						</div>
						{entries.map((entry) => (
							<BlueprintCard key={entry.item.id} entry={entry} />
						))}
					</section>
				);
			})}
		</div>
	);
}
