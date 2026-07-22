import { FastifyInstance } from 'fastify'
import { NotificacionesController } from './notificaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function notificacionesRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('onRequest', authMiddleware)

  // GET /notificaciones
  app.get('/notificaciones', NotificacionesController.listar)

  // GET /notificaciones/no-leidas
  app.get('/notificaciones/no-leidas', NotificacionesController.contarNoLeidas)

  // PATCH /notificaciones/marcar-todas
  app.patch('/notificaciones/marcar-todas', NotificacionesController.marcarTodasLeidas)

  // PATCH /notificaciones/:id/leida
  app.patch('/notificaciones/:id/leida', NotificacionesController.marcarLeida)
}
