/**
 * Registra la sesión de un token firmado en un test.
 *
 * Desde oct-2026 el middleware de autenticación no se conforma con un JWT
 * válido: exige su fila ACTIVA en `sesiones` (es lo que permite cerrarla), como
 * la que crea `/auth/login`. Los helpers que firman tokens a mano tienen que
 * crearla también, o toda petición HTTP del test sale con 401.
 *
 * Solo contra la base desechable: `exigirBaseDesechable()` ya corrió en
 * `tests/setup.ts` antes de que ningún test llegue aquí.
 */
import { PrismaClient } from '@prisma/client'
import { createHash } from 'node:crypto'

const prisma = new PrismaClient()

export async function registrarSesion(usuarioId: string, token: string): Promise<void> {
  await prisma.sesiones.create({
    data: {
      usuario_id: usuarioId,
      token_hash: createHash('sha256').update(token).digest('hex').substring(0, 64),
      token_expiry: new Date(Date.now() + 2 * 3600_000),
      is_active: true,
      user_agent: 'tests'
    }
  })
}
