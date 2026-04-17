import { FastifyInstance } from 'fastify';
import { LiquidacionesTercerosController } from './liquidaciones-terceros.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function liquidacionesTercerosRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware);

  // ── Historial global de items de terceros ──
  app.get('/liquidaciones-terceros', LiquidacionesTercerosController.listarHistorial);

  // ── Migración desde JSON (una sola vez) — ANTES de :liquidacion_id ──
  app.post('/liquidaciones-terceros/migrar', LiquidacionesTercerosController.migrar);

  // ── Items de terceros por liquidación ──
  app.get('/liquidaciones-terceros/:liquidacion_id', LiquidacionesTercerosController.obtenerPorLiquidacion);

  // ── Guardar (crear/reemplazar) items de terceros de una liquidación ──
  app.put('/liquidaciones-terceros/:liquidacion_id', LiquidacionesTercerosController.guardar);
}
