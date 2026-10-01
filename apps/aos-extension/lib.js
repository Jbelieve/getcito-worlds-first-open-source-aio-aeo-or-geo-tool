// Núcleo compartido de la extensión BeAOS: config, cliente de los endpoints públicos y storage.
// Vanilla ESM (sin bundler) — se carga directo como extensión descomprimida.
//
// Qué vive acá y por qué: **las piezas puras**. Armar el request, mapear la respuesta del endpoint
// a lo que el popup muestra, el texto de cada estado y el de cada error son funciones sin red y sin
// navegador, así que se prueban con el runner de node (`node --test "test/*.test.mjs"`) sin depender
// de nada.
// El resto (fetch y `chrome.storage`) son envoltorios delgados alrededor de esas funciones.
//
// El contrato del endpoint público vive en `apps/web/src/lib/aos/public-audit.ts`; la semántica de
// los estados, en `apps/web/src/components/status-tone.tsx`. Si cambia uno, cambia esto.

// --- dónde vive BeAOS ---------------------------------------------------------
//
// **Dos hosts, dos papeles, y no son intercambiables:**
//
//   `be-aos.believe-global.com` — la web PÚBLICA que ve el usuario ("BeAOS — el estándar de marca
//                                para agentes de IA"). Es la que va en cualquier enlace del popup.
//   `beaos.believe-global.com`  — la APP y la API. Ahí viven los endpoints, y ahí apunta el
//                                `host_permissions` del manifest. Abrirla con el navegador redirige
//                                a `/auth/login`: es una app con sesión, no una página de marca.
//
// El bug que esto evita: un solo `BEAOS_URL` que se usaba para las dos cosas mandaba al usuario a
// la pantalla de login cuando pedía "ver más sobre BeAOS". Por eso ahora hay dos constantes con
// nombre explícito y nada que las mezcle.

/** La web pública: la landing que se le muestra a una persona. */
export const BEAOS_WEB_URL = "https://be-aos.believe-global.com";

/** La API: solo endpoints. Nunca es un enlace para el usuario. */
export const BEAOS_API_URL = "https://beaos.believe-global.com";

/**
 * Los dos endpoints de BeAOS. Públicos a propósito: **sin credencial**, sin apikey y sin sesión.
 * Antes la extensión hablaba con Supabase (Maasy) y mandaba una publishable key; ahora no manda
 * nada más que el cuerpo. Lo que sostiene el servicio es el límite diario por IP más el tope
 * global del endpoint, no un token.
 */
export const AUDIT_ENDPOINT = `${BEAOS_API_URL}/api/v1/aos/audit`;
export const LEAD_ENDPOINT = `${BEAOS_API_URL}/api/v1/aos/lead`;

/** Enlaces del popup que son del **estándar**: no se tocan con el rebautizo. */
export const STANDARD_REPO_URL = "https://github.com/BELIEVE-IT-GROUP/aos-aps-standard";

/** La casa. No es la landing del producto, así que no cambia. */
export const BELIEVE_HOME = "https://believe-global.com";

// --- semántica de los estados ------------------------------------------------
//
// Espejo de `AOS_BANDS` y del `RequirementStatus` de status-tone.tsx. El color **ordena, no juzga**:
// la rampa es azul y lo que falta se marca con tinta plena y su glifo, nunca con un rojo nuevo.
// `level` es el nivel de la rampa; el color concreto vive en popup.css, en los seis tokens de marca.

export const BANDS = {
	"Agent-Operable": { label: "Operable", level: "full" },
	"Agent-Attemptable": { label: "Intentable", level: "high" },
	"Agent-Blocked": { label: "Bloqueado", level: "mid" },
	"Agent-Inert": { label: "Inerte", level: "low" },
};

/** Glifo y tono de cada estado. Sin color propio: el tono sale de la paleta, no del juicio. */
export const REQUIREMENT_GLYPH = { pass: "✓", fail: "✕", n_a: "—" };
export const REQUIREMENT_TONE = { pass: "primary", fail: "ink", n_a: "muted" };

/** El estado, dicho con palabras. Un estado nunca depende solo del color. */
export const STATUS_TEXT = { pass: "Pasa", fail: "No pasa", n_a: "No aplica" };

/** La fuerza del requisito, dicha en castellano. */
export const STRENGTH_TEXT = { MUST: "Obligatorio", SHOULD: "Recomendado", MAY: "Opcional" };

export const BUSINESS_TYPE_TEXT = { brand: "marca / servicio", product_api: "producto-API" };

/** Lo que se dice de un sitio que no publica perfil firmado. Se dice; no se rellena con ceros. */
export const NO_PROFILE_TEXT = "El sitio no publica /.well-known/brand.json: no declara APS.";

/** Cuando el endpoint no manda evidencia: es lo que se vio al comprobar y puede faltar. */
export const NO_EVIDENCE_TEXT = "Sin evidencia registrada.";

/**
 * Cómo se llama cada eje. El eje es del estándar; la segunda mitad dice qué mide.
 *
 * El eje APS se llama **del estándar** y no "preferencia" a secas: el número es cuántos requisitos del
 * eje cumple el sitio, no una medición contra modelos. En este mismo popup conviven "APS del estándar"
 * y "APS declarado", y hay un tercero —el medido— que no sale de acá. Decirle "preferencia" a un
 * chequeo del sitio es lo que hacía que los tres parecieran el mismo número.
 */
export const AXIS_TEXT = { AOS: "AOS · operabilidad", APS: "APS · del estándar" };

/**
 * El badge Agent-Preferred. **Solo cuando la firma Ed25519 verifica de verdad**
 * (`signatureVerified === true`): no es un adorno, certifica que el perfil firmado del sitio se pudo
 * comprobar contra las claves que él mismo publica. Cuando no verifica, no hay badge — no hay una
 * versión "apagada" del badge, porque un badge apagado seguiría diciendo Agent-Preferred.
 */
export const BADGE_LABEL = "Agent-Preferred";
export const BADGE_VERIFIED_TEXT = "perfil firmado verificado";

/**
 * El Bot Beacon: el tráfico agéntico real que recibió el sitio. La extensión vieja lo mostraba, y
 * esto es lo que hay que decir cuando no hay dato — que es siempre, hoy.
 *
 * En Maasy salía de su propio instrumento de tráfico (una tabla de hits por dominio, con el
 * user-agent clasificado) más los intentos terminales de su operador. Eso es dato **de Maasy sobre
 * los sitios que instrumenta**, no algo que se pueda medir de una URL arbitraria. BeAOS no tiene
 * ningún ingest de tráfico, así que el bloque se muestra declarando el hueco: un cero acá se leería
 * como "no te visitó ningún agente", que sería un dato falso.
 */
export const BOT_BEACON_NO_SOURCE_TEXT = "BeAOS mide el estándar de un sitio, no su tráfico.";

// --- funciones puras ---------------------------------------------------------

/** Dominio limpio (sin www) de una URL de pestaña. null si no es http(s). */
export function domainFromUrl(url) {
	try {
		const u = new URL(url);
		if (u.protocol !== "http:" && u.protocol !== "https:") return null;
		return u.hostname.replace(/^www\./, "");
	} catch {
		return null;
	}
}

/** Cuerpo del audit. El endpoint solo acepta `url`. */
export function auditRequestBody(url) {
	return { url };
}

/** Request completo del audit, listo para pasarle a `fetch`. Sin headers de credencial. */
export function auditRequestInit(url) {
	return {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(auditRequestBody(url)),
	};
}

/**
 * Cuerpo del lead. Solo se mandan los campos que existen: el endpoint valida el mail y acota
 * `score` a un entero de 0 a 100, así que un score ausente o fuera de rango se omite en vez de
 * viajar como basura y comerse un 400.
 */
export function leadRequestBody({ email, name, company, url, score } = {}) {
	const body = { email };
	if (typeof name === "string" && name.length > 0) body.name = name;
	if (typeof company === "string" && company.length > 0) body.company = company;
	if (typeof url === "string" && url.length > 0) body.url = url;
	if (Number.isInteger(score) && score >= 0 && score <= 100) body.score = score;
	return body;
}

/** Request completo del lead. */
export function leadRequestInit(input) {
	return {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(leadRequestBody(input)),
	};
}

/** Lee `Retry-After` (segundos o fecha HTTP) y cae a `RateLimit-Reset` (segundos). null si no hay. */
export function readRetryAfter(headers, now = Date.now()) {
	const read = (name) => {
		if (!headers || typeof headers.get !== "function") return null;
		const raw = headers.get(name);
		if (raw === null || raw === undefined || String(raw).trim().length === 0) return null;
		return String(raw).trim();
	};
	for (const name of ["Retry-After", "RateLimit-Reset"]) {
		const raw = read(name);
		if (raw === null) continue;
		if (/^\d+$/.test(raw)) return Number(raw);
		const asDate = Date.parse(raw);
		if (Number.isNaN(asDate) === false) return Math.max(0, Math.ceil((asDate - now) / 1000));
	}
	return null;
}

/** Segundos → "3 h 20 min", "45 min", "un minuto". Lo que se le promete al usuario. */
export function humanWait(seconds) {
	if (typeof seconds !== "number" || Number.isFinite(seconds) === false || seconds <= 0) return "en un rato";
	if (seconds < 60) return "en menos de un minuto";
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `en ${minutes} min`;
	const hours = Math.floor(minutes / 60);
	const rest = minutes % 60;
	return rest === 0 ? `en ${hours} h` : `en ${hours} h ${rest} min`;
}

/**
 * Lee `RateLimit-Limit`: **el cupo que el servidor decidió para este pedido**. `null` cuando la
 * cabecera no viene o no dice un cupo.
 *
 * Por qué no hay una constante con el número: el cupo efectivo lo define la env del servidor
 * (`AOS_PUBLIC_AUDITS_PER_DAY`, default 20) y la cabecera lo publica. Un número escrito acá es un
 * número falso apenas alguien toque la env — pasó, con un cupo real de **200** y un texto que decía
 * **20**. La constante de cupo que vivía en este archivo se fue por eso.
 *
 * Y cuando la cabecera no viene (un servidor viejo, un proxy que la come) lo correcto es **no
 * inventar la cifra**: se dice el cupo sin el número. Un `0` o un default acá serían la misma mentira
 * de antes, con otro origen.
 */
export function readRateLimit(headers) {
	if (!headers || typeof headers.get !== "function") return null;
	const raw = headers.get("RateLimit-Limit");
	if (raw === null || raw === undefined) return null;
	const text = String(raw).trim();
	if (text.length === 0) return null;
	const value = Number(text);
	if (Number.isInteger(value) === false || value <= 0) return null;
	return value;
}

/**
 * El texto de cada error, en castellano y sin jerga.
 *
 * `status` es el HTTP, `code` es el `code` del cuerpo del 400 (si vino), `retryAfterSeconds` lo que
 * dijo el servidor que hay que esperar y `rateLimitLimit` el cupo que publicó en `RateLimit-Limit`
 * (los dos pueden faltar). Nunca se muestra un alert técnico. El caso 0 es "no se pudo llegar": red
 * caída, DNS, extensión sin permiso.
 *
 * **El 400 no es un solo error.** El servidor distingue dos motivos y los manda en `code`:
 *   · `invalid_url` — no se pudo interpretar la dirección (un error de forma);
 *   · `blocked_url` — la dirección queda afuera por seguridad.
 * Antes los dos caían en el mismo texto, y por eso un error de parseo se le mostraba al usuario
 * como si hubiera auditado una dirección interna. Cuando el `code` no viene (un servidor viejo, o un
 * 400 que no es del guardián) se dice la verdad sin inventar el motivo: se pudo ni interpretar ni
 * confirmar.
 *
 * **El `blocked_url` no enumera lo que bloquea.** El texto viejo detallaba los destinos que el
 * guardián deja afuera: le enseñaba a quien prueba **qué apuntar** y a una persona normal no le decía
 * nada (casi nadie audita su propia máquina). El criterio canónico fija el texto: la dirección
 * **queda afuera por seguridad**, sin el detalle de la defensa. La lista de lo que se bloquea vive en
 * el servidor, que es donde tiene que vivir.
 *
 * **El 429 dice el cupo que vino, no el que suponemos.** El número sale de `rateLimitLimit`
 * (la cabecera `RateLimit-Limit`); si no vino, el cupo se dice **sin la cifra**, porque un número
 * inventado es peor que ninguno. Lo que nunca falta es **cuándo** puede volver, leído de
 * `Retry-After` (o de `RateLimit-Reset`).
 */
export function auditErrorText(status, { code = null, retryAfterSeconds = null, rateLimitLimit = null } = {}) {
	if (status === 400) {
		if (code === "invalid_url") {
			return {
				title: "No se pudo interpretar la dirección",
				detail:
					"No pudimos leer esa dirección como una URL. Probá con una dirección completa, con su https:// (por ejemplo, https://ejemplo.com/precios).",
			};
		}
		if (code === "blocked_url") {
			return {
				title: "Esa dirección queda afuera por seguridad",
				detail: "El endpoint solo audita sitios http(s) públicos. Esa dirección queda afuera por seguridad.",
			};
		}
		return {
			title: "No se puede auditar esa dirección",
			detail:
				"El endpoint rechazó la dirección y no dijo por qué. Puede ser una dirección que no se pudo interpretar o un sitio público que no está permitido auditar; el detalle está en la consola.",
		};
	}
	if (status === 429) {
		const wait = retryAfterSeconds === null ? null : humanWait(retryAfterSeconds);
		// El cupo, solo si el servidor lo dijo. Sin cifra la frase del cupo no va: "Son auditorías por IP
		// y por día" no se lee.
		const cupo = rateLimitLimit === null ? null : `Son ${rateLimitLimit} auditorías por IP y por día.`;
		if (cupo === null) {
			return {
				title: "Se acabó el cupo por hoy",
				detail:
					wait === null
						? "El cupo se renueva a la medianoche UTC."
						: `Podés volver ${wait}, o cuando el cupo se renueva a la medianoche UTC.`,
			};
		}
		return {
			title: "Se acabó el cupo por hoy",
			detail:
				wait === null
					? `${cupo} El cupo se renueva a la medianoche UTC.`
					: `${cupo} Podés volver ${wait}, o a la medianoche UTC.`,
		};
	}
	if (status === 504) {
		return {
			title: "La auditoría tardó demasiado",
			detail: "El sitio no respondió en el tiempo que el endpoint espera. Probá de nuevo en un rato.",
		};
	}
	if (status === 0) {
		return {
			title: "No se pudo llegar al servicio",
			detail: "Revisá tu conexión e intentá de nuevo. El detalle está en la consola.",
		};
	}
	return {
		title: "No se pudo medir",
		detail: `El servicio respondió ${status}. El detalle está en la consola.`,
	};
}

/** Un número finito, o `fallback`. La respuesta viene de la red: no se confía en su forma. */
function finiteNumber(value, fallback = null) {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Un contador: entero y nunca negativo. Un `-1` o un `2.7` no son conteos. */
function count(value) {
	return Math.max(0, Math.round(finiteNumber(value, 0)));
}

/** Un porcentaje, acotado a 0–100 y redondeado. */
function percent(value) {
	return Math.max(0, Math.min(100, Math.round(finiteNumber(value, 0))));
}

/**
 * Los sub-scores por eje del motor (`aosStandards` / `apsStandards`).
 *
 * `null` cuando la respuesta no los trae — la 2.0.0 que está en master hablaba con un endpoint que
 * solo devolvía el total. **No se recalculan acá**: los pesos del estándar viven en el motor, y un
 * popup que los reimplemente es la segunda implementación del AOS que se va a separar de la primera.
 */
export function mapSubScores(data) {
	const aos = finiteNumber(data?.aosStandards);
	const aps = finiteNumber(data?.apsStandards);
	if (aos === null && aps === null) return null;
	return {
		aos: aos === null ? null : percent(aos),
		aps: aps === null ? null : percent(aps),
	};
}

/**
 * El desglose por eje, mapeado. Es lo que reemplaza al `breakdown` por niveles de la extensión vieja.
 *
 * Los cinco niveles de Maasy (inventario, declaración N1, ejecutabilidad DOM N2, ejecución
 * programática N3, confiabilidad) son del AOS v1, un rubric que este motor **no corre**: no mide DOM,
 * ni formularios, ni ejecución programática, ni confiabilidad. Inventar esos cinco números sería
 * mentir con más precisión, así que no se muestran. Lo que el motor sí desglosa —y por lo tanto lo
 * único que se puede mostrar sin inventar— es el peso de cada eje del estándar.
 *
 * Vacío cuando el endpoint no lo manda (respuesta vieja): el bloque no se muestra, no se rellena.
 */
export function mapBreakdown(raw) {
	if (Array.isArray(raw) === false) return [];
	return raw
		.filter((entry) => entry?.axis === "AOS" || entry?.axis === "APS")
		.map((entry) => ({
			axis: entry.axis,
			label: AXIS_TEXT[entry.axis],
			percent: percent(entry.percent),
			passed: count(entry.passed),
			failed: count(entry.failed),
			notApplicable: count(entry.notApplicable),
			applicable: count(entry.applicable),
			earnedWeight: count(entry.earnedWeight),
			maxWeight: count(entry.maxWeight),
		}));
}

/**
 * El Bot Beacon, si algún día hay fuente. Hoy el endpoint manda `null` y esto devuelve `null`.
 * No se convierte un `null` en ceros: "no medimos" no es "no pasó nada".
 */
export function mapBotBeacon(raw) {
	if (raw === null || typeof raw !== "object") return null;
	const beacon = {
		windowDays: count(raw.windowDays),
		crawlHits: count(raw.crawlHits),
		distinctAgents: count(raw.distinctAgents),
		operationAttempts: count(raw.operationAttempts),
		operationFailures: count(raw.operationFailures),
		topAgents: (Array.isArray(raw.topAgents) ? raw.topAgents : [])
			.filter((agent) => typeof agent?.agentName === "string")
			.map((agent) => ({ agentName: agent.agentName })),
	};
	// Un beacon sin un solo número real es, a los ojos del popup, lo mismo que no tenerlo.
	if (beacon.crawlHits === 0 && beacon.operationAttempts === 0) return null;
	return beacon;
}

/**
 * El Bot Beacon dicho en una línea, con el mismo espíritu que la extensión vieja: "N agentes
 * intentaron operar, M fallaron" + "X hits de crawl · nombres". Cuando no hay beacon, dice que no
 * hay fuente en vez de callarse.
 */
export function botBeaconText(beacon) {
	if (beacon === null) return BOT_BEACON_NO_SOURCE_TEXT;
	const parts = [];
	if (beacon.operationAttempts > 0) {
		parts.push(
			`${beacon.operationAttempts} agentes intentaron operar este dominio, ${beacon.operationFailures} fallaron (${beacon.windowDays} d).`,
		);
	}
	if (beacon.crawlHits > 0) {
		const names = beacon.topAgents.map((agent) => agent.agentName).join(", ");
		parts.push(`${beacon.crawlHits} hits de crawl${names.length > 0 ? ` · ${names}` : ""}.`);
	}
	return parts.join(" ");
}

/** Un requisito del motor, mapeado a lo que el popup sabe mostrar. */
export function mapRequirement(raw) {
	const status = raw?.status === "pass" || raw?.status === "fail" || raw?.status === "n_a" ? raw.status : "n_a";
	const evidence = typeof raw?.evidence === "string" && raw.evidence.length > 0 ? raw.evidence : null;
	return {
		id: typeof raw?.id === "string" ? raw.id : "—",
		axis: typeof raw?.axis === "string" ? raw.axis : "—",
		strength: typeof raw?.strength === "string" ? raw.strength : "—",
		strengthText: STRENGTH_TEXT[raw?.strength] ?? (typeof raw?.strength === "string" ? raw.strength : "—"),
		title: typeof raw?.title === "string" ? raw.title : "—",
		status,
		statusText: STATUS_TEXT[status],
		glyph: REQUIREMENT_GLYPH[status],
		tone: REQUIREMENT_TONE[status],
		evidence,
		evidenceText: evidence ?? NO_EVIDENCE_TEXT,
		/**
		 * Puntos que devolvería arreglarlo. Solo lo mandan los requisitos que puntúan y hoy fallan: un
		 * `gain` ausente NO se rellena con 0, porque "no gana puntos" y "no se midió" no son lo mismo.
		 */
		gain: typeof raw?.gain === "number" && Number.isFinite(raw.gain) ? raw.gain : null,
		diagnostic: raw?.diagnostic === true,
	};
}

/**
 * Lo que el sitio declara de sí mismo en su brand.json, según el endpoint.
 *
 * `declaredAps`, `claims` y `signatureVerified` pueden venir null/false cuando el sitio no publica
 * perfil firmado. En ese caso **se dice**, y no se rellena con "APS 0 / 0 pruebas / firma inválida",
 * que sería inventar un dato que nadie midió.
 */
export function mapAps(data) {
	const declared = typeof data?.declaredAps === "number" && Number.isFinite(data.declaredAps) ? data.declaredAps : null;
	if (declared === null) {
		return {
			published: false,
			declaredAps: null,
			claims: null,
			signatureVerified: null,
			label: "Sin perfil firmado",
			claimsText: null,
			signatureText: NO_PROFILE_TEXT,
			signatureTone: "muted",
			/** Sin perfil no hay firma que verificar, así que no hay badge. */
			badge: null,
		};
	}
	const claims = typeof data?.claims === "number" && Number.isFinite(data.claims) ? data.claims : 0;
	const verified = data?.signatureVerified === true;
	return {
		published: true,
		declaredAps: declared,
		claims,
		signatureVerified: verified,
		label: `APS declarado ${declared}/100`,
		claimsText: claims === 1 ? "1 prueba declarada" : `${claims} pruebas declaradas`,
		signatureText: verified
			? "La firma Ed25519 verifica contra el keys.json que el sitio publica."
			: "Publica perfil pero la firma Ed25519 no verifica.",
		signatureTone: verified ? "primary" : "ink",
		/** El badge, solo con la firma verificada. Publicar perfil no alcanza. */
		badge: verified ? { label: BADGE_LABEL, text: BADGE_VERIFIED_TEXT } : null,
	};
}

/**
 * La respuesta del endpoint, mapeada a lo que el popup muestra.
 *
 * Devuelve el listado completo, sin recortar: los requisitos que puntúan por un lado y los
 * `diagnostic` por el otro, porque los diagnósticos **se informan y no mueven el score** — mezclarlos
 * haría creer que arreglarlos sube el número. Los `n_a` no aplican a este tipo de negocio y viajan
 * igual, marcados, con su evidencia si la hay.
 *
 * Los campos que el endpoint agregó en la 2.1.0 (`aosStandards`, `apsStandards`, `breakdown`) son
 * **opcionales**: si no vienen, `subScores` queda `null` y `breakdown` queda vacío, y el popup
 * simplemente no muestra esos bloques. La respuesta vieja no rompe nada y no se rellena a ojo.
 */
export function mapAuditResponse(data) {
	const raw = Array.isArray(data?.requirements) ? data.requirements : [];
	const requirements = raw.map(mapRequirement);
	const scored = requirements.filter((r) => r.diagnostic === false);
	const diagnostics = requirements.filter((r) => r.diagnostic === true);
	const band = BANDS[data?.band] ?? null;
	const score =
		typeof data?.score === "number" && Number.isFinite(data.score)
			? Math.max(0, Math.min(100, Math.round(data.score)))
			: null;
	const botBeacon = mapBotBeacon(data?.botBeacon);
	return {
		url: typeof data?.url === "string" ? data.url : null,
		score,
		band: {
			raw: typeof data?.band === "string" ? data.band : null,
			label: band?.label ?? (typeof data?.band === "string" && data.band.length > 0 ? data.band : "Sin dato"),
			level: band?.level ?? "unknown",
		},
		businessType: BUSINESS_TYPE_TEXT[data?.businessType] ?? "tipo de negocio sin dato",
		/** Los sub-scores por eje del motor, o null si la respuesta no los trae. */
		subScores: mapSubScores(data),
		/** El desglose por eje del motor. Vacío si la respuesta no lo trae. */
		breakdown: mapBreakdown(data?.breakdown),
		/** El tráfico agéntico real: `null` hoy, porque no hay fuente. Ver `BOT_BEACON_NO_SOURCE_TEXT`. */
		botBeacon,
		botBeaconText: botBeaconText(botBeacon),
		scored,
		diagnostics,
		/** El plan: los que puntúan, fallan y tienen ganancia, de mayor a menor. Es "qué hacer ahora". */
		plan: scored.filter((r) => r.status === "fail" && r.gain !== null).sort((a, b) => (b.gain ?? 0) - (a.gain ?? 0)),
		aps: mapAps(data),
		auditedAt: typeof data?.auditedAt === "string" ? data.auditedAt : null,
		counts: {
			total: requirements.length,
			pass: requirements.filter((r) => r.status === "pass").length,
			fail: requirements.filter((r) => r.status === "fail").length,
			n_a: requirements.filter((r) => r.status === "n_a").length,
			scored: scored.length,
			diagnostics: diagnostics.length,
			/** Los que puntúan Y fallan: es lo que de verdad mueve el número. Un diagnóstico que falla
			 * cuenta en `fail` pero no acá, porque arreglarlo no sube el score. */
			scoredFail: scored.filter((r) => r.status === "fail").length,
		},
	};
}

// --- storage (chrome.storage.local) ------------------------------------------
//
// Las claves llevan prefijo `beaos_`: la extensión vieja guardaba `aos_*` con OTRO contrato de
// respuesta, así que si compartieran clave el popup nuevo leería un caché con la forma vieja.
//
// Acá solo se guarda el último audit por dominio. El email ya no se persiste: en Maasy servía para
// pasar del free tier al flujo normal, y en BeAOS el cupo es por IP y el endpoint no pide
// credencial, así que guardarlo no tendría ningún efecto.

/** Cachea el último audit por dominio (evita re-pegarle al endpoint en cada apertura del popup
 * dentro de una ventana corta). TTL 10 min. */
export async function getCachedAudit(domain) {
	const key = `beaos_cache_${domain}`;
	const store = await chrome.storage.local.get(key);
	const entry = store[key];
	if (entry && Date.now() - entry.t < 10 * 60 * 1000) return entry.data;
	return null;
}

export async function setCachedAudit(domain, data) {
	await chrome.storage.local.set({ [`beaos_cache_${domain}`]: { t: Date.now(), data } });
}

/**
 * Cuerpo de error del endpoint → lo que el popup necesita para decidir qué decir.
 *
 * El `message` del servidor se conserva para la consola, pero el texto que ve el usuario sale de
 * `auditErrorText`, que decide por `status` + `code`. El `code` se lee tal cual viene: la extensión
 * no lo reinterpreta ni lo adivina, porque si el servidor no lo manda, lo correcto es decir que no
 * se sabe en vez de suponer que fue una dirección interna.
 */
export function parseAuditFailure({ status, headers, body } = {}) {
	const message = typeof body?.message === "string" ? body.message : null;
	const code = typeof body?.code === "string" ? body.code : null;
	return {
		ok: false,
		status,
		/** `invalid_url` (no se pudo interpretar) o `blocked_url` (queda afuera por seguridad). */
		code,
		retryAfterSeconds: readRetryAfter(headers),
		/** El cupo que decidió el servidor para este pedido. Sin la cabecera, `null`: no se inventa. */
		rateLimitLimit: readRateLimit(headers),
		error: message,
	};
}

// --- red (envoltorios delgados sobre las funciones puras de arriba) ----------

/**
 * Audita una URL contra el endpoint público de BeAOS.
 *
 * Recibe la **URL completa** de la pestaña (con esquema y con path), no el dominio: el endpoint exige
 * una URL parseable y el path es parte de lo que se mide.
 *
 * Devuelve `{ ok: true, data }` o `{ ok: false, status, code, retryAfterSeconds, rateLimitLimit, error }`.
 * El status 0 es "no se pudo llegar" (red, DNS, permiso), y ahí `code` es `null` porque no hubo
 * respuesta. El detalle técnico crudo va a la consola; el texto que ve el usuario sale de
 * `auditErrorText`. `rateLimitLimit` es el cupo que el servidor publicó en `RateLimit-Limit`: viaja
 * para que el 429 pueda decir el número **real** (o ninguno, si la cabecera no vino).
 */
export async function auditUrl(url) {
	try {
		const resp = await fetch(AUDIT_ENDPOINT, auditRequestInit(url));
		if (!resp.ok) {
			const body = await resp.json().catch(() => null);
			return parseAuditFailure({ status: resp.status, headers: resp.headers, body });
		}
		const data = await resp.json().catch(() => null);
		if (data === null || typeof data !== "object") {
			return {
				ok: false,
				status: resp.status,
				code: null,
				retryAfterSeconds: null,
				rateLimitLimit: null,
				error: "respuesta ilegible",
			};
		}
		return { ok: true, data };
	} catch (error) {
		console.error("[BeAOS] el audit falló:", error);
		return { ok: false, status: 0, code: null, retryAfterSeconds: null, rateLimitLimit: null, error: String(error) };
	}
}

/** Manda el lead. Devuelve true/false; el endpoint responde `{ ok: true }` sin confirmar nada más. */
export async function captureLead(input) {
	try {
		const resp = await fetch(LEAD_ENDPOINT, leadRequestInit(input));
		if (!resp.ok) console.warn(`[BeAOS] el lead no entró: HTTP ${resp.status}`);
		return resp.ok;
	} catch (error) {
		console.error("[BeAOS] el lead falló:", error);
		return false;
	}
}
