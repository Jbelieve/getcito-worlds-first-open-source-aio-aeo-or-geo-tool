---
"@workspace/web": minor
---

BeAOS ahora tiene un servidor MCP, para que otros productos lo operen sin integraciones a medida.

`POST /mcp` habla JSON-RPC 2.0 y expone ocho tools: listar y leer marcas, leer la auditoría AOS de una
entidad con su APS declarado, listar las corridas de APS medido con su banda y su P10–P90, leer el
manifiesto del bundle agéntico publicado, leer un archivo suelto del bundle byte a byte, y generar y
publicar el bundle. Se autentica con el mismo token de administración que ya protege `/api/v1`.

Las lecturas pasan por el mismo gate de publicación que la API de entrega —un bundle sin publicar no se
puede leer por el MCP— y las acciones son las mismas que corren desde la interfaz, incluido el guardián
que rechaza publicar un perfil con menos claims que el que el sitio ya sirve.
