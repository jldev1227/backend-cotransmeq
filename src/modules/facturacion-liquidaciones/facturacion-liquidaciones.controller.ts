import { FastifyRequest, FastifyReply } from 'fastify'
import {
  FacturacionLiquidacionesService,
  type AnularFacturaInput,
  type EditarFacturaInput
} from './facturacion-liquidaciones.service'
import { EVENTOS_FACTURACION_LIQUIDACIONES as EVENTO } from './facturacion-liquidaciones.events'
import { emitFacturacionLiquidacion, emitNotificacion, eventoMeta } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { ErrorCartera } from '../cartera/cartera.condiciones'
import { CarteraService } from '../cartera/cartera.service'
import { condicionesSchema, UUID } from '../cartera/cartera.schema'
import { z, ZodError } from 'zod'

const editarFacturaSchema = z.object({
  numero_factura: z.string().trim().min(1, 'El número de factura es obligatorio').max(50),
  observaciones: z.string().nullable(),
  fecha_emision: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha de emisión no es válida'),
  plazo_dias: z.number().int().min(0).max(365),
  liquidacion_ids: z.array(z.string().uuid()).optional().default([]),
  quitar_liquidacion_ids: z.array(z.string().uuid()).optional().default([])
}).strict()

const anularFacturaSchema = z.object({
  motivo: z.string().trim().min(1, 'Indique el motivo de anulación'),
  tipo: z.enum(['SIN_MODIFICAR', 'MODIFICAR_LIQUIDACIONES', 'DUPLICIDAD']).default('SIN_MODIFICAR'),
  liquidaciones_a_liquidar: z.array(z.string().uuid()).optional().default([]),
  liquidacion_duplicada_id: z.string().uuid().optional().nullable()
}).strict()

function areasDelUsuario(request: FastifyRequest): string[] {
  const area = (request as any).user?.area
  const areas: unknown[] = Array.isArray(area) ? area : area ? [area] : []
  return areas.filter((value): value is string => typeof value === 'string').map((value) => value.toUpperCase())
}

function esAdministracion(request: FastifyRequest): boolean {
  return areasDelUsuario(request).includes('ADMINISTRACION')
}

function esFacturacion(request: FastifyRequest): boolean {
  return areasDelUsuario(request).includes('FACTURACION')
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
        EVENTO.facturaCreada,
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
            EVENTO.liquidacionFacturada,
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
      const entrada = anularFacturaSchema.parse(request.body ?? {})
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      const nivelAcceso = (request as any).accessLevel
      /// El middleware acepta niveles superiores al umbral `limited`; `read`
      /// también lo supera en el orden general, pero aquí no debe habilitar escritura.
      if (nivelAcceso !== 'limited' && nivelAcceso !== 'full') {
        return reply.status(403).send({
          error: 'Se requiere permiso Limitado o Completo para anular facturas.'
        })
      }
      const puedeElegirDestinoEspecial =
        esFacturacion(request) || (esAdministracion(request) && nivelAcceso === 'full')
      /// Facturación puede escoger el destino de las liquidaciones al anular;
      /// Administración conserva esa opción cuando su acceso efectivo es Completo.
      const requiereAjusteEspecial =
        entrada.tipo !== 'SIN_MODIFICAR' ||
        entrada.liquidaciones_a_liquidar.length > 0 ||
        Boolean(entrada.liquidacion_duplicada_id)
      if (!esAdministracion(request) && !esFacturacion(request)) {
        return reply.status(403).send({
          error: 'Solo Administración o Facturación pueden anular facturas.'
        })
      }
      if (!puedeElegirDestinoEspecial && requiereAjusteEspecial) {
        return reply.status(403).send({
          error: 'Solo Facturación o Administración con permiso Completo pueden elegir el resultado de las liquidaciones.'
        })
      }
      const opciones: AnularFacturaInput = {
        tipo: entrada.tipo,
        liquidaciones_a_liquidar: entrada.liquidaciones_a_liquidar,
        liquidacion_duplicada_id: entrada.liquidacion_duplicada_id ?? undefined
      }
      const factura = await FacturacionLiquidacionesService.anular(id, userId, entrada.motivo, opciones)

      // Emit socket
      const actorAnula = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        EVENTO.facturaAnulada,
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
            EVENTO.liquidacionFacturada,
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
            mensaje: `${userName} anuló la factura ${factura.numero_factura}. Motivo: ${entrada.motivo}`,
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
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: error.errors[0]?.message ?? 'Datos inválidos' })
      }
      /// Tiene abonos registrados: 409 con el motivo, no un 500.
      if (error instanceof ErrorCartera) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code })
      }
      if (error.message.includes('no encontrada')) {
        return reply.status(404).send({ error: error.message })
      }
      if (
        error.message.includes('Seleccione') ||
        error.message.includes('No repita') ||
        error.message.includes('Solo puede devolver')
      ) {
        return reply.status(400).send({ error: error.message })
      }
      if (error.message.includes('cambiaron mientras') || error.message.includes('ya está anulada')) {
        return reply.status(409).send({ error: error.message })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  /**
   * Editar consecutivo, observaciones y condiciones, y asociar liquidaciones
   * nuevas en una sola operación.
   */
  static async editar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      if (!UUID.test(String(id))) return reply.status(400).send({ error: 'Identificador inválido' })
      const entrada = editarFacturaSchema.parse(request.body ?? {}) as EditarFacturaInput
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      if (entrada.quitar_liquidacion_ids.length > 0 && !esAdministracion(request) && !esFacturacion(request)) {
        return reply.status(403).send({
          error: 'Solo Administración o Facturación pueden devolver liquidaciones a aprobada al editar la factura.'
        })
      }
      const result = await FacturacionLiquidacionesService.editar(id, userId, entrada)
      const { actividad, ...respuesta } = result
      ;(request as any).actividadFactura = actividad
      const actor = { id: userId ?? null, nombre: userName }

      emitFacturacionLiquidacion(
        EVENTO.facturaActualizada,
        result.factura,
        eventoMeta({
          tipo: 'updated',
          scope: 'facturas',
          actor,
          etiqueta: result.factura.numero_factura
        })
      )
      for (const liquidacion of result.liquidaciones_afectadas) {
        emitFacturacionLiquidacion(
          EVENTO.liquidacionFacturada,
          {
            id: liquidacion.id,
            estado: liquidacion.estado,
            factura_id: liquidacion.factura_id,
            numero_factura: liquidacion.numero_factura
          },
          eventoMeta({
            tipo: 'estado',
            scope: 'liquidaciones',
            actor,
            etiqueta: liquidacion.consecutivo,
            estado_anterior: liquidacion.estado_anterior,
            estado_nuevo: liquidacion.estado
          })
        )
      }

      return reply.send(respuesta)
    } catch (error: any) {
      if (error instanceof ZodError) {
        return reply.status(400).send({ error: error.errors[0]?.message ?? 'Datos inválidos' })
      }
      if (error instanceof ErrorCartera) {
        return reply.status(error.statusCode).send({ error: error.message, code: error.code })
      }
      if (error?.code === 'P2002' || error.message?.includes('Ya existe')) {
        return reply.status(409).send({ error: error.message || 'Ya existe una factura con ese número' })
      }
      if (error.message?.includes('no encontrada') || error.message?.includes('no fueron encontradas')) {
        return reply.status(404).send({ error: error.message })
      }
      if (
        error.message?.includes('está anulada') ||
        error.message?.includes('ya están facturadas') ||
        error.message?.includes('cambiaron mientras') ||
        error.message?.includes('ya no pertenecen')
      ) {
        return reply.status(409).send({ error: error.message })
      }
      if (
        error.message?.includes('no están en estado') ||
        error.message?.includes('No repita') ||
        error.message?.includes('no puede agregarse')
      ) {
        return reply.status(400).send({ error: error.message })
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
          EVENTO.facturaActualizada,
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
        EVENTO.facturaActualizada,
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
          EVENTO.liquidacionFacturada,
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

  /** Quitar una liquidación de su factura y devolverla a APROBADA. */
  static async quitarLiquidacion(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id, liquidacionId } = request.params as any
      const userId = (request as any).user?.id
      const userName = (request as any).user?.nombre || 'Usuario'
      /// Solo la anulación tipificada puede devolver liquidaciones a LIQUIDADA.
      /// Desasociar una liquidación de una factura activa la deja APROBADA.
      if (!esAdministracion(request)) {
        return reply.status(403).send({
          error: 'Solo Administración puede devolver una liquidación a aprobada.'
        })
      }

      const result = await FacturacionLiquidacionesService.quitarLiquidacion(
        id,
        liquidacionId,
        userId
      )

      const actor = { id: userId ?? null, nombre: userName }
      emitFacturacionLiquidacion(
        EVENTO.facturaActualizada,
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
          EVENTO.liquidacionFacturada,
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
      if (error.message.includes('cambió mientras')) {
        return reply.status(409).send({ error: error.message })
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
        EVENTO.facturaAnulada,
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
        EVENTO.facturaCreada,
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
