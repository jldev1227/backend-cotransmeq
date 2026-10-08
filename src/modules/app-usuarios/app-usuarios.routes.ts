/**
 * Enlace de acceso a la app móvil para usuarios administrativos. Ver `app-usuarios.service.ts`.
 *
 * - `GET|POST|DELETE /app-usuarios/enlace`: el usuario, desde su perfil web, consulta, genera o
 *   revoca su enlace.
 * - `POST /app-usuarios/canjear`: público; la app cambia el código del enlace por una sesión.
 * - `POST|DELETE /app-usuarios/dispositivos-push`: la app registra o retira el token de push del
 *   teléfono para el usuario de la sesión (ver `usuario-push`).
 */

import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { z } from 'zod'

import { authMiddleware } from '../../middlewares/auth.middleware'
import {
  AppUsuariosError,
  canjearCodigo,
  enlaceVigente,
  generarEnlace,
  puedeUsarApp,
  revocarEnlaces
} from './app-usuarios.service'
import { desactivarDispositivoUsuario, registrarDispositivoUsuario } from '../usuario-push/usuario-push.service'

const TOKEN_EXPO = /^Expo(nent)?PushToken\[[^\]]+\]$/

function responderError(request: FastifyRequest, reply: FastifyReply, err: unknown, mensaje: string) {
  if (err instanceof AppUsuariosError) {
    return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
  }
  request.log.error({ err }, `[app-usuarios] ${mensaje}`)
  return reply.status(500).send({ success: false, message: mensaje })
}

export async function appUsuariosRoutes(app: FastifyInstance) {
  const soloDashboard = async (request: FastifyRequest, reply: FastifyReply) => {
    await authMiddleware(request, reply)
    if (reply.sent) return
    /// Desde la app no se emiten enlaces: una sesión de la app no debe poder renovarse sola.
    if ((request as any).user?.tipo === 'app_usuario') {
      return reply.status(403).send({ success: false, message: 'El enlace se genera desde la web.' })
    }
  }

  app.get('/app-usuarios/enlace', { preHandler: soloDashboard }, async (request, reply) => {
    const user = (request as any).user
    try {
      return reply.send({
        success: true,
        data: {
          habilitado: puedeUsarApp(user),
          enlace: await enlaceVigente(user.id)
        }
      })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo consultar el enlace')
    }
  })

  app.post('/app-usuarios/enlace', { preHandler: soloDashboard }, async (request, reply) => {
    try {
      return reply.status(201).send({
        success: true,
        data: await generarEnlace((request as any).user.id)
      })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo generar el enlace')
    }
  })

  app.delete('/app-usuarios/enlace', { preHandler: soloDashboard }, async (request, reply) => {
    try {
      return reply.send({
        success: true,
        data: { revocados: await revocarEnlaces((request as any).user.id) }
      })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo revocar el enlace')
    }
  })

  const canjeSchema = z.object({ codigo: z.string().min(20).max(200) })

  /// Sin límite de intentos a propósito: el código tiene 256 bits, adivinarlo no es un riesgo real.
  app.post('/app-usuarios/canjear', async (request, reply) => {
    const parsed = canjeSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        message: 'Enlace incompleto.',
        code: 'ENLACE_INVALIDO'
      })
    }
    try {
      const data = await canjearCodigo(parsed.data.codigo, {
        ip: ((request.headers['x-forwarded-for'] as string) || request.ip || null)?.split(',')[0].trim() ?? null,
        userAgent: (request.headers['user-agent'] as string) || null
      })
      return reply.send({ success: true, data })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo validar el enlace')
    }
  })

  app.post('/app-usuarios/dispositivos-push', { preHandler: authMiddleware }, async (request, reply) => {
    const body = z
      .object({ expo_push_token: z.string().regex(TOKEN_EXPO), plataforma: z.enum(['ios', 'android']) })
      .safeParse(request.body)
    if (!body.success) return reply.status(400).send({ success: false, message: 'Token de push no válido' })
    try {
      await registrarDispositivoUsuario((request as any).user.id, body.data.expo_push_token, body.data.plataforma)
      return reply.send({ success: true })
    } catch (err) {
      return responderError(request, reply, err, 'No se pudo registrar el dispositivo')
    }
  })

  app.delete('/app-usuarios/dispositivos-push', { preHandler: authMiddleware }, async (request, reply) => {
    const token = (request.body as { expo_push_token?: unknown } | null)?.expo_push_token
    if (typeof token !== 'string') return reply.status(400).send({ success: false, message: 'Falta el token' })
    await desactivarDispositivoUsuario((request as any).user.id, token)
    return reply.send({ success: true })
  })
}
