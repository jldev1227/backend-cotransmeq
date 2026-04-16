import { FastifyInstance } from 'fastify'
import { LiquidacionesServiciosController } from './liquidaciones-servicios.controller'
import { authMiddleware } from '../../middlewares/auth.middleware'

export async function liquidacionesServiciosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)

  // ── Tarifas ──
  app.get('/liquidaciones-servicios/tarifas', LiquidacionesServiciosController.obtenerTarifas)
  app.post('/liquidaciones-servicios/tarifas', LiquidacionesServiciosController.crearTarifa)
  app.put('/liquidaciones-servicios/tarifas/:id', LiquidacionesServiciosController.actualizarTarifa)
  app.delete('/liquidaciones-servicios/tarifas/:id', LiquidacionesServiciosController.eliminarTarifa)

  // ── Preview ──
  app.post('/liquidaciones-servicios/preview', LiquidacionesServiciosController.previewLiquidacion)

  // ── Utilidades ──
  app.get('/liquidaciones-servicios/estadisticas', LiquidacionesServiciosController.estadisticas)
  app.get('/liquidaciones-servicios/servicios-disponibles', LiquidacionesServiciosController.serviciosDisponibles)
  app.get('/liquidaciones-servicios/tipos-recargo', LiquidacionesServiciosController.tiposRecargo)

  // ── Configuración Liquidador de Servicios ──
  app.get('/liquidaciones-servicios/config-liquidador', LiquidacionesServiciosController.obtenerConfigLiquidador)
  app.put('/liquidaciones-servicios/config-liquidador', LiquidacionesServiciosController.actualizarConfigLiquidador)

  // ── CRUD ──
  app.get('/liquidaciones-servicios/check-consecutivo/:consecutivo', LiquidacionesServiciosController.checkConsecutivo)
  app.get('/liquidaciones-servicios', LiquidacionesServiciosController.listar)
  app.post('/liquidaciones-servicios', LiquidacionesServiciosController.crear)

  // ── Soft delete: restaurar y eliminadas (antes de :id) ──
  app.get('/liquidaciones-servicios/eliminadas', LiquidacionesServiciosController.listarEliminadas)

  app.get('/liquidaciones-servicios/:id', LiquidacionesServiciosController.obtenerPorId)
  app.put('/liquidaciones-servicios/:id', LiquidacionesServiciosController.actualizar)
  app.delete('/liquidaciones-servicios/:id', LiquidacionesServiciosController.eliminar)

  // ── Estado e historial ──
  app.patch('/liquidaciones-servicios/:id/estado', LiquidacionesServiciosController.cambiarEstado)
  app.get('/liquidaciones-servicios/:id/historial', LiquidacionesServiciosController.obtenerHistorial)
  app.patch('/liquidaciones-servicios/:id/restaurar', LiquidacionesServiciosController.restaurar)
}
