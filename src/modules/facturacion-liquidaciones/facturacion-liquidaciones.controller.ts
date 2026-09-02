import { FastifyRequest, FastifyReply } from 'fastify'
import { FacturacionLiquidacionesService } from './facturacion-liquidaciones.service'
import { emitFacturacionLiquidacion, emitNotificacion, eventoMeta } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'

export class FacturacionLiquidacionesController {

  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      const body = request.body as any
      const factura = await FacturacionLiquidacionesService.crear(body, userId)

      // Emit socket event
      const actor = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        'facturacion-created',
        factura,
        eventoMeta({
          tipo: 'created',
          scope: 'facturas',
          actor,
          etiqueta: factura.numero_factura
        })
      )
      // Also emit updates for each liquidación that changed state.
      // Van con scope 'liquidaciones': lo que cambia es el estado de la
      // liquidación, y es el tab de Liquidaciones el que hay que invalidar.
      for (const item of factura.items) {
        if (item.liquidacion) {
          emitFacturacionLiquidacion(
            'liquidacion-servicio-facturada',
            {
              id: item.liquidacion.id,
              estado: 'FACTURADA',
              factura_id: factura.id,
              numero_factura: factura.numero_factura
            },
            eventoMeta({
              tipo: 'estado',
              scope: 'liquidaciones',
              actor,
              etiqueta: item.liquidacion.consecutivo ?? factura.numero_factura,
              estado_anterior: 'APROBADA',
              estado_nuevo: 'FACTURADA'
            })
          )
        }
      }

      // Notificar
      try {
        const aprobadores = await NotificacionesService.obtenerUsuariosAprobadores()
        const otros = aprobadores.filter(u => u.id !== userId)
        if (otros.length > 0) {
          const consecutivos = factura.items.map(i => i.liquidacion?.consecutivo).filter(Boolean).join(', ')
          const notifData = otros.map(u => ({
            usuario_id: u.id,
            tipo: 'LIQUIDACION_FACTURADA' as const,
            titulo: `Factura ${factura.numero_factura} creada`,
            mensaje: `${userName} facturó las liquidaciones ${consecutivos} con la factura ${factura.numero_factura}.`,
            referencia_id: factura.id,
          }))
          await NotificacionesService.crearMasivas(notifData)
          for (const nd of notifData) {
            emitNotificacion(nd)
          }
        }
      } catch (notifError) {
        console.error('Error creando notificaciones de facturación:', notifError)
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
  }

  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await FacturacionLiquidacionesService.listar(request.query as any)
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
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
  }

  static async anular(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const { motivo } = request.body as any
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      const factura = await FacturacionLiquidacionesService.anular(id, userId, motivo)

      // Emit socket
      const actorAnula = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        'facturacion-anulada',
        factura,
        eventoMeta({
          tipo: 'anulada',
          scope: 'facturas',
          actor: actorAnula,
          etiqueta: factura.numero_factura
        })
      )
      // Emit updates for each liquidación that reverted
      for (const item of factura.items) {
        if (item.liquidacion) {
          emitFacturacionLiquidacion(
            'liquidacion-servicio-facturada',
            {
              id: item.liquidacion.id,
              estado: 'LIQUIDADA',
              factura_id: null,
              numero_factura: null
            },
            eventoMeta({
              tipo: 'estado',
              scope: 'liquidaciones',
              actor: actorAnula,
              etiqueta: item.liquidacion.consecutivo ?? factura.numero_factura,
              estado_anterior: 'FACTURADA',
              estado_nuevo: 'LIQUIDADA'
            })
          )
        }
      }

      // Notificar
      try {
        const aprobadores = await NotificacionesService.obtenerUsuariosAprobadores()
        const otros = aprobadores.filter(u => u.id !== userId)
        if (otros.length > 0) {
          const notifData = otros.map(u => ({
            usuario_id: u.id,
            tipo: 'FACTURA_ANULADA' as const,
            titulo: `Factura ${factura.numero_factura} anulada`,
            mensaje: `${userName} anuló la factura ${factura.numero_factura}. ${motivo ? 'Motivo: ' + motivo : ''}`,
            referencia_id: factura.id,
          }))
          await NotificacionesService.crearMasivas(notifData)
          for (const nd of notifData) {
            emitNotificacion(nd)
          }
        }
      } catch (notifError) {
        console.error('Error creando notificaciones de anulación:', notifError)
      }

      return reply.send(factura)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * Asociar liquidaciones a una factura existente.
   */
  static async agregarLiquidaciones(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const { liquidacion_ids } = (request.body as any) ?? {}
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'

      const result = await FacturacionLiquidacionesService.agregarLiquidaciones(
        id,
        liquidacion_ids,
        userId
      )

      const actor = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        'facturacion-updated',
        result.factura,
        eventoMeta({
          tipo: 'updated',
          scope: 'facturas',
          actor,
          etiqueta: result.factura.numero_factura
        })
      )
      for (const liq of result.liquidaciones_afectadas) {
        emitFacturacionLiquidacion(
          'liquidacion-servicio-facturada',
          {
            id: liq.id,
            estado: 'FACTURADA',
            factura_id: result.factura.id,
            numero_factura: result.factura.numero_factura
          },
          eventoMeta({
            tipo: 'estado',
            scope: 'liquidaciones',
            actor,
            etiqueta: liq.consecutivo || result.factura.numero_factura,
            estado_nuevo: 'FACTURADA'
          })
        )
      }

      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada') || error.message.includes('no fueron encontradas')) {
        return reply.status(404).send({ error: error.message })
      }
      if (
        error.message.includes('no están en estado') ||
        error.message.includes('ya están facturadas') ||
        error.message.includes('anulada') ||
        error.message.includes('al menos una')
      ) {
        return reply.status(400).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * Quitar una liquidación de su factura (vuelve a LIQUIDADA).
   */
  static async quitarLiquidacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, liquidacionId } = request.params as any
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'

      const result = await FacturacionLiquidacionesService.quitarLiquidacion(
        id,
        liquidacionId,
        userId
      )

      const actor = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        'facturacion-updated',
        result.factura,
        eventoMeta({
          tipo: 'updated',
          scope: 'facturas',
          actor,
          etiqueta: result.factura.numero_factura
        })
      )
      for (const liq of result.liquidaciones_afectadas) {
        emitFacturacionLiquidacion(
          'liquidacion-servicio-facturada',
          {
            id: liq.id,
            estado: 'LIQUIDADA',
            factura_id: null,
            numero_factura: null
          },
          eventoMeta({
            tipo: 'estado',
            scope: 'liquidaciones',
            actor,
            etiqueta: liq.consecutivo || result.factura.numero_factura,
            estado_anterior: 'FACTURADA',
            estado_nuevo: 'LIQUIDADA'
          })
        )
      }

      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada') || error.message.includes('no pertenece')) {
        return reply.status(404).send({ error: error.message })
      }
      if (error.message.includes('anulada')) {
        return reply.status(400).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * Batch: obtener factura info para un listado de liquidaciones
   */
  static async batchFacturaInfo(request: FastifyRequest, reply: FastifyReply) {
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
  }

  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const result = await FacturacionLiquidacionesService.eliminar(id)
      emitFacturacionLiquidacion(
        'facturacion-anulada',
        { id },
        eventoMeta({
          tipo: 'deleted',
          scope: 'facturas',
          actor: {
            id: (request as any).user?.id ?? null,
            nombre: (request as any).user?.nombre || 'Usuario'
          },
          etiqueta: (result as any)?.numero_factura ?? id.slice(0, 8)
        })
      )
      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      if (error.message.includes('No se puede eliminar')) {
        return reply.status(409).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  static async restaurar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const result = await FacturacionLiquidacionesService.restaurar(id)
      emitFacturacionLiquidacion(
        'facturacion-created',
        result,
        eventoMeta({
          tipo: 'created',
          scope: 'facturas',
          actor: {
            id: (request as any).user?.id ?? null,
            nombre: (request as any).user?.nombre || 'Usuario'
          },
          etiqueta: (result as any)?.numero_factura ?? id.slice(0, 8)
        })
      )
      return reply.send(result)
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  static async listarEliminadas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await FacturacionLiquidacionesService.listarEliminadas()
      return reply.send(result)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }
}
