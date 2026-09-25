---
"@workspace/aos-aps": patch
"@workspace/web": patch
---

El server-card de los assets agénticos ahora declara también los tools del MCP, no solo su dirección.

El bundle emitía `/.well-known/mcp/server-card.json` con la URL del MCP pero con `tools: []` fijo: un
agente que lo leía sabía dónde estaba el servidor y no qué podía pedirle, y la lista vacía afirmaba que
no había ninguna herramienta. Los tools se copian del card que el sitio ya publica —igual que la URL, sin
inventar capacidades— y cuando el sitio no los declara la clave se omite, en vez de afirmar que no hay.
