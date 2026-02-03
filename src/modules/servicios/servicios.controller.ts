import { FastifyReply, FastifyRequest } from 'fastify'
import { ServiciosService } from './servicios.service'
import { 
  createServicioSchema, 
  updateServicioSchema, 
  cambiarEstadoSchema, 
  asignarPlanillaSchema, 
  buscarServiciosSchema 
} from './servicios.schema'

interface ServicioParams {
  id: string
}

interface BuscarQuery {
  estado?: string
  conductor_id?: string
  vehiculo_id?: string
  cliente_id?: string
  fecha_desde?: string
  fecha_hasta?: string
  proposito_servicio?: string
  page?: string
  limit?: string
}

export const ServiciosController = {
  async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createServicioSchema.parse(request.body)
      const userId = (request as any).user?.id // Obtener ID del usuario autenticado
      const servicio = await ServiciosService.create(data, userId)
      
      reply.status(201).send({
        success: true,
        message: 'Servicio creado exitosamente',
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Foreign key constraint')) {
        return reply.status(400).send({
          success: false,
          message: 'Error en las relaciones: verifique que conductor, vehículo y cliente existan'
        })
      }
      throw error
    }
  },

  async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    const { 
      page, 
      limit, 
      estado, 
      search,
      conductor_id,
      vehiculo_id,
      cliente_id,
      fecha_desde,
      fecha_hasta,
      campo_fecha,
      orderBy,
      orderDirection
    } = request.query as { 
      page?: string
      limit?: string
      estado?: string
      search?: string
      conductor_id?: string
      vehiculo_id?: string
      cliente_id?: string
      fecha_desde?: string
      fecha_hasta?: string
      campo_fecha?: 'fecha_solicitud' | 'fecha_realizacion' | 'created_at' | 'fecha_finalizacion'
      orderBy?: string
      orderDirection?: 'asc' | 'desc'
    }
    
    const pageNum = page ? parseInt(page) : 1
    const limitNum = limit ? parseInt(limit) : 20

    const filters = {
      estado,
      search,
      conductor_id,
      vehiculo_id,
      cliente_id,
      fecha_desde,
      fecha_hasta,
      campo_fecha,
      orderBy,
      orderDirection
    }

    try {
      const result = await ServiciosService.list(pageNum, limitNum, filters)
      
      reply.send({
        success: true,
        data: result.servicios,
        stats: result.stats, // Incluir stats filtradas
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages
        }
      })
    } catch (error) {
      console.error('❌ Error en obtenerTodos:', error)
      reply.status(500).send({
        success: false,
        error: 'Error al obtener servicios',
        details: error instanceof Error ? error.message : 'Unknown error'
      })
    }
  },

  async obtenerStats(request: FastifyRequest, reply: FastifyReply) {
    const stats = await ServiciosService.getStats()
    
    reply.send({
      success: true,
      data: stats
    })
  },

  async obtenerPorId(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    const { id } = request.params
    const servicio = await ServiciosService.findById(id)
    
    if (!servicio) {
      return reply.status(404).send({
        success: false,
        message: 'Servicio no encontrado'
      })
    }

    reply.send({
      success: true,
      data: servicio
    })
  },

  async actualizar(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const data = updateServicioSchema.parse(request.body)
      
      const servicio = await ServiciosService.update(id, data)
      
      reply.send({
        success: true,
        message: 'Servicio actualizado exitosamente',
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async eliminar(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      await ServiciosService.delete(id)
      
      reply.send({
        success: true,
        message: 'Servicio eliminado exitosamente'
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async cambiarEstado(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const data = cambiarEstadoSchema.parse(request.body)
      
      const servicio = await ServiciosService.cambiarEstado(id, data)
      
      reply.send({
        success: true,
        message: `Estado del servicio cambiado a: ${data.estado}`,
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async cancelar(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const { observaciones } = request.body as { observaciones?: string }
      
      const servicio = await ServiciosService.cancelar(id, observaciones)
      
      reply.send({
        success: true,
        message: 'Servicio cancelado exitosamente',
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async asignarNumeroPlanilla(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const data = asignarPlanillaSchema.parse(request.body)
      
      const servicio = await ServiciosService.asignarNumeroPlanilla(id, data)
      
      reply.send({
        success: true,
        message: 'Número de planilla asignado exitosamente',
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async buscarServicios(request: FastifyRequest, reply: FastifyReply) {
    const queryParams = request.query as BuscarQuery
    
    // Convertir strings a números para page y limit
    const searchParams: any = { ...queryParams }
    if (searchParams.page) {
      searchParams.page = parseInt(searchParams.page)
    }
    if (searchParams.limit) {
      searchParams.limit = parseInt(searchParams.limit)
    }
    
    const filters = buscarServiciosSchema.parse(searchParams)
    const result = await ServiciosService.buscar(filters)
    
    reply.send({
      success: true,
      data: result.servicios,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: result.totalPages
      },
      filters: result.filters
    })
  },

  // Funciones para compartir servicios públicamente
  async generarEnlacePublico(request: FastifyRequest<{ Params: ServicioParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const result = await ServiciosService.generarShareToken(id)
      
      reply.send({
        success: true,
        message: 'Token de compartir generado exitosamente',
        data: result
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Servicio no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Servicio no encontrado'
        })
      }
      throw error
    }
  },

  async revocarToken(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) {
    try {
      const { token } = request.params
      await ServiciosService.revocarShareToken(token)
      
      reply.send({
        success: true,
        message: 'Token revocado exitosamente'
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'Token no encontrado') {
        return reply.status(404).send({
          success: false,
          message: 'Token no encontrado'
        })
      }
      throw error
    }
  },

  async obtenerPorTokenPublico(request: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) {
    try {
      const { token } = request.params
      const servicio = await ServiciosService.obtenerPorShareToken(token)
      
      reply.send({
        success: true,
        data: servicio
      })
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === 'Enlace inválido o expirado') {
          return reply.status(404).send({
            success: false,
            message: 'Enlace inválido o expirado'
          })
        }
        if (error.message === 'Este enlace ha expirado') {
          return reply.status(410).send({
            success: false,
            message: 'Este enlace ha expirado'
          })
        }
      }
      throw error
    }
  },

  // Endpoints para obtener listas para filtros
  async obtenerConductores(request: FastifyRequest<{ Querystring: { search?: string } }>, reply: FastifyReply) {
    try {
      const { search } = request.query
      const conductores = await ServiciosService.obtenerConductores(search)
      
      reply.send({
        success: true,
        data: conductores
      })
    } catch (error) {
      throw error
    }
  },

  async obtenerVehiculos(request: FastifyRequest<{ Querystring: { search?: string } }>, reply: FastifyReply) {
    try {
      const { search } = request.query
      const vehiculos = await ServiciosService.obtenerVehiculos(search)
      
      reply.send({
        success: true,
        data: vehiculos
      })
    } catch (error) {
      throw error
    }
  },

  async obtenerClientes(request: FastifyRequest<{ Querystring: { search?: string } }>, reply: FastifyReply) {
    try {
      const { search } = request.query
      const clientes = await ServiciosService.obtenerClientes(search)
      
      reply.send({
        success: true,
        data: clientes
      })
    } catch (error) {
      throw error
    }
  }
}