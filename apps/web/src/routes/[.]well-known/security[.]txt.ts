/**
 * `/.well-known/security.txt` de BeAOS — RFC 9116.
 *
 * Faltaba, y era la misma incoherencia que el server-card: BeAOS genera este archivo para las marcas y no
 * lo publicaba para sí mismo. El contacto lo confirmó Jorge: `hola@believe-global.com`.
 *
 * No se usa `team@getcito.com`, que es lo único que aparecía en el repo: es del upstream, y publicar el
 * contacto de otro producto manda los avisos de vulnerabilidad de BeAOS a una empresa que no los atiende.
 *
 * Los puntos del nombre van escapados con corchetes por el mismo motivo que en el server-card: el router
 * los lee como separadores de segmento y sin escaparlos la ruta sería `/security/txt`.
 */
import { createFileRoute } from "@tanstack/react-router";

const CONTACT = "mailto:hola@believe-global.com";
const CANONICAL = "https://beaos.believe-global.com/.well-known/security.txt";

/**
 * RFC 9116 pide `Expires` a menos de un año. Se calcula, no se fija: una fecha escrita a mano convierte
 * el archivo en no vigente sin que nadie lo note, y un `security.txt` vencido se ignora.
 */
function expiresAt(now = new Date()): string {
	const expires = new Date(now);
	expires.setUTCDate(expires.getUTCDate() + 364);
	return expires.toISOString();
}

export const Route = createFileRoute("/.well-known/security.txt")({
	server: {
		handlers: {
			GET: () =>
				new Response(
					[
						`Contact: ${CONTACT}`,
						`Expires: ${expiresAt()}`,
						`Canonical: ${CANONICAL}`,
						// BeAOS habla español con su equipo y en inglés con quien reporta desde afuera.
						"Preferred-Languages: es, en",
						"",
					].join("\n"),
					{
						status: 200,
						headers: {
							"content-type": "text/plain; charset=utf-8",
							"cache-control": "public, max-age=3600",
						},
					},
				),
		},
	},
});
