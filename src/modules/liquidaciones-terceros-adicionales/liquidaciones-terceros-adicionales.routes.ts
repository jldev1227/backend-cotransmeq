import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosAdicionalesController } from "./liquidaciones-terceros-adicionales.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { requirePermission } from "../../middlewares/permissions.middleware";

const MODULO = "liquidaciones-terceros-adicionales";

export async function liquidacionesTercerosAdicionalesRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  // Lectura: basta con acceso `limited` (facturación y contabilidad
  // consultan estos datos aunque no los editen).
  const puedeLeer = { preHandler: requirePermission(MODULO, "limited") };
  // Escritura: exige `full` (administración y operaciones). Hasta ahora
  // cualquier usuario autenticado podía escribir aquí.
  const puedeEscribir = { preHandler: requirePermission(MODULO, "full") };

  /// Los 12 meses de un año en una sola petición (canvas anual).
  /// Se declara ANTES que la ruta raíz para que no haya ambigüedad.
  app.get(
    "/liquidaciones-terceros-adicionales/anual",
    puedeLeer,
    LiquidacionesTercerosAdicionalesController.listarAnual,
  );

  /// Lista plana de los adicionales de un mes/año.
  app.get(
    "/liquidaciones-terceros-adicionales",
    puedeLeer,
    LiquidacionesTercerosAdicionalesController.listarPorPeriodo,
  );

  /// Crea una fila nueva en un cierre.
  app.post(
    "/liquidaciones-terceros-adicionales",
    puedeEscribir,
    LiquidacionesTercerosAdicionalesController.crear,
  );

  /// Actualiza UN campo de UNA fila con concurrencia optimista.
  /// Body: { field, value, base_version } → 200 | 409 con `server_row`.
  app.patch(
    "/liquidaciones-terceros-adicionales/:id",
    puedeEscribir,
    LiquidacionesTercerosAdicionalesController.actualizarCampo,
  );

  /// Soft-delete de una fila.
  app.delete(
    "/liquidaciones-terceros-adicionales/:id",
    puedeEscribir,
    LiquidacionesTercerosAdicionalesController.eliminar,
  );

  /// DEPRECADO — guardado en lote por periodo. El canvas ya usa
  /// POST/PATCH/DELETE por fila. Se mantiene un ciclo para clientes viejos.
  app.put(
    "/liquidaciones-terceros-adicionales",
    puedeEscribir,
    LiquidacionesTercerosAdicionalesController.guardar,
  );
}
