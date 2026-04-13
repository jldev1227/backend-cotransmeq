-- Crear tabla configuracion_liquidacion_servicio
CREATE TABLE IF NOT EXISTS configuracion_liquidacion_servicio (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  salario_basico DECIMAL(12,2) NOT NULL DEFAULT 2358886,
  cargo VARCHAR(100) NOT NULL DEFAULT 'Conductor',
  valor_hora_override DECIMAL(12,4) NOT NULL DEFAULT 0,
  conductor_adicional DECIMAL(12,2) NOT NULL DEFAULT 73693,
  pct_seg_social DECIMAL(5,2) NOT NULL DEFAULT 22.96,
  pct_prestaciones DECIMAL(5,2) NOT NULL DEFAULT 21.83,
  pct_admin DECIMAL(5,2) NOT NULL DEFAULT 8,
  prueba_covid DECIMAL(12,2) NOT NULL DEFAULT 0,
  activo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW()
);

-- Insertar fila por defecto si no existe
INSERT INTO configuracion_liquidacion_servicio (
  id, salario_basico, cargo, valor_hora_override, conductor_adicional,
  pct_seg_social, pct_prestaciones, pct_admin, prueba_covid
) SELECT
  gen_random_uuid(), 2358886, 'Conductor', 0, 73693, 22.96, 21.83, 8, 0
WHERE NOT EXISTS (SELECT 1 FROM configuracion_liquidacion_servicio LIMIT 1);
