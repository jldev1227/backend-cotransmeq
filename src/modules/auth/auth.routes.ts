import { FastifyInstance } from 'fastify'
import { AuthController } from './auth.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { RecuperacionController } from './recuperacion.controller'
import { crearLimitador, MINUTO, preHandlerLimite } from '../../utils/limitador'

/// La recuperación se valida con un token de un solo uso, pero sin tope se
/// podía martillar el endpoint probando tokens o correos.
const limiteRecuperacion = { porIp: crearLimitador({ max: 20, ventanaMs: 15 * MINUTO }) }

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

  // Recuperación de contraseña: sin `authMiddleware` a propósito —quien la usa
  // no tiene sesión—. El control de acceso es la cabecera `x-recovery-token`,
  // que el propio controlador verifica antes de tocar nada.
  app.post('/auth/recuperacion/lookup', { preHandler: preHandlerLimite(limiteRecuperacion) }, RecuperacionController.lookup)
  app.post('/auth/recuperacion/aplicar', { preHandler: preHandlerLimite(limiteRecuperacion) }, RecuperacionController.aplicar)
}
