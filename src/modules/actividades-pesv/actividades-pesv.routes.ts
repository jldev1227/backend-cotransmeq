import { FastifyInstance } from 'fastify'
import { ActividadesPesvController } from './actividades-pesv.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { requirePermission } from '../../middlewares/permissions.middleware'

/**
 * Plan anual de trabajo (paso 9).
 *
 * Exigía sesión pero NO permiso de módulo: cualquier usuario autenticado podía
 * crear, editar y borrar actividades del plan, incluido alguien sin ninguna
 * relación con el PESV. Ahora la lectura va con `read` y la escritura con
 * `full`, igual que el resto del módulo.
 */
export async function actividadesPesvRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  const puedeLeer = { preHandler: requirePermission('pesv', 'read') }
  const puedeEditar = { preHandler: requirePermission('pesv', 'full') }

  // Rutas que NO son :id deben ir ANTES de las rutas con parámetros
  app.get('/pesv/actividades/estadisticas', puedeLeer, ActividadesPesvController.estadisticas)
  app.get('/pesv/actividades/siguiente-numero', puedeLeer, ActividadesPesvController.siguienteNumero)

  // CRUD
  app.get('/pesv/actividades', puedeLeer, ActividadesPesvController.listar)
  app.get('/pesv/actividades/:id', puedeLeer, ActividadesPesvController.obtenerPorId)
  app.post('/pesv/actividades', puedeEditar, ActividadesPesvController.crear)
  app.put('/pesv/actividades/:id', puedeEditar, ActividadesPesvController.actualizar)
  app.delete('/pesv/actividades/:id', puedeEditar, ActividadesPesvController.eliminar)
}
