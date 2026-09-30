/**
 * El conector HTTP del guardián anti-SSRF: pide URLs que manda un desconocido sin perder de vista a
 * quién le está hablando.
 *
 * Existe por dos agujeros que el guardián de `./ssrf` no podía cerrar solo, porque los dos pasan
 * *después* de la validación:
 *
 *   1. **DNS rebinding (TOCTOU).** `fetch` resuelve el hostname otra vez al conectar. Un atacante con
 *      DNS propio responde una IP pública cuando validamos y `169.254.169.254` un segundo después.
 *      Acá el socket usa un `lookup` que **devuelve la IP que ya se validó**, así que la conexión no
 *      puede ir a otra dirección. El `Host` y el `servername` (SNI) siguen siendo el hostname: el
 *      certificado TLS valida contra el **nombre**, no contra la IP.
 *   2. **Redirects.** El `fetch` global sigue redirects por defecto, así que un 302 a
 *      `http://169.254.169.254/` llegaba a destino sin que el guardián viera nunca esa URL. Acá no se
 *      sigue ningún salto sin volver a validarlo, hay tope de saltos y se rechaza todo esquema que no
 *      sea http/https.
 *
 * Por qué `node:https` y no `undici`. En este repo `undici` **no es una dependencia declarada**:
 * aparece en el lockfile solo como transitiva de dos consumidores distintos (`undici@6.27.0` marcada
 * `optional` y `undici@7.28.0`), y `require.resolve("undici")` falla desde `packages/aos-aps`. O sea
 * que la opción (a) —declararlo explícito— agregaría una dependencia versionada al camino del guardián
 * y, hasta declararla, la resolvería el hoisting de pnpm, que no es base para código de seguridad. La
 * opción (b) —el cliente que ya trae el runtime— no agrega dependencias y da control total del
 * redirect, que es exactamente el segundo agujero, en vez de depender de la política del cliente. El
 * motor no se reescribe: cambia la función que pide, no qué se pide ni cómo se puntúa.
 */
import { type IncomingMessage, type LookupFunction, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import { type LookupFn, assertSafeAuditUrl } from "./ssrf";

/** Tope de saltos. Cinco es lo que hace cualquier cliente serio; más que eso es un loop. */
export const MAX_REDIRECTS = 5;

/** Techo del cuerpo que aceptamos leer: un sitio hostil puede mandar gigabytes y no vamos a eso. */
export const MAX_BODY_BYTES = 5 * 1024 * 1024;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export type SafeFetchErrorKind = "unsafe_target" | "unresolved" | "redirect_scheme" | "redirect_limit";

/** El pedido no se hizo: el destino no pasó el guardián, o el redirect no se puede seguir. */
export class SafeFetchError extends Error {
	readonly kind: SafeFetchErrorKind;

	constructor(kind: SafeFetchErrorKind, message: string) {
		super(message);
		this.name = "SafeFetchError";
		this.kind = kind;
	}
}

/**
 * Respuesta ya leída entera.
 *
 * No es un `Response`: `Response` es la API de `fetch` y acá el valor viene del cliente de
 * `node:https`. La forma es la que necesitan los probes del audit (`ok`, `status`, `headers.get`,
 * `text`), y el cuerpo se lee de una sola manera para que no haya sorpresas de streaming.
 */
export interface GuardedResponse {
	/** URL final, después de los saltos seguidos. */
	url: string;
	status: number;
	ok: boolean;
	headers: { get(name: string): string | null };
	text(): string;
}

export interface SafeFetchOptions {
	method?: string;
	headers?: Record<string, string>;
	body?: string;
	timeoutMs?: number;
	/** Resolutor inyectable: el mismo que usa la validación. */
	lookup?: LookupFn;
	/**
	 * Seguir redirects validando cada salto. Por defecto **no**: el audit prueba paths concretos y un
	 * 3xx significa "ese archivo no está", no "andá a otro lado".
	 */
	followRedirects?: boolean;
	/**
	 * Lookup que se fija en el socket. Por defecto devuelve las direcciones ya validadas; los tests lo
	 * inyectan para simular un DNS que responde distinto en la validación y en la conexión.
	 */
	connectionLookup?: LookupFn;
}

/**
 * `lookup` de socket que solo puede devolver direcciones ya validadas.
 *
 * Esta es la pieza que cierra el rebinding: Node llama a este `lookup` en el momento de conectar, y
 * la respuesta está fijada de antemano, así que la segunda resolución del atacante nunca se usa. Si
 * además pide una familia que no validamos (por ejemplo IPv6 cuando solo hay A), falla con
 * `EAI_ADDRFAMILY`: cortar antes que conectar a algo que no pasó el guardián.
 */
export function createPinnedLookup(pinned: string[], connectionLookup?: LookupFn): LookupFunction {
	if (pinned.length === 0) throw new Error("createPinnedLookup necesita al menos una dirección validada");

	return (hostname, options, callback) => {
		const wants = (options ?? {}) as { family?: number };
		const family = wants.family ?? 0;
		const reply = (): void => {
			const matching = family === 0 ? pinned : pinned.filter((address) => isIP(address) === family);
			// Si pide una familia que no validamos, cortamos acá: mejor no conectar que conectar a una
			// dirección que el guardián nunca vio.
			if (matching.length === 0) {
				callback(
					Object.assign(new Error(`no hay dirección validada para "${hostname}"`), { code: "EAI_ADDRFAMILY" }),
					"",
					0,
				);
				return;
			}
			const first = matching[0] ?? "";
			callback(null, first, isIP(first) as 4 | 6);
		};

		// `connectionLookup` es el camino de test: deja contar que el socket **sí** vuelve a resolver, y
		// simular que esa segunda respuesta es la IP interna. Lo que se conecta son las direcciones
		// validadas, responda lo que responda el resolutor.
		if (connectionLookup === undefined) {
			reply();
			return;
		}
		void Promise.resolve(connectionLookup(hostname)).then(reply, reply);
	};
}

/** Un solo pedido, sin seguir redirects: el guardián decide qué hacer con un 3xx. */
function requestOnce(url: URL, addresses: string[], options: SafeFetchOptions): Promise<GuardedResponse> {
	const timeoutMs = options.timeoutMs ?? 8000;
	const isHttps = url.protocol === "https:";
	const send = isHttps ? httpsRequest : httpRequest;
	const hostname = url.hostname.startsWith("[") ? url.hostname.slice(1, -1) : url.hostname;
	const lookup = createPinnedLookup(addresses, options.connectionLookup);
	const body = options.body;

	return new Promise<GuardedResponse>((resolve, reject) => {
		let settled = false;
		const fail = (error: unknown): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			reject(error instanceof Error ? error : new Error(String(error)));
		};

		const timer = setTimeout(() => {
			request.destroy(Object.assign(new Error(`timeout de ${timeoutMs}ms`), { code: "ETIMEDOUT" }));
			fail(new Error(`timeout de ${timeoutMs}ms pidiendo ${url.toString()}`));
		}, timeoutMs);
		if (typeof timer.unref === "function") timer.unref();

		const request = send(
			{
				// `hostname` es el nombre, no la IP: el `Host` y el SNI salen de acá, y el `lookup` fijado
				// es lo único que decide a qué dirección se conecta.
				hostname,
				port: url.port.length > 0 ? Number(url.port) : isHttps ? 443 : 80,
				path: `${url.pathname}${url.search}`,
				method: options.method ?? "GET",
				// Mismo valor que el hostname, explícito: si esto se rompe, el certificado se valida
				// contra la IP y muchos sitios (no todos) fallan.
				servername: isHttps ? hostname : undefined,
				headers: { host: url.host, ...options.headers },
				lookup,
				...(body !== undefined && body.length > 0 ? { "content-length": Buffer.byteLength(body) } : {}),
			},
			(response: IncomingMessage) => {
				const chunks: Buffer[] = [];
				let size = 0;
				response.on("data", (chunk: Buffer) => {
					if (size >= MAX_BODY_BYTES) return;
					size += chunk.length;
					chunks.push(chunk);
				});
				response.on("end", () => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					const text = Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString("utf8");
					resolve({
						url: url.toString(),
						status: response.statusCode ?? 0,
						ok: (response.statusCode ?? 0) >= 200 && (response.statusCode ?? 0) < 300,
						headers: {
							get: (name: string) => {
								const value = response.headers[name.toLowerCase()];
								if (value === undefined) return null;
								return Array.isArray(value) ? value.join(", ") : value;
							},
						},
						text: () => text,
					});
				});
				response.on("error", fail);
			},
		);

		request.on("error", fail);
		request.end(body);
	});
}

/**
 * `fetch` del guardián: valida, fija la IP validada en el socket y, si se le pide, sigue redirects
 * validando cada salto.
 *
 * Lanza `SafeFetchError` cuando el destino no pasa el guardián (destino interno, DNS que no resuelve,
 * esquema no http/https en un `Location`, o más de `MAX_REDIRECTS` saltos). Los errores de red —sitio
 * caído, TLS roto, timeout— suben como están: el audit los trata igual que antes, "no respondió".
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<GuardedResponse> {
	const maxRedirects = options.followRedirects === true ? MAX_REDIRECTS : 0;
	let current = rawUrl;

	for (let hop = 0; hop <= maxRedirects; hop += 1) {
		let target: URL;
		try {
			target = new URL(current);
		} catch {
			throw new SafeFetchError("unsafe_target", "la URL no se puede parsear");
		}

		// En el primer salto el esquema ya lo validó quien llama; en los siguientes, un `Location` puede
		// traer cualquier cosa (`file:`, `ftp:`) y eso se rechaza antes de tocar la red.
		if (target.protocol !== "http:" && target.protocol !== "https:") {
			throw new SafeFetchError("redirect_scheme", `solo http y https, no "${target.protocol}"`);
		}

		// Cada salto vuelve a pasar por el guardián completo: texto, hostname y DNS. Es lo que hace que
		// un redirect a una dirección interna se rechace aunque el primer destino fuera público.
		const safe = await assertSafeAuditUrl(target.toString(), { lookup: options.lookup });
		if (safe.ok === false) {
			throw new SafeFetchError(safe.kind === "unresolved" ? "unresolved" : "unsafe_target", safe.reason);
		}

		const response = await requestOnce(safe.url, safe.addresses, options);

		if (options.followRedirects !== true || REDIRECT_STATUSES.has(response.status) === false) return response;

		const location = response.headers.get("location");
		if (location === null || location.length === 0) return response;

		if (hop === maxRedirects) {
			throw new SafeFetchError("redirect_limit", `más de ${MAX_REDIRECTS} redirects seguidos`);
		}
		// Relativo se resuelve contra la URL actual; después vuelve a pasar por el guardián entero.
		current = new URL(location, safe.url).toString();
	}

	throw new SafeFetchError("redirect_limit", `más de ${MAX_REDIRECTS} redirects seguidos`);
}
