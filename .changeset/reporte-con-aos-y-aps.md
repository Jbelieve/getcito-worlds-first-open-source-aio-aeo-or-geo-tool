---
"@workspace/web": minor
---

Los reportes ahora incluyen el AOS y el APS de la marca, en una página propia.

El reporte era solo Share of Voice: no decía si un agente puede operar la web ni qué responden los
asistentes sobre la marca, aunque BeAOS ya mide las dos cosas. Se agrega una página **Agent Readiness**
con el AOS (score, banda, cuántos requisitos cumplen y cuáles conviene resolver primero, ordenados por
los puntos que devuelven) y el APS, con lo **declarado** y lo **medido** separados y sin sumarse: una
tabla por modelo con su banda, su P10–P90 y cuántas respuestas tuvo.

Dos cosas que el reporte dice explícitamente, porque callarlas sería mentir con números reales: la fecha
de cada medición —el reporte es un documento fechado y el AOS y el APS siguen moviéndose— y cuando una
corrida salió **parcial**, con el motivo. Si el reporte no se puede vincular a una entidad de BeAOS, lo
dice en vez de mostrar el AOS de otra marca.

La página es aditiva: el reporte heredado de Getcito solo gana un import, una llamada en el loader y una
línea, para que el merge del upstream no encuentre conflictos. Los conteos excluyen los ocho chequeos
diagnósticos, que nunca puntúan, así que la cuenta coincide con el número.
