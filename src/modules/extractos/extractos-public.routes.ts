/**
 * Validación pública de un extracto: a donde lleva el QR impreso. Sin sesión.
 * Devuelve lo impreso (cédulas enmascaradas) y si la firma cuadra.
 */
import { FastifyInstance, FastifyRequest } from 'fastify'
import { ExtractosError, verificarPublico } from './extractos.service'

export async function extractosPublicRoutes(app: FastifyInstance) {
  app.get('/public/extractos/:codigo', async (request: FastifyRequest<{ Params: { codigo: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await verificarPublico(request.params.codigo) })
    } catch (err) {
      if (err instanceof ExtractosError) return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
      request.log.error({ err }, '[extractos] validación pública')
      return reply.status(500).send({ success: false, message: 'No se pudo validar el extracto' })
    }
  })
}
