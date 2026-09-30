# Cómo conectar un producto de Believe al MCP de BeAOS

Para que un producto (Believable, Autex, el que sea) genere **todo** lo que necesita una marca para ser
operable por agentes: sus archivos firmados, sus pruebas, y su medición.

Reemplazá `NOMBRE-DEL-PRODUCTO` por el nombre real.

---

## 0 · Lo que hay que tener a mano

| Dato | Valor |
|---|---|
| **Endpoint del MCP** | `https://beaos.believe-global.com/mcp` |
| **Credencial** | un token por producto (paso 1) |
| **Marca de Believe** | `brandId` = **`default`** |
| **La entidad paraguas de Believe** | `598d73a6-d6e9-427e-87d1-d26452cffe79` |
| **Proyecto de Maasy del producto** | el id del proyecto (si ya existe) |

> La entidad de Believe figura como tipo `product` y es la **raíz** de su jerarquía, así que hace de
> paraguas. Un producto nuevo se cuelga de ella con `parentEntityId`.

---

## 1 · La credencial del producto

Cada producto tiene **su propio token**, revocable sin afectar a los demás. En el servidor:

```bash
cd /root/BeAos
scripts/beaos-token.sh create NOMBRE-DEL-PRODUCTO
```

Imprime el token **una sola vez**. Se guarda solo su `sha256`: si se pierde, se revoca y se crea otro.

Para revocarlo: `scripts/beaos-token.sh revoke <prefijo>`.

---

## 2 · La conexión

En el cliente MCP del producto (formato estándar):

```json
{
  "mcpServers": {
    "beaos": {
      "type": "http",
      "url": "https://beaos.believe-global.com/mcp",
      "headers": { "Authorization": "Bearer <TOKEN-DEL-PRODUCTO>" }
    }
  }
}
```

Si el producto lo llama por HTTP directo:

```bash
curl -s https://beaos.believe-global.com/mcp \
  -H 'content-type: application/json' \
  -H "authorization: Bearer $BEAOS_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

**Importante:** el token va **server-side**, nunca en el navegador.

---

## 3 · La secuencia, en orden

Cada paso es una llamada `tools/call`. El orden no es decorativo: cada uno necesita el id que devuelve el
anterior.

### 3.1 · Crear la entidad del producto

```json
{"name":"ensure_entity","arguments":{
  "brandId":"default",
  "name":"BELIEVABLE",
  "websiteUrl":"https://believable.believe-global.com",
  "entityType":"product",
  "parentEntityId":"598d73a6-d6e9-427e-87d1-d26452cffe79",
  "maasyProjectId":"<el-proyecto-de-maasy-si-existe>"
}}
→ { "entityId": "…", "created": true }
```

- **Idempotente**: si ya existe una entidad con esa web (o con ese proyecto de Maasy), devuelve la misma
  con `created: false`. Se puede llamar de nuevo sin miedo.
- **`parentEntityId`** es lo que la cuelga de Believe. Sin eso queda suelta en la raíz.
- Si el producto va a ser **su propia marca** (no un producto de Believe), primero:
  `ensure_brand` con `{name, website, targetMarket, targetLanguage}` → te da su `brandId`, y después usás
  ese `brandId` en todos los pasos siguientes.

### 3.2 · Traer el Brand DNA (si tiene proyecto de Maasy)

```json
{"name":"sync_brand_dna","arguments":{"brandId":"default","entityId":"<entityId>"}}
→ { "synced": true, "syncedAt": "…", "hasClaims": false, "maasyProjectId": "…" }
```

`hasClaims` es la señal honesta: hoy **siempre va a decir `false`**, porque Maasy no manda claims. La
evidencia viene en prosa y las pruebas se cargan en el paso siguiente.

Sin proyecto de Maasy, se saltea: el producto igual funciona, con menos contexto de marca.

### 3.3 · Cargar las pruebas del producto

Una llamada por prueba:

```json
{"name":"upsert_claim","arguments":{
  "brandId":"default",
  "entityId":"<entityId>",
  "claimId":"CLM-LANZAMIENTO-01",
  "statement":"Believable entregó su primer lote de 2.000 unidades en 45 días.",
  "status":"confirmed",
  "proofType":"case_study",
  "proofTitle":"Reporte de producción — lote piloto",
  "metric":"2.000 unidades en 45 días",
  "boundaryApplicableFor":"Productos con cadena de producción propia ya operando.",
  "boundaryNotApplicableFor":"Marcas que recién empiezan y no tienen producción.",
  "verifiableBy":"signed_client",
  "confidentiality":"public",
  "sourceFragment":"reporte interno de producción, agosto 2026"
}}
→ { "claim": {…}, "warnings": [] }
```

**Lo que hay que respetar:**

- **`claimId` con el formato `CLM-…`** en mayúsculas, números y guiones. Otro formato se rechaza.
- **`boundary` obligatorio** (`boundaryApplicableFor` y `boundaryNotApplicableFor`). Es lo que separa una
  afirmación honesta de marketing vacío, y el estándar lo exige.
- **`verifiableBy`** es cómo lo comprueba un agente. Si se omite, la prueba queda declarada como **no
  verificable**.
- **`status: "confirmed"`** es lo que la hace entrar al perfil. Un `draft` **no se publica**.
- Los `warnings` que devuelve son los avisos del estándar. **Si no está vacío, hay que leerlo.**

**Y lo que hereda solo:** el producto hereda automáticamente las pruebas de Believe marcadas como
`inheritable`. Hoy hay **una**: la de marca ("más de 100 proyectos instalados"). Heredar un **caso de
cliente** no se hace nunca, porque el producto estaría afirmando algo que no hizo — y el perfil lo declara
como `[Heredada del paraguas Believe]`.

Para marcar una prueba como heredable: `set_claim_inheritable` `{brandId, entityId, claimId, inheritable}`.
Se marca en el **paraguas**, no en el producto.

### 3.4 · Generar los archivos

```json
{"name":"generate_agent_assets","arguments":{"brandId":"default","entityId":"<entityId>"}}
→ { "count": 15, "assets": [ { "path": "/llms.txt", "sha256": "…" }, … ] }
```

Hasta **15 archivos**, y **no siempre son 15**: cada superficie se emite solo cuando hay un dato honesto
que la sostenga. Si el sitio del producto no declara MCP, no hay `server-card`; si no declara contacto de
seguridad, no hay `security.txt`. **Que falte uno es información, no un error.**

### 3.5 · Publicar (el candado)

```json
{"name":"publish_agent_assets","arguments":{"brandId":"default","entityId":"<entityId>","published":true}}
→ { "ok": true, "isPublished": true, "publishedAt": "…" }
```

Y si el candado se niega:

```json
{ "ok": false, "reason": "El perfil del sitio declara 6 claims y el bundle declara 0. …" }
```

**Publicar es la puerta deliberada del producto**: nada se entrega a un agente hasta que un humano —o el
producto, en su nombre— lo aprueba, y **nunca** algo peor que lo que el sitio ya muestra.

### 3.6 · Leer lo que quedó publicado

```
get_agent_bundle  { "entityId": "…" }                    → el manifiesto con el sha256 de cada archivo
get_agent_asset   { "entityId": "…", "path": "/.well-known/brand.json" }  → el contenido byte a byte
```

Y el sitio del producto puede montarlos desde la URL pública, sin credencial:

```
https://beaos.believe-global.com/agent/<entityId>/.well-known/brand.json
```

### 3.7 · Medir (opcional)

```
ensure_prompt_library  { brandId, entityId }        → genera la biblioteca y la devuelve para revisar
start_aps_run          { brandId, entityId }        → encola la corrida y devuelve el costo estimado
list_aps_runs          { entityId }                 → estado y resultado por modelo
get_aps_score_detail   { entityId }                 → dimensiones, subMétricas y competidores
```

**Una corrida completa de 4 modelos cuesta ≈ USD 3,7** y tarda 10–20 minutos. Hay un techo mensual
(`APS_MONTH_BUDGET_USD=600`): al alcanzarlo, las corridas se frenan en vez de gastar de más.

---

## 4 · El ciclo, en una línea

```
ensure_entity → sync_brand_dna → upsert_claim → generate_agent_assets → publish_agent_assets
```

Y después, para medir y mejorar:

```
ensure_prompt_library → start_aps_run → list_aps_runs → get_aps_score_detail
```

---

## 5 · Lo que hay que saber antes de conectar

1. **Cada producto tiene su token.** Revocar uno no afecta a los otros.
2. **Toda lectura es por `brandId` o `entityId`.** Ninguna herramienta devuelve datos de marcas mezcladas.
3. **BeAOS no inventa pruebas.** Si el producto no tiene evidencia, el perfil sale con las heredadas del
   paraguas y nada más. Eso es correcto, no un defecto.
4. **Que un archivo no se genere significa que falta el dato**, no que algo se rompió. El menú **Plan**
   dice exactamente cuál falta y cómo conseguirlo.
5. **Hay 27 herramientas.** El ciclo de arriba es el camino corto; el resto son lecturas (visibilidad,
   share of voice, citas, oportunidades, reportes) y utilidades.
