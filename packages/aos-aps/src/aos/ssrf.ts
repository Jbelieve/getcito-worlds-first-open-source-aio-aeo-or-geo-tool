/**
 * Guardián anti-SSRF para auditar una URL que manda un desconocido.
 *
 * El endpoint público de auditoría hace que el servidor pida la URL que le pasen: sin este guardián
 * cualquiera puede usarnos de proxy contra la red interna, el loopback o los metadatos de la nube.
 * El worker y el MCP ya pasaban por acá, pero con una lista más corta; ahora los tres comparten una
 * sola definición para que el agujero no se tape en un camino y siga abierto en el otro.
 *
 * Reglas:
 *   - solo http/https, sin credenciales embebidas;
 *   - hostnames prohibidos (localhost, `.local`, `.internal`, metadatos de nube);
 *   - literales IPv4/IPv6 clasificados por rango, no por texto: `127.1`, `2130706433` y
 *     `[::ffff:7f00:1]` son la misma dirección que `127.0.0.1` y el parser de URL ya los normaliza;
 *   - todo hostname se resuelve por DNS y **cada** dirección resultante se valida, porque un nombre
 *     público puede apuntar a una IP privada.
 *
 * Y el pedido se hace con `safeFetch` (`./guarded-http`), no con el `fetch` global: la conexión va
 * **a la IP que se validó** (lookup fijado en el socket) y ningún redirect se sigue sin volver a
 * validar. Sin eso queda abierta la ventana del DNS rebinding (TOCTOU), y un 3xx a una dirección
 * interna entra sin que el guardián vea nunca la URL destino.
 */
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

/** Una resolución DNS inyectable: los tests simulan un host que resuelve a IP privada sin salir a la red. */
export type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export interface UrlGuardOptions {
	/** Resolutor a usar. Por defecto, el DNS del sistema. */
	lookup?: LookupFn;
}

/**
 * Motivo del rechazo, para que quien llama decida qué cuenta:
 *   - `invalid`: la entrada está mal (esquema, credenciales, host, IP mal escrita);
 *   - `blocked`: la entrada es válida pero apunta a un destino interno (no se detalla al cliente,
 *     porque el motivo revela qué resuelve nuestro DNS);
 *   - `unresolved`: el host no resuelve.
 */
export type UrlGuardRejectionKind = "invalid" | "blocked" | "unresolved";

/**
 * `addresses` son las direcciones que se validaron, en el orden en que las devolvió el DNS. Es la
 * mitad que le faltaba al guardián: el conector las fija en el socket para que la conexión vaya a la
 * IP validada y no a una segunda resolución del atacante. Para un literal no hay resolución y trae el
 * propio literal, que ya se validó en el texto.
 */
export type UrlGuardResult =
	| { ok: true; url: URL; addresses: string[] }
	| { ok: false; kind: UrlGuardRejectionKind; reason: string };

/** Validación puramente textual: mismo rechazo, pero sin direcciones porque acá no se resolvió nada. */
export type UrlTextGuardResult = { ok: true; url: URL } | { ok: false; kind: UrlGuardRejectionKind; reason: string };

const defaultLookup: LookupFn = (hostname) => dnsLookup(hostname, { all: true });

/** Hostnames que nunca son un sitio público auditable. */
const BLOCKED_HOSTNAMES = new Set([
	"localhost",
	"metadata",
	"metadata.google.internal",
	"metadata.goog",
	"instance-data",
	"instance-data.ec2.internal",
]);

/** Sufijos reservados para redes internas o nombres que no resuelven en el DNS público. */
const BLOCKED_HOST_SUFFIXES = [
	".localhost",
	".local",
	".internal",
	".home.arpa",
	".in-addr.arpa",
	".ip6.arpa",
	".onion",
];

/** Rangos IPv4 prohibidos, como enteros de 32 bits: interna, loopback, link-local, metadatos y reservada. */
const BLOCKED_IPV4_RANGES: Array<{ start: number; end: number; label: string }> = [
	{ start: 0x00000000, end: 0x00ffffff, label: "0.0.0.0/8 (esta red)" },
	{ start: 0x0a000000, end: 0x0affffff, label: "10.0.0.0/8 (privada)" },
	{ start: 0x64400000, end: 0x647fffff, label: "100.64.0.0/10 (CGNAT)" },
	{ start: 0x7f000000, end: 0x7fffffff, label: "127.0.0.0/8 (loopback)" },
	{ start: 0xa9fe0000, end: 0xa9feffff, label: "169.254.0.0/16 (link-local y metadatos)" },
	{ start: 0xac100000, end: 0xac1fffff, label: "172.16.0.0/12 (privada)" },
	{ start: 0xc0000000, end: 0xc00000ff, label: "192.0.0.0/24 (IETF)" },
	{ start: 0xc0000200, end: 0xc00002ff, label: "192.0.2.0/24 (TEST-NET-1)" },
	{ start: 0xc0586300, end: 0xc05863ff, label: "192.88.99.0/24 (6to4 relay)" },
	{ start: 0xc0a80000, end: 0xc0a8ffff, label: "192.168.0.0/16 (privada)" },
	{ start: 0xc6120000, end: 0xc613ffff, label: "198.18.0.0/15 (benchmarking)" },
	{ start: 0xc6336400, end: 0xc63364ff, label: "198.51.100.0/24 (TEST-NET-2)" },
	{ start: 0xcb007100, end: 0xcb0071ff, label: "203.0.113.0/24 (TEST-NET-3)" },
	{ start: 0xe0000000, end: 0xefffffff, label: "224.0.0.0/4 (multicast)" },
	{ start: 0xf0000000, end: 0xffffffff, label: "240.0.0.0/4 (reservada)" },
];

interface Ipv4 {
	octets: [number, number, number, number];
	value: number;
}

/** Dotted quad estricto: cuatro octetos decimales, sin ceros a la izquierda ni notación corta. */
function parseIpv4(ip: string): Ipv4 | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	const octets: number[] = [];
	for (const part of parts) {
		if (/^\d{1,3}$/.test(part) === false) return null;
		const value = Number(part);
		if (value > 255) return null;
		octets.push(value);
	}
	const [a, b, c, d] = octets as [number, number, number, number];
	return { octets: [a, b, c, d], value: ((a << 24) >>> 0) + (b << 16) + (c << 8) + d };
}

/** 16 bytes de una IPv6 textual, aceptando `::` y la forma embebida `::ffff:1.2.3.4`. */
export function ipv6ToBytes(ip: string): Uint8Array | null {
	const withoutZone = ip.split("%")[0] ?? "";
	if (withoutZone.length === 0) return null;

	const groups = withoutZone.split("::");
	if (groups.length > 2) return null;
	const head = groups[0] === "" ? [] : groups[0].split(":");
	const tail = groups.length === 2 ? (groups[1] === "" ? [] : groups[1].split(":")) : [];

	const parseGroups = (items: string[]): number[] | null => {
		const out: number[] = [];
		for (const [index, item] of items.entries()) {
			// Solo la última posición puede traer una IPv4 embebida.
			if (item.includes(".")) {
				if (index !== items.length - 1) return null;
				const embedded = parseIpv4(item);
				if (embedded === null) return null;
				const [a, b, c, d] = embedded.octets;
				out.push((a << 8) + b, (c << 8) + d);
				continue;
			}
			if (/^[0-9a-fA-F]{1,4}$/.test(item) === false) return null;
			out.push(Number.parseInt(item, 16));
		}
		return out;
	};

	const headGroups = parseGroups(head);
	const tailGroups = parseGroups(tail);
	if (headGroups === null || tailGroups === null) return null;

	const missing = 8 - headGroups.length - tailGroups.length;
	if (groups.length === 2) {
		// `::` tiene que estar comprimiendo al menos un grupo; si no, la dirección es inválida.
		if (missing < 1) return null;
	} else if (missing !== 0) {
		return null;
	}
	const all = [...headGroups, ...Array.from({ length: Math.max(missing, 0) }, () => 0), ...tailGroups];
	if (all.length !== 8) return null;

	const bytes = new Uint8Array(16);
	for (const [index, group] of all.entries()) {
		bytes[index * 2] = (group >> 8) & 0xff;
		bytes[index * 2 + 1] = group & 0xff;
	}
	return bytes;
}

function bytesToIpv4(bytes: Uint8Array): Ipv4 {
	const [a, b, c, d] = [bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0];
	return { octets: [a, b, c, d], value: ((a << 24) >>> 0) + (b << 16) + (c << 8) + d };
}

function classifyIpv4(ipv4: Ipv4): string | null {
	const range = BLOCKED_IPV4_RANGES.find((entry) => ipv4.value >= entry.start && ipv4.value <= entry.end);
	return range === undefined ? null : range.label;
}

function isAllZero(bytes: Uint8Array, from: number, to: number): boolean {
	for (let index = from; index < to; index += 1) {
		if (bytes[index] !== 0) return false;
	}
	return true;
}

/** Motivo por el que una IP no se puede pedir, o `null` si es pública y enrutable. */
export function blockedIpReason(ip: string): string | null {
	const normalized = ip.startsWith("[") && ip.endsWith("]") ? ip.slice(1, -1) : ip;
	const family = isIP(normalized);

	if (family === 4) {
		const parsed = parseIpv4(normalized);
		if (parsed === null) return "IPv4 mal formada";
		return classifyIpv4(parsed);
	}

	if (family === 6) {
		const bytes = ipv6ToBytes(normalized);
		if (bytes === null) return "IPv6 mal formada";
		if (isAllZero(bytes, 0, 16)) return ":: (sin especificar)";
		// ::1
		if (isAllZero(bytes, 0, 15) && bytes[15] === 1) return "::1 (loopback)";
		// fc00::/7 — unique local
		if (((bytes[0] ?? 0) & 0xfe) === 0xfc) return "fc00::/7 (local única)";
		// fe80::/10 — link local
		if (bytes[0] === 0xfe && ((bytes[1] ?? 0) & 0xc0) === 0x80) return "fe80::/10 (link-local)";
		// ff00::/8 — multicast
		if (bytes[0] === 0xff) return "ff00::/8 (multicast)";
		// 2001:db8::/32 — documentación
		if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) {
			return "2001:db8::/32 (documentación)";
		}
		// 2002::/16 — 6to4, encapsula una IPv4 que puede ser privada
		if (bytes[0] === 0x20 && bytes[1] === 0x02) return "2002::/16 (6to4)";
		// 64:ff9b::/96 — NAT64, la IPv4 va en los últimos 4 bytes
		const isNat64 = bytes[0] === 0x00 && bytes[1] === 0x64 && bytes[2] === 0xff && bytes[3] === 0x9b;
		// ::ffff:0:0/96 y ::a.b.c.d — IPv4 mapeada/compatible
		const isMapped = isAllZero(bytes, 0, 10) && bytes[10] === 0xff && bytes[11] === 0xff;
		const isCompat = isAllZero(bytes, 0, 12);
		if (isNat64 || isMapped || isCompat) {
			const embedded = classifyIpv4(bytesToIpv4(bytes.slice(12, 16)));
			if (embedded !== null) return `${embedded} (vía IPv6 ${normalized})`;
			// :: y ::1 ya se cubrieron arriba; una IPv4 pública embebida es alcanzable, pero
			// dejarla pasar permitiría saltarse la validación por texto. La bloqueamos igual.
			if (isNat64) return "64:ff9b::/96 (NAT64)";
			if (isMapped) return "::ffff:0:0/96 (IPv4 mapeada)";
			return "::a.b.c.d (IPv4 compatible)";
		}
		return null;
	}

	return `"${ip}" no es una IP`;
}

/** ¿La IP es un destino que este servidor no debe pedir? */
export function isBlockedIp(ip: string): boolean {
	return blockedIpReason(ip) !== null;
}

function blockedHostnameReason(hostname: string): string | null {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (host.length === 0) return "hostname vacío";
	if (BLOCKED_HOSTNAMES.has(host)) return `"${host}" está prohibido`;
	if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return `"${host}" es un nombre interno`;
	return null;
}

/**
 * Validación puramente textual: protocolo, credenciales, hostname y, si es un literal, la IP.
 * No resuelve DNS — eso lo hace `assertSafeAuditUrl`.
 */
export function validateAuditUrl(raw: string): UrlTextGuardResult {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		return { ok: false, kind: "invalid", reason: "la URL no se puede parsear" };
	}

	if (url.protocol !== "http:" && url.protocol !== "https:") {
		return { ok: false, kind: "invalid", reason: `solo http y https, no "${url.protocol}"` };
	}
	if (url.username.length > 0 || url.password.length > 0) {
		return { ok: false, kind: "invalid", reason: "la URL no puede traer credenciales embebidas" };
	}

	// `URL` normaliza `2130706433`, `0x7f000001` y `127.1` a `127.0.0.1`, y las IPv6 a su forma
	// comprimida entre corchetes: por eso alcanza con mirar `hostname`.
	const hostname = url.hostname;
	if (hostname.length === 0) return { ok: false, kind: "invalid", reason: "la URL no tiene host" };

	const hostReason = blockedHostnameReason(hostname.startsWith("[") ? hostname.slice(1, -1) : hostname);
	if (hostReason !== null) return { ok: false, kind: "blocked", reason: hostReason };

	const bareHost = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
	if (isIP(bareHost) !== 0) {
		const ipReason = blockedIpReason(bareHost);
		if (ipReason !== null) return { ok: false, kind: "blocked", reason: `IP prohibida: ${ipReason}` };
	}

	return { ok: true, url };
}

/**
 * Guardián completo: valida el texto y después resuelve el hostname para comprobar cada dirección.
 *
 * Las IPv6 resueltas suelen venir en forma expandida (`::ffff:7f00:1`), que `blockedIpReason` entiende.
 */
export async function assertSafeAuditUrl(raw: string, options?: UrlGuardOptions): Promise<UrlGuardResult> {
	const textual = validateAuditUrl(raw);
	if (textual.ok === false) return textual;

	const hostname = textual.url.hostname.startsWith("[") ? textual.url.hostname.slice(1, -1) : textual.url.hostname;
	// Un literal no se resuelve: la IP que se validó es la que se escribe, y es la que se fija.
	if (isIP(hostname) !== 0) return { ...textual, addresses: [hostname] };

	const lookup = options?.lookup ?? defaultLookup;
	let addresses: Array<{ address: string; family: number }>;
	try {
		addresses = await lookup(hostname);
	} catch {
		return { ok: false, kind: "unresolved", reason: `no pudimos resolver "${hostname}"` };
	}
	if (addresses.length === 0)
		return { ok: false, kind: "unresolved", reason: `"${hostname}" no resuelve a ninguna dirección` };

	for (const entry of addresses) {
		const reason = blockedIpReason(entry.address);
		if (reason !== null) {
			return { ok: false, kind: "blocked", reason: `"${hostname}" resuelve a ${entry.address}: ${reason}` };
		}
	}

	return { ...textual, addresses: addresses.map((entry) => entry.address) };
}
