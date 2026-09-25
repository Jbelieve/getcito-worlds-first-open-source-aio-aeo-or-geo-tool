# El MCP de BeAOS

**Endpoint:** `https://beaos.believe-global.com/mcp`
**Transporte:** JSON-RPC 2.0 sobre `POST` (sin SSE, sin sesión)
**Auth:** `Authorization: Bearer <clave>` — o `x-api-key: <clave>`

Existe para que los demás productos de Believe —Maasy, BeAds, el agente de una marca— **operen BeAOS sin
escribir una integración a medida**. Antes lo único que BeAOS exponía era una API REST; "otro producto",
en la práctica, es un agente, así que el mismo trabajo se ofrece como tools.

La clave es la misma que ya protege `/api/v1`: la lista `ADMIN_API_KEYS` del `.env` del servidor. No hay
infraestructura nueva: Traefik ya enruta `beaos.believe-global.com`, así que el MCP vive en el mismo
dominio de la app.

## Los tools

| Tool | Qué hace |
|---|---|
| `list_brands` | Lista las marcas, con su id, web y dominios. Es por donde se empieza si no se sabe el id. |
| `get_brand` | Una marca y sus entidades (paraguas y productos), con el `entityId` que piden los demás tools. |
| `get_aos_audit` | Última auditoría AOS de una entidad: score, banda, tipo de negocio y el detalle requisito por requisito. Incluye el **APS declarado**. |
| `list_aps_runs` | Corridas de **APS medido**: score por modelo, banda, observaciones, P10–P90 y si la corrida salió parcial. |
| `get_agent_bundle` | Manifiesto del bundle agéntico publicado: cada ruta con su `sha256` y su tamaño. Sin el contenido. |
| `get_agent_asset` | El contenido **exacto** de un archivo del bundle (por ejemplo `/.well-known/brand.json`), con su hash. |
| `generate_agent_assets` | Genera o regenera el bundle desde el Brand DNA. Lo deja guardado, **no** lo publica. |
| `publish_agent_assets` | Abre o cierra el gate de publicación de una entidad. |

## Dos reglas que no se negocian

1. **La lectura pasa por el mismo gate que la API de entrega.** `get_agent_bundle` y `get_agent_asset`
   usan `loadAssetBundle`, que devuelve `null` mientras la entidad no esté publicada. El MCP **no puede
   filtrar** un bundle que un operador todavía no aprobó, y ningún tool arma el bundle por su cuenta.
2. **Las acciones son las mismas de la UI.** `generate_agent_assets` y `publish_agent_assets` llaman a
   `agent-assets-core`, que es exactamente lo que corre cuando el operador aprieta el botón. Si el
   **guardián de claims** bloquea una publicación, el bloqueo también aparece por acá: no hay una puerta
   más permisiva para los agentes.

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
      "headers": { "Authorization": "Bearer <clave>" }
    }
  }
}
```

## Detalles de protocolo que importan

- Una **notificación** (sin `id`) responde `202` y sin cuerpo, como pide el protocolo. `notifications/initialized` no ejecuta nada.
- Un **método** desconocido es error `-32601`. Un **tool** desconocido es `-32602`, y el mensaje lista los que hay.
- Un **tool que falla** no es un error de protocolo: devuelve `isError: true` con el motivo en texto, para que el modelo pueda leerlo y corregir. Un `entityId` mal formado, por ejemplo, dice que se esperaba un UUID.
- `GET /mcp` responde `405`: este servidor no abre stream por GET, y decirlo evita que un cliente se quede esperando un stream que nunca abre.
- **Sin `Mcp-Session-Id`**: el estado no vive en el servidor, así que cualquier instancia atiende cualquier request y un reinicio no rompe a nadie.

## Qué se verificó

- `21` pruebas del protocolo (`src/server/mcp/__tests__/jsonrpc.test.ts`): parseo, `initialize`, `ping`, `tools/list`, `tools/call`, notificación sin respuesta, métodos y tools desconocidos, y que un handler que revienta sale como contenido.
- `7` pruebas del registro (`src/server/mcp/__tests__/tools.test.ts`): nombres únicos, `inputSchema` de objeto, campos obligatorios descritos, y que los handlers no se publican por el protocolo.
- Contra un servidor corriendo: `401` sin token, `initialize` y `tools/list` con token, `202` para una notificación, `-32602` para un tool inexistente, `isError` legible para un UUID inválido, `405` en `GET`.

## Lo que falta

- **Dogfooding:** BeAOS todavía no publica su **propio** `/.well-known/mcp/server-card.json` en la raíz de
  `beaos.believe-global.com` apuntando a este endpoint. Hoy el server-card se emite dentro del bundle de
  cada entidad, leyendo el MCP que el sitio ya publica.
- **Un token por producto.** Hoy todos comparten `ADMIN_API_KEYS`: no hay identidad por producto ni forma
  de revocarle la clave a uno solo sin cambiársela a todos.
