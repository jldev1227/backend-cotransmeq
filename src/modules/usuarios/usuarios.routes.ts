import { FastifyInstance } from 'fastify'
import { UsuariosController } from './usuarios.controller'

export async function usuariosRoutes(app: FastifyInstance) {
  app.post('/usuarios', UsuariosController.create)
  app.get('/usuarios', UsuariosController.list)
  app.get('/usuarios/firmantes', UsuariosController.firmantes)
  app.get('/usuarios/:id', UsuariosController.getById)
  app.put('/usuarios/:id', UsuariosController.update)
  app.patch('/usuarios/:id/activo', UsuariosController.toggleActivo)
  app.patch('/usuarios/:id/permisos', UsuariosController.updatePermisos)
  app.post('/usuarios/:id/firma', UsuariosController.uploadFirma)
  app.delete('/usuarios/:id/firma', UsuariosController.deleteFirma)
  app.get('/conductores/basicos', UsuariosController.listConductoresBasicos)
}
