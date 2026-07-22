import { FastifyInstance } from 'fastify'
import { ActividadesPesvController } from './actividades-pesv.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function actividadesPesvRoutes(app: FastifyInstance) {
  // Todas las rutas requieren autenticación
  app.addHook('onRequest', authMiddleware)

  // Rutas que NO son :id deben ir ANTES de las rutas con parámetros
  app.get('/pesv/actividades/estadisticas', ActividadesPesvController.estadisticas)
  app.get('/pesv/actividades/siguiente-numero', ActividadesPesvController.siguienteNumero)

  // CRUD
  app.get('/pesv/actividades', ActividadesPesvController.listar)
  app.get('/pesv/actividades/:id', ActividadesPesvController.obtenerPorId)
  app.post('/pesv/actividades', ActividadesPesvController.crear)
  app.put('/pesv/actividades/:id', ActividadesPesvController.actualizar)
  app.delete('/pesv/actividades/:id', ActividadesPesvController.eliminar)
}
