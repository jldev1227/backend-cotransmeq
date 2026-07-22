import { FastifyReply, FastifyRequest } from 'fastify'
import { ExtractosService } from './extractos.service'

interface ExtractosQuery {
  page?: string
  limit?: string
  search?: string
  contratante?: string
  placa?: string
  conductor?: string
  desde?: string
  hasta?: string
}

export const ExtractosController = {
  async getAll(request: FastifyRequest, reply: FastifyReply) {
    try {
      const query = request.query as ExtractosQuery

      const result = await ExtractosService.getAll({
        page: query.page ? parseInt(query.page) : 1,
        limit: query.limit ? parseInt(query.limit) : 50,
        search: query.search,
        contratante: query.contratante,
        placa: query.placa,
        conductor: query.conductor,
        desde: query.desde,
        hasta: query.hasta,
      })

      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error obteniendo extractos:', error)
      reply.status(500).send({
        success: false,
        message: 'Error obteniendo extractos históricos',
        error: error.message
      })
    }
  },

  async getMatches(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await ExtractosService.getMatches()

      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error obteniendo matches:', error)
      reply.status(500).send({
        success: false,
        message: 'Error obteniendo matches de extractos',
        error: error.message
      })
    }
  },

  async getContratantes(request: FastifyRequest, reply: FastifyReply) {
    try {
      const contratantes = await ExtractosService.getContratantes()

      reply.send({
        success: true,
        data: contratantes
      })
    } catch (error: any) {
      console.error('Error obteniendo contratantes:', error)
      reply.status(500).send({
        success: false,
        message: 'Error obteniendo contratantes',
        error: error.message
      })
    }
  },

  async syncToDatabase(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await ExtractosService.syncToDatabase()

      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error sincronizando extractos con BD:', error)
      reply.status(500).send({
        success: false,
        message: 'Error sincronizando extractos con base de datos',
        error: error.message
      })
    }
  },

  async getNextConsecutivo(request: FastifyRequest, reply: FastifyReply) {
    try {
      const consecutivo = ExtractosService.getNextConsecutivo()
      reply.send({
        success: true,
        consecutivo
      })
    } catch (error: any) {
      console.error('Error obteniendo siguiente consecutivo:', error)
      reply.status(500).send({
        success: false,
        message: 'Error obteniendo siguiente consecutivo',
        error: error.message
      })
    }
  },

  async createExtracto(request: FastifyRequest, reply: FastifyReply) {
    try {
      const body = request.body as any
      const result = await ExtractosService.createExtracto(body)
      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error creando extracto:', error)
      reply.status(500).send({
        success: false,
        message: 'Error creando extracto',
        error: error.message
      })
    }
  },

  async deleteAllExtractos(request: FastifyRequest, reply: FastifyReply) {
    try {
      const result = await ExtractosService.deleteAllExtractos()
      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error eliminando todos los extractos:', error)
      reply.status(500).send({
        success: false,
        message: 'Error eliminando extractos',
        error: error.message
      })
    }
  },

  async deleteExtracto(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { consecutivo } = request.params as { consecutivo: string }
      const result = await ExtractosService.deleteExtracto(consecutivo)
      reply.send({
        success: true,
        ...result
      })
    } catch (error: any) {
      console.error('Error eliminando extracto:', error)
      reply.status(500).send({
        success: false,
        message: 'Error eliminando extracto',
        error: error.message
      })
    }
  }
}
