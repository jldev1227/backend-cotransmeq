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
  ///
  /// El resto se quedó abierto hasta oct-2026: sin token se listaban todos
  /// los usuarios con correo y teléfono, se cambiaban permisos (escalada a
  /// admin en una petición) y se reemplazaban firmas. Leer pide sesión;
  /// cambiar permisos, estado o firma, además, ser admin, igual que el PUT.
  app.post('/usuarios', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.create)
  app.get('/usuarios', { preHandler: authMiddleware }, UsuariosController.list)
  app.get('/usuarios/firmantes', { preHandler: authMiddleware }, UsuariosController.firmantes)
  app.get('/usuarios/presencia', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.listConPresencia)
  app.get('/usuarios/online-ids', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.getOnlineIds)
  app.get('/usuarios/:id', { preHandler: authMiddleware }, UsuariosController.getById)
  app.put('/usuarios/:id', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.update)
  app.patch('/usuarios/:id/activo', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.toggleActivo)
  app.patch('/usuarios/:id/permisos', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.updatePermisos)
  // Permiso individual: bonos de planilla de días laborados
  app.post('/usuarios/permisos/bonos-planilla', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.setBonosPlanilla)
  app.post('/usuarios/:id/firma', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.uploadFirma)
  app.delete('/usuarios/:id/firma', { preHandler: [authMiddleware, requireAdmin] }, UsuariosController.deleteFirma)
  app.get('/conductores/basicos', { preHandler: authMiddleware }, UsuariosController.listConductoresBasicos)
}
