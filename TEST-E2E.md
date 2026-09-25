# Prueba de punta a punta de BeAOS

Para Jorge. Se hace en orden, de arriba abajo, y cada paso dice **qué debes ver**. Si algo no coincide, para
ahí: no sigas, porque el paso siguiente asume que el anterior está bien.

Los valores exactos de la marca de prueba (Believe) están puestos para que puedas comparar.

---

## Antes de empezar: qué tiene que ser cierto

| # | Requisito | Estado |
|---|---|---|
| 1 | La marca existe en BeAOS | ✅ Believe, id `default` |
| 2 | La entidad existe y tiene su web cargada | ⚠️ **La entidad `Believe` NO tiene la web cargada** — el reporte se vincula por nombre. Cárgala antes (ver paso 0) |
| 3 | El MCP tiene token | ✅ `ADMIN_API_KEYS` en el `.env` del servidor |
| 4 | Las pruebas (claims) llegan desde Maasy | ❌ **NO llegan.** Esto hace fallar el paso 6 a propósito |

---

## Paso 0 · Cargar la web de la entidad (5 minutos, solo una vez)

**Por qué:** hay **dos** lugares donde va la web y solo uno está lleno. La **marca** ya la tiene
(`https://believe-global.com/`), pero la **entidad** (`agent_brand_entities.website_url`) está **vacía**.
Son dos campos distintos: la marca es la marca, la entidad es la superficie agéntica de esa marca.

Que hoy funcione es suerte: el generador cae a la web del DNA y el reporte cae al nombre. Cargarla en la
entidad hace que la entidad tenga su propia identidad y que el vínculo del reporte no dependa de que los
nombres coincidan.

**Y hasta hoy había algo peor, que ya está arreglado:** el candado de publicación miraba *solo* ese campo
vacío. Sin web, no podía leer el perfil del sitio, y "no pude leerlo" **no bloquea**. O sea que la
protección desaparecía justo cuando hacía falta: un clic en "Publicar" habría cambiado las 6 pruebas que tu
web sirve por las 0 que BeAOS genera. Ahora el candado busca la web en **tres** lugares (entidad → DNA →
marca) y prueba uno por uno, así que ya no depende de un campo que puede estar vacío.

1. Menú **Agent Entities**.
2. Busca la entidad **Believe** y cárgale la web: `https://believe-global.com`.
3. Guarda.

**Debes ver:** la entidad con su web al lado.

---

## Paso 1 · El AOS de la web

1. Menú **AOS**.
2. Pega `https://believe-global.com` y aprieta **Auditar AOS**.
3. Espera (tarda entre 20 y 60 segundos: recorre la web).

**Debes ver:**
- **Score 100**, banda **Agent-Operable**, tipo de negocio **product_api**.
- **11 requisitos que puntúan, los 11 en verde de marca (azul)**.
- **8 diagnósticos** aparte, que se informan y **no mueven el número**.
- El **APS declarado: 94**.

**Si falla:** mira si el sitio responde `/AGENTS.md` en mayúscula y `/llms.txt`. Si la web cambió algo, el
score baja y el detalle te dice exactamente qué requisito.

---

## Paso 2 · El APS medido (lo que los asistentes responden)

Son tres sub-pasos, en el menú **APS**:

1. **1 · Biblioteca de prompts** — debe haber una **activa**. Si no hay, genérala (50 prompts de compra).
2. **2 · Corrida** — elige la entidad, aprieta **Estimar corrida**.
   **Debes ver:** el costo estimado **antes** de gastar, y la lista de modelos con sus nombres.
3. Confirma y corre. Tarda entre 10 y 20 minutos.
4. **3 · Resultados**.

**Debes ver** (los números de la última corrida real):

| Modelo | APS | Banda | P10–P90 |
|---|---|---|---|
| google-ai-mode | 40 | Agent-Opaque | 37–44 |
| chatgpt | 39 | Agent-Opaque | 35–44 |
| claude | 34 | Agent-Opaque | 31–37 |

Y un aviso de **corrida parcial**, con el motivo. **Eso no es un error**: Perplexity nunca completa vía
BrightData y el sistema lo dice en vez de fingir que midió todo.

---

## Paso 3 · El Plan de implementación

1. Menú **Plan**.
2. Elige la entidad Believe.

**Debes ver:**
- Un **resumen arriba** con cuatro números: listos, faltan, por verificar, declinados.
- **Cuatro grupos**: *Lo que BeAOS ya genera*, *Lo que hay que hacer en tu web*, *Lo que hay que hacer fuera
  de tu web*, *Lo que decidimos NO hacer*.
- **36 tarjetas** en total, cada una con: de quién es el trabajo, el por qué, los pasos numerados, el detalle
  exacto, el snippet para copiar y cómo comprobar que quedó.
- Los archivos que BeAOS genera deben figurar como **Listos** después del paso 4.

**Si falla:** si dice "por verificar" en todo, es que la entidad no tiene assets generados todavía.

---

## Paso 4 · Generar los archivos

1. Menú **Agent Assets**.
2. Elige la entidad Believe.
3. **Generar assets**.

**Debes ver 15 archivos:**

```
/llms.txt
/llms-full.txt
/AGENTS.md
/robots.txt                        ← con Content-Signal y Agentmap
/sitemap.xml
/.well-known/agent-card.json
/.well-known/agent-permissions.json
/.well-known/brand.json
/.well-known/security.txt          ← NUEVO
/.well-known/api-catalog           ← NUEVO
/.well-known/ai-catalog.json       ← NUEVO (sale de tus preguntas reales)
/.well-known/mcp/server-card.json  ← declara https://believe-global.com/mcp
/.well-known/brand.json.sig
/.well-known/keys.json
/.well-known/http-message-signatures-directory
```

**Comprobaciones concretas:**
- Abre **`/robots.txt`**: `Content-Signal: search=yes, ai-input=yes, ai-train=yes` tiene que estar **en cada
  grupo** de `User-agent`.
- Abre **`/.well-known/security.txt`**: `Contact:` debe decir `mailto:hola@believe-global.com`, leído de tu
  propia web. Si dice otra cosa, el sitio cambió su contacto.
- Abre **`/.well-known/ai-catalog.json`**: las `representativeQueries` tienen que ser **tus preguntas
  reales** de la biblioteca de prompts, no frases inventadas.
- Abre **`/.well-known/mcp/server-card.json`**: `serverUrl` tiene que ser `https://believe-global.com/mcp`.

---

## Paso 5 · La firma (que cualquiera pueda verificar sin confiar en nosotros)

1. En **Agent Assets**, descarga `/.well-known/brand.json` y `/.well-known/keys.json`.
2. Compara la clave pública de `keys.json` con la que publica tu web:
   `https://believe-global.com/.well-known/keys.json`.
3. El `kid` de `brand.json.sig` tiene que ser **el mismo** que el de `keys.json`.

**Debes ver:** la misma identidad. Comprobado hoy: `kid = 71952e93b97ac2b8` en los tres lados.

---

## Paso 6 · Publicar — **este paso va a fallar, y está bien**

1. En **Agent Assets**, sección **Publicación**, aprieta **Publicar**.

**Debes ver: un rechazo**, con este motivo:

> *El perfil del sitio declara 6 claims y el bundle declara 0. Publicar así degradaría la evidencia
> verificable de la marca (y su APS declarado).*

**Esto es el candado haciendo su trabajo.** El bundle que BeAOS genera tiene **0 pruebas** porque el DNA que
llega de Maasy trae `claims[]` vacío, y tu web ya sirve **6**. Publicar eso cambiaría tus 6 pruebas por
ninguna, en silencio. **Este es el único bloqueo real que queda, y no está en BeAOS: está en Maasy.**

El candado busca la web de la marca en tres lugares —la entidad, el DNA y la marca— y prueba uno por uno,
para no depender de un solo campo. **Solo si ninguno responde** avisa en vez de bloquear, y en ese caso el
aviso lo dice con todas las letras.

**Cuando Maasy mande las pruebas, este paso pasa** y con él todo lo que sigue.

---

## Paso 7 · La entrega (necesita el paso 6)

> Estos dos caminos responden **404 hasta que la entidad esté publicada**. Eso también es correcto: el gate
> está cerrado por defecto.

**a) Público, para una web que no puede montar archivos:**

```
https://beaos.believe-global.com/agent/598d73a6-d6e9-427e-87d1-d26452cffe79/.well-known/brand.json
```
Sin token: cualquier agente lo lee. Y el índice sin sufijo lista todo lo publicado con sus hashes.

**b) Por API, para un agente de entrega** (Maasy, o el *be agent* de la marca):

```bash
TOKEN=$(la clave de ADMIN_API_KEYS del servidor)
curl -s https://beaos.believe-global.com/api/v1/agent-assets/598d73a6-d6e9-427e-87d1-d26452cffe79 \
  -H "authorization: Bearer $TOKEN" | head -40

# un archivo suelto, byte a byte, con su sha256
curl -s "https://beaos.believe-global.com/api/v1/agent-assets/598d73a6-d6e9-427e-87d1-d26452cffe79/raw?path=/.well-known/brand.json" \
  -H "authorization: Bearer $TOKEN" | head -20
```

**Debes ver:** el bundle completo con el `sha256` de cada archivo, y el archivo suelto con su hash en la
cabecera `x-content-sha256`. **El contenido no se puede re-serializar**: si cambia un byte, la firma deja de
verificar.

---

## Paso 8 · El reporte

1. Menú **Reports** → **Create New Report** (Believe / `https://believe-global.com`).
2. Ábrelo.

**Debes ver, en este orden:** portada (share of voice), las secciones de siempre **en español**, la página
**Agent Readiness** con el AOS 100 y el APS declarado 94 / medido 40–39–34, y al final el **cierre de
BeAOS** con los tres pasos numerados y el cian una sola vez. Imprímelo o guárdalo como PDF y revisa que en
blanco y negro se siga entendiendo.

**Si algo quedó en inglés:** los gráficos vienen del dashboard heredado de Getcito y siguen en inglés por la
frontera del fork. Dímelo y lo cambio, pero es una decisión aparte.

---

## Paso 9 · El MCP, desde afuera

Con la misma clave:

```bash
TOKEN=$(la clave de ADMIN_API_KEYS del servidor)

# 1. ¿está vivo y qué sabe hacer?
curl -s https://beaos.believe-global.com/mcp \
  -H 'content-type: application/json' -H "authorization: Bearer $TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# 2. sin token tiene que dar 401
curl -s -o /dev/null -w '%{http_code}\n' https://beaos.believe-global.com/mcp \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```

**Debes ver:** las **8 herramientas** (`list_brands`, `get_brand`, `get_aos_audit`, `list_aps_runs`,
`get_agent_bundle`, `get_agent_asset`, `generate_agent_assets`, `publish_agent_assets`) y un **401** sin
token.

**Y BeAOS publicando lo suyo** (lo que le pedimos a las marcas, hecho por nosotros):

```
https://beaos.believe-global.com/.well-known/mcp/server-card.json
https://beaos.believe-global.com/.well-known/security.txt
```
**Debes ver:** el `serverUrl` apuntando a `/mcp` con las 8 herramientas, y el `security.txt` con
`Contact: mailto:hola@believe-global.com` y un `Expires` a menos de un año (se calcula, no se escribe a
mano: un `security.txt` vencido se ignora sin que nadie lo note).

---

## Paso 10 · La verificación de afuera (no nos creemos a nosotros mismos)

Esto es lo que mide si la web es realmente operable por agentes, con herramientas que no son nuestras:

```bash
cd ~/.claude/skills/agent-ready-web
bash scripts/probe.sh believe-global.com                 # 50 chequeos de comportamiento
python3 scripts/orank-triage.py believe-global.com       # score externo, rankeado por puntos
python3 scripts/ora-journey.py believe-global.com --intent integrate --agent cas-sonnet
```

**Lo que dio hoy:**

| Medición | Resultado |
|---|---|
| Sonda (50 chequeos) | **50 pasan, 0 fallan** |
| orank | **86/100 · grado A** (Discovery 9/16, Access 67/67, Usability 85/93) |
| Journey real | **3 pasos · 46,8 s · $0,0655 · 10.907 tokens · eficiencia 100% · 0 errores · 0% de memoria** |

**Y el reparto de lo que falta:** `CODE 0,0` · `OFFSITE 14,7` · `DECLINE 2,8`. **No queda nada que construir
en la web**: lo que resta son cuentas y publicaciones tuyas.

---

## El resumen: qué pasa y qué no

| Paso | Hoy |
|---|---|
| 0 · Cargar la web de la entidad | Pendiente (5 minutos tuyos) |
| 1 · AOS | ✅ Pasa |
| 2 · APS medido | ✅ Pasa (parcial por Perplexity, y lo dice) |
| 3 · Plan | ✅ Pasa |
| 4 · Generar los 15 archivos | ✅ Pasa |
| 5 · La firma verifica | ✅ Pasa |
| 6 · Publicar | ❌ **Bloqueado por los claims de Maasy** |
| 7 · La entrega | ⏸️ Depende del 6 |
| 8 · El reporte | ✅ Pasa |
| 9 · El MCP y el server-card de BeAOS | ✅ Pasa |
| 10 · Verificación externa | ✅ Pasa (86/A) |

**Todo pasa menos el paso 6, y el paso 6 no depende de BeAOS.** Cuando Maasy mande las pruebas, la cadena
cierra de punta a punta: medir → generar → publicar → entregar → verificar.
