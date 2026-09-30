import { useRouteContext } from "@tanstack/react-router";
import { DEFAULT_APP_ICON, DEFAULT_APP_NAME } from "@workspace/config/constants";
import type { ClientConfig } from "@workspace/config/types";
import { cn } from "@workspace/ui/lib/utils";
import type { ComponentPropsWithoutRef } from "react";

interface LogoProps extends ComponentPropsWithoutRef<"div"> {
	iconClassName?: string;
	textClassName?: string;
}

/**
 * Whether this deployment renders the BeAOS lockup. Es la única cosa que usa Fraunces: el resto de
 * la app va en Inter y en JetBrains Mono. Un despliegue whitelabel muestra su propio ícono y su
 * propio nombre en la tipografía del sistema, así que ahí el wordmark no aparece.
 */
export function usesWordmarkFont(branding: { icon?: string; name?: string } | undefined): boolean {
	const hasCustomBranding =
		Boolean(branding?.icon && branding?.name) &&
		(branding?.icon !== DEFAULT_APP_ICON || branding?.name !== DEFAULT_APP_NAME);
	return !hasCustomBranding;
}

/**
 * El wordmark de Believe, canónico: `Believe` con la última «e» girada -18° y el punto cian.
 *
 * Es una sola cosa y no se mezcla con nada: Fraunces 500, opsz 144 y tracking -0.025em, todo en
 * `.wordmark` (`styles.css`). Acá no se elige ni el tamaño ni el color — el tamaño lo pone quien lo
 * usa (**nunca por debajo de 32px**, que es el mínimo de la marca) y el color lo hereda, para que
 * sirva igual en azul Believe que en blanco sobre azul.
 */
export function Wordmark() {
	return (
		<span className="wordmark">
			Believ
			<span className="wordmark-e">e</span>
			<span className="wordmark-dot" />
		</span>
	);
}

/**
 * El lockup de BeAOS: `BeAOS` arriba y `by Believe.` en una línea aparte, más chica.
 *
 * La regla que lo sostiene: el wordmark no baja de 32px, así que si la línea chica va "más chica" es
 * la grande la que crece (44px) — no la marca la que se achica. `by` va en Inter y en el mute,
 * porque es el conector y no la marca; lo demás es Fraunces.
 */
export function BrandLockup({ className, textClassName, ...props }: Omit<LogoProps, "iconClassName">) {
	return (
		<div {...props} className={cn("lockup text-primary", textClassName, className)}>
			<span className="lockup-name">BeAOS</span>
			<span className="lockup-by">
				<span className="lockup-conector">by</span> <Wordmark />
			</span>
		</div>
	);
}

export function Logo({ className, iconClassName, textClassName, ...props }: LogoProps) {
	const context = useRouteContext({ strict: false }) as { clientConfig?: ClientConfig };
	const branding = context.clientConfig?.branding;

	if (usesWordmarkFont(branding)) {
		return (
			<BrandLockup {...props} className={cn("flex items-center gap-2", className)} textClassName={textClassName} />
		);
	}

	return (
		<div {...props} className={cn("flex items-center gap-2", className)}>
			{branding?.icon && (
				<img
					src={branding.icon}
					alt={`${branding.name} logo`}
					className={cn("size-5", iconClassName)}
					fetchPriority="low"
				/>
			)}
			<span className={cn("text-base font-semibold", textClassName)}>{branding?.name}</span>
		</div>
	);
}
