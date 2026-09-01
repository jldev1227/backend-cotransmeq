-- AlterTable: agregar campos para tracking de importación desde Transmeralda
-- a recargos_planillas. Permite identificar visualmente las planillas que
-- fueron trasladadas desde la otra app y filtrarlas en el canvas.

ALTER TABLE "recargos_planillas"
  ADD COLUMN IF NOT EXISTS "imported_from_transmeralda_id" UUID;

ALTER TABLE "recargos_planillas"
  ADD COLUMN IF NOT EXISTS "imported_from_transmeralda_at" TIMESTAMPTZ(6);

-- Índice para que el filtro "solo importados de TM" sea eficiente
CREATE INDEX IF NOT EXISTS "idx_recargos_planillas_imported_from_tm"
  ON "recargos_planillas" ("imported_from_transmeralda_at")
  WHERE "imported_from_transmeralda_at" IS NOT NULL;
