/**
 * El id de marca y la decisión de reusar, probados sin base.
 *
 * Esto es lo que el MCP (`ensure_brand`) y el alta de la UI
 * (`createBrandForCurrentUserFn`) comparten: si divergieran, la misma web daría dos marcas. Lo que no
 * se puede probar acá es el `insert`/`update` ni el vínculo con la organización — eso pide Postgres.
 */
import { describe, expect, it } from "vitest";
import {
	brandIdForWebsite,
	brandIdFromHost,
	brandOwnsHost,
	type ExistingBrand,
	matchIdentity,
	resolveBrandIdentity,
	uniqueBrandId,
} from "../brand-id";

const existing: ExistingBrand[] = [
	{ id: "acme-com", name: "Acme", website: "https://acme.com/", additionalDomains: [] },
	{ id: "felix-com", name: "Felix", website: "https://felix.com/", additionalDomains: ["tienda.felix.com"] },
];

describe("brandIdFromHost", () => {
	it("deriva un id legible del host", () => {
		expect(brandIdFromHost("acme.com")).toBe("acme-com");
		expect(brandIdFromHost("autex.porsche.com")).toBe("autex-porsche-com");
	});

	it("las mayúsculas no cambian el id", () => {
		expect(brandIdFromHost("ACME.COM")).toBe("acme-com");
	});

	it("colapsa los separadores en un guion y los recorta", () => {
		expect(brandIdFromHost("mi--marca..com")).toBe("mi-marca-com");
		expect(brandIdFromHost("-acme-.com")).toBe("acme-com");
		expect(brandIdFromHost("...")).toBe("brand");
	});

	it("un host sin caracteres usables no deja un id vacío", () => {
		// La clave primaria de `brands` no acepta un id vacío: si el host no deja slug, el id sigue
		// siendo legible. `www.` no se recorta acá — de eso se encarga `brandIdForWebsite`, que
		// normaliza por `hostOf` antes de derivar.
		expect(brandIdFromHost("")).toBe("brand");
		expect(brandIdFromHost("---")).toBe("brand");
	});

	it("el id sigue siendo un slug válido para la url y para la organización", () => {
		// El id de la marca se usa también como id/slug de `organization`, que es único: si esto dejara
		// mayúsculas o puntos, la organización no coincidiría con la marca.
		for (const host of ["WWW.Acme.COM", "autex.porsche.com", "ñandú.com", "acme.com"]) {
			expect(brandIdFromHost(host)).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
		}
	});
});

describe("brandIdForWebsite", () => {
	it("normaliza por host antes de derivar, así que `www` y mayúsculas no cambian el id", () => {
		expect(brandIdForWebsite("https://WWW.Acme.com/promos")).toBe("acme-com");
		expect(brandIdForWebsite("www.acme.com")).toBe(brandIdForWebsite("acme.com"));
	});

	it("una web sin host usable no deriva un id", () => {
		// `new URL("")` no existe: no hay host del que sacar un id, y el que llama tiene que decidir.
		expect(brandIdForWebsite("")).toBeNull();
		expect(brandIdForWebsite("   ")).toBeNull();
	});
});

describe("uniqueBrandId", () => {
	it("deja el id tal cual si está libre", () => {
		expect(uniqueBrandId("acme-com", new Set())).toBe("acme-com");
	});

	it("le agrega sufijo si está tomado, sin pisar al dueño", () => {
		expect(uniqueBrandId("acme-com", new Set(["acme-com"]))).toBe("acme-com-2");
		expect(uniqueBrandId("acme-com", new Set(["acme-com", "acme-com-2"]))).toBe("acme-com-3");
	});
});

describe("brandOwnsHost", () => {
	it("reconoce la web principal y los dominios adicionales, normalizados", () => {
		const [acme, felix] = existing;
		if (!acme || !felix) throw new Error("fixture incompleto");
		expect(brandOwnsHost(acme, "acme.com")).toBe(true);
		expect(brandOwnsHost(acme, "otra.com")).toBe(false);
		expect(brandOwnsHost(felix, "tienda.felix.com")).toBe(true);
	});
});

describe("resolveBrandIdentity", () => {
	it("reusa la marca que ya tiene esa web: reintentar no duplica", () => {
		const identity = resolveBrandIdentity({ website: "https://acme.com", existing });
		expect(identity).toMatchObject({ action: "reuse", brandId: "acme-com", matchedBy: "host", name: "Acme" });
	});

	it("el `www.` y las mayúsculas caen en la misma marca", () => {
		for (const website of ["https://www.ACME.com", "www.acme.com", "acme.com/promos"]) {
			expect(resolveBrandIdentity({ website, existing })).toMatchObject({
				action: "reuse",
				brandId: "acme-com",
				matchedBy: "host",
			});
		}
	});

	it("un dominio adicional también cuenta como la misma marca", () => {
		expect(resolveBrandIdentity({ website: "tienda.felix.com", existing })).toMatchObject({
			action: "reuse",
			brandId: "felix-com",
			matchedBy: "host",
		});
	});

	it("crea con el id derivado cuando la web es nueva", () => {
		expect(resolveBrandIdentity({ website: "nueva.com", existing })).toEqual({
			action: "create",
			brandId: "nueva-com",
		});
	});

	it("un choque de id sin choque de host agrega sufijo en vez de reusar otra marca", () => {
		// `acme-com` está tomado por otra web: la marca nueva es distinta y merece su propio id.
		const taken: ExistingBrand[] = [{ id: "nueva-com", website: "https://otra.com/", additionalDomains: [] }];
		expect(resolveBrandIdentity({ website: "nueva.com", existing: taken })).toEqual({
			action: "create",
			brandId: "nueva-com-2",
		});
	});

	it("el id que manda el consumidor del MCP manda sobre el derivado", () => {
		expect(resolveBrandIdentity({ website: "nueva.com", existing, providedId: "mi-id" })).toEqual({
			action: "create",
			brandId: "mi-id",
		});
	});

	it("el id explícito reusa esa marca aunque la web sea otra", () => {
		expect(resolveBrandIdentity({ website: "nueva.com", existing, providedId: "acme-com" })).toMatchObject({
			action: "reuse",
			brandId: "acme-com",
			matchedBy: "id",
		});
	});

	it("no reasigna el host de una marca a otra: eso es un error, no un reuso", () => {
		const identity = resolveBrandIdentity({ website: "acme.com", existing, providedId: "felix-com" });
		expect(identity).toHaveProperty("error");
		expect((identity as { error: string }).error).toContain("acme-com");
	});

	it("una web que no es URL usable no deriva nada", () => {
		expect(resolveBrandIdentity({ website: "", existing })).toHaveProperty("error");
	});
});

describe("matchIdentity", () => {
	it("dice por qué reusó: por host cuando la web coincide, por id cuando lo mandó el consumidor", () => {
		expect(matchIdentity({ website: "acme.com", existing })?.matchedBy).toBe("host");
		expect(matchIdentity({ website: "nueva.com", existing, providedId: "acme-com" })?.matchedBy).toBe("id");
	});

	it("devuelve la fila existente, que es lo que el MCP necesita para el patch", () => {
		expect(matchIdentity({ website: "tienda.felix.com", existing })?.brand.id).toBe("felix-com");
	});

	it("sin coincidencias devuelve null: hay que crear", () => {
		expect(matchIdentity({ website: "nueva.com", existing })).toBeNull();
		expect(matchIdentity({ website: "", existing })).toBeNull();
	});
});
