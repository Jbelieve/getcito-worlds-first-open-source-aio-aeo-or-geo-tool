# Manual de uso — BeAOS

BeAOS es la instancia self-hosted de GetCito para Believe. Mide visibilidad, citas y oportunidades de marca en buscadores con IA como ChatGPT, Google AI Mode, Gemini, Perplexity y Copilot.

## 1. Acceso

- URL: https://beaos.believe-global.com
- Login: https://beaos.believe-global.com/auth/login
- El primer usuario de la instancia queda como admin global y admin de la organización default.
  Las siguientes altas de usuario no están habilitadas en modo local.

## 2. Primeros pasos

1. Inicia sesión.
2. Si no existe un brand, BeAOS te lleva al onboarding.
3. Pega el dominio de la marca.
4. Revisa y ajusta los productos, competidores, alias y prompts sugeridos.
5. Confirma. Se crea la organización, el brand y los prompts iniciales.
6. El worker empieza a programar y ejecutar prompts según la configuración.

## 3. Navegación principal

La barra lateral se divide en:

- Dashboard: Overview, Visibility, Share of Voice, Query Fan-Out, Citations, Opportunities.
- Settings: Brand, Competitors, Prompts, LLMs.
- Admin: Brands, Reports, Workflows, Queue, API Usage, Tools.

En modo local una persona puede administrar varios brands. Cada brand vive en una organización propia y se cambia desde el selector de organización o desde la URL /app/<brand>.

## 4. Dashboard

### Overview

Resumen ejecutivo del brand: visibilidad, tendencias, modelos activos y últimos resultados. Sirve para detectar caídas o mejoras recientes.

### Visibility

Evolución de la visibilidad por prompt, modelo y rango de fechas. Permite comparar contra competidores y ver snapshots históricos.

### Share of Voice

Participación de la marca frente a competidores en el conjunto de prompts. Se expresa como porcentaje de menciones o citas.

### Query Fan-Out

Consultas derivadas o búsquedas relacionadas que los motores de IA generan alrededor de un prompt. Ayuda a entender qué temas asociados aparecen.

### Citations

Fuentes, dominios y URLs citadas por los motores. Sirve para detectar oportunidades de contenido, PR y autoridad.

### Opportunities

Acciones sugeridas para mejorar visibilidad: contenido, menciones, comparativas, datos estructurados, etc.

## 5. Prompts

Los prompts son las consultas que BeAOS envía a los motores de IA.

- Crear: Settings > Prompts o el flujo de onboarding.
- Editar: nombre, texto, modelo habilitado, prioridad y frecuencia.
- Ejecutar: manualmente desde la UI o dejar que el scheduler lo haga.
- Historial: cada prompt guarda snapshots con fecha, respuesta, citas y métricas.
- Modelos por prompt: se configuran en Settings > LLMs.

## 6. Settings

### Brand

Datos de marca: nombre, dominio principal, dominios adicionales, aliases, productos y competidores. Desde aquí también se puede eliminar el brand con cuidado.

### Competitors

Alta, edición y borrado de competidores. Se usan para benchmarks y Share of Voice.

### Prompts

Listado completo de prompts, estado, frecuencia y última ejecución.

### LLMs

Modelos y proveedores habilitados para el brand. En BeAOS están configurados:

- `chatgpt:openai-api:gpt-5.5:online` para ChatGPT con búsqueda web.
- `google-ai-mode:brightdata:online` para Google AI Mode vía BrightData.
- `perplexity:brightdata:online` para Perplexity vía BrightData.
- `claude:anthropic-api:claude-sonnet-4-6:online` para Claude vía Anthropic API (requiere crédito en la cuenta).

Los proveedores se configuran por variables de entorno y se validan al arrancar el worker.

## 7. Reportes

Permiten generar reportes con rango de fechas y comparativas. Se pueden crear desde Reports o desde el dashboard de un brand.

- Rango personalizado.
- Comparación contra periodo anterior o promedio.
- Exportación/impresión cuando aplique.

## 8. Admin

### Brands

Listado global de brands y organizaciones. Solo para admins.

### Reports

Vista global de reportes generados.

### Workflows

Estado de los workflows y jobs internos.

### Queue

Inspección y reprioritización de la cola `process-prompt`. Útil cuando hay backlog o un proveedor lento.

### API Usage

Consumo y latencia por proveedor/modelo registrados por BeAOS. Sirve para ver costo operativo aproximado y detectar fallos.

### Tools

Herramientas internas de análisis y diagnóstico.

## 9. API v1

BeAOS expone `/api/v1` con autenticación Bearer.

```bash
curl -H "Authorization: Bearer $ADMIN_API_KEYS" \
     https://beaos.believe-global.com/api/v1/brands
```

El token está en `/root/BeAos/.env` como `ADMIN_API_KEYS`.
La especificación está en `/api/v1/openapi.json`.

## 10. Operación y mantenimiento

Servidor: `contabo-believe`.
Carpeta: `/root/BeAos`.
Proyecto Compose: `beaos`.

```bash
ssh contabo-believe
cd /root/BeAos

# estado
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml ps

# logs
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml logs -f web
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml logs -f worker

# levantar sin rebuild
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml up -d --no-build

# actualizar
git pull --ff-only
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml build
docker compose -p beaos -f docker-compose.yml -f docker-compose.beaos.yml up -d --no-build
```

Backups recomendados:

- `pg_dump` diario de la base.
- Respaldo del volumen `beaos_postgres_data`.
- Retención de 7 a 30 días.

## 11. Glosario

- Brand: marca u organización monitoreada.
- Prompt: consulta enviada a un motor de IA.
- Snapshot: resultado guardado de una ejecución.
- Citation: fuente citada por el motor.
- Share of Voice: participación de menciones frente a competidores.
- Worker: proceso que ejecuta scraping y análisis en segundo plano.
- Provider: fuente de scraping o API LLM.

## 12. Notas

- Mantener términos técnicos en inglés cuando sean estándar: API, worker, provider, prompt, snapshot, LLM.
- El registro de nuevos usuarios está cerrado después del primer admin.
- Los secretos viven en Infisical y en `/root/BeAos/.env`, no en Git.
