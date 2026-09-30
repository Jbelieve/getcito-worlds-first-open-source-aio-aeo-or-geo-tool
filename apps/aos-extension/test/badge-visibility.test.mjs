// El pill del badge vacío: el caso que este archivo cuida para que no vuelva.
//
// `popup.js` apaga el badge con la clase `hidden` cuando el sitio no publica perfil firmado
// (`aps.badge === null`), y lo muestra cuando la firma Ed25519 verifica. Eso es JavaScript y se prueba
// en `lib.test.mjs`. Lo que **no** se probaba era la otra mitad: que `.hidden` de verdad gane sobre el
// `display` propio de cada bloque.
//
// Y no ganaba. `.badge { display: inline-flex }` estaba después de `.hidden { display: none }` en
// `popup.css` y con la misma especificidad —una clase contra una clase— gana el que aparece más
// abajo. Resultado: en el resultado sin perfil publicado quedaba un pill vacío de 20px, que no es
// cosmético — parece un badge que no cargó y contradice el criterio (AOS-VISTA.md §3.5: sin perfil
// publicado no hay badge).
//
// Así que acá no se busca `display: none` en el archivo: se **resuelve la cascada** sobre el
// `popup.css` real y se pregunta qué `display` le toca a cada elemento, que es lo que haría el
// navegador. Es la clase de test que falla si alguien vuelve a mover la regla, que es exactamente lo
// que pasó.
//
// (El navegador de verdad se comprueba aparte, con las capturas de los dos casos: acá el motor de
// cascada es el mínimo que necesita este archivo —selectores de clase, sin `@media` ni `:hover`—, y
// se declara así para que nadie crea que esto reemplaza a mirarlo.)
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const EXT = new URL("../", import.meta.url);
const read = (name) => readFileSync(new URL(name, EXT), "utf8");

const CSS = read("popup.css");
const POPUP_HTML = read("popup.html");
const POPUP_JS = read("popup.js");

/**
 * Las reglas del archivo, en orden de aparición y con los comentarios ya sacados.
 *
 * Solo se interpretan selectores de **clase** (`.a`, `.a.b`): los que llevan `#`, `:hover`, `[attr]`
 * o descendencia no matchean ninguno de los elementos de este test, así que se saltean en vez de
 * fingir que se los entiende. Las at-rules (`@font-face`, `@keyframes`) se saltean enteras.
 */
function parseRules(css) {
	const limpio = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	const re = /([^{}]+)\{([^{}]*)\}/g;
	let match = re.exec(limpio);
	let order = 0;
	while (match !== null) {
		const selector = match[1].trim();
		const declaraciones = match[2];
		if (selector.startsWith("@") === false && selector.length > 0) {
			const display = readDisplay(declaraciones);
			rules.push({ selector, display, order });
			order += 1;
		}
		match = re.exec(limpio);
	}
	return rules;
}

/** El valor de `display` de un bloque, con su `!important`. `null` si el bloque no lo declara. */
function readDisplay(declaraciones) {
	for (const declaracion of declaraciones.split(";")) {
		const [propiedad, ...resto] = declaracion.split(":");
		if (propiedad?.trim() !== "display") continue;
		const crudo = resto.join(":").trim();
		return { value: crudo.replace(/!important\s*$/, "").trim(), important: /!important\s*$/.test(crudo) };
	}
	return null;
}

/** Las clases de un selector de clase puro (`.a.b`), o `null` si no es uno. */
function classSelector(selector) {
	if (/^\.[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)*$/.test(selector) === false) return null;
	return selector
		.slice(1)
		.split(".")
		.filter((name) => name.length > 0);
}

/** ¿Este selector matchea un elemento con estas clases? Solo los de clase pura. */
function matches(selector, classList) {
	const names = classSelector(selector);
	if (names === null) return false;
	return names.every((name) => classList.includes(name));
}

const RULES = parseRules(CSS);

/**
 * El `display` que gana para un elemento con estas clases, resolviendo la cascada como el navegador:
 * `!important` primero, después especificidad (cantidad de clases) y después el orden en el archivo.
 * `null` cuando ninguna regla le declara `display`.
 */
function effectiveDisplay(classList) {
	let winner = null;
	for (const rule of RULES) {
		if (rule.display === null) continue;
		if (matches(rule.selector, classList) === false) continue;
		const candidate = {
			important: rule.display.important,
			specificity: classSelector(rule.selector)?.length ?? 0,
			order: rule.order,
			value: rule.display.value,
		};
		if (
			winner === null ||
			(candidate.important && winner.important === false) ||
			(candidate.important === winner.important &&
				(candidate.specificity > winner.specificity ||
					(candidate.specificity === winner.specificity && candidate.order > winner.order)))
		) {
			winner = candidate;
		}
	}
	return winner === null ? null : winner.value;
}

/** La lista de clases tal como la escribe el HTML, para un `id` dado. */
function classListFromHtml(id) {
	const etiqueta = new RegExp(`<[^>]*\\bid="${id}"[^>]*>`).exec(POPUP_HTML);
	assert.ok(etiqueta, `el HTML no tiene el id ${id}`);
	const clase = /\bclass="([^"]*)"/.exec(etiqueta[0]);
	assert.ok(clase, `el elemento ${id} no declara class`);
	return clase[1].split(/\s+/).filter((name) => name.length > 0);
}

/** El audit de un fixture, mapeado con el código de verdad (`lib.js`), sin reimplementar el mapeo. */
async function mappedFixture(name) {
	const { mapAuditResponse } = await import("../lib.js");
	return mapAuditResponse(JSON.parse(read(`test/fixtures/${name}.json`)));
}

/**
 * Las clases finales del badge, tal como las deja `renderBadge`: arranca con las del HTML y saca
 * `hidden` solo cuando hay badge. La decisión (`aps.badge === null`) es la del mapeo real.
 */
function badgeClassesAfterRender(aps) {
	const classes = classListFromHtml("badge");
	if (aps.badge === null) return classes;
	return classes.filter((name) => name !== "hidden");
}

describe("todo lo que arranca oculto en el HTML computa `display: none`", () => {
	/** Los elementos con `hidden` en el HTML: si uno define su propio `display`, el orden decide. */
	const ocultos = [...POPUP_HTML.matchAll(/\bclass="([^"]*\bhidden\b[^"]*)"/g)].map((m) =>
		m[1].split(/\s+/).filter((name) => name.length > 0),
	);

	it("el HTML tiene bloques que arrancan ocultos (si no, este test no probaría nada)", () => {
		assert.ok(ocultos.length >= 5, `esperaba varios bloques con hidden, encontré ${ocultos.length}`);
	});

	for (const classes of ocultos) {
		it(`.${classes.join(".")} → display: none`, () => {
			assert.equal(
				effectiveDisplay(classes),
				"none",
				`${classes.join(".")}: una regla con más orden pisa al .hidden y el bloque queda a la vista`,
			);
		});
	}

	it("`.hidden` va después de toda regla que declare `display`", () => {
		// La condición que hace que el empate se resuelva bien, dicha como propiedad del archivo.
		const posicion = (selector) => RULES.filter((r) => r.selector === selector).map((r) => r.order);
		const hidden = posicion(".hidden");
		assert.equal(hidden.length, 1, ".hidden tiene que existir una sola vez");
		const conDisplay = RULES.filter(
			(r) => r.selector !== ".hidden" && r.display !== null && classSelector(r.selector) !== null,
		).map((r) => r.order);
		assert.ok(
			conDisplay.every((order) => order < hidden[0]),
			"hay una regla con `display` después de .hidden: esa gana el empate y el bloque no se oculta",
		);
	});

	it("sin `!important`: el empate se resuelve por orden, no por fuerza bruta", () => {
		for (const rule of RULES) {
			assert.equal(rule.display?.important ?? false, false, `${rule.selector} usa !important en display`);
		}
	});
});

describe("el badge: sin perfil firmado no queda nada visible", () => {
	it("`popup.js` apaga el badge con `.hidden` cuando `aps.badge` es null", () => {
		// El candado del otro lado del contrato: si el popup dejara de usar `.hidden`, esto avisa.
		assert.match(POPUP_JS, /if \(aps\.badge === null\) \{[\s\S]{0,120}?el\.classList\.add\("hidden"\)/);
		assert.match(POPUP_JS, /el\.classList\.remove\("hidden"\)/);
	});

	it("sin perfil publicado (`audit-sin-perfil.json`) el badge no se ve", async () => {
		const audit = await mappedFixture("audit-sin-perfil");
		assert.equal(audit.aps.badge, null, "sin perfil firmado no hay badge en el modelo");
		const classes = badgeClassesAfterRender(audit.aps);
		assert.ok(classes.includes("hidden"), "el badge tiene que quedar con la clase hidden");
		assert.equal(effectiveDisplay(classes), "none");
	});

	it("con `signatureVerified: true` el badge sí se ve", async () => {
		const audit = await mappedFixture("audit-believe-global");
		assert.notEqual(audit.aps.badge, null, "con la firma verificada tiene que haber badge");
		const classes = badgeClassesAfterRender(audit.aps);
		assert.equal(classes.includes("hidden"), false, "el badge no puede quedar oculto");
		assert.equal(effectiveDisplay(classes), "inline-flex");
	});

	it("el caso de la respuesta vieja (contrato 2.0.0) se comporta igual", async () => {
		const audit = await mappedFixture("audit-contrato-2.0.0");
		const classes = badgeClassesAfterRender(audit.aps);
		assert.equal(effectiveDisplay(classes), "inline-flex");
	});
});
