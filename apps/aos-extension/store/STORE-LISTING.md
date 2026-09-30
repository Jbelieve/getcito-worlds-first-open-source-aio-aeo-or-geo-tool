# Ficha para Chrome Web Store — BeAOS

Todo lo de abajo es para copiar y pegar en el formulario de publicación
(https://chrome.google.com/webstore/devconsole). Cada bloque indica en qué campo va.

**Estado: sin publicar.** El zip lo deja `bash scripts/release-extension.sh`; publicar es un paso
humano desde el dev console.

---

## Versión del paquete

```
2.1.1
```

La versión sale del `manifest.json`, así que el nombre del zip (`dist/beaos-extension-2.1.1.zip`) la
dice sola. La 2.1.1 es un **arreglo**, no un rediseño: la 2.1.0 le mandaba al endpoint el dominio
pelado (sin `https://` y sin path), que el endpoint rechaza, así que no auditaba ninguna web. Ahora
manda la URL completa de la pestaña —con su path, para medir la página que se está viendo— y los
errores de dirección distinguen "no se pudo interpretar" de "queda afuera por seguridad". No cambia
nada de lo que el popup muestra.

---

## Nombre (campo "Name", máx. 45 caracteres)

```
BeAOS — Agent Operability & Preference Score
```

## Descripción corta (campo "Summary", máx. 132 caracteres)

```
¿Un agente de IA puede OPERAR tu sitio y además preferirlo? Mide el AOS™ y el APS de cualquier web al instante.
```

## Categoría

```
Herramientas para desarrolladores  (Developer Tools)
```
Alternativa válida: Productividad.

## Idioma principal

```
Español (Latinoamérica)
```

## Descripción detallada (campo "Description")

```
SEO te posiciona. GEO te menciona. AOS™ y APS miden algo más nuevo todavía: ¿puede un agente de
IA OPERAR tu sitio, y además PREFERIRLO? Es decir, llenar un formulario, reservar, completar una
acción real — no solo leerlo.

Con un click, BeAOS audita cualquier web que estés visitando y devuelve las dos medidas:

• Un score de 0 a 100 y su banda (Operable, Intentable, Bloqueado, Inerte).
• El puntaje desglosado por eje (AOS y APS): cuánto saca cada uno, cuántos requisitos pasan sobre
  los que aplican, y cuánto peso se ganó sobre el que había en juego.
• El listado COMPLETO de requisitos, sin recortar: qué es cada uno, de qué eje, si pasa o no, y qué
  se vio al comprobarlo. Cuando un requisito no aplica a tu tipo de negocio, se dice.
• Cuántos puntos AOS/APS devolvería arreglar cada cosa que falta, ordenado por impacto.
• Los diagnósticos aparte: se informan y no mueven el score, así que no se les inventan puntos.
• El perfil firmado del sitio: qué APS declara sobre sí mismo, cuántas pruebas publica y si su
  firma Ed25519 verifica de verdad contra las claves que él mismo sirve. Cuando verifica, el sitio
  se lleva el badge Agent-Preferred; cuando no, no hay badge.

Y el modo estrella: "Ver en la página". Resalta sobre la web real, en verde y rojo, exactamente
qué acciones puede ejecutar un agente y cuáles no. Lo que ve un agente, visible para vos.

Para quién es:
• Marketers y agencias que quieren saber si sus sitios (y los de la competencia) están listos para
  la era de los agentes de IA.
• Founders y equipos de producto que se preparan para que ChatGPT, Claude, Perplexity y otros
  agentes operen sus sitios.

Medir es gratis y no hace falta dejar el correo. Si querés que tu web sea operable y preferida por
agentes, lo dejás y el equipo de Believe te contacta.

AOS™ (Agent Operability Score) y APS (Agent Preference Score) son los dos puntajes del estándar
que BeAOS mide. BeAOS es parte de la infraestructura de marca para la era de agentes que construye
Believe. Más en be-aos.believe-global.com.
```

## Justificación de permisos (campo "Permission justification" — Google lo pide para cada uno)

**activeTab**
```
Se usa solo cuando el usuario hace click en el icono: la extensión lee el dominio de la pestaña
activa para auditarlo. No accede a otras pestañas ni corre en segundo plano.
```

**scripting**
```
Para el modo "Ver en la página": al pedirlo el usuario, inyecta un script que resalta sobre la
página los formularios y acciones que un agente puede o no ejecutar. Se inyecta solo en la pestaña
activa y solo a pedido del usuario.
```

**storage**
```
Guarda localmente el resultado del último audit por dominio (caché de 10 minutos) para no repetir
la consulta al abrir el popup. No guarda datos personales sin que el usuario los ingrese.
```

**host_permissions: https://beaos.believe-global.com/***
```
Único servidor al que la extensión envía consultas: la API pública de BeAOS, que audita la URL y
devuelve el score. Son dos endpoints públicos y no requieren credencial. No se contacta ningún otro
host.
```

## Declaración de manejo de datos (campo "Privacy practices" / "Data usage")

Marcar que la extensión recolecta:
- **Actividad web** (el dominio/URL que el usuario elige auditar) → para prestar la funcionalidad
  (auditar ese sitio).
- **Información de contacto** (email) → SOLO si el usuario lo ingresa voluntariamente en la tarjeta
  de contacto; se usa para que Believe le ofrezca optimizar su sitio.

Declarar:
- [x] No se venden datos a terceros.
- [x] No se usan para fines ajenos a la funcionalidad principal.
- [x] No se usan para verificar identidad ni para crédito.

URL de la política de privacidad: (publicar PRIVACY-POLICY.md y pegar la URL aquí)

## Visibilidad sugerida

Empezar como **No listada (Unlisted)**: pasa la misma revisión de Google pero no aparece en
búsquedas — se comparte por link. Ideal para probar con clientes y el equipo. Cuando esté rodada,
cambiar a **Pública** con un click.
