import { FastifyInstance } from 'fastify'
import { FacturacionLiquidacionesController } from './facturacion-liquidaciones.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'
import { permisoPorMetodo } from '../../middlewares/permissions.middleware'

export async function facturacionLiquidacionesRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-servicios`.
  /// Escritura con limited para el flujo de Facturación; los cambios de estado
  /// que devuelven liquidaciones a APROBADA o las marcan por duplicidad se
  /// restringen a Administración en el controlador.
  app.addHook('preHandler', permisoPorMetodo('liquidaciones-servicios', { lectura: 'limited', escritura: 'limited' }))

  // CRUD Facturas
  app.get('/facturacion-liquidaciones', FacturacionLiquidacionesController.listar)
  app.post('/facturacion-liquidaciones', FacturacionLiquidacionesController.crear)

  // Soft delete: eliminadas (antes de :id)
  app.get('/facturacion-liquidaciones/eliminadas', FacturacionLiquidacionesController.listarEliminadas)

  app.get('/facturacion-liquidaciones/:id', FacturacionLiquidacionesController.obtenerPorId)

  // Edición de la factura desde el tab Facturas.
  app.patch('/facturacion-liquidaciones/:id/editar', FacturacionLiquidacionesController.editar)

  // Items: asociar liquidaciones a una factura ya creada y quitarlas de ella.
  // Los usa el carril del canvas de historial de liquidaciones de servicios.
  app.post('/facturacion-liquidaciones/:id/items', FacturacionLiquidacionesController.agregarLiquidaciones)
  app.delete('/facturacion-liquidaciones/:id/items/:liquidacionId', FacturacionLiquidacionesController.quitarLiquidacion)

  // Condiciones de cobro (valor, emisión, plazo, vencimiento). Misma operación
  // que `PATCH /cartera/facturas/:id/condiciones`, para quien registra facturas.
  app.patch('/facturacion-liquidaciones/:id/condiciones', FacturacionLiquidacionesController.actualizarCondiciones)

  app.patch('/facturacion-liquidaciones/:id/anular', FacturacionLiquidacionesController.anular)
  app.delete('/facturacion-liquidaciones/:id', FacturacionLiquidacionesController.eliminar)
  app.patch('/facturacion-liquidaciones/:id/restaurar', FacturacionLiquidacionesController.restaurar)

  // Batch: info de facturas para liquidaciones
  app.post('/facturacion-liquidaciones/batch-info', FacturacionLiquidacionesController.batchFacturaInfo)
}
