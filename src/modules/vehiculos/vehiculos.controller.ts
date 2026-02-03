import { FastifyReply, FastifyRequest } from 'fastify'
import { VehiculosService } from './vehiculos.service'
import { createVehiculoSchema, updateVehiculoSchema } from './vehiculos.schema'

interface VehiculoParams {
  id: string
}

export const VehiculosController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    try {
      const data = createVehiculoSchema.parse(request.body)
      const vehiculo = await VehiculosService.create(data)
      
      console.log('🚗 [VehiculosController] Vehículo creado:', vehiculo)
      console.log('🚗 [VehiculosController] Tipo:', typeof vehiculo)
      console.log('🚗 [VehiculosController] Keys:', Object.keys(vehiculo || {}))
      
      // Crear objeto plano con campos explícitos
      const vehiculoResponse = {
        id: vehiculo.id,
        placa: vehiculo.placa,
        marca: vehiculo.marca,
        linea: vehiculo.linea,
        modelo: vehiculo.modelo,
        color: vehiculo.color,
        clase_vehiculo: vehiculo.clase_vehiculo,
        tipo_carroceria: vehiculo.tipo_carroceria,
        combustible: vehiculo.combustible,
        numero_motor: vehiculo.numero_motor,
        vin: vehiculo.vin,
        numero_serie: vehiculo.numero_serie,
        numero_chasis: vehiculo.numero_chasis,
        propietario_nombre: vehiculo.propietario_nombre,
        propietario_identificacion: vehiculo.propietario_identificacion,
        kilometraje: vehiculo.kilometraje,
        fecha_matricula: vehiculo.fecha_matricula,
        created_at: vehiculo.created_at?.toISOString(),
        propietario_id: vehiculo.propietario_id,
        updated_at: vehiculo.updated_at?.toISOString(),
        estado: vehiculo.estado,
        conductor_id: vehiculo.conductor_id
      }
      
      console.log('🚗 [VehiculosController] Vehículo para respuesta:', vehiculoResponse)
      
      return reply.status(201).send({
        success: true,
        message: 'Vehículo creado exitosamente',
        data: vehiculoResponse
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Unique constraint')) {
        return reply.status(400).send({
          success: false,
          message: 'Ya existe un vehículo con esa placa'
        })
      }
      throw error
    }
  },

  async list(request: FastifyRequest, reply: FastifyReply) {
    const vehiculos = await VehiculosService.list()
    reply.send({
      success: true,
      data: vehiculos,
      count: vehiculos.length
    })
  },

  async getById(request: FastifyRequest<{ Params: VehiculoParams }>, reply: FastifyReply) {
    const { id } = request.params
    const vehiculo = await VehiculosService.findById(id)
    
    if (!vehiculo) {
      return reply.status(404).send({
        success: false,
        message: 'Vehículo no encontrado'
      })
    }

    reply.send({
      success: true,
      data: vehiculo
    })
  },

  async update(request: FastifyRequest<{ Params: VehiculoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const data = updateVehiculoSchema.parse(request.body)
      
      const vehiculo = await VehiculosService.update(id, data)
      reply.send({
        success: true,
        message: 'Vehículo actualizado exitosamente',
        data: vehiculo
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Vehículo no encontrado'
        })
      }
      throw error
    }
  },

  async delete(request: FastifyRequest<{ Params: VehiculoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      await VehiculosService.delete(id)
      reply.send({
        success: true,
        message: 'Vehículo eliminado exitosamente'
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to delete does not exist')) {
        return reply.status(404).send({
          success: false,
          message: 'Vehículo no encontrado'
        })
      }
      throw error
    }
  },

  async listBasicos(request: FastifyRequest, reply: FastifyReply) {
    const vehiculos = await VehiculosService.listBasicos()
    reply.send({
      success: true,
      data: vehiculos,
      count: vehiculos.length
    })
  },

  async listDeleted(request: FastifyRequest, reply: FastifyReply) {
    const vehiculos = await VehiculosService.listDeleted()
    reply.send({
      success: true,
      data: vehiculos,
      count: vehiculos.length
    })
  },

  async restore(request: FastifyRequest<{ Params: VehiculoParams }>, reply: FastifyReply) {
    try {
      const { id } = request.params
      const vehiculo = await VehiculosService.restore(id)
      reply.send({
        success: true,
        message: 'Vehículo restaurado exitosamente',
        data: vehiculo
      })
    } catch (error) {
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Vehículo no encontrado'
        })
      }
      throw error
    }
  },

  /**
   * Obtener vehículos ocultos (solo admin)
   */
  async obtenerOcultos(request: FastifyRequest, reply: FastifyReply) {
    try {
      // Verificar que el usuario es administrador
      const user = (request as any).user
      if (!user || user.role !== 'admin') {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores pueden ver vehículos ocultos'
        })
      }

      const vehiculos = await VehiculosService.obtenerOcultos()
      
      return reply.send({
        success: true,
        message: 'Vehículos ocultos obtenidos exitosamente',
        data: vehiculos,
        total: vehiculos.length
      })
    } catch (error) {
      console.error('[VehiculosController] Error al obtener vehículos ocultos:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener vehículos ocultos',
        error: error instanceof Error ? error.message : 'Error desconocido'
      })
    }
  },

  /**
   * Cambiar estado de ocultamiento de un vehículo (solo admin)
   */
  async cambiarEstadoOculto(request: FastifyRequest<{
    Params: VehiculoParams
    Body: { oculto: boolean }
  }>, reply: FastifyReply) {
    try {
      // Verificar que el usuario es administrador
      const user = (request as any).user
      if (!user || user.role !== 'admin') {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores pueden ocultar/mostrar vehículos'
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

      const vehiculo = await VehiculosService.cambiarEstadoOculto(id, oculto)

      // Emitir evento de socket para actualización en tiempo real
      const io = (request.server as any).io
      if (io) {
        io.emit('vehiculo:oculto', {
          id: vehiculo.id,
          oculto: vehiculo.oculto,
          placa: vehiculo.placa
        })
      }

      return reply.send({
        success: true,
        message: oculto ? 'Vehículo ocultado exitosamente' : 'Vehículo visible nuevamente',
        data: vehiculo
      })
    } catch (error) {
      console.error('[VehiculosController] Error al cambiar estado oculto:', error)
      
      if (error instanceof Error && error.message.includes('Record to update not found')) {
        return reply.status(404).send({
          success: false,
          message: 'Vehículo no encontrado'
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al cambiar estado de ocultamiento',
        error: error instanceof Error ? error.message : 'Error desconocido'
      })
    }
  }
}
