// Candados de la extensión: lo que la misión pide que sea cierto del paquete y que es fácil de
// romper sin darse cuenta. Son static checks, no de comportamiento — pero cada uno cuida una regla
// que alguien pidió explícitamente:
//
//   · que no quede ninguna credencial ni host de Maasy/Supabase en lo que se publica,
//   · que el manifest sea 2.1.0 y hable con BeAOS,
//   · que el overlay siga estando y sin dependencias del servidor,
//   · que el popup no le pida al DOM un id que el HTML no tiene (el clásico error de vanilla JS,
//     que no lo agarra ningún compilador porque no hay compilador).
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXT = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, EXT), "utf8");

const MANIFEST = JSON.parse(read("manifest.json"));
const LIB = read("lib.js");
const POPUP_JS = read("popup.js");
const POPUP_HTML = read("popup.html");
const BACKGROUND = read("background.js");
const OVERLAY = read("content-overlay.js");
/** Lo que de verdad viaja al usuario: el zip lleva estos archivos y nada más. */
const PUBLICADOS = [
	"manifest.json",
	"background.js",
	"lib.js",
	"content-overlay.js",
	"popup.html",
	"popup.css",
	"popup.js",
];

describe("manifest", () => {
	it("es la versión 2.2.0 y se llama BeAOS by Believe", () => {
		assert.equal(MANIFEST.manifest_version, 3);
		assert.equal(MANIFEST.version, "2.2.0");
		// El nombre es el lockup en texto plano: `BeAOS by Believe`. El manifest no renderiza, así que
		// acá no hay «e» girada ni punto cian — eso vive en el popup. El descriptor que sigue al guion
		// es lo único que se recortó, para que el nombre entre en el campo de 45 de la store.
		assert.match(MANIFEST.name, /^BeAOS by Believe/);
		assert.equal(MANIFEST.name.length <= 45, true, "el nombre tiene que entrar en el campo de la store");
	});

	it("el tooltip del icono también dice el lockup, y en texto plano", () => {
		assert.equal(MANIFEST.action.default_title, "BeAOS by Believe");
	});

	it("explica las dos cosas: AOS y APS", () => {
		assert.match(MANIFEST.description, /AOS/);
		assert.match(MANIFEST.description, /APS/);
		assert.equal(MANIFEST.description.length <= 132, true, "el resumen tiene que entrar en la store");
	});

	it("solo habla con BeAOS: ni Supabase ni host de más", () => {
		assert.deepEqual(MANIFEST.host_permissions, ["https://beaos.believe-global.com/*"]);
	});

	it("pide los tres permisos mínimos y ninguno más", () => {
		assert.deepEqual([...MANIFEST.permissions].sort(), ["activeTab", "scripting", "storage"]);
	});
});

describe("sin credencial y sin rastro de Maasy en lo que se publica", () => {
	// Patrones precisos a propósito: se busca una credencial VIVA o un endpoint viejo, no la palabra
	// suelta. El comentario de lib.js que dice "sin apikey" documenta la ausencia y no es una fuga.
	const prohibido = [
		/supabase\.co/i,
		/esptwxlgdbblvnmdpoao/,
		/eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9/,
		/\bANON_KEY\s*[:=]/,
		/\bapikey\s*[:=]/i,
		/Authorization\s*:/,
		/Bearer\s/,
		/functions\/v1\//,
		/landing-lead-capture/,
	];

	for (const name of PUBLICADOS) {
		it(`${name} no lleva credenciales ni endpoints viejos`, () => {
			const source = read(name);
			for (const pattern of prohibido) {
				assert.equal(pattern.test(source), false, `${name} todavía menciona ${pattern}`);
			}
		});
	}

	it("los dos endpoints son los públicos de BeAOS", async () => {
		const { AUDIT_ENDPOINT, LEAD_ENDPOINT, BEAOS_API_URL } = await import("../lib.js");
		assert.equal(BEAOS_API_URL, "https://beaos.believe-global.com");
		assert.equal(AUDIT_ENDPOINT, "https://beaos.believe-global.com/api/v1/aos/audit");
		assert.equal(LEAD_ENDPOINT, "https://beaos.believe-global.com/api/v1/aos/lead");
	});

	it("separa el host de la web pública del host de la API: no son intercambiables", async () => {
		const { BEAOS_API_URL, BEAOS_WEB_URL } = await import("../lib.js");
		assert.equal(BEAOS_WEB_URL, "https://be-aos.believe-global.com");
		assert.equal(BEAOS_API_URL, "https://beaos.believe-global.com");
		assert.notEqual(BEAOS_WEB_URL, BEAOS_API_URL);
	});

	it("ningún enlace del popup apunta al host de la API, que redirige a /auth/login", async () => {
		const { BEAOS_API_URL, BEAOS_WEB_URL } = await import("../lib.js");
		for (const href of [...POPUP_HTML.matchAll(/href="([^"]+)"/g)].map((m) => m[1])) {
			assert.equal(
				href.startsWith(BEAOS_API_URL),
				false,
				`${href} es un enlace para el usuario y apunta a la app con sesión: tiene que ser ${BEAOS_WEB_URL}`,
			);
		}
	});

	it("el audit ya no manda el `source: extension` de la función de Maasy", () => {
		assert.equal(/source:\s*"extension"/.test(LIB), false);
	});
});

/**
 * Candado estático de los textos que ve el usuario: no pueden decir cosas falsas. Hay defectos que se
 * pueden reintroducir sin que ningún test de comportamiento chille —una constante con el cupo, una
 * frase que enumera lo que el guardián bloquea—, así que además del test de cada función queda esto:
 * lo que se publica no puede volver a decirlo.
 */
describe("los textos que ve el usuario no dicen cosas falsas", () => {
	it("el cupo no está hardcodeado: el número sale de `RateLimit-Limit`", () => {
		// `AUDITS_PER_DAY = 20` era el **default** del servidor, no el cupo: en el despliegue donde pasó
		// el incidente el cupo valía 200 y la persona leyó 20. Una constante del cliente acierta sólo
		// mientras nadie toque la env.
		assert.equal(
			/(AUDITS_PER_DAY|AUDITS_PER_IP)\s*[:=]/.test(LIB),
			false,
			"el cupo no puede ser una constante del cliente: tiene que salir de RateLimit-Limit",
		);
		assert.match(LIB, /RateLimit-Limit/, "y tiene que leer la cabecera que lo publica");
	});

	it("el texto del bloqueo no enumera lo que el guardián bloquea", () => {
		for (const name of PUBLICADOS) {
			assert.equal(
				/direcciones internas|metadatos de nube|localhost/i.test(read(name)),
				false,
				`${name}: nombrar lo que se bloquea le da un mapa a quien prueba y no le sirve a nadie más`,
			);
		}
		assert.match(LIB, /Esa dirección queda afuera por seguridad/, "y el texto canónico sigue ahí");
	});
});

describe("el overlay queda igual", () => {
	it("sigue existiendo, define la misma función global y no pide nada al servidor", () => {
		assert.match(OVERLAY, /window\.__aosRenderOverlay = function \(audit\)/);
		assert.equal(/fetch\(|XMLHttpRequest|chrome\./.test(OVERLAY), false, "el overlay evalúa en el cliente");
	});

	it("el service worker lo inyecta igual y le pasa el audit crudo", () => {
		assert.match(BACKGROUND, /files: \["content-overlay\.js"\]/);
		assert.match(BACKGROUND, /__aosRenderOverlay\?\.\(audit\)/);
	});

	it("el overlay recibe `band` como string: el popup le pasa la respuesta cruda, no la mapeada", () => {
		assert.match(OVERLAY, /BAND_COLOR\[audit\.band\]/);
		assert.match(POPUP_JS, /audit: rawAudit/);
		assert.equal(/audit: lastAudit/.test(POPUP_JS), false, "lastAudit tiene la banda como objeto y rompería el color");
	});
});

describe("el popup y el HTML están cableados", () => {
	const idsEnHtml = new Set([...POPUP_HTML.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
	const idsQuePide = new Set([...POPUP_JS.matchAll(/\$\("([^"]+)"\)/g)].map((m) => m[1]));
	/** Los id de los <a> con href real: esos los maneja el navegador, no el popup. */
	const idsDeEnlaces = new Set([...POPUP_HTML.matchAll(/<a\b[^>]*\bid="([^"]+)"[^>]*>/g)].map((m) => m[1]));

	it("el popup no le pide al DOM ningún id que el HTML no tenga", () => {
		const faltantes = [...idsQuePide].filter((id) => idsEnHtml.has(id) === false);
		assert.deepEqual(faltantes, []);
	});

	it("el HTML no tiene ids muertos: todo id lo usa el popup o es un enlace con href", () => {
		// No se busca `$("id")` sino el id citado en cualquier lugar: algunos viajan como literal en
		// `show("loading")` o en `renderList("reqs", …)`.
		const huerfanos = [...idsEnHtml].filter(
			(id) => POPUP_JS.includes(`"${id}"`) === false && idsDeEnlaces.has(id) === false,
		);
		assert.deepEqual(huerfanos, [], `ids del HTML que nadie usa: ${huerfanos.join(", ")}`);
	});

	it("los enlaces son enlaces de verdad, con href y target", () => {
		const enlaces = [...POPUP_HTML.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
		assert.equal(enlaces.length, 3, "son los tres de la tarjeta de contacto");
		for (const etiqueta of enlaces) {
			assert.match(etiqueta, /href="https:\/\//, `enlace sin href real: ${etiqueta}`);
			assert.match(etiqueta, /target="_blank"/);
			assert.match(etiqueta, /rel="noopener"/);
		}
	});

	it("las URLs del HTML son las mismas que declara lib.js", async () => {
		const { BEAOS_WEB_URL, STANDARD_REPO_URL, BELIEVE_HOME } = await import("../lib.js");
		for (const url of [BEAOS_WEB_URL, STANDARD_REPO_URL, BELIEVE_HOME]) {
			assert.ok(POPUP_HTML.includes(`href="${url}"`), `el HTML no apunta a ${url}`);
		}
	});

	it("el título del popup dice el lockup", () => {
		// El `<title>` es lo que Chrome muestra en la barra de tareas: es un nombre, no la marca
		// dibujada, así que va en texto plano — el mismo que el manifest.
		assert.match(POPUP_HTML, /<title>BeAOS by Believe<\/title>/);
	});
});

describe("el lockup de la marca", () => {
	const CSS = read("popup.css");
	/** El bloque de una regla, para poder afirmar sobre sus declaraciones y no sobre todo el archivo. */
	const bloque = (selector) => {
		const m = CSS.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
		assert.ok(m, `no encuentro la regla ${selector}`);
		return m[1];
	};

	it("el header es el lockup: BeAOS arriba y el wordmark en una línea aparte", () => {
		assert.match(POPUP_HTML, /class="lockup-name">BeAOS</);
		assert.match(POPUP_HTML, /class="lockup-conector">by</);
		// El wordmark no es texto plano: la última «e» va en su span y el punto cian es un círculo.
		assert.match(POPUP_HTML, /class="wordmark">Believ<span class="wordmark-e">e<\/span>/);
		assert.match(POPUP_HTML, /class="wordmark-dot"><\/span>/);
		// La «e» girada es la ÚLTIMA, no la «v»: el error clásico de este wordmark.
		assert.equal(/wordmark-e">v</.test(POPUP_HTML), false);
	});

	it("el wordmark no se mezcla: Fraunces 500, opsz 144 y el tracking del brandbook", () => {
		const wm = bloque(".wordmark");
		assert.match(wm, /font-family:\s*var\(--wordmark\)/);
		assert.match(wm, /font-weight:\s*500/);
		assert.match(wm, /font-variation-settings:\s*"opsz"\s*144/);
		assert.match(wm, /letter-spacing:\s*-0\.025em/);
		// La familia --wordmark tiene que ser Fraunces: reemplazarla por Inter es un anti-pattern.
		assert.match(CSS, /--wordmark:\s*"Fraunces Wordmark",\s*Fraunces/);
	});

	it("la última «e» gira -18° con el pivote del brandbook", () => {
		const e = bloque(".wordmark-e");
		assert.match(e, /rotate\(-18deg\)/);
		assert.match(e, /transform-origin:\s*50% 65%/);
		assert.match(e, /display:\s*inline-block/, "sin inline-block el transform no se aplica");
	});

	it("el punto cian: 0.25em de diámetro, 0.28em de separación, sobre la línea base", () => {
		const dot = bloque(".wordmark-dot");
		assert.match(dot, /width:\s*0\.25em/);
		assert.match(dot, /height:\s*0\.25em/);
		assert.match(dot, /margin-left:\s*0\.28em/);
		assert.match(dot, /border-radius:\s*50%/);
		assert.match(dot, /background:\s*var\(--cian\)/);
		assert.match(dot, /vertical-align:\s*baseline/);
	});

	it("el wordmark vive en azul Believe: nunca en negro", () => {
		for (const selector of [".lockup-name", ".wordmark"]) {
			assert.match(bloque(selector), /color:\s*var\(--azul\)/, `${selector} tiene que ir en azul Believe`);
			assert.equal(/color:\s*(#1a1a1a|var\(--ink\))/.test(bloque(selector)), false, `${selector} en tinta`);
		}
	});

	it("el wordmark no baja de 32px: la línea grande crece para que la chica quepa", () => {
		assert.match(bloque(".lockup-by"), /font-size:\s*32px/, "el wordmark tiene mínimo 32px");
		const grande = Number(bloque(".lockup-name").match(/font-size:\s*(\d+)px/)[1]);
		assert.ok(grande > 32, `BeAOS tiene que ser más grande que el wordmark, no ${grande}px`);
	});

	it("la fuente viaja empaquetada, con su licencia al lado y declarada con @font-face local", () => {
		assert.match(CSS, /@font-face\s*\{[^}]*font-family:\s*"Fraunces Wordmark"/);
		assert.match(CSS, /src:\s*url\("fonts\/fraunces-wordmark\.woff2"\)\s*format\("woff2"\)/);
		assert.equal(/fonts\.googleapis|fonts\.gstatic/.test(CSS + POPUP_HTML), false, "nada de Google Fonts");
		for (const f of ["fonts/fraunces-wordmark.woff2", "fonts/OFL.txt"]) {
			assert.equal(existsSync(new URL(f, EXT)), true, `falta ${f} en el repo`);
		}
		// Y viaja al zip: una extensión que declara un @font-face que el paquete no lleva se ve con
		// la tipografía equivocada sin que nada falle.
		const RELEASE = readFileSync(new URL("../../scripts/release-extension.sh", EXT), "utf8");
		assert.match(RELEASE, /^DIRS=\(icons fonts\)$/m, "el zip tiene que llevar fonts/");
	});
});

describe("paleta", () => {
	const CSS = read("popup.css");

	it("usa los seis tokens de la marca, copiados con su comentario canónico", () => {
		for (const hex of ["#fafaf7", "#0c3bb9", "#062778", "#00aaff", "#1a1a1a", "#6b6b65"]) {
			assert.ok(CSS.includes(hex), `falta el token ${hex}`);
		}
		assert.match(CSS, /apps\/web\/src\/styles\.css/, "tiene que apuntar al archivo canónico");
		assert.match(CSS, /status-tone\.tsx/, "tiene que apuntar a la fuente de la semántica");
	});

	it("no inventa un séptimo hex", () => {
		const encontrados = new Set([...CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()));
		const permitidos = new Set(["#fafaf7", "#0c3bb9", "#062778", "#00aaff", "#1a1a1a", "#6b6b65"]);
		const intrusos = [...encontrados].filter((hex) => permitidos.has(hex) === false);
		assert.deepEqual(intrusos, [], `hex fuera de la paleta: ${intrusos.join(", ")}`);
	});
});
