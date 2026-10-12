import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosController } from './liquidaciones-terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { permisoPorMetodo } from '../../middlewares/permissions.middleware';

export async function liquidacionesTercerosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-terceros`.
  /// Escritura con limited: facturación y contabilidad también editan cierres (ver cierres-finales-estado.ts).
  app.addHook('preHandler', permisoPorMetodo('liquidaciones-terceros', { lectura: 'limited', escritura: 'limited' }));

  // ── Historial global de items de terceros ──
  app.get('/liquidaciones-terceros', LiquidacionesTercerosController.listarHistorial);

  // ── Migración desde JSON (una sola vez) — ANTES de :liquidacion_id ──
  app.post('/liquidaciones-terceros/migrar', LiquidacionesTercerosController.migrar);

  // ── Items de terceros por liquidación ──
  app.get('/liquidaciones-terceros/:liquidacion_id', LiquidacionesTercerosController.obtenerPorLiquidacion);

  // ── Guardar (crear/reemplazar) items de terceros de una liquidación ──
  app.put('/liquidaciones-terceros/:liquidacion_id', LiquidacionesTercerosController.guardar);
}
