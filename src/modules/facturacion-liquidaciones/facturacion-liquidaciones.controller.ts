import { FastifyRequest, FastifyReply } from 'fastify'
import { FacturacionLiquidacionesService } from './facturacion-liquidaciones.service'
import { emitFacturacionLiquidacion, emitNotificacion, eventoMeta } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { ErrorCartera } from '../cartera/cartera.condiciones'
import { CarteraService } from '../cartera/cartera.service'
import { condicionesSchema, UUID } from '../cartera/cartera.schema'
import { ZodError } from 'zod'

function esAdministracion(request: FastifyRequest): boolean {
  const areas: string[] = ((request as any).user?.area || []).map((a: string) => a.toUpperCase())
  return areas.includes('ADMINISTRACION')
}

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
            /// La web abre la pestaña Facturas buscando por número (la lista no
            /// filtra por id); el prefijo lo reconoce `rutaDeNotificacion`.
            referencia_tipo: `factura:${factura.numero_factura}`,
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
      /// Valor, emisión o plazo mal digitados (cartera): 400 con el motivo.
      if (error instanceof ErrorCartera) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code })
      }
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
      const { motivo, mantener_aprobada } = request.body as any
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      /// Dejar una liquidación en APROBADA es tocar su aprobación, y eso es
      /// de Administración (mismo criterio que `cambiarEstado`).
      if (mantener_aprobada && !esAdministracion(request)) {
        return reply.status(403).send({
          error: 'Solo Administración puede devolver una liquidación a aprobada.'
        })
      }
      const factura = await FacturacionLiquidacionesService.anular(id, userId, motivo, {
        mantenerAprobada: mantener_aprobada
      })

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
          const estadoNuevo = factura.estados_resultantes[item.liquidacion.id] ?? 'LIQUIDADA'
          emitFacturacionLiquidacion(
            'liquidacion-servicio-facturada',
            {
              id: item.liquidacion.id,
              estado: estadoNuevo,
              factura_id: null,
              numero_factura: null
            },
            eventoMeta({
              tipo: 'estado',
              scope: 'liquidaciones',
              actor: actorAnula,
              etiqueta: item.liquidacion.consecutivo ?? factura.numero_factura,
              estado_anterior: 'FACTURADA',
              estado_nuevo: estadoNuevo
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
            /// La web abre la pestaña Facturas buscando por número (la lista no
            /// filtra por id); el prefijo lo reconoce `rutaDeNotificacion`.
            referencia_tipo: `factura:${factura.numero_factura}`,
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
      /// Tiene abonos registrados: 409 con el motivo, no un 500.
      if (error instanceof ErrorCartera) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code })
      }
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * Corregir valor, emisión, plazo o vencimiento de una factura.
   *
   * Es la misma operación que `PATCH /cartera/facturas/:id/condiciones`, por
   * la puerta de facturación: quien registra la factura (permiso de
   * liquidaciones de servicios) corrige lo que digitó sin necesitar cartera.
   */
  static async actualizarCondiciones(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      if (!UUID.test(String(id))) return reply.status(400).send({ error: 'Identificador inválido' })
      const entrada = condicionesSchema.parse(request.body ?? {})
      await CarteraService.actualizarCondiciones(id, entrada)
      const factura = await FacturacionLiquidacionesService.obtenerCompleta(id)
      if (factura) {
        emitFacturacionLiquidacion(
          'facturacion-updated',
          factura,
          eventoMeta({
            tipo: 'updated',
            scope: 'facturas',
            actor: {
              id: (request as any).user?.id ?? null,
              nombre: (request as any).user?.nombre || 'Usuario'
            },
            etiqueta: factura.numero_factura
          })
        )
      }
      return reply.send(factura)
    } catch (error: any) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: error.errors[0]?.message ?? 'Datos inválidos' })
      }
      if (error instanceof ErrorCartera) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code })
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
      /// `DELETE` con cuerpo opcional: sin él, la liquidación vuelve a
      /// LIQUIDADA como siempre; `destino: 'APROBADA'` la deja autorizada.
      const destino = (request.body as any)?.destino === 'APROBADA' ? 'APROBADA' : 'LIQUIDADA'
      if (destino === 'APROBADA' && !esAdministracion(request)) {
        return reply.status(403).send({
          error: 'Solo Administración puede devolver una liquidación a aprobada.'
        })
      }

      const result = await FacturacionLiquidacionesService.quitarLiquidacion(
        id,
        liquidacionId,
        userId,
        destino
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
            estado: liq.estado,
            factura_id: null,
            numero_factura: null
          },
          eventoMeta({
            tipo: 'estado',
            scope: 'liquidaciones',
            actor,
            etiqueta: liq.consecutivo || result.factura.numero_factura,
            estado_anterior: 'FACTURADA',
            estado_nuevo: liq.estado
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
      /// El evento lleva la factura restaurada, no el `{ message }` del
      /// servicio: los listeners descartan todo payload sin `id`, así que la
      /// factura no reaparecía en ningún otro navegador y la etiqueta del feed
      /// caía al prefijo del id. Mismo fallo que el de liquidaciones de
      /// servicios.
      const factura = await FacturacionLiquidacionesService.obtenerPorId(id)
      emitFacturacionLiquidacion(
        'facturacion-created',
        factura,
        eventoMeta({
          tipo: 'created',
          scope: 'facturas',
          actor: {
            id: (request as any).user?.id ?? null,
            nombre: (request as any).user?.nombre || 'Usuario'
          },
          etiqueta: factura.numero_factura
        })
      )
      return reply.send({ ...result, factura })
    } catch (error: any) {
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      /// Estado que no admite restaurar (no está en la papelera, o su número ya
      /// lo usa otra factura activa): conflicto, no fallo del servidor.
      if (error.message.includes('no está eliminada') || error.message.includes('No se puede restaurar')) {
        return reply.status(409).send({ error: error.message })
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
