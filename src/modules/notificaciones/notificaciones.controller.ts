import { FastifyRequest, FastifyReply } from 'fastify'
import { NotificacionesService } from './notificaciones.service'

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
}
