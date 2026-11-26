import { createHmac, randomBytes, timingSafeEqual } from 'crypto'
import { env } from '../../config/env'

export const DURACION_INTENTO_MS = 30 * 60 * 1000

function firma(encuestaId: string, inicio: string, nonce: string): string {
  return createHmac('sha256', env.JWT_SECRET)
    .update(`encuesta-intento:v1:${encuestaId}:${inicio}:${nonce}`)
    .digest('base64url')
}

/** La hora firmada permite continuar tras cerrar el navegador sin confiar en el reloj del teléfono. */
export function crearIntento(encuestaId: string, ahora = Date.now()) {
  const inicio = String(ahora)
  const nonce = randomBytes(16).toString('base64url')
  return { intento: `v1.${inicio}.${nonce}.${firma(encuestaId, inicio, nonce)}`, iniciado_at: new Date(ahora).toISOString(), vence_at: new Date(ahora + DURACION_INTENTO_MS).toISOString() }
}

export function leerIntento(encuestaId: string, intento: string, ahora = Date.now()): { iniciado_at: string; vence_at: string; vencido: boolean } | null {
  const partes = /^v1\.(\d{13})\.([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/.exec(intento)
  if (!partes) return null
  const [, inicio, nonce, recibida] = partes
  const esperada = firma(encuestaId, inicio, nonce)
  if (!timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada))) return null
  const apertura = Number(inicio)
  if (apertura > ahora || !Number.isSafeInteger(apertura)) return null
  const vencimiento = apertura + DURACION_INTENTO_MS
  return { iniciado_at: new Date(apertura).toISOString(), vence_at: new Date(vencimiento).toISOString(), vencido: ahora >= vencimiento }
}
