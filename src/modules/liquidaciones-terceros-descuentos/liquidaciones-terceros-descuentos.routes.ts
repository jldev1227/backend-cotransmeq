import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosDescuentosController } from './liquidaciones-terceros-descuentos.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/permissions.middleware';

const MODULO = 'liquidaciones-terceros';

export async function liquidacionesTercerosDescuentosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  // ⚠️ Hasta ahora este módulo NO comprobaba permisos: bastaba con estar
  // autenticado para escribir cualquier cosa, incluido aprobar cierres.
  //
  // Se estrena en modo `warn` (PERMISSIONS_MODE=warn): los rechazos se
  // registran pero pasan. `facturacion` y `contabilidad` solo tienen
  // `limited` sobre este módulo, así que sus escrituras aparecerán en el
  // log; hay que revisarlas ANTES de pasar a `enforce`.
  //
  // Lectura: `limited` basta — facturación y contabilidad consultan.
  const puedeLeer = { preHandler: requirePermission(MODULO, 'limited') };
  // Escritura: exige `full` — administración y operaciones.
  const puedeEscribir = { preHandler: requirePermission(MODULO, 'full') };

  // ── Configuración de descuentos ──
  app.get('/configuracion-descuentos-tercero', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerConfiguracion);
  app.put('/configuracion-descuentos-tercero', puedeEscribir, LiquidacionesTercerosDescuentosController.actualizarConfiguracion);

  // ── Generar borrador desde liquidación de servicios (READ-ONLY: previsualiza
  //    sin persistir nada) ──
  app.post('/liquidaciones-terceros/generar-borrador', puedeLeer, LiquidacionesTercerosDescuentosController.generarBorrador);

  // ── Generar borrador ASINCRONO (cola + socket) ──
  app.post('/liquidaciones-terceros/generar-borrador-async', puedeEscribir, LiquidacionesTercerosDescuentosController.generarBorradorAsync);
  app.get('/liquidaciones-terceros/borrador-status/:jobId', puedeLeer, LiquidacionesTercerosDescuentosController.getBorradorStatus);
  app.delete('/liquidaciones-terceros/borrador-job/:jobId', puedeEscribir, LiquidacionesTercerosDescuentosController.cancelBorrador);

  // ── Guardar borrador (persiste el cierre + pivote + conceptos en una sola
  //    transacción) ──
  app.post('/liquidaciones-terceros/guardar-borrador', puedeEscribir, LiquidacionesTercerosDescuentosController.guardarBorrador);

  // ── Autocompletar desde nómina (puede ser por placa/mes/anio sin necesidad de cierre) ──
  app.get('/liquidaciones-terceros/autocompletar-nomina', puedeLeer, LiquidacionesTercerosDescuentosController.autocompletarNomina);

  // ── Obtener bonificaciones por placa/mes/año (autocomplete del concepto BONIFICACION) ──
  app.get('/liquidaciones-terceros/bonificaciones', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerBonificaciones);

  // ── Obtener anticipos del vehículo por placa/mes/año ──
  app.get('/liquidaciones-terceros/anticipos-vehiculo', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerAnticiposVehiculo);

  // ── Rutas por ID del CIERRE FINAL (liquidacion_tercero_final) ──
  // Mantenemos el prefijo /liquidaciones-terceros/:id/... para no romper
  // el frontend existente, pero el :id ahora es el ID del cierre final.

  // Conceptos del cierre
  app.get('/liquidaciones-terceros/:id/conceptos', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerConceptos);
  app.put('/liquidaciones-terceros/:id/conceptos', puedeEscribir, LiquidacionesTercerosDescuentosController.guardarConceptos);

  // Conductores del cierre: altas, bajas y marca de propietario del vehículo
  // (al propietario no se le imputan DOTACION ni EXAMEN_MEDICO).
  app.put('/liquidaciones-terceros/:id/conductores', puedeEscribir, LiquidacionesTercerosDescuentosController.sincronizarConductores);

  // Filas sueltas de GASTOS DE VEHÍCULO y ANTICIPOS. Nacen en el servidor
  // porque una fila insertada en la hoja no tiene id, ni binding, ni formato.
  app.post('/liquidaciones-terceros/:id/conceptos-fila', puedeEscribir, LiquidacionesTercerosDescuentosController.agregarConcepto);
  app.delete('/liquidaciones-terceros/conceptos-fila/:conceptoId', puedeEscribir, LiquidacionesTercerosDescuentosController.eliminarConcepto);

  // Copropietarios (reparto porcentual del valor a pagar)
  app.get('/liquidaciones-terceros/:id/propietarios', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerPropietarios);
  app.put('/liquidaciones-terceros/:id/propietarios', puedeEscribir, LiquidacionesTercerosDescuentosController.guardarPropietarios);

  // Calcular impuestos del cierre
  app.get('/liquidaciones-terceros/:id/calcular-impuestos', puedeLeer, LiquidacionesTercerosDescuentosController.calcularImpuestos);

  // Recalcular totales del cierre
  app.post('/liquidaciones-terceros/:id/recalcular-totales', puedeEscribir, LiquidacionesTercerosDescuentosController.recalcularTotales);

  // Reemplazar items del pivote (descartar no deseados)
  app.put('/liquidaciones-terceros/:id/items', puedeEscribir, LiquidacionesTercerosDescuentosController.reemplazarItems);

  // Refrescar items del cierre: trae `liquidacion_tercero` recién creados
  // para la misma placa/mes/año/tercero que aún no están en el pivote. Útil
  // cuando se crean liq_servicios nuevas después de generado el borrador.
  app.post('/liquidaciones-terceros/:id/refresh-items', puedeEscribir, LiquidacionesTercerosDescuentosController.refreshItems);

  // Items de la misma PLACA que no están en ningún cierre vivo, de cualquier
  // mes: lo que `refresh-items` no ve porque solo mira el periodo del cierre.
  // El alta es explícita —el usuario elige de la lista—, de ahí las dos rutas.
  app.get('/liquidaciones-terceros/:id/items-disponibles', puedeLeer, LiquidacionesTercerosDescuentosController.itemsDisponibles);
  app.post('/liquidaciones-terceros/:id/items-agregar', puedeEscribir, LiquidacionesTercerosDescuentosController.agregarItems);

  // Toggle aplica_impuestos en un item del pivote
  app.patch('/liquidaciones-terceros/items/:pivoteId/aplica-impuestos', puedeEscribir, LiquidacionesTercerosDescuentosController.toggleAplicaImpuestosItem);

  // Soft-delete / restaurar un item del pivote (marca `deleted_at` en
  // `liquidacion_tercero_final_item`). La fila sigue visible con tachado en
  // la vista de edición para permitir restaurarla sin regenerar el borrador.
  app.patch('/liquidaciones-terceros/items/:pivoteId/excluir', puedeEscribir, LiquidacionesTercerosDescuentosController.toggleExcluirItem);

  // ── ESTADO del cierre ──
  app.post('/liquidaciones-terceros/estado-lote', puedeEscribir, LiquidacionesTercerosDescuentosController.cambiarEstadoLote);
  app.patch('/liquidaciones-terceros/:id/estado', puedeEscribir, LiquidacionesTercerosDescuentosController.cambiarEstado);
  app.get('/liquidaciones-terceros/:id/historial-estados', puedeLeer, LiquidacionesTercerosDescuentosController.historialEstados);

  // Color de la pestaña en el canvas. Es preferencia visual, no dato de
  // negocio, pero se persiste porque si no se pierde en cada recarga.
  app.patch('/liquidaciones-terceros/:id/color-hoja', puedeEscribir, LiquidacionesTercerosDescuentosController.fijarColorHoja);

  // Soft delete del cierre (cabeza + items + conceptos)
  app.delete('/liquidaciones-terceros/:id', puedeEscribir, LiquidacionesTercerosDescuentosController.softDelete);

  // ── BULK SAVE (async, con cola + socket) ──
  app.post('/liquidaciones-terceros/guardar-borrador-bulk-async', puedeEscribir, LiquidacionesTercerosDescuentosController.guardarBorradorBulkAsync);
  app.get('/liquidaciones-terceros/save-bulk/:batchId', puedeLeer, LiquidacionesTercerosDescuentosController.getSaveBulkStatus);
  app.delete('/liquidaciones-terceros/save-bulk-job/:batchId', puedeEscribir, LiquidacionesTercerosDescuentosController.cancelSaveBulk);

  // ── Cierres de un PERIODO (canvas de cierres finales) ──
  //    Sin `ids` devuelve el índice de hojas; con `ids` el detalle por lotes.
  //    Va antes que las rutas con `:id` para que la estática no compita.
  app.get('/liquidaciones-terceros/periodo', puedeLeer, LiquidacionesTercerosDescuentosController.listarPeriodo);

  // ── Historial y detalle de cierres finales ──
  app.get('/liquidaciones-terceros-descuentos', puedeLeer, LiquidacionesTercerosDescuentosController.listarHistorial);
  app.get('/liquidaciones-terceros-descuentos/:id', puedeLeer, LiquidacionesTercerosDescuentosController.obtenerPorId);
}
