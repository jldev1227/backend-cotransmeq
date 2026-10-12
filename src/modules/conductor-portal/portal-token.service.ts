import { createHash, randomUUID } from 'crypto'
import jwt from 'jsonwebtoken'
import { env } from '../../config/env'
import { prisma } from '../../config/prisma'

export const PORTAL_TOKEN_VALIDITY_DAYS = 30

export interface PortalTokenConductor {
  id: string
  numero_identificacion: string
  nombre: string
  apellido: string
}

/** Emite y registra el mismo JWT que consume el middleware del portal. */
export async function emitirTokenPortal(conductor: PortalTokenConductor): Promise<string> {
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + PORTAL_TOKEN_VALIDITY_DAYS)

  const token = jwt.sign(
    {
      sub: conductor.id,
      cedula: conductor.numero_identificacion,
      nombre: `${conductor.nombre} ${conductor.apellido}`.trim(),
      tipo: 'conductor_portal'
    },
    env.JWT_SECRET,
    { expiresIn: `${PORTAL_TOKEN_VALIDITY_DAYS}d` }
  )

  await prisma.conductor_token.create({
    data: {
      id: randomUUID(),
      conductor_id: conductor.id,
      token,
      expires_at: expiresAt
    }
  })

  return token
}

/** ¿Es un token del portal firmado con el secreto actual? */
function esTokenDelPortal(token: string): boolean {
  try {
    return (jwt.verify(token, env.JWT_SECRET) as { tipo?: string }).tipo === 'conductor_portal'
  } catch {
    return false
  }
}

/**
 * El token del portal vigente más largo del conductor, o uno nuevo si no tiene.
 * Así cada correo no siembra otro.
 *
 * `conductor_token` lo comparte el enlace del reporte de días laborados
 * (`tipo: 'conductor_dias_laborados'`), que el portal rechaza. Antes se tomaba
 * el más largo sin mirar el tipo: si lo último que había pedido el conductor
 * era ese enlace, el correo de nómina le llevaba uno que no abría el portal.
 * Tampoco sirve uno firmado con un `JWT_SECRET` anterior.
 */
export async function tokenPortalVigente(conductor: PortalTokenConductor): Promise<string> {
  const vigentes = await prisma.conductor_token.findMany({
    where: { conductor_id: conductor.id, expires_at: { gt: new Date() } },
    orderBy: { expires_at: 'desc' },
    select: { token: true },
    take: 20
  })
  return vigentes.find((t) => esTokenDelPortal(t.token))?.token ?? emitirTokenPortal(conductor)
}

/// Caché de la comprobación de `tokenPortalRegistrado`, por hash del token: el
/// portal hace varias peticiones por pantalla y no hace falta ir a la base en
/// cada una. Un token revocado deja de abrir el portal en 30 s como mucho.
const CACHE_REGISTRO_MS = 30_000
const cacheRegistro = new Map<string, { hasta: number; vigente: boolean }>()

/**
 * ¿Sigue vigente este token del portal en la base?
 *
 * El JWT solo prueba que lo firmamos nosotros. Hasta oct-2026 era lo único que
 * miraban las guardas del portal, así que un token no se podía revocar antes de
 * sus 30 días: borrar su fila en `conductor_token`, o mandar al conductor a la
 * papelera, no cortaba nada. Ahora la fila tiene que existir, sin vencer, y el
 * conductor no puede estar borrado. El estado laboral no se mira a propósito:
 * un conductor desvinculado sigue necesitando sus desprendibles.
 */
/** Olvida lo cacheado: tras borrar tokens, para que el corte sea inmediato. */
export function olvidarTokensPortalEnCache(): void {
  cacheRegistro.clear()
}

export async function tokenPortalRegistrado(token: string): Promise<boolean> {
  const clave = createHash('sha256').update(token).digest('hex')
  const enCache = cacheRegistro.get(clave)
  if (enCache && enCache.hasta > Date.now()) return enCache.vigente

  const fila = await prisma.conductor_token.findUnique({
    where: { token },
    select: { expires_at: true, conductor: { select: { deleted_at: true } } }
  })
  const vigente = !!fila && fila.expires_at > new Date() && !fila.conductor.deleted_at

  if (cacheRegistro.size > 5000) cacheRegistro.clear()
  cacheRegistro.set(clave, { hasta: Date.now() + CACHE_REGISTRO_MS, vigente })
  return vigente
}
