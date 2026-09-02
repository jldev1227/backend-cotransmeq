import { FastifyRequest, FastifyReply } from 'fastify'
import { OperadorasService } from './operadoras.service'

export class OperadorasController {
  static async listar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { incluir_inactivas } = request.query as any
      const operadoras = await OperadorasService.listar(incluir_inactivas === 'true')
      return reply.send(operadoras)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }

  static async crear(request: FastifyRequest, reply: FastifyReply) {
    try {
      const operadora = await OperadorasService.crear(request.body as any)
      return reply.status(201).send(operadora)
    } catch (error: any) {
      /// 409 y no 500: que la interfaz pueda decir cuál código choca en vez de
      /// un «error del servidor» que no ayuda a nadie.
      if (error.codigoDuplicado) {
        return reply.status(409).send({ error: error.message, codigo: error.codigoDuplicado })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  static async actualizar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const operadora = await OperadorasService.actualizar(id, request.body as any)
      return reply.send(operadora)
    } catch (error: any) {
      if (error.codigoDuplicado) {
        return reply.status(409).send({ error: error.message, codigo: error.codigoDuplicado })
      }
      return reply.status(500).send({ error: error.message })
    }
  }

  static async eliminar(request: FastifyRequest, reply: FastifyReply) {
    try {
      const { id } = request.params as any
      const resultado = await OperadorasService.eliminar(id)
      return reply.send(resultado)
    } catch (error: any) {
      return reply.status(500).send({ error: error.message })
    }
  }
}
