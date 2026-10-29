import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosController } from './liquidaciones-terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { requirePermission } from '../../middlewares/permissions.middleware';

export async function liquidacionesTercerosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);
  // ── Historial global de items de terceros ──
  app.get(
    '/liquidaciones-terceros',
    { preHandler: requirePermission('liquidaciones-servicios-seccion06', 'read') },
    LiquidacionesTercerosController.listarHistorial
  );

  // ── Migración desde JSON (una sola vez) — ANTES de :liquidacion_id ──
  app.post(
    '/liquidaciones-terceros/migrar',
    { preHandler: requirePermission('liquidaciones-servicios-seccion06', 'full') },
    LiquidacionesTercerosController.migrar
  );

  // ── Items de terceros por liquidación ──
  app.get(
    '/liquidaciones-terceros/:liquidacion_id',
    { preHandler: requirePermission('liquidaciones-servicios-seccion06', 'read') },
    LiquidacionesTercerosController.obtenerPorLiquidacion
  );

  // ── Guardar (crear/reemplazar) items de terceros de una liquidación ──
  app.put(
    '/liquidaciones-terceros/:liquidacion_id',
    { preHandler: requirePermission('liquidaciones-servicios-seccion06', 'full') },
    LiquidacionesTercerosController.guardar
  );
}
