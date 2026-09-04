-- Borrado lógico de los bonos de día laboral.
--
-- MOTIVO
--
-- `registro_dia_laboral_segmento` YA tiene `deleted_at`, pero su código lo
-- ignora: cada guardado de un día laborado hace `deleteMany` + `createMany` de
-- todos sus segmentos. Es el mismo patrón que destruyó los ítems de las
-- liquidaciones.
--
-- No se puede arreglar aquel sin arreglar este primero. `registro_dia_laboral_bono`
-- cuelga del segmento, NO tiene `deleted_at`, se lee por `registro_dia_id` —no
-- por segmento— y lleva un campo `valor`. Si los segmentos pasaran a marcarse
-- en vez de borrarse, los bonos de un segmento eliminado seguirían vivos y se
-- seguirían SUMANDO. Sería un error de dinero, no de presentación.
--
-- QUÉ HACE
--
--   1. `deleted_at` en `registro_dia_laboral_bono`.
--   2. Índice parcial `WHERE deleted_at IS NULL`, que es el que usan las
--      consultas normales: las eliminadas solo se miran desde auditoría.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: `deleted_at` nace NULL, que significa «activo».
-- No retira el `ON DELETE CASCADE` que baja del segmento; eso sigue siendo la
-- red de seguridad para un borrado físico deliberado.
--
-- Es idempotente: ejecutarla dos veces no falla.

ALTER TABLE registro_dia_laboral_bono
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

-- Las dos consultas del módulo filtran por día y por segmento; ambas llevan
-- ahora `deleted_at IS NULL`.
CREATE INDEX IF NOT EXISTS registro_dia_laboral_bono_activos_idx
  ON registro_dia_laboral_bono (registro_dia_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS registro_dia_laboral_bono_segmento_activos_idx
  ON registro_dia_laboral_bono (segmento_id)
  WHERE deleted_at IS NULL;
