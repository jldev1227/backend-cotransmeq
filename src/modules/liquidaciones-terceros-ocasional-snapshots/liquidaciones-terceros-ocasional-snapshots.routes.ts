import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosOcasionalSnapshotsController } from "./liquidaciones-terceros-ocasional-snapshots.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { permisoPorMetodo } from "../../middlewares/permissions.middleware";

export async function liquidacionesTercerosOcasionalSnapshotsRoutes(app: FastifyInstance) {
  // Todo pide sesión salvo la ruta del cron: esa la autoriza `x-cron-secret`
  // en su controlador. Heredaba este hook y respondía 401 a cualquier
  // disparador externo.
  app.addHook("onRequest", async (request, reply) => {
    if (request.routeOptions?.url === "/api/liquidaciones-terceros-ocasional-snapshots/cron-hora") return;
    return authMiddleware(request, reply);
  });
  /// Hasta oct-2026 este archivo solo pedía sesión: cualquiera del equipo (o un
  /// conductor con su enlace) leía y escribía aquí. Lectura y escritura del módulo `liquidaciones-terceros`.
  /// Escritura con limited: facturación y contabilidad también editan cierres (ver cierres-finales-estado.ts).
  app.addHook("preHandler", permisoPorMetodo("liquidaciones-terceros", { lectura: "limited", escritura: "limited" }, { excepto: (patron) => patron === "/liquidaciones-terceros-ocasional-snapshots/cron-hora" }));

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
