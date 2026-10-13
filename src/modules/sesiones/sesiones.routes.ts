import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireAdmin } from '../../middlewares/permissions.middleware'
import { SesionesController } from './sesiones.controller'
import { listarActividadMovil } from './mobile-presence.service'

export async function sesionesRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('preHandler', authMiddleware)

  // Rutas de admin
  app.get('/sesiones', { preHandler: [requireAdmin] }, SesionesController.listar)
  app.get('/sesiones/activas', { preHandler: [requireAdmin] }, SesionesController.listarActivas)
  app.get('/sesiones/app-movil', { preHandler: [requireAdmin] }, async (request, reply) => {
    // El historial de uso de la app es exclusivo del rol admin, incluso si
    // otra área tiene permiso full sobre el módulo de sesiones.
    if ((request as any).user?.role !== 'admin') {
      return reply.status(403).send({ error: 'Solo administradores' })
    }
    return listarActividadMovil()
  })
  app.delete('/sesiones/:id', { preHandler: [requireAdmin] }, SesionesController.cerrarSesion)
  app.delete('/sesiones/usuario/:usuarioId', { preHandler: [requireAdmin] }, SesionesController.cerrarTodasUsuario)

  // Ruta del usuario autenticado
  app.get('/sesiones/mis-sesiones', SesionesController.misSesiones)
}
