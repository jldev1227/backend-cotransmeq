import { FastifyRequest, FastifyReply } from 'fastify'
import { ActividadesPesvService } from './actividades-pesv.service'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { emitNotificacion, emitActividadPesv } from '../../sockets'

export class ActividadesPesvController {

  /** GET /pesv/actividades — listar con filtros y paginación */
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { page, limit, anio, estado, prioridad, frecuencia, responsable_ejecucion_id, search } = request.query as any
      const result = await ActividadesPesvService.listar(
        page ? Number(page) : 1,
        limit ? Number(limit) : 50,
        {
          anio: anio ? Number(anio) : undefined,
          estado, prioridad, frecuencia,
          responsable_ejecucion_id,
          search,
        }
      )
      return reply.send({ success: true, ...result })
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  /** GET /pesv/actividades/:id — obtener por ID */
  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const actividad = await ActividadesPesvService.obtenerPorId(id)
      return reply.send({ success: true, data: actividad })
    } catch (error: any) {
      return reply.status(404).send({ success: false, error: error.message })
    }
  }

  /** POST /pesv/actividades — crear */
  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const body = request.body as any
      const actividad = await ActividadesPesvService.crear(body, userId)

      // Notificar al responsable de ejecución si es distinto al creador
      if (actividad.responsable_ejecucion_id && actividad.responsable_ejecucion_id !== userId) {
        try {
          const notifData = {
            usuario_id: actividad.responsable_ejecucion_id,
            tipo: 'ACTIVIDAD_PESV_ASIGNADA' as const,
            titulo: '📋 Nueva actividad PESV asignada',
            mensaje: `Se te asignó la actividad: ${actividad.actividad}`,
            referencia_id: actividad.id,
            referencia_tipo: 'actividad_pesv',
          }
          await NotificacionesService.crear(notifData)
          emitNotificacion(notifData)
        } catch (e) {
          console.error('Error enviando notificación de actividad:', e)
        }
      }

      emitActividadPesv('actividad-pesv-created', actividad)
      return reply.status(201).send({ success: true, data: actividad })
    } catch (error: any) {
      return reply.status(400).send({ success: false, error: error.message })
    }
  }

  /** PUT /pesv/actividades/:id — actualizar */
  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const { id } = request.params as any
      const body = request.body as any

      // Obtener la actividad anterior para comparar responsable
      let prevResponsable: string | null = null
      try {
        const prev = await ActividadesPesvService.obtenerPorId(id)
        prevResponsable = prev.responsable_ejecucion_id
      } catch (e) { /* ignore */ }

      const actividad = await ActividadesPesvService.actualizar(id, body, userId)

      // Notificar al responsable si cambió
      if (actividad.responsable_ejecucion_id && actividad.responsable_ejecucion_id !== userId) {
        try {
          const esNuevoResponsable = actividad.responsable_ejecucion_id !== prevResponsable
          const notifData = {
            usuario_id: actividad.responsable_ejecucion_id,
            tipo: esNuevoResponsable ? 'ACTIVIDAD_PESV_ASIGNADA' as const : 'ACTIVIDAD_PESV_ACTUALIZADA' as const,
            titulo: esNuevoResponsable ? '📋 Nueva actividad PESV asignada' : '✏️ Actividad PESV actualizada',
            mensaje: esNuevoResponsable
              ? `Se te asignó la actividad: ${actividad.actividad}`
              : `La actividad "${actividad.actividad}" fue actualizada`,
            referencia_id: actividad.id,
            referencia_tipo: 'actividad_pesv',
          }
          await NotificacionesService.crear(notifData)
          emitNotificacion(notifData)
        } catch (e) {
          console.error('Error enviando notificación de actividad:', e)
        }
      }

      emitActividadPesv('actividad-pesv-updated', actividad)
      return reply.send({ success: true, data: actividad })
    } catch (error: any) {
      return reply.status(400).send({ success: false, error: error.message })
    }
  }

  /** DELETE /pesv/actividades/:id — soft delete */
  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const { id } = request.params as any
      await ActividadesPesvService.eliminar(id, userId)
      emitActividadPesv('actividad-pesv-deleted', { id })
      return reply.send({ success: true, message: 'Actividad eliminada' })
    } catch (error: any) {
      return reply.status(400).send({ success: false, error: error.message })
    }
  }

  /** GET /pesv/actividades/estadisticas — stats */
  static async estadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio } = request.query as any
      const stats = await ActividadesPesvService.estadisticas(anio ? Number(anio) : undefined)
      return reply.send({ success: true, data: stats })
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message })
    }
  }

  /** GET /pesv/actividades/siguiente-numero — next number */
  static async siguienteNumero(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { anio } = request.query as any
      const numero = await ActividadesPesvService.siguienteNumero(anio ? Number(anio) : undefined)
      return reply.send({ success: true, data: { numero } })
    } catch (error: any) {
      return reply.status(500).send({ success: false, error: error.message })
    }
  }
}
