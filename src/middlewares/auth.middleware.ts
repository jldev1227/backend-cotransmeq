import { FastifyReply, FastifyRequest } from 'fastify'
import jwt from 'jsonwebtoken'
import { env } from '../config/env'
import { sesionAppVigente } from '../modules/app-usuarios/app-usuarios.service'

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
  const auth = request.headers['authorization']
  if (!auth) return reply.status(401).send({ error: 'No token' })
  const parts = auth.split(' ')
  if (parts.length !== 2) return reply.status(401).send({ error: 'Invalid token' })
  const token = parts[1]
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as any
    ;(request as any).user = {
      ...payload,
      id: payload.sub || payload.id,
      area: payload.area || null,
      permisos: payload.permisos || {}
    }
  } catch (err) {
    return reply.status(401).send({ error: 'Invalid token' })
  }
  /// Las sesiones de la app móvil se pueden revocar (desde el perfil o cerrando la sesión);
  /// las del dashboard no, por eso solo se consulta en estas.
  const user = (request as any).user
  if (user.tipo === 'app_usuario' && !(await sesionAppVigente(user.enlace, token))) {
    return reply.status(401).send({ error: 'Sesión revocada', message: 'Tu acceso a la app fue revocado o venció.' })
  }
}
