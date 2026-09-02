import { FastifyInstance } from 'fastify'
import { LiquidacionesServiciosController } from './liquidaciones-servicios.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function liquidacionesServiciosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  // ── Tarifas (operadoras) ──
  app.get('/liquidaciones-servicios/tarifas', LiquidacionesServiciosController.obtenerTarifas)
  app.post('/liquidaciones-servicios/tarifas', LiquidacionesServiciosController.crearTarifa)
  app.put('/liquidaciones-servicios/tarifas/:id', LiquidacionesServiciosController.actualizarTarifa)
  app.delete('/liquidaciones-servicios/tarifas/:id', LiquidacionesServiciosController.eliminarTarifa)

  // ── Borrador previo ──
  //
  // TODAS antes de `/:id`. Fastify resuelve por orden de declaración, así que
  // `/liquidaciones-servicios/draft` casaría con `/:id` y el `id` sería la
  // cadena "draft". Es el mismo cuidado que ya tuvieron con `/eliminadas`.
  app.post('/liquidaciones-servicios/draft', LiquidacionesServiciosController.guardarDraft)
  app.get('/liquidaciones-servicios/draft', LiquidacionesServiciosController.obtenerDraft)
  app.delete('/liquidaciones-servicios/draft', LiquidacionesServiciosController.eliminarDraft)
  app.get('/liquidaciones-servicios/:id/draft', LiquidacionesServiciosController.obtenerDraft)
  app.delete('/liquidaciones-servicios/:id/draft', LiquidacionesServiciosController.eliminarDraft)

  // ── Autoguardado de borradores ──
  //
  // Antes de `/:id` (más abajo) por el mismo motivo que `/eliminadas`: Fastify
  // resuelve por orden de declaración y `autoguardado` casaría con `:id`.
  app.post('/liquidaciones-servicios/autoguardado', LiquidacionesServiciosController.autoguardar)

  // ── Check consecutivo único ──
  app.get('/liquidaciones-servicios/check-consecutivo/:consecutivo', LiquidacionesServiciosController.checkConsecutivo)

  // ── Preview ──
  app.get('/liquidaciones-servicios/preview', LiquidacionesServiciosController.previewLiquidacion)

  // ── Servicios disponibles para liquidar ──
  app.get('/liquidaciones-servicios/servicios-disponibles', LiquidacionesServiciosController.serviciosDisponibles)

  // ── Tipos de recargo ──
  app.get('/liquidaciones-servicios/tipos-recargo', LiquidacionesServiciosController.obtenerTiposRecargo)

  // ── Configuración Liquidador de Servicios ──
  app.get('/liquidaciones-servicios/config-liquidador', LiquidacionesServiciosController.obtenerConfigLiquidador)
  app.put('/liquidaciones-servicios/config-liquidador', LiquidacionesServiciosController.actualizarConfigLiquidador)

  // ── Estadísticas ──
  app.get('/liquidaciones-servicios/estadisticas', LiquidacionesServiciosController.estadisticas)

  // ── CRUD Liquidaciones ──
  app.get('/liquidaciones-servicios', LiquidacionesServiciosController.listar)
  app.post('/liquidaciones-servicios', LiquidacionesServiciosController.crear)

  // ── Soft delete: eliminadas (antes de :id) ──
  app.get('/liquidaciones-servicios/eliminadas', LiquidacionesServiciosController.listarEliminadas)

  app.get('/liquidaciones-servicios/:id', LiquidacionesServiciosController.obtenerPorId)
  app.put('/liquidaciones-servicios/:id', LiquidacionesServiciosController.actualizar)
  app.delete('/liquidaciones-servicios/:id', LiquidacionesServiciosController.eliminar)
  app.patch('/liquidaciones-servicios/:id/estado', LiquidacionesServiciosController.cambiarEstado)
  app.get('/liquidaciones-servicios/:id/historial', LiquidacionesServiciosController.obtenerHistorial)
  app.get('/liquidaciones-servicios/:id/csv', LiquidacionesServiciosController.obtenerCSV)
  app.patch('/liquidaciones-servicios/:id/restaurar', LiquidacionesServiciosController.restaurar)
}
