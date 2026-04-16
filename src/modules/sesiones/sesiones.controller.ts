import { FastifyReply, FastifyRequest } from 'fastify'
import { SesionesService } from './sesiones.service'

export const SesionesController = {
  /** Listar todas las sesiones (admin) */
  async listar(request: FastifyRequest, reply: FastifyReply) {
    const { activas, usuarioId, limit } = request.query as any
    const sesiones = await SesionesService.listarTodas({
      activas: activas === 'true' ? true : activas === 'false' ? false : undefined,
      usuarioId,
      limit: limit ? parseInt(limit) : undefined
    })

    // Calcular duración para cada sesión
    const sesionesConDuracion = sesiones.map((s) => {
      const start = new Date(s.created_at).getTime()
      const end = s.closed_at ? new Date(s.closed_at).getTime() : Date.now()
      const duracionMs = end - start
      const duracionMin = Math.round(duracionMs / 60000)

      return {
        ...s,
        duracion_minutos: duracionMin,
        duracion_texto: formatDuration(duracionMs)
      }
    })

    reply.send(sesionesConDuracion)
  },

  /** Listar sesiones activas */
  async listarActivas(request: FastifyRequest, reply: FastifyReply) {
    const sesiones = await SesionesService.listarActivas()

    const sesionesConDuracion = sesiones.map((s) => {
      const start = new Date(s.created_at).getTime()
      const duracionMs = Date.now() - start
      return {
        ...s,
        duracion_minutos: Math.round(duracionMs / 60000),
        duracion_texto: formatDuration(duracionMs)
      }
    })

    reply.send(sesionesConDuracion)
  },

  /** Cerrar una sesión específica (admin) */
  async cerrarSesion(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as { id: string }
    // Buscar la sesión para obtener el token_hash
    const { prisma } = require('../../config/prisma')
    const sesion = await prisma.sesiones.findUnique({ where: { id } })
    if (!sesion) return reply.status(404).send({ error: 'Sesión no encontrada' })

    if (sesion.token_hash) {
      await SesionesService.cerrar(sesion.token_hash)
    }
    reply.send({ message: 'Sesión cerrada' })
  },

  /** Cerrar todas las sesiones de un usuario (admin) */
  async cerrarTodasUsuario(request: FastifyRequest, reply: FastifyReply) {
    const { usuarioId } = request.params as { usuarioId: string }
    const result = await SesionesService.cerrarTodas(usuarioId)
    reply.send({ message: `${result.count} sesiones cerradas` })
  },

  /** Mis sesiones (usuario autenticado) */
  async misSesiones(request: FastifyRequest, reply: FastifyReply) {
    const user = (request as any).user
    const sesiones = await SesionesService.listarPorUsuario(user.id)

    const sesionesConDuracion = sesiones.map((s) => {
      const start = new Date(s.created_at).getTime()
      const end = s.closed_at ? new Date(s.closed_at).getTime() : Date.now()
      const duracionMs = end - start
      return {
        ...s,
        duracion_minutos: Math.round(duracionMs / 60000),
        duracion_texto: formatDuration(duracionMs)
      }
    })

    reply.send(sesionesConDuracion)
  }
}

function formatDuration(ms: number): string {
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  const remainMins = mins % 60
  if (hours < 24) return `${hours}h ${remainMins}m`
  const days = Math.floor(hours / 24)
  const remainHours = hours % 24
  return `${days}d ${remainHours}h`
}
