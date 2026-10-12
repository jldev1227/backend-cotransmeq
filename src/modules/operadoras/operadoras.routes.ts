import { FastifyInstance } from 'fastify'
import { OperadorasController } from './operadoras.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { permisoPorMetodo } from '../../middlewares/permissions.middleware'

export async function operadorasRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Las operadoras (PAREX, GEOPARK…) las LEE cualquiera del equipo: el editor de
  /// liquidaciones las carga. Crearlas o cambiarlas pide `liquidaciones-servicios` full.
  app.addHook('preHandler', permisoPorMetodo('liquidaciones-servicios', {}, { excepto: (_patron, metodo) => metodo === 'GET' }))

  app.get('/operadoras', OperadorasController.listar)
  app.post('/operadoras', OperadorasController.crear)
  app.put('/operadoras/:id', OperadorasController.actualizar)
  /// No siempre borra: si la operadora tiene liquidaciones, la desactiva y lo
  /// dice en la respuesta. Ver `OperadorasService.eliminar`.
  app.delete('/operadoras/:id', OperadorasController.eliminar)
}
