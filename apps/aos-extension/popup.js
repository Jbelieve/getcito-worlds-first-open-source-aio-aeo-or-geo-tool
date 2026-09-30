// Popup de BeAOS: pide el audit del dominio de la pestaña activa al endpoint público y lo muestra
// completo. No arma nada de red acá — eso vive en lib.js, que es lo que se prueba con `node --test`.
//
// Tres reglas de render, heredadas de `apps/web/src/components/status-tone.tsx`:
//   1. El número del score va en ink: es un dato, no se pinta por lo que vale. El chip de al lado es
//      el que dice la banda, sobre la rampa azul.
//   2. Ningún estado depende solo del color: cada requisito lleva su glifo (✓ / ✕ / —) y su palabra.
//   3. El cian es la única señal y aparece dos veces: el subrayado del número grande y el próximo paso.
//
// Todo el texto de datos entra por `textContent`, nunca por `innerHTML`: parte de lo que se muestra
// (la evidencia, el título del requisito) lo escribe el sitio auditado.
import {
	auditErrorText,
	auditUrl,
	captureLead,
	domainFromUrl,
	getCachedAudit,
	mapAuditResponse,
	setCachedAudit,
} from "./lib.js";

const $ = (id) => document.getElementById(id);

/** Qué significa cada banda, en una línea. */
const SCORE_TAG = {
	"Agent-Operable": "Un agente puede operar este sitio casi sin fricción.",
	"Agent-Attemptable": "Un agente puede intentarlo, pero tropieza en partes.",
	"Agent-Blocked": "Un agente choca contra muros: casi nada es ejecutable.",
	"Agent-Inert": "Invisible para agentes. No hay acciones operables.",
};

const show = (id) => {
	for (const s of document.querySelectorAll(".state")) s.classList.add("hidden");
	$(id).classList.remove("hidden");
};

let currentDomain = null;
/** La respuesta CRUDA del endpoint. El overlay lee `score` y `band` de acá, tal como los manda
 * el servidor: el objeto mapeado tiene la banda como objeto y el overlay la espera como string. */
let rawAudit = null;
/** El audit mapeado, que es lo que muestra el popup. */
let lastAudit = null;

/** "18.8 puntos" / "1 punto". La ganancia es un peso del estándar y viene con decimales. */
function points(n) {
	return `${n} ${n === 1 ? "punto" : "puntos"}`;
}

/**
 * Una fila del listado: glifo, id, qué es, si pasa, la evidencia y —solo si los tiene— los puntos.
 * El orden es el que manda el endpoint, que es el orden del estándar: no se reordena para "quedar
 * mejor", porque el checklist es la referencia.
 */
function renderRequirement(r) {
	const li = document.createElement("li");
	li.className = `req req-${r.status}${r.diagnostic ? " req-diag" : ""}`;

	const glyph = document.createElement("span");
	glyph.className = `req-glyph tone-${r.tone}`;
	glyph.textContent = r.glyph;
	glyph.title = r.statusText;

	const body = document.createElement("div");

	const title = document.createElement("p");
	title.className = "req-title";
	const id = document.createElement("span");
	id.className = "req-id";
	id.textContent = r.id;
	title.append(id, document.createTextNode(r.title));

	const meta = document.createElement("p");
	meta.className = "req-meta";
	meta.textContent = [r.axis, r.strengthText, r.statusText].join(" · ");

	// La evidencia es lo que se vio al comprobar, y puede faltar. Cuando falta se dice que falta:
	// no se rellena con una frase inventada.
	const evidence = document.createElement("p");
	evidence.className = r.evidence === null ? "req-evidence is-empty" : "req-evidence";
	evidence.textContent = r.evidenceText;

	body.append(title, meta, evidence);

	if (r.gain !== null) {
		const gain = document.createElement("p");
		gain.className = "req-gain";
		gain.textContent = `Arreglarlo devuelve ${points(r.gain)}.`;
		body.append(gain);
	}

	li.append(glyph, body);
	return li;
}

/** El listado completo dentro de su <ul>, sin recortar nada. */
function renderList(elId, items) {
	$(elId).replaceChildren(...items.map(renderRequirement));
}

/** Perfil firmado: APS declarado, pruebas declaradas y si la firma verifica. */
function renderAps(audit) {
	const aps = audit.aps;
	// El eyebrow derecho dice si hay perfil; la línea grande, el número. Cuando no hay perfil se
	// escribe la frase en vez de un guion: "no publica" es el dato, no un valor faltante.
	$("aps-band").textContent = aps.published ? "APS declarado" : "sin perfil";
	const score = $("aps-score");
	score.textContent = aps.published ? `${aps.declaredAps}/100` : "Sin perfil firmado";
	score.className = aps.published ? "aps-score" : "aps-score aps-score--none";
	$("aps-claims").textContent = aps.claimsText ?? "";
	const sig = $("aps-sig");
	sig.className = `aps-sig tone-${aps.signatureTone}`;
	sig.textContent = aps.signatureText;
}

/** Aparición 2 del cian: el próximo paso, que es el arreglo que más puntos devuelve. */
function renderNext(audit) {
	const el = $("next");
	const top = audit.plan[0];
	if (top === undefined) {
		el.classList.add("hidden");
		return;
	}
	const eyebrow = document.createElement("p");
	eyebrow.className = "eyebrow";
	eyebrow.textContent = "Próximo paso";
	const title = document.createElement("p");
	title.className = "next-title";
	title.textContent = `${top.id} · ${top.title}`;
	const detail = document.createElement("p");
	detail.className = "next-detail";
	const failing = audit.counts.scoredFail;
	detail.textContent = `Arreglarlo devuelve ${points(top.gain)}. ${
		failing === 1 ? "Queda 1 requisito que puntúa en falta." : `Quedan ${failing} requisitos que puntúan en falta.`
	}`;
	el.replaceChildren(eyebrow, title, detail);
	el.classList.remove("hidden");
}

/** Fecha de la medición, en hora local y corta. */
function auditedAtText(iso) {
	if (iso === null) return "";
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return "";
	const day = date.toLocaleDateString("es", { day: "2-digit", month: "2-digit", year: "numeric" });
	const time = date.toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });
	return `Medido el ${day} a las ${time}`;
}

function renderResult(audit) {
	lastAudit = audit;

	$("score").textContent = audit.score === null ? "—" : String(audit.score);
	const band = $("band");
	band.className = `chip tone--${audit.band.level}`;
	band.textContent = audit.band.label;
	$("score-tag").textContent = SCORE_TAG[audit.band.raw] ?? "";
	$("business-type").textContent = audit.businessType;
	$("audited-at").textContent = auditedAtText(audit.auditedAt);

	renderAps(audit);
	renderNext(audit);

	$("scored-count").textContent = `${audit.counts.scored} · ${audit.counts.scoredFail} en falta`;
	renderList("reqs", audit.scored);

	// Los diagnostic se informan y no mueven el score: van en su propio bloque, sin puntos.
	const diagBlock = $("diag-block");
	if (audit.diagnostics.length === 0) {
		diagBlock.classList.add("hidden");
	} else {
		$("diag-count").textContent = String(audit.counts.diagnostics);
		renderList("diags", audit.diagnostics);
		diagBlock.classList.remove("hidden");
	}

	// La tarjeta de captura arranca limpia en cada resultado.
	$("lead").classList.remove("hidden");
	$("lead-thanks").classList.add("hidden");
	$("lead-error").classList.add("hidden");
	$("email-input").value = "";
	$("email-input").classList.remove("is-bad");
	show("result");
}

function renderError(status, retryAfterSeconds) {
	const text = auditErrorText(status, retryAfterSeconds);
	$("error-title").textContent = text.title;
	$("error-msg").textContent = text.detail;
	show("error");
}

async function runAudit(force) {
	show("loading");
	if (force === false) {
		const cached = await getCachedAudit(currentDomain);
		// El caché guarda la respuesta CRUDA del endpoint, no la mapeada: si cambia el mapeo, el caché
		// viejo se vuelve a mapear con el código nuevo en vez de quedar con la forma vieja.
		if (cached) {
			rawAudit = cached;
			return renderResult(mapAuditResponse(cached));
		}
	}
	// Medir es gratis y no pide mail: el lead se captura aparte, y es opcional.
	const res = await auditUrl(currentDomain);
	if (res.ok) {
		rawAudit = res.data;
		await setCachedAudit(currentDomain, res.data);
		return renderResult(mapAuditResponse(res.data));
	}
	console.warn("[BeAOS] audit no exitoso:", res.status, res.error);
	renderError(res.status, res.retryAfterSeconds);
}

async function init() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	currentDomain = domainFromUrl(tab?.url);
	if (currentDomain === null) return show("notweb");
	$("domain").textContent = currentDomain;
	$("domain").title = tab.url;
	runAudit(false);
}

// --- eventos ---

$("retry").addEventListener("click", () => runAudit(true));

$("overlay-btn").addEventListener("click", async () => {
	if (!rawAudit) return;
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
	if (tab?.id) chrome.runtime.sendMessage({ type: "show-overlay", tabId: tab.id, audit: rawAudit });
	window.close();
});

/** Captura de lead: opcional, y manda el contexto del audit que el usuario está viendo. */
async function submitLead() {
	const input = $("email-input");
	const email = input.value.trim();
	if (email.includes("@") === false) {
		input.classList.add("is-bad");
		return;
	}
	input.classList.remove("is-bad");
	const btn = $("lead-submit");
	btn.disabled = true;
	btn.textContent = "Enviando…";
	const sent = await captureLead({
		email,
		url: lastAudit?.url ?? currentDomain,
		score: typeof lastAudit?.score === "number" ? lastAudit.score : undefined,
	});
	btn.disabled = false;
	btn.textContent = "Enviar";
	if (sent === false) {
		$("lead-error").classList.remove("hidden");
		return;
	}
	$("lead").classList.add("hidden");
	$("lead-thanks").classList.remove("hidden");
}

$("lead-submit").addEventListener("click", submitLead);
$("email-input").addEventListener("keydown", (e) => e.key === "Enter" && submitLead());

// Los enlaces del popup son <a href> de verdad, con `target="_blank"`, así que los abre el navegador
// y no hacen falta manejadores acá. Las URLs viven en lib.js (BEAOS_URL, STANDARD_REPO_URL,
// BELIEVE_HOME) y el test de cableado verifica que el HTML diga exactamente las mismas.

init();
