/**
 * Lo que la página pública del QR necesita para decir «ya firmaste»: si hay
 * firma, a nombre de quién y cuándo. Nada más.
 *
 * Hasta oct-2026 `GET /public/asistencias/:token/verificar` devolvía la fila
 * entera —documento, teléfono, cargo, la firma en base64, IP, user agent y la
 * propia huella— sin sesión, a quien tuviera el token del QR (que se proyecta
 * en el salón y se comparte por chat) y una huella que genera el mismo
 * cliente. Y FingerprintJS puede repetir la huella en teléfonos del mismo
 * modelo: un compañero con el mismo teléfono podía ver los datos del otro.
 */
export interface ConfirmacionAsistencia {
  respondido: boolean
  nombre: string | null
  /** ISO 8601 del momento de la firma. */
  fecha: string | null
}

export function confirmacionPublica(
  respuesta: { nombre_completo: string; created_at: Date } | null
): ConfirmacionAsistencia {
  if (!respuesta) return { respondido: false, nombre: null, fecha: null }
  return {
    respondido: true,
    nombre: respuesta.nombre_completo,
    fecha: respuesta.created_at.toISOString()
  }
}
