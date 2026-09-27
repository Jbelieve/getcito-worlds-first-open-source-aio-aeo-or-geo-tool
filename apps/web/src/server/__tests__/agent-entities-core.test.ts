/**
 * La idempotencia de `ensureEntity`, probada sin base.
 *
 * `ensureEntity` escribe, así que probarlo de punta a punta pide Postgres. Lo que sí es puro —y es
 * donde vive la decisión que no puede divergir entre el MCP y la UI— es la resolución de la entidad
 * existente (por proyecto de Maasy o por host) y la validación de la jerarquía. Eso es lo que se prueba
 * acá. El resto (insert/update) queda cubierto por los tipos y por la revisión.
 */
import { describe, expect, it } from "vitest";
import {
	assertEntityHierarchy,
	EnsureEntityError,
	type EntityHierarchyRow,
	resolveExistingEntity,
} from "../agent-entities-core";

const rows: EntityHierarchyRow[] = [
	{
		id: "e-umbrella",
		parentEntityId: null,
		websiteUrl: "https://autex.porsche.com",
		maasyProjectId: "maasy-1",
	},
	{
		id: "e-product",
		parentEntityId: "e-umbrella",
		websiteUrl: "https://tienda.autex.porsche.com",
		maasyProjectId: "maasy-2",
	},
];

describe("resolveExistingEntity", () => {
	it("encuentra por host: reintentar con la misma web no duplica", () => {
		const found = resolveExistingEntity(rows, { maasyProjectId: undefined, siteHost: "autex.porsche.com" });
		expect(found?.row.id).toBe("e-umbrella");
		expect(found?.matchedBy).toBe("host");
	});

	it("encuentra por proyecto de Maasy aunque no haya web", () => {
		const found = resolveExistingEntity(rows, { maasyProjectId: "maasy-2", siteHost: null });
		expect(found?.row.id).toBe("e-product");
		expect(found?.matchedBy).toBe("maasyProjectId");
	});

	it("el proyecto de Maasy gana sobre el host cuando apuntan a entidades distintas", () => {
		const found = resolveExistingEntity(rows, { maasyProjectId: "maasy-2", siteHost: "autex.porsche.com" });
		expect(found?.row.id).toBe("e-product");
		expect(found?.matchedBy).toBe("maasyProjectId");
	});

	it("sin claves o sin coincidencias no reusa nada: hay que crear", () => {
		expect(resolveExistingEntity(rows, { maasyProjectId: undefined, siteHost: null })).toBeNull();
		expect(resolveExistingEntity(rows, { maasyProjectId: "no-existe", siteHost: "otra.com" })).toBeNull();
	});

	it("el host se compara normalizado, así que www y mayúsculas dan lo mismo", () => {
		const found = resolveExistingEntity(rows, { maasyProjectId: undefined, siteHost: "autex.porsche.com" });
		expect(found?.row.id).toBe("e-umbrella");
	});
});

describe("assertEntityHierarchy", () => {
	it("acepta un producto colgando del paraguas de su marca", () => {
		expect(() => assertEntityHierarchy(rows, null, "e-umbrella")).not.toThrow();
	});

	it("rechaza un padre de otra marca: la jerarquía se valida contra la marca dueña", () => {
		expect(() => assertEntityHierarchy(rows, null, "e-ajena")).toThrow(EnsureEntityError);
	});

	it("rechaza que una entidad sea su propio padre", () => {
		expect(() => assertEntityHierarchy(rows, "e-umbrella", "e-umbrella")).toThrow(EnsureEntityError);
	});

	it("rechaza el ciclo: poner como padre a un descendiente", () => {
		expect(() => assertEntityHierarchy(rows, "e-umbrella", "e-product")).toThrow(EnsureEntityError);
	});

	it("rechaza un padre cuya jerarquía ya está rota", () => {
		const broken: EntityHierarchyRow[] = [
			{ id: "a", parentEntityId: "b", websiteUrl: null, maasyProjectId: null },
			{ id: "b", parentEntityId: "a", websiteUrl: null, maasyProjectId: null },
		];
		expect(() => assertEntityHierarchy(broken, null, "a")).toThrow(EnsureEntityError);
	});

	it("sin padre no valida nada: es el caso de la entidad paraguas", () => {
		expect(() => assertEntityHierarchy(rows, null, undefined)).not.toThrow();
	});
});
