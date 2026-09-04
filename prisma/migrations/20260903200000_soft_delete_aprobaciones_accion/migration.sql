-- Borrado lógico de las aprobaciones de acciones correctivas.
--
-- MOTIVO
--
-- `resetAprobacion()` BORRABA la aprobación cuando cambiaba el tipo de
-- hallazgo. La intención es correcta —el rol que debía aprobar ya no es el
-- mismo, así que la aprobación anterior no vale—, pero el registro decía QUIÉN
-- aprobó, CUÁNDO y con qué comentario, y eso desaparecía sin rastro.
--
-- Es la misma clase de dato que la firma de un desprendible: no un documento de
-- trabajo, sino la constancia de una decisión de una persona.
--
-- QUÉ HACE
--
--   1. `deleted_at` en `aprobaciones_accion`.
--   2. La unicidad `(accion_id)` pasa a PARCIAL. Sin eso, la aprobación
--      archivada seguiría ocupando su acción y no se podría registrar la nueva:
--      el reset dejaría la acción sin poder aprobarse nunca más.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: `deleted_at` nace NULL.
--
-- Es idempotente.

ALTER TABLE aprobaciones_accion
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aprobaciones_accion_accion_id_key') THEN
    ALTER TABLE aprobaciones_accion DROP CONSTRAINT aprobaciones_accion_accion_id_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'aprobaciones_accion_accion_id_key' AND relkind = 'i') THEN
    DROP INDEX aprobaciones_accion_accion_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS aprobaciones_accion_activa_uniq
  ON aprobaciones_accion (accion_id)
  WHERE deleted_at IS NULL;
