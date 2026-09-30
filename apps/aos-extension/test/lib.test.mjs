// Tests de las piezas puras de la extensión BeAOS. Runner de node, sin dependencias:
//
//   node --test apps/aos-extension/test/
//
// Las respuestas de `fixtures/` son **reales**: se capturaron del endpoint público corriendo el motor
// de verdad contra el sitio de verdad, y no se tocaron. Son la mitad del valor de estos tests: prueban
// contra lo que el endpoint devuelve, no contra lo que creemos que devuelve.
//
//   audit-believe-global.json → sitio completo: score 100, perfil firmado, APS declarado 94, con los
//                               campos de la 2.1.0 (sub-scores por eje, desglose, botBeacon).
//   audit-sin-perfil.json     → example.com: score 0, sin brand.json, con `n_a` y con `gain`.
//   audit-contrato-2.0.0.json → LA MISMA respuesta de believe-global.com capturada ANTES de extender
//                               el endpoint: el contrato 2.0.0, sin ninguno de los campos nuevos.
//                               Es la prueba de que la respuesta vieja sigue funcionando.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
	AXIS_TEXT,
	auditErrorText,
	auditRequestBody,
	auditRequestInit,
	BADGE_LABEL,
	BADGE_VERIFIED_TEXT,
	BOT_BEACON_NO_SOURCE_TEXT,
	botBeaconText,
	domainFromUrl,
	humanWait,
	leadRequestBody,
	leadRequestInit,
	mapAps,
	mapAuditResponse,
	mapBotBeacon,
	mapBreakdown,
	mapRequirement,
	mapSubScores,
	NO_EVIDENCE_TEXT,
	NO_PROFILE_TEXT,
	readRetryAfter,
} from "../lib.js";

function fixture(name) {
	return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8"));
}

const COMPLETO = fixture("audit-believe-global.json");
const SIN_PERFIL = fixture("audit-sin-perfil.json");
/** El contrato 2.0.0: la respuesta de la 2.0.0 que está en master, sin los campos nuevos. */
const VIEJO = fixture("audit-contrato-2.0.0.json");

/** Un mapa de headers mínimo, con la misma interfaz que `Headers`. */
function headers(map) {
	return { get: (name) => map[name] ?? null };
}

describe("respuesta completa (sitio con perfil firmado)", () => {
	const audit = mapAuditResponse(COMPLETO);

	it("conserva el score y traduce la banda a la rampa", () => {
		assert.equal(audit.score, 100);
		assert.equal(audit.band.raw, "Agent-Operable");
		assert.equal(audit.band.label, "Operable");
		assert.equal(audit.band.level, "full");
	});

	it("muestra el listado entero, sin recortar", () => {
		assert.equal(audit.scored.length, 11);
		assert.equal(audit.diagnostics.length, 8);
		assert.equal(audit.scored.length + audit.diagnostics.length, COMPLETO.requirements.length);
		assert.equal(audit.counts.total, 19);
		assert.equal(audit.counts.scoredFail, 0, "los 11 que puntúan pasan todos");
		assert.equal(audit.counts.scoredFail, 0, "y ninguno entra al plan");
		// Los 2 que fallan son diagnósticos: cuentan en `fail` y NO en `scoredFail`, porque
		// arreglarlos no sube el score. Es la diferencia que hace que el popup no prometa de más.
		assert.equal(audit.counts.fail, 2);
		assert.equal(audit.counts.fail, audit.diagnostics.filter((r) => r.status === "fail").length);
	});

	it("cada requisito llega con glifo, palabra y tono: el estado no depende del color", () => {
		for (const r of [...audit.scored, ...audit.diagnostics]) {
			assert.ok(r.id.length > 0, "todo requisito tiene id");
			assert.ok(r.title.length > 0, "todo requisito tiene título");
			assert.ok(["✓", "✕", "—"].includes(r.glyph), `glifo inesperado: ${r.glyph}`);
			assert.ok(["Pasa", "No pasa", "No aplica"].includes(r.statusText));
			assert.ok(["primary", "ink", "muted"].includes(r.tone));
			assert.ok(["AOS", "APS"].includes(r.axis));
			assert.ok(["Obligatorio", "Recomendado", "Opcional"].includes(r.strengthText));
		}
	});

	it("muestra la evidencia tal como la mandó el endpoint", () => {
		const llms = audit.scored.find((r) => r.id === "AOS-DISC-01");
		assert.equal(llms.evidence, "/llms.txt responde 200 · text/plain; charset=UTF-8 · 10555 chars.");
		assert.equal(llms.evidenceText, llms.evidence);
		assert.notEqual(llms.status, "n_a");
	});

	it("un `n_a` viaja igual, marcado, y no pide puntos", () => {
		const api = audit.scored.find((r) => r.id === "AOS-API-01");
		assert.equal(api.status, "n_a");
		assert.equal(api.statusText, "No aplica");
		assert.equal(api.glyph, "—");
		assert.equal(api.tone, "muted");
		assert.equal(api.gain, null);
		assert.ok(api.evidence.length > 0, "el n_a real sí trae evidencia");
		assert.ok(
			audit.plan.every((r) => r.id !== "AOS-API-01"),
			"un n_a no entra al plan: no aplica, no es una tarea",
		);
	});

	it("con score 100 no hay plan que ofrecer", () => {
		assert.deepEqual(audit.plan, []);
	});

	it("muestra APS declarado, pruebas declaradas y la firma verificada", () => {
		assert.equal(audit.aps.published, true);
		assert.equal(audit.aps.declaredAps, 94);
		assert.equal(audit.aps.claims, 6);
		assert.equal(audit.aps.signatureVerified, true);
		assert.equal(audit.aps.label, "APS declarado 94/100");
		assert.equal(audit.aps.claimsText, "6 pruebas declaradas");
		assert.equal(audit.aps.signatureTone, "primary");
	});

	it("un diagnóstico nunca tiene puntos, ni siquiera cuando el sitio saca 100", () => {
		for (const r of audit.diagnostics) {
			assert.equal(r.diagnostic, true);
			assert.equal(r.gain, null, `${r.id} es diagnóstico y no debería tener gain`);
		}
	});
});

describe("respuesta sin claims ni declaredAps (sitio sin perfil firmado)", () => {
	const audit = mapAuditResponse(SIN_PERFIL);

	it("parte de una respuesta real sin brand.json", () => {
		assert.equal(SIN_PERFIL.declaredAps, null);
		assert.equal(SIN_PERFIL.claims, 0);
		assert.equal(SIN_PERFIL.signatureVerified, false);
	});

	it("dice que no hay perfil en vez de rellenar con ceros", () => {
		assert.equal(audit.aps.published, false);
		assert.equal(audit.aps.declaredAps, null);
		assert.equal(audit.aps.claims, null, "0 pruebas serían un dato inventado");
		assert.equal(audit.aps.signatureVerified, null, "false se leería como firma inválida medida");
		assert.equal(audit.aps.claimsText, null);
		assert.equal(audit.aps.signatureText, NO_PROFILE_TEXT);
		assert.equal(audit.aps.label, "Sin perfil firmado");
		assert.equal(audit.aps.signatureTone, "muted");
	});

	it("no hay texto que afirme cero pruebas ni APS cero", () => {
		const textos = [audit.aps.label, audit.aps.claimsText, audit.aps.signatureText];
		for (const t of textos) {
			assert.equal(/0 pruebas|APS 0|0\/100/.test(t ?? ""), false, `texto inventado: ${t}`);
		}
	});

	it("el plan ordena por puntos y arranca por el que más devuelve", () => {
		assert.ok(audit.plan.length > 0);
		assert.equal(audit.plan[0].id, "APS-CLAIM-01");
		assert.equal(audit.plan[0].gain, 42.9);
		for (let i = 1; i < audit.plan.length; i++) {
			assert.ok(audit.plan[i - 1].gain >= audit.plan[i].gain, "el plan va de mayor a menor");
		}
		assert.ok(
			audit.plan.every((r) => r.status === "fail" && r.diagnostic === false && r.gain !== null),
			"el plan solo tiene requisitos que puntúan, fallan y tienen ganancia",
		);
	});

	it("los `n_a` no aplican al tipo de negocio y no aparecen en el plan", () => {
		const na = audit.scored.filter((r) => r.status === "n_a");
		assert.ok(na.length > 0, "la respuesta real trae al menos un n_a");
		assert.ok(na.every((r) => r.gain === null && r.statusText === "No aplica"));
		const ids = new Set(na.map((r) => r.id));
		assert.equal(
			audit.plan.some((r) => ids.has(r.id)),
			false,
		);
	});
});

describe("requisito diagnostic sin gain", () => {
	it("se informa aparte, sin puntos y sin evidencia inventada", () => {
		const raw = SIN_PERFIL.requirements.find((r) => r.id === "APS-CLAIM-02");
		assert.equal(raw.diagnostic, true);
		assert.equal("gain" in raw, false, "el fixture real no trae gain en los diagnósticos");
		assert.equal("evidence" in raw, false, "y este tampoco trae evidencia");

		const mapped = mapRequirement(raw);
		assert.equal(mapped.diagnostic, true);
		assert.equal(mapped.gain, null, "sin gain no se rellena con 0");
		assert.equal(mapped.evidence, null);
		assert.equal(mapped.evidenceText, NO_EVIDENCE_TEXT);
		assert.equal(mapped.statusText, "No pasa", "un diagnóstico puede fallar y no mueve el score");

		const audit = mapAuditResponse(SIN_PERFIL);
		assert.ok(
			audit.diagnostics.some((r) => r.id === "APS-CLAIM-02"),
			"el diagnóstico vive en su propia lista",
		);
		assert.equal(
			audit.scored.some((r) => r.id === "APS-CLAIM-02"),
			false,
			"y no se mezcla con los que puntúan",
		);
	});

	it("nunca le inventa puntos a un diagnóstico, ni aunque venga con gain por error", () => {
		const mapped = mapRequirement({
			id: "X-1",
			axis: "AOS",
			strength: "MUST",
			title: "arreglo inventado",
			status: "fail",
			diagnostic: true,
			gain: 25,
		});
		assert.equal(mapped.diagnostic, true);
		const audit = mapAuditResponse({ requirements: [{ ...mapped, diagnostic: true, gain: 25 }] });
		assert.equal(audit.diagnostics.length, 1);
		assert.equal(audit.scored.length, 0);
		assert.deepEqual(audit.plan, [], "un diagnóstico no entra al plan ni con gain");
	});
});

describe("el texto de cada error", () => {
	it("un 429 y un 400 dicen cosas distintas", () => {
		const cupo = auditErrorText(429, 3600);
		const rechazo = auditErrorText(400);
		assert.notEqual(cupo.title, rechazo.title);
		assert.notEqual(cupo.detail, rechazo.detail);
	});

	it("el 400 explica que la dirección no es auditable, sin jerga", () => {
		const r = auditErrorText(400);
		assert.match(r.title, /No se puede auditar esa dirección/);
		assert.match(r.detail, /http\(s\)/);
		assert.match(r.detail, /internas/);
	});

	it("el 429 dice cuándo puede volver, leyendo el Retry-After", () => {
		const unaHora = auditErrorText(429, 3600);
		assert.match(unaHora.title, /cupo por hoy/);
		assert.match(unaHora.detail, /20 auditorías por IP y por día/);
		assert.match(unaHora.detail, /en 1 h/, "traduce los segundos a algo legible");
	});

	it("si el 429 no trae Retry-After, igual dice cuándo: la medianoche UTC", () => {
		const sinHeader = auditErrorText(429, null);
		assert.match(sinHeader.detail, /medianoche UTC/);
		assert.equal(/undefined|null|NaN/.test(sinHeader.detail), false);
	});

	it("el 504 y el 500 no se confunden entre sí ni con los de arriba", () => {
		const lento = auditErrorText(504);
		const generico = auditErrorText(500);
		assert.match(lento.title, /tardó demasiado/);
		assert.match(generico.title, /No se pudo medir/);
		assert.match(generico.detail, /500/);
		const titulos = [auditErrorText(400), auditErrorText(429), lento, generico].map((e) => e.title);
		assert.equal(new Set(titulos).size, titulos.length, "cada caso tiene su propio título");
	});

	it("el estado 0 es 'no se pudo llegar', no un error del sitio", () => {
		assert.match(auditErrorText(0).title, /No se pudo llegar al servicio/);
	});
});

describe("armar el request", () => {
	it("el audit va a BeAOS sin credencial y con el cuerpo que el endpoint acepta", () => {
		const init = auditRequestInit("https://ejemplo.com");
		assert.equal(init.method, "POST");
		assert.equal(init.headers["Content-Type"], "application/json");
		assert.equal(init.body, '{"url":"https://ejemplo.com"}');
		assert.deepEqual(auditRequestBody("https://ejemplo.com"), { url: "https://ejemplo.com" });
		const cabeceras = Object.keys(init.headers).map((h) => h.toLowerCase());
		assert.equal(cabeceras.includes("authorization"), false, "ya no hay Bearer");
		assert.equal(cabeceras.includes("apikey"), false, "ya no hay apikey de Supabase");
	});

	it("el lead manda solo los campos que existen y un score válido", () => {
		assert.deepEqual(leadRequestBody({ email: "a@b.com" }), { email: "a@b.com" });
		assert.deepEqual(
			leadRequestBody({ email: "a@b.com", name: "", company: "", url: "https://ejemplo.com", score: 73 }),
			{
				email: "a@b.com",
				url: "https://ejemplo.com",
				score: 73,
			},
		);
		assert.equal("score" in leadRequestBody({ email: "a@b.com", score: 101 }), false);
		assert.equal("score" in leadRequestBody({ email: "a@b.com", score: 12.5 }), false);
		assert.equal("score" in leadRequestBody({ email: "a@b.com", score: -1 }), false);
		assert.equal("score" in leadRequestBody({ email: "a@b.com", score: 0 }), true, "0 es un score válido");
	});

	it("el request del lead también va sin credencial", () => {
		const init = leadRequestInit({ email: "a@b.com" });
		assert.equal(init.method, "POST");
		assert.deepEqual(Object.keys(init.headers), ["Content-Type"]);
	});
});

describe("Retry-After", () => {
	it("lee los segundos tal como los manda BeAOS", () => {
		assert.equal(readRetryAfter(headers({ "Retry-After": "74417" })), 74417);
	});

	it("también entiende una fecha HTTP", () => {
		const now = Date.parse("2026-09-30T03:00:00Z");
		assert.equal(readRetryAfter(headers({ "Retry-After": "Wed, 30 Sep 2026 04:00:00 GMT" }), now), 3600);
	});

	it("si no hay Retry-After cae al RateLimit-Reset", () => {
		assert.equal(readRetryAfter(headers({ "RateLimit-Reset": "600" })), 600);
	});

	it("sin ninguno de los dos devuelve null, que es 'no sabemos'", () => {
		assert.equal(readRetryAfter(headers({})), null);
		assert.equal(readRetryAfter(undefined), null);
		assert.equal(readRetryAfter(headers({ "Retry-After": "   " })), null);
	});

	it("traduce segundos a algo que se puede leer", () => {
		assert.equal(humanWait(30), "en menos de un minuto");
		assert.equal(humanWait(600), "en 10 min");
		assert.equal(humanWait(3600), "en 1 h");
		assert.equal(humanWait(12000), "en 3 h 20 min");
		assert.equal(humanWait(null), "en un rato");
	});
});

describe("dominio de la pestaña", () => {
	it("saca el www y solo acepta http(s)", () => {
		assert.equal(domainFromUrl("https://www.believe-global.com/aos"), "believe-global.com");
		assert.equal(domainFromUrl("http://sub.ejemplo.com/x?y=1"), "sub.ejemplo.com");
		assert.equal(domainFromUrl("chrome://extensions"), null);
		assert.equal(domainFromUrl("file:///tmp/x.html"), null);
		assert.equal(domainFromUrl("no es una url"), null);
		assert.equal(domainFromUrl(undefined), null);
	});
});

describe("mapAps", () => {
	it("distingue 'publica perfil sin firma válida' de 'no publica perfil'", () => {
		const conPerfilSinFirma = mapAps({ declaredAps: 40, claims: 2, signatureVerified: false });
		assert.equal(conPerfilSinFirma.published, true);
		assert.equal(conPerfilSinFirma.claims, 2);
		assert.equal(conPerfilSinFirma.signatureVerified, false);
		assert.equal(conPerfilSinFirma.signatureTone, "ink");
		assert.notEqual(conPerfilSinFirma.signatureText, NO_PROFILE_TEXT);
		assert.match(conPerfilSinFirma.signatureText, /no verifica/);
	});

	it("un perfil sin claims declarados dice cero, que sí es un dato", () => {
		const sinClaims = mapAps({ declaredAps: 12, claims: 0, signatureVerified: true });
		assert.equal(sinClaims.claimsText, "0 pruebas declaradas");
	});

	it("dice '1 prueba' en singular", () => {
		assert.equal(mapAps({ declaredAps: 5, claims: 1, signatureVerified: true }).claimsText, "1 prueba declarada");
	});
});

// --- las cuatro cosas que la 2.0.0 había perdido ------------------------------

describe("sub-scores por eje", () => {
	const audit = mapAuditResponse(COMPLETO);

	it("llegan los dos, tal como los calculó el motor", () => {
		assert.deepEqual(audit.subScores, { aos: 100, aps: 100 });
		// El score total ES el sub-score del eje AOS: es el contrato, no una coincidencia.
		assert.equal(audit.score, audit.subScores.aos);
	});

	it("el APS medido y el APS declarado no son el mismo número", () => {
		// `subScores.aps` lo medimos nosotros sobre el estándar; `aps.declaredAps` es lo que el sitio
		// dice de sí mismo. Mezclarlos sería mostrar dos veces el número equivocado.
		assert.equal(audit.subScores.aps, 100);
		assert.equal(audit.aps.declaredAps, 94);
	});

	it("el popup no los recalcula: sin el campo en la respuesta, quedan null", () => {
		assert.equal(mapSubScores({}), null);
		assert.equal(mapSubScores(undefined), null);
		assert.equal(mapAuditResponse({ score: 80, requirements: [] }).subScores, null);
	});

	it("acota un porcentaje fuera de rango en vez de mostrarlo crudo", () => {
		assert.deepEqual(mapSubScores({ aosStandards: 999, apsStandards: -4 }), { aos: 100, aps: 0 });
	});
});

describe("el desglose por eje", () => {
	const audit = mapAuditResponse(COMPLETO);

	it("trae los dos ejes en orden fijo, con su nombre legible", () => {
		assert.deepEqual(
			audit.breakdown.map((entry) => entry.axis),
			["AOS", "APS"],
		);
		assert.equal(audit.breakdown[0].label, AXIS_TEXT.AOS);
		assert.equal(audit.breakdown[1].label, AXIS_TEXT.APS);
	});

	it("cuenta checks y pesos del eje, y el `percent` es el sub-score del eje", () => {
		const [aos, aps] = audit.breakdown;
		assert.deepEqual(
			{ passed: aos.passed, failed: aos.failed, notApplicable: aos.notApplicable, aplican: aos.applicable },
			{ passed: 7, failed: 0, notApplicable: 1, aplican: 7 },
			"el `n_a` se cuenta aparte y no entra en el denominador",
		);
		assert.equal(aos.earnedWeight, aos.maxWeight);
		assert.equal(aos.percent, audit.subScores.aos);
		assert.equal(aps.percent, audit.subScores.aps);
		assert.equal(aps.applicable, 3, "los tres checks de APS aplican a este tipo de negocio");
	});

	it("el peso es el del motor, no un porcentaje recalculado acá", () => {
		// 16 y 7 son los denominadores reales del rubric para `brand` (MUST=3, SHOULD=2). Si alguien
		// reimplementara los pesos en el popup, este test seguiría pasando solo por casualidad.
		assert.equal(audit.breakdown[0].maxWeight, 16);
		assert.equal(audit.breakdown[1].maxWeight, 7);
	});

	it("NO inventa los cinco niveles de la extensión vieja: ese rubric no se corre acá", () => {
		const json = JSON.stringify(audit.breakdown);
		for (const clave of [
			"inventory",
			"declaration_level1",
			"dom_executability_level2",
			"programmatic_execution_level3",
			"reliability",
		]) {
			assert.equal(json.includes(clave), false, `no se puede fabricar el nivel ${clave}`);
		}
		assert.equal(audit.breakdown.length, 2, "son dos ejes, no cinco niveles");
	});

	it("un desglose roto que venga de la red no rompe el popup", () => {
		const roto = mapBreakdown([{ axis: "OTRO" }, { axis: "AOS", percent: 999, passed: -3 }, null, "x", undefined]);
		assert.equal(roto.length, 1, "solo sobrevive el eje que existe");
		assert.equal(roto[0].percent, 100, "el porcentaje se acota");
		assert.equal(roto[0].passed, 0, "un conteo negativo es 0, no un número raro");
		assert.deepEqual(mapBreakdown(undefined), []);
		assert.deepEqual(mapBreakdown("no es un array"), []);
	});
});

describe("el badge Agent-Preferred", () => {
	it("aparece con la firma verificada, con la etiqueta y el texto de la marca", () => {
		const aps = mapAuditResponse(COMPLETO).aps;
		assert.equal(aps.signatureVerified, true);
		assert.deepEqual(aps.badge, { label: BADGE_LABEL, text: BADGE_VERIFIED_TEXT });
		assert.equal(BADGE_LABEL, "Agent-Preferred");
	});

	it("no aparece si el sitio no publica perfil firmado", () => {
		assert.equal(mapAuditResponse(SIN_PERFIL).aps.badge, null);
	});

	it("no aparece si publica perfil pero la firma no verifica", () => {
		const aps = mapAps({ declaredAps: 40, claims: 2, signatureVerified: false });
		assert.equal(aps.published, true, "el perfil está");
		assert.equal(aps.badge, null, "pero el badge no: publicar no es verificar");
	});

	it("solo con `true` de verdad, no con algo que se le parezca", () => {
		for (const signatureVerified of [undefined, null, false, 0, "true", 1, {}]) {
			assert.equal(
				mapAps({ declaredAps: 40, claims: 2, signatureVerified }).badge,
				null,
				`signatureVerified=${JSON.stringify(signatureVerified)} no habilita el badge`,
			);
		}
	});

	it("el texto que afirma la verificación solo existe cuando la firma verifica", () => {
		for (const signatureVerified of [undefined, false]) {
			const aps = mapAps({ declaredAps: 40, claims: 2, signatureVerified });
			assert.equal(aps.badge, null);
			assert.equal(/firmado verificado/.test(aps.signatureText), false);
		}
	});
});

describe("el Bot Beacon", () => {
	it("declara el hueco: BeAOS no tiene la fuente y no la simula", () => {
		assert.equal(COMPLETO.botBeacon, null, "el endpoint manda null: no tiene de dónde sacarlo");
		const audit = mapAuditResponse(COMPLETO);
		assert.equal(audit.botBeacon, null);
		assert.equal(audit.botBeaconText, BOT_BEACON_NO_SOURCE_TEXT);
		assert.match(audit.botBeaconText, /no lo inventamos/);
		assert.equal(/\d/.test(audit.botBeaconText), false, "el texto del hueco no lleva ningún número");
	});

	it("un beacon vacío o roto se lee como 'sin dato', nunca como cero agentes", () => {
		for (const raw of [undefined, null, {}, 0, "x", [], { crawlHits: 0, operationAttempts: 0 }]) {
			assert.equal(mapBotBeacon(raw), null, `${JSON.stringify(raw)} no es un beacon`);
		}
	});

	it("si algún día hay fuente, la línea dice lo mismo que decía la extensión vieja", () => {
		const beacon = mapBotBeacon({
			windowDays: 30,
			crawlHits: 412,
			distinctAgents: 3,
			operationAttempts: 7,
			operationFailures: 5,
			topAgents: [{ agentName: "GPTBot" }, { agentName: "Claude-User" }],
		});
		const texto = botBeaconText(beacon);
		assert.match(texto, /7 agentes intentaron operar este dominio, 5 fallaron \(30 d\)/);
		assert.match(texto, /412 hits de crawl · GPTBot, Claude-User/);
		assert.equal(botBeaconText(null), BOT_BEACON_NO_SOURCE_TEXT);
	});
});

describe("una respuesta vieja (contrato 2.0.0) no rompe el popup", () => {
	const viejo = mapAuditResponse(VIEJO);
	const nuevo = mapAuditResponse(COMPLETO);

	it("el fixture viejo de verdad no trae ninguno de los campos nuevos", () => {
		for (const campo of ["aosStandards", "apsStandards", "breakdown", "botBeacon"]) {
			assert.equal(campo in VIEJO, false, `${campo} no existía en el contrato 2.0.0`);
		}
	});

	it("mapea igual que siempre: score, banda, listado completo y perfil", () => {
		assert.equal(viejo.score, 100);
		assert.equal(viejo.band.raw, "Agent-Operable");
		assert.equal(viejo.band.label, "Operable");
		assert.equal(viejo.scored.length, 11);
		assert.equal(viejo.diagnostics.length, 8);
		assert.equal(viejo.aps.published, true);
		assert.equal(viejo.aps.signatureVerified, true);
	});

	it("los campos nuevos quedan vacíos en vez de inventarse", () => {
		assert.equal(viejo.subScores, null, "sin sub-scores en la respuesta, no hay sub-scores");
		assert.deepEqual(viejo.breakdown, [], "y el bloque de ejes no se muestra");
		assert.equal(viejo.botBeacon, null);
		assert.equal(viejo.botBeaconText, BOT_BEACON_NO_SOURCE_TEXT);
	});

	it("el badge ya funcionaba: `signatureVerified` existía desde la 2.0.0", () => {
		assert.deepEqual(viejo.aps.badge, { label: BADGE_LABEL, text: BADGE_VERIFIED_TEXT });
	});

	it("todo lo que ya existía sale idéntico al de la respuesta nueva", () => {
		// La prueba de que los campos agregados son aditivos: sobre la MISMA respuesta real, el mapeo
		// de todo lo viejo no cambió ni un carácter. (`auditedAt` queda afuera: cambia con la captura.)
		for (const campo of ["url", "score", "band", "businessType", "scored", "diagnostics", "aps", "counts", "plan"]) {
			assert.deepEqual(viejo[campo], nuevo[campo], `el campo ${campo} cambió con el contrato nuevo`);
		}
	});

	it("si el endpoint devolviera SOLO el desglose, tampoco rompe", () => {
		const soloDesglose = mapAuditResponse({
			requirements: [],
			breakdown: [{ axis: "AOS", percent: 50, passed: 1, failed: 1, notApplicable: 0, applicable: 2 }],
		});
		assert.equal(soloDesglose.subScores, null);
		assert.equal(soloDesglose.breakdown.length, 1);
		assert.equal(soloDesglose.breakdown[0].maxWeight, 0, "sin pesos se muestra el número, sin barra");
	});
});
