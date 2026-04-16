import { FastifyRequest, FastifyReply } from 'fastify'
import { LiquidacionesServiciosService } from './liquidaciones-servicios.service'
import { emitLiquidacionServicio } from '../../sockets'

export const LiquidacionesServiciosController = {
  // ── TARIFAS ──

  async obtenerTarifas(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { cliente_id, operadora, anio } = req.query as any
      const tarifas = await LiquidacionesServiciosService.obtenerTarifas(cliente_id, operadora, anio ? Number(anio) : undefined)
      return reply.send(tarifas)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async crearTarifa(req: FastifyRequest, reply: FastifyReply) {
    try {
      const tarifa = await LiquidacionesServiciosService.crearTarifa(req.body as any)
      return reply.status(201).send(tarifa)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  async actualizarTarifa(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const tarifa = await LiquidacionesServiciosService.actualizarTarifa(id, req.body as any)
      return reply.send(tarifa)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  async eliminarTarifa(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const result = await LiquidacionesServiciosService.eliminarTarifa(id)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  // ── PREVIEW ──

  async previewLiquidacion(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { cliente_id, mes, anio, servicio_ids, tarifa_id } = req.body as any
      const preview = await LiquidacionesServiciosService.previewLiquidacion(
        cliente_id, Number(mes), Number(anio), servicio_ids, tarifa_id,
      )
      return reply.send(preview)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  // ── CHECK CONSECUTIVO ──
  async checkConsecutivo(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { consecutivo } = req.params as any
      const { excludeId } = req.query as any
      if (!consecutivo) return reply.status(400).send({ error: 'Se requiere consecutivo' })
      const result = await LiquidacionesServiciosService.checkConsecutivo(consecutivo, excludeId)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  // ── CRUD LIQUIDACIONES ──

  async crear(req: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (req as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'Usuario no autenticado' })
      const liquidacion = await LiquidacionesServiciosService.crear(req.body as any, userId)
      emitLiquidacionServicio('liquidacion-servicio-created', liquidacion)
      return reply.status(201).send(liquidacion)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  async listar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesServiciosService.listar(req.query as any)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async obtenerPorId(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const liquidacion = await LiquidacionesServiciosService.obtenerPorId(id)
      return reply.send(liquidacion)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) return reply.status(404).send({ error: error.message })
      return reply.status(500).send({ error: error.message })
    }
  },

  async eliminar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const result = await LiquidacionesServiciosService.eliminar(id)
      emitLiquidacionServicio('liquidacion-servicio-deleted', { id })
      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) return reply.status(404).send({ error: error.message })
      return reply.status(500).send({ error: error.message })
    }
  },

  async actualizar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const userId = (req as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'Usuario no autenticado' })
      const liquidacion = await LiquidacionesServiciosService.actualizar(id, req.body as any, userId)
      emitLiquidacionServicio('liquidacion-servicio-updated', liquidacion)
      return reply.send(liquidacion)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  async cambiarEstado(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const { estado, motivo_anulacion } = req.body as any
      const userId = (req as any).user?.id
      if (!userId) return reply.status(401).send({ error: 'Usuario no autenticado' })
      const result = await LiquidacionesServiciosService.cambiarEstado(id, estado, userId, motivo_anulacion)
      emitLiquidacionServicio('liquidacion-servicio-updated', result)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },

  async obtenerHistorial(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const historial = await LiquidacionesServiciosService.obtenerHistorial(id)
      return reply.send(historial)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async estadisticas(req: FastifyRequest, reply: FastifyReply) {
    try {
      const stats = await LiquidacionesServiciosService.estadisticas()
      return reply.send(stats)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async serviciosDisponibles(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { cliente_id, mes, anio } = req.query as any
      if (!cliente_id || !mes || !anio) {
        return reply.status(400).send({ error: 'Se requieren cliente_id, mes y anio' })
      }
      const servicios = await LiquidacionesServiciosService.serviciosDisponibles(cliente_id, Number(mes), Number(anio))
      return reply.send(servicios)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async tiposRecargo(req: FastifyRequest, reply: FastifyReply) {
    try {
      const tipos = await LiquidacionesServiciosService.obtenerTiposRecargo()
      return reply.send(tipos)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  // ── SOFT DELETE: RESTAURAR Y LISTAR ELIMINADAS ──

  async restaurar(req: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = req.params as { id: string }
      const result = await LiquidacionesServiciosService.restaurar(id)
      emitLiquidacionServicio('liquidacion-servicio-created', result)
      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) return reply.status(404).send({ error: error.message })
      return reply.status(500).send({ error: error.message })
    }
  },

  async listarEliminadas(req: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await LiquidacionesServiciosService.listarEliminadas(req.query as any)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  // ── CONFIGURACIÓN LIQUIDADOR DE SERVICIOS ──

  async obtenerConfigLiquidador(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await LiquidacionesServiciosService.obtenerConfigLiquidador()
      return reply.send(config)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async actualizarConfigLiquidador(req: FastifyRequest, reply: FastifyReply) {
    try {
      const config = await LiquidacionesServiciosService.actualizarConfigLiquidador(req.body as any)
      return reply.send(config)
    } catch (error: any) {
      return reply.status(400).send({ error: error.message })
    }
  },
}
