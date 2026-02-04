-- Insertar tipos de recargo necesarios para el sistema
-- Estos son los 6 tipos principales de recargos laborales en Colombia

-- 1. HED - Hora Extra Diurna (25%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'HED',
  'Hora Extra Diurna',
  'Hora extra trabajada en horario diurno (6 AM - 9 PM) en días normales',
  'HORAS_EXTRAS'::enum_tipos_recargos_categoria,
  25.0,
  true,
  true,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- 2. HEN - Hora Extra Nocturna (75%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'HEN',
  'Hora Extra Nocturna',
  'Hora extra trabajada en horario nocturno (9 PM - 6 AM) en días normales',
  'HORAS_EXTRAS'::enum_tipos_recargos_categoria,
  75.0,
  true,
  true,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- 3. HEFD - Hora Extra Festiva Diurna (100%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'HEFD',
  'Hora Extra Festiva Diurna',
  'Hora extra trabajada en horario diurno en domingos o festivos',
  'FESTIVOS'::enum_tipos_recargos_categoria,
  100.0,
  true,
  true,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- 4. HEFN - Hora Extra Festiva Nocturna (150%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'HEFN',
  'Hora Extra Festiva Nocturna',
  'Hora extra trabajada en horario nocturno en domingos o festivos',
  'FESTIVOS'::enum_tipos_recargos_categoria,
  150.0,
  true,
  true,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- 5. RN - Recargo Nocturno (35%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'RN',
  'Recargo Nocturno',
  'Recargo por trabajar en horario nocturno (9 PM - 6 AM)',
  'RECARGOS'::enum_tipos_recargos_categoria,
  35.0,
  false,
  false,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- 6. RD - Recargo Dominical/Festivo (75%)
INSERT INTO tipos_recargos (
  id, codigo, nombre, descripcion, categoria, porcentaje, es_hora_extra, 
  requiere_horas_extras, activo, vigencia_desde, created_at, updated_at
)
VALUES (
  gen_random_uuid(),
  'RD',
  'Recargo Dominical/Festivo',
  'Recargo por trabajar en domingo o festivo (primeras 10 horas)',
  'FESTIVOS'::enum_tipos_recargos_categoria,
  75.0,
  false,
  false,
  true,
  NOW(),
  NOW(),
  NOW()
) ON CONFLICT (codigo) DO NOTHING;

-- Verificar que se insertaron correctamente
SELECT 
  codigo,
  nombre,
  categoria,
  porcentaje,
  es_hora_extra,
  activo
FROM tipos_recargos
ORDER BY codigo;
