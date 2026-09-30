# El MCP de BeAOS

**Endpoint:** `https://beaos.believe-global.com/mcp`
**Transporte:** JSON-RPC 2.0 sobre `POST` (sin SSE, sin sesión)
**Auth:** `Authorization: Bearer <token>` — o `x-api-key: <token>`

Existe para que los demás productos de Believe —Maasy, BeAds, Autex, el agente de una marca— **operen
BeAOS sin escribir una integración a medida**. Antes lo único que BeAOS exponía era una API REST; "otro
producto", en la práctica, es un agente, así que el mismo trabajo se ofrece como tools.

Hay **dos credenciales aceptadas**: un **token por producto** de la tabla `agent_api_tokens` (identidad
propia y revocación individual), o los `ADMIN_API_KEYS` compartidos que ya usaba `/api/v1`, para no romper
lo que ya funcionaba. No hay infraestructura nueva: Traefik ya enruta `beaos.believe-global.com`, así que
el MCP vive en el mismo dominio de la app.

## Los tools

Hay **27 herramientas**: nueve de lectura propia (AOS, APS medido, pruebas y bundle), ocho heredadas de
Getcito y diez de acción.

### Lo propio: AOS, APS medido, pruebas y el bundle

| Tool | Qué devuelve |
|---|---|
| `list_brands` | Las marcas, con su id, web y dominios. Es por donde se empieza si no se sabe el id. |
| `get_brand` | Una marca y sus entidades (paraguas y productos), con el `entityId` que piden los demás tools. |
| `get_aos_audit` | Última auditoría AOS de una entidad: score, banda, tipo de negocio y el detalle requisito por requisito. Incluye el **APS declarado**. |
| `list_aps_runs` | Corridas de **APS medido**: score por modelo, banda, observaciones, P10–P90 y si la corrida salió parcial. |
| `get_aps_score_detail` | El detalle competitivo de una corrida: las 5 dimensiones, los sub-métricas, el APS con banda y P10/P50/P90, las observaciones y el ranking de competidores mencionados. |
| `list_claims` | Las pruebas guardadas de una entidad (id, afirmación, número, estado, `inheritable` y de qué entidad es copia) y las heredables del paraguas que efectivamente hereda, si la entidad no es el paraguas. |
| `get_claim` | **Una** prueba de una entidad por su `claimId`, con el mismo serializador que `list_claims`. Solo mira las filas propias: lo heredado del paraguas se ve en `list_claims`. |
| `get_agent_bundle` | Manifiesto del bundle agéntico publicado: cada ruta con su `sha256` y su tamaño. Sin el contenido. |
| `get_agent_asset` | El contenido **exacto** de un archivo del bundle (por ejemplo `/.well-known/brand.json`), con su hash. |

### Lo heredado de Getcito

| Tool | Qué devuelve |
|---|---|
| `list_prompts` | Los prompts monitoreados de una marca: texto, si están habilitados, tags y tags de sistema. |
| `list_competitors` | Los competidores configurados de una marca, con dominios y alias. |
| `get_visibility` | Totales de menciones (corridas, menciones, tasa) y el desglose por modelo y por prompt. |
| `get_share_of_voice` | El ranking de la marca contra sus competidores, con menciones y porcentaje. **Depende del set de competidores configurado.** |
| `list_citations` | Las fuentes citadas por los modelos: dominio, URL, título y modelo, con filtros por modelo y dominio. |
| `get_query_fanout` | Las búsquedas que disparan los prompts: las más frecuentes y las de un prompt puntual. |
| `get_opportunities` | El último informe de oportunidades generado para la marca (resumen, oportunidades y riesgos). |
| `list_reports` | Los reportes de una marca: id, nombre, estado, fecha de creación y de fin. **Sin el `rawOutput`.** |

### Las acciones

| Tool | Qué hace |
|---|---|
| `ensure_brand` | Crea o actualiza una marca, idempotente por host de la web. Devuelve `{ brandId, created }`. |
| `ensure_entity` | Crea o actualiza una entidad, idempotente por `maasyProjectId` o por host. Valida la jerarquía. |
| `ensure_prompt_library` | Genera la biblioteca de prompts APS si la entidad no tiene una activa y devuelve los prompts. Idempotente salvo `force: true`. |
| `start_aps_run` | Encola una corrida APS con el mismo guardián de presupuesto que la UI. Asegura la biblioteca de prompts antes de encolar y lo informa en `libraryGenerated`. |
| `sync_brand_dna` | Sincroniza el Brand DNA desde Maasy y dice si trajo `claims`. |
| `upsert_claim` | **Crea o actualiza una prueba** (afirmación, número, límites y su documento). El id es del operador: el mismo `claimId` en la misma entidad se actualiza, no se duplica. Devuelve el claim guardado y los avisos del estándar. **La prueba nace en BeAOS**: Maasy manda la evidencia en prosa. |
| `delete_claim` | Borra una prueba de una entidad. No toca lo heredado del paraguas ni lo de otra entidad, y no despublica el bundle. |
| `generate_agent_assets` | Genera o regenera el bundle desde el Brand DNA y las pruebas confirmadas. Lo deja guardado, **no** lo publica. |
| `publish_agent_assets` | Abre o cierra el gate de publicación de una entidad. |
| `set_claim_inheritable` | Marca si las sub-entidades pueden heredar una prueba. Pide `claimId` y el valor; **no** crea pruebas. |

### El ciclo completo, en orden

Es lo que dicen las `instructions` del servidor, porque es lo que lee un agente que llega sin contexto:

1. `ensure_brand` — la marca.
2. `ensure_entity` — la entidad (paraguas o producto); devuelve el `entityId` que piden los demás tools.
3. `sync_brand_dna` — el contexto que Maasy tiene del proyecto: la evidencia **en prosa**.
4. `upsert_claim` — la prueba estructurada: afirmación, número, límites y con qué documento se verifica.
   **La prueba nace en BeAOS**, no en Maasy: Maasy manda la prosa, la estructura la pone BeAOS con lo que
   confirma el operador.
5. `generate_agent_assets` — el bundle, desde el DNA y las pruebas `confirmed`.
6. `publish_agent_assets` — la publicación.

Dos reglas que no se doblan:

- Un perfil que declara **menos pruebas que el sitio** que ya las sirve se **rechaza** al publicar: sería
  degradar en silencio la evidencia verificable de la marca.
- BeAOS **no inventa pruebas**. Si no hay una prueba confirmada, el claim no existe: una prueba que no se
  puede verificar es peor que su ausencia.

## Cuatro reglas que no se negocian

1. **La lectura pasa por el mismo gate que la API de entrega.** `get_agent_bundle` y `get_agent_asset`
   usan `loadAssetBundle`, que devuelve `null` mientras la entidad no esté publicada. El MCP **no puede
   filtrar** un bundle que un operador todavía no aprobó, y ningún tool arma el bundle por su cuenta.
2. **Las acciones son las mismas de la UI.** `generate_agent_assets` y `publish_agent_assets` llaman a
   `agent-assets-core`; `start_aps_run` y `sync_brand_dna` llaman a `agent-aps-core` y
   `agent-maasy-core`; `list_claims`, `get_claim`, `upsert_claim`, `delete_claim` y
   `set_claim_inheritable` llaman a `claims-core`, el mismo núcleo de la pantalla de Pruebas —y el alta
   valida con `normalizeClaimInput`, que es la única puerta: la pantalla y el MCP no pueden aceptar cosas
   distintas—. Si el **guardián de claims** bloquea una publicación o el **guardián de presupuesto**
   bloquea una corrida, el bloqueo también aparece por acá: no hay una puerta más permisiva para los
   agentes.
3. **Una prueba heredada viaja declarada como heredada.** El operador marca qué es heredable —pruebas de
   marca: metodología, antigüedad, volumen— y las sub-entidades las heredan. La prueba heredada entra al
   perfil de la sub-entidad con el prefijo `[Heredada del paraguas <nombre>]` en su resumen, para que
   nadie lea como propio un caso que hizo otro. Un caso de cliente heredado sería una mentira
   verificable, así que la UI lo advierte y `set_claim_inheritable` no lo impide: la decisión es del
   operador y queda registrada.
4. **Nada de datos de todas las marcas mezclados.** Toda lectura exige `brandId` (o `entityId`), salvo
   `list_reports`, que resuelve el nombre desde la marca porque la tabla heredada `reports` no guarda
   `brandId`.

## Las credenciales por producto

Cada producto (Autex, Maasy, …) tiene su token. En la base vive **sólo el sha256** del token y sus
primeros 8 caracteres como `prefix` para reconocerlo en un listado; `lastUsedAt` se actualiza cuando el
token autentica y `revokedAt` marca la revocación sin borrar la fila. Un token revocado responde `401` y
**no** cae al fallback de `ADMIN_API_KEYS`.

Administración. **En el servidor, el script de bash** —es el que funciona ahí—; el de node sirve en una
máquina con node.

El de node **no corre en `contabo-believe`**: ese host no tiene `node` ni `psql`, y el contenedor
`beaos-web-1`, que sí tiene node, es un build (`/app/.output`) sin `apps/web/scripts`. El de bash hace lo
mismo con bash + openssl + el `psql` que vive **dentro** del contenedor de la base.

```bash
cd /root/BeAos

# Crear. El token se imprime UNA sola vez y no se puede recuperar.
scripts/beaos-token.sh create autex

# Listar con prefijo, último uso y estado (activo / revocado).
scripts/beaos-token.sh list

# Revocar por prefijo. Si ya estaba revocado, lo dice.
scripts/beaos-token.sh revoke beaos_ab
```

En una máquina con node el equivalente es `node apps/web/scripts/beaos-tokens.mjs create autex`. Los dos
escriben el **mismo** formato —`beaos_` + base64url de 24 bytes sin padding, `prefix` de 8 caracteres y
sha256 en hex—, así que la credencial no depende de con cuál se creó; y
`apps/web/src/lib/__tests__/beaos-token-scripts.test.ts` corre las dos implementaciones y compara: si una
se desvía, el test se cae.

Cómo llega a la base el script de bash: `docker exec -i <contenedor> psql "$DATABASE_URL"`, con el nombre
del contenedor sacado del host de la propia URL —en el servidor, `…@beaos-postgres:5432/getcito`—. El
primer intento es esa cadena tal cual, la misma que usa la app, porque en la red de compose el nombre del
contenedor se resuelve desde adentro del contenedor; si no conecta, reintenta con el host apuntado al
loopback del contenedor (`127.0.0.1:5432`) y avisa por stderr. Si el host de la URL no es un contenedor en
ejecución pero hay `psql` local, usa ése; si no, falla diciendo qué pasa. Los dos scripts leen
`DATABASE_URL` del entorno o de `apps/web/.env` / `.env`, en ese orden. La tabla la crea la migración
`packages/lib/src/db/migrations/0023_broken_stepford_cuckoos.sql` (generada con `drizzle-kit generate`).

Verificado en `contabo-believe`: `which node` y `which psql` salen vacíos, `docker` y `openssl` 3.0.13
están en el host, y `psql` 18.6 vive dentro de `beaos-postgres`. Con eso, `scripts/beaos-token.sh list`
lee el `.env` del despliegue y lista los tokens por `docker exec` —sin node—.

## Cómo se conecta

```bash
curl -s https://beaos.believe-global.com/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $BEAOS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Llamar un tool:

```bash
curl -s https://beaos.believe-global.com/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $BEAOS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call",
       "params":{"name":"get_aos_audit","arguments":{"entityId":"<uuid>"}}}'
```

Como servidor MCP en un cliente (formato estándar):

```json
{
  "mcpServers": {
    "beaos": {
      "type": "http",
      "url": "https://beaos.believe-global.com/mcp",
      "headers": { "Authorization": "Bearer <token>" }
    }
  }
}
```

## Detalles de protocolo que importan

- Una **notificación** (sin `id`) responde `202` y sin cuerpo, como pide el protocolo. `notifications/initialized` no ejecuta nada.
- Un **método** desconocido es error `-32601`. Un **tool** desconocido es `-32602`, y el mensaje lista los que hay.
- Un **tool que falla** no es un error de protocolo: devuelve `isError: true` con el motivo en texto, para que el modelo pueda leerlo y corregir. Un `entityId` mal formado, por ejemplo, dice que se esperaba un UUID. `start_aps_run` usa `isError` cuando la corrida no se pudo encolar (sin biblioteca activa, sin precios o con el techo de presupuesto superado) y el texto dice qué falta.
- `GET /mcp` responde `405`: este servidor no abre stream por GET, y decirlo evita que un cliente se quede esperando un stream que nunca abre.
- **Sin `Mcp-Session-Id`**: el estado no vive en el servidor, así que cualquier instancia atiende cualquier request y un reinicio no rompe a nadie.

## Qué se verificó

- `21` pruebas del protocolo (`src/server/mcp/__tests__/jsonrpc.test.ts`): parseo, `initialize`, `ping`, `tools/list`, `tools/call`, notificación sin respuesta, métodos y tools desconocidos, y que un handler que revienta sale como contenido.
- `14` pruebas del registro (`src/server/mcp/__tests__/tools.test.ts`): nombres únicos, `inputSchema` de objeto, campos obligatorios descritos, el registro completo —**27** tools, con el conteo fijado—, el ciclo de las `instructions` en orden, y que los handlers no se publican por el protocolo.
- `13` pruebas del alta de una prueba (`packages/aos-aps/src/claims/claim-input.test.ts`): el patrón `CLM-`, los enums de `status`, `verifiableBy`, `category` y `proofType`, y los avisos que no frenan el guardado. Son puras: no necesitan base.
- `13` pruebas de la credencial por producto (`src/lib/__tests__/api-tokens.test.ts`): token válido, revocado (que no cae al fallback), desconocido, fallback a `ADMIN_API_KEYS`, token ausente y lectura del header.
- `8` pruebas de que el script de bash y el de node producen **el mismo** token (`src/lib/__tests__/beaos-token-scripts.test.ts`): el prefijo y el sha256 del token de ejemplo, la forma del token nuevo (24 bytes, alfabeto base64url, sin padding) en las dos vías, tokens cruzados entre los dos generadores, y el script de bash corriendo con el `PATH` sin node. Ninguna toca la base.

## Lo que falta

- **Dogfooding:** BeAOS todavía no publica su **propio** `/.well-known/mcp/server-card.json` en la raíz de
  `beaos.believe-global.com` apuntando a este endpoint. Hoy el server-card se emite dentro del bundle de
  cada entidad, leyendo el MCP que el sitio ya publica.
