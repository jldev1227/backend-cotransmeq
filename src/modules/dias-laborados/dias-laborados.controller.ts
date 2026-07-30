import { FastifyReply, FastifyRequest } from 'fastify'
import { DiasLaboradosService } from './dias-laborados.service'
import {
  solicitarAccesoSchema,
  crearRegistroSchema,
  listarRegistrosSchema,
  calendarAdminSchema
} from './dias-laborados.schema'
import {
  guardarRegistrosMasivosSchema,
  editarSegmentoSchema,
  editarRegistroSchema
} from './dias-laborados-admin.schema'
import { getIO } from '../../sockets'

export const DiasLaboradosController = {

  // ─── PUBLIC: Solicitar acceso (enviar magic link) ──────
  async solicitarAcceso(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { numero_identificacion } = solicitarAccesoSchema.parse(request.body)
      const result = await DiasLaboradosService.solicitarAcceso(numero_identificacion)

      return reply.send({
        success: true,
        ...result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al solicitar acceso'
      })
    }
  },

  // ─── PUBLIC: Verificar token (al abrir magic link) ──────
  async verificarToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { token } = request.query as { token: string }
      if (!token) {
        return reply.status(400).send({ success: false, message: 'Token requerido' })
      }

      const result = await DiasLaboradosService.verificarToken(token)

      return reply.send({
        success: true,
        data: result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al verificar token'
      })
    }
  },

  // ─── PROTECTED: Guardar registro de día ──────
  async guardarRegistro(request: FastifyRequest, reply: FastifyReply) {
    try {
      const conductor = (request as any).conductorDiasLaborados
      const data = crearRegistroSchema.parse(request.body)
      const registro = await DiasLaboradosService.upsertRegistro(conductor.id, data)

      // Emitir evento en tiempo real a todos los clientes conectados
      try {
        const io = getIO()
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: conductor.id,
          conductor_nombre: conductor.nombre,
          conductor_apellido: conductor.apellido,
          fecha: data.fecha,
          tipo: data.tipo,
          segmentos_count: data.segmentos?.length ?? 0,
          timestamp: new Date().toISOString()
        })
      } catch (e) {
        // Si el socket no está inicializado, continuar sin error
      }

      return reply.send({
        success: true,
        message: 'Registro guardado exitosamente',
        data: registro
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al guardar registro'
      })
    }
  },

  // ─── PROTECTED: Listar registros ──────
  async listarRegistros(request: FastifyRequest, reply: FastifyReply) {
    try {
      const conductor = (request as any).conductorDiasLaborados
      const { mes, desde, hasta } = listarRegistrosSchema.parse(request.query)
      const registros = await DiasLaboradosService.listarRegistros(conductor.id, mes, desde, hasta)

      return reply.send({
        success: true,
        data: registros,
        count: registros.length
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al listar registros'
      })
    }
  },

  // ─── PROTECTED: Eliminar registro ──────
  async eliminarRegistro(request: FastifyRequest, reply: FastifyReply) {
    try {
      const conductor = (request as any).conductorDiasLaborados
      const { fecha } = request.params as { fecha: string }
      const result = await DiasLaboradosService.eliminarRegistro(conductor.id, fecha)

      // Emitir evento de eliminación
      try {
        const io = getIO()
        io.emit('dias-laborados:registro-actualizado', {
          conductor_id: conductor.id,
          conductor_nombre: conductor.nombre,
          conductor_apellido: conductor.apellido,
          fecha,
          tipo: null,
          segmentos_count: 0,
          eliminado: true,
          timestamp: new Date().toISOString()
        })
      } catch (e) {}

      return reply.send({
        success: true,
        ...result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al eliminar registro'
      })
    }
  },

  // ─── PROTECTED: Calendar admin (vista de calendario en dashboard) ──────
  async calendarAdmin(request: FastifyRequest, reply: FastifyReply) {
    try {
      const parsed = calendarAdminSchema.parse(request.query)
      const data = { mes: parsed.mes, anio: parsed.anio, conductor_id: parsed.conductor_id }
      const result = await DiasLaboradosService.calendar(data)
      return reply.send({
        success: true,
        data: result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al obtener el calendario'
      })
    }
  },

  // ─── PROTECTED: Listar clientes (para select) ──────
  async listarClientes(request: FastifyRequest, reply: FastifyReply) {
    try {
      const clientes = await DiasLaboradosService.listarClientes()
      return reply.send({
        success: true,
        data: clientes,
        count: clientes.length
      })
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        message: err.message || 'Error al listar clientes'
      })
    }
  },

  // ─── PROTECTED: Listar vehículos (para select) ──────
  async listarVehiculos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const vehiculos = await DiasLaboradosService.listarVehiculos()
      return reply.send({
        success: true,
        data: vehiculos,
        count: vehiculos.length
      })
    } catch (err: any) {
      return reply.status(500).send({
        success: false,
        message: err.message || 'Error al listar vehículos'
      })
    }
  },

  // ─── PROTECTED (admin): Guardado MASIVO de recorridos ──────
  // Pensado para que el operador registre un mes entero de un conductor
  // en una sola llamada, a partir de "patrones" (placa+cliente+horario)
  // y asignación de fechas.
  async guardarRegistrosMasivos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = guardarRegistrosMasivosSchema.parse(request.body)
      const result = await DiasLaboradosService.guardarRegistrosMasivos(data)
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al guardar registros masivos'
      })
    }
  },

  // ─── PROTECTED (admin): Editar un segmento (tramo) específico ──────
  // PUT /api/dias-laborados/admin/segmento/:id
  // Solo los campos de detalle. No toca registro_dia padre.
  async editarSegmento(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = editarSegmentoSchema.parse(request.body)
      const result = await DiasLaboradosService.editarSegmento(id, data)
      return reply.send({
        success: true,
        message: 'Segmento actualizado',
        data: result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al editar el segmento'
      })
    }
  },

  // ─── PROTECTED (admin): Soft delete de un segmento ──────
  // DELETE /api/dias-laborados/admin/segmento/:id
  // Marca deleted_at. No borra físicamente.
  async softDeleteSegmento(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const result = await DiasLaboradosService.softDeleteSegmento(id)
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al eliminar el segmento'
      })
    }
  },

  // ─── PROTECTED (admin): Editar metadata de un registro (día) ──────
  // PUT /api/dias-laborados/admin/registro/:id
  // Solo tipo + observaciones. No toca los segmentos.
  async editarRegistro(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = editarRegistroSchema.parse(request.body)
      const result = await DiasLaboradosService.editarRegistro(id, data)
      return reply.send({
        success: true,
        message: 'Registro actualizado',
        data: result
      })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al editar el registro'
      })
    }
  },

  // ─── PROTECTED (admin): Soft delete de un registro (día completo) ──────
  // DELETE /api/dias-laborados/admin/registro/:id
  // Marca deleted_at en el padre y en cascada en sus segmentos activos.
  // Usado para días DESCANSO / MANTENIMIENTO sin segmentos, o para
  // borrar un día completo de un solo click.
  async softDeleteRegistro(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const result = await DiasLaboradosService.softDeleteRegistro(id)
      return reply.send({ success: true, ...result })
    } catch (err: any) {
      const status = err.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: err.message || 'Error al eliminar el registro'
      })
    }
  }
}
