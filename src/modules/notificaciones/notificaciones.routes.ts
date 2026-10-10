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

  // ── Web Push: avisos del sistema operativo ──────────────────────────
  // GET /notificaciones/web-push/clave — clave pública VAPID (null si está apagado)
  app.get('/notificaciones/web-push/clave', NotificacionesController.clavePush)

  // POST /notificaciones/web-push/suscripcion — registra este navegador
  app.post('/notificaciones/web-push/suscripcion', NotificacionesController.suscribirPush)

  // POST /notificaciones/web-push/desuscribir — este navegador deja de recibir
  app.post('/notificaciones/web-push/desuscribir', NotificacionesController.desuscribirPush)

  // POST /notificaciones/web-push/prueba — reenvía mi última notificación como aviso
  app.post('/notificaciones/web-push/prueba', NotificacionesController.probarPush)
}
