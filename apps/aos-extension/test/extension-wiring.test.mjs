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
import { readFileSync } from "node:fs";
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
	it("es la versión 2.1.0 y se llama BeAOS", () => {
		assert.equal(MANIFEST.manifest_version, 3);
		assert.equal(MANIFEST.version, "2.1.0");
		assert.match(MANIFEST.name, /^BeAOS/);
		assert.equal(MANIFEST.name.length <= 45, true, "el nombre tiene que entrar en el campo de la store");
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

	it("el título del popup dice BeAOS", () => {
		assert.match(POPUP_HTML, /<title>BeAOS<\/title>/);
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
