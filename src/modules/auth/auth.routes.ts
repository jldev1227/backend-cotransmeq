import { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', AuthController.login)
}
