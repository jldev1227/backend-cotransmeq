import { FastifyInstance } from 'fastify'
import { UsuariosController } from './usuarios.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requireAdmin } from '../../middlewares/permissions.middleware'

export async function usuariosRoutes(app: FastifyInstance) {
  /// Alta manual y edición van protegidas: son las dos puertas por las que se
  /// concede `area` y `permisos_rutas`. Dejarlas abiertas hacía que cualquiera
  /// pudiera darse a sí mismo el área de administración, y volvería inútil la
  /// lista blanca que aplican los guards. El único cliente es la página
  /// `/dashboard/usuarios`, que ya manda el token.
  app.post('/usuarios', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.create)
  app.get('/usuarios', UsuariosController.list)
  app.get('/usuarios/firmantes', UsuariosController.firmantes)
  app.get('/usuarios/presencia', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.listConPresencia)
  app.get('/usuarios/online-ids', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.getOnlineIds)
  app.get('/usuarios/:id', UsuariosController.getById)
  app.put('/usuarios/:id', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.update)
  app.patch('/usuarios/:id/activo', UsuariosController.toggleActivo)
  app.patch('/usuarios/:id/permisos', UsuariosController.updatePermisos)
  // Permiso individual: bonos de planilla de días laborados
  app.post('/usuarios/permisos/bonos-planilla', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.setBonosPlanilla)
  app.post('/usuarios/:id/firma', UsuariosController.uploadFirma)
  app.delete('/usuarios/:id/firma', UsuariosController.deleteFirma)
  app.get('/conductores/basicos', UsuariosController.listConductoresBasicos)
}
