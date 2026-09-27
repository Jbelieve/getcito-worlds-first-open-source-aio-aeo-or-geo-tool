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

### Lo propio: AOS, APS medido y el bundle

| Tool | Qué devuelve |
|---|---|
| `list_brands` | Las marcas, con su id, web y dominios. Es por donde se empieza si no se sabe el id. |
| `get_brand` | Una marca y sus entidades (paraguas y productos), con el `entityId` que piden los demás tools. |
| `get_aos_audit` | Última auditoría AOS de una entidad: score, banda, tipo de negocio y el detalle requisito por requisito. Incluye el **APS declarado**. |
| `list_aps_runs` | Corridas de **APS medido**: score por modelo, banda, observaciones, P10–P90 y si la corrida salió parcial. |
| `get_aps_score_detail` | El detalle competitivo de una corrida: las 5 dimensiones, los sub-métricas, el APS con banda y P10/P50/P90, las observaciones y el ranking de competidores mencionados. |
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
| `start_aps_run` | Encola una corrida APS con el mismo guardián de presupuesto que la UI. **No** genera la biblioteca de prompts. |
| `sync_brand_dna` | Sincroniza el Brand DNA desde Maasy y dice si trajo `claims`. |
| `generate_agent_assets` | Genera o regenera el bundle desde el Brand DNA. Lo deja guardado, **no** lo publica. |
| `publish_agent_assets` | Abre o cierra el gate de publicación de una entidad. |

## Tres reglas que no se negocian

1. **La lectura pasa por el mismo gate que la API de entrega.** `get_agent_bundle` y `get_agent_asset`
   usan `loadAssetBundle`, que devuelve `null` mientras la entidad no esté publicada. El MCP **no puede
   filtrar** un bundle que un operador todavía no aprobó, y ningún tool arma el bundle por su cuenta.
2. **Las acciones son las mismas de la UI.** `generate_agent_assets` y `publish_agent_assets` llaman a
   `agent-assets-core`; `start_aps_run` y `sync_brand_dna` llaman a `agent-aps-core` y
   `agent-maasy-core`. Si el **guardián de claims** bloquea una publicación o el **guardián de
   presupuesto** bloquea una corrida, el bloqueo también aparece por acá: no hay una puerta más
   permisiva para los agentes.
3. **Nada de datos de todas las marcas mezclados.** Toda lectura exige `brandId` (o `entityId`), salvo
   `list_reports`, que resuelve el nombre desde la marca porque la tabla heredada `reports` no guarda
   `brandId`.

## Las credenciales por producto

Cada producto (Autex, Maasy, …) tiene su token. En la base vive **sólo el sha256** del token y sus
primeros 8 caracteres como `prefix` para reconocerlo en un listado; `lastUsedAt` se actualiza cuando el
token autentica y `revokedAt` marca la revocación sin borrar la fila. Un token revocado responde `401` y
**no** cae al fallback de `ADMIN_API_KEYS`.

Administración:

```bash
# Crear. El token se imprime UNA sola vez y no se puede recuperar.
node apps/web/scripts/beaos-tokens.mjs create autex

# Listar con prefijo, último uso y estado (activo / revocado).
node apps/web/scripts/beaos-tokens.mjs list

# Revocar por prefijo.
node apps/web/scripts/beaos-tokens.mjs revoke beaos_ab
```

El script lee `DATABASE_URL` del entorno o de `apps/web/.env` / `.env`. La tabla la crea la migración
`packages/lib/src/db/migrations/0023_broken_stepford_cuckoos.sql` (generada con `drizzle-kit generate`).

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
- `11` pruebas del registro (`src/server/mcp/__tests__/tools.test.ts`): nombres únicos, `inputSchema` de objeto, campos obligatorios descritos, el registro completo, y que los handlers no se publican por el protocolo.
- `13` pruebas de la credencial por producto (`src/lib/__tests__/api-tokens.test.ts`): token válido, revocado (que no cae al fallback), desconocido, fallback a `ADMIN_API_KEYS`, token ausente y lectura del header.

## Lo que falta

- **Dogfooding:** BeAOS todavía no publica su **propio** `/.well-known/mcp/server-card.json` en la raíz de
  `beaos.believe-global.com` apuntando a este endpoint. Hoy el server-card se emite dentro del bundle de
  cada entidad, leyendo el MCP que el sitio ya publica.
