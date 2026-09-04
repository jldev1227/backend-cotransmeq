-- Unicidad parcial en los días laborales de una planilla de recargos.
--
-- MOTIVO
--
-- `dias_laborales_planillas` y `detalles_recargos_dias` YA tienen `deleted_at`,
-- y de hecho las quince lecturas con `include` del proyecto ya filtran por él:
-- el código está escrito para borrado lógico. Lo que no lo estaba es el
-- guardado, que hacía `deleteMany` de todos los días y los recreaba, y cuya
-- cascada arrastraba además los detalles. Cada edición de una planilla
-- destruía la anterior sin dejar rastro.
--
-- Para poder marcar en vez de borrar hay que quitar de en medio la restricción
-- `(recargo_planilla_id, dia)`: si la fila vieja se queda marcada, la nueva del
-- mismo día chocaría contra ella y el guardado fallaría.
--
-- QUÉ HACE
--
-- Sustituye la unicidad global por una PARCIAL que solo mira las filas activas.
-- Dos días 15 marcados como eliminados pueden convivir; dos activos, no. Es la
-- misma solución que se aplicó al pivote de facturación.
--
-- QUÉ NO HACE
--
-- No toca una sola fila. No retira la cascada: sigue siendo la red de seguridad
-- de un borrado físico deliberado.
--
-- Es idempotente.

DO $$
BEGIN
  -- La restricción puede existir como constraint o solo como índice, según
  -- cómo la haya materializado Prisma en cada entorno.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'idx_dia_laboral_planilla_dia'
  ) THEN
    ALTER TABLE dias_laborales_planillas
      DROP CONSTRAINT idx_dia_laboral_planilla_dia;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'idx_dia_laboral_planilla_dia' AND relkind = 'i'
  ) THEN
    DROP INDEX idx_dia_laboral_planilla_dia;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS dias_laborales_planillas_dia_activo_uniq
  ON dias_laborales_planillas (recargo_planilla_id, dia)
  WHERE deleted_at IS NULL;

-- Los detalles se leen siempre por su día; el índice parcial es el que usan.
CREATE INDEX IF NOT EXISTS detalles_recargos_dias_activos_idx
  ON detalles_recargos_dias (dia_laboral_id)
  WHERE deleted_at IS NULL;
