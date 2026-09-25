/**
 * /reports/render/$reportId - Standalone report rendering page
 *
 * Production-quality printable report (US Letter 8.5 x 11 in).
 * Uses Share of Voice as the primary metric with rich competitive analysis.
 */
import { createFileRoute, notFound, useRouteContext } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import type { ClientConfig } from "@workspace/config/types";
import {
	analyzeByEngine,
	analyzeCompetitorFrequency,
	analyzeWebQueries,
	computeCompetitorSoVs,
	computeOverallSoV,
	computePromptSoV,
	type FullPromptRun,
	findContentGaps,
	getSoVLevel,
	type PromptCategory,
	type ReportPromptRun,
	selectRepresentativePrompts,
} from "@workspace/lib/report-metrics";
import { BarChart3, Rocket, Target } from "lucide-react";
import { Logo } from "@/components/logo";
import { PromptChartPrint } from "@/components/prompt-chart-print";
import { ReportAgentPage } from "@/components/report-agent-page";
// La paleta del reporte sale de un solo módulo, como el resto de las superficies de BeAOS.
import { type Level, levelFromScore, STATUS_TONE, toneOf } from "@/components/status-tone";
import { formatDateTime } from "@/lib/app-locale";
import { hasReportAccess, requireAuthSession } from "@/lib/auth/helpers";
// AGREGADO BeAOS (frontera del fork: solo se agrega, no se reescribe lo del upstream).
import { getReportAgentContextFn } from "@/server/report-agent";
import { getReportByIdFn } from "@/server/reports";

// ---------- Types ----------

interface ReportData {
	competitors: CompetitorResult[];
	prompts: PromptData[];
	promptRuns: PromptRunResult[];
}

interface CompetitorResult {
	name: string;
	domain: string;
}
interface PromptData {
	value: string;
}

interface PromptRunResult {
	promptValue: string;
	runs: Array<{
		model: string;
		version: string;
		webSearchEnabled: boolean;
		rawOutput: any;
		webQueries: string[];
		textContent: string;
		brandMentioned: boolean;
		competitorsMentioned: string[];
	}>;
}

interface MockPrompt {
	id: string;
	brandId: string;
	value: string;
	enabled: boolean;
	createdAt: Date;
}

// ---------- Server function ----------

const loadReportData = createServerFn({ method: "GET" })
	.validator((d: string) => d)
	.handler(async ({ data: reportId }) => {
		const session = await requireAuthSession();
		if (!hasReportAccess(session)) throw new Error("Not authorized");
		return getReportByIdFn({ data: { reportId } });
	});

function isPromptBranded(promptValue: string, brandName: string, brandWebsite: string): boolean {
	const promptLower = (promptValue || "").toLowerCase();
	const brandNameLower = (brandName || "").toLowerCase();
	try {
		const website = brandWebsite || "";
		const url = new URL(website.startsWith("http") ? website : `https://${website}`);
		const domain = url.hostname.replace(/^www\./, "").toLowerCase();
		const domainWithoutTld = domain.split(".")[0];
		return (
			promptLower.includes(brandNameLower) || promptLower.includes(domain) || promptLower.includes(domainWithoutTld)
		);
	} catch {
		return promptLower.includes(brandNameLower);
	}
}

// ---------- Route ----------

export const Route = createFileRoute("/_authed/reports/render/$reportId")({
	loader: async ({ params }) => {
		const report = await loadReportData({ data: params.reportId });
		if (!report) throw notFound();
		// AGREGADO BeAOS: el reporte no guarda a qué entidad pertenece, así que se vincula por web y
		// nombre. Si no se puede, el contexto vuelve sin vincular y la página lo dice.
		const agentContext = await getReportAgentContextFn({
			data: { website: report.brandWebsite, name: report.brandName },
		}).catch(() => null);
		return { report, agentContext };
	},
	head: () => ({
		meta: [{ title: "AI Share of Voice Report" }, { name: "robots", content: "noindex, nofollow" }],
	}),
	component: ReportRenderPage,
});

// ---------- Color helpers ----------
//
// Paleta de Believe. El SoV es "cuánto hay", así que va en la rampa ordinal azul: el color ordena, no
// juzga. Los cortes (60/40/20) siguen siendo la regla de negocio de siempre; lo que cambió es que ahora
// los pinta un solo módulo, `status-tone`, en vez de que cada pantalla invente su semáforo.
// Ver AOS-APS-ESTADO.md §2: el reporte es la excepción acordada — es un documento que ve el cliente, no
// una pantalla viva, y Jorge pidió que hable el idioma de la marca.

function sovTone(sov: number | null) {
	return toneOf(sov === null ? "unknown" : levelFromScore(sov, { full: 60, high: 40, mid: 20 }));
}

/** "High/Medium/Low opportunity" es gravedad, no cantidad: va en peso de tinta, no en tono. */
function opportunityChip(sov: number | null): string {
	if (sov === null) return "border-border bg-muted text-muted-foreground";
	if (sov < 20) return "border-foreground/20 bg-muted/60 text-foreground font-semibold";
	if (sov < 40) return "border-border bg-muted/50 text-foreground";
	return "border-border bg-muted/40 text-muted-foreground";
}

// ---------- Main component ----------

function ReportRenderPage() {
	const { report, agentContext } = Route.useLoaderData();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;

	if (report.status !== "completed") {
		return (
			<div className="max-w-3xl mx-auto p-8 text-center">
				<p className="text-muted-foreground">
					Report status: <span className="font-medium">{report.status}</span>
				</p>
			</div>
		);
	}

	const rawData = report.rawOutput;
	let data: ReportData | null = null;
	try {
		data = (typeof rawData === "string" ? JSON.parse(rawData) : rawData) as ReportData;
	} catch (err) {
		console.error("Failed to parse report rawOutput:", err);
	}

	// Build mock data structures for chart component compatibility
	const mockBrand = {
		id: "brand-1",
		name: report.brandName,
		website: report.brandWebsite,
		enabled: true,
		onboarded: true,
		delayOverrideHours: null,
		createdAt: new Date(),
		updatedAt: new Date(),
	};
	const mockCompetitors = (data?.competitors || []).map((comp, i) => ({
		id: `comp-${i + 1}`,
		name: comp.name,
		domain: comp.domain,
		brandId: mockBrand.id,
		createdAt: new Date(),
		updatedAt: new Date(),
	}));
	const mockPrompts: MockPrompt[] = (data?.prompts || []).map((p, i) => ({
		id: `prompt-${i + 1}`,
		brandId: mockBrand.id,
		value: p?.value || "",
		enabled: true,
		createdAt: new Date(),
	}));

	// Build run arrays
	const simpleRuns: ReportPromptRun[] = [];
	const fullRuns: FullPromptRun[] = [];
	const chartRuns: any[] = [];

	(data?.promptRuns || []).forEach((pr, pi) => {
		(pr.runs || []).forEach((run, ri) => {
			const promptId = `prompt-${pi + 1}`;
			simpleRuns.push({
				promptId,
				brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned || [],
			});
			fullRuns.push({
				promptId,
				promptValue: pr?.promptValue || "",
				brandMentioned: run?.brandMentioned || false,
				competitorsMentioned: run?.competitorsMentioned || [],
				webQueries: run?.webQueries || [],
				textContent: run?.textContent || "",
				model: run?.model || "",
			});
			chartRuns.push({
				id: `run-${pi}-${ri}`,
				promptId,
				brandMentioned: run.brandMentioned,
				competitorsMentioned: run.competitorsMentioned || [],
				createdAt: new Date(),
				model: run.model,
				version: run.version,
				webSearchEnabled: run.webSearchEnabled,
				rawOutput: run.rawOutput,
				webQueries: run.webQueries,
			});
		});
	});

	// Deduplicate competitors by name (case-insensitive) and filter out brand
	const brandNameLower = (report.brandName || "").toLowerCase().trim();
	const isBrandName = (name: string) => (name || "").toLowerCase().trim() === brandNameLower;
	const seenCompetitorNames = new Set<string>();
	const filteredCompetitors = (data?.competitors || []).filter((c) => {
		const key = (c?.name || "").toLowerCase().trim();
		if (isBrandName(c.name) || seenCompetitorNames.has(key)) return false;
		seenCompetitorNames.add(key);
		return true;
	});

	// Core metrics
	const overallSoV = computeOverallSoV(simpleRuns, filteredCompetitors);
	const competitorSoVs = computeCompetitorSoVs(simpleRuns, filteredCompetitors);
	const promptSoVs = mockPrompts.map((p) => computePromptSoV(p.id, simpleRuns, filteredCompetitors));
	const promptMap = new Map(mockPrompts.map((p) => [p.id, p]));

	const selectedPrompts = selectRepresentativePrompts(promptSoVs, (id: string) => {
		const p = promptMap.get(id);
		return p ? isPromptBranded(p.value, report.brandName, report.brandWebsite) : false;
	});

	// Rich analysis
	const contentGaps = findContentGaps(fullRuns, 5);
	const allWebQueries = analyzeWebQueries(fullRuns, 1000);
	const competitorFreq = analyzeCompetitorFrequency(fullRuns, filteredCompetitors);
	const engineBreakdown = analyzeByEngine(fullRuns);

	// Enrich web queries with competitor mention data
	const queryCompetitorMap = new Map<string, { brandMentioned: boolean; competitorCount: number }>();
	for (const run of fullRuns) {
		for (const query of run.webQueries || []) {
			const normalized = (query || "").toLowerCase().trim();
			if (!normalized || normalized.length < 3) continue;
			const existing = queryCompetitorMap.get(normalized);
			const compCount = run.competitorsMentioned.length;
			if (!existing) {
				queryCompetitorMap.set(normalized, { brandMentioned: run.brandMentioned, competitorCount: compCount });
			} else {
				if (run.brandMentioned) existing.brandMentioned = true;
				existing.competitorCount = Math.max(existing.competitorCount, compCount);
			}
		}
	}
	// Mix of top-frequency + brand-mentioned queries
	const enrichedQueries = allWebQueries.map((q) => {
		const extra = queryCompetitorMap.get(q.query);
		return { ...q, brandMentioned: extra?.brandMentioned ?? false, competitorCount: extra?.competitorCount ?? 0 };
	});
	const topSearchQueries: typeof enrichedQueries = [];
	const usedQueries = new Set<string>();
	const byFrequency = [...enrichedQueries].sort((a, b) => b.count - a.count);
	const withBrand = enrichedQueries.filter((q) => q.brandMentioned).sort((a, b) => b.count - a.count);
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 3) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	for (const q of withBrand) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	for (const q of byFrequency) {
		if (topSearchQueries.length >= 6) break;
		if (!usedQueries.has(q.query)) {
			topSearchQueries.push(q);
			usedQueries.add(q.query);
		}
	}
	topSearchQueries.sort((a, b) => b.competitorCount - a.competitorCount);

	const sovLevel = getSoVLevel(overallSoV);
	const sov = sovTone(overallSoV);
	const totalPrompts = mockPrompts.length;
	const promptsWithMentions = promptSoVs.filter((p) => p.brandMentionCount > 0).length;
	const mentionRate = totalPrompts > 0 ? Math.round((promptsWithMentions / totalPrompts) * 100) : 0;

	// Charts: 2 per page
	const chartPairs: Array<typeof selectedPrompts> = [];
	for (let i = 0; i < selectedPrompts.length; i += 2) {
		chartPairs.push(selectedPrompts.slice(i, i + 2));
	}

	return (
		<div className="max-w-[780px] mx-auto bg-card print:max-w-none text-foreground">
			<style
				dangerouslySetInnerHTML={{
					__html: `
				@media print {
					@page { size: letter; margin: 0.5in 0.6in; }
					body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
				}
			`,
				}}
			/>

			{/* ===== PAGE 1: COVER ===== */}
			<div className="print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<div className="h-[3px] bg-believe-700 -mx-10 print:-mx-0 mb-8" />

				<div className="flex items-center justify-between mb-16">
					<Logo iconClassName="!size-5" textClassName="text-sm font-semibold text-muted-foreground" />
					<span className="text-xs tracking-wide text-muted-foreground">
						{formatDateTime(report.createdAt, { year: "numeric", month: "long", day: "numeric" })}
					</span>
				</div>

				<div className="flex-1 flex flex-col justify-center">
					<div className="text-[10px] font-semibold tracking-[0.25em] uppercase text-muted-foreground mb-4">
						AI Share of Voice Report
					</div>
					<h1 className="text-4xl font-bold tracking-tight mb-2">{report.brandName}</h1>
					<div className="w-16 h-[2px] bg-believe-700 mb-12" />

					<div className="bg-muted/50 rounded-xl p-8 max-w-md mb-12">
						<div className="flex items-baseline gap-4">
							<span className={`text-6xl font-extrabold tracking-tighter ${sov.text}`}>
								{overallSoV !== null ? `${overallSoV}%` : "N/A"}
							</span>
							<div>
								<div className="text-sm font-semibold">Share of Voice</div>
								<div className="text-xs text-muted-foreground">
									{sovLevel.label} &mdash; {sovLevel.description}
								</div>
							</div>
						</div>
						<div className="mt-4 w-full bg-muted rounded-full h-2">
							<div
								className="h-2 rounded-full"
								style={{ width: `${Math.max(2, overallSoV ?? 0)}%`, backgroundColor: sov.mark }}
							/>
						</div>
					</div>

					<div className="grid grid-cols-3 gap-6 max-w-lg">
						<CoverStat value={String(totalPrompts)} label="Prompts Tested" />
						<CoverStat value={String(promptsWithMentions)} label="Brand Mentions" />
						<CoverStat value={String(filteredCompetitors.length)} label="Competitors" />
					</div>
				</div>

				<PageFooter branding={branding} />
			</div>

			{/* ===== PAGE 2: COMPETITIVE OVERVIEW ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title="AI Engine Performance"
					subtitle={`Brand mention rate across ${engineBreakdown.reduce((s, e) => s + e.totalRuns, 0)} evaluations`}
				/>
				<div className="grid grid-cols-3 gap-3 mb-8">
					{engineBreakdown.map((eng) => (
						<div key={eng.engine} className="border border-border rounded-lg p-4">
							<div className="text-[11px] font-medium text-muted-foreground mb-2">{eng.engine}</div>
							<div className={`text-3xl font-bold ${sovTone(eng.mentionRate).text}`}>{eng.mentionRate}%</div>
							<div className="text-[10px] text-muted-foreground mt-1">
								{eng.brandMentions} of {eng.totalRuns} runs
							</div>
							<div className="mt-2.5 w-full bg-muted rounded-full h-1.5">
								<div
									className="h-1.5 rounded-full"
									style={{
										backgroundColor: sovTone(eng.mentionRate).mark,
										width: `${Math.max(2, eng.mentionRate)}%`,
									}}
								/>
							</div>
						</div>
					))}
				</div>

				<Section title="Competitive Landscape" subtitle="Share of voice comparison across all tested prompts" />
				<div className="border border-border rounded-lg overflow-hidden mb-8 print:pb-px">
					<table className="w-full">
						<thead>
							<tr className="bg-muted/50 border-b border-border">
								<TH align="left">Brand</TH>
								<TH align="right" className="w-16">
									SoV
								</TH>
								<TH align="left" className="w-[40%]">
									Share
								</TH>
							</tr>
						</thead>
						<tbody className="divide-y divide-border/60">
							{[
								{ name: report.brandName, sov: overallSoV ?? 0, isBrand: true },
								...competitorSoVs
									.filter((c) => !isBrandName(c.name))
									.slice(0, 3)
									.map((c) => ({ name: c.name, sov: c.sov, isBrand: false })),
							]
								.sort((a, b) => b.sov - a.sov)
								.map((row, i) => (
									<tr key={`sov-${i}`} className={row.isBrand ? "bg-primary/5" : ""}>
										<td className={`py-2.5 px-4 text-sm ${row.isBrand ? "font-semibold" : "text-muted-foreground"}`}>
											{row.name}
										</td>
										<td className="py-2.5 px-4 text-right">
											<span
												className={`text-sm font-bold ${row.isBrand ? "text-believe-900" : "text-muted-foreground"}`}
											>
												{row.sov}%
											</span>
										</td>
										<td className="py-2.5 px-4">
											<Bar value={row.sov} level={row.isBrand ? "full" : "low"} />
										</td>
									</tr>
								))}
						</tbody>
					</table>
				</div>

				{competitorFreq.length > 0 && (
					<>
						<Section
							title="Mention Rate"
							subtitle="Each prompt is evaluated multiple times across AI engines — mentions show total appearances, unique prompts show how many distinct prompts include the brand"
						/>
						<div className="border border-border rounded-lg overflow-hidden print:pb-px">
							<table className="w-full">
								<thead>
									<tr className="bg-muted/50 border-b border-border">
										<TH align="left">Brand</TH>
										<TH align="center">Mentions</TH>
										<TH align="center">Unique Prompts</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-border/60">
									{[
										{
											name: report.brandName,
											mentionCount: simpleRuns.filter((r) => r.brandMentioned).length,
											promptCount: promptsWithMentions,
											isBrand: true,
										},
										...competitorFreq
											.filter((c) => !isBrandName(c.name))
											.slice(0, 3)
											.map((c) => ({ ...c, isBrand: false })),
									]
										.sort((a, b) => b.mentionCount - a.mentionCount)
										.map((c, i) => (
											<tr key={`mention-${i}`} className={c.isBrand ? "bg-primary/5" : ""}>
												<td
													className={`py-2 px-4 text-xs font-medium ${c.isBrand ? "text-foreground" : "text-foreground"}`}
												>
													{c.name}
												</td>
												<td className="py-2 px-4 text-center text-xs text-muted-foreground">
													{c.mentionCount}
													<span className="text-muted-foreground">/{simpleRuns.length}</span>
												</td>
												<td className="py-2 px-4 text-center text-xs text-muted-foreground">
													{c.promptCount}
													<span className="text-muted-foreground">/{totalPrompts}</span>
												</td>
											</tr>
										))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== CHART PAGES ===== */}
			{chartPairs.map((pair, pageIdx) => (
				<div key={pageIdx} className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
					<RunningHeader brand={report.brandName} />

					{pageIdx === 0 ? (
						<Section
							title="Prompt Analysis"
							subtitle="Share of voice for representative prompts — strengths and growth opportunities"
						/>
					) : (
						<div className="text-xs text-muted-foreground italic mb-4">Prompt Analysis (continued)</div>
					)}

					<div className="flex-1 flex flex-col gap-5">
						{pair.map((selected) => {
							const prompt = promptMap.get(selected.promptId);
							if (!prompt) return null;
							return (
								<div key={selected.promptId} className="flex-1 flex flex-col">
									<PromptChartPrint
										lookback="1m"
										promptName={prompt.value}
										promptId={prompt.id}
										brand={mockBrand as any}
										competitors={mockCompetitors as any}
										promptRuns={chartRuns}
										category={selected.category}
									/>
								</div>
							);
						})}
					</div>

					<div className="mt-auto">
						<PageFooter branding={branding} />
					</div>
				</div>
			))}

			{/* ===== OPPORTUNITIES ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title="Content Gaps"
					subtitle={`Prompts where competitors appear but ${report.brandName} does not — highest-value opportunities`}
				/>

				{contentGaps.length > 0 ? (
					<div className="border border-border rounded-lg overflow-hidden mb-8">
						<table className="w-full">
							<thead>
								<tr className="bg-muted/50 border-b border-border">
									<TH align="left">Prompt</TH>
									<TH align="left" className="w-[50%]">
										Competitors Found
									</TH>
								</tr>
							</thead>
							<tbody className="divide-y divide-border/60">
								{contentGaps.map((gap) => (
									<tr key={gap.promptId}>
										<td className="py-2.5 px-4 text-xs text-foreground leading-relaxed max-w-[320px]">
											{gap.promptValue}
										</td>
										<td className="py-2.5 px-4">
											<div className="flex flex-wrap gap-1">
												{gap.competitorsMentioned.slice(0, 3).map((c) => (
													<span
														key={c}
														className="inline-block px-2 py-0.5 rounded-md bg-muted text-muted-foreground text-[10px] font-medium"
													>
														{c}
													</span>
												))}
												{gap.competitorsMentioned.length > 3 && (
													<span className="text-[10px] text-muted-foreground">
														+{gap.competitorsMentioned.length - 3}
													</span>
												)}
											</div>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				) : (
					<div className="border border-border rounded-lg p-6 text-center mb-8">
						<p className="text-muted-foreground text-sm">
							{report.brandName} appears in all prompts where competitors are mentioned.
						</p>
					</div>
				)}

				{topSearchQueries.length > 0 && (
					<>
						<Section
							title="Top AI Search Queries"
							subtitle="Common web search queries AI models run when answering prompts in your category"
						/>
						<div className="border border-border rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-muted/50 border-b border-border">
										<TH align="left">Query</TH>
										<TH align="center" className="w-28">
											Competitors Found
										</TH>
										<TH align="center" className="w-24">
											Brand Mentioned
										</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-border/60">
									{topSearchQueries.map((q) => (
										<tr key={q.query}>
											<td className="py-2.5 px-4 text-xs text-foreground max-w-[350px] break-words">{q.query}</td>
											<td className="py-2.5 px-4 text-center text-xs text-muted-foreground">{q.competitorCount}</td>
											<td className="py-2.5 px-4 text-center">
												{q.brandMentioned ? (
													<span className="text-primary font-semibold text-xs">&#10003;</span>
												) : (
													<span className="text-muted-foreground/60 text-xs">&mdash;</span>
												)}
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</>
				)}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== SoV OPPORTUNITY + WHAT TO DO NEXT ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col p-10 print:p-0">
				<RunningHeader brand={report.brandName} />

				<Section
					title="Share of Voice Opportunity"
					subtitle="Overview of your current AI share of voice and growth potential"
				/>

				<div className="border border-border rounded-lg overflow-hidden mb-8">
					<table className="w-full">
						<thead>
							<tr className="bg-muted/50 border-b border-border">
								<TH align="center">Prompts With Mentions</TH>
								<TH align="center">Total Prompts Tested</TH>
								<TH align="center">Overall SoV</TH>
								<TH align="center">Opportunity</TH>
								<TH align="left">Recommendation</TH>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td className="text-center py-3 px-4 text-sm font-semibold">{promptsWithMentions}</td>
								<td className="text-center py-3 px-4 text-sm text-muted-foreground">{totalPrompts}</td>
								<td className="text-center py-3 px-4">
									<span className={`text-sm font-bold ${sov.text}`}>{overallSoV ?? 0}%</span>
								</td>
								<td className="text-center py-3 px-4">
									<span
										className={`inline-block border px-2 py-0.5 rounded-md text-[10px] font-semibold ${opportunityChip(overallSoV)}`}
									>
										{(overallSoV ?? 0) < 20 ? "High" : (overallSoV ?? 0) < 40 ? "Medium" : "Low"}
									</span>
								</td>
								<td className="py-3 px-4 text-xs text-muted-foreground">
									{(overallSoV ?? 0) < 20
										? "Prioritize content creation to establish AI presence"
										: (overallSoV ?? 0) < 40
											? "Expand content to increase brand share of voice"
											: "Maintain leadership and defend competitive position"}
								</td>
							</tr>
						</tbody>
					</table>
				</div>

				<Section
					title="What Should I Do Next?"
					subtitle={`Prompts where competitors outperform ${report.brandName} — your biggest growth opportunities`}
				/>

				{(() => {
					const opportunities = promptSoVs
						.filter((p) => p.totalCompetitorMentions > 0)
						.map((p) => {
							const prompt = promptMap.get(p.promptId);
							const brandSoV = p.sov ?? 0;
							// Find the single highest competitor's SoV for this prompt
							const topCompMentions = Math.max(...Object.values(p.competitorMentions), 0);
							const denom = p.brandMentionCount + p.totalCompetitorMentions;
							const maxCompSoV = denom > 0 ? Math.round((topCompMentions / denom) * 100) : 0;
							const gap = maxCompSoV - brandSoV;
							// Goal: match or slightly beat the top competitor
							const margin = gap > 30 ? 5 : gap > 15 ? 8 : 10;
							const goalSoV = Math.min(100, maxCompSoV + margin);
							// Article count scales with gap
							const articleCount = gap > 40 ? 8 : gap > 25 ? 6 : gap > 10 ? 5 : 4;
							return {
								promptValue: prompt?.value ?? p.promptId,
								brandSoV,
								maxCompSoV,
								gap,
								goalSoV,
								articleCount,
							};
						})
						.filter((o) => o.gap > 0)
						// Prefer prompts where brand has SOME presence (more actionable), then by gap
						.sort((a, b) => {
							if (a.brandSoV > 0 && b.brandSoV === 0) return -1;
							if (a.brandSoV === 0 && b.brandSoV > 0) return 1;
							return b.gap - a.gap;
						})
						.slice(0, 5);

					if (opportunities.length === 0) {
						return (
							<div className="border border-border rounded-lg p-6 text-center">
								<p className="text-muted-foreground text-sm">
									{report.brandName} leads or matches competitors across all tested prompts.
								</p>
							</div>
						);
					}

					return (
						<div className="border border-border rounded-lg overflow-hidden">
							<table className="w-full">
								<thead>
									<tr className="bg-muted/50 border-b border-border">
										<TH align="left">Prompt</TH>
										<TH align="center">Current SoV</TH>
										<TH align="center">Top Competitor SoV</TH>
										<TH align="center">Goal SoV</TH>
										<TH align="left">Recommendation</TH>
									</tr>
								</thead>
								<tbody className="divide-y divide-border/60">
									{opportunities.map((o) => (
										<tr key={o.promptValue}>
											<td className="py-2.5 px-4 text-xs text-foreground max-w-[200px] break-words leading-relaxed">
												{o.promptValue}
											</td>
											<td className="py-2.5 px-4 text-center">
												<span className={`text-xs font-semibold text-believe-900`}>{o.brandSoV}%</span>
											</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-muted-foreground">
												{o.maxCompSoV}%
											</td>
											<td className="py-2.5 px-4 text-center text-xs font-semibold text-believe-900">{o.goalSoV}%</td>
											<td className="py-2.5 px-4 text-xs text-muted-foreground">
												Write {o.articleCount} LLM-friendly articles on &ldquo;{o.promptValue}&rdquo;
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					);
				})()}

				<div className="mt-auto">
					<PageFooter branding={branding} />
				</div>
			</div>

			{/* ===== AGREGADO BeAOS: AOS + APS ===== */}
			{agentContext !== null && <ReportAgentPage context={agentContext} brandName={report.brandName} />}

			{/* ===== CTA ===== */}
			<div className="print:break-before-page print:h-[9.5in] print:flex print:flex-col print:justify-center p-10 print:p-0">
				<div className="bg-gradient-to-r from-primary/5 to-primary/10 border border-primary/30 rounded-xl p-10 text-center">
					<h2 className="text-2xl font-bold text-foreground mb-2">Ready to Optimize Your AI Visibility?</h2>
					<p className="text-muted-foreground text-base mb-8">
						Take your brand's AI presence to the next level with {branding?.name || "Getcito"}
					</p>

					<div className="grid grid-cols-3 gap-6 mb-8">
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Target className="h-8 w-8 text-muted-foreground" />
							</div>
							<h3 className="font-semibold text-foreground mb-2">Strategic Optimization</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Develop content strategies that increase your brand's share of voice in AI responses
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<BarChart3 className="h-8 w-8 text-muted-foreground" />
							</div>
							<h3 className="font-semibold text-foreground mb-2">Continuous Monitoring</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Track your AI share of voice across hundreds of relevant prompts and topics
							</p>
						</div>
						<div className="text-center p-4">
							<div className="flex justify-center mb-3">
								<Rocket className="h-8 w-8 text-muted-foreground" />
							</div>
							<h3 className="font-semibold text-foreground mb-2">Competitive Advantage</h3>
							<p className="text-sm text-muted-foreground leading-relaxed">
								Stay ahead of competitors in the rapidly evolving AI search landscape
							</p>
						</div>
					</div>

					<div className="pt-6 border-t border-primary/30">
						<p className="text-foreground font-medium mb-2">Get started with {branding?.name || "Getcito"} today</p>
						<p className="text-muted-foreground text-sm text-balance">
							Visit{" "}
							<a
								href={branding?.url || "https://getcito.chat"}
								target="_blank"
								rel="noopener noreferrer"
								className="font-bold text-primary hover:underline hover:text-primary"
							>
								{branding?.url || "Getcito.chat"}
							</a>{" "}
							to learn more about our AI visibility platform and services.
						</p>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------- Sub-components ----------

function RunningHeader({ brand }: { brand: string }) {
	return (
		<div className="flex items-center justify-between mb-6 pb-3 border-b border-border/60">
			<span className="text-[10px] font-semibold tracking-[0.2em] uppercase text-muted-foreground">
				AI Share of Voice Report
			</span>
			<span className="text-[10px] font-medium text-muted-foreground">{brand}</span>
		</div>
	);
}

function Section({ title, subtitle }: { title: string; subtitle?: string }) {
	return (
		<div className="border-l-[3px] border-believe-700 pl-3 mb-4">
			<h2 className="text-base font-semibold">{title}</h2>
			{subtitle && <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>}
		</div>
	);
}

function TH({
	children,
	align,
	className = "",
}: {
	children: React.ReactNode;
	align: "left" | "center" | "right";
	className?: string;
}) {
	const alignCls = align === "center" ? "text-center" : align === "right" ? "text-right" : "text-left";
	return (
		<th
			className={`py-2.5 px-4 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground ${alignCls} ${className}`}
		>
			{children}
		</th>
	);
}

function CoverStat({ value, label }: { value: string; label: string }) {
	return (
		<div className="border-t-2 border-believe-700 pt-3">
			<div className="text-2xl font-bold">{value}</div>
			<div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
		</div>
	);
}

function Bar({ value, level }: { value: number | null; level: Level }) {
	return (
		<div className="w-full bg-muted rounded-full h-2.5">
			<div
				className="h-2.5 rounded-full"
				style={{ width: `${Math.max(2, value ?? 0)}%`, backgroundColor: STATUS_TONE[level].mark }}
			/>
		</div>
	);
}

function Badge({ category }: { category: PromptCategory }) {
	// Fuerza = lo que la marca ya tiene (azul). Oportunidad = lo que falta hacer (tinta).
	// El color no es el único canal: la etiqueta ya dice cuál es cuál.
	const cls =
		category === "strength"
			? "bg-primary/10 text-primary border-primary/30"
			: "bg-muted/60 text-foreground border-foreground/20";
	return (
		<span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${cls}`}>
			{category === "strength" ? "Strength" : "Opportunity"}
		</span>
	);
}

function SummaryRow({ label, value }: { label: string; value: string }) {
	return (
		<div className="flex justify-between items-center">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="text-xs font-semibold">{value}</span>
		</div>
	);
}

function Finding({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex gap-3 items-start">
			<div className="w-1.5 h-1.5 rounded-full bg-primary mt-[7px] shrink-0" />
			<p className="text-sm text-foreground leading-relaxed">{children}</p>
		</div>
	);
}

function PageFooter({ branding }: { branding?: ClientConfig["branding"] }) {
	return (
		<div className="pt-4 border-t border-border/60 flex justify-between items-center text-[10px] text-muted-foreground">
			<Logo iconClassName="!size-3" textClassName="text-[10px] font-medium text-muted-foreground" />
			<span>{branding?.url || "Getcito.chat"}</span>
		</div>
	);
}
