import { FastifyInstance } from "fastify";
import { LiquidacionesTercerosOcasionalController } from "./liquidaciones-terceros-ocasional.controller";
import { authMiddleware } from "../../middlewares/auth.middleware";

export async function liquidacionesTercerosOcasionalRoutes(app: FastifyInstance) {
  app.addHook("onRequest", authMiddleware);

  // ── Modal selector (sin crear cabecera) ──
  app.post(
    "/liquidaciones-terceros-ocasional/previsualizar",
    LiquidacionesTercerosOcasionalController.previsualizar
  );
  app.get(
    "/liquidaciones-terceros-ocasional/terceros-candidatos",
    LiquidacionesTercerosOcasionalController.buscarTercerosCandidatos
  );

  // ── Generación de borrador ──
  app.post(
    "/liquidaciones-terceros-ocasional/generar-borrador",
    LiquidacionesTercerosOcasionalController.generarBorrador
  );

  // Incorpora items nuevos al borrador existente, sin tocar lo guardado.
  app.post(
    "/liquidaciones-terceros-ocasional/refrescar",
    LiquidacionesTercerosOcasionalController.refrescar
  );

  // Items sueltos de CUALQUIER mes que podrían entrar en este ocasional, y el
  // alta explícita de los que elija el usuario. Van antes de `/:id` para que
  // las rutas estáticas ganen sin ambigüedad.
  app.get(
    "/liquidaciones-terceros-ocasional/items-disponibles",
    LiquidacionesTercerosOcasionalController.itemsDisponibles
  );
  app.post(
    "/liquidaciones-terceros-ocasional/items-agregar",
    LiquidacionesTercerosOcasionalController.agregarItems
  );

  // ── Persistencia principal (idempotente) ──
  app.post(
    "/liquidaciones-terceros-ocasional/guardar-borrador",
    LiquidacionesTercerosOcasionalController.guardarBorrador
  );

  // ── Año completo (canvas anual de 12 hojas) ──
  // Va ANTES de `/:id` para que la ruta estática gane sin ambigüedad.
  app.get(
    "/liquidaciones-terceros-ocasional/anual",
    LiquidacionesTercerosOcasionalController.obtenerAnual
  );

  // ── Búsqueda por periodo ──
  app.get(
    "/liquidaciones-terceros-ocasional/por-periodo",
    LiquidacionesTercerosOcasionalController.obtenerPorPeriodo
  );

  // ── Historial general ──
  app.get(
    "/liquidaciones-terceros-ocasional",
    LiquidacionesTercerosOcasionalController.listar
  );

  // ── Detalle por ID ──
  app.get(
    "/liquidaciones-terceros-ocasional/:id",
    LiquidacionesTercerosOcasionalController.obtenerPorId
  );

  // ── Autosave drafts ──
  app.post(
    "/liquidaciones-terceros-ocasional/draft",
    LiquidacionesTercerosOcasionalController.guardarDraft
  );
  app.get(
    "/liquidaciones-terceros-ocasional/:id/draft",
    LiquidacionesTercerosOcasionalController.obtenerDraft
  );
  app.delete(
    "/liquidaciones-terceros-ocasional/:id/draft",
    LiquidacionesTercerosOcasionalController.eliminarDraft
  );

  // ── Recalcular totales ──
  app.post(
    "/liquidaciones-terceros-ocasional/:id/recalcular-totales",
    LiquidacionesTercerosOcasionalController.recalcularTotales
  );

  // ── Cerrar y distribuir (cambia a LIQUIDADA) ──
  app.post(
    "/liquidaciones-terceros-ocasional/:id/cerrar-distribuir",
    LiquidacionesTercerosOcasionalController.cerrarYDistribuir
  );

  // ── Cambiar estado ──
  app.patch(
    "/liquidaciones-terceros-ocasional/:id/estado",
    LiquidacionesTercerosOcasionalController.cambiarEstado
  );

  // ── Soft delete ──
  app.delete(
    "/liquidaciones-terceros-ocasional/:id",
    LiquidacionesTercerosOcasionalController.softDelete
  );

  // ── Preview data ──
  app.get(
    "/liquidaciones-terceros-ocasional/:id/preview-data",
    LiquidacionesTercerosOcasionalController.obtenerPreviewData
  );
}
