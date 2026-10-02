import { describe, expect, it } from "vitest";
import { type ProviderCoverageView, providerCoverageText } from "@/components/provider-coverage-note";

function coverage(overrides: Partial<ProviderCoverageView> = {}): ProviderCoverageView {
	return {
		plannedRuns: 9,
		succeededRuns: 6,
		failedRuns: 3,
		state: "partial",
		label: "3 de 9 corridas no respondieron",
		attemptShare: 44,
		isCoverageVerifiable: true,
		...overrides,
	};
}

describe("providerCoverageText — el número nunca sale solo", () => {
	it("declara N de M cuando la cobertura es parcial", () => {
		expect(providerCoverageText(coverage())).toBe("3 de 9 corridas no respondieron");
	});

	it("declara la cobertura completa con los dos números", () => {
		expect(
			providerCoverageText(coverage({ state: "complete", failedRuns: 0, label: "0 de 9 corridas no respondieron" })),
		).toBe("6 de 9 corridas respondieron.");
	});

	it("el histórico sin intentos se declara incompleto", () => {
		const text = providerCoverageText(
			coverage({
				state: "unverifiable",
				isCoverageVerifiable: false,
				label: "El denominador histórico está incompleto.",
				attemptShare: null,
			}),
		);
		expect(text).toBe("El denominador histórico está incompleto.");
	});

	it("sin medición no se declara nada, y nunca como completo", () => {
		expect(providerCoverageText(undefined)).toBeNull();
		expect(providerCoverageText(coverage({ state: "no_data" }))).toBeNull();
	});
});
