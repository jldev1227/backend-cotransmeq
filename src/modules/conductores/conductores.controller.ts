// @ts-nocheck
import { FastifyRequest, FastifyReply } from 'fastify'
import { ConductoresService } from './conductores.service'
import { getIo } from '../../sockets'

interface ObtenerTodosQuery {
  page?: string
  limit?: string
  search?: string
  estado?: string
  sede_trabajo?: string
}

interface ConductorParams {
  id: string
}

interface ActualizarEstadoBody {
  estado: string
}

interface ConductorBody {
  numero_identificacion: string
  nombres: string
  apellidos: string
  email?: string
  telefono?: string
  fecha_nacimiento?: string
  direccion?: string
  ciudad?: string
  departamento?: string
  sede_trabajo?: string
  tipo_licencia?: string
  categoria_licencia?: string
  fecha_expedicion_licencia?: string
  fecha_vencimiento_licencia?: string
  numero_licencia?: string
  estado?: string
  observaciones?: string
  foto_url?: string
}

export const ConductoresController = {
  // GET /conductores
  async obtenerTodos(
    request: FastifyRequest<{ Querystring: ObtenerTodosQuery }>,
    reply: FastifyReply
  ) {
    try {
      const { page, limit, search, estado, sede_trabajo } = request.query

      const filters: any = {}
      
      if (search) filters.search = search
      if (estado) filters.estado = estado
      if (sede_trabajo) filters.sede_trabajo = sede_trabajo
      if (page) filters.page = parseInt(page)
      if (limit) filters.limit = parseInt(limit)

      const result = await ConductoresService.obtenerTodos(filters)

      return reply.status(200).send({
        success: true,
        data: result.conductores,
        pagination: result.pagination
      })
    } catch (error: any) {
      console.error('Error al obtener conductores:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener conductores',
        error: error.message
      })
    }
  },

  // GET /conductores/:id
  async obtenerPorId(
    request: FastifyRequest<{ Params: ConductorParams }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params

      const conductor = await ConductoresService.obtenerPorId(id)

      if (!conductor) {
        return reply.status(404).send({
          success: false,
          message: 'Conductor no encontrado'
        })
      }

      return reply.status(200).send({
        success: true,
        data: conductor
      })
    } catch (error: any) {
      console.error('Error al obtener conductor:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener conductor',
        error: error.message
      })
    }
  },

  // POST /conductores
  async crear(
    request: FastifyRequest<{ Body: ConductorBody }>,
    reply: FastifyReply
  ) {
    try {
      const data = request.body
      const creado_por_id = (request.user as any)?.id

      const conductor = await ConductoresService.crear(data, creado_por_id)

      return reply.status(201).send({
        success: true,
        data: conductor,
        message: 'Conductor creado exitosamente'
      })
    } catch (error: any) {
      console.error('Error al crear conductor:', error)
      
      if (error.message.includes('ya existe')) {
        return reply.status(400).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al crear conductor',
        error: error.message
      })
    }
  },

  // PUT /conductores/:id
  async actualizar(
    request: FastifyRequest<{ Params: ConductorParams; Body: ConductorBody }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params
      const data = request.body
      const actualizado_por_id = (request.user as any)?.id

      const conductor = await ConductoresService.actualizar(id, data, actualizado_por_id)

      return reply.status(200).send({
        success: true,
        data: conductor,
        message: 'Conductor actualizado exitosamente'
      })
    } catch (error: any) {
      console.error('Error al actualizar conductor:', error)
      
      if (error.message === 'Conductor no encontrado') {
        return reply.status(404).send({
          success: false,
          message: error.message
        })
      }

      if (error.message.includes('ya existe')) {
        return reply.status(400).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al actualizar conductor',
        error: error.message
      })
    }
  },

  // PATCH /conductores/:id/estado
  async actualizarEstado(
    request: FastifyRequest<{ Params: ConductorParams; Body: ActualizarEstadoBody }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params
      const { estado } = request.body
      const actualizado_por_id = (request.user as any)?.id

      if (!estado) {
        return reply.status(400).send({
          success: false,
          message: 'El campo estado es requerido'
        })
      }

      const conductor = await ConductoresService.actualizarEstado(id, estado, actualizado_por_id)

      return reply.status(200).send({
        success: true,
        data: conductor,
        message: 'Estado actualizado exitosamente'
      })
    } catch (error: any) {
      console.error('Error al actualizar estado:', error)
      
      if (error.message === 'Conductor no encontrado') {
        return reply.status(404).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al actualizar estado',
        error: error.message
      })
    }
  },

  // DELETE /conductores/:id
  async eliminar(
    request: FastifyRequest<{ Params: ConductorParams }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params
      const actualizado_por_id = (request.user as any)?.id

      const conductor = await ConductoresService.eliminar(id, actualizado_por_id)

      return reply.status(200).send({
        success: true,
        data: conductor,
        message: 'Conductor eliminado exitosamente (soft delete)'
      })
    } catch (error: any) {
      console.error('Error al eliminar conductor:', error)
      
      if (error.message === 'Conductor no encontrado') {
        return reply.status(404).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al eliminar conductor',
        error: error.message
      })
    }
  },

  // POST /conductores/:id/foto
  async subirFoto(
    request: FastifyRequest<{ Params: ConductorParams }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params
      
      console.log('Subiendo foto para conductor:', id)
      console.log('Content-Type:', request.headers['content-type'])
      
      const data = await request.file()

      if (!data) {
        console.log('No se recibió archivo')
        return reply.status(400).send({
          success: false,
          message: 'No se ha proporcionado ningún archivo'
        })
      }

      console.log('Archivo recibido:', {
        filename: data.filename,
        mimetype: data.mimetype,
        encoding: data.encoding
      })

      const buffer = await data.toBuffer()
      console.log('Buffer size:', buffer.length)

      const file = {
        originalname: data.filename,
        buffer: buffer,
        mimetype: data.mimetype
      }

      const conductor = await ConductoresService.subirFoto(id, file)

      // Emitir evento por socket
      try {
        const io = getIo()
        io.emit('conductor:foto-actualizada', {
          conductorId: id,
          fotoUrl: conductor.foto_url,
          fotoUrlFirmada: conductor.foto_url_firmada
        })
      } catch (error) {
        console.error('Error emitiendo evento socket:', error)
      }

      return reply.status(200).send({
        success: true,
        data: conductor,
        message: 'Foto subida exitosamente'
      })
    } catch (error: any) {
      console.error('Error al subir foto:', error)
      
      if (error.message === 'Conductor no encontrado') {
        return reply.status(404).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al subir foto',
        error: error.message
      })
    }
  },

  // DELETE /conductores/:id/foto
  async eliminarFoto(
    request: FastifyRequest<{ Params: ConductorParams }>,
    reply: FastifyReply
  ) {
    try {
      const { id } = request.params

      const result = await ConductoresService.eliminarFoto(id)

      return reply.status(200).send({
        success: true,
        data: result,
        message: 'Foto eliminada exitosamente'
      })
    } catch (error: any) {
      console.error('Error al eliminar foto:', error)
      
      if (error.message === 'Conductor no encontrado') {
        return reply.status(404).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: 'Error al eliminar foto',
        error: error.message
      })
    }
  },

  // GET /conductores/ocultos
  async obtenerOcultos(
    request: FastifyRequest<{ Querystring: ObtenerTodosQuery }>,
    reply: FastifyReply
  ) {
    try {
      // Verificar que sea admin o de las áreas autorizadas
      const user = (request as any).user
      const isAuthorized = user?.role === 'admin' || 
                          user?.area?.includes('operaciones') || 
                          user?.area?.includes('talento_humano');

      if (!isAuthorized) {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden ver conductores ocultos.'
        })
      }

      const { page, limit, search } = request.query

      const conductores = await ConductoresService.obtenerOcultos({
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
        search
      })

      return reply.send({
        success: true,
        ...conductores
      })
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener conductores ocultos',
        error: error.message
      })
    }
  },

  // PATCH /conductores/:id/ocultar
  async cambiarEstadoOculto(
    request: FastifyRequest<{
      Params: ConductorParams
      Body: { oculto: boolean }
    }>,
    reply: FastifyReply
  ) {
    try {
      // Verificar que sea admin o de las áreas autorizadas
      const user = (request as any).user
      const isAuthorized = user?.role === 'admin' || 
                          user?.area?.includes('operaciones') || 
                          user?.area?.includes('talento_humano');

      if (!isAuthorized) {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden ocultar/mostrar conductores.'
        })
      }

      const { id } = request.params
      const { oculto } = request.body

      const conductor = await ConductoresService.cambiarEstadoOculto(id, oculto)

      // Emitir evento via socket para actualizar en tiempo real de forma segura
      try {
        const io = getIo()
        if (io) {
          io.emit('conductor:oculto', { id, oculto })
        }
      } catch (socketError) {
        console.warn('No se pudo emitir evento socket individual:', (socketError as any).message)
      }

      return reply.send({
        success: true,
        message: oculto ? 'Conductor ocultado exitosamente' : 'Conductor visible nuevamente',
        data: conductor
      })
    } catch (error: any) {
      console.error('Error en cambiarEstadoOculto:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error al cambiar estado de visibilidad',
        error: error.message
      })
    }
  },

  // GET /conductores/papelera
  async obtenerPapelera(
    request: FastifyRequest<{ Querystring: ObtenerTodosQuery }>,
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
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden ver la papelera.'
        })
      }

      const { page, limit, search } = request.query

      const result = await ConductoresService.obtenerPapelera({
        page: page ? parseInt(page) : undefined,
        limit: limit ? parseInt(limit) : undefined,
        search
      })

      return reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: 'Error al obtener papelera',
        error: error.message
      })
    }
  },

  // PATCH /conductores/:id/restaurar
  async restaurar(
    request: FastifyRequest<{ Params: ConductorParams }>,
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
          message: 'No autorizado. Solo administradores o personal de Operaciones/Talento Humano pueden restaurar conductores.'
        })
      }

      const { id } = request.params
      const actualizado_por_id = user.id

      const conductor = await ConductoresService.restaurar(id, actualizado_por_id)

      return reply.send({
        success: true,
        message: 'Conductor restaurado exitosamente',
        data: conductor
      })
    } catch (error: any) {
      return reply.status(500).send({
        success: false,
        message: 'Error al restaurar conductor',
        error: error.message
      })
    }
  },

  // DELETE /conductores/:id/permanente
  async eliminarPermanente(
    request: FastifyRequest<{ Params: ConductorParams; Body: { forzar?: boolean } }>,
    reply: FastifyReply
  ) {
    try {
      const user = (request as any).user
      if (!user || user.role !== 'admin') {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado. Solo administradores pueden eliminar permanentemente.'
        })
      }

      const { id } = request.params
      const { forzar } = (request.body as any) || {}

      const resultado = await ConductoresService.eliminarPermanente(id, !!forzar)

      return reply.send({
        success: true,
        message: 'Conductor eliminado permanentemente',
        data: resultado
      })
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: error.message || 'Error al eliminar permanentemente',
        bloqueantes: error.bloqueantes
      })
    }
  },

  // GET /conductores/:id/relaciones - Preview de relaciones para borrado permanente
  async obtenerRelaciones(
    request: FastifyRequest<{ Params: ConductorParams }>,
    reply: FastifyReply
  ) {
    try {
      const user = (request as any).user
      if (!user || user.role !== 'admin') {
        return reply.status(403).send({
          success: false,
          message: 'No autorizado.'
        })
      }

      const { id } = request.params
      const data = await ConductoresService.obtenerRelaciones(id)

      return reply.send({
        success: true,
        data
      })
    } catch (error: any) {
      const status = error.statusCode || 500
      return reply.status(status).send({
        success: false,
        message: error.message || 'Error al obtener relaciones'
      })
    }
  },

  // POST /conductores/masivo
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
      const actualizado_por_id = user.id

      if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return reply.status(400).send({
          success: false,
          message: 'Se requiere una lista de IDs válida'
        })
      }

      let result
      let message = ''

      try {
        switch (accion) {
          case 'ocultar':
            result = await ConductoresService.cambiarOcultoMasivo(ids, true, actualizado_por_id)
            message = `${result?.count || 0} conductores ocultados`
            break
          case 'mostrar':
            result = await ConductoresService.cambiarOcultoMasivo(ids, false, actualizado_por_id)
            message = `${result?.count || 0} conductores visibles nuevamente`
            break
          case 'eliminar':
            result = await ConductoresService.eliminarMasivo(ids, actualizado_por_id)
            message = `${result?.count || 0} conductores movidos a la papelera`
            break
          case 'restaurar':
            result = await ConductoresService.restaurarMasivo(ids, actualizado_por_id)
            message = `${result?.count || 0} conductores restaurados`
            break
          default:
            return reply.status(400).send({
              success: false,
              message: 'Acción no válida'
            })
        }
      } catch (dbError: any) {
        console.error('Error en DB durante operación masiva:', dbError)
        throw dbError // Re-lanzar para que lo capture el catch principal
      }

      // Emitir evento masivo de forma segura
      try {
        const io = getIo()
        if (io) {
          io.emit('conductores:actualizacion-masiva', { accion, count: result?.count || 0 })
        }
      } catch (socketError) {
        console.warn('No se pudo emitir evento socket en operacion masiva:', (socketError as any).message)
      }

      return reply.send({
        success: true,
        message,
        data: result
      })
    } catch (error: any) {
      console.error('Error general en operación masiva:', error)
      return reply.status(500).send({
        success: false,
        message: 'Error en operación masiva',
        error: error.message
      })
    }
  }
}
