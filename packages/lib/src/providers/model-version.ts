/**
 * Qué versión de modelo **reportó** el proveedor, y cuándo no lo sabemos.
 *
 * El bug que esto cierra: un dato que **parece** el dato. La capa de visibilidad
 * escribía `modelVersion ?? config.version ?? config.provider` en una sola columna, y
 * DataForSEO caía directamente al nombre pedido (`result.model_name ?? modelName`).
 * O sea: cuando el scraper no informaba qué modelo había contestado, el sistema
 * **afirmaba** el que habíamos pedido, como si lo hubiera comprobado. Si un dataset
 * cambia de motor por detrás, nuestra serie histórica lo muestra como estable.
 *
 * La regla, y no hay más: **el dato que no está, no está.** "El proveedor no lo
 * informó" es `null`, nunca el nombre pedido. El modelo pedido y el modelo que
 * contestó son dos hechos distintos y viven en columnas distintas.
 *
 * El matiz honesto, sin adornos: los scrapers muchas veces no lo informan. BrightData
 * devuelve `record?.model ?? undefined`, Cloro deja `undefined` si no viene, y hay
 * rutas de DataForSEO donde el campo simplemente no existe. `null` es la respuesta
 * correcta en todos esos casos, no una derrota.
 */

/** Cómo se nombra, en la pantalla, el modelo que no sabemos. Se publica, no se esconde. */
export const MODEL_VERSION_UNKNOWN = "unknown";

/**
 * Normaliza lo que el proveedor informó en el **cuerpo de la respuesta**.
 *
 * `reported` tiene que venir del proveedor. Si lo informa —aunque coincida con lo
 * pedido, que es legítimo: le pedimos `gpt-4o` y contestó `gpt-4o`— se devuelve. Si no
 * vino, `null`. Y `null` es un dato: significa "el proveedor no lo informó".
 *
 * El alias pedido **no** entra acá a propósito. La regla es que el fallback al nombre
 * pedido no ocurra en el extractor; si ocurriera, este módulo no tendría cómo
 * distinguir "contestó lo que pedimos" de "no sabemos y repetimos lo que pedimos", y
 * elegir la segunda lectura sería inventar. Por eso el fallback se saca en el origen
 * (`dataforseo.ts`, `openrouter.ts`) y no se adivina acá.
 */
export function reportedModelVersion(reported: string | null | undefined): string | null {
	if (typeof reported !== "string") return null;
	const trimmed = reported.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * El modelo que contestó, tal como se persiste: la versión reportada o `null`.
 *
 * Devuelve `null` cuando el proveedor no lo informó. Quien presenta el dato tiene que
 * decir "el proveedor no lo informó" en vez de mostrar el nombre pedido: por eso el
 * valor crudo es `null` y no el string `"unknown"` — un centinela guardado se confunde
 * con un modelo llamado así, y después nadie puede distinguirlos.
 */
export function resolveReportedModelVersion(reported: string | null | undefined): string | null {
	return reportedModelVersion(reported);
}

/**
 * Cómo se muestra el modelo que contestó cuando no lo sabemos.
 *
 * Es la contracara de `resolveReportedModelVersion`: ahí el dato se guarda `null`
 * (declarado, no inventado) y acá se traduce a texto para la pantalla.
 */
export function describeReportedModelVersion(value: string | null): string {
	return value ?? MODEL_VERSION_UNKNOWN;
}
