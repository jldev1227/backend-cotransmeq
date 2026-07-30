import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosMensualController } from "./liquidaciones-terceros-mensual.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";

export async function liquidacionesTercerosMensualRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  // ── Generación de borrador (recopila adicionales del mes) ──
  app.post(
    "/liquidaciones-terceros-mensual/generar-borrador",
    LiquidacionesTercerosMensualController.generarBorrador,
  );

  // ── Persistencia (cabecera + adicionales + conceptos) ──
  app.post(
    "/liquidaciones-terceros-mensual/guardar-borrador",
    LiquidacionesTercerosMensualController.guardarBorrador,
  );

  // ── Búsqueda por periodo (suele devolver 0 o 1 por la unique constraint) ──
  app.get(
    "/liquidaciones-terceros-mensual/por-periodo",
    LiquidacionesTercerosMensualController.obtenerPorPeriodo,
  );

  // ── Historial general (lista todas las cabeceras) ──
  app.get(
    "/liquidaciones-terceros-mensual",
    LiquidacionesTercerosMensualController.listar,
  );

  // ── Detalle completo por ID ──
  app.get(
    "/liquidaciones-terceros-mensual/:id",
    LiquidacionesTercerosMensualController.obtenerPorId,
  );

  // ── Recalcular totales (helper) ──
  app.post(
    "/liquidaciones-terceros-mensual/:id/recalcular-totales",
    LiquidacionesTercerosMensualController.recalcularTotales,
  );

  // ── Cambiar estado (BORRADOR → LIQUIDADA → APROBADA → FACTURADA) ──
  app.patch(
    "/liquidaciones-terceros-mensual/:id/estado",
    LiquidacionesTercerosMensualController.cambiarEstado,
  );

  // ── Soft delete ──
  app.delete(
    "/liquidaciones-terceros-mensual/:id",
    LiquidacionesTercerosMensualController.softDelete,
  );

  // ── Snapshots (historial de versiones / undo) ──
  app.get(
    "/liquidaciones-terceros-mensual/:id/snapshots",
    LiquidacionesTercerosMensualController.listarSnapshots,
  );

  // ── Preview data (para PDF mensual) ──
  app.get(
    "/liquidaciones-terceros-mensual/:id/preview-data",
    LiquidacionesTercerosMensualController.obtenerPreviewData,
  );
}
