import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosDescuentosController } from './liquidaciones-terceros-descuentos.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function liquidacionesTercerosDescuentosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  // ── Configuración de descuentos ──
  app.get('/configuracion-descuentos-tercero', LiquidacionesTercerosDescuentosController.obtenerConfiguracion);
  app.put('/configuracion-descuentos-tercero', LiquidacionesTercerosDescuentosController.actualizarConfiguracion);

  // ── Generar borrador desde liquidación de servicios (READ-ONLY: previsualiza
  //    sin persistir nada) ──
  app.post('/liquidaciones-terceros/generar-borrador', LiquidacionesTercerosDescuentosController.generarBorrador);

  // ── Generar borrador ASINCRONO (cola + socket) ──
  app.post('/liquidaciones-terceros/generar-borrador-async', LiquidacionesTercerosDescuentosController.generarBorradorAsync);
  app.get('/liquidaciones-terceros/borrador-status/:jobId', LiquidacionesTercerosDescuentosController.getBorradorStatus);
  app.delete('/liquidaciones-terceros/borrador-job/:jobId', LiquidacionesTercerosDescuentosController.cancelBorrador);

  // ── Guardar borrador (persiste el cierre + pivote + conceptos en una sola
  //    transacción) ──
  app.post('/liquidaciones-terceros/guardar-borrador', LiquidacionesTercerosDescuentosController.guardarBorrador);

  // ── Autocompletar desde nómina (puede ser por placa/mes/anio sin necesidad de cierre) ──
  app.get('/liquidaciones-terceros/autocompletar-nomina', LiquidacionesTercerosDescuentosController.autocompletarNomina);

  // ── Obtener bonificaciones por placa/mes/año (autocomplete del concepto BONIFICACION) ──
  app.get('/liquidaciones-terceros/bonificaciones', LiquidacionesTercerosDescuentosController.obtenerBonificaciones);

  // ── Obtener anticipos del vehículo por placa/mes/año ──
  app.get('/liquidaciones-terceros/anticipos-vehiculo', LiquidacionesTercerosDescuentosController.obtenerAnticiposVehiculo);

  // ── Rutas por ID del CIERRE FINAL (liquidacion_tercero_final) ──
  // Mantenemos el prefijo /liquidaciones-terceros/:id/... para no romper
  // el frontend existente, pero el :id ahora es el ID del cierre final.

  // Conceptos del cierre
  app.get('/liquidaciones-terceros/:id/conceptos', LiquidacionesTercerosDescuentosController.obtenerConceptos);
  app.put('/liquidaciones-terceros/:id/conceptos', LiquidacionesTercerosDescuentosController.guardarConceptos);

  // Calcular impuestos del cierre
  app.get('/liquidaciones-terceros/:id/calcular-impuestos', LiquidacionesTercerosDescuentosController.calcularImpuestos);

  // Recalcular totales del cierre
  app.post('/liquidaciones-terceros/:id/recalcular-totales', LiquidacionesTercerosDescuentosController.recalcularTotales);

  // Reemplazar items del pivote (descartar no deseados)
  app.put('/liquidaciones-terceros/:id/items', LiquidacionesTercerosDescuentosController.reemplazarItems);

  // Toggle aplica_impuestos en un item del pivote
  app.patch('/liquidaciones-terceros/items/:pivoteId/aplica-impuestos', LiquidacionesTercerosDescuentosController.toggleAplicaImpuestosItem);

  // Cambiar estado del cierre
  app.patch('/liquidaciones-terceros/:id/estado', LiquidacionesTercerosDescuentosController.cambiarEstado);

  // Soft delete del cierre (cabeza + items + conceptos)
  app.delete('/liquidaciones-terceros/:id', LiquidacionesTercerosDescuentosController.softDelete);

  // ── Historial y detalle de cierres finales ──
  app.get('/liquidaciones-terceros-descuentos', LiquidacionesTercerosDescuentosController.listarHistorial);
  app.get('/liquidaciones-terceros-descuentos/:id', LiquidacionesTercerosDescuentosController.obtenerPorId);
}
