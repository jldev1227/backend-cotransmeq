import { FastifyReply, FastifyRequest } from 'fastify'
import { RecargosService } from './recargos.service'
import { z } from 'zod'
import { 
  createRecargoSchema, 
  updateRecargoSchema, 
  buscarRecargosSchema,
  liquidarRecargoSchema,
  cambiarEstadoMultipleSchema
} from './recargos.schema'

interface RecargoParams {
  id: string
}

export const RecargosController = {
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      console.log('📥 Body recibido en crear:', JSON.stringify(request.body, null, 2))
      
      const data = createRecargoSchema.parse(request.body)
  const userId = (request as any).user?.id
      
      const recargo = await RecargosService.create(data, userId)
      
      // Emitir evento socket para notificar recargo creado
      const io = (request.server as any).io
      if (io) {
        io.emit('recargo-creado', {
          recargoId: recargo.id,
          recargo: recargo
        })
      }
      
      reply.status(201).send({
        success: true,
        message: 'Recargo creado exitosamente',
        data: recargo
      })
    } catch (error) {
      console.error('❌ Error en crear recargo:', error)
      
      if (error instanceof z.ZodError) {
        console.error('❌ Errores de validación Zod:', JSON.stringify(error.errors, null, 2))
        return reply.status(400).send({
          success: false,
          message: 'Error de validación',
          errors: error.errors
        })
      }
      
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async obtenerParaCanvas(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Log para debug
      console.log('Query params recibidos:', request.query)
      
      const query = buscarRecargosSchema.parse(request.query)
      
      const page = parseInt(query.page)
      const limit = parseInt(query.limit)
      
      const filters = {
        mes: query.mes,
        año: query.año,
        conductor_id: query.conductor_id,
        vehiculo_id: query.vehiculo_id,
        empresa_id: query.empresa_id,
        estado: query.estado,
        numero_planilla: query.numero_planilla
      }

      const result = await RecargosService.list(page, limit, filters)
      
      reply.send({
        success: true,
        data: result.recargos,
        pagination: result.pagination
      })
    } catch (error) {
      console.error('Error en obtenerParaCanvas:', error)
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Error de validación',
          errors: error.errors
        })
      }
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async obtenerPorId(request: FastifyRequest<{ Params: RecargoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const recargo = await RecargosService.findById(id)
      
      reply.send({
        success: true,
        data: recargo
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Recargo no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Recargo no encontrado'
        })
      }
      throw error
    }
  },

  async actualizar(request: FastifyRequest<{ Params: RecargoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const data = updateRecargoSchema.parse(request.body)
  const userId = (request as any).user?.id
      
      const recargo = await RecargosService.update(id, data, userId)
      
      // Emitir evento socket para notificar recargo actualizado
      const io = (request.server as any).io
      if (io) {
        io.emit('recargo-actualizado', {
          recargoId: recargo.id,
          recargo: recargo
        })
      }
      
      reply.send({
        success: true,
        message: 'Recargo actualizado exitosamente',
        data: recargo
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async eliminar(request: FastifyRequest<{ Params: RecargoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const userId = (request as any).user?.id
      
      const result = await RecargosService.softDelete(id, userId)
      
      // Emitir evento socket para notificar recargo eliminado
      const io = (request.server as any).io
      if (io) {
        io.emit('recargo-eliminado', {
          recargoId: id
        })
      }
      
      reply.send({
        success: true,
        message: result.message
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async eliminarMultiple(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { ids } = request.body as { ids: string[] }
      const userId = (request as any).user?.id

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'Debe proporcionar un array de IDs válido'
        })
      }

      const result = await RecargosService.softDeleteMany(ids, userId)

      // Emitir evento socket para notificar recargos eliminados
      const io = (request.server as any).io
      if (io) {
        io.emit('recargos-eliminados', {
          recargoIds: ids,
          cantidad: result.eliminados
        })
      }

      reply.send({
        success: true,
        message: result.message,
        data: {
          eliminados: result.eliminados
        }
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async liquidar(request: FastifyRequest<{ Params: RecargoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
  const userId = (request as any).user?.id
      
      const recargo = await RecargosService.liquidar(id, userId)
      
      reply.send({
        success: true,
        message: 'Recargo liquidado exitosamente',
        data: recargo
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async duplicar(request: FastifyRequest<{ Params: RecargoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
  const userId = (request as any).user?.id
      
      const recargo = await RecargosService.duplicar(id, userId)
      
      reply.status(201).send({
        success: true,
        message: 'Recargo duplicado exitosamente',
        data: recargo
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async cambiarEstadoMultiple(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = cambiarEstadoMultipleSchema.parse(request.body)
      const userId = (request as any).user?.id

      const result = await RecargosService.cambiarEstadoMultiple(data.ids, data.estado, userId)

      // Emitir evento socket para notificar cambio de estado masivo
      const io = (request.server as any).io
      if (io) {
        io.emit('recargos-estado-actualizado', {
          recargoIds: data.ids,
          estado: data.estado,
          cantidad: result.actualizados
        })
      }

      reply.send({
        success: true,
        message: result.message,
        data: {
          actualizados: result.actualizados,
          estado: result.estado
        }
      })
    } catch (error) {
      if (error instanceof z.ZodError) {
        return reply.status(400).send({
          success: false,
          message: 'Error de validación',
          errors: error.errors
        })
      }
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async obtenerTiposRecargo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const tipos = await RecargosService.getTiposRecargo()
      
      reply.send({
        success: true,
        data: tipos
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  },

  async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = request.query as any
      
      const filters = {
        mes: query.mes,
        año: query.año,
        empresa_id: query.empresa_id
      }

      const estadisticas = await RecargosService.getEstadisticas(filters)
      
      reply.send({
        success: true,
        data: estadisticas
      })
    } catch (error) {
      if (error instanceof Error) {
        reply.status(400).send({
          success: false,
          message: error.message
        })
      } else {
        throw error
      }
    }
  }
}
