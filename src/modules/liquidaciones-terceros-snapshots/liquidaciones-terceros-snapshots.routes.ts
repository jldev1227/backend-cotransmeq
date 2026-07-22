import { FastifyInstance } from 'fastify';
import { LiquidacionesSnapshotsController } from './liquidaciones-terceros-snapshots.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';

export async function liquidacionesSnapshotsRoutes(app: FastifyInstance) {
  // Rutas de snapshots requieren auth
  app.addHook('onRequest', authMiddleware);

  app.get('/liquidaciones-terceros/:id/snapshots', LiquidacionesSnapshotsController.listar);
  app.get('/liquidaciones-terceros/:id/snapshots/:snapshotId', LiquidacionesSnapshotsController.obtener);
  app.get('/liquidaciones-terceros/:id/snapshots/:snapshotId/diff', LiquidacionesSnapshotsController.diff);
  app.post('/liquidaciones-terceros/:id/snapshots/:snapshotId/revertir', LiquidacionesSnapshotsController.revertir);

  // Cron endpoint (sin authMiddleware, usa x-cron-secret)
  app.post('/liquidaciones-terceros-snapshots/cron-hora', LiquidacionesSnapshotsController.cronHora);
}
