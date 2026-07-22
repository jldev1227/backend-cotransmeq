import { FastifyInstance } from 'fastify'
import { InvitacionesController } from './invitaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireAdmin } from '../../middlewares/permissions.middleware'

export async function invitacionesRoutes(app: FastifyInstance) {
  // Rutas protegidas — solo administracion
  app.post('/invitaciones', { preHandler: [authMiddleware, requireAdmin] }, InvitacionesController.crear)
  app.get('/invitaciones', { preHandler: [authMiddleware, requireAdmin] }, InvitacionesController.listar)
  app.delete('/invitaciones/:id', { preHandler: [authMiddleware, requireAdmin] }, InvitacionesController.revocar)

  // Rutas públicas — no requieren auth (token de invitación como prueba de identidad)
  app.get('/invitaciones/validar/:token', InvitacionesController.validarToken)
  app.post('/invitaciones/aceptar', InvitacionesController.aceptar)
}
