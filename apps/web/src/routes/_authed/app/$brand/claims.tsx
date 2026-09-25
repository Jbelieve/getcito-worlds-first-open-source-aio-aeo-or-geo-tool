import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { type ClaimCandidate, claimIdFromCandidateId } from "@workspace/aos-aps/claims";
import { CLAIM_CATEGORIES, CONFIDENTIALITY, VERIFIABLE_BY } from "@workspace/aos-aps/preference";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import { Textarea } from "@workspace/ui/components/textarea";
import { useEffect, useState } from "react";
import { BandChip, BLOCKING_BLOCK, BLOCKING_TEXT, Eyebrow, MONO_LABEL } from "@/components/status-tone";
import { useBrand } from "@/hooks/use-brands";
import { listAgentEntitiesFn } from "@/server/agent-maasy";
import { deleteClaimFn, listClaimsFn, type SerializedClaim, saveClaimFn } from "@/server/claims";

export const Route = createFileRoute("/_authed/app/$brand/claims")({
	component: ClaimsPage,
});

/**
 * El tipo de prueba que el operador declara.
 *
 * El valor guardado es el que viaja al `brand.json`, así que se muestra en español y se guarda en el
 * idioma del estándar.
 */
type ProofTypeValue = "case_study" | "document" | "testimonial" | "audit" | "other";
type CategoryValue = (typeof CLAIM_CATEGORIES)[number];
type VerifiableByValue = (typeof VERIFIABLE_BY)[number];
type ConfidentialityValue = (typeof CONFIDENTIALITY)[number];

const CLAIM_PROOF_TYPES: ProofTypeValue[] = ["case_study", "document", "testimonial", "audit", "other"];

const PROOF_TYPE_LABELS: Record<ProofTypeValue, string> = {
	case_study: "Caso de estudio",
	document: "Documento",
	testimonial: "Testimonio",
	audit: "Auditoría",
	other: "Otro",
};

const CATEGORY_LABELS: Record<CategoryValue, string> = {
	outcome: "Resultado",
	methodology: "Metodología",
	experience: "Experiencia",
	scope: "Alcance",
	performance: "Desempeño",
};

/** Cómo lo comprueba un agente. Son los cuatro caminos que el estándar reconoce, y solo esos. */
const VERIFIABLE_LABELS: Record<VerifiableByValue, string> = {
	public_url: "URL pública: cualquiera lo puede abrir",
	third_party_platform: "Plataforma de terceros: lo publica otro",
	signed_client: "Cliente que lo firma",
	internal: "Solo la marca puede confirmarlo",
};

const CONFIDENTIALITY_LABELS: Record<ConfidentialityValue, string> = {
	public: "Público",
	anonymized: "Anonimizado",
	nda: "Bajo NDA",
};

/** El nombre humano del campo de Maasy del que salió el candidato. */
const SOURCE_LABELS: Record<string, string> = {
	client_results: "Resultados de clientes",
	social_proof_count: "Volumen declarado",
	testimonials: "Testimonios",
	references_summary: "Referencias",
};

interface ClaimForm {
	claimId: string;
	statement: string;
	metric: string;
	category: CategoryValue | "";
	boundaryApplicableFor: string;
	boundaryNotApplicableFor: string;
	confidence: string;
	proofType: ProofTypeValue;
	proofTitle: string;
	proofSummary: string;
	proofClient: string;
	verifiableBy: VerifiableByValue | "";
	confidentiality: ConfidentialityValue | "";
	sourceFragment: string;
}

/**
 * El formulario vacío.
 *
 * Nada viene pre-cargado con una suposición de BeAOS: los bordes, la confianza y la confidencialidad se
 * dejan en blanco a propósito, porque son afirmaciones del operador y no un dato que se pueda derivar.
 */
const EMPTY_FORM: ClaimForm = {
	claimId: "",
	statement: "",
	metric: "",
	category: "",
	boundaryApplicableFor: "",
	boundaryNotApplicableFor: "",
	confidence: "",
	proofType: "case_study",
	proofTitle: "",
	proofSummary: "",
	proofClient: "",
	verifiableBy: "",
	confidentiality: "",
	sourceFragment: "",
};

/**
 * Un candidato convertido en formulario.
 *
 * Se pre-carga solo lo que el candidato **ya sabe**: la redacción propuesta, el número que estaba escrito
 * en el fragmento, el tipo de prueba y el fragmento original. Lo demás lo escribe el operador: BeAOS no
 * decide cuándo aplica un claim ni cómo se verifica.
 */
function formFromCandidate(candidate: ClaimCandidate): ClaimForm {
	return {
		...EMPTY_FORM,
		claimId: claimIdFromCandidateId(candidate.id),
		statement: candidate.suggestedStatement ?? candidate.fragment,
		metric: candidate.suggestedMetric ?? "",
		proofType: asProofType(candidate.suggestedProofType),
		sourceFragment: candidate.fragment,
	};
}

function formFromClaim(claim: SerializedClaim): ClaimForm {
	return {
		claimId: claim.claimId,
		statement: claim.statement,
		metric: claim.metric ?? "",
		category: asMember(CLAIM_CATEGORIES, claim.category),
		boundaryApplicableFor: claim.boundaryApplicableFor ?? "",
		boundaryNotApplicableFor: claim.boundaryNotApplicableFor ?? "",
		confidence: claim.confidence ?? "",
		proofType: asProofType(claim.proofType),
		proofTitle: claim.proofTitle,
		proofSummary: claim.proofSummary ?? "",
		proofClient: claim.proofClient ?? "",
		verifiableBy: asMember(VERIFIABLE_BY, claim.verifiableBy),
		confidentiality: asMember(CONFIDENTIALITY, claim.confidentiality),
		sourceFragment: claim.sourceFragment ?? "",
	};
}

/** Un valor que llegó de afuera y no está en la lista se cae a `other`: es la verdad, no un invento. */
function asProofType(value: string): ProofTypeValue {
	return CLAIM_PROOF_TYPES.includes(value as ProofTypeValue) ? (value as ProofTypeValue) : "other";
}

/** El mismo criterio para los enums del estándar: lo que no está en la lista se lee como "sin declarar". */
function asMember<T extends string>(values: readonly T[], value: string | null): T | "" {
	return value !== null && (values as readonly string[]).includes(value) ? (value as T) : "";
}

/** Un `<select>` vacío significa "sin declarar", y así viaja: no se manda una cadena vacía al enum. */
function enumOrUndefined<T extends string>(value: T | ""): T | undefined {
	return value === "" ? undefined : value;
}

function ClaimsPage() {
	const { brand, isLoading } = useBrand();
	const [entityId, setEntityId] = useState("");
	const [form, setForm] = useState<ClaimForm | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
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

	const claims = useQuery({
		queryKey: ["brand-claims", brandId, entityId],
		queryFn: () => listClaimsFn({ data: { brandId: brandId ?? "", entityId } }),
		enabled: Boolean(brandId && entityId),
	});

	const save = useMutation({
		mutationFn: async (status: "draft" | "confirmed") => {
			if (brandId === undefined || form === null) throw new Error("Selecciona una entidad");
			return saveClaimFn({
				data: {
					brandId,
					entityId,
					claimId: form.claimId.trim(),
					statement: form.statement.trim(),
					metric: form.metric,
					category: enumOrUndefined(form.category),
					boundaryApplicableFor: form.boundaryApplicableFor,
					boundaryNotApplicableFor: form.boundaryNotApplicableFor,
					confidence: form.confidence,
					proofType: form.proofType,
					proofTitle: form.proofTitle.trim(),
					proofSummary: form.proofSummary,
					proofClient: form.proofClient,
					verifiableBy: enumOrUndefined(form.verifiableBy),
					confidentiality: enumOrUndefined(form.confidentiality),
					sourceFragment: form.sourceFragment,
					status,
				},
			});
		},
		onSuccess: async (_saved, status) => {
			setError(null);
			setNotice(
				status === "confirmed"
					? "Prueba confirmada. Regenerá los assets en Agent Assets para que el bundle la incluya."
					: "Borrador guardado. Un borrador no entra al bundle.",
			);
			setForm(null);
			await claims.refetch();
		},
		onError: (mutationError) => {
			setError(mutationError instanceof Error ? mutationError.message : "No se pudo guardar la prueba");
		},
	});

	const remove = useMutation({
		mutationFn: async (claimId: string) => {
			if (brandId === undefined) throw new Error("Selecciona una entidad");
			return deleteClaimFn({ data: { brandId, entityId, claimId } });
		},
		onSuccess: async () => {
			setError(null);
			setNotice("Prueba borrada.");
			await claims.refetch();
		},
		onError: (mutationError) => {
			setError(mutationError instanceof Error ? mutationError.message : "No se pudo borrar la prueba");
		},
	});

	const update = <K extends keyof ClaimForm>(field: K, value: ClaimForm[K]) => {
		setForm((previous) => (previous === null ? previous : { ...previous, [field]: value }));
	};

	if (isLoading) return <div className="text-sm text-muted-foreground">Cargando brand…</div>;
	if (brand === undefined) return <div className={`text-sm ${BLOCKING_TEXT}`}>Brand no encontrado.</div>;

	const liveClaimCount = claims.data?.liveClaimCount ?? null;
	const bundleClaimCount = claims.data?.bundleClaimCount ?? 0;
	const fromMaasy = claims.data?.claimsSource === "maasy";
	const candidates = claims.data?.candidates ?? [];
	const saved = claims.data?.claims ?? [];
	const confirmedCount = saved.filter((claim) => claim.status === "confirmed").length;
	const missing = liveClaimCount === null ? 0 : Math.max(0, liveClaimCount - bundleClaimCount);
	const formReady =
		form !== null &&
		form.claimId.trim().length > 0 &&
		form.statement.trim().length > 0 &&
		form.proofTitle.trim().length > 0;

	return (
		<div className="space-y-6 max-w-5xl">
			<div>
				<Eyebrow>Claims &amp; Proofs</Eyebrow>
				<h1 className="text-3xl font-bold">Pruebas</h1>
				<p className="text-muted-foreground">
					Maasy manda la evidencia de tu marca en prosa: resultados de clientes, testimonios, volumen declarado y un
					resumen de referencias. Un agente no puede verificar prosa. BeAOS no la convierte sola —eso sería inventar
					evidencia— así que te muestra cada fragmento tal como llegó y vos confirmás cuáles son afirmaciones, cómo se
					redactan y con qué documento se prueban.
				</p>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>
						Tu sitio sirve {liveClaimCount === null ? "—" : liveClaimCount} pruebas · tu bundle declararía{" "}
						{bundleClaimCount}
					</CardTitle>
					<CardDescription>
						El candado de publicación compara los dos números antes de publicar: nunca deja que el bundle pierda
						evidencia que el sitio ya sirve.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2 text-sm">
					{fromMaasy && (
						<div className="rounded-md border border-believe-700 p-3">
							El contexto de Maasy <strong>ya declara {bundleClaimCount} claims</strong>: el bundle usa esos y BeAOS no
							los sustituye. Lo que confirmes acá queda guardado, pero no reemplaza lo que manda Maasy.
						</div>
					)}
					{liveClaimCount === null && (
						<p className={BLOCKING_TEXT}>
							No pudimos leer el perfil del sitio, así que no podemos comparar. Se publica con un aviso, no bloqueado.
						</p>
					)}
					{liveClaimCount !== null && missing > 0 && (
						<div className={`rounded-md border p-3 ${BLOCKING_BLOCK}`}>
							El candado <strong>va a bloquear la publicación</strong> hasta que confirmes al menos {liveClaimCount}{" "}
							{liveClaimCount === 1 ? "prueba" : "pruebas"}. Hoy tenés {confirmedCount} confirmada
							{confirmedCount === 1 ? "" : "s"} y el bundle declararía {bundleClaimCount}.
						</div>
					)}
					{liveClaimCount !== null && missing === 0 && (
						<p className="text-muted-foreground">
							{bundleClaimCount === 0
								? "El sitio no declara pruebas todavía, así que no hay nada que el candado pueda degradar."
								: "El bundle declara al menos lo que el sitio sirve: el candado no bloquea."}
						</p>
					)}
					<p className="text-muted-foreground">
						Confirmar acá no cambia el bundle solo: después hay que regenerar los assets en Agent Assets.
					</p>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Entidad</CardTitle>
					<CardDescription>Las pruebas son de una entidad: el perfil se firma por entidad.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<select
						className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
						value={entityId}
						onChange={(event) => {
							setEntityId(event.target.value);
							setForm(null);
							setNotice(null);
						}}
					>
						<option value="">Selecciona una entidad</option>
						{(entities.data ?? []).map((entity) => (
							<option key={entity.id} value={entity.id}>
								{entity.name}
							</option>
						))}
					</select>
					<div className="flex flex-wrap gap-2">
						<Button
							onClick={() => {
								setForm({ ...EMPTY_FORM });
								setNotice(null);
							}}
							disabled={entityId.length === 0}
						>
							Nueva prueba
						</Button>
					</div>
					{error && <p className={`text-sm ${BLOCKING_TEXT}`}>{error}</p>}
					{notice !== null && error === null && <p className="text-sm text-muted-foreground">{notice}</p>}
				</CardContent>
			</Card>

			{form !== null && (
				<Card className="border-believe-700">
					<CardHeader>
						<CardTitle>Confirmar la prueba</CardTitle>
						<CardDescription>
							Todo editable. Lo que no llenes no se emite: BeAOS no completa campos por vos.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{form.sourceFragment.length > 0 && (
							<div className="rounded-md bg-muted p-3">
								<p className={MONO_LABEL}>Fragmento original de Maasy</p>
								<p className="mt-1 border-l-2 border-believe-700 pl-3 text-sm">{form.sourceFragment}</p>
							</div>
						)}

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="claim-id">Id de la prueba</Label>
								<Input
									id="claim-id"
									value={form.claimId}
									onChange={(event) => update("claimId", event.target.value)}
									placeholder="CLM-BE-35-CONVERSION"
								/>
								<p className="text-xs text-muted-foreground">
									Estable: es el id que viaja al perfil firmado. El estándar espera el prefijo CLM-.
								</p>
							</div>
							<div className="space-y-1">
								<Label htmlFor="claim-metric">Número</Label>
								<Input
									id="claim-metric"
									value={form.metric}
									onChange={(event) => update("metric", event.target.value)}
									placeholder="Tal como está en la evidencia, ej. 35%"
								/>
								<p className="text-xs text-muted-foreground">No se normaliza ni se completa: se copia.</p>
							</div>
						</div>

						<div className="space-y-1">
							<Label htmlFor="claim-statement">Afirmación</Label>
							<Textarea
								id="claim-statement"
								value={form.statement}
								onChange={(event) => update("statement", event.target.value)}
								rows={3}
							/>
							<p className="text-xs text-muted-foreground">
								Lo que la marca afirma y un agente va a citar. La propuesta del candidato empieza con [Propuesta]: borrá
								esa marca cuando la afirmación sea tuya.
							</p>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="claim-applicable">Cuándo SÍ aplica</Label>
								<Textarea
									id="claim-applicable"
									value={form.boundaryApplicableFor}
									onChange={(event) => update("boundaryApplicableFor", event.target.value)}
									rows={2}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="claim-not-applicable">Cuándo NO aplica</Label>
								<Textarea
									id="claim-not-applicable"
									value={form.boundaryNotApplicableFor}
									onChange={(event) => update("boundaryNotApplicableFor", event.target.value)}
									rows={2}
								/>
							</div>
						</div>
						<p className="text-xs text-muted-foreground">
							El estándar exige los dos bordes: un claim sin límites se lee como una promesa para cualquiera.
						</p>

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="proof-type">Tipo de prueba</Label>
								<select
									id="proof-type"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
									value={form.proofType}
									onChange={(event) => update("proofType", event.target.value as ProofTypeValue)}
								>
									{Object.entries(PROOF_TYPE_LABELS).map(([value, label]) => (
										<option key={value} value={value}>
											{label}
										</option>
									))}
								</select>
							</div>
							<div className="space-y-1">
								<Label htmlFor="claim-category">Categoría</Label>
								<select
									id="claim-category"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
									value={form.category}
									onChange={(event) => update("category", event.target.value as CategoryValue | "")}
								>
									<option value="">Sin categoría</option>
									{CLAIM_CATEGORIES.map((category) => (
										<option key={category} value={category}>
											{CATEGORY_LABELS[category] ?? category}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="space-y-1">
							<Label htmlFor="proof-title">Título de la prueba</Label>
							<Input
								id="proof-title"
								value={form.proofTitle}
								onChange={(event) => update("proofTitle", event.target.value)}
								placeholder="Qué documento la sostiene"
							/>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="proof-client">Cliente</Label>
								<Input
									id="proof-client"
									value={form.proofClient}
									onChange={(event) => update("proofClient", event.target.value)}
								/>
							</div>
							<div className="space-y-1">
								<Label htmlFor="proof-summary">Resumen</Label>
								<Input
									id="proof-summary"
									value={form.proofSummary}
									onChange={(event) => update("proofSummary", event.target.value)}
								/>
							</div>
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<div className="space-y-1">
								<Label htmlFor="verifiable-by">Cómo lo verifica un agente</Label>
								<select
									id="verifiable-by"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
									value={form.verifiableBy}
									onChange={(event) => update("verifiableBy", event.target.value as VerifiableByValue | "")}
								>
									<option value="">Sin declarar</option>
									{VERIFIABLE_BY.map((value) => (
										<option key={value} value={value}>
											{VERIFIABLE_LABELS[value] ?? value}
										</option>
									))}
								</select>
								{form.verifiableBy.length === 0 && (
									<p className={`text-xs ${BLOCKING_TEXT}`}>
										Sin esto el estándar marca la prueba como no verificable.
									</p>
								)}
							</div>
							<div className="space-y-1">
								<Label htmlFor="confidentiality">Confidencialidad</Label>
								<select
									id="confidentiality"
									className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
									value={form.confidentiality}
									onChange={(event) => update("confidentiality", event.target.value as ConfidentialityValue | "")}
								>
									<option value="">Sin declarar</option>
									{CONFIDENTIALITY.map((value) => (
										<option key={value} value={value}>
											{CONFIDENTIALITY_LABELS[value] ?? value}
										</option>
									))}
								</select>
							</div>
						</div>

						<div className="space-y-1">
							<Label htmlFor="claim-confidence">Tu confianza (queda en BeAOS)</Label>
							<Input
								id="claim-confidence"
								value={form.confidence}
								onChange={(event) => update("confidence", event.target.value)}
								placeholder="alta, media, baja…"
							/>
							<p className="text-xs text-muted-foreground">
								No viaja al perfil: el estándar deriva la confianza del tamaño de muestra y no admite una asignada a
								mano. Acá queda tu lectura para el equipo.
							</p>
						</div>

						<div className="flex flex-wrap gap-2">
							<Button onClick={() => save.mutate("confirmed")} disabled={save.isPending || formReady === false}>
								{save.isPending ? "Guardando…" : "Confirmar prueba"}
							</Button>
							<Button
								variant="outline"
								onClick={() => save.mutate("draft")}
								disabled={save.isPending || formReady === false}
							>
								Guardar borrador
							</Button>
							<Button variant="ghost" onClick={() => setForm(null)} disabled={save.isPending}>
								Cancelar
							</Button>
						</div>
						{formReady === false && (
							<p className="text-xs text-muted-foreground">
								Para guardar hacen falta el id, la afirmación y el título de la prueba.
							</p>
						)}
					</CardContent>
				</Card>
			)}

			<Card>
				<CardHeader>
					<CardTitle>Lo que Maasy ya manda</CardTitle>
					<CardDescription>
						Los fragmentos son copia literal de la evidencia: no se reescriben, no se resumen y no se traducen. Los
						números que ves salieron del propio texto.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					{candidates.map((candidate) => (
						<div key={candidate.id} className="space-y-2 rounded-md border border-border p-3">
							<Eyebrow>{SOURCE_LABELS[candidate.sourceField] ?? candidate.sourceField}</Eyebrow>
							<p className="border-l-2 border-believe-700 pl-3 text-sm">{candidate.fragment}</p>
							<p className="text-sm text-muted-foreground">{candidate.why}</p>
							<div className="flex flex-wrap items-center gap-3">
								{candidate.suggestedMetric !== undefined && (
									<span className="text-sm">
										Número en la evidencia: <strong className="text-believe-900">{candidate.suggestedMetric}</strong>
									</span>
								)}
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										setForm(formFromCandidate(candidate));
										setNotice(null);
										setError(null);
									}}
								>
									Convertir en prueba
								</Button>
							</div>
							{candidate.suggestedProofHint !== undefined && (
								<p className="text-xs text-muted-foreground">Qué podría probarlo: {candidate.suggestedProofHint}</p>
							)}
						</div>
					))}
					{candidates.length === 0 && (
						<p className="text-sm text-muted-foreground">
							No hay candidatos: o la entidad todavía no sincronizó su contexto de Maasy, o el contexto que llegó no
							trae evidencia en prosa.
						</p>
					)}
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>Pruebas guardadas</CardTitle>
					<CardDescription>
						{fromMaasy
							? "El bundle toma los claims que ya declara Maasy: las pruebas guardadas acá no entran mientras eso siga así."
							: `${bundleClaimCount} entrarían al bundle (${confirmedCount} confirmada${confirmedCount === 1 ? "" : "s"}). Los borradores no entran.`}
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-2">
					{saved.map((claim) => (
						<div key={claim.id} className="space-y-2 border-b border-border py-3 last:border-b-0">
							<div className="flex flex-wrap items-center gap-2">
								<BandChip
									label={claim.status === "confirmed" ? "Confirmada" : "Borrador"}
									level={claim.status === "confirmed" ? "full" : "mid"}
								/>
								<span className={`${MONO_LABEL} text-believe-900`}>{claim.claimId}</span>
								{claim.category !== null && <span className="text-xs text-muted-foreground">{claim.category}</span>}
							</div>
							<p className="text-sm">{claim.statement}</p>
							<p className="text-xs text-muted-foreground">
								{claim.proofType} · {claim.proofTitle}
								{claim.metric === null ? "" : ` · ${claim.metric}`}
								{claim.verifiableBy === null ? " · sin forma de verificación declarada" : ` · ${claim.verifiableBy}`}
							</p>
							{claim.sourceFragment !== null && (
								<p className="text-xs text-muted-foreground">Fragmento confirmado: {claim.sourceFragment}</p>
							)}
							<div className="flex gap-2">
								<Button
									size="sm"
									variant="outline"
									onClick={() => {
										setForm(formFromClaim(claim));
										setNotice(null);
										setError(null);
									}}
								>
									Editar
								</Button>
								<Button
									size="sm"
									variant="ghost"
									onClick={() => remove.mutate(claim.claimId)}
									disabled={remove.isPending}
								>
									Borrar
								</Button>
							</div>
						</div>
					))}
					{saved.length === 0 && <p className="text-sm text-muted-foreground">Todavía no hay pruebas guardadas.</p>}
				</CardContent>
			</Card>
		</div>
	);
}
