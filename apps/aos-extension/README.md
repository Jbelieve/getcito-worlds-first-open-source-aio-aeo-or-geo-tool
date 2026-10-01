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

Los fixtures de `test/fixtures/` son **respuestas reales**, y hay uno por contrato:

| Fixture | Qué es |
|---|---|
| `audit-believe-global.json` | Sitio completo con el contrato 2.1.0: `score` 100, perfil firmado (APS declarado 94), sub-scores por eje, desglose y `botBeacon` |
| `audit-sin-perfil.json` | `example.com` con el contrato 2.1.0: `score` 0, sin brand.json, con `n_a`, con `gain` y con diagnósticos sin evidencia |
| `audit-contrato-2.0.0.json` | La **misma** respuesta de believe-global.com capturada **antes** de extender el endpoint: el contrato 2.0.0, sin ninguno de los campos nuevos. Es la prueba de que la respuesta vieja no rompe el popup |

Los tres se capturaron corriendo el motor de verdad contra el sitio de verdad, y los campos viejos del
primero salen **idénticos** al tercero: es la prueba de que lo agregado es aditivo.

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
| `lib.js` | Config, endpoints, las funciones puras (request, mapeo de la respuesta —incluidos sub-scores, desglose y badge—, textos) y el storage |
| `popup.html` / `popup.css` / `popup.js` | El popup: score, banda, puntajes por eje, listado completo, perfil firmado con badge, Bot Beacon declarado, próximo paso y captura de lead |
| `background.js` | Service worker: inyecta el overlay en la pestaña activa a pedido |
| `content-overlay.js` | Modo "lo que ve un agente": anota el DOM real (verde/rojo) + panel resumen. **No se toca** |
| `test/` | Tests de las piezas puras con el runner de node |
| `store/` | Textos para el listado de la Chrome Web Store |

## Backend

Dos endpoints **públicos a propósito**, en `https://beaos.believe-global.com` (la API) y sin
credencial: sin token, sin sesión y sin apikey. Antes la extensión hablaba con Supabase (Maasy) y
mandaba una publishable key; ahora no manda nada más que el cuerpo. Lo que sostiene el servicio es el
límite diario por IP más el tope global del endpoint. El cupo diario **no es una constante del
cliente**: lo define la env del servidor (`AOS_PUBLIC_AUDITS_PER_DAY`) y viaja en la cabecera
`RateLimit-Limit` de la respuesta, que es de donde el popup saca el número que le muestra a la
persona. Si la cabecera no viene, el popup dice el cupo **sin la cifra** en vez de inventarla.

**Dos hosts, dos papeles.** La web pública que ve el usuario es `https://be-aos.believe-global.com`
(la landing de marca; es la que va en el enlace "Ver más sobre BeAOS"). La app con sesión y la API
viven en `https://beaos.believe-global.com`, que abierta con el navegador redirige a `/auth/login`.
En `lib.js` eso son dos constantes con nombre explícito — `BEAOS_WEB_URL` y `BEAOS_API_URL` — y el
test de cableado prohíbe que cualquier `href` del popup apunte al host de la API.

- `POST /api/v1/aos/audit` — body `{ "url": "<la url de la pestaña>" }`.
- `POST /api/v1/aos/lead` — body `{ email, name?, company?, url?, score? }` → `{ ok: true }`.

El contrato de la respuesta y la semántica de los estados viven en el repo:
`apps/web/src/lib/aos/public-audit.ts` y `apps/web/src/components/status-tone.tsx`.

El audit manda la **URL completa de la pestaña** (`tab.url`), con esquema y con path: el path importa,
porque parado en `https://sitio.com/precios` hay que auditar esa página y no la home. El **dominio**
(`domainFromUrl`, sin `www.`) se usa solo para el encabezado y para la clave del caché, que es una
entrada por sitio. El endpoint además tolera un dominio pelado y lo interpreta como `https://…`, así
que la extensión 2.1.0 —la que manda el dominio— también funciona contra ese servidor.

Los errores se traducen a un mensaje claro, nunca a un alert técnico. El **400** viene con un `code`
y hay dos motivos distintos que no se confunden: `invalid_url` (no se pudo interpretar la dirección) e
`blocked_url` (esa dirección queda afuera por seguridad). El texto del segundo **no enumera lo que el
guardián bloquea**: la lista de lo que se deja afuera vive en el servidor, y nombrarla en el popup le
daría un mapa a quien prueba sin decirle nada a una persona normal.
Después: **429** se pasó el cupo: se lee `Retry-After` para decir **cuándo** puede volver y
`RateLimit-Limit` para decir el cupo **real** (si no vino, se dice el cupo sin el número), **504**
tardó demasiado, cualquier otro un mensaje genérico con el detalle en la consola.

## Qué muestra el popup

1. El **score** y su **banda**. El número va en ink — es un dato, no se pinta por lo que vale — y el
   chip de al lado dice la banda sobre la rampa azul: el color ordena, no juzga.
2. Los **puntajes por eje** (`AOS` / `APS`), con su barra y su desglose: cuántos checks pasan, cuánto
   peso se ganó sobre el que aplica y cuántos no aplican. Los calcula el motor y llegan por el
   endpoint; el popup no recalcula ningún peso.
3. El **listado completo de requisitos**, sin recortar, en el orden del estándar: qué es, de qué eje
   es, si pasa, **su línea de evidencia** y los puntos que devolvería arreglarlo cuando los tenga.
4. Los **`diagnostic` aparte y sin puntos**: se informan y no mueven el score, así que no se les
   inventa una ganancia. Los **`n_a`** viajan marcados como "no aplica a este tipo de negocio".
5. El **perfil firmado**: APS declarado, cuántas pruebas declara y si su firma Ed25519 verifica. Si
   el sitio no publica perfil, se dice — no se rellena con ceros.
6. El **badge Agent-Preferred**, **solo** cuando `signatureVerified` es `true`. En los seis tokens de
   la marca: no es el SVG oscuro de la extensión vieja y no hay versión "apagada", porque un badge
   apagado igual diría Agent-Preferred.
7. El **Bot Beacon**: el tráfico agéntico real. Se muestra siempre y hoy dice que **no hay fuente**
   (ver abajo).
8. **"Ver en la página"**: el overlay, igual que siempre.

El popup es superficie nuestra, así que usa los seis tokens de la marca, copiados a mano en
`popup.css` porque la extensión no puede importar de `@workspace/ui`. El cian se usa para lo que hay
que hacer, no de adorno: aparece dos veces, en el subrayado del número y en el próximo paso. El badge
y el desglose van sobre la rampa azul — ordenan, no piden nada.

## Las cuatro cosas que se recuperaron de la extensión vieja

La extensión de Maasy mostraba cuatro cosas que la 2.0.0 había perdido porque el contrato del endpoint
no las tenía. Están de vuelta, cada una donde corresponde:

| Lo que mostraba Maasy | Cómo volvió |
|---|---|
| **Sub-scores por eje** (`aos_standards` / `aps_standards`) | Los dos números ya existían en el motor; el endpoint ahora los publica como `aosStandards` / `apsStandards`. `apsStandards` es el **APS del estándar** —cuántos requisitos del eje APS cumple el sitio, un chequeo del sitio y no una medición contra modelos—, distinto del `declaredAps` que declara el sitio y del **APS medido** de una corrida real, que no pasa por acá |
| **Desglose por niveles** (`breakdown`: inventario / N1 / N2 / N3 / confiabilidad) | **No tiene equivalente.** Esos cinco niveles son del AOS v1 y este motor no los corre: no mide DOM, ni formularios, ni ejecución programática, ni confiabilidad. En vez de fabricar cinco números, el desglose honesto es **por eje del estándar**, con los mismos pesos que hacen el score, y el detalle con evidencia por requisito está en el checklist |
| **Bot Beacon** (tráfico agéntico real) | **No hay fuente, y se dice.** En Maasy salía de su propio instrumento (`bot_beacon_hits`, con el user-agent clasificado, más `aos_operator_tasks`): es dato de Maasy sobre los sitios que instrumenta, no algo medible de una URL arbitraria. BeAOS no tiene ingest de tráfico, así que el contrato publica `botBeacon: null` y el popup declara el hueco. Un cero se leería como "no te visitó ningún agente" |
| **Badge Agent-Preferred** | Vuelve con los seis tokens de la marca en vez del SVG oscuro con hex propios de Maasy, y **solo** si `signatureVerified` es `true`. No hay badge apagado |

Lo que **no** se toca: el checklist completo con evidencia, los `n_a` marcados, los diagnósticos
aparte y sin puntos, y los errores con mensaje humano (400 / 429 con `Retry-After` / 504).

## Roadmap

- Badge de score en el icono de la barra (auto-audit del dominio activo)
- Publicación en la Chrome Web Store (el zip ya está; falta la cuenta dev y la review)
- "Compará con tu competencia": auditar N dominios y rankear
- Botón "generar el fix" (llms.txt / agent-card.json / brand.json) directo desde el popup
