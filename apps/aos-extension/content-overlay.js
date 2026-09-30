// Overlay "lo que ve un agente": anota EN VIVO el DOM real de la página con lo que
// un agente de IA puede (verde) vs no puede (rojo) operar. Evalúa el DOM directo
// (más fiel que confiar en el audit del servidor) y usa el score/band pasado para
// el panel resumen. Idempotente: define la función y limpia lo previo al re-render.
(() => {
  const NS = "__aos_overlay__";
  let marked = []; // elementos anotados, en orden — para navegar entre ellos
  let navIdx = 0;
  const BAND_COLOR = {
    "Agent-Operable": "#34d399",
    "Agent-Attemptable": "#fbbf24",
    "Agent-Blocked": "#fb923c",
    "Agent-Inert": "#f87171",
  };

  function clear() {
    document.querySelectorAll(`.${NS}`).forEach((n) => n.remove());
    document.querySelectorAll(`[data-${NS}]`).forEach((n) => {
      n.style.outline = "";
      n.removeAttribute(`data-${NS}`);
    });
    marked = [];
    navIdx = 0;
  }

  /** Lleva el elemento i-ésimo al centro de la pantalla y le da un pulso para que
   * el usuario VEA qué encontró el agente (sin esto, si está bajo el fold parece
   * que no pasó nada). */
  function goTo(i) {
    if (!marked.length) return;
    navIdx = ((i % marked.length) + marked.length) % marked.length;
    const el = marked[navIdx];
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.animate(
      [{ boxShadow: "0 0 0 0 rgba(0,169,255,.7)" }, { boxShadow: "0 0 0 12px rgba(0,169,255,0)" }],
      { duration: 700 }
    );
  }

  /** ¿Este form es operable por un agente sin fricción? submit visible, sin captcha,
   * con al menos un campo editable. Mismo criterio que el motor AOS. */
  function formOperable(form) {
    const hasSubmit = !!form.querySelector(
      'button[type="submit"], input[type="submit"], button:not([type])'
    );
    const captcha = /recaptcha|hcaptcha|turnstile/i.test(form.innerHTML);
    const fields = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
    ).length;
    return { operable: hasSubmit && !captcha && fields > 0, hasSubmit, captcha, fields };
  }

  function tag(el, color, label) {
    if (!el || el.getAttribute(`data-${NS}`)) return;
    const rect = el.getBoundingClientRect();
    if (rect.width < 8 || rect.height < 8) return; // ocultos / colapsados
    el.setAttribute(`data-${NS}`, "1");
    el.style.outline = `2px solid ${color}`;
    el.style.outlineOffset = "1px";
    const badge = document.createElement("div");
    badge.className = NS;
    badge.textContent = label;
    Object.assign(badge.style, {
      position: "absolute",
      zIndex: 2147483646,
      left: `${rect.left + window.scrollX}px`,
      top: `${rect.top + window.scrollY - 20}px`,
      background: color,
      color: "#06122b",
      font: "600 11px/1.4 -apple-system,Segoe UI,Roboto,sans-serif",
      padding: "1px 7px",
      borderRadius: "5px",
      pointerEvents: "none",
      boxShadow: "0 2px 8px rgba(0,0,0,.3)",
    });
    document.body.appendChild(badge);
    marked.push(el);
  }

  function panel(audit, counts) {
    const color = BAND_COLOR[audit.band] || "#8fa0cc";
    const p = document.createElement("div");
    p.className = NS;
    Object.assign(p.style, {
      position: "fixed",
      top: "16px",
      right: "16px",
      zIndex: 2147483647,
      width: "260px",
      background: "#0a1230",
      color: "#eaf0ff",
      border: "1px solid #23306e",
      borderRadius: "14px",
      padding: "14px 16px",
      font: "13px/1.5 -apple-system,Segoe UI,Roboto,sans-serif",
      boxShadow: "0 10px 40px rgba(0,0,0,.5)",
    });
    p.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <span style="font-weight:700;background:linear-gradient(90deg,#00a9ff,#7cc9ff);-webkit-background-clip:text;background-clip:text;color:transparent">AOS™ · lo que ve un agente</span>
        <span class="${NS}-x" style="cursor:pointer;color:#8fa0cc;font-size:16px">✕</span>
      </div>
      <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px">
        <span style="font-size:28px;font-weight:700">${audit.score ?? 0}</span>
        <span style="color:${color};font-weight:600">${audit.band || ""}</span>
      </div>
      <div style="display:grid;gap:4px;font-size:12px;color:#c7d3f5">
        <div><span style="color:#34d399">■</span> ${counts.op} acción(es) operable(s)</div>
        <div><span style="color:#f87171">■</span> ${counts.blocked} bloqueada(s) para un agente</div>
      </div>
      ${
        marked.length
          ? `<button class="${NS}-nav" style="margin-top:10px;width:100%;border:none;border-radius:9px;padding:8px;cursor:pointer;font:600 12px inherit;background:linear-gradient(90deg,#0c3bb9,#00a9ff);color:#fff">Ir a la acción <span class="${NS}-pos">1</span>/${marked.length} ▸</button>`
          : `<div style="margin-top:10px;font-size:12px;color:#fbbf24">No se detectaron acciones operables en esta página.</div>`
      }
      <div style="margin-top:10px;font-size:11px;color:#8fa0cc">Verde = un agente puede ejecutarlo. Rojo = choca (captcha, sin submit, JS-only). Ámbar = widget de tercero.</div>`;
    p.querySelector(`.${NS}-x`).addEventListener("click", clear);
    const nav = p.querySelector(`.${NS}-nav`);
    if (nav) {
      nav.addEventListener("click", () => {
        goTo(navIdx + 1);
        p.querySelector(`.${NS}-pos`).textContent = String(navIdx + 1);
      });
    }
    document.body.appendChild(p);
  }

  /** Dominio registrable aproximado (maneja ccTLD de 2 niveles tipo .com.co). */
  function regDomain(host) {
    const parts = host.split(".");
    const twoLevel = /\.(com|co|org|net|gov|edu)\.[a-z]{2}$/i.test(host);
    return parts.slice(twoLevel ? -3 : -2).join(".");
  }

  window.__aosRenderOverlay = function (audit) {
    clear();
    const counts = { op: 0, blocked: 0 };

    document.querySelectorAll("form").forEach((form) => {
      const f = formOperable(form);
      if (f.operable) {
        counts.op++;
        tag(form, "#34d399", "✓ operable");
      } else {
        counts.blocked++;
        const why = f.captcha ? "captcha" : !f.hasSubmit ? "sin submit" : f.fields === 0 ? "sin campos" : "no operable";
        tag(form, "#f87171", `✗ ${why}`);
      }
    });

    // Acciones de contacto (WhatsApp/mailto/tel/sms): un agente puede iniciarlas → verdes.
    document
      .querySelectorAll('a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href^="mailto:"], a[href^="tel:"], a[href^="sms:"]')
      .forEach((a) => {
        counts.op++;
        const kind = a.href.startsWith("mailto:")
          ? "email"
          : a.href.startsWith("tel:")
            ? "teléfono"
            : a.href.startsWith("sms:")
              ? "sms"
              : "whatsapp";
        tag(a, "#34d399", `✓ ${kind}`);
      });

    // Iframes: widgets embebidos (agendar llamada, booking). Un iframe a un
    // subdominio PROPIO (maas.believe-global.com/book) es una acción operable:
    // el agente navega a esa URL y opera ahí. Un iframe de tercero (Calendly) es
    // cross-origin — el agente no puede operarlo DENTRO del iframe, aunque sí
    // podría navegar a su URL. Por eso: propio = verde, tercero = ámbar.
    const pageHost = location.hostname.replace(/^www\./, "");
    document.querySelectorAll("iframe[src]").forEach((f) => {
      let host;
      try {
        host = new URL(f.src, location.href).hostname.replace(/^www\./, "");
      } catch {
        return;
      }
      if (!host) return;
      const booking = /calendl|cal\.com|tidycal|typeform|chilipiper|savvycal|\/book|agenda|schedul|reserv|cita/i.test(
        f.src
      );
      if (regDomain(host) === regDomain(pageHost)) {
        counts.op++;
        tag(f, "#34d399", booking ? "✓ reservar (operable)" : "✓ embebido operable");
      } else {
        // Tercero: informativo, no suma a operable ni a bloqueado.
        tag(f, "#fbbf24", booking ? "◆ reservar (widget tercero)" : "◆ widget de tercero");
      }
    });

    panel(audit, counts);
    // Lleva al usuario a la primera acción: sin esto, si está bajo el fold parece
    // que el overlay no hizo nada (feedback de George).
    if (marked.length) setTimeout(() => goTo(0), 150);
  };
})();
