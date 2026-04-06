-- Migración: Agregar campo continua_siguiente_dia a dias_laborales_planillas
-- Fecha: 2025
-- Descripción: Permite marcar si un día laboral continúa al día siguiente
--              para calcular recargos sobre ambos días como un servicio unificado

ALTER TABLE dias_laborales_planillas 
ADD COLUMN IF NOT EXISTS continua_siguiente_dia BOOLEAN DEFAULT false;

-- Verificar que se agregó correctamente
SELECT column_name, data_type, column_default 
FROM information_schema.columns 
WHERE table_name = 'dias_laborales_planillas' 
AND column_name = 'continua_siguiente_dia';
