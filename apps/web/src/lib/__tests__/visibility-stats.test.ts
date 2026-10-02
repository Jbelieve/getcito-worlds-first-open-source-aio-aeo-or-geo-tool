import { describe, expect, it } from "vitest";
import {
	computeShareOfVoice,
	computeVolatility,
	type DailyDomainCount,
	shareOfVoiceLeaderboardLVCF,
	shareOfVoiceTimeSeriesLVCF,
	stabilityScore,
	summarizeProviderResponseCoverage,
} from "@/lib/visibility-stats";

/** Helper: build daily rows from a {date: {domain: count}} spec. */
function rows(spec: Record<string, Record<string, number>>): DailyDomainCount[] {
	const out: DailyDomainCount[] = [];
	for (const [date, domains] of Object.entries(spec)) {
		for (const [domain, count] of Object.entries(domains)) {
			out.push({ date, domain, count });
		}
	}
	return out;
}

describe("computeVolatility", () => {
	it("returns nulls with zero transitions when there are fewer than two days", () => {
		expect(computeVolatility([])).toEqual({ setVolatility: null, weightedVolatility: null, dayTransitions: 0 });
		expect(computeVolatility(rows({ "2026-01-01": { a: 1, b: 1 } }))).toEqual({
			setVolatility: null,
			weightedVolatility: null,
			dayTransitions: 0,
		});
	});

	it("is zero for an identical domain set every day", () => {
		const r = computeVolatility(rows({ "2026-01-01": { a: 1, b: 1 }, "2026-01-02": { a: 1, b: 1 } }));
		expect(r.setVolatility).toBe(0);
		expect(r.weightedVolatility).toBe(0);
		expect(r.dayTransitions).toBe(1);
	});

	it("is one for completely disjoint sets each day", () => {
		const r = computeVolatility(rows({ "2026-01-01": { a: 1 }, "2026-01-02": { b: 1 } }));
		expect(r.setVolatility).toBe(1);
		expect(r.weightedVolatility).toBe(1);
	});

	it("matches hand-computed Jaccard and Bray–Curtis on a mixed example", () => {
		// day1 {a,b,c} -> day2 {b,c,d}: inter=2, union=4 -> setDist 0.5
		// shares all 1/3; overlap = min(b)+min(c) = 1/3+1/3 -> weightedDist 1/3
		const r = computeVolatility(rows({ "2026-01-01": { a: 1, b: 1, c: 1 }, "2026-01-02": { b: 1, c: 1, d: 1 } }));
		expect(r.setVolatility).toBe(0.5);
		expect(r.weightedVolatility).toBeCloseTo(0.333, 3);
	});

	it("captures the orthogonality of set churn vs volume churn (pinned head, noisy tail)", () => {
		// A dominant 'hub' every day (80% of volume) with a fully-rotating tail.
		// Set churn is high (most distinct domains change) but volume churn is low
		// (the source that carries the answer is stable).
		const r = computeVolatility(rows({ "2026-01-01": { hub: 8, x: 1, y: 1 }, "2026-01-02": { hub: 8, z: 1, w: 1 } }));
		expect(r.setVolatility).toBe(0.8); // inter {hub}=1, union 5 -> 1 - 1/5
		expect(r.weightedVolatility).toBeCloseTo(0.2, 5); // overlap = min(hub .8,.8) = .8
	});

	it("averages across multiple transitions and sums duplicate same-day rows", () => {
		const r = computeVolatility(
			rows({
				"2026-01-01": { a: 1, b: 1 }, // -> day2 identical: setDist 0
				"2026-01-02": { a: 1, b: 1 }, // -> day3 disjoint: setDist 1
				"2026-01-03": { c: 1, d: 1 },
			}),
		);
		expect(r.dayTransitions).toBe(2);
		expect(r.setVolatility).toBe(0.5); // (0 + 1) / 2
	});

	it("ignores non-positive counts", () => {
		const r = computeVolatility(rows({ "2026-01-01": { a: 1, ghost: 0 }, "2026-01-02": { a: 1 } }));
		expect(r.setVolatility).toBe(0); // 'ghost' dropped, both days = {a}
	});
});

describe("stabilityScore", () => {
	it("inverts weighted volatility onto a 0-100 scale", () => {
		expect(stabilityScore(0)).toBe(100);
		expect(stabilityScore(1)).toBe(0);
		expect(stabilityScore(0.2)).toBe(80);
		expect(stabilityScore(null)).toBeNull();
	});
});

describe("computeShareOfVoice", () => {
	it("computes shares that sum to 1 and sorts by mentions desc", () => {
		const { entries, brandShare, total } = computeShareOfVoice({ name: "Nike", mentions: 10 }, [
			{ name: "Adidas", mentions: 8 },
			{ name: "Puma", mentions: 2 },
		]);
		expect(total).toBe(20);
		expect(brandShare).toBe(0.5);
		expect(entries.map((e) => e.name)).toEqual(["Nike", "Adidas", "Puma"]);
		expect(entries.find((e) => e.isBrand)?.share).toBe(0.5);
		expect(entries.reduce((s, e) => s + e.share, 0)).toBeCloseTo(1, 5);
	});

	it("handles the no-data case without dividing by zero", () => {
		const { brandShare, entries } = computeShareOfVoice({ name: "Nike", mentions: 0 }, []);
		expect(brandShare).toBeNull();
		expect(entries[0]?.share).toBe(0);
	});
});

describe("shareOfVoiceTimeSeriesLVCF", () => {
	it("carries each prompt's last values forward across gap days", () => {
		const series = shareOfVoiceTimeSeriesLVCF(
			[
				{ promptId: "p1", date: "2026-01-01", brandMentions: 2, competitorMentions: 2 },
				{ promptId: "p1", date: "2026-01-03", brandMentions: 1, competitorMentions: 3 },
			],
			["2026-01-01", "2026-01-02", "2026-01-03"],
		);
		// day2 has no run, so it carries day1 (2/(2+2)=50%); day3 uses its own (1/(1+3)=25%)
		expect(series.map((s) => s.share)).toEqual([50, 50, 25]);
	});

	it("aggregates across prompts and yields null for days with no data", () => {
		const series = shareOfVoiceTimeSeriesLVCF(
			[
				{ promptId: "a", date: "2026-01-02", brandMentions: 1, competitorMentions: 0 },
				{ promptId: "b", date: "2026-01-02", brandMentions: 0, competitorMentions: 1 },
			],
			["2026-01-01", "2026-01-02"],
		);
		// day1: both prompts carry their earliest (day2) obs -> brand 1 / total 2 = 50
		expect(series[0]).toEqual({ date: "2026-01-01", share: 50 });
		expect(series[1]).toEqual({ date: "2026-01-02", share: 50 });
		expect(shareOfVoiceTimeSeriesLVCF([], ["2026-01-01"])).toEqual([{ date: "2026-01-01", share: null }]);
	});
});

describe("shareOfVoiceLeaderboardLVCF", () => {
	it("carries each prompt's last standings forward and sums per competitor", () => {
		const r = shareOfVoiceLeaderboardLVCF(
			[
				{ promptId: "p1", date: "2026-01-01", brand: 2 },
				{ promptId: "p1", date: "2026-01-03", brand: 1 },
				{ promptId: "p2", date: "2026-01-02", brand: 0 },
			],
			[
				{ promptId: "p1", date: "2026-01-01", competitor: "A", mentions: 1 },
				{ promptId: "p1", date: "2026-01-01", competitor: "B", mentions: 1 },
				{ promptId: "p1", date: "2026-01-03", competitor: "A", mentions: 3 },
				{ promptId: "p2", date: "2026-01-02", competitor: "A", mentions: 2 },
			],
			["2026-01-01", "2026-01-02", "2026-01-03"],
		);
		// p1's latest obs is day3 (brand 1, {A:3} — B is gone, not in the latest run);
		// p2's latest obs is day2 (brand 0, {A:2}).
		expect(r.brandMentions).toBe(1);
		expect(r.brandPrompts).toBe(1);
		expect(r.competitors).toEqual([{ name: "A", mentions: 5, prompts: 2 }]);
		// The implied brand share equals the trend's final point (1 / (1 + 5)).
		const fromLeaderboard = computeShareOfVoice({ name: "you", mentions: r.brandMentions }, r.competitors).brandShare;
		const trend = shareOfVoiceTimeSeriesLVCF(
			[
				{ promptId: "p1", date: "2026-01-01", brandMentions: 2, competitorMentions: 2 },
				{ promptId: "p1", date: "2026-01-03", brandMentions: 1, competitorMentions: 3 },
				{ promptId: "p2", date: "2026-01-02", brandMentions: 0, competitorMentions: 2 },
			],
			["2026-01-01", "2026-01-02", "2026-01-03"],
		);
		expect(Math.round((fromLeaderboard ?? 0) * 100)).toBe(trend[trend.length - 1].share);
	});

	it("returns empty for an empty date range", () => {
		expect(shareOfVoiceLeaderboardLVCF([], [], [])).toEqual({ brandMentions: 0, brandPrompts: 0, competitors: [] });
	});
});

describe("share-of-voice percentage consistency across computation methods", () => {
	it("leaderboard, donut, and trend round the same brand share to the same percent (no double-rounding)", () => {
		// 235 / 1002 = 23.453% — exactly the band where pre-rounding the share to
		// 3 decimals first would bump the leaderboard/donut to 24% while the trend,
		// rounding the exact ratio, shows 23%. All paths must land on 23%.
		const dateRange = ["2026-01-01"];

		// Trend (per-prompt LVCF time series): rounds brand / (brand + competitor).
		const trend = shareOfVoiceTimeSeriesLVCF(
			[{ promptId: "p1", date: "2026-01-01", brandMentions: 235, competitorMentions: 767 }],
			dateRange,
		);
		const trendPct = trend[trend.length - 1].share;

		// Leaderboard -> computeShareOfVoice (the source for the table + donut).
		const standings = shareOfVoiceLeaderboardLVCF(
			[{ promptId: "p1", date: "2026-01-01", brand: 235 }],
			[{ promptId: "p1", date: "2026-01-01", competitor: "X", mentions: 767 }],
			dateRange,
		);
		const { entries, brandShare } = computeShareOfVoice(
			{ name: "you", mentions: standings.brandMentions },
			standings.competitors.map((c) => ({ name: c.name, mentions: c.mentions })),
		);
		const brandEntry = entries.find((e) => e.isBrand);
		const total = entries.reduce((s, e) => s + e.mentions, 0);

		expect(trendPct).toBe(23); // headline / sparkline
		expect(Math.round((brandShare ?? 0) * 100)).toBe(23); // headline derived from the leaderboard
		expect(Math.round((brandEntry?.share ?? 0) * 100)).toBe(23); // leaderboard table cell (formatPct)
		expect(Math.round((brandEntry!.mentions / total) * 100)).toBe(23); // donut slice
	});
});

describe("summarizeProviderResponseCoverage — el fallo baja el número", () => {
	it("cuenta el fallo como intento: la proporción baja, no sube", () => {
		const healthy = summarizeProviderResponseCoverage(
			[{ date: "2026-10-02", planned: 6, succeeded: 6, failed: 0 }],
			6,
			4,
		);
		const degraded = summarizeProviderResponseCoverage(
			[{ date: "2026-10-02", planned: 9, succeeded: 6, failed: 3 }],
			6,
			4,
		);

		expect(healthy.attemptShare).toBe(67); // 4/6
		expect(degraded.attemptShare).toBe(44); // 4/9, no 4/6
		expect(healthy.attemptShare!).toBeGreaterThan(degraded.attemptShare!);
	});

	it("declara la cobertura: 'N de M corridas no respondieron'", () => {
		const coverage = summarizeProviderResponseCoverage(
			[{ date: "2026-10-02", planned: 9, succeeded: 6, failed: 3 }],
			6,
			4,
		);
		expect(coverage.label).toBe("3 de 9 corridas no respondieron");
		expect(coverage.state).toBe("partial");
		expect(coverage.responseRate).toBe(67);
		expect(coverage.isCoverageVerifiable).toBe(true);
	});

	it("agrega varios ciclos sin promediar promedios", () => {
		const coverage = summarizeProviderResponseCoverage(
			[
				{ date: "2026-10-02", planned: 9, succeeded: 6, failed: 3 },
				{ date: "2026-10-03", planned: 9, succeeded: 9, failed: 0 },
			],
			15,
			10,
		);
		expect(coverage.plannedRuns).toBe(18);
		expect(coverage.succeededRuns).toBe(15);
		expect(coverage.failedRuns).toBe(3);
		expect(coverage.label).toBe("3 de 18 corridas no respondieron");
		expect(coverage.attemptShare).toBe(56); // 10/18
	});

	it("sin ciclos declara el histórico incompleto y no rellena el denominador", () => {
		const coverage = summarizeProviderResponseCoverage([], 6, 4);
		expect(coverage.state).toBe("unverifiable");
		expect(coverage.isCoverageVerifiable).toBe(false);
		expect(coverage.attemptShare).toBeNull();
		expect(coverage.responseRate).toBeNull();
		expect(coverage.label).toMatch(/denominador histórico está incompleto/);
	});

	it("sin fallos el estado es `complete`", () => {
		const coverage = summarizeProviderResponseCoverage(
			[{ date: "2026-10-02", planned: 2, succeeded: 2, failed: 0 }],
			2,
			1,
		);
		expect(coverage.state).toBe("complete");
		expect(coverage.failedRuns).toBe(0);
	});

	it("un planned corto no encoge el denominador", () => {
		const coverage = summarizeProviderResponseCoverage(
			[{ date: "2026-10-02", planned: 6, succeeded: 6, failed: 3 }],
			9,
			4,
		);
		expect(coverage.plannedRuns).toBe(9);
		expect(coverage.label).toBe("3 de 9 corridas no respondieron");
	});
});
