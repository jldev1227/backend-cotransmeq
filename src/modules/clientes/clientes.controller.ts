import { FastifyReply, FastifyRequest } from 'fastify'
import { ClientesService } from './cliente.service'
import { 
  createClienteSchema, 
  updateClienteSchema, 
  buscarClientesSchema 
} from './cliente.schema'
import { getIo } from '../../sockets'

interface ClienteParams {
  id: string
}

interface BuscarQuery {
  tipo?: string
  requiere_osi?: string
  paga_recargos?: string
  search?: string
  page?: string
  limit?: string
}

export const ClientesController = {
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createClienteSchema.parse(request.body)
      const cliente = await ClientesService.create(data)
      
      reply.status(201).send({
        success: true,
        message: 'Cliente creado exitosamente',
        data: cliente
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes('Ya existe un cliente')) {
          return reply.status(409).send({
            success: false,
            message: error.message
          })
        }
      }
      throw error
    }
  },

  async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    const { page, limit, tipo, search } = request.query as { 
      page?: string
      limit?: string
      tipo?: string
      search?: string
    }
    
    const pageNum = page ? parseInt(page) : 1
    const limitNum = limit ? parseInt(limit) : 10
    
    const result = await ClientesService.list(pageNum, limitNum, tipo, search)
    
    reply.send({
      success: true,
      message: 'Clientes obtenidos exitosamente',
      ...result
    })
  },

  async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as ClienteParams
    
    try {
      const cliente = await ClientesService.findById(id)
      
      reply.send({
        success: true,
        message: 'Cliente obtenido exitosamente',
        data: cliente
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Cliente no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Cliente no encontrado'
        })
      }
      throw error
    }
  },

  async actualizar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as ClienteParams
    
    try {
      const data = updateClienteSchema.parse(request.body)
      const cliente = await ClientesService.update(id, data)
      
      reply.send({
        success: true,
        message: 'Cliente actualizado exitosamente',
        data: cliente
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Cliente no encontrado') {
          return reply.status(404).send({
            success: false,
            message: 'Cliente no encontrado'
          })
        }
        if (error.message.includes('Ya existe un cliente')) {
          return reply.status(409).send({
            success: false,
            message: error.message
          })
        }
      }
      throw error
    }
  },

  async eliminar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as ClienteParams
    
    try {
      const cliente = await ClientesService.delete(id)
      
      reply.send({
        success: true,
        message: 'Cliente eliminado exitosamente',
        data: cliente
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Cliente no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Cliente no encontrado'
        })
      }
      throw error
    }
  },

  async restaurar(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as ClienteParams
    
    try {
      const cliente = await ClientesService.restore(id)
      
      reply.send({
        success: true,
        message: 'Cliente restaurado exitosamente',
        data: cliente
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Cliente no encontrado') {
          return reply.status(404).send({
            success: false,
            message: 'Cliente no encontrado'
          })
        }
        if (error.message === 'El cliente no está eliminado') {
          return reply.status(400).send({
            success: false,
            message: 'El cliente no está eliminado'
          })
        }
      }
      throw error
    }
  },

  async buscar(request: FastifyRequest, reply: FastifyReply) {
    const query = request.query as BuscarQuery
    
    const searchParams = buscarClientesSchema.parse({
      tipo: query.tipo,
      requiere_osi: query.requiere_osi === 'true',
      paga_recargos: query.paga_recargos === 'true',
      search: query.search,
      page: query.page ? parseInt(query.page) : 1,
      limit: query.limit ? parseInt(query.limit) : 20
    })
    
    const result = await ClientesService.search(searchParams)
    
    reply.send({
      success: true,
      message: 'Búsqueda realizada exitosamente',
      ...result
    })
  },

  async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    const { id } = request.params as ClienteParams
    
    try {
      const stats = await ClientesService.getStats(id)
      
      reply.send({
        success: true,
        message: 'Estadísticas obtenidas exitosamente',
        data: stats
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Cliente no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Cliente no encontrado'
        })
      }
      throw error
    }
  },

  async obtenerBasicos(request: FastifyRequest, reply: FastifyReply) {
    const clientes = await ClientesService.listBasicos()
    
    reply.send({
      success: true,
      data: clientes,
      count: clientes.length
    })
  }
,

  /**
   * Obtener clientes ocultos (solo admin o áreas autorizadas)
   */
  async obtenerOcultos(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Verificar que el usuario es administrador o de las áreas autorizadas
      const user = (request as any).user
      const isAuthorized = user?.role === 'admin' || 
                          user?.area?.includes('operaciones') || 
                          user?.area?.includes('talento_humano');

      if (!isAuthorized) {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden ver clientes ocultos'
        })
      }

      const query = request.query as any
      const page = parseInt(query.page) || 1
      const limit = parseInt(query.limit) || 10
      const tipo = query.tipo || undefined
      const search = query.search || undefined

      const result = await ClientesService.obtenerOcultos(page, limit, tipo, search)
      
      return reply.send({
        success: true,
        message: 'Clientes ocultos obtenidos exitosamente',
        ...result
      })
    } catch (error) {
      console.error('[ClientesController] Error al obtener clientes ocultos:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener clientes ocultos',
        error: error instanceof Error ? error.message : 'Error desconocido'
      })
    }
  },

  /**
   * Cambiar estado de ocultamiento de un cliente (solo admin o áreas autorizadas)
   */
  async cambiarEstadoOculto(request: FastifyRequest<{
    Params: { id: string }
    Body: { oculto: boolean }
  }>, reply: FastifyReply) {
    try {
      // Verificar que el usuario es administrador o de las áreas autorizadas
      const user = (request as any).user
      const isAuthorized = user?.role === 'admin' || 
                          user?.area?.includes('operaciones') || 
                          user?.area?.includes('talento_humano');

      if (!isAuthorized) {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden ocultar/mostrar clientes'
        })
      }

      const { id } = request.params
      const { oculto } = request.body

      // Validar que oculto es un booleano
      if (typeof oculto !== 'boolean') {
        return reply.status(400).send({
          success: false,
          message: 'El campo "oculto" debe ser un valor booleano (true/false)'
        })
      }

      const cliente = await ClientesService.cambiarEstadoOculto(id, oculto)

      // Emitir evento de socket para actualización en tiempo real
      try {
        const io = getIo()
        if (io) {
          io.emit('cliente:oculto', {
            id: cliente.id,
            oculto: cliente.oculto,
            nombre: cliente.nombre
          })
        }
      } catch (socketError) {
        console.warn('No se pudo emitir evento socket individual clientes:', (socketError as any).message)
      }

      return reply.send({
        success: true,
        message: oculto ? 'Cliente ocultado exitosamente' : 'Cliente visible nuevamente',
        data: cliente
      })
    } catch (error) {
      console.error('[ClientesController] Error al cambiar estado oculto:', error)
      
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Cliente no encontrado'
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al cambiar estado de ocultamiento',
        error: error instanceof Error ? error.message : 'Error desconocido'
      })
    }
  },

  // POST /clientes/masivo
  async operacionesMasivas(
    request: FastifyRequest<{
      Body: {
        ids: string[]
        accion: 'ocultar' | 'mostrar' | 'eliminar' | 'restaurar'
      }
    }>,
    reply: FastifyReply
  ) {
    try {
      const user = (request as any).user
      const isAuthorized = user?.role === 'admin' || 
                          user?.area?.includes('operaciones') || 
                          user?.area?.includes('talento_humano');

      if (!isAuthorized) {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden realizar operaciones masivas.'
        })
      }

      const { ids, accion } = request.body

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'Se requieren IDs para la operación masiva'
        })
      }

      let result
      let message = ''

      try {
        switch (accion) {
          case 'ocultar':
            result = await ClientesService.cambiarOcultoMasivo(ids, true)
            message = `${result?.count || 0} clientes ocultados`
            break
          case 'mostrar':
            result = await ClientesService.cambiarOcultoMasivo(ids, false)
            message = `${result?.count || 0} clientes visibles nuevamente`
            break
          case 'eliminar':
            result = await ClientesService.eliminarMasivo(ids)
            message = `${result?.count || 0} clientes movidos a la papelera`
            break
          default:
            return reply.status(400).send({
              success: false,
              message: 'Acción no válida'
            })
        }
      } catch (dbError: any) {
        console.error('Error en DB durante operación masiva de clientes:', dbError)
        throw dbError
      }

      // Emitir evento masivo de forma segura
      try {
        const io = getIo()
        if (io) {
          io.emit('clientes:actualizacion-masiva', { accion, count: result?.count || 0 })
        }
      } catch (socketError) {
        console.warn('No se pudo emitir evento socket en operacion masiva clientes:', (socketError as any).message)
      }

      return reply.send({
        success: true,
        message,
        data: result
      })
    } catch (error: any) {
      console.error('Error general en operación masiva clientes:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error en operación masiva',
        error: error.message
      })
    }
  }
}
