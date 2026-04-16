import { FastifyReply, FastifyRequest } from 'fastify'
import { checkAccess, type AccessLevel } from '../config/permissions'

/**
 * Middleware factory que verifica permisos por módulo
 * @param moduleId - ID del módulo (ej: 'servicios', 'recargos')
 * @param requiredLevel - Nivel mínimo requerido ('full' | 'read' | 'limited'). Default: 'read'
 */
export function requirePermission(moduleId: string, requiredLevel: AccessLevel = 'read') {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user

    if (!user) {
      return reply.status(401).send({ error: 'No autenticado' })
    }

    const { allowed, level } = checkAccess(user.role, user.area, moduleId)

    if (!allowed) {
      return reply.status(403).send({
        error: 'Sin permisos',
        message: `No tienes acceso al módulo "${moduleId}". Contacta al administrador.`
      })
    }

    // Verificar nivel de acceso
    const levelHierarchy: AccessLevel[] = ['limited', 'read', 'full']
    const userLevelIndex = levelHierarchy.indexOf(level!)
    const requiredLevelIndex = levelHierarchy.indexOf(requiredLevel)

    if (userLevelIndex < requiredLevelIndex) {
      return reply.status(403).send({
        error: 'Nivel de acceso insuficiente',
        message: `Tu nivel de acceso "${level}" no es suficiente. Se requiere "${requiredLevel}".`
      })
    }

    // Adjuntar el nivel de acceso al request para uso posterior
    ;(request as any).accessLevel = level
  }
}

/**
 * Middleware que requiere acceso al módulo de sesiones (área administracion)
 */
export async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = (request as any).user
  if (!user) {
    return reply.status(401).send({ error: 'No autenticado' })
  }
  const { allowed } = checkAccess(user.role, user.area, 'sesiones')
  if (!allowed) {
    return reply.status(403).send({ error: 'Sin permisos para esta acción' })
  }
}
