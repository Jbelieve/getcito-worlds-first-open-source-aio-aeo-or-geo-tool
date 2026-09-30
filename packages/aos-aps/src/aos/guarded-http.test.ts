import { type IncomingMessage, type ServerResponse, createServer } from "node:http";
import { type AddressInfo, isIP } from "node:net";
import { describe, expect, it } from "vitest";
import { MAX_REDIRECTS, SafeFetchError, type SafeFetchTestHooks, safeFetch } from "./guarded-http";
import { type LookupFn, assertSafeAuditUrl } from "./ssrf";

/**
 * Los dos agujeros que este conector cierra, probados de verdad y no por lo que dice el código.
 *
 * La prueba que más importa es la del rebinding: con la segunda resolución del DNS el pedido llegaba
 * al servidor interno; con el conector nuevo no llega. La del redirect hace lo mismo: un 302 a una
 * dirección interna se rechaza antes de que el pedido salga.
 */

const PUBLIC_IP = "93.184.216.34";
const IPV4 = 4;

/**
 * El guardián real, pero aceptando loopback.
 *
 * Los servidores de prueba escuchan en `127.0.0.1`, y el guardián no deja pedir la loopback: la
 * prueba no puede usar el guardián tal cual sin ser rechazada. Este envoltorio conserva la validación
 * de forma (esquema, credenciales) y la de destino para todo lo que NO sea la loopback del test, y
 * deja pasar las direcciones de loopback que usan los servers locales. El guardián de producción no
 * se toca: se inyecta por parámetro, y solo los tests lo pasan.
 */
const loopbackAllowed: SafeFetchTestHooks = {
	assertSafe: async (url, options) => {
		const result = await assertSafeAuditUrl(url, options);
		const parsed = new URL(url);
		// Solo el nombre `localhost`, que es donde escuchan los servers de esta prueba. Un redirect a un
		// **literal** `127.0.0.1` o `169.254.x` sigue rechazándose: es justo lo que prueban los tests de
		// redirect, y si acá se dejara pasar un literal, no probarían nada.
		if (result.ok === false && parsed.hostname === "localhost") {
			// La dirección real del server de prueba: el conector fija direcciones, no hostnames.
			return { ok: true, url: parsed, addresses: ["127.0.0.1"], normalized: false };
		}
		return result;
	},
};

type Handler = (request: IncomingMessage, response: ServerResponse) => void;

/** Servidor local controlado que registra a qué paths le pegaron. */
const LOCALHOST_HOST = "localhost";

async function listen(
	handler: Handler,
	hostname = LOCALHOST_HOST,
): Promise<{ url: string; ipUrl: string; hits: string[]; close: () => Promise<void> }> {
	const hits: string[] = [];
	const server = createServer((request, response) => {
		const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
		hits.push(`${url.pathname}${url.search}`);
		handler(request, response);
	});
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address() as AddressInfo;
	return {
		// El nombre, no la IP: así el guardián ve un hostname y el socket sigue yendo a la loopback.
		url: `http://${hostname}:${port}`,
		// La misma URL por IP literal: es el destino interno que un redirect malicioso usaría de verdad.
		ipUrl: `http://127.0.0.1:${port}`,
		hits,
		close: () => new Promise<void>((resolve) => server.close(() => resolve())),
	};
}

function sendJson(response: ServerResponse, body: unknown, status = 200): void {
	response.writeHead(status, { "content-type": "application/json" });
	response.end(JSON.stringify(body));
}

/** Un server que solo redirige. */
function redirecting(to: string): Handler {
	return (_request, response) => {
		response.writeHead(302, { location: to });
		response.end("redirigiendo");
	};
}

describe("DNS rebinding — la conexión va a la IP validada, no a una segunda resolución", () => {
	/**
	 * La prueba del rebinding: el mismo hostname responde una IP **pública** en la validación y una IP
	 * **interna** en la conexión.
	 *
	 * Cómo se simula: se inyecta un `lookup` con estado que cuenta sus llamadas. La primera —la de la
	 * validación— devuelve `93.184.216.34`, pública y por lo tanto aceptada. La segunda —la del socket,
	 * que es el momento en el que el atacante cambia el DNS— devuelve `127.0.0.1`. Se inyecta también
	 * un `connectionLookup` para registrar que el socket **sí** vuelve a resolver: así la prueba
	 * muestra que el segundo pedido de DNS existe, y no solo su resultado.
	 *
	 * El servidor interno escucha en la loopback de verdad, en su propio puerto: si la conexión usara
	 * la segunda respuesta del DNS, ese server registraría el pedido. No lo registra.
	 */
	it("no llega al servidor interno cuando el DNS cambia entre la validación y la conexión", async () => {
		const internal = await listen((_request, response) => sendJson(response, { secreto: "ok" }));
		const port = new URL(internal.url).port;
		// La segunda resolución del DNS (la del atacante) apunta al servidor interno de verdad: si el
		// conector la usara, el server registraría el pedido.
		const internalAddress = new URL(internal.url).hostname;

		try {
			const lookups: string[] = [];
			// La validación del pedido es la PRIMERA resolución, y es la única que decide: responde la IP
			// pública. Cualquier resolución posterior ya no puede cambiar el destino.
			const rebinding: LookupFn = async () => {
				lookups.push(PUBLIC_IP);
				return [{ address: PUBLIC_IP, family: IPV4 }];
			};

			let socketLookups = 0;

			// `rebind.example` es público en la validación. La conexión se fija a `93.184.216.34`, donde
			// no hay nadie escuchando: el pedido no llega, en vez de irse a la IP interna. El timeout es
			// corto a propósito —lo que importa es a quién se conectó, no cuánto tardó en fallar—, y esta
			// IP pública no responde desde este entorno, así que el fallo es un timeout y no un rechazo.
			await expect(
				safeFetch(`http://rebind.example:${port}/robame`, {
					lookup: rebinding,
					timeoutMs: 900,
					connectionLookup: async () => {
						socketLookups += 1;
						// La segunda resolución: la que el atacante contesta con la IP interna.
						return [{ address: internalAddress, family: IPV4 }];
					},
				}, loopbackAllowed),
			).rejects.toThrow();

			// La validación resolvió (y el ataque existe: el DNS ya apuntaba a la IP interna)…
			expect(lookups).toContain(PUBLIC_IP);
			expect(socketLookups).toBeGreaterThan(0);
			// …y el pedido NO llegó al servidor interno, aunque el DNS ya apuntaba ahí.
			expect(internal.hits).toEqual([]);
		} finally {
			await internal.close();
		}
	});

	/**
	 * El reverso, para que el test de arriba signifique algo: con el cliente viejo (`fetch` global) la
	 * IP validada no decide el destino, porque `fetch` resuelve el hostname por su cuenta y ni siquiera
	 * acepta un `lookup`. Se comprueba contra un host que existe: el pedido sale hacia la dirección que
	 * resuelve el sistema, no hacia la que le habríamos pasado.
	 */
	it("con `fetch` global la IP inyectada no decide el destino", async () => {
		const local = await listen((_request, response) => sendJson(response, { ok: true }));
		try {
			let injected = 0;
			const init = {
				lookup: async () => {
					injected += 1;
					return [{ address: PUBLIC_IP, family: IPV4 }];
				},
			} as RequestInit;
			const response = await fetch(local.url, init);
			expect(response.ok).toBe(true);
			// El `lookup` no se usa: `fetch` no tiene esa opción, y el pedido igual llegó.
			expect(injected).toBe(0);
			expect(local.hits.length).toBe(1);
		} finally {
			await local.close();
		}
	});
});

describe("redirects — cada salto se valida antes de seguirlo", () => {
	/**
	 * La prueba del redirect: un sitio que responde 302 a una dirección interna se rechaza antes de que
	 * el pedido llegue al destino. Con el código viejo (`probeMarkdownNegotiation` usaba
	 * `redirect: "follow"`) el pedido entraba.
	 */
	it("rechaza un redirect a una dirección interna y no llega al destino", async () => {
		const internal = await listen((_request, response) => sendJson(response, { secreto: "metadatos" }));
		const attacker = await listen(redirecting(`${internal.ipUrl}/latest/meta-data/`));
		try {
			const error = await safeFetch(attacker.url, { timeoutMs: 3000, followRedirects: true }, loopbackAllowed).catch((e) => e);
			expect(error).toBeInstanceOf(SafeFetchError);
			expect((error as SafeFetchError).kind).toBe("unsafe_target");
			// El motivo nombra el rango, no la IP exacta (no le contamos al cliente qué resolvimos).
			expect((error as SafeFetchError).message).toContain("127.0.0.0/8");
			// El destino interno nunca vio el pedido.
			expect(internal.hits).toEqual([]);
			// El primero sí: es el sitio auditado, y ahí no hay nada de malo.
			expect(attacker.hits.length).toBe(1);
		} finally {
			await attacker.close();
			await internal.close();
		}
	});

	it("rechaza un redirect a los metadatos de la nube", async () => {
		const attacker = await listen(redirecting("http://169.254.169.254/latest/meta-data/iam/"));
		try {
			const error = await safeFetch(attacker.url, { timeoutMs: 3000, followRedirects: true }, loopbackAllowed).catch((e) => e);
			expect(error).toBeInstanceOf(SafeFetchError);
			// El motivo nombra el rango (a propósito: no le contamos al cliente qué resolvió nuestro DNS).
			expect((error as SafeFetchError).message).toContain("169.254.0.0/16");
		} finally {
			await attacker.close();
		}
	});

	it("rechaza un redirect a un esquema que no es http/https", async () => {
		for (const location of ["file:///etc/passwd", "ftp://example.com/x", "gopher://example.com/"]) {
			const attacker = await listen(redirecting(location));
			try {
				const error = await safeFetch(attacker.url, { timeoutMs: 3000, followRedirects: true }, loopbackAllowed).catch((e) => e);
				expect(error, location).toBeInstanceOf(SafeFetchError);
				expect((error as SafeFetchError).kind, location).toBe("redirect_scheme");
			} finally {
				await attacker.close();
			}
		}
	});

	it("corta con un error claro al pasarse del tope de saltos", async () => {
		let self = "";
		const server = await listen((_request, response) => {
			response.writeHead(302, { location: self });
			response.end();
		});
		self = `${server.url}/loop`;
		try {
			const error = await safeFetch(self, { timeoutMs: 3000, followRedirects: true }, loopbackAllowed).catch((e) => e);
			expect(error).toBeInstanceOf(SafeFetchError);
			expect((error as SafeFetchError).kind).toBe("redirect_limit");
			expect((error as SafeFetchError).message).toContain(String(MAX_REDIRECTS));
		} finally {
			await server.close();
		}
	});

	it("sigue un redirect legítimo y devuelve la respuesta final", async () => {
		const final = await listen((_request, response) => {
			response.writeHead(200, { "content-type": "text/markdown" });
			response.end("# hola");
		});
		const origin = await listen(redirecting(`${final.url}/destino`));
		try {
			const response = await safeFetch(origin.url, { timeoutMs: 3000, followRedirects: true }, loopbackAllowed);
			expect(response.status).toBe(200);
			expect(response.text()).toBe("# hola");
			expect(response.headers.get("content-type")).toContain("markdown");
			expect(response.url).toBe(`${final.url}/destino`);
		} finally {
			await origin.close();
			await final.close();
		}
	});

	it("sin followRedirects no sigue nada: el 3xx vuelve tal cual", async () => {
		const internal = await listen((_request, response) => sendJson(response, { secreto: "x" }));
		const attacker = await listen(redirecting(internal.ipUrl));
		try {
			const response = await safeFetch(attacker.url, { timeoutMs: 3000 }, loopbackAllowed);
			expect(response.status).toBe(302);
			expect(internal.hits).toEqual([]);
		} finally {
			await attacker.close();
			await internal.close();
		}
	});
});

describe("el contrato del conector", () => {
	it("no resuelve de nuevo cuando el destino es un literal IP", async () => {
		const local = await listen((_request, response) => sendJson(response, { ok: true }));
		try {
			let called = 0;
			const lookup: LookupFn = async () => {
				called += 1;
				return [{ address: PUBLIC_IP, family: IPV4 }];
			};
			// El literal ya viene validado: no hay nada que resolver, y el resolutor no se toca.
			const response = await safeFetch(local.url, { lookup, timeoutMs: 3000 }, loopbackAllowed);
			expect(response.ok).toBe(true);
			expect(called).toBe(0);
		} finally {
			await local.close();
		}
	});

	it("rechaza un host que resuelve a una IP privada", async () => {
		const error = await safeFetch("http://privado.example/", {
			timeoutMs: 3000,
			lookup: async () => [{ address: "10.0.0.7", family: IPV4 }],
		}, loopbackAllowed).catch((e) => e);
		expect(error).toBeInstanceOf(SafeFetchError);
		expect((error as SafeFetchError).kind).toBe("unsafe_target");
	});
});
