/**
 * Server functions for brand operations.
 * Replaces apps/web/src/app/api/brands/* API routes.
 */
import { createServerFn } from "@tanstack/react-start";
import { MAX_COMPETITORS } from "@workspace/lib/constants";
import { db } from "@workspace/lib/db/db";
import { provisionAdditionalLocalOrg } from "@workspace/lib/db/provisioning";
import {
	type Brand,
	type BrandWithPrompts,
	brands,
	competitors,
	member,
	type NewBrand,
	organization,
	prompts,
} from "@workspace/lib/db/schema";
import type { ModelConfig } from "@workspace/lib/providers";
import { parseScrapeTargets, selectTargetsForBrand } from "@workspace/lib/providers";
import { and, count, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { listUserOrganizations, requireAuthSession, requireOrgAccess } from "@/lib/auth/helpers";
import { evaluateRequireCanCreateBrands } from "@/lib/auth/policies";
import { brandOwnsHost, type ExistingBrand, resolveBrandIdentity } from "@/lib/brand-id";
import { normalizeBrandUpdate } from "@/lib/brand-settings";
import { validateWebsiteUrl } from "@/lib/brand-website";
import { getDeployment } from "@/lib/config/server";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { hostOf } from "@/lib/report-agent";
import { deleteBrandCascade } from "@/server/brand-cascade";

/**
 * Deployment-configured models this brand actually runs, after applying
 * the brand's `enabledModels` override. The filter bar + LLMs info page +
 * any other UI that shows "which models is this brand tracking?" should
 * read from here instead of hardcoding a list — different deployments can
 * configure any arbitrary set of models via `SCRAPE_TARGETS`.
 *
 * `effectiveModels` is the flat id list that most callers want; the full
 * `ModelConfig[]` (with provider, version, webSearch) is kept on the same
 * object for pages that render per-model metadata (e.g. settings/llms).
 */
function computeEffectiveModels(brand: Brand): {
	effectiveModels: string[];
	effectiveModelConfigs: ModelConfig[];
} {
	try {
		const configs = parseScrapeTargets(process.env.SCRAPE_TARGETS);
		const effective = selectTargetsForBrand(configs, brand.enabledModels);
		return {
			effectiveModels: effective.map((c) => c.model),
			effectiveModelConfigs: effective,
		};
	} catch {
		// A misconfigured SCRAPE_TARGETS would already be surfacing via
		// `validateScrapeTargets` at boot; here we'd rather degrade to empty
		// lists than crash the brand fetch.
		return { effectiveModels: [], effectiveModelConfigs: [] };
	}
}

function getDefaultBrandDomains(): string[] {
	const raw = process.env.DEFAULT_BRAND_DOMAINS;
	if (!raw) return [];
	return raw
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean)
		.map((d) => cleanAndValidateDomain(d))
		.filter((d): d is string => d !== null);
}

// ============================================================================
// Helper functions (migrated from apps/web/src/lib/metadata.ts)
// ============================================================================

async function getBrandWithPromptsFromDb(
	brandId: string,
): Promise<(BrandWithPrompts & { effectiveModels: string[]; effectiveModelConfigs: ModelConfig[] }) | undefined> {
	try {
		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, brandId),
		});
		if (!brand) return undefined;

		const brandPrompts = await db.query.prompts.findMany({
			where: eq(prompts.brandId, brandId),
		});
		const brandCompetitors = await db.query.competitors.findMany({
			where: eq(competitors.brandId, brandId),
		});

		return {
			...brand,
			prompts: brandPrompts,
			competitors: brandCompetitors,
			...computeEffectiveModels(brand),
		};
	} catch (error) {
		console.error("Error fetching brand with prompts:", error);
		return undefined;
	}
}

// ============================================================================
// Server Functions
// ============================================================================

/**
 * Get all brands the current user has access to
 */
export const getBrands = createServerFn({ method: "GET" }).handler(async () => {
	const session = await requireAuthSession();
	const userBrands = await listUserOrganizations(session.user.id);

	if (!userBrands || userBrands.length === 0) {
		return [];
	}

	const brandsData = await Promise.all(
		userBrands.map(async (userBrand) => {
			const dbBrand = await getBrandWithPromptsFromDb(userBrand.id);
			return dbBrand ? { ...dbBrand, name: dbBrand.name } : null;
		}),
	);

	return brandsData.filter(
		(brand): brand is BrandWithPrompts & { effectiveModels: string[]; effectiveModelConfigs: ModelConfig[] } =>
			brand !== null,
	);
});

/**
 * Get a single brand by ID
 */
export const getBrand = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const brand = await getBrandWithPromptsFromDb(data.brandId);
		if (!brand) {
			throw new Error("Brand not found");
		}

		return brand;
	});

/**
 * Create a new brand
 */
export const createBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			brandName: z.string(),
			website: z.string(),
			targetMarket: z.string().optional(),
			targetLanguage: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const urlValidation = validateWebsiteUrl(data.website);
		if (!urlValidation.isValid) {
			throw new Error(urlValidation.error);
		}

		const defaultDomains = getDefaultBrandDomains();

		const result = await db
			.insert(brands)
			.values({
				id: data.brandId,
				name: data.brandName,
				website: urlValidation.formattedUrl,
				targetMarket: data.targetMarket,
				targetLanguage: data.targetLanguage,
				enabled: true,
				...(defaultDomains.length > 0 && { additionalDomains: defaultDomains }),
			})
			.onConflictDoNothing()
			.returning();

		const brand =
			result[0] ??
			(await db.query.brands.findFirst({
				where: eq(brands.id, data.brandId),
			}));

		if (!brand) {
			throw new Error("Failed to create brand");
		}

		return { success: true, brand };
	});

/**
 * Create a new organization + admin membership + brand in one shot for the
 * current user. Used by the local-mode multi-brand "create new brand" flow on
 * the brand switcher. Gated by the canCreateBrands deployment feature so
 * whitelabel (orgs come from Auth0) and demo (read-only) reject it.
 */
export const createBrandWithOrgFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandName: z.string().min(1).max(100),
			website: z.string().min(1),
			targetMarket: z.string().optional(),
			targetLanguage: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		const deployment = getDeployment();

		if (evaluateRequireCanCreateBrands(deployment.features.canCreateBrands) === "deny") {
			throw new Error("Brand creation is not allowed in this deployment");
		}

		const urlValidation = validateWebsiteUrl(data.website);
		if (!urlValidation.isValid) {
			throw new Error(urlValidation.error);
		}

		const trimmedName = data.brandName.trim();
		if (!trimmedName) {
			throw new Error("Brand name must be a non-empty string");
		}

		const { orgId } = await provisionAdditionalLocalOrg({
			userId: session.user.id,
			name: trimmedName,
		});

		const defaultDomains = getDefaultBrandDomains();

		await db.insert(brands).values({
			id: orgId,
			name: trimmedName,
			website: urlValidation.formattedUrl,
			targetMarket: data.targetMarket,
			targetLanguage: data.targetLanguage,
			enabled: true,
			...(defaultDomains.length > 0 && { additionalDomains: defaultDomains }),
		});

		return { brandId: orgId };
	});

/** Lo que devuelve `createBrandForCurrentUserFn`: la marca, si nació ahora, y si no, por qué se reusó. */
export interface CreateBrandForCurrentUserResult {
	brandId: string;
	name: string;
	website: string;
	created: boolean;
	/** Presente solo cuando `created` es `false`: si la marca se reusó por web o por id. */
	matchedBy?: "host" | "id";
	message?: string;
}

/**
 * Create a brand for the current user, from just its name and web.
 *
 * `createBrandFn` can't do this: it requires `requireOrgAccess` on a brand id
 * the user already has, so it only fills in a brand that auth already granted.
 * This is the entry point for a user who has no brand at all, and it is the
 * only place where the missing link is made explicitly: a `brands` row alone
 * is invisible to its creator, because `requireOrgAccess` only ever looks at
 * `member.organization_id` against the brand id.
 *
 * Idempotent like the MCP's `ensure_brand`: the id is derived from the host
 * (`acme.com` → `acme-com`, the same criterion as the MCP, shared in
 * `@/lib/brand-id`) and if a brand already owns that host — or already has
 * that id — this returns it with `created: false` instead of failing or
 * duplicating.
 */
export const createBrandForCurrentUserFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			name: z.string().trim().min(1).max(100),
			website: z.string().min(1),
			targetMarket: z.string().optional(),
			targetLanguage: z.string().optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();

		if (evaluateRequireCanCreateBrands(getDeployment().features.canCreateBrands) === "deny") {
			throw new Error("Brand creation is not allowed in this deployment");
		}

		const urlValidation = validateWebsiteUrl(data.website);
		if (!urlValidation.isValid) {
			throw new Error(urlValidation.error);
		}

		const name = data.name.trim();
		const defaultDomains = getDefaultBrandDomains();
		const brandValues: Omit<NewBrand, "id"> = {
			name,
			website: urlValidation.formattedUrl,
			targetMarket: data.targetMarket,
			targetLanguage: data.targetLanguage,
			enabled: true,
		};

		return db.transaction(async (tx): Promise<CreateBrandForCurrentUserResult> => {
			const existingBrands = (await tx
				.select({
					id: brands.id,
					name: brands.name,
					website: brands.website,
					additionalDomains: brands.additionalDomains,
				})
				.from(brands)) satisfies ExistingBrand[];

			const identity = resolveBrandIdentity({ website: urlValidation.formattedUrl, existing: existingBrands });
			if ("error" in identity) throw new Error(identity.error);

			if (identity.action === "reuse") {
				const reusedName = identity.name ?? name;
				return {
					brandId: identity.brandId,
					name: reusedName,
					website: identity.website ?? urlValidation.formattedUrl,
					created: false,
					matchedBy: identity.matchedBy,
					message:
						identity.matchedBy === "host"
							? `Ya existía una marca con esa web: «${reusedName}». Te llevo a esa.`
							: `Ya existía una marca con el id «${identity.brandId}»: «${reusedName}». Te llevo a esa.`,
				};
			}

			// Los dominios por defecto del deployment son un atajo, no una decisión: si uno ya es de otra
			// marca, esta alta lo dejaría declarado por dos y el próximo match por host sería ambiguo.
			const inheritableDomains = defaultDomains.filter((domain) => {
				const host = hostOf(domain);
				return host !== null && !existingBrands.some((existing) => brandOwnsHost(existing, host));
			});

			// El vínculo que hace visible la marca: `requireOrgAccess` compara `member.organization_id`
			// contra el id de la marca, así que la organización tiene que nacer con ese mismo id — y en
			// esta misma transacción, o el alta deja una marca huérfana si el proceso muere en el medio.
			// Es la misma fila que crea `provisionAdditionalLocalOrg` en local; se escribe acá y no se
			// delega porque el helper abre su propia transacción, y dos transacciones no son una.
			await tx
				.insert(organization)
				.values({ id: identity.brandId, name, slug: identity.brandId, createdAt: new Date() })
				.onConflictDoNothing({ target: organization.id });

			const [existingMember] = await tx
				.select({ id: member.id })
				.from(member)
				.where(and(eq(member.organizationId, identity.brandId), eq(member.userId, session.user.id)))
				.limit(1);
			if (existingMember === undefined) {
				await tx.insert(member).values({
					id: crypto.randomUUID(),
					organizationId: identity.brandId,
					userId: session.user.id,
					role: "admin",
					createdAt: new Date(),
				});
			}

			const inserted = await tx
				.insert(brands)
				.values({
					...brandValues,
					id: identity.brandId,
					...(inheritableDomains.length > 0 && { additionalDomains: inheritableDomains }),
				})
				.onConflictDoNothing()
				.returning();

			const brand =
				inserted[0] ??
				(await tx.query.brands.findFirst({
					where: eq(brands.id, identity.brandId),
				}));

			if (!brand) throw new Error("Failed to create brand");

			return {
				brandId: brand.id,
				name: brand.name,
				website: brand.website,
				created: inserted.length > 0,
			};
		});
	});

/**
 * Update a brand
 */
export const updateBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			name: z.string().optional(),
			website: z.string().optional(),
			targetMarket: z.string().optional(),
			targetLanguage: z.string().optional(),
			shortDescription: z.string().optional(),
			additionalDomains: z.array(z.string()).optional(),
			aliases: z.array(z.string()).optional(),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const normalized = normalizeBrandUpdate({
			name: data.name,
			website: data.website,
			additionalDomains: data.additionalDomains,
			aliases: data.aliases,
		});
		if (!normalized.ok) {
			throw new Error(normalized.error);
		}
		const updateData = {
			...normalized.updates,
			...(data.targetMarket !== undefined && { targetMarket: data.targetMarket }),
			...(data.targetLanguage !== undefined && { targetLanguage: data.targetLanguage }),
			...(data.shortDescription !== undefined && { shortDescription: data.shortDescription }),
		};

		const result = await db
			.update(brands)
			.set({ ...updateData, updatedAt: new Date() })
			.where(eq(brands.id, data.brandId))
			.returning();

		if (!result[0]) {
			throw new Error("Failed to update brand");
		}

		return result[0];
	});

/**
 * Get competitors for a brand
 */
export const getCompetitors = createServerFn({ method: "GET" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		return db.query.competitors.findMany({
			where: eq(competitors.brandId, data.brandId),
		});
	});

/**
 * Update competitors for a brand (bulk replace)
 */
export const updateCompetitors = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			competitors: z.array(
				z.object({
					name: z.string(),
					domains: z.array(z.string()).min(1),
					aliases: z.array(z.string()).optional().default([]),
				}),
			),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		// Validate and clean domains
		const cleanedCompetitors = data.competitors.map((c) => {
			const cleanedDomains = c.domains.map((d) => cleanAndValidateDomain(d));
			const invalid = c.domains.filter((_, i) => !cleanedDomains[i]);
			if (invalid.length > 0) {
				throw new Error(`Invalid domain(s) for "${c.name}": ${invalid.join(", ")}`);
			}
			return {
				name: c.name,
				domains: cleanedDomains.filter(Boolean) as string[],
				aliases: c.aliases,
			};
		});

		return db.transaction(async (tx) => {
			await tx.delete(competitors).where(eq(competitors.brandId, data.brandId));

			if (cleanedCompetitors.length > 0) {
				await tx.insert(competitors).values(
					cleanedCompetitors.map((c) => ({
						brandId: data.brandId,
						name: c.name,
						domains: c.domains,
						aliases: c.aliases,
					})),
				);
			}

			return tx.query.competitors.findMany({
				where: eq(competitors.brandId, data.brandId),
			});
		});
	});

/**
 * Add an additional domain to the brand itself
 */
export const addDomainToBrandFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const domain = cleanAndValidateDomain(data.domain);
		if (!domain) throw new Error(`Invalid domain: ${data.domain}`);

		const [result] = await db
			.update(brands)
			.set({
				additionalDomains: sql`array_append(${brands.additionalDomains}, ${domain})`,
				updatedAt: new Date(),
			})
			.where(and(eq(brands.id, data.brandId), sql`NOT (${domain} = ANY(${brands.additionalDomains}))`))
			.returning();

		if (result) return result;

		const brand = await db.query.brands.findFirst({
			where: eq(brands.id, data.brandId),
		});
		if (!brand) throw new Error("Brand not found");
		return brand;
	});

/**
 * Add a domain to an existing competitor
 */
export const addDomainToCompetitorFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			competitorId: z.string(),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const existing = await db.query.competitors.findFirst({
			where: and(eq(competitors.id, data.competitorId), eq(competitors.brandId, data.brandId)),
		});
		if (!existing) throw new Error("Competitor not found");

		const domain = cleanAndValidateDomain(data.domain);
		if (!domain) throw new Error(`Invalid domain: ${data.domain}`);
		if (existing.domains.includes(domain)) return existing;

		const updatedDomains = [...existing.domains, domain];
		const [result] = await db
			.update(competitors)
			.set({ domains: updatedDomains, updatedAt: new Date() })
			.where(eq(competitors.id, data.competitorId))
			.returning();

		return result;
	});

/**
 * Create a new competitor from a domain
 */
export const createCompetitorFromDomainFn = createServerFn({ method: "POST" })
	.validator(
		z.object({
			brandId: z.string(),
			name: z.string().min(1),
			domain: z.string().min(1),
		}),
	)
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		const domain = cleanAndValidateDomain(data.domain);
		if (!domain) throw new Error(`Invalid domain: ${data.domain}`);

		const [currentCount] = await db
			.select({ count: count() })
			.from(competitors)
			.where(eq(competitors.brandId, data.brandId));

		if ((currentCount?.count || 0) >= MAX_COMPETITORS) {
			throw new Error(`Cannot add competitor. Maximum of ${MAX_COMPETITORS} competitors reached.`);
		}

		const [result] = await db
			.insert(competitors)
			.values({
				brandId: data.brandId,
				name: data.name.trim(),
				domains: [domain],
			})
			.returning();

		return result;
	});

/**
 * Delete a brand and all associated data
 */
export const deleteBrandFn = createServerFn({ method: "POST" })
	.validator(z.object({ brandId: z.string() }))
	.handler(async ({ data }) => {
		const session = await requireAuthSession();
		await requireOrgAccess(session.user.id, data.brandId);

		await deleteBrandCascade(data.brandId);

		return { success: true };
	});
