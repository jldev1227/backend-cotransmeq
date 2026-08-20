import { randomUUID } from 'crypto'
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
