import { FastifyReply, FastifyRequest } from 'fastify'
import { AuthService } from './auth.service'
import { loginSchema } from './auth.schema'

export const AuthController = {
  async login(request: FastifyRequest, reply: FastifyReply) {
    const data = loginSchema.parse(request.body)
    const result = await AuthService.login(data.correo, data.password)
    if (!result) return reply.status(401).send({ error: 'Invalid credentials' })
    reply.send(result)
  }
}
