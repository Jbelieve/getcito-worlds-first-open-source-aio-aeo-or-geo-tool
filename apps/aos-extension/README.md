# BeAOS — Extensión de Chrome

Navegás cualquier sitio → un click → ves si un agente de IA **puede operarlo** (AOS™) y si además
**lo prefiere** (APS). Van dos cosas distintas y la extensión mide las dos: el AOS dice si un agente
puede llenar un formulario, reservar o completar una acción real; el APS dice qué declara el sitio
sobre sí mismo en su perfil firmado y si esa firma verifica.

Más el modo estrella, **"lo que ve un agente"**: anota sobre la página real, en verde y rojo, qué
acciones puede ejecutar un agente y cuáles no. Eso evalúa el DOM en el cliente y no depende del
servidor.

Manifest V3, vanilla JS, **sin build**: se carga descomprimida tal cual.

## Cómo cargarla (dev, unpacked)

1. Chrome → `chrome://extensions`
2. Activar **Modo de desarrollador** (arriba a la derecha)
3. **Cargar descomprimida** → elegir esta carpeta (`apps/aos-extension`)
4. Fijar el icono de BeAOS en la barra. Listo: abrí cualquier web y hacé clic en el icono.

## Cómo se prueba

Sin dependencias y sin navegador. **Node 24 o superior** (el mismo que pide el repo).

```bash
# Sintaxis: el equivalente de `tsc` para vanilla JS. Uno por archivo, en la raíz del repo.
for f in background.js lib.js content-overlay.js popup.js; do
  node --check "apps/aos-extension/$f"
done

# Las piezas puras: armar el request, mapear la respuesta, el texto de cada estado y de cada error.
node --test "apps/aos-extension/test/*.test.mjs"
```

El glob entre comillas va a propósito: la forma `node --test apps/aos-extension/test/` (el
directorio pelado) recién funciona en Node 24, y el glob también anda en Node 22. Si tu `node` dice
`Cannot find module '.../test'`, es eso.

Los fixtures de `test/fixtures/` son **respuestas reales del endpoint público**, capturadas en
producción: un sitio completo (`score` 100, perfil firmado, APS 94) y uno sin perfil
(`example.com`, `score` 0, con `n_a`, con `gain` y con diagnósticos sin evidencia). Los tests corren
contra eso, no contra lo que creemos que el endpoint devuelve.

## Cómo armar el zip de la release

```bash
bash scripts/release-extension.sh
```

Deja `dist/beaos-extension-<version>.zip` con **solo lo que va al paquete**: el manifest, los
archivos de la extensión y los íconos. Nada de tests, `store/`, markdown de desarrollo ni
`.DS_Store`. La versión sale del manifest, así que el nombre del zip no puede mentir, y el script
verifica que el `content-overlay.js` del zip sea idéntico al de esta carpeta antes de dar el OK.

`dist/` está en el `.gitignore`. **Publicar en la Chrome Web Store es un paso humano** desde el
[dev console](https://chrome.google.com/webstore/devconsole): el script deja el zip listo y no
publica.

## Arquitectura

| Archivo | Rol |
|---|---|
| `manifest.json` | MV3. Permisos mínimos: `activeTab` + `scripting` + `storage`, y un solo `host_permissions`: `https://beaos.believe-global.com/*` |
| `lib.js` | Config, endpoints, las funciones puras (request, mapeo, textos) y el storage |
| `popup.html` / `popup.css` / `popup.js` | El popup: score, banda, listado completo, perfil firmado, próximo paso y captura de lead |
| `background.js` | Service worker: inyecta el overlay en la pestaña activa a pedido |
| `content-overlay.js` | Modo "lo que ve un agente": anota el DOM real (verde/rojo) + panel resumen. **No se toca** |
| `test/` | Tests de las piezas puras con el runner de node |
| `store/` | Textos para el listado de la Chrome Web Store |

## Backend

Dos endpoints **públicos a propósito**, en `https://beaos.believe-global.com` (la API) y sin
credencial: sin token, sin sesión y sin apikey. Antes la extensión hablaba con Supabase (Maasy) y
mandaba una publishable key; ahora no manda nada más que el cuerpo. Lo que sostiene el servicio es el
límite diario por IP (**20**) más el tope global del endpoint.

**Dos hosts, dos papeles.** La web pública que ve el usuario es `https://be-aos.believe-global.com`
(la landing de marca; es la que va en el enlace "Ver más sobre BeAOS"). La app con sesión y la API
viven en `https://beaos.believe-global.com`, que abierta con el navegador redirige a `/auth/login`.
En `lib.js` eso son dos constantes con nombre explícito — `BEAOS_WEB_URL` y `BEAOS_API_URL` — y el
test de cableado prohíbe que cualquier `href` del popup apunte al host de la API.

- `POST /api/v1/aos/audit` — body `{ "url": "<la url de la pestaña>" }`.
- `POST /api/v1/aos/lead` — body `{ email, name?, company?, url?, score? }` → `{ ok: true }`.

El contrato de la respuesta y la semántica de los estados viven en el repo:
`apps/web/src/lib/aos/public-audit.ts` y `apps/web/src/components/status-tone.tsx`.

Los errores se traducen a un mensaje claro, nunca a un alert técnico: **400** la dirección no es
auditable (destinos internos, `localhost`, metadatos de nube, esquemas que no son http/https),
**429** se pasó el cupo y se lee `Retry-After` para decir cuándo puede volver, **504** tardó
demasiado, cualquier otro un mensaje genérico con el detalle en la consola.

## Qué muestra el popup

1. El **score** y su **banda**. El número va en ink — es un dato, no se pinta por lo que vale — y el
   chip de al lado dice la banda sobre la rampa azul: el color ordena, no juzga.
2. El **listado completo de requisitos**, sin recortar, en el orden del estándar: qué es, si pasa,
   **su línea de evidencia** y los puntos que devolvería arreglarlo cuando los tenga.
3. Los **`diagnostic` aparte y sin puntos**: se informan y no mueven el score, así que no se les
   inventa una ganancia. Los **`n_a`** viajan marcados como "no aplica a este tipo de negocio".
4. El **perfil firmado**: APS declarado, cuántas pruebas declara y si su firma Ed25519 verifica. Si
   el sitio no publica perfil, se dice — no se rellena con ceros.
5. **"Ver en la página"**: el overlay, igual que siempre.

El popup es superficie nuestra, así que usa los seis tokens de la marca, copiados a mano en
`popup.css` porque la extensión no puede importar de `@workspace/ui`. El cian se usa para lo que hay
que hacer, no de adorno: aparece dos veces, en el subrayado del número y en el próximo paso.

## Lo que el contrato nuevo no trae

La extensión vieja mostraba cosas que el endpoint de BeAOS **no devuelve**, y no se rellenaron a ojo:

- El **desglose por niveles** (`breakdown`: inventario, N1, N2, N3, confiabilidad). La respuesta
  pública solo trae el score total.
- El **Bot Beacon** (tráfico agéntico real). No está en el contrato público.
- Los **sub-scores por eje** (`aos_standards` / `aps_standards`). El endpoint expone el score total
  y el APS **declarado** por el sitio, que no es el mismo número.
- El **badge Agent-Preferred** (`files.believe-global.com`). Era un SVG oscuro con hex propios sobre
  una superficie que ahora es de papel; la firma verificada se dice con palabras.

## Roadmap

- Badge de score en el icono de la barra (auto-audit del dominio activo)
- Publicación en la Chrome Web Store (el zip ya está; falta la cuenta dev y la review)
- "Compará con tu competencia": auditar N dominios y rankear
- Botón "generar el fix" (llms.txt / agent-card.json / brand.json) directo desde el popup
