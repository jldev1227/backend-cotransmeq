import type { FastifyRequest, FastifyReply } from 'fastify'
import { AsistenciasService } from './asistencias.service'
import {
  createFormularioAsistenciaSchema,
  updateFormularioAsistenciaSchema,
  createRespuestaAsistenciaSchema
} from './asistencias.schema'
import { getIo } from '../../sockets'
import * as XLSX from 'xlsx'
import { PDFGeneratorService } from './pdf-generator.service'

export class AsistenciasController {
  /**
   * Crear un nuevo formulario de asistencia
   */
  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = createFormularioAsistenciaSchema.parse(request.body)
      const userId = (request as any).user?.sub

      if (!userId) {
        return reply.status(401).send({
          success: false,
          message: 'Usuario no autenticado'
        })
      }

      const formulario = await AsistenciasService.crear(body, userId)

      // Emitir evento socket para notificar nuevo formulario
      try {
        const io = getIo()
        io.emit('asistencias:formulario:created', {
          formulario,
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        // Si socket.io no está disponible, solo logueamos pero no fallamos la request
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(201).send({
        success: true,
        message: 'Formulario de asistencia creado exitosamente',
        data: formulario
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al crear el formulario de asistencia'
      })
    }
  }

  /**
   * Obtener todos los formularios
   */
  static async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const formularios = await AsistenciasService.obtenerTodos()

      return reply.status(200).send({
        success: true,
        data: formularios
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener los formularios'
      })
    }
  }

  /**
   * Obtener un formulario por ID
   */
  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const formulario = await AsistenciasService.obtenerPorId(id)

      if (!formulario) {
        return reply.status(404).send({
          success: false,
          message: 'Formulario no encontrado'
        })
      }

      return reply.status(200).send({
        success: true,
        data: formulario
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener el formulario'
      })
    }
  }

  /**
   * Obtener un formulario por token (público)
   */
  static async obtenerPorToken(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { token } = request.params as { token: string }

      const formulario = await AsistenciasService.obtenerPorToken(token)

      if (!formulario) {
        return reply.status(404).send({
          success: false,
          message: 'Formulario no encontrado'
        })
      }

      if (!formulario.activo) {
        return reply.status(403).send({
          success: false,
          message: 'Este formulario ya no está disponible'
        })
      }

      return reply.status(200).send({
        success: true,
        data: formulario
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener el formulario'
      })
    }
  }

  /**
   * Actualizar un formulario
   */
  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const body = updateFormularioAsistenciaSchema.parse(request.body)

      const formulario = await AsistenciasService.actualizar(id, body)

      // Determinar el tipo de cambio para el evento socket
      const eventType = body.activo === false ? 'disabled' : 'updated'

      // Emitir evento socket para notificar actualización
      try {
        const io = getIo()
        io.emit(`asistencias:formulario:${eventType}`, {
          formulario,
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(200).send({
        success: true,
        message: 'Formulario actualizado exitosamente',
        data: formulario
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al actualizar el formulario'
      })
    }
  }

  /**
   * Eliminar un formulario
   */
  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      await AsistenciasService.eliminar(id)

      return reply.status(200).send({
        success: true,
        message: 'Formulario eliminado exitosamente'
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al eliminar el formulario'
      })
    }
  }

  /**
   * Crear una respuesta de asistencia (público)
   */
  static async crearRespuesta(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { token } = request.params as { token: string }
      const body = createRespuestaAsistenciaSchema.parse(request.body)

      // Obtener información del dispositivo
      const ipAddress = request.ip || request.headers['x-forwarded-for'] as string || 'unknown'
      const userAgent = request.headers['user-agent'] || 'unknown'

      // Obtener el formulario por token
      const formulario = await AsistenciasService.obtenerPorToken(token)

      if (!formulario) {
        return reply.status(404).send({
          success: false,
          message: 'Formulario no encontrado'
        })
      }

      const respuesta = await AsistenciasService.crearRespuesta(
        formulario.id,
        body,
        ipAddress,
        userAgent
      )

      // Emitir evento socket para notificar nueva respuesta
      try {
        const io = getIo()
        io.emit('asistencias:respuesta:created', {
          respuesta,
          formularioId: formulario.id,
          formularioToken: formulario.token,
          timestamp: new Date().toISOString()
        })
      } catch (error) {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(201).send({
        success: true,
        message: 'Respuesta enviada exitosamente',
        data: respuesta
      })
    } catch (error: any) {
      request.log.error(error)
      
      if (error.message.includes('Ya has enviado')) {
        return reply.status(409).send({
          success: false,
          message: error.message
        })
      }

      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al enviar la respuesta'
      })
    }
  }

  /**
   * Verificar si ya respondí (público)
   */
  static async verificarMiRespuesta(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { token } = request.params as { token: string }
      const { device_fingerprint } = request.query as { device_fingerprint: string }

      request.log.info('🔍 Verificando respuesta previa')
      request.log.info(`   Token: ${token}`)
      request.log.info(`   Device Fingerprint: ${device_fingerprint}`)

      if (!device_fingerprint) {
        request.log.warn('⚠️ Device fingerprint no proporcionado')
        return reply.status(400).send({
          success: false,
          message: 'Device fingerprint es requerido'
        })
      }

      // Obtener el formulario por token
      const formulario = await AsistenciasService.obtenerPorToken(token)
      request.log.info(`📄 Formulario encontrado: ${formulario?.id || 'NO'}`)

      if (!formulario) {
        return reply.status(404).send({
          success: false,
          message: 'Formulario no encontrado'
        })
      }

      request.log.info(`🔎 Buscando respuesta para formularioId: ${formulario.id}`)
      const miRespuesta = await AsistenciasService.obtenerMiRespuesta(
        formulario.id,
        device_fingerprint
      )

      request.log.info(`📊 Respuesta encontrada: ${miRespuesta ? 'SÍ' : 'NO'}`)
      if (miRespuesta) {
        request.log.info(`   ID: ${miRespuesta.id}`)
        request.log.info(`   Nombre: ${miRespuesta.nombre_completo}`)
        request.log.info(`   Fingerprint en DB: ${miRespuesta.device_fingerprint}`)
      }

      const yaRespondio = !!miRespuesta
      request.log.info(`✅ Enviando respuesta: yaRespondio=${yaRespondio}`)

      // Serializar la respuesta si existe
      let respuestaSerializada = null
      if (miRespuesta) {
        respuestaSerializada = {
          id: String(miRespuesta.id),
          formulario_id: String(miRespuesta.formulario_id),
          nombre_completo: String(miRespuesta.nombre_completo),
          numero_documento: String(miRespuesta.numero_documento),
          cargo: String(miRespuesta.cargo),
          numero_telefono: String(miRespuesta.numero_telefono),
          firma: String(miRespuesta.firma),
          device_fingerprint: String(miRespuesta.device_fingerprint),
          ip_address: String(miRespuesta.ip_address),
          user_agent: String(miRespuesta.user_agent),
          created_at: miRespuesta.created_at.toISOString()
        }
      }

      return reply.status(200).send({
        success: true,
        data: {
          yaRespondio,
          respuesta: respuestaSerializada
        }
      })
    } catch (error: any) {
      request.log.error(error, '❌ Error en verificarMiRespuesta')
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al verificar la respuesta'
      })
    }
  }

  /**
   * Obtener respuestas de un formulario
   */
  static async obtenerRespuestas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const respuestas = await AsistenciasService.obtenerRespuestas(id)

      return reply.status(200).send({
        success: true,
        data: respuestas
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener las respuestas'
      })
    }
  }

  /**
   * Exportar respuestas a Excel
   */
  static async exportarRespuestas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const data = await AsistenciasService.exportarRespuestas(id)

      // Crear workbook
      const workbook = XLSX.utils.book_new()

      // Hoja 1: Información del evento
      const infoEvento = [
        ['INFORMACIÓN DEL EVENTO'],
        [''],
        ['Temática', data.formulario.tematica],
        ['Objetivo', data.formulario.objetivo || 'N/A'],
        ['Fecha', new Date(data.formulario.fecha).toLocaleDateString('es-CO')],
        ['Hora Inicio', data.formulario.hora_inicio || 'N/A'],
        ['Hora Finalización', data.formulario.hora_finalizacion || 'N/A'],
        ['Duración (minutos)', data.formulario.duracion_minutos || 'N/A'],
        ['Tipo de Evento', data.formulario.tipo_evento],
        ...(data.formulario.tipo_evento === 'otro' ? [['Especificar Tipo', data.formulario.tipo_evento_otro]] : []),
        ['Lugar/Sede', data.formulario.lugar_sede || 'N/A'],
        ['Instructor/Facilitador', data.formulario.nombre_instructor || 'N/A'],
        [''],
        ['TOTAL DE ASISTENTES', data.respuestas.length]
      ]

      const wsInfo = XLSX.utils.aoa_to_sheet(infoEvento)
      XLSX.utils.book_append_sheet(workbook, wsInfo, 'Información')

      // Hoja 2: Respuestas de asistentes
      if (data.respuestas.length > 0) {
        const respuestasData = [
          ['Nº', 'Nombre Completo', 'Número Documento', 'Cargo', 'Teléfono', 'Fecha/Hora Respuesta']
        ]

        data.respuestas.forEach((r, index) => {
          respuestasData.push([
            String(index + 1),
            r.nombre_completo,
            r.numero_documento,
            r.cargo,
            r.numero_telefono,
            new Date(r.fecha_respuesta).toLocaleString('es-CO')
          ])
        })

        const wsRespuestas = XLSX.utils.aoa_to_sheet(respuestasData)
        XLSX.utils.book_append_sheet(workbook, wsRespuestas, 'Asistentes')
      }

      // Generar buffer
      const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' })

      // Enviar archivo
      const fileName = `asistencia_${data.formulario.tematica.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.xlsx`

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
      
      return reply.send(buffer)
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al exportar las respuestas'
      })
    }
  }

  /**
   * Exportar respuestas a PDF
   */
  static async exportarRespuestasPDF(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }

      const data = await AsistenciasService.exportarRespuestas(id)

      // Generar PDF
      const pdfBuffer = await PDFGeneratorService.generarPDFAsistencia(
        data.formulario,
        data.respuestas
      )

      // Enviar archivo
      const fileName = `asistencia_${data.formulario.tematica.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.pdf`

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)
      
      return reply.send(pdfBuffer)
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al exportar el PDF'
      })
    }
  }
}
