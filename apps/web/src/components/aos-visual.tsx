/**
 * AOS, presented the way the Believe AOS extension presents it: a gauge, a status, a plain-language
 * diagnosis, the agent's path in weighted stages, and one next step.
 *
 * Same information the audit already produced — the score, the requirement statuses, the diagnostics
 * — arranged so a marketer can read it in five seconds and know what to do. Light, same language as
 * the rest of BeAOS.
 */
import { Badge } from "@workspace/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { IconInfoCircle } from "@tabler/icons-react";

export interface AosRequirement {
	id: string;
	title: string;
	status: "pass" | "fail" | "n_a";
	strength?: "MUST" | "SHOULD" | "MAY";
	diagnostic?: boolean;
}

export const AOS_BANDS: Record<string, { label: string; tone: string; ring: string; bg: string }> = {
	"Agent-Operable": { label: "Operable", tone: "text-emerald-700", ring: "#059669", bg: "bg-emerald-50 border-emerald-200" },
	"Agent-Attemptable": { label: "Intentable", tone: "text-amber-700", ring: "#d97706", bg: "bg-amber-50 border-amber-200" },
	"Agent-Blocked": { label: "Bloqueado", tone: "text-orange-700", ring: "#ea580c", bg: "bg-orange-50 border-orange-200" },
	"Agent-Inert": { label: "Inerte", tone: "text-rose-700", ring: "#e11d48", bg: "bg-rose-50 border-rose-200" },
};

export function aosBand(band: string) {
	return AOS_BANDS[band] ?? { label: band, tone: "text-foreground", ring: "#0c3bb9", bg: "bg-muted border-border" };
}

/** What to do about each requirement, in the operator's words. */
export const FIX_HINTS: Record<string, string> = {
	"AOS-DISC-01": "Publicá /llms.txt: título, un resumen y links a lo importante.",
	"AOS-DISC-02": "Publicá /llms-full.txt con tu contenido completo en un solo archivo.",
	"AOS-DISC-03": "Publicá /AGENTS.md (ojo: en MAYÚSCULA, el path que buscan los scanners).",
	"AOS-DISC-04": "Necesitás robots.txt y sitemap.xml accesibles.",
	"AOS-CONT-01": "Agregá JSON-LD de Organization (y Service/Product si aplica) en el HTML.",
	"AOS-CONT-02": "Emití cada caso de éxito como CreativeWork/CaseStudy en JSON-LD.",
	"AOS-CONT-03": "Devolvé markdown cuando el request pide Accept: text/markdown.",
	"AOS-IDEN-01": "Serví /.well-known/agent-card.json con identidad, endpoints y skills.",
	"AOS-IDEN-02": "Serví /.well-known/agent-permissions.json con tus límites.",
	"AOS-CAPA-01": "Declará tu MCP en el llms.txt o serví /.well-known/mcp/server-card.json.",
	"AOS-CAPA-02": "Exponé un endpoint /ask en lenguaje natural sobre tu conocimiento.",
	"AOS-API-01": "Publicá OpenAPI (o el MCP con tools) para que un agente pueda operar.",
	"APS-CLAIM-01": "Serví /.well-known/brand.json con claims[] y proofs[].",
	"APS-CLAIM-02": "Cada claim necesita boundary: applicable_for y not_applicable_for.",
	"APS-CLAIM-03": "Cada proof tiene que apuntar al claim que sostiene, y viceversa.",
	"APS-CLAIM-04": "La confianza se deriva del tamaño de muestra, no se declara.",
	"APS-PROV-01": "Firmá los bytes exactos del brand.json y serví el .sig.",
	"APS-PROV-02": "Publicá /.well-known/keys.json con tu clave pública.",
	"APS-PROV-03": "Publicá /.well-known/http-message-signatures-directory (Web Bot Auth).",
};

const STRENGTH_POINTS: Record<string, number> = { MUST: 3, SHOULD: 2, MAY: 1 };

/**
 * The agent's path. Each stage groups requirements the way an agent experiences them: first it has to
 * find you, then understand you, then be able to act, and only then can it prefer you.
 */
const STAGES: Array<{ key: string; title: string; hint: string; ids: string[] }> = [
	{
		key: "find",
		title: "Te encuentran",
		hint: "Que un agente te descubra y pueda leer qué sos.",
		ids: ["AOS-DISC-01", "AOS-DISC-03", "AOS-DISC-04", "AOS-DISC-02"],
	},
	{
		key: "understand",
		title: "Te entienden",
		hint: "Identidad y contenido que un agente interpreta sin adivinar.",
		ids: ["AOS-CONT-01", "AOS-IDEN-01", "AOS-IDEN-02", "AOS-CONT-02", "AOS-CONT-03"],
	},
	{
		key: "act",
		title: "Pueden actuar",
		hint: "Capacidades expuestas: MCP, API, endpoints.",
		ids: ["AOS-CAPA-01", "AOS-CAPA-02", "AOS-API-01"],
	},
	{
		key: "prefer",
		title: "Te prefieren",
		hint: "Evidencia y claims que un agente puede verificar por su cuenta.",
		ids: ["APS-CLAIM-01", "APS-PROV-01", "APS-PROV-02", "APS-CLAIM-02", "APS-CLAIM-03", "APS-CLAIM-04", "APS-PROV-03"],
	},
];

export interface StageSummary {
	key: string;
	title: string;
	hint: string;
	status: "listo" | "a medias" | "bloqueado" | "sin datos";
	points: number;
	total: number;
	failing: AosRequirement[];
}

/** Points come from the scored requirements only; diagnostics are listed but never counted. */
export function stageSummaries(requirements: AosRequirement[]): StageSummary[] {
	const byId = new Map(requirements.map((requirement) => [requirement.id, requirement]));
	return STAGES.map((stage) => {
		const all = stage.ids.map((id) => byId.get(id)).filter((entry): entry is AosRequirement => entry !== undefined);
		const scored = all.filter((requirement) => requirement.diagnostic !== true && requirement.status !== "n_a");
		const total = scored.reduce((sum, requirement) => sum + (STRENGTH_POINTS[requirement.strength ?? "MUST"] ?? 1), 0);
		const points = scored
			.filter((requirement) => requirement.status === "pass")
			.reduce((sum, requirement) => sum + (STRENGTH_POINTS[requirement.strength ?? "MUST"] ?? 1), 0);
		const failing = all.filter((requirement) => requirement.status === "fail");
		const status: StageSummary["status"] =
			scored.length === 0 ? "sin datos" : points === total ? "listo" : points === 0 ? "bloqueado" : "a medias";
		return { key: stage.key, title: stage.title, hint: stage.hint, status, points, total, failing };
	});
}

function InfoHint({ text }: { text: string }) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help shrink-0" />
			</TooltipTrigger>
			<TooltipContent className="max-w-xs text-sm font-normal">{text}</TooltipContent>
		</Tooltip>
	);
}

/** The gauge: score over 100, coloured by band. */
export function AosScoreRing({ score, band }: { score: number; band: string }) {
	const tone = aosBand(band);
	const radius = 52;
	const circumference = 2 * Math.PI * radius;
	const filled = (Math.max(0, Math.min(100, score)) / 100) * circumference;
	return (
		<div className="relative h-[132px] w-[132px] shrink-0">
			<svg
				viewBox="0 0 132 132"
				className="h-full w-full -rotate-90"
				role="img"
				aria-label={`AOS ${score} de 100, banda ${tone.label}`}
			>
				<circle cx="66" cy="66" r={radius} fill="none" stroke="currentColor" strokeWidth="10" className="text-muted" />
				<circle
					cx="66"
					cy="66"
					r={radius}
					fill="none"
					stroke={tone.ring}
					strokeWidth="10"
					strokeLinecap="round"
					strokeDasharray={`${filled} ${circumference}`}
				/>
			</svg>
			<div className="absolute inset-0 flex flex-col items-center justify-center">
				<span className={`font-display text-4xl font-semibold tabular-nums ${tone.tone}`}>{score}</span>
				<span className="text-xs text-muted-foreground">/100</span>
			</div>
		</div>
	);
}

export function AosStatusPill({ band }: { band: string }) {
	const tone = aosBand(band);
	return (
		<span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium ${tone.bg} ${tone.tone}`}>
			<span className="h-2 w-2 rounded-full" style={{ backgroundColor: tone.ring }} />
			{tone.label}
		</span>
	);
}

/** One line a marketer can read without knowing what any of this is called. */
export function aosDiagnosis(score: number, failing: AosRequirement[]): string {
	if (failing.length === 0) return "Los agentes pueden encontrarte, entenderte y operarte. No hay pendientes en el rubric.";
	if (score >= 80) return "Los agentes te operan. Lo que falta son detalles, no cimientos.";
	if (score >= 60) return "Los agentes te encuentran, pero todavía no pueden hacer mucho con vos.";
	if (score >= 35) return "Los agentes te ven a medias: falta lo mínimo para que puedan operarte.";
	return "Invisible para agentes. No hay nada que puedan leer ni operar.";
}

/** One next step: the heaviest scored failure, with what to do about it. */
export function AosNextStep({ failing }: { failing: AosRequirement[] }) {
	const scored = failing.filter((requirement) => requirement.diagnostic !== true);
	const ordered = [...scored].sort(
		(a, b) => (STRENGTH_POINTS[b.strength ?? "MUST"] ?? 1) - (STRENGTH_POINTS[a.strength ?? "MUST"] ?? 1),
	);
	const next = ordered[0] ?? failing[0];
	if (next === undefined) return null;
	return (
		<div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
			<p className="text-xs font-medium tracking-wide text-primary">EL PRÓXIMO PASO</p>
			<p className="mt-1 text-sm">
				<span className="font-medium">{next.title}</span>
				{next.diagnostic === true ? " (fuera del puntaje, pero suma)" : ""} —{" "}
				{FIX_HINTS[next.id] ?? "Revisá el detalle técnico."}
			</p>
		</div>
	);
}

const STAGE_TONE: Record<StageSummary["status"], { label: string; className: string; dot: string }> = {
	listo: { label: "LISTO", className: "text-emerald-700 border-emerald-200 bg-emerald-50", dot: "text-emerald-600" },
	"a medias": { label: "A MEDIAS", className: "text-amber-700 border-amber-200 bg-amber-50", dot: "text-amber-500" },
	bloqueado: { label: "BLOQUEADO", className: "text-rose-700 border-rose-200 bg-rose-50", dot: "text-rose-500" },
	"sin datos": { label: "SIN DATOS", className: "text-muted-foreground border-border bg-muted", dot: "text-muted-foreground" },
};

/** The journey, stage by stage, with the concrete missing pieces under each one. */
export function AosJourney({ stages }: { stages: StageSummary[] }) {
	return (
		<div className="space-y-4">
			<p className="text-xs font-medium tracking-wide text-muted-foreground">EL CAMINO DE UN AGENTE</p>
			<div className="space-y-4">
				{stages.map((stage, index) => {
					const tone = STAGE_TONE[stage.status];
					return (
						<div key={stage.key} className="relative pl-6">
							{index < stages.length - 1 && <span className="absolute left-[7px] top-6 h-full w-px bg-border" />}
							<span className={`absolute left-0 top-1.5 h-3.5 w-3.5 rounded-full border-2 border-current bg-background ${tone.dot}`} />
							<div className="space-y-2">
								<div className="flex flex-wrap items-center gap-2">
									<span className="text-sm font-medium">{stage.title}</span>
									<Badge variant="outline" className={`font-normal text-[10px] ${tone.className}`}>
										{tone.label}
									</Badge>
									{stage.total > 0 && (
										<span className="text-xs tabular-nums text-muted-foreground">
											{stage.points} / {stage.total} pts
										</span>
									)}
									<InfoHint text={stage.hint} />
								</div>
								{stage.failing.length > 0 ? (
									<ul className="space-y-1">
										{stage.failing.map((requirement) => (
											<li key={requirement.id} className="flex items-start gap-2 text-xs">
												<span className="text-rose-500">✕</span>
												<span>{FIX_HINTS[requirement.id] ?? requirement.title}</span>
												{requirement.diagnostic === true && (
													<span className="text-muted-foreground">· fuera del puntaje</span>
												)}
											</li>
										))}
									</ul>
								) : (
									<p className="text-xs text-emerald-700">Sin pendientes en esta etapa.</p>
								)}
							</div>
						</div>
					);
				})}
			</div>
		</div>
	);
}

/** The technical detail, with the diagnostics kept visually apart so they do not confuse the score. */
export function AosChecklist({ requirements }: { requirements: AosRequirement[] }) {
	const scored = requirements.filter((requirement) => requirement.diagnostic !== true);
	const diagnostics = requirements.filter((requirement) => requirement.diagnostic === true);
	const row = (requirement: AosRequirement) => (
		<li key={requirement.id} className="flex items-center gap-2 text-xs">
			<span className={requirement.status === "pass" ? "text-emerald-600" : requirement.status === "n_a" ? "text-muted-foreground" : "text-rose-500"}>
				{requirement.status === "pass" ? "✓" : requirement.status === "n_a" ? "—" : "✕"}
			</span>
			<code className="font-mono text-[11px] text-muted-foreground">{requirement.id}</code>
			<span className={requirement.status === "fail" ? "" : "text-muted-foreground"}>{requirement.title}</span>
			{requirement.status === "n_a" && <span className="text-muted-foreground">(no aplica)</span>}
		</li>
	);
	return (
		<div className="space-y-3">
			<ul className="space-y-1">{scored.map(row)}</ul>
			{diagnostics.length > 0 && (
				<div className="space-y-1">
					<p className="text-xs font-medium text-muted-foreground">
						Chequeos del estándar que no puntúan <InfoHint text="Son parte de spec.json pero no del número que reporta la auditoría de Maasy. Se muestran para saber qué falta, no para mover el score." />
					</p>
					<ul className="space-y-1 opacity-80">{diagnostics.map(row)}</ul>
				</div>
			)}
		</div>
	);
}
