// Service worker de BeAOS: recibe el pedido del popup e inyecta el overlay en la pestaña.
// Dos pasos: (1) inyecta el archivo que define window.__aosRenderOverlay (idempotente),
// (2) lo invoca con la data del audit. Usa activeTab+scripting (sin host_permissions
// amplios): solo puede inyectar en la pestaña que el usuario tiene activa al pedirlo.
//
// El overlay no cambió con el rebautizo: content-overlay.js es el mismo archivo que servía
// la extensión de Maasy, byte por byte. Sigue evaluando el DOM en el cliente y solo usa
// `score` y `band` del audit, que son los dos campos que el endpoint de BeAOS conserva.
chrome.runtime.onMessage.addListener((msg) => {
	if (msg.type !== "show-overlay" || !msg.tabId) return;
	chrome.scripting
		.executeScript({ target: { tabId: msg.tabId }, files: ["content-overlay.js"] })
		.then(() =>
			chrome.scripting.executeScript({
				target: { tabId: msg.tabId },
				func: (audit) => window.__aosRenderOverlay?.(audit),
				args: [msg.audit],
			}),
		)
		.catch(() => {
			// páginas restringidas (chrome://, web store) no permiten inyección — se ignora
		});
});
