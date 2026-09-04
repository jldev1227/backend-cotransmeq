/**
 * Fecha del formulario: cuándo se empezó a diligenciar.
 *
 * NO la escribe quien llena el formulario. Sale de `started_at` —el instante en
 * que se creó el registro— convertido a la zona horaria de la asignación. Un
 * dato que se teclea es un dato que se puede equivocar o forzar, y esta fecha
 * acaba impresa en un documento HSEQ; tomarla del reloj la vuelve un hecho
 * observado en vez de una declaración.
 *
 * Vive en el CONTEXTO del envío (`context_json.filledOn`) y no como campo de la
 * definición: los campos pertenecen a una versión publicada e inmutable, y
 * añadir uno obligaría a republicar cada formulario, invalidando los borradores
 * en curso. Por el contexto aparece en todos, viejos y nuevos, sin tocar una
 * sola definición.
 *
 * Se GUARDA aunque sea derivable para que todos los consumidores —el PDF, el
 * detalle, el recibo del conductor, el export y la tabla del panel— lean el
 * mismo sitio, y para que quede congelada junto al registro que la imprime.
 *
 * No sustituye a `business_date`. Esa es la fecha con la que el servidor cuenta
 * los límites (`ONE_PER_PERIOD`) y se calcula en el momento de la ENTREGA. Las
 * dos difieren justo cuando interesa: un formulario que se empieza a las 23:50 y
 * se entrega a las 00:10 del día siguiente.
 */

import { BUSINESS_TIMEZONE, businessDateFor } from './assignments'

/** Clave dentro de `context_json`. Igual en el frontend. */
export const CLAVE_FECHA_DILIGENCIAMIENTO = 'filledOn'

const FORMATO = /^\d{4}-\d{2}-\d{2}$/

/** `true` si es una fecha real en `YYYY-MM-DD`. `2026-02-31` no lo es. */
export function esFechaISO(valor: unknown): valor is string {
  if (typeof valor !== 'string' || !FORMATO.test(valor)) return false
  const fecha = new Date(`${valor}T00:00:00.000Z`)
  return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor
}

/**
 * La fecha del formulario a partir de su inicio.
 *
 * En la zona de la ASIGNACIÓN, no en la del servidor: un preoperacional
 * empezado a las 22:00 en Colombia es del día 4, aunque en UTC ya sea el 5. Es
 * la misma conversión con la que se calcula `business_date`, así que las dos
 * fechas hablan del mismo calendario.
 */
export function fechaDeFormulario(startedAt: Date, timezone?: string | null): string {
  return businessDateFor(startedAt, timezone || BUSINESS_TIMEZONE)
}

/**
 * Escribe la fecha en un contexto de envío.
 *
 * Devuelve una copia: el contexto llega del cliente y mutarlo escondería que el
 * servidor lo está corrigiendo. Lo que venga en `filledOn` desde el dispositivo
 * se DESCARTA —el cliente ya no lo manda, pero una versión vieja de la app sí, y
 * ese valor no manda sobre el reloj.
 */
export function conFechaDeFormulario(
  contexto: Record<string, unknown>,
  startedAt: Date,
  timezone?: string | null,
): Record<string, unknown> {
  return { ...contexto, [CLAVE_FECHA_DILIGENCIAMIENTO]: fechaDeFormulario(startedAt, timezone) }
}

/** Lee la fecha del contexto de un envío. `null` si no la trae o no es una fecha. */
export function fechaDeFormularioDe(contexto: unknown): string | null {
  const valor = (contexto as Record<string, unknown> | null | undefined)?.[
    CLAVE_FECHA_DILIGENCIAMIENTO
  ]
  return esFechaISO(valor) ? valor : null
}
