import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireAdmin } from '../../middlewares/permissions.middleware'
import { SesionesController } from './sesiones.controller'

export async function sesionesRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('preHandler', authMiddleware)

  // Rutas de admin
  app.get('/sesiones', { preHandler: [requireAdmin] }, SesionesController.listar)
  app.get('/sesiones/activas', { preHandler: [requireAdmin] }, SesionesController.listarActivas)
  app.delete('/sesiones/:id', { preHandler: [requireAdmin] }, SesionesController.cerrarSesion)
  app.delete('/sesiones/usuario/:usuarioId', { preHandler: [requireAdmin] }, SesionesController.cerrarTodasUsuario)

  // Ruta del usuario autenticado
  app.get('/sesiones/mis-sesiones', SesionesController.misSesiones)
}
