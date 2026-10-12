import { FastifyInstance } from 'fastify';
import { LiquidacionesSnapshotsController } from './liquidaciones-terceros-snapshots.controller';
import { authMiddleware } from '../../middlewares/auth.middleware';
import { permisoPorMetodo } from '../../middlewares/permissions.middleware';

export async function liquidacionesSnapshotsRoutes(app: FastifyInstance) {
  // Rutas de snapshots requieren auth, salvo la del cron: esa la autoriza
  // `x-cron-secret` en su controlador. Heredaba este hook y respondía 401 a
  // cualquier disparador externo.
  app.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions?.url === '/api/liquidaciones-terceros-snapshots/cron-hora') return;
    return authMiddleware(request, reply);
  });
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-terceros`.
  /// Escritura con limited: facturación y contabilidad también editan cierres (ver cierres-finales-estado.ts).
  app.addHook('preHandler', permisoPorMetodo('liquidaciones-terceros', { lectura: 'limited', escritura: 'limited' }, { excepto: (patron) => patron === '/liquidaciones-terceros-snapshots/cron-hora' }));

  app.get('/liquidaciones-terceros/:id/snapshots', LiquidacionesSnapshotsController.listar);
  app.get('/liquidaciones-terceros/:id/snapshots/:snapshotId', LiquidacionesSnapshotsController.obtener);
  app.get('/liquidaciones-terceros/:id/snapshots/:snapshotId/diff', LiquidacionesSnapshotsController.diff);
  app.post('/liquidaciones-terceros/:id/snapshots/:snapshotId/revertir', LiquidacionesSnapshotsController.revertir);

  // Cron endpoint (sin authMiddleware, usa x-cron-secret)
  app.post('/liquidaciones-terceros-snapshots/cron-hora', LiquidacionesSnapshotsController.cronHora);
}
