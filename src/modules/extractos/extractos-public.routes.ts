/**
 * Validación pública de un extracto: a donde lleva el QR impreso. Sin sesión.
 * Devuelve lo impreso (cédulas enmascaradas) y si la firma cuadra.
 */
import { FastifyInstance, FastifyRequest } from 'fastify'
import { ExtractosError, verificarPublico } from './extractos.service'
import { crearLimitador, MINUTO, preHandlerLimite } from '../../utils/limitador'

/// Los códigos son aleatorios y no se pueden adivinar, pero sin tope cualquiera
/// podía martillar la base. 120 por minuto sobra para un agente en la vía.
const limiteValidacion = { porIp: crearLimitador({ max: 120, ventanaMs: MINUTO }) }

export async function extractosPublicRoutes(app: FastifyInstance) {
  app.get('/public/extractos/:codigo', { preHandler: preHandlerLimite(limiteValidacion) }, async (request: FastifyRequest<{ Params: { codigo: string } }>, reply) => {
    try {
      return reply.send({ success: true, data: await verificarPublico(request.params.codigo) })
    } catch (err) {
      if (err instanceof ExtractosError) return reply.status(err.status).send({ success: false, message: err.message, code: err.code })
      request.log.error({ err }, '[extractos] validación pública')
      return reply.status(500).send({ success: false, message: 'No se pudo validar el extracto' })
    }
  })
}
