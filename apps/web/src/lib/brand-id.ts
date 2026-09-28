/**
 * El id de una marca, derivado del host de su web — y la decisión de reusar la que ya existe.
 *
 * Esto vivía dentro del MCP (`ensure_brand`), y la UI necesitaba exactamente el mismo criterio para
 * dar de alta una marca desde `/admin`. Dos esquemas de ids habrían creado dos marcas para la misma
 * web, así que se extrajo acá y las dos puertas lo usan: el MCP y `createBrandForCurrentUserFn`.
 *
 * Es puro a propósito: no toca base y se puede probar entero. Lo único que no vive acá es el
 * `insert`/`update`, que sí pide Postgres.
 */
import { hostOf } from "@/lib/report-agent";

/** Lo mínimo de una marca ya existente para decidir si la de esta web ya está dada de alta. */
export interface ExistingBrand {
	id: string;
	website: string;
	additionalDomains: string[];
	name?: string;
}

/** Lo que hay que hacer con una web: reusar una marca o crear una con este id. */
export type BrandIdentity =
	| {
			action: "reuse";
			brandId: string;
			/** La web ya estaba dada de alta (o, si no, el id que mandó el consumidor). */
			matchedBy: "host" | "id";
			name?: string;
			website?: string;
	  }
	| { action: "create"; brandId: string };

/** Un id legible a partir del host: `autex.porsche.com` → `autex-porsche-com`. Nunca un uuid. */
export function brandIdFromHost(host: string): string {
	const slug = host
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return slug.length > 0 ? slug : "brand";
}

/**
 * El id de marca de una web, normalizada por `hostOf` (sin `www.`, en minúscula) antes de derivar.
 *
 * Es el camino que usan las dos puertas: así `https://WWW.Acme.com/x` y `acme.com` no pueden dar ids
 * distintos por haber normalizado en un lado y no en el otro.
 */
export function brandIdForWebsite(website: string): string | null {
	const host = hostOf(website);
	return host === null ? null : brandIdFromHost(host);
}

/** El primer id libre: si `acme-com` está tomado, `acme-com-2`, y así. */
export function uniqueBrandId(base: string, taken: ReadonlySet<string>): string {
	if (taken.has(base) === false) return base;
	let suffix = 2;
	while (taken.has(`${base}-${suffix}`)) suffix += 1;
	return `${base}-${suffix}`;
}

/** Si la marca ya declaró ese host, como web principal o como dominio adicional. */
export function brandOwnsHost(brand: ExistingBrand, host: string): boolean {
	return hostOf(brand.website) === host || brand.additionalDomains.some((domain) => hostOf(domain) === host);
}

/**
 * La coincidencia cruda: qué marca de la lista es esta web, y si coincidió por host o por id.
 *
 * La usan las dos puertas. El MCP la necesita además para quedarse con la fila que va a actualizar.
 */
export function matchIdentity(input: {
	website: string;
	existing: ExistingBrand[];
	providedId?: string;
}): { brand: ExistingBrand; matchedBy: "host" | "id" } | null {
	const host = hostOf(input.website);
	if (host === null) return null;

	const byId =
		input.providedId === undefined ? undefined : input.existing.find((brand) => brand.id === input.providedId);
	if (byId !== undefined) return { brand: byId, matchedBy: "id" };

	const byHost = input.existing.find((brand) => brandOwnsHost(brand, host));
	return byHost === undefined ? null : { brand: byHost, matchedBy: "host" };
}

export type BrandIdentityError = { error: string };

/**
 * Resuelve el id de una marca a partir de su web.
 *
 * - Si el host ya está tomado por otra marca, se reusa esa: reintentar no duplica.
 * - Si el id derivado está tomado pero el host no, se le agrega un sufijo — un choque de id no es
 *   motivo para rechazar una marca distinta.
 * - `providedId` (el MCP lo acepta) manda sobre el derivado, pero nunca pisa el dueño de un host.
 */
export function resolveBrandIdentity(input: {
	website: string;
	existing: ExistingBrand[];
	providedId?: string;
}): BrandIdentity | BrandIdentityError {
	const host = hostOf(input.website);
	if (host === null) return { error: `"website" no es una URL usable: ${input.website}` };

	// El caso que no se resuelve reusando: el consumidor pidió un id que ya es de otra marca y la web
	// ya es de una tercera. Reasignar el host en silencio cambiaría de dueño una marca existente.
	const byId =
		input.providedId === undefined ? undefined : input.existing.find((brand) => brand.id === input.providedId);
	if (byId !== undefined) {
		const owner = input.existing.find((brand) => brandOwnsHost(brand, host));
		if (owner !== undefined && owner.id !== byId.id) {
			return { error: `El host "${host}" ya pertenece a la marca "${owner.id}"; no se reasigna a "${byId.id}".` };
		}
	}

	const match = matchIdentity(input);
	if (match !== null) {
		return {
			action: "reuse",
			brandId: match.brand.id,
			matchedBy: match.matchedBy,
			...(match.brand.name === undefined ? {} : { name: match.brand.name }),
			website: match.brand.website,
		};
	}

	const base = input.providedId ?? brandIdForWebsite(input.website) ?? "brand";
	return { action: "create", brandId: uniqueBrandId(base, new Set(input.existing.map((brand) => brand.id))) };
}
