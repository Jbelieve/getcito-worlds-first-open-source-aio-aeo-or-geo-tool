/**
 * /app/$brand/settings/brand - Brand settings page
 *
 * Form to edit brand name, website, additional domains, and aliases.
 */

import { IconInfoCircle } from "@tabler/icons-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, useNavigate, useRouteContext } from "@tanstack/react-router";
import type { ClientConfig } from "@workspace/config/types";
import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";
import { TARGET_MARKETS } from "@workspace/lib/locations";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Label } from "@workspace/ui/components/label";
import {
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@workspace/ui/components/select";
import { TagsInput } from "@workspace/ui/components/tags-input";
import { Textarea } from "@workspace/ui/components/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/components/tooltip";
import { useCallback, useState } from "react";
import { WebLogo } from "@/components/web-logo";
import { useBrand } from "@/hooks/use-brands";
import { citationKeys } from "@/hooks/use-citations";
import { dashboardKeys } from "@/hooks/use-dashboard-summary";
import { cleanAndValidateDomain } from "@/lib/domain-categories";
import { buildTitle, getAppName, getBrandName } from "@/lib/route-head";
import { getBrandCategorySuggestionFn } from "@/server/agent-aps";
import { deleteBrandFn, updateBrandFn } from "@/server/brands";

export const Route = createFileRoute("/_authed/app/$brand/settings/brand")({
	head: ({ matches, match }) => {
		const appName = getAppName(match);
		const brandName = getBrandName(matches);
		return {
			meta: [
				{ title: buildTitle("Brand Settings", { appName, brandName }) },
				{ name: "description", content: "Manage your brand name and website." },
			],
		};
	},
	component: BrandSettingsPage,
});

function BrandSettingsPage() {
	const { brand, isLoading, revalidate } = useBrand();
	const queryClient = useQueryClient();
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [error, setError] = useState("");
	const [success, setSuccess] = useState("");
	// The editable fields are derived from the loaded brand, with an override that
	// holds only what the user has changed. Mirroring server values into state via
	// an effect is what broke this form twice: the query refetches on window focus,
	// reconnect and 30s staleness, so the effect either clobbered unsaved edits or,
	// once guarded, stopped applying values that arrived after the guard was set.
	// Deriving has no such ordering: whatever the server last sent shows up unless
	// the user has typed over it. `null` means "not edited", "" is a real value.
	const [domainsOverride, setDomainsOverride] = useState<string[] | null>(null);
	const [aliasesOverride, setAliasesOverride] = useState<string[] | null>(null);
	const [marketOverride, setMarketOverride] = useState<string | null>(null);
	const [languageOverride, setLanguageOverride] = useState<string | null>(null);
	const [descriptionOverride, setDescriptionOverride] = useState<string | null>(null);
	const [categoryOverride, setCategoryOverride] = useState<string | null>(null);
	const [isDeleting, setIsDeleting] = useState(false);
	const navigate = useNavigate();
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const isReadOnly = context.clientConfig?.features.readOnly;

	const additionalDomains = domainsOverride ?? brand?.additionalDomains ?? [];
	const aliases = aliasesOverride ?? brand?.aliases ?? [];
	const targetMarket = marketOverride ?? brand?.targetMarket ?? "";
	const targetLanguage = languageOverride ?? brand?.targetLanguage ?? "";
	const shortDescription = descriptionOverride ?? brand?.shortDescription ?? "";
	const category = categoryOverride ?? brand?.category ?? "";

	/**
	 * La categoría que trae el DNA de Maasy, para **sembrarla** en el campo. Es solo una sugerencia:
	 * no se guarda hasta que el operador la confirme (el clic la pone en el campo y el guardado es el
	 * "Save Changes" del formulario). El que ya tiene Maasy no la escribe dos veces; el que no lo tiene
	 * la declara a mano.
	 */
	const suggestion = useQuery({
		queryKey: ["brand-category-suggestion", brand?.id],
		queryFn: () => getBrandCategorySuggestionFn({ data: { brandId: brand?.id ?? "" } }),
		enabled: Boolean(brand?.id),
		staleTime: 60_000,
	});
	/** El DNA propone una categoría y la marca todavía no declaró ninguna: hay algo que sembrar. */
	const suggestedCategory =
		category.trim().length === 0 && (suggestion.data?.dnaCategory ?? null) !== null
			? (suggestion.data?.dnaCategory as string)
			: null;

	/** Drop the overrides so the freshly saved server values take over again. */
	const clearOverrides = () => {
		setDomainsOverride(null);
		setAliasesOverride(null);
		setMarketOverride(null);
		setLanguageOverride(null);
		setDescriptionOverride(null);
		setCategoryOverride(null);
	};

	const validateDomain = useCallback((val: string): true | string => {
		const cleaned = cleanAndValidateDomain(val);
		if (!cleaned) return `"${val}" is not a valid domain`;
		return true;
	}, []);
	const handleAliasesChange = useCallback((values: string[]) => setAliasesOverride(values), []);
	const handleDomainsChange = useCallback((values: string[]) => setDomainsOverride(values), []);

	const handleTargetMarketChange = (val: string) => {
		setMarketOverride(val);
		if (targetLanguage) {
			const validLangs = DATAFORSEO_LOCATION_LANGUAGES[val] || DATAFORSEO_LANGUAGES;
			if (!validLangs.some((l) => l.name === targetLanguage)) {
				setLanguageOverride("");
			}
		}
	};

	const availableLanguages =
		targetMarket && DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			? DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			: DATAFORSEO_LANGUAGES;

	if (isLoading) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-muted-foreground">Loading...</p>
				</div>
			</div>
		);
	}

	if (!brand) {
		return (
			<div className="space-y-6">
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-destructive">Brand not found</p>
				</div>
			</div>
		);
	}

	const handleSubmit = async (formData: FormData) => {
		setIsSubmitting(true);
		setError("");
		setSuccess("");

		try {
			const name = formData.get("name") as string;
			const website = formData.get("website") as string;

			await updateBrandFn({
				data: {
					brandId: brand.id,
					name,
					website,
					targetMarket: targetMarket || undefined,
					targetLanguage: targetLanguage || undefined,
					shortDescription: shortDescription || undefined,
					// Se manda siempre, incluso vacía: borrar la categoría es una acción y el servidor la
					// distingue de "no la toques" (ver normalizeBrandUpdate).
					category,
					additionalDomains,
					aliases,
				},
			});

			// Domain/alias changes affect citation categorization and mention detection
			queryClient.invalidateQueries({ queryKey: citationKeys.all });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });

			setSuccess("Brand details updated successfully!");
			// Saved values are now the server's; drop the local edits.
			clearOverrides();
			await revalidate();
		} catch (err) {
			setError(err instanceof Error ? err.message : "An error occurred");
		} finally {
			setIsSubmitting(false);
		}
	};

	const handleDelete = async () => {
		if (
			!confirm(
				`Are you sure you want to permanently delete "${brand.name}" and all of its data? This cannot be undone.`,
			)
		) {
			return;
		}

		setIsDeleting(true);
		setError("");

		try {
			await deleteBrandFn({ data: { brandId: brand.id } });
			queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			await navigate({ to: "/app" });
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to delete brand");
			setIsDeleting(false);
		}
	};

	return (
		<div className="space-y-6 max-w-2xl">
			<div className="flex items-center gap-4">
				{brand.website && <WebLogo domain={brand.website} size={48} />}
				<div>
					<h1 className="text-3xl font-bold">Brand</h1>
					<p className="text-muted-foreground">Manage your brand name, website, and details</p>
				</div>
			</div>

			<form action={handleSubmit} className="space-y-6">
				<div className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="name">Brand Name</Label>
						<Input
							id="name"
							name="name"
							type="text"
							placeholder="Brand Name"
							defaultValue={brand.name}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Enter your brand&apos;s name</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="website">Website</Label>
						<Input
							id="website"
							name="website"
							type="text"
							placeholder="example.com"
							defaultValue={brand.website}
							required
							disabled={isSubmitting}
						/>
						<p className="text-xs text-muted-foreground">Your brand&apos;s primary website</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="shortDescription">Short Description</Label>
						<Textarea
							id="shortDescription"
							name="shortDescription"
							placeholder="E.g. A fast-growing AI startup focused on search..."
							value={shortDescription}
							onChange={(e) => setDescriptionOverride(e.target.value)}
							disabled={isSubmitting}
							className="min-h-[100px]"
						/>
						<p className="text-xs text-muted-foreground">Briefly describe what your brand does.</p>
					</div>

					{/*
					 * Campo agregado por BeAOS (no viene del upstream de Getcito): la categoría de la marca,
					 * declarada acá y no dependiente de Maasy. Es la que calibra la biblioteca de preguntas de
					 * compra del APS. Va en inglés el contenedor heredado, en español el campo nuevo —es
					 * vocabulario de BeAOS— para no reescribir la pantalla entera.
					 */}
					<div className="space-y-2">
						<Label className="flex items-center gap-1.5" htmlFor="category">
							Categoría
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									La categoría de la marca (por ejemplo, <strong>Automotriz</strong> o{" "}
									<strong>Plataformas de AOS</strong>). Es con la que se calibran las{" "}
									<strong>preguntas de compra</strong> del APS. Si la declarás acá, manda esta; si no, se usa la del DNA
									de Maasy; y si tampoco hay, un marcador genérico que puede dejar la biblioteca mal calibrada.
								</TooltipContent>
							</Tooltip>
						</Label>
						<Input
							id="category"
							name="category"
							type="text"
							placeholder="E.g. Automotriz"
							value={category}
							onChange={(e) => setCategoryOverride(e.target.value)}
							disabled={isSubmitting}
						/>
						{suggestedCategory !== null ? (
							<p className="text-xs text-muted-foreground">
								El DNA de Maasy trae «{suggestedCategory}».{" "}
								<Button
									type="button"
									variant="link"
									size="sm"
									className="h-auto p-0 text-xs"
									onClick={() => setCategoryOverride(suggestedCategory)}
									disabled={isSubmitting}
								>
									Usar esa
								</Button>{" "}
								— se guarda recién cuando guardás los cambios.
							</p>
						) : (
							<p className="text-xs text-muted-foreground">
								La categoría con la que se calibran las preguntas de compra del APS. Si la dejás vacía, se usa la del
								DNA de Maasy.
							</p>
						)}
					</div>

					<div className="space-y-2">
						<Label htmlFor="targetMarket">Target Market</Label>
						<Select value={targetMarket} onValueChange={handleTargetMarketChange} disabled={isSubmitting}>
							<SelectTrigger id="targetMarket">
								<SelectValue placeholder="Select target market (e.g. United States)" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{TARGET_MARKETS.map((location) => (
										<SelectItem key={location} value={location}>
											{location}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">The location you want the LLM scraper to target.</p>
					</div>

					<div className="space-y-2">
						<Label htmlFor="targetLanguage">Target Language</Label>
						<Select value={targetLanguage} onValueChange={setLanguageOverride} disabled={isSubmitting || !targetMarket}>
							<SelectTrigger id="targetLanguage">
								<SelectValue placeholder={targetMarket ? "Select target language" : "Select a market first"} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{availableLanguages.map((lang) => (
										<SelectItem key={lang.name} value={lang.name}>
											{lang.name}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
						<p className="text-xs text-muted-foreground">The language you want the LLM scraper to use.</p>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Additional Domains
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Other domains your brand owns (e.g. blog.example.com, shop.example.com). Citations from these domains
									will be counted as your brand&apos;s citations. <strong>Updates retroactively</strong> &mdash;
									existing citations will be reclassified immediately.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={additionalDomains}
							onValueChange={handleDomainsChange}
							placeholder="Add domain..."
							searchPlaceholder="Add domain..."
							maxItems={10}
							normalizeValue={(raw) => cleanAndValidateDomain(raw) ?? raw.trim()}
							onValidate={validateDomain}
						/>
					</div>

					<div className="space-y-2">
						<Label className="flex items-center gap-1.5">
							Brand Aliases
							<Tooltip>
								<TooltipTrigger asChild>
									<IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
								</TooltipTrigger>
								<TooltipContent className="max-w-xs text-xs font-normal">
									Alternative names for your brand (sub-brands, product lines, abbreviations). Used for mention
									detection in <strong>future</strong> prompt runs only &mdash; does not apply retroactively to past
									results.
								</TooltipContent>
							</Tooltip>
						</Label>
						<TagsInput
							value={aliases}
							onValueChange={handleAliasesChange}
							placeholder="Add alias..."
							searchPlaceholder="Add alias..."
							maxItems={10}
						/>
					</div>
				</div>

				{error && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{error}</div>}
				{success && <div className="text-sm text-green-600 bg-green-50 p-3 rounded-md">{success}</div>}

				<div className="flex gap-2">
					<Button type="submit" disabled={isSubmitting || isDeleting || isReadOnly} className="cursor-pointer">
						{isSubmitting ? "Saving..." : "Save Changes"}
					</Button>
				</div>
			</form>

			{!isReadOnly && (
				<div className="mt-12 pt-6 border-t border-border">
					<h3 className="text-lg font-medium text-destructive mb-2">Danger Zone</h3>
					<p className="text-sm text-muted-foreground mb-4">
						Permanently delete this brand and all of its associated data, including prompts and run history. This action
						cannot be undone.
					</p>
					<Button variant="destructive" onClick={handleDelete} disabled={isSubmitting || isDeleting}>
						{isDeleting ? "Deleting..." : "Delete Brand"}
					</Button>
				</div>
			)}
		</div>
	);
}
