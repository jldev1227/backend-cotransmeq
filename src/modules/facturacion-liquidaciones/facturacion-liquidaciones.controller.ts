import { FastifyRequest, FastifyReply } from 'fastify'
import { FacturacionLiquidacionesService } from './facturacion-liquidaciones.service'
import { emitFacturacionLiquidacion } from '../../sockets'

export const FacturacionLiquidacionesController = {

  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const body = request.body as any
      const factura = await FacturacionLiquidacionesService.crear(body, userId)

      // Emit socket events
      emitFacturacionLiquidacion('facturacion-created', factura)
      for (const item of factura.items) {
        if (item.liquidacion) {
          emitFacturacionLiquidacion('liquidacion-servicio-facturada', {
            id: item.liquidacion.id,
            estado: 'FACTURADA',
            factura_id: factura.id,
            numero_factura: factura.numero_factura
          })
        }
      }

      return reply.status(201).send(factura)
    } catch (error: any) {
      if (error.message.includes('Ya existe')) {
        return reply.status(409).send({ error: error.message })
      }
      if (error.message.includes('no están en estado') || error.message.includes('ya están facturadas')) {
        return reply.status(400).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  },

  async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await FacturacionLiquidacionesService.listar(request.query as any)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },

  async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const factura = await FacturacionLiquidacionesService.obtenerPorId(id)
      return reply.send(factura)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  },

  async anular(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const { motivo } = request.body as any
      const userId = (request as any).user?.id
      const factura = await FacturacionLiquidacionesService.anular(id, userId, motivo)

      // Emit socket
      emitFacturacionLiquidacion('facturacion-anulada', factura)
      for (const item of factura.items) {
        if (item.liquidacion) {
          emitFacturacionLiquidacion('liquidacion-servicio-facturada', {
            id: item.liquidacion.id,
            estado: 'LIQUIDADA',
            factura_id: null,
            numero_factura: null
          })
        }
      }

      return reply.send(factura)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  },

  async batchFacturaInfo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = request.body as any
      if (!ids || !Array.isArray(ids)) {
        return reply.status(400).send({ error: 'Se requiere un array de IDs' })
      }
      const map = await FacturacionLiquidacionesService.obtenerFacturasDeLiquidaciones(ids)
      return reply.send(map)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  },
}
