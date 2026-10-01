import { describe, expect, it } from "vitest";
import { normalizeBrandUpdate } from "@/lib/brand-settings";

describe("normalizeBrandUpdate", () => {
	it("returns an empty update set when no fields are provided", () => {
		const result = normalizeBrandUpdate({});
		expect(result).toEqual({ ok: true, updates: {} });
	});

	it("only touches fields that are present (partial edit)", () => {
		const result = normalizeBrandUpdate({ name: "Acme" });
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.updates).toEqual({ name: "Acme" });
			expect(result.updates).not.toHaveProperty("website");
			expect(result.updates).not.toHaveProperty("aliases");
		}
	});

	describe("name", () => {
		it("trims surrounding whitespace", () => {
			const result = normalizeBrandUpdate({ name: "  Acme  " });
			expect(result).toEqual({ ok: true, updates: { name: "Acme" } });
		});

		it.each([
			["empty string", ""],
			["whitespace only", "   "],
		])("rejects a %s name", (_label, name) => {
			expect(normalizeBrandUpdate({ name })).toEqual({
				ok: false,
				error: "Brand name must be a non-empty string",
			});
		});
	});

	describe("website", () => {
		it("normalizes a bare domain to an origin URL", () => {
			const result = normalizeBrandUpdate({ website: "acme.com/products" });
			expect(result).toEqual({ ok: true, updates: { website: "https://acme.com/" } });
		});

		it("rejects an invalid website", () => {
			const result = normalizeBrandUpdate({ website: "not a url" });
			expect(result.ok).toBe(false);
			if (!result.ok) expect(result.error).toMatch(/valid/i);
		});
	});

	describe("additionalDomains", () => {
		it("cleans and de-duplicates valid domains", () => {
			const result = normalizeBrandUpdate({
				additionalDomains: ["https://www.acme.com/path", "acme.com", "blog.acme.io"],
			});
			expect(result.ok).toBe(true);
			if (result.ok) {
				expect(result.updates.additionalDomains).toEqual(["acme.com", "blog.acme.io"]);
			}
		});

		it("reports every invalid domain in the input", () => {
			const result = normalizeBrandUpdate({
				additionalDomains: ["acme.com", "not a domain", "also bad"],
			});
			expect(result).toEqual({
				ok: false,
				error: "Invalid domain(s): not a domain, also bad",
			});
		});

		it("accepts an empty list", () => {
			const result = normalizeBrandUpdate({ additionalDomains: [] });
			expect(result).toEqual({ ok: true, updates: { additionalDomains: [] } });
		});
	});

	describe("aliases", () => {
		it("trims, drops empties, and de-duplicates", () => {
			const result = normalizeBrandUpdate({ aliases: ["Acme", "  Acme Inc ", "", "  ", "Acme"] });
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.updates.aliases).toEqual(["Acme", "Acme Inc"]);
		});
	});

	describe("category", () => {
		it("trims the declared category", () => {
			expect(normalizeBrandUpdate({ category: "  Automotriz  " })).toEqual({
				ok: true,
				updates: { category: "Automotriz" },
			});
		});

		/**
		 * Vacío es una acción, no ausencia: si "" se tratara como "no lo mandaste", la categoría no se
		 * podría dejar de declarar nunca, y la marca quedaría atada a la que declaró una vez.
		 */
		it("clears the category to null when the operator empties the field", () => {
			expect(normalizeBrandUpdate({ category: "" })).toEqual({ ok: true, updates: { category: null } });
			expect(normalizeBrandUpdate({ category: "   " })).toEqual({ ok: true, updates: { category: null } });
		});

		it("does not touch the category when it is not in the payload", () => {
			const result = normalizeBrandUpdate({ name: "Acme" });
			expect(result.ok).toBe(true);
			if (result.ok) expect(result.updates).not.toHaveProperty("category");
		});
	});

	it("validates all provided fields together", () => {
		const result = normalizeBrandUpdate({
			name: " Acme ",
			website: "acme.com",
			additionalDomains: ["acme.io", "acme.io"],
			aliases: [" Acme ", "Acme"],
			category: " Automotriz ",
		});
		expect(result).toEqual({
			ok: true,
			updates: {
				name: "Acme",
				website: "https://acme.com/",
				additionalDomains: ["acme.io"],
				aliases: ["Acme"],
				category: "Automotriz",
			},
		});
	});
});
