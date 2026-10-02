/**
 * El código de canje, por sitio: la credencial corta que viaja al WordPress del cliente.
 *
 * Hasta ahora la única forma de que un plugin entrara al MCP era un token de producto creado a mano
 * con `scripts/beaos-token.sh` —dos valores copiados y un `entityId` que hay que ir a buscar— o la
 * caída a `ADMIN_API_KEYS`, que es una llave maestra compartida: abre todas las marcas, no se revoca
 * por sitio y no tiene identidad. **Esa llave no puede viajar a un WordPress ajeno.**
 *
 * Lo que viaja es esto: un código de un solo uso, con vencimiento, atado a una marca y una entidad.
 * El plugin lo canjea por su token de producto (`POST /api/v1/enroll`) y lo guarda en `wp_options`.
 *
 * Igual que en `api-tokens.ts`, acá vive **la parte pura**: el formato, el hash y las decisiones que
 * se pueden probar sin base ni red. La persistencia y el canje transaccional están en
 * `enrollment.server.ts`, por la misma razón que en los tokens.
 */

import { createHash, randomBytes } from "node:crypto";

/**
 * Los primeros 8 caracteres: alcanzan para identificar el código en un listado sin revelarlo. Es el
 * mismo criterio que `TOKEN_PREFIX_LENGTH` y el mismo que usa el script en bash.
 */
export const ENROLLMENT_PREFIX_LENGTH = 8;

/**
 * Bytes de entropía del código. **No es un número decorativo**: es la única defensa que queda cuando
 * el endpoint es público y no hay credencial previa. 24 bytes son 192 bits —la misma entropía que el
 * token del MCP— así que adivinarlo no es viable ni con el límite por IP relajado. El límite por IP
 * frena la fuerza bruta; esto hace que no haya nada que frenar.
 */
export const ENROLLMENT_CODE_BYTES = 24;

/** Ventana de validez por defecto: 24 horas. La elige quien genera, y el endpoint la respeta. */
export const ENROLLMENT_TTL_HOURS = 24;

/** El nombre de la política en las cabeceras `RateLimit-Policy` / `RateLimit` del canje. */
export const ENROLL_POLICY = "enroll";

/**
 * El mensaje **único** de rechazo, y es único a propósito.
 *
 * El endpoint es público: si dijera "ese código no existe" para uno inventado y "ese código ya se usó"
 * para uno real, le estaría confirmando a quien prueba cuáles existen. Los tres modos de fallar
 * —inexistente, vencido y ya usado— dicen exactamente lo mismo. El motivo real queda en el log del
 * servidor, que es donde sirve.
 */
export const ENROLLMENT_REJECTION_MESSAGE =
	"El código no sirve: no existe, ya venció o ya se usó. Generá uno nuevo en BeAOS (Configuración → Brand).";

export const ENROLLMENT_REJECTION_ERROR = "Bad Request";

/** sha256 en hex. Es lo único que se persiste; el código en claro existe una sola vez, al crearlo. */
export function hashEnrollmentCode(code: string): string {
	return createHash("sha256").update(code, "utf8").digest("hex");
}

export function prefixOfEnrollmentCode(code: string): string {
	return code.slice(0, ENROLLMENT_PREFIX_LENGTH);
}

/**
 * El código que se imprime una sola vez. Mismo formato que el token del MCP —`beaos_` + base64url de
 * 24 bytes— para que se reconozca de un vistazo en un log y para que el script en bash, el script de
 * node y el servidor no tengan tres formatos distintos.
 */
export function generateEnrollmentCode(): string {
	return `beaos_${randomBytes(ENROLLMENT_CODE_BYTES).toString("base64url")}`;
}

/** Vencimiento a partir de ahora, en horas. Pura: recibe el reloj. */
export function enrollmentExpiry(now: Date, ttlHours: number = ENROLLMENT_TTL_HOURS): Date {
	return new Date(now.getTime() + ttlHours * 3_600_000);
}

/**
 * Por qué un código no canjea. No viaja al cliente (ver `ENROLLMENT_REJECTION_MESSAGE`): es para el
 * log del servidor y para los tests.
 */
export type EnrollmentRejection = "unknown" | "expired" | "used";

/** El estado de un código tal como lo necesita la decisión. */
export interface EnrollmentCodeState {
	expiresAt: Date;
	usedAt: Date | null;
}

/**
 * ¿Este código se puede canjear? Pura, para poder probar los tres rechazos sin base.
 *
 * El orden importa y es el que más le sirve a quien opera: un código ya usado se reporta como usado
 * aunque además esté vencido, porque el hecho relevante es que el canje **ocurrió**.
 *
 * Ojo: esto es la decisión **de lectura**, para poder explicar un rechazo. La garantía de un solo uso
 * no vive acá —una lectura y después una escritura es una carrera— sino en el
 * `UPDATE ... WHERE used_at IS NULL RETURNING` de `enrollment.server.ts`.
 */
export function evaluateEnrollmentCode(state: EnrollmentCodeState, now: Date): EnrollmentRejection | null {
	if (state.usedAt !== null) return "used";
	if (state.expiresAt.getTime() <= now.getTime()) return "expired";
	return null;
}
