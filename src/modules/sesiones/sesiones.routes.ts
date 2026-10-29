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
    // El historial de uso de la app es exclusivo de Administración, incluso si
    // el usuario conserva un valor heredado en `role`.
    if (!(request as any).user?.area?.includes('administracion')) {
      return reply.status(403).send({ error: 'Solo administradores' })
    }
    return listarActividadMovil()
  })
  app.delete('/sesiones/:id', { preHandler: [requireAdmin] }, SesionesController.cerrarSesion)
  app.delete('/sesiones/usuario/:usuarioId', { preHandler: [requireAdmin] }, SesionesController.cerrarTodasUsuario)

  // Ruta del usuario autenticado
  app.get('/sesiones/mis-sesiones', SesionesController.misSesiones)
}
