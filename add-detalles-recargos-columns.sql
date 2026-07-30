-- =====================================================================
-- AGREGAR COLUMNAS A detalles_recargos_dias (Cotransmeq)
-- =====================================================================
-- Necesarias para que coincidan con el schema de Transmeralda y el
-- servicio de recálculo de recargos funcione.
-- =====================================================================

ALTER TABLE detalles_recargos_dias
  ADD COLUMN IF NOT EXISTS porcentaje_aplicado      DECIMAL(8, 2),
  ADD COLUMN IF NOT EXISTS valor_hora_calculado    DECIMAL(12, 4),
  ADD COLUMN IF NOT EXISTS configuracion_salario_id UUID,
  ADD COLUMN IF NOT EXISTS fecha_aplicacion        DATE,
  ADD COLUMN IF NOT EXISTS jornada_normal_horas    DECIMAL(4, 2),
  ADD COLUMN IF NOT EXISTS jornada_festiva_horas   DECIMAL(4, 2);

-- Índices recomendados
CREATE INDEX IF NOT EXISTS idx_detalle_recargo_config_salario
  ON detalles_recargos_dias (configuracion_salario_id);
CREATE INDEX IF NOT EXISTS idx_detalle_recargo_fecha_aplicacion
  ON detalles_recargos_dias (fecha_aplicacion);

-- FK opcional a configuraciones_salarios
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'detalles_recargos_dias_configuracion_salario_id_fkey'
  ) THEN
    ALTER TABLE detalles_recargos_dias
      ADD CONSTRAINT detalles_recargos_dias_configuracion_salario_id_fkey
      FOREIGN KEY (configuracion_salario_id)
      REFERENCES configuraciones_salarios(id)
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- Verificar
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'detalles_recargos_dias'
ORDER BY ordinal_position;
