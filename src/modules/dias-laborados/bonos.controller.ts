import { FastifyReply, FastifyRequest } from 'fastify'
import { BonosService } from './bonos.service'
import {
  bonoInputSchema,
  listarBonosSchema,
  sincronizarBonosSchema
} from './bonos.schema'
import { getIO } from '../../sockets'

/**
 * Controller de Bonos — Planilla de Días Laborados
 *
 *  - GET  /api/dias-laborados/bonos        → Listar bonos en un rango (cualquier usuario autenticado con acceso a conductores puede VER)
 *  - POST /api/dias-laborados/bonos/sync   → Sincronizar diff (requiere permiso individual `bonos-planilla`)
 *  - POST /api/dias-laborados/bonos        → Crear uno (requiere permiso individual `bonos-planilla`)
 *  - DELETE /api/dias-laborados/bonos/:id  → Eliminar (requiere permiso individual `bonos-planilla`)
 */
export const BonosController = {
  // ─── Listar ─────────────────────────────────────────────
  async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const parsed = listarBonosSchema.parse(request.query)
      const bonos = await BonosService.listar(parsed)
      return reply.send({ success: true, data: bonos, count: bonos.length })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al listar bonos'
      })
    }
  },

  // ─── Sincronizar (diff en bloque desde el frontend) ─────
  async sincronizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (request as any).user
      const data = sincronizarBonosSchema.parse(request.body)
      const result = await BonosService.sincronizar(data, user.id)

      // Emitir evento en tiempo real para refrescar otras pestañas
      try {
        const io = getIO()
        io.emit('dias-laborados:bonos-actualizados', {
          usuario_id: user.id,
          usuario_nombre: user.nombre,
          created: result.created,
          deleted: result.deleted,
          timestamp: new Date().toISOString()
        })
      } catch {
        // Si el socket no está inicializado, continuar sin error
      }

      return reply.send({ success: true, ...result })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al sincronizar bonos'
      })
    }
  },

  // ─── Crear (uno solo) ───────────────────────────────────
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const user = (request as any).user
      const data = bonoInputSchema.parse(request.body)
      const bono = await BonosService.crear(data, user.id)
      return reply.status(201).send({ success: true, data: bono })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al crear bono'
      })
    }
  },

  // ─── Eliminar (uno solo) ────────────────────────────────
  async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const result = await BonosService.eliminar(id)
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al eliminar bono'
      })
    }
  }
}
