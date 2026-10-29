import { FastifyRequest, FastifyReply } from 'fastify'
import { NotificacionesService } from './notificaciones.service'
import {
  clavePublicaVapid,
  desactivarSuscripcionWeb,
  enviarWebPush,
  registrarSuscripcionWeb,
} from './web-push.service'

/** Una suscripción de `PushManager.subscribe()` serializada con `toJSON()`. */
function suscripcionValida(body: any): body is { endpoint: string; keys: { p256dh: string; auth: string } } {
  return (
    typeof body?.endpoint === 'string' &&
    /^https:\/\//.test(body.endpoint) &&
    body.endpoint.length <= 2000 &&
    typeof body?.keys?.p256dh === 'string' &&
    typeof body?.keys?.auth === 'string' &&
    body.keys.p256dh.length <= 255 &&
    body.keys.auth.length <= 255
  )
}

export class NotificacionesController {

  /** GET /notificaciones — listar mis notificaciones */
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'No autenticado' })

      const { page, limit } = request.query as any
      const result = await NotificacionesService.listarPorUsuario(
        userId,
        page ? Number(page) : 1,
        limit ? Number(limit) : 20,
      )
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /notificaciones/no-leidas — contar no leídas */
  static async contarNoLeidas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'No autenticado' })

      const count = await NotificacionesService.contarNoLeidas(userId)
      return reply.send({ count })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** PATCH /notificaciones/:id/leida — marcar una como leída */
  static async marcarLeida(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'No autenticado' })

      const { id } = request.params as any
      await NotificacionesService.marcarLeida(id, userId)
      return reply.send({ ok: true })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** PATCH /notificaciones/marcar-todas — marcar todas como leídas */
  static async marcarTodasLeidas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'No autenticado' })

      await NotificacionesService.marcarTodasLeidas(userId)
      return reply.send({ ok: true })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** GET /notificaciones/web-push/clave */
  static async clavePush(_request: FastifyRequest, reply: FastifyReply) {
    return reply.send({ clave: clavePublicaVapid() })
  }

  /** POST /notificaciones/web-push/suscripcion */
  static async suscribirPush(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user?.id
    if (!userId) return reply.status(401).send({ error: 'No autenticado' })
    if (!clavePublicaVapid()) return reply.status(503).send({ error: 'Los avisos del navegador no están configurados' })
    if (!suscripcionValida(request.body)) return reply.status(400).send({ error: 'Suscripción inválida' })
    try {
      await registrarSuscripcionWeb(userId, request.body, request.headers['user-agent'])
      return reply.send({ ok: true })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /** POST /notificaciones/web-push/desuscribir */
  static async desuscribirPush(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user?.id
    if (!userId) return reply.status(401).send({ error: 'No autenticado' })
    const endpoint = (request.body as any)?.endpoint
    if (typeof endpoint !== 'string') return reply.status(400).send({ error: 'Falta el endpoint' })
    try {
      await desactivarSuscripcionWeb(userId, endpoint)
      return reply.send({ ok: true })
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * POST /notificaciones/web-push/prueba
   *
   * Reenvía como aviso la última notificación del propio usuario (o una de
   * cortesía si no tiene ninguna). Solo le llega a él: no recibe destinatario.
   */
  static async probarPush(request: FastifyRequest, reply: FastifyReply) {
    const userId = (request as any).user?.id
    if (!userId) return reply.status(401).send({ error: 'No autenticado' })
    if (!clavePublicaVapid()) return reply.status(503).send({ error: 'Los avisos del navegador no están configurados' })
    try {
      const ultima = await NotificacionesService.ultimaVisible(userId)
      const resultado = await enviarWebPush(
        ultima ?? {
          usuario_id: userId,
          tipo: 'GENERAL',
          titulo: 'Avisos activados',
          mensaje: 'Así se verán tus notificaciones cuando no tengas la app abierta.',
        },
        /// Se pulsa desde el dashboard: sin esto el SW lo callaría por estar a la vista.
        { forzar: true },
      )
      return reply.send(resultado)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }
}
