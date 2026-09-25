/**
 * La capa de claims con el humano en el medio.
 *
 * `candidates` propone, `mapping` traduce y decide la precedencia. Ninguno de los dos inventa evidencia:
 * el estándar lo dice —*"AOS links proofs, it does not create them"*— y un dato inventado en la capa de
 * confianza es peor que su ausencia.
 */
export * from "./candidates";
export * from "./mapping";
