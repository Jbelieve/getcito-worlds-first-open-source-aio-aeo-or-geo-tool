/**
 * La capa de claims con el humano en el medio.
 *
 * `candidates` propone, `claim-input` valida lo que escribe el operador y `mapping` traduce y decide la
 * precedencia. Ninguno inventa evidencia: el estándar lo dice —*"AOS links proofs, it does not create
 * them"*— y un dato inventado en la capa de confianza es peor que su ausencia.
 *
 * `claim-input` es la puerta única del alta: la pantalla de Pruebas, el MCP y lo que venga validan con
 * las reglas de `parseBrandProfile`, no con una interpretación propia de cada puerta.
 */
export * from "./candidates";
export * from "./claim-input";
export * from "./mapping";
