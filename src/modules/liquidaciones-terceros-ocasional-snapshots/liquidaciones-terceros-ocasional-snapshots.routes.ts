import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosOcasionalSnapshotsController } from "./liquidaciones-terceros-ocasional-snapshots.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";

export async function liquidacionesTercerosOcasionalSnapshotsRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  app.get(
    "/liquidaciones-terceros-ocasional/:id/snapshots",
    LiquidacionesTercerosOcasionalSnapshotsController.listar
  );
  app.post(
    "/liquidaciones-terceros-ocasional/:id/snapshots",
    LiquidacionesTercerosOcasionalSnapshotsController.capturarManual
  );
  app.get(
    "/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId",
    LiquidacionesTercerosOcasionalSnapshotsController.obtener
  );
  app.get(
    "/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/diff",
    LiquidacionesTercerosOcasionalSnapshotsController.comparar
  );
  app.post(
    "/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/revertir",
    LiquidacionesTercerosOcasionalSnapshotsController.revertir
  );

  // Cron protegido con x-cron-secret
  app.post(
    "/liquidaciones-terceros-ocasional-snapshots/cron-hora",
    LiquidacionesTercerosOcasionalSnapshotsController.capturarHorario
  );
}
