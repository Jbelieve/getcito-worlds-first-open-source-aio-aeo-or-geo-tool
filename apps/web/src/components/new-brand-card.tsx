/**
 * El alta de una marca, en la página de marcas del Admin.
 *
 * Esto es la puerta que faltaba: `createBrandFn` completa la configuración de una marca que auth ya
 * había otorgado, y el wizard del MCP daba de alta por fuera de la UI. Acá se pide lo mínimo (nombre y
 * web) y el id se deriva del host, así que la misma web dos veces no crea dos marcas: la segunda
 * devuelve la primera y la interfaz lo dice antes de navegar a ella.
 */

import { useNavigate, useRouter } from "@tanstack/react-router";
import { DATAFORSEO_LANGUAGES } from "@workspace/lib/languages";
import { DATAFORSEO_LOCATION_LANGUAGES } from "@workspace/lib/location-languages";
import { TARGET_MARKETS } from "@workspace/lib/locations";
import { Button } from "@workspace/ui/components/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@workspace/ui/components/card";
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
import { useState } from "react";
import { createBrandForCurrentUserFn } from "@/server/brands";

export function NewBrandCard({ onCreated }: { onCreated?: () => void }) {
	const [name, setName] = useState("");
	const [website, setWebsite] = useState("");
	const [targetMarket, setTargetMarket] = useState("");
	const [targetLanguage, setTargetLanguage] = useState("");
	const [isCreating, setIsCreating] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ created: boolean; text: string } | null>(null);
	const navigate = useNavigate();
	const router = useRouter();

	const availableLanguages =
		targetMarket && DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			? DATAFORSEO_LOCATION_LANGUAGES[targetMarket]
			: DATAFORSEO_LANGUAGES;

	const handleTargetMarketChange = (value: string) => {
		setTargetMarket(value);
		if (targetLanguage) {
			const validLanguages = DATAFORSEO_LOCATION_LANGUAGES[value] || DATAFORSEO_LANGUAGES;
			if (!validLanguages.some((language) => language.name === targetLanguage)) setTargetLanguage("");
		}
	};

	const handleCreate = async () => {
		setError(null);
		setNotice(null);

		if (!name.trim()) {
			setError("Poné un nombre para la marca.");
			return;
		}
		if (!website.trim()) {
			setError("Poné la web de la marca: de ahí sale el id.");
			return;
		}

		setIsCreating(true);
		try {
			const result = await createBrandForCurrentUserFn({
				data: {
					name: name.trim(),
					website: website.trim(),
					...(targetMarket ? { targetMarket } : {}),
					...(targetLanguage ? { targetLanguage } : {}),
				},
			});

			// El texto del reuso lo arma el servidor porque sabe por qué reusó (la web o el id), que es lo
			// que no se puede reconstruir desde acá.
			setNotice({
				created: result.created,
				text: result.message ?? `Marca «${result.name}» creada. Te llevo a esa.`,
			});

			onCreated?.();
			await router.invalidate();
			await navigate({ to: "/app/$brand", params: { brand: result.brandId } });
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo crear la marca.");
		} finally {
			setIsCreating(false);
		}
	};

	return (
		<Card className="border-border">
			<CardHeader>
				<CardTitle className="text-believe-900">Nueva marca</CardTitle>
				<CardDescription>
					El id de la marca sale de la web (por ejemplo, <span className="font-mono">acme.com</span> →{" "}
					<span className="font-mono">acme-com</span>). Si esa web ya está dada de alta, te llevamos a la que existe en
					vez de duplicarla.
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="grid gap-4 sm:grid-cols-2">
					<div className="space-y-2">
						<Label htmlFor="new-brand-name">Nombre</Label>
						<Input
							id="new-brand-name"
							value={name}
							onChange={(event) => setName(event.target.value)}
							placeholder="Acme"
							disabled={isCreating}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="new-brand-website">Web</Label>
						<Input
							id="new-brand-website"
							value={website}
							onChange={(event) => setWebsite(event.target.value)}
							placeholder="acme.com"
							disabled={isCreating}
						/>
					</div>

					<div className="space-y-2">
						<Label htmlFor="new-brand-market">Mercado (opcional)</Label>
						<Select value={targetMarket} onValueChange={handleTargetMarketChange} disabled={isCreating}>
							<SelectTrigger id="new-brand-market">
								<SelectValue placeholder="Elegí un mercado" />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{TARGET_MARKETS.map((market) => (
										<SelectItem key={market} value={market}>
											{market}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>

					<div className="space-y-2">
						<Label htmlFor="new-brand-language">Idioma destino (opcional)</Label>
						<Select value={targetLanguage} onValueChange={setTargetLanguage} disabled={isCreating || !targetMarket}>
							<SelectTrigger id="new-brand-language">
								<SelectValue placeholder={targetMarket ? "Elegí un idioma" : "Elegí un mercado primero"} />
							</SelectTrigger>
							<SelectContent>
								<SelectGroup>
									{availableLanguages.map((language) => (
										<SelectItem key={language.name} value={language.name}>
											{language.name}
										</SelectItem>
									))}
								</SelectGroup>
							</SelectContent>
						</Select>
					</div>
				</div>

				{error && <p className="mt-4 text-sm text-destructive">{error}</p>}
				{notice && (
					<p className={`mt-4 text-sm ${notice.created ? "text-believe-900" : "text-muted-foreground"}`}>
						{notice.text}
					</p>
				)}

				<div className="mt-4 flex items-center gap-3">
					<Button onClick={handleCreate} disabled={isCreating} className="cursor-pointer">
						{isCreating ? "Creando..." : "Crear marca"}
					</Button>
					<span className="text-xs text-muted-foreground">
						La marca queda a nombre de tu organización y la vas a ver en la lista de abajo.
					</span>
				</div>
			</CardContent>
		</Card>
	);
}
