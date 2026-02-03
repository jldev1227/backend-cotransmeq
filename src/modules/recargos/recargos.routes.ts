import { FastifyInstance } from 'fastify'
import { RecargosController } from './recargos.controller'

export async function recargosRoutes(fastify: FastifyInstance) {
  // Obtener tipos de recargo (debe ir primero para evitar conflicto con /:id)
  fastify.get('/recargos/tipos-recargo/activos', RecargosController.obtenerTiposRecargo)

  // Obtener estadísticas (debe ir antes de /:id)
  fastify.get('/recargos/estadisticas/resumen', RecargosController.obtenerEstadisticas)

  // Obtener recargos para canvas (con filtros)
  fastify.get('/recargos', RecargosController.obtenerParaCanvas)

  // Obtener un recargo por ID
  fastify.get('/recargos/:id', RecargosController.obtenerPorId)

  // Crear recargo
  fastify.post('/recargos', RecargosController.crear)

  // Actualizar recargo
  fastify.put('/recargos/:id', RecargosController.actualizar)

  // Eliminar recargo (soft delete)
  fastify.delete('/recargos/:id', RecargosController.eliminar)

  // Eliminar múltiples recargos (soft delete)
  fastify.post('/recargos/eliminar-multiple', RecargosController.eliminarMultiple)

  // Liquidar recargo
  fastify.post('/recargos/:id/liquidar', RecargosController.liquidar)

  // Duplicar recargo
  fastify.post('/recargos/:id/duplicar', RecargosController.duplicar)
}
