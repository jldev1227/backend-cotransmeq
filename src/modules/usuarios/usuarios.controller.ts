import { FastifyReply, FastifyRequest } from 'fastify'
import { UsuariosService } from './usuarios.service'
import { createUsuarioSchema } from './usuarios.schema'

export const UsuariosController = {
  async create(request: FastifyRequest, reply: FastifyReply) {
    const data = createUsuarioSchema.parse(request.body)
    const user = await UsuariosService.create(data.nombre, data.telefono, data.correo, data.password, data.permisos, data.ultimoAcceso)
    reply.status(201).send(user)
  },
  async list(request: FastifyRequest, reply: FastifyReply) {
    const users = await UsuariosService.list()
    reply.send(users)
  },
  async listConductoresBasicos(request: FastifyRequest, reply: FastifyReply) {
    const conductores = await UsuariosService.listConductoresBasicos()
    reply.send(conductores)
  }
}
