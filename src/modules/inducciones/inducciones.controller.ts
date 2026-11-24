import type { FastifyRequest, FastifyReply } from 'fastify'
import { InduccionesService } from './inducciones.service'
import {
  createInduccionVisitanteSchema,
  updateInduccionVisitanteSchema,
  filtrosInduccionSchema
} from './inducciones.schema'
import { getIo } from '../../sockets'
import { generarExcelInduccion } from './inducciones-excel'
import { pdfFromHtml } from '../../services/pdf.service'
import { renderInduccionPdf } from './inducciones-pdf.template'

export class InduccionesController {
  /**
   * Crear un nuevo registro de inducción/reinducción de visitante
   * POST /api/inducciones
   */
  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = createInduccionVisitanteSchema.parse(request.body)
      // Ruta pública — el userId viene del JWT si existe, si no se usa null
      const userId = (request as any).user?.sub ?? null

      const induccion = await InduccionesService.crear(body, userId)

      try {
        const io = getIo()
        io.emit('inducciones:created', { induccion, timestamp: new Date().toISOString() })
      } catch {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(201).send({
        success: true,
        message: 'Inducción registrada exitosamente',
        data: induccion
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al registrar la inducción'
      })
    }
  }

  /**
   * Obtener todas las inducciones con filtros y paginación
   * GET /api/inducciones
   */
  static async obtenerTodos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const filtros = filtrosInduccionSchema.parse(request.query)
      const resultado = await InduccionesService.obtenerTodos(filtros)

      return reply.status(200).send({ success: true, ...resultado })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener las inducciones'
      })
    }
  }

  /**
   * Obtener una inducción por ID
   * GET /api/inducciones/:id
   */
  static async obtenerPorId(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const induccion = await InduccionesService.obtenerPorId(id)

      if (!induccion) {
        return reply.status(404).send({ success: false, message: 'Inducción no encontrada' })
      }

      return reply.status(200).send({ success: true, data: induccion })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener la inducción'
      })
    }
  }

  /**
   * Actualizar una inducción
   * PATCH /api/inducciones/:id
   */
  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const body = updateInduccionVisitanteSchema.parse(request.body)
      const induccion = await InduccionesService.actualizar(id, body)

      try {
        const io = getIo()
        io.emit('inducciones:updated', { induccion, timestamp: new Date().toISOString() })
      } catch {
        request.log.warn('Socket.io not available for event emission')
      }

      return reply.status(200).send({
        success: true,
        message: 'Inducción actualizada exitosamente',
        data: induccion
      })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al actualizar la inducción'
      })
    }
  }

  /**
   * Eliminar una inducción
   * DELETE /api/inducciones/:id
   */
  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      await InduccionesService.eliminar(id)

      return reply.status(200).send({ success: true, message: 'Inducción eliminada exitosamente' })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al eliminar la inducción'
      })
    }
  }

  /**
   * Obtener estadísticas
   * GET /api/inducciones/estadisticas
   */
  static async obtenerEstadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const estadisticas = await InduccionesService.obtenerEstadisticas()
      return reply.status(200).send({ success: true, data: estadisticas })
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al obtener estadísticas'
      })
    }
  }

  /**
   * Exportar a Excel
   * GET /api/inducciones/:id/exportar/excel
   */
  static async exportarExcel(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = await InduccionesService.exportarDatos(id)

      const buffer = await generarExcelInduccion(data, 'COTRANSMEQ S.A.S.')
      const fileName = `induccion_${data.visitante.nombre.replace(/[^a-zA-Z0-9]/g, '_')}_${data.fecha_documento.replace(/\//g, '-')}.xlsx`

      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      reply.header('Content-Disposition', `attachment; filename="${fileName}"`)

      return reply.send(buffer)
    } catch (error: any) {
      request.log.error(error)
      return reply.status(500).send({
        success: false,
        message: error.message || 'Error al exportar Excel'
      })
    }
  }

  /** Descarga el HSEQ-FR-66 como PDF imprimible, usando Chromium como los cierres. */
  static async exportarPDF(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as { id: string }
      const data = await InduccionesService.exportarDatos(id)
      const html = renderInduccionPdf(data, 'COTRANSMEQ S.A.S.', 'logo_cotransmeq-264.webp')
      const pdf = await pdfFromHtml({
        html, format: 'Letter', marginMm: 0, preferCSSPageSize: true,
        footerTemplate: '<div style="width:100%;margin:0 11mm;font:7px Arial,sans-serif;color:#425166;display:flex;justify-content:space-between"><span>COTRANSMEQ S.A.S. · Inducción de visitantes</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>'
      })
      const nombre = data.visitante.nombre.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60) || id
      const fileName = `induccion_${nombre}_${id}.pdf`
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `attachment; filename="${fileName}"`)
        .header('Content-Length', String(pdf.length))
        .header('Cache-Control', 'private, no-store')
        .send(pdf)
    } catch (error: any) {
      request.log.error({ err: error }, 'Error al exportar PDF de inducción')
      return reply.status(error?.message === 'Inducción no encontrada' ? 404 : 500).send({
        success: false,
        message: error?.message || 'Error al exportar PDF'
      })
    }
  }
}