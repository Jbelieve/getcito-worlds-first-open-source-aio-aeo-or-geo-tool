import { describe, expect, it } from "vitest";
import { assertSafeAuditUrl, blockedIpReason, ipv6ToBytes, isBlockedIp, validateAuditUrl } from "./ssrf";

/**
 * El guardián anti-SSRF es la parte crítica del audit público: si falla, cualquiera usa el servidor
 * como proxy contra la red interna. Estos tests son la red de seguridad del guardián, y por eso
 * cubren las formas raras de escribir la misma dirección, no solo el caso feliz.
 */

describe("blockedIpReason — IPv4", () => {
	const blocked = [
		"127.0.0.1",
		"127.1.2.3",
		"10.0.0.1",
		"10.255.255.255",
		"172.16.0.1",
		"172.31.255.254",
		"192.168.1.1",
		"169.254.169.254", // metadatos de nube (AWS/GCP/Azure)
		"169.254.1.1",
		"100.64.0.1", // CGNAT
		"0.0.0.0",
		"192.0.2.10", // TEST-NET-1
		"198.18.0.5", // benchmarking
		"203.0.113.7", // TEST-NET-3
		"224.0.0.1", // multicast
		"255.255.255.255",
	];

	for (const ip of blocked) {
		it(`bloquea ${ip}`, () => {
			expect(isBlockedIp(ip)).toBe(true);
			expect(blockedIpReason(ip)).toBeTruthy();
		});
	}

	const allowed = ["8.8.8.8", "1.1.1.1", "93.184.216.34", "172.32.0.1", "172.15.255.255", "11.0.0.1"];
	for (const ip of allowed) {
		it(`deja pasar ${ip}`, () => {
			expect(blockedIpReason(ip)).toBeNull();
		});
	}
});

describe("blockedIpReason — IPv6 y formas equivalentes", () => {
	const blocked = [
		"::1",
		"::",
		"fe80::1",
		"fd00::1",
		"fc00::abcd",
		"ff02::1",
		"2001:db8::1",
		"2002:7f00:1::1", // 6to4 con IPv4 privada embebida
		"::ffff:127.0.0.1", // IPv4 mapeada al loopback
		"::ffff:7f00:1", // la misma, en hexadecimal
		"::ffff:169.254.169.254", // metadatos por la puerta de IPv6
		"64:ff9b::7f00:1", // NAT64 al loopback
	];

	for (const ip of blocked) {
		it(`bloquea ${ip}`, () => {
			expect(isBlockedIp(ip)).toBe(true);
		});
	}

	it("deja pasar una IPv6 pública", () => {
		expect(blockedIpReason("2606:4700:4700::1111")).toBeNull();
		expect(blockedIpReason("2001:4860:4860::8888")).toBeNull();
	});

	it("rechaza texto que no es una IP", () => {
		expect(blockedIpReason("no-soy-una-ip")).toContain("no es una IP");
		expect(blockedIpReason("999.1.1.1")).toBeTruthy();
	});

	it("ipv6ToBytes expande `::` y la IPv4 embebida", () => {
		expect(Array.from(ipv6ToBytes("::1") ?? [])).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]);
		expect(Array.from(ipv6ToBytes("::ffff:127.0.0.1") ?? [])).toEqual([
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0xff, 0xff, 127, 0, 0, 1,
		]);
		expect(ipv6ToBytes("1:2:3:4:5:6:7:8:9")).toBeNull();
		expect(ipv6ToBytes("1::2::3")).toBeNull();
		expect(ipv6ToBytes("gggg::1")).toBeNull();
	});
});

describe("validateAuditUrl — texto, sin DNS", () => {
	it("acepta http y https", () => {
		expect(validateAuditUrl("https://example.com/path").ok).toBe(true);
		expect(validateAuditUrl("http://example.com").ok).toBe(true);
	});

	it("rechaza otros esquemas", () => {
		for (const raw of ["ftp://example.com", "file:///etc/passwd", "gopher://example.com", "javascript:alert(1)"]) {
			const result = validateAuditUrl(raw);
			expect(result.ok, raw).toBe(false);
			expect(result.ok === false && result.kind, raw).toBe("invalid");
		}
	});

	it("rechaza credenciales embebidas", () => {
		expect(validateAuditUrl("https://user:pass@example.com").ok).toBe(false);
		expect(validateAuditUrl("https://user@example.com").ok).toBe(false);
	});

	it("rechaza localhost y sus variantes", () => {
		for (const raw of [
			"http://localhost/",
			"http://LOCALHOST/",
			"http://foo.localhost/",
			"http://127.0.0.1/",
			"http://[::1]/",
		]) {
			expect(validateAuditUrl(raw).ok, raw).toBe(false);
		}
	});

	it("rechaza nombres internos y de metadatos", () => {
		for (const raw of [
			"http://algo.local/",
			"http://servicio.internal/",
			"http://metadata.google.internal/",
			"http://169.254.169.254/latest/meta-data/",
			"http://[::ffff:169.254.169.254]/",
		]) {
			const result = validateAuditUrl(raw);
			expect(result.ok, raw).toBe(false);
			// `blocked` y no `invalid`: quien llama puede decidir no contar el motivo exacto al cliente.
			expect(result.ok === false && result.kind, raw).toBe("blocked");
		}
	});

	it("rechaza la misma IP privada escrita de otra forma", () => {
		// `URL` normaliza estas formas a 127.0.0.1; el guardián no puede depender de cómo se escribió.
		for (const raw of [
			"http://2130706433/",
			"http://0x7f000001/",
			"http://0177.0.0.1/",
			"http://127.1/",
			"http://[::ffff:7f00:1]/",
		]) {
			expect(validateAuditUrl(raw).ok, raw).toBe(false);
		}
	});

	it("rechaza un host vacío o una URL ilegible", () => {
		// `no-es-una-url` sí se lee como un dominio pelado; lo que no se puede interpretar es esto otro.
		expect(validateAuditUrl("no es una url").ok).toBe(false);
		expect(validateAuditUrl("https://").ok).toBe(false);
		// `https:///x` no es un host vacío: el parser de URL lo normaliza a `https://x/`.
		expect(validateAuditUrl("https:///127.0.0.1").ok).toBe(false);
	});

	it("acepta una IP pública como literal", () => {
		expect(validateAuditUrl("http://93.184.216.34/").ok).toBe(true);
	});

	/**
	 * Tolerancia con la FORMA, cero tolerancia con el DESTINO.
	 *
	 * La extensión 2.1.0 que está en review manda el dominio pelado, sin esquema y sin path. Eso es lo
	 * que hay que poder interpretar; que sea pelado no dice nada del destino, así que `localhost`
	 * pelado se sigue rechazando igual que `http://localhost`.
	 */
	describe("dominio pelado (sin esquema)", () => {
		it("lo interpreta como https, conservando el path y el puerto", () => {
			const conPath = validateAuditUrl("bescore.believe-global.com/precios?plan=pro#top");
			expect(conPath.ok).toBe(true);
			expect(conPath.ok === true && conPath.url.toString()).toBe(
				"https://bescore.believe-global.com/precios?plan=pro#top",
			);
			expect(conPath.ok === true && conPath.normalized).toBe(true);

			const conPuerto = validateAuditUrl("ejemplo.com:8443/x");
			expect(conPuerto.ok === true && conPuerto.url.toString()).toBe("https://ejemplo.com:8443/x");
		});

		it("el path importa: no se audita la home en lugar de la página que se está viendo", () => {
			const result = validateAuditUrl("https://ejemplo.com/precios");
			expect(result.ok === true && result.url.pathname).toBe("/precios");
			// Una URL con esquema no se toca: `normalized` es false y el texto queda idéntico.
			expect(result.ok === true && result.normalized).toBe(false);
		});

		it("sigue rechazando lo que no es ni URL ni dominio", () => {
			// Ojo: el `:` hace que estos se lean como un esquema propio, así que caen por protocolo.
			for (const raw of ["javascript:alert(1)", "mailto:algo@ejemplo.com", "file:/etc/passwd"]) {
				const result = validateAuditUrl(raw);
				expect(result.ok, raw).toBe(false);
				expect(result.ok === false && result.kind, raw).toBe("invalid");
			}
			// Y esto no es una dirección de ninguna forma.
			const ilegible = validateAuditUrl("no es una url");
			expect(ilegible.ok).toBe(false);
			expect(ilegible.ok === false && ilegible.kind).toBe("invalid");
			expect(ilegible.ok === false && ilegible.reason).toContain("interpretar");
		});

		it("no relaja el destino: localhost, la loopback y los rangos privados pelados se rechazan igual", () => {
			for (const raw of [
				"localhost",
				"localhost:3000",
				"127.0.0.1",
				"127.1",
				"10.0.0.7",
				"192.168.1.1",
				"169.254.169.254",
			]) {
				const result = validateAuditUrl(raw);
				expect(result.ok, raw).toBe(false);
				expect(result.ok === false && result.kind, raw).toBe("blocked");
			}
		});
	});
});

describe("assertSafeAuditUrl — dominio pelado", () => {
	const lookupPublico = async () => [{ address: "93.184.216.34", family: 4 }];

	it("audita un dominio pelado: se normaliza a https y se resuelve como cualquier otra URL", async () => {
		const result = await assertSafeAuditUrl("bescore.believe-global.com", { lookup: lookupPublico });
		expect(result.ok).toBe(true);
		expect(result.ok === true && result.url.toString()).toBe("https://bescore.believe-global.com/");
		// Se resolvió de verdad: la dirección validada es la que se fija en el socket.
		expect(result.ok === true && result.addresses).toEqual(["93.184.216.34"]);
		expect(result.ok === true && result.normalized).toBe(true);
	});

	it("le pasa el hostname pelado al DNS, sin el esquema ni el path", async () => {
		let pedido: string | null = null;
		await assertSafeAuditUrl("ejemplo.com/precios", {
			lookup: async (hostname) => {
				pedido = hostname;
				return [{ address: "93.184.216.34", family: 4 }];
			},
		});
		expect(pedido).toBe("ejemplo.com");
	});

	it("`localhost` pelado sigue rechazado, y se rechaza sin salir a la red", async () => {
		let llamado = false;
		const result = await assertSafeAuditUrl("localhost", {
			lookup: async () => {
				llamado = true;
				return [{ address: "93.184.216.34", family: 4 }];
			},
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe("blocked");
		expect(llamado).toBe(false);
	});

	it("un dominio pelado que resuelve a una IP privada también se bloquea", async () => {
		const result = await assertSafeAuditUrl("sitio-que-miente.example", {
			lookup: async () => [{ address: "10.0.0.7", family: 4 }],
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe("blocked");
	});

	it("un dominio pelado que no resuelve se rechaza", async () => {
		const result = await assertSafeAuditUrl("no-existe.example", {
			lookup: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe("unresolved");
	});
});

describe("assertSafeAuditUrl — resolución DNS", () => {
	const lookupTo = (address: string) => async () => [{ address, family: address.includes(":") ? 6 : 4 }];

	it("rechaza un host público que resuelve a una IP privada", async () => {
		const result = await assertSafeAuditUrl("https://sitio-que-miente.example/", {
			lookup: lookupTo("10.0.0.7"),
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe("blocked");
		expect(result.ok === false && result.reason).toContain("10.0.0.7");
	});

	it("rechaza un host público que resuelve a los metadatos de la nube", async () => {
		const result = await assertSafeAuditUrl("https://rebind.example/", { lookup: lookupTo("169.254.169.254") });
		expect(result.ok).toBe(false);
	});

	it("rechaza si una sola dirección de la respuesta es privada", async () => {
		const result = await assertSafeAuditUrl("https://mixto.example/", {
			lookup: async () => [
				{ address: "93.184.216.34", family: 4 },
				{ address: "192.168.0.10", family: 4 },
			],
		});
		expect(result.ok).toBe(false);
	});

	it("rechaza si el DNS no resuelve", async () => {
		const result = await assertSafeAuditUrl("https://no-existe.example/", {
			lookup: async () => {
				throw new Error("ENOTFOUND");
			},
		});
		expect(result.ok).toBe(false);
		expect(result.ok === false && result.kind).toBe("unresolved");
	});

	it("rechaza si el DNS devuelve una lista vacía", async () => {
		const result = await assertSafeAuditUrl("https://vacio.example/", { lookup: async () => [] });
		expect(result.ok).toBe(false);
	});

	it("acepta un host público que resuelve a una IP pública", async () => {
		const result = await assertSafeAuditUrl("https://example.com/", { lookup: lookupTo("93.184.216.34") });
		expect(result.ok).toBe(true);
	});

	it("no resuelve cuando el host ya es una IP: la valida y listo", async () => {
		let called = false;
		const result = await assertSafeAuditUrl("http://93.184.216.34/", {
			lookup: async () => {
				called = true;
				return [];
			},
		});
		expect(result.ok).toBe(true);
		expect(called).toBe(false);
	});
});
