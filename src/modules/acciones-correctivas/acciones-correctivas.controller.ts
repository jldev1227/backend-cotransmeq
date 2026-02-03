import { FastifyRequest, FastifyReply } from 'fastify'
import { AccionesCorrectivasService, CreateAccionCorrectivaInput, UpdateAccionCorrectivaInput, FiltrosAccionesCorrectivas } from './acciones-correctivas.service'
import { PDFGeneratorAccionesService } from './pdf-generator-acciones.service'

const service = new AccionesCorrectivasService()

export class AccionesCorrectivasController {
  // POST /api/acciones-correctivas - Crear nueva acción
  static async crear(request: FastifyRequest<{ Body: CreateAccionCorrectivaInput }>, reply: FastifyReply) {
    try {
      // Obtener usuario autenticado
      const userId = (request as any).user?.id

      const accion = await service.crear({
        ...request.body,
        creado_por_id: userId
      })

      return reply.code(201).send({
        success: true,
        message: 'Acción correctiva/preventiva creada exitosamente',
        data: accion
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al crear la acción'
      })
    }
  }

  // GET /api/acciones-correctivas - Listar acciones con filtros
  static async listar(request: FastifyRequest<{ Querystring: FiltrosAccionesCorrectivas }>, reply: FastifyReply) {
    try {
      const resultado = await service.listar(request.query)

      return reply.code(200).send({
        success: true,
        data: resultado
      })
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al listar acciones'
      })
    }
  }

  // GET /api/acciones-correctivas/:id - Obtener acción por ID
  static async obtenerPorId(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const accion = await service.obtenerPorId(request.params.id)

      return reply.code(200).send({
        success: true,
        data: accion
      })
    } catch (error: any) {
      return reply.code(404).send({
        success: false,
        message: error.message || 'Acción no encontrada'
      })
    }
  }

  // GET /api/acciones-correctivas/numero/:accion_numero - Obtener por número
  static async obtenerPorNumero(request: FastifyRequest<{ Params: { accion_numero: string } }>, reply: FastifyReply) {
    try {
      const accion = await service.obtenerPorNumero(request.params.accion_numero)

      return reply.code(200).send({
        success: true,
        data: accion
      })
    } catch (error: any) {
      return reply.code(404).send({
        success: false,
        message: error.message || 'Acción no encontrada'
      })
    }
  }

  // PUT /api/acciones-correctivas/:id - Actualizar acción
  static async actualizar(
    request: FastifyRequest<{ Params: { id: string }; Body: UpdateAccionCorrectivaInput }>,
    reply: FastifyReply
  ) {
    try {
      const accion = await service.actualizar(request.params.id, request.body)

      return reply.code(200).send({
        success: true,
        message: 'Acción actualizada exitosamente',
        data: accion
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al actualizar la acción'
      })
    }
  }

  // DELETE /api/acciones-correctivas/:id - Eliminar acción
  static async eliminar(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      await service.eliminar(request.params.id)

      return reply.code(200).send({
        success: true,
        message: 'Acción eliminada exitosamente'
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al eliminar la acción'
      })
    }
  }

  // GET /api/acciones-correctivas/estadisticas - Obtener estadísticas
  static async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const estadisticas = await service.obtenerEstadisticas()

      return reply.code(200).send({
        success: true,
        data: estadisticas
      })
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al obtener estadísticas'
      })
    }
  }

  // GET /api/acciones-correctivas/:id/exportar-pdf - Exportar PDF individual
  static async exportarPDF(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const accion = await service.obtenerPorId(request.params.id)

      if (!accion) {
        return reply.code(404).send({
          success: false,
          message: 'Acción no encontrada'
        })
      }

      // Generar PDF - hacer cast para evitar error de tipo con boolean vs string
      const pdfBuffer = await PDFGeneratorAccionesService.generarPDFAccion(accion as any)

      reply.header('Content-Type', 'application/pdf')
      reply.header('Content-Disposition', `attachment; filename="accion-${accion.accion_numero}.pdf"`)

      return reply.send(pdfBuffer)
    } catch (error: any) {
      console.error('Error generando PDF:', error)
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al generar PDF',
        error: error.stack
      })
    }
  }
}
