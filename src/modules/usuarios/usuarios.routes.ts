import { FastifyInstance } from 'fastify'
import { UsuariosController } from './usuarios.controller'

export async function usuariosRoutes(app: FastifyInstance) {
  app.post('/usuarios', UsuariosController.create)
  app.get('/usuarios', UsuariosController.list)
  app.get('/conductores/basicos', UsuariosController.listConductoresBasicos)
}
