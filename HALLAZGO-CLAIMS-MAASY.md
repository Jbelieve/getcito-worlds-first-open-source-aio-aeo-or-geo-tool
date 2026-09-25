# Por qué BeAOS no puede publicar nada: el hallazgo

Medido hoy (2026-09-25) contra Maasy en producción, con la credencial ya funcionando.
Esta es la respuesta completa a *"¿qué falta?"*.

---

## 1. La credencial ya funciona

`list_brands` y `get_brand_context` devuelven **200**. El botón **Cargar marcas Maasy** vuelve a andar.

La causa de que estuviera roto era nuestra: el gateway de Maasy acepta una **API key** de perfil (`x-api-key`,
que **no expira**) y un **token OAuth** (que **sí expira**), y BeAOS usaba el que expira. Ya se prefiere la
API key (`MAASY_MCP_API_KEY`).

## 2. El hallazgo: Maasy **no tiene** la capa de Claims & Proofs

El contexto de marca de Believe son **58.613 bytes** con más de 40 campos. Están todos los de identidad,
tono, ICP, oferta, competencia… y **no existen estos dos**:

```
claims:  undefined
proofs:  undefined
```

No es que vengan vacíos: **los campos no existen** en el modelo de Maasy. Y acá está lo grave:

```json
"completeness": { "score": 100, "missing": [] }
```

**Maasy dice que el perfil de marca está 100% completo, y no tiene ninguna prueba.** El modelo de
completitud no conoce la capa de Claims & Proofs, así que **nadie recibe la alarma** de que falta lo más
importante para que un agente pueda verificar la marca.

Mientras tanto, `believe-global.com` sirve **6 claims con sus 6 pruebas** y declara un **APS de 94**. Esas 6
salieron de otro lado (se escribieron a mano, o las produjo la herramienta AOS), no del contexto de marca.

## 3. La materia prima **sí existe**, pero está en prosa

Esto es lo que más importa: la evidencia está, sin estructurar.

| Campo | Contenido real |
|---|---|
| `references_summary` | **"23 referencias subidas (sin analizar)"** |
| `client_results` | *"Aumento promedio de 35% en tasa de conversión y crecimiento sostenido de 20% en ventas tras instalar el sistema MAAS™…"* |
| `testimonials` | *"Con Believe y la metodología MAAS™ dejamos de gas…"* |
| `social_proof_count` | *"Más de 100 proyectos instalados con la metodología…"* |

**Hay 23 documentos subidos que nadie analizó, y tres resultados con números escritos como texto.** Eso es
exactamente un claim con su prueba: *"35% de aumento en tasa de conversión"* es una afirmación verificable, y
el documento que la respalda está entre esas 23 referencias.

Nadie los convirtió en la estructura que un agente necesita leer.

## 4. Por qué BeAOS **no** lo puede arreglar solo

Sería fácil escribir un parser que convierta esa prosa en `claims[]`. **No se hace, y es una decisión, no una
falta de tiempo:**

- El estándar lo dice: *"AOS links proofs, it does not create them"*.
- Si BeAOS convierte una frase en un claim, **inventa evidencia**. Un agente que lea "35% de aumento,
  verificado" y después pregunte por la prueba va a encontrar un documento que quizá no dice eso.
- Un dato inventado en la capa de confianza es peor que la ausencia del dato: destruye lo único que la marca
  está vendiendo, que es que lo que dice se puede verificar.

Por eso el candado **bloquea** en vez de rellenar. Está haciendo su trabajo.

## 5. Las salidas, en orden de honestidad

**A) En Maasy (la correcta).** Agregar `claims[]` y `proofs[]` al contexto de marca y analizar las 23
referencias. **Y corregir el modelo de completitud**: un perfil sin pruebas **no puede dar 100%**, porque hoy
el 100% es lo que esconde el problema. Es trabajo de Maasy, y es el único camino que produce claims de verdad.

**B) En BeAOS, con el humano en el medio (legítima).** Mostrarle al operador los fragmentos de evidencia que
Maasy ya manda —los resultados con números, el testimonio, las 23 referencias— y pedirle que **confirme**
cuáles son claims y con qué documento se prueban. BeAOS ayuda a estructurar; **no decide**. La diferencia con
un parser automático es la misma que entre un formulario y una firma.

**C) Copiar los 6 claims del sitio.** `believe-global.com` ya los sirve firmados. Se pueden leer y usar como
los claims de la marca. **Pero es una foto, no una fuente**: el día que cambien en el sitio, BeAOS va a seguir
sirviendo los viejos sin saberlo. Sirve para desbloquear hoy, no como solución.

## 6. El orden para desbloquear

1. ~~Credencial de Maasy~~ **hecho**.
2. **Claims con sus pruebas** — por A, o por B si querés desbloquear antes.
3. **Publicar** la entidad (el candado ya lee el sitio: bloquea y dice por qué).
4. **El 404 desaparece** y la entrega funciona: API, URL pública, agentes montando los archivos.

---

## Lo que queda dicho para que no se pierda

- **Maasy reporta 100% de completitud sin ninguna prueba.** Eso no es un detalle de Maasy: es un número que
  miente, y mientras mienta nadie va a arreglar la capa que decide si un agente te cita o no.
- **BeAOS no inventa evidencia, y prefiere bloquear antes que publicar algo peor que lo que ya está.** La
  entidad de Believe sigue sin publicar y eso es correcto.
