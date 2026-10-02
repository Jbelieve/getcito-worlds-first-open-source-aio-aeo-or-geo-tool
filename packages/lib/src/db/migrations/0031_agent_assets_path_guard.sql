-- La guarda de forma de `agent_assets.path`, en la base.
--
-- El agujero que cierra: `path` era `text NOT NULL` sin `CHECK`, y `buildBundle()` metía las filas al
-- bundle tal cual. Una fila con `/wp-login.php` —de un refactor, un seed, un import o un `INSERT` a
-- mano— llegaba al sitio del cliente y **tapaba la pantalla de login** (medido en un WordPress real:
-- 66 B del señuelo en lugar de los 10.098 B del login).
--
-- La regla no se escribe acá: sale de `packages/aos-aps/src/assets/kit-routes.ts`, que es la definición
-- única, y la escribe `drizzle-kit` desde `packages/aos-aps/src/db/schema.ts`. Los cinco archivos de la
-- raíz, el prefijo de `/.well-known/`, el tope de largo, el juego de caracteres y el sufijo `.php` son
-- constantes de ese archivo.
--
-- Por qué `NOT VALID`, y qué pasa después:
--
--   * Una fila vieja que no pase la guarda haría fallar el `ALTER TABLE`, y con él el despliegue. Eso
--     sería cambiar un bug por una caída, justo lo que el bundle ya evita al saltar la ruta mala.
--   * `NOT VALID` aplica igual y **sí** se hace cumplir para todo `INSERT` y `UPDATE` nuevo, que es el
--     camino que nos importa: la aplicación solo inserta.
--   * El bloque de abajo intenta `VALIDATE CONSTRAINT`. Si las filas existentes pasan (lo esperado),
--     la restricción queda validada del todo, retroactivamente. Si alguna no pasa, el despliegue sigue
--     y queda un `WARNING` en el log con el comando exacto para terminarlo a mano.

ALTER TABLE "agent_assets" ADD CONSTRAINT "agent_assets_path_shape" CHECK ("agent_assets"."path" ~ '^/[A-Za-z0-9._/-]+$' AND length("agent_assets"."path") <= 256 AND position('..' in "agent_assets"."path") = 0 AND lower("agent_assets"."path") !~ '\.php$' AND ("agent_assets"."path" IN ('/llms.txt', '/llms-full.txt', '/AGENTS.md', '/robots.txt', '/sitemap.xml') OR "agent_assets"."path" LIKE '/.well-known/_%')) NOT VALID;--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "agent_assets" VALIDATE CONSTRAINT "agent_assets_path_shape";
	RAISE NOTICE 'agent_assets: las filas existentes pasan la guarda de forma; el CHECK quedo VALIDADO.';
EXCEPTION WHEN check_violation THEN
	RAISE WARNING 'agent_assets: hay filas existentes que NO pasan la guarda de forma. El CHECK queda NOT VALID: se aplica a toda escritura nueva, pero las filas viejas siguen ahi (el bundle ya no las sirve y las anota en el log). Para terminarlo: borrar o corregir esas rutas y correr ALTER TABLE "agent_assets" VALIDATE CONSTRAINT "agent_assets_path_shape";';
END $$;
