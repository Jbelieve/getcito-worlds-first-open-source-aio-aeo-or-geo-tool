# Instrucción: el widget "mide tu web" usa BeAOS, no el AOS de Maasy

**Para el agente que construye el widget en la landing.** Puntual, sin interpretación.

---

## 1 · Qué hay que reemplazar

| | |
|---|---|
| **Sacar** | la llamada al AOS/APS de Maasy (tu Supabase / `aos-audit-url`) |
| **Poner** | `POST https://beaos.believe-global.com/api/v1/aos/audit` |

**No hay credencial.** Es un endpoint público a propósito. No hay token, no hay API key, no hay `Authorization`.

```js
const res = await fetch("https://beaos.believe-global.com/api/v1/aos/audit", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ url: urlDelVisitante }),
});

if (res.status === 429) {
  const limite = res.headers.get("RateLimit-Limit");      // ← el cupo REAL, no uno inventado
  const espera = res.headers.get("Retry-After");          // ← segundos
  // mostrá el cupo que vino y CUÁNDO puede volver
}
const data = await res.json();
```

### Reglas del pedido — las tres que se rompen siempre

1. **Llamalo desde el navegador del visitante, NO desde el backend de la landing.**
   Si llama el backend, **todos los visitantes salen con la IP del servidor** y se comen entre todos el cupo diario. Desde el navegador, cada uno usa la suya. El CORS ya está habilitado para: `be-aos.believe-global.com`, `www.be-aos.believe-global.com`, `believe-global.com`, `www.believe-global.com`.
2. **Mandá la URL completa, con `https://` y con el path.** El endpoint **tolera** un dominio pelado (`sitio.com` → `https://sitio.com/`), pero **si mandás el dominio pelado perdés el path**: quien está en `sitio.com/precios` termina auditando la home. **Mandá `location.href` tal cual.**
3. **No lo llames en bucle.** Una auditoría por clic del visitante. No midas en cada tecla ni al montar el componente.

---

## 2 · La respuesta: 13 claves, y ninguna se inventa

```jsonc
{
  "url": "https://ejemplo.com/precios",   // normalizada
  "score": 0,                             // 0..100
  "band": "Agent-Inert",                  // ver tabla
  "businessType": "brand",                // "brand" | "product_api"
  "requirements": [                       // el checklist COMPLETO
    {
      "id": "AOS-DISC-01",
      "axis": "AOS",                      // "AOS" | "APS"
      "strength": "RECOMENDADO",          // OBLIGATORIO | RECOMENDADO | OPCIONAL
      "title": "llms.txt",
      "status": "pass",                   // pass | fail | n_a
      "evidence": "/llms.txt responde 200 · text/plain · 10555 chars.",  // PUEDE FALTAR
      "gain": 18.8,                       // SOLO en los que puntúan y fallan
      "diagnostic": false                 // true = NO mueve el score
    }
  ],
  "aosStandards": 100,       // lo que MEDIMOS de operabilidad (0..100)
  "apsStandards": 100,       // lo que MEDIMOS de preferencia (0..100)
  "breakdown": [             // por eje, con los pesos reales
    { "axis": "AOS", "passed": 7, "failed": 0, "notApplicable": 1, "applicable": 7,
      "earnedWeight": 16, "maxWeight": 16, "percent": 100 }
  ],
  "declaredAps": 94,         // lo que el sitio DECLARA (null si no publica perfil) ← NO es apsStandards
  "claims": 6,               // cuántas pruebas declara
  "signatureVerified": true, // si su firma Ed25519 verifica contra el keys.json del propio sitio
  "botBeacon": null,         // SIEMPRE null: no tenemos esa fuente
  "auditedAt": "2026-09-30T…"
}
```

### Bandas (para etiquetar)

| AOS | | APS | |
|---|---|---|---|
| ≥ 80 | Agent-Operable | ≥ 85 | agent_native |
| ≥ 60 | Agent-Attemptable | ≥ 70 | agent_ready |
| ≥ 35 | Agent-Blocked | ≥ 50 | agent_visible |
| < 35 | Agent-Inert | ≥ 25 | agent_opaque |
| | | < 25 | agent_blind |

---

## 3 · Las siete reglas que NO se reinventan

El criterio completo está en **`AOS-VISTA.md`** (repo de BeAOS). Estas siete son las que se rompen:

1. **`n_a` se dice: "no aplica".** No se esconde ni se cuenta como falla.
2. **`evidence` puede faltar, y cuando está SE MUESTRA.** Es lo que hace que el listado se vea robusto en vez de un sí/no pelado. Ejemplo real: `/llms.txt responde 200 · text/plain · 10555 chars`.
3. **`gain` solo existe en los que puntúan y fallan.** Si no viene, no se muestra un `+0`.
4. **Los `diagnostic: true` van SEPARADOS y SIN PUNTOS.** No mueven el score: se informan. **No les inventes una ganancia.**
5. **`declaredAps` NO es `apsStandards`.** Uno es lo que el sitio **declara** (94 en believe-global.com), el otro lo que **nosotros medimos**. Van etiquetados distinto: *"Perfil firmado del sitio"* vs *"APS medido"*. **Sumarlos o mezclarlos es un error.**
6. **`botBeacon` es `null` siempre.** Se dice el hueco **con palabras y SIN UN SOLO DÍGITO**: *"BeAOS mide el estándar de un sitio, no su tráfico."* **Un `0` se lee como "no te visitó ningún agente", que es distinto de "no lo sabemos".**
7. **El badge "perfil firmado verificado" SOLO con `signatureVerified === true`.** Sin versión "apagada": un badge apagado igual afirmaría que está verificado.

---

## 4 · Los errores, con el texto exacto

| Status | Qué pasó | Qué decir |
|---|---|---|
| **400** `code: "invalid_url"` | no se pudo interpretar la dirección | *"No se pudo interpretar la dirección. Probá con una dirección completa, con su `https://`."* |
| **400** `code: "blocked_url"` | queda afuera por seguridad | *"Esa dirección queda afuera por seguridad."* |
| **429** | cupo del día agotado | el cupo **de `RateLimit-Limit`** y **cuándo** puede volver, de `Retry-After` |
| **504** | tardó demasiado | *"La medición tardó demasiado. Probá de nuevo."* |

**Tres cosas de los errores que importan:**

- **El `code` distingue los dos 400** y son cosas distintas: *"no entendimos la dirección"* ≠ *"está bloqueada"*. No los juntes en un mensaje genérico.
- **El mensaje del bloqueo NO enumera qué se bloquea.** Nada de *"localhost, redes internas o metadatos de nube"*: eso le enseña a un atacante qué buscar y a un usuario normal no le sirve. Solo **"queda afuera por seguridad"**.
- **El número del cupo SALE DEL SERVIDOR.** Nunca lo hardcodees. Y **sin la cabecera, el mensaje va sin cifra**: *"El cupo se renueva a la medianoche UTC."* Es preferible no decir un número a decir uno falso.

### Cabeceras que SÍ podés leer desde el navegador

```
RateLimit-Limit · RateLimit-Remaining · RateLimit-Reset · RateLimit-Policy · Retry-After
```

Están expuestas por CORS a propósito. **La combinada `RateLimit` NO se puede leer** — usá las cinco de arriba.

**Humanizá la espera**: `Retry-After` son segundos → *"en 45 min"*, *"en 3 h 20 min"*.

---

## 5 · Lo que este endpoint NO hace

- **No crea nada.** Ni entidad, ni marca, ni registro, ni lead. Es **sin estado**: el visitante mide y se va. No persiste nada.
- **No pide cuenta ni mail.** Es gratis y anónimo.
- **No audita direcciones internas** (`localhost`, IPs privadas, metadatos de nube): las rechaza por seguridad.
- **No mide el tráfico del sitio.** `botBeacon` viene `null`.

> **Y esto es otra cosa, que no se mezcla:** si la landing tiene que ser **operable por agentes** (sus propios archivos, sus pruebas, su APS), eso va por **MCP** con **su propio token** — `bash scripts/beaos-token.sh create landing` — y el ciclo `ensure_entity` → `sync_brand_dna` → `upsert_claim` → `generate_agent_assets` → `publish_agent_assets`. **Eso sí deja entidad y assets. El widget no.**

---

## 6 · Cómo verificar que quedó bien

**1 · El endpoint responde** (desde tu máquina, sin credencial):

```bash
curl -s -X POST https://beaos.believe-global.com/api/v1/aos/audit \
  -H 'content-type: application/json' \
  -d '{"url":"https://believe-global.com"}'
```

Tiene que devolver `200` con las 13 claves y `"score": 100`.

**2 · El CORS desde el origen de la landing:**

```bash
curl -s -D - -o /dev/null -X POST https://beaos.believe-global.com/api/v1/aos/audit \
  -H 'Origin: https://be-aos.believe-global.com' \
  -H 'content-type: application/json' -d '{"url":"example.com"}' | grep -i access-control
```

Tienen que aparecer `access-control-allow-origin` **y** `access-control-expose-headers`.

**3 · El pedido real, no el mapeo.** En la pestaña del navegador, mirá la request en la pestaña Network: el body tiene que llevar **`http(s)://` y el path**, no un dominio pelado.

> ⚠️ **Verificá el PEDIDO, no solo la pantalla.** Nos pasó: el popup se veía impecable mientras **todos** los pedidos reales eran inválidos, porque un stub devolvía la respuesta cocinada. **Un stub que devuelve la respuesta cocinada esconde un pedido mal armado.**

**4 · Los datos, contra un caso conocido.** Auditá `https://believe-global.com` y comparalo con esto:

```
score 100 · Agent-Operable
aosStandards 100 · apsStandards 100
declaredAps 94 · claims 6 · signatureVerified true
11 requisitos que puntúan (0 en falta, 1 "no aplica") · 8 diagnósticos
```

Si los números coinciden, está bien cableado.
