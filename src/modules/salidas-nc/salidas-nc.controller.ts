import { FastifyRequest, FastifyReply } from 'fastify'
import {
  SalidasNCService,
  CreateSalidaNCInput,
  UpdateSalidaNCInput,
  FiltrosSalidasNC
} from './salidas-nc.service'
import { PDFGeneratorSNCService } from './pdf-generator-snc.service'

const service = new SalidasNCService()

export class SalidasNCController {
  // POST /api/salidas-nc
  static async crear(request: FastifyRequest<{ Body: CreateSalidaNCInput }>, reply: FastifyReply) {
    try {
      const userId = (request as any).user?.id
      const salida = await service.crear({
        ...request.body,
        creado_por_id: userId
      })

      return reply.code(201).send({
        success: true,
        message: 'Salida no conforme registrada exitosamente',
        data: salida
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al crear la salida no conforme'
      })
    }
  }

  // GET /api/salidas-nc
  static async listar(request: FastifyRequest<{ Querystring: FiltrosSalidasNC }>, reply: FastifyReply) {
    try {
      const resultado = await service.listar(request.query)
      return reply.code(200).send({
        success: true,
        data: resultado
      })
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al listar salidas no conformes'
      })
    }
  }

  // GET /api/salidas-nc/estadisticas
  static async estadisticas(request: FastifyRequest, reply: FastifyReply) {
    try {
      const stats = await service.estadisticas()
      return reply.code(200).send({
        success: true,
        data: stats
      })
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al obtener estadísticas'
      })
    }
  }

  // GET /api/salidas-nc/siguiente-numero
  static async siguienteNumero(request: FastifyRequest, reply: FastifyReply) {
    try {
      const numero = await service.siguienteNumero()
      return reply.code(200).send({
        success: true,
        data: { numero }
      })
    } catch (error: any) {
      return reply.code(500).send({
        success: false,
        message: error.message || 'Error al obtener siguiente número'
      })
    }
  }

  // GET /api/salidas-nc/:id
  static async obtenerPorId(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const salida = await service.obtenerPorId(request.params.id)
      return reply.code(200).send({
        success: true,
        data: salida
      })
    } catch (error: any) {
      return reply.code(404).send({
        success: false,
        message: error.message || 'Salida no conforme no encontrada'
      })
    }
  }

  // PUT /api/salidas-nc/:id
  static async actualizar(request: FastifyRequest<{ Params: { id: string }; Body: UpdateSalidaNCInput }>, reply: FastifyReply) {
    try {
      const salida = await service.actualizar(request.params.id, request.body)
      return reply.code(200).send({
        success: true,
        message: 'Salida no conforme actualizada exitosamente',
        data: salida
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al actualizar la salida no conforme'
      })
    }
  }

  // DELETE /api/salidas-nc/:id
  static async eliminar(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const result = await service.eliminar(request.params.id)
      return reply.code(200).send({
        success: true,
        message: result.message
      })
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al eliminar la salida no conforme'
      })
    }
  }

  // GET /api/salidas-nc/:id/pdf
  static async generarPDF(request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
    try {
      const salida = await service.obtenerPorId(request.params.id)
      const pdfBuffer = await PDFGeneratorSNCService.generarPDF(salida as any)
      const sncNum = String(salida.numero_snc).padStart(4, '0')

      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="SNC-${sncNum}.pdf"`)
        .send(pdfBuffer)
    } catch (error: any) {
      return reply.code(400).send({
        success: false,
        message: error.message || 'Error al generar PDF'
      })
    }
  }
}
