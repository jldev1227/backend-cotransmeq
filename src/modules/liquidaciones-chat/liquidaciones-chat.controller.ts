import { FastifyRequest, FastifyReply } from 'fastify'
import { LiquidacionesChatService } from './liquidaciones-chat.service'
import { getIo } from '../../sockets'

interface AuthUser {
  id: string
  nombre: string
  correo: string
}

function getUser(req: FastifyRequest): AuthUser {
  return (req as any).user
}

export const LiquidacionesChatController = {
  async listarMensajes(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string }
    const { before, limit } = req.query as { before?: string; limit?: string }

    const result = await LiquidacionesChatService.listarMensajes(
      id,
      before,
      limit ? parseInt(limit, 10) : 50,
    )

    return reply.send(result)
  },

  async enviarMensaje(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string }
    const user = getUser(req)
    const body = req.body as { contenido: string; tipo: string; recordatorio_id?: string }

    if (!body.contenido || !body.contenido.trim()) {
      return reply.code(400).send({ error: 'Contenido requerido' })
    }

    const mensaje = await LiquidacionesChatService.enviarMensaje(
      id,
      user.id,
      body.contenido.trim(),
      body.tipo || 'NOTA',
      body.recordatorio_id,
    )

    try {
      const io = getIo()
      io.to(`chat:liquidacion-tercero:${id}`).emit('chat:message', {
        id: mensaje.id,
        liquidacion_tercero_id: mensaje.liquidacion_tercero_id,
        usuario_id: mensaje.usuario_id,
        usuario_nombre: mensaje.usuario?.nombre || '',
        contenido: mensaje.contenido,
        nonce: mensaje.nonce,
        tipo: mensaje.tipo,
        recordatorio_id: mensaje.recordatorio_id,
        created_at: mensaje.created_at,
      })
    } catch (e) {
      console.error('[chat] error emitting message:', e)
    }

    return reply.code(201).send(mensaje)
  },

  async eliminarMensaje(req: FastifyRequest, reply: FastifyReply) {
    const { id, msgId } = req.params as { id: string; msgId: string }
    const user = getUser(req)

    try {
      await LiquidacionesChatService.eliminarMensaje(msgId, user.id)
      return reply.send({ ok: true })
    } catch (e: any) {
      return reply.code(403).send({ error: e.message })
    }
  },

  async listarRecordatorios(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string }
    const recordatorios = await LiquidacionesChatService.listarRecordatorios(id)
    return reply.send(recordatorios)
  },

  async crearRecordatorio(req: FastifyRequest, reply: FastifyReply) {
    const { id } = req.params as { id: string }
    const user = getUser(req)
    const body = req.body as {
      placa: string
      mes: number
      anio: number
      descripcion: string
      monto?: number
      prioridad: string
      aplica_en?: string
    }

    if (!body.descripcion || !body.descripcion.trim()) {
      return reply.code(400).send({ error: 'Descripción requerida' })
    }

    const recordatorio = await LiquidacionesChatService.crearRecordatorio(id, user.id, body)

    const mensaje = await LiquidacionesChatService.enviarMensaje(
      id,
      user.id,
      `Recordatorio creado: ${body.descripcion}`,
      'RECORDATORIO_REF',
      recordatorio.id,
    )

    try {
      const io = getIo()
      io.to(`chat:liquidacion-tercero:${id}`).emit('chat:recordatorio:nuevo', {
        id: recordatorio.id,
        liquidacion_origen_id: recordatorio.liquidacion_origen_id,
        placa: recordatorio.placa,
        mes: recordatorio.mes,
        anio: recordatorio.anio,
        descripcion: recordatorio.descripcion_cifrada,
        nonce: recordatorio.descripcion_nonce,
        monto: recordatorio.monto ? parseFloat(recordatorio.monto as any) : null,
        moneda: recordatorio.moneda,
        estado: recordatorio.estado,
        prioridad: recordatorio.prioridad,
        creado_por_usuario_id: recordatorio.creado_por_usuario_id,
        creado_por_nombre: recordatorio.creado_por.nombre,
        created_at: recordatorio.created_at,
        aplica_en: recordatorio.aplica_en,
      })

      io.to(`chat:liquidacion-tercero:${id}`).emit('chat:message', {
        id: mensaje.id,
        liquidacion_tercero_id: mensaje.liquidacion_tercero_id,
        usuario_id: mensaje.usuario_id,
        usuario_nombre: mensaje.usuario?.nombre || '',
        contenido: mensaje.contenido,
        nonce: mensaje.nonce,
        tipo: mensaje.tipo,
        recordatorio_id: mensaje.recordatorio_id,
        created_at: mensaje.created_at,
      })
    } catch (e) {
      console.error('[chat] error emitting recordatorio:', e)
    }

    return reply.code(201).send(recordatorio)
  },

  async cambiarEstadoRecordatorio(req: FastifyRequest, reply: FastifyReply) {
    const { recordatorioId } = req.params as { recordatorioId: string }
    const body = req.body as { estado: string; liquidacion_aplicada_id?: string }

    const recordatorio = await LiquidacionesChatService.cambiarEstadoRecordatorio(
      recordatorioId,
      body.estado,
      body.liquidacion_aplicada_id,
    )

    try {
      const io = getIo()
      io.to(`chat:liquidacion-tercero:${recordatorio.liquidacion_origen_id}`).emit(
        'chat:recordatorio:estado',
        {
          id: recordatorio.id,
          estado: recordatorio.estado,
          aplicado_en_liquidacion_id: recordatorio.aplicado_en_liquidacion_id,
        },
      )
    } catch (e) {
      console.error('[chat] error emitting estado:', e)
    }

    return reply.send(recordatorio)
  },

  async pendientesPorPlaca(req: FastifyRequest, reply: FastifyReply) {
    const { placa, mes, anio } = req.query as { placa: string; mes: string; anio: string }
    const recordatorios = await LiquidacionesChatService.pendientesPorPlaca(
      placa,
      parseInt(mes, 10),
      parseInt(anio, 10),
    )
    return reply.send(recordatorios)
  },
}
