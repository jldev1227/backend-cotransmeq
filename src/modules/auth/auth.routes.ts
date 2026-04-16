import { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/login', AuthController.login)
  app.post('/auth/logout', { preHandler: [authMiddleware] }, AuthController.logout)
  app.get('/auth/profile', { preHandler: [authMiddleware] }, AuthController.profile)
  app.put('/auth/change-password', { preHandler: [authMiddleware] }, AuthController.changePassword)
  app.put('/auth/update-profile', { preHandler: [authMiddleware] }, AuthController.updateMyProfile)
  app.get('/auth/my-session', { preHandler: [authMiddleware] }, AuthController.mySession)
  app.get('/auth/my-firma', { preHandler: [authMiddleware] }, AuthController.getMyFirma)
  app.post('/auth/my-firma', { preHandler: [authMiddleware] }, AuthController.uploadMyFirma)
  app.delete('/auth/my-firma', { preHandler: [authMiddleware] }, AuthController.deleteMyFirma)
}
