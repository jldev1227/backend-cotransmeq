-- Verificar detalles de recargos incluso si están eliminados o inactivos
SELECT 
  'TODOS LOS DETALLES (incluso eliminados)' as tipo,
  dr.id,
  dr.dia_laboral_id,
  dlp.dia as dia_del_mes,
  tr.codigo as tipo_recargo,
  dr.horas,
  dr.activo,
  dr.created_at,
  dr.deleted_at,
  CASE 
    WHEN dr.deleted_at IS NOT NULL THEN 'ELIMINADO'
    WHEN dr.activo = false THEN 'INACTIVO'
    ELSE 'ACTIVO'
  END as estado_registro
FROM detalles_recargos_dias dr
INNER JOIN dias_laborales_planillas dlp ON dr.dia_laboral_id = dlp.id
INNER JOIN tipos_recargos tr ON dr.tipo_recargo_id = tr.id
WHERE dlp.recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d';

-- Verificar si existen tipos de recargo activos
SELECT 
  'TIPOS DE RECARGO' as tipo,
  id,
  codigo,
  nombre,
  porcentaje,
  activo
FROM tipos_recargos
ORDER BY codigo;
