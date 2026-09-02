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

  // Items: asociar liquidaciones a una factura ya creada y quitarlas de ella.
  // Los usa el carril del canvas de historial de liquidaciones de servicios.
  app.post('/facturacion-liquidaciones/:id/items', FacturacionLiquidacionesController.agregarLiquidaciones)
  app.delete('/facturacion-liquidaciones/:id/items/:liquidacionId', FacturacionLiquidacionesController.quitarLiquidacion)

  app.patch('/facturacion-liquidaciones/:id/anular', FacturacionLiquidacionesController.anular)
  app.delete('/facturacion-liquidaciones/:id', FacturacionLiquidacionesController.eliminar)
  app.patch('/facturacion-liquidaciones/:id/restaurar', FacturacionLiquidacionesController.restaurar)

  // Batch: info de facturas para liquidaciones
  app.post('/facturacion-liquidaciones/batch-info', FacturacionLiquidacionesController.batchFacturaInfo)
}
