import { FastifyError, FastifyReply, FastifyRequest } from 'fastify'

export function errorHandler(error: FastifyError, request: FastifyRequest, reply: FastifyReply) {
  request.log.error(error)
  const status = (error as any).statusCode || 500
  reply.status(status).send({ error: error.message || 'Internal error' })
}
