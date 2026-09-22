import { createElement } from "react";
import {
	DEFAULT_APP_NAME,
	Getcito_BRAND_COLOR,
} from "@workspace/config/constants";

export const ACCENT_COLORS = ["#0c3bb9", "#00aaff", "#16a34a", "#f59e0b"];
export const DEFAULT_TAGLINE = "AI Search Optimization";
export const DEFAULT_DESCRIPTION =
	"Track and optimize your brand's visibility across AI models.";

export interface OgImageOptions {
	appName: string;
	title?: string;
	description?: string;
	accentColors?: string[];
	iconDataUri?: string;
}

export function renderOgImage({
	appName,
	title,
	description,
	accentColors,
	iconDataUri,
}: OgImageOptions) {
	const isGetcito = appName === DEFAULT_APP_NAME;
	const brandColor = isGetcito
		? Getcito_BRAND_COLOR
		: (accentColors?.[0] ?? "#1e293b");
	const desc = description || DEFAULT_DESCRIPTION;
	const watermarkColor = isGetcito
		? "rgba(37,99,235,0.04)"
		: "rgba(0,0,0,0.03)";
	const gradientColors = isGetcito
		? ACCENT_COLORS
		: accentColors && accentColors.length >= 2
			? accentColors.slice(0, 4)
			: [brandColor, brandColor];

	return createElement(
		"div",
		{
			style: {
				display: "flex",
				width: "100%",
				height: "100%",
				position: "relative",
				overflow: "hidden",
				backgroundColor: "#ffffff",
			},
		},
		isGetcito
			? createElement(
					"div",
					{
						style: {
							position: "absolute",
							fontFamily: "Fraunces",
							fontSize: 700,
							color: watermarkColor,
							lineHeight: 1,
							right: -60,
							top: -60,
						},
					},
					"B",
				)
			: null,
		createElement(
			"div",
			{
				style: {
					display: "flex",
					flexDirection: "column",
					justifyContent: "center",
					height: "100%",
					paddingLeft: 80,
					paddingRight: 80,
				},
			},
			isGetcito
				? createElement(
						"div",
						{
							style: {
								fontFamily: "Fraunces",
								fontSize: 140,
								color: Getcito_BRAND_COLOR,
								lineHeight: 1,
								marginBottom: 40,
							},
						},
						"BeAOS", createElement("span", { style: { color: "#00aaff" } }, "."),
					)
				: iconDataUri
					? createElement("img", {
							src: iconDataUri,
							width: 120,
							height: 120,
							style: { marginBottom: 28, objectFit: "contain" },
						})
					: null,
			createElement(
				"div",
				{
					style: {
						fontFamily: "Geist Sans",
						fontSize: 80,
						fontWeight: 500,
						color: "#1e293b",
						lineHeight: 1.2,
						marginBottom: 28,
					},
				},
				isGetcito ? (title || DEFAULT_TAGLINE) : appName,
			),
			createElement(
				"div",
				{
					style: {
						fontFamily: "Geist Sans",
						fontSize: 44,
						color: "#64748b",
						textWrap: "balance",
					},
				},
				desc,
			),
		),
		createElement("div", {
			style: {
				display: "flex",
				position: "absolute",
				bottom: 0,
				left: 0,
				width: "100%",
				height: 6,
				backgroundImage: `linear-gradient(to right, ${gradientColors.join(", ")})`,
			},
		}),
	);
}
