import { timingSafeEqual } from 'node:crypto'
import type { FastifyRequest } from 'fastify'

/**
 * ¿La petición trae la cabecera `x-cron-secret` igual a `CRON_SECRET`?
 *
 * Es el único control de acceso de las rutas `…/cron-hora` de los snapshots,
 * que no llevan sesión. Sin la variable configurada responde siempre que no:
 * antes, `undefined !== undefined` dejaba pasar cualquier petición sin cabecera.
 *
 * Compara en tiempo constante: con `!==` el tiempo de respuesta filtra cuántos
 * caracteres iniciales acertó quien prueba secretos.
 */
export function cronAutorizado(request: FastifyRequest): boolean {
  const esperado = process.env.CRON_SECRET
  const recibido = request.headers['x-cron-secret']
  if (!esperado || typeof recibido !== 'string') return false
  const a = Buffer.from(recibido, 'utf-8')
  const b = Buffer.from(esperado, 'utf-8')
  return a.length === b.length && timingSafeEqual(a, b)
}
