import { FastifyInstance } from 'fastify'
import { FacturacionLiquidacionesController } from './facturacion-liquidaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function facturacionLiquidacionesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  // CRUD Facturas
  app.get('/facturacion-liquidaciones', FacturacionLiquidacionesController.listar)
  app.post('/facturacion-liquidaciones', FacturacionLiquidacionesController.crear)

  // Soft delete: eliminadas (antes de :id)
  app.get('/facturacion-liquidaciones/eliminadas', FacturacionLiquidacionesController.listarEliminadas)

  app.get('/facturacion-liquidaciones/:id', FacturacionLiquidacionesController.obtenerPorId)
  app.patch('/facturacion-liquidaciones/:id/anular', FacturacionLiquidacionesController.anular)
  app.delete('/facturacion-liquidaciones/:id', FacturacionLiquidacionesController.eliminar)
  app.patch('/facturacion-liquidaciones/:id/restaurar', FacturacionLiquidacionesController.restaurar)

  // Batch: info de facturas para liquidaciones
  app.post('/facturacion-liquidaciones/batch-info', FacturacionLiquidacionesController.batchFacturaInfo)
}
