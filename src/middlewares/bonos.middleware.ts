import { FastifyReply, FastifyRequest } from 'fastify'

/**
 * Middleware que verifica el permiso INDIVIDUAL `bonos-planilla`
 * del usuario (campo JSON `permisos`). Este permiso es independiente
 * del área y solo lo otorgan o quitan los administradores desde la
 * página de Usuarios.
 *
 *  - Si el flag está en `true` → permite el paso.
 *  - Si está en `false` o no existe → 403 con mensaje claro.
 *
 *  NOTA: Los usuarios que NO tengan este permiso siguen pudiendo
 *  VER los bonos ya otorgados (lectura) — ese endpoint no usa este
 *  middleware. Aquí protegemos únicamente las operaciones de escritura.
 */
export async function requireBonosPlanilla(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (!user) {
    return reply.status(401).send({ error: 'No autenticado' })
  }

  const permisos = (user.permisos as Record<string, boolean> | null) || {}
  if (permisos['bonos-planilla'] !== true) {
    return reply.status(403).send({
      error: 'Sin permiso para gestionar bonos',
      message: 'No tienes el permiso individual "bonos-planilla". Solicita a un administrador que lo habilite en tu usuario desde la página de Usuarios.'
    })
  }
}
