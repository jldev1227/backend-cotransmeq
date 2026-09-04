-- Borrado lógico de los ítems de una liquidación de nómina.
--
-- MOTIVO
--
-- Editar una liquidación destruía y recreaba TODOS sus ítems: vehículos,
-- anticipos, bonificaciones, mantenimientos, pernotes y recargos. Es el mismo
-- `deleteMany` + `createMany` que se llevó por delante los ítems de una
-- liquidación de servicios, pero sobre nómina: cada corrección borraba la
-- versión anterior de lo que se le iba a pagar a una persona, sin dejar con qué
-- compararla.
--
-- La madre ya recibió `deleted_at` en la migración anterior, y con ella se
-- podía recuperar una liquidación ELIMINADA entera. Lo que faltaba era poder
-- ver qué decía antes de la última EDICIÓN.
--
-- QUÉ HACE
--
--   1. `deleted_at` en las seis tablas.
--   2. La unicidad `(liquidacion_id, origen_planilla_id)` de `recargos` pasa a
--      PARCIAL: sin eso, el recargo archivado seguiría ocupando su planilla de
--      origen y el guardado siguiente fallaría entero.
--   3. Índices parciales por liquidación, que es como se leen todas.
--
-- QUÉ NO HACE
--
-- No toca una sola fila: `deleted_at` nace NULL.
--
-- Es idempotente.

ALTER TABLE liquidacion_vehiculo ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE anticipos           ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE bonificaciones      ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE mantenimientos      ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE pernotes            ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE recargos            ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

DO $$
DECLARE nombre text;
BEGIN
  SELECT conname INTO nombre FROM pg_constraint
   WHERE conrelid = 'recargos'::regclass AND contype = 'u';
  IF nombre IS NOT NULL THEN
    EXECUTE format('ALTER TABLE recargos DROP CONSTRAINT %I', nombre);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS recargos_origen_activo_uniq
  ON recargos (liquidacion_id, origen_planilla_id)
  WHERE deleted_at IS NULL AND origen_planilla_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS liquidacion_vehiculo_activos_idx ON liquidacion_vehiculo (liquidacion_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS anticipos_activos_idx            ON anticipos (liquidacion_id)            WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS bonificaciones_activos_idx       ON bonificaciones (liquidacion_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS mantenimientos_activos_idx       ON mantenimientos (liquidacion_id)       WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS pernotes_activos_idx             ON pernotes (liquidacion_id)             WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS recargos_activos_idx             ON recargos (liquidacion_id)             WHERE deleted_at IS NULL;
