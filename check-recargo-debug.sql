-- Consulta de debugging para recargo planilla específico
-- ID: da56638f-3ec9-481b-92b5-8c10cfcd6b1d

-- 1. Información básica del recargo
SELECT 
  'RECARGO PLANILLA' as tipo,
  id,
  conductor_id,
  vehiculo_id,
  empresa_id,
  numero_planilla,
  mes,
  "año" as año,
  total_dias_laborados,
  total_horas_trabajadas,
  total_horas_ordinarias,
  estado,
  observaciones,
  servicio_id,
  created_at,
  deleted_at
FROM recargos_planillas
WHERE id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d';

-- 2. Días laborales asociados
SELECT 
  'DIAS LABORALES' as tipo,
  id,
  recargo_planilla_id,
  dia,
  hora_inicio,
  hora_fin,
  total_horas,
  horas_ordinarias,
  es_festivo,
  es_domingo,
  kilometraje_inicial,
  kilometraje_final,
  pernocte,
  disponibilidad,
  observaciones,
  created_at,
  deleted_at
FROM dias_laborales_planillas
WHERE recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d'
  AND deleted_at IS NULL
ORDER BY dia ASC;

-- 3. Detalles de recargos por día (HED, HEN, HEFD, etc.)
SELECT 
  'DETALLES RECARGOS' as tipo,
  dr.id,
  dr.dia_laboral_id,
  dlp.dia as dia_del_mes,
  dlp.total_horas as horas_dia,
  tr.codigo as tipo_recargo,
  tr.nombre as nombre_recargo,
  tr.porcentaje,
  dr.horas as horas_recargo,
  dr.activo,
  dr.created_at,
  dr.deleted_at
FROM detalles_recargos_dias dr
INNER JOIN dias_laborales_planillas dlp ON dr.dia_laboral_id = dlp.id
INNER JOIN tipos_recargos tr ON dr.tipo_recargo_id = tr.id
WHERE dlp.recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d'
  AND dr.deleted_at IS NULL
  AND dlp.deleted_at IS NULL
ORDER BY dlp.dia ASC, tr.codigo ASC;

-- 4. Resumen de totales calculados desde días laborales
SELECT 
  'TOTALES CALCULADOS' as tipo,
  COUNT(DISTINCT dlp.id) as total_dias,
  SUM(dlp.total_horas) as suma_total_horas,
  SUM(CASE WHEN tr.codigo = 'HED' THEN dr.horas ELSE 0 END) as total_hed,
  SUM(CASE WHEN tr.codigo = 'HEN' THEN dr.horas ELSE 0 END) as total_hen,
  SUM(CASE WHEN tr.codigo = 'HEFD' THEN dr.horas ELSE 0 END) as total_hefd,
  SUM(CASE WHEN tr.codigo = 'HEFN' THEN dr.horas ELSE 0 END) as total_hefn,
  SUM(CASE WHEN tr.codigo = 'RN' THEN dr.horas ELSE 0 END) as total_rn,
  SUM(CASE WHEN tr.codigo = 'RD' THEN dr.horas ELSE 0 END) as total_rd
FROM dias_laborales_planillas dlp
LEFT JOIN detalles_recargos_dias dr ON dr.dia_laboral_id = dlp.id AND dr.deleted_at IS NULL
LEFT JOIN tipos_recargos tr ON dr.tipo_recargo_id = tr.id
WHERE dlp.recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d'
  AND dlp.deleted_at IS NULL
GROUP BY dlp.recargo_planilla_id;

-- 5. Detalle día por día con sus recargos
SELECT 
  dlp.dia,
  dlp.hora_inicio,
  dlp.hora_fin,
  dlp.total_horas,
  dlp.es_domingo,
  dlp.es_festivo,
  STRING_AGG(
    tr.codigo || ': ' || dr.horas || 'h', 
    ', ' 
    ORDER BY tr.codigo
  ) as recargos_detalle
FROM dias_laborales_planillas dlp
LEFT JOIN detalles_recargos_dias dr ON dr.dia_laboral_id = dlp.id AND dr.deleted_at IS NULL
LEFT JOIN tipos_recargos tr ON dr.tipo_recargo_id = tr.id
WHERE dlp.recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d'
  AND dlp.deleted_at IS NULL
GROUP BY dlp.id, dlp.dia, dlp.hora_inicio, dlp.hora_fin, dlp.total_horas, dlp.es_domingo, dlp.es_festivo
ORDER BY dlp.dia ASC;

-- 6. Información de relaciones (conductor, vehículo, empresa)
SELECT 
  'RELACIONES' as tipo,
  rp.id as recargo_id,
  c.nombre || ' ' || c.apellido as conductor,
  c.numero_identificacion as cedula_conductor,
  v.placa as vehiculo,
  v.marca || ' ' || COALESCE(v.modelo, '') as vehiculo_info,
  cl.nombre as empresa
FROM recargos_planillas rp
LEFT JOIN conductores c ON rp.conductor_id = c.id
LEFT JOIN vehiculos v ON rp.vehiculo_id = v.id
LEFT JOIN clientes cl ON rp.empresa_id = cl.id
WHERE rp.id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d';

-- 7. Verificar si hay días laborales pero sin detalles de recargo
SELECT 
  'DIAS SIN DETALLES' as tipo,
  dlp.id as dia_laboral_id,
  dlp.dia,
  dlp.total_horas,
  COUNT(dr.id) as cantidad_detalles
FROM dias_laborales_planillas dlp
LEFT JOIN detalles_recargos_dias dr ON dr.dia_laboral_id = dlp.id AND dr.deleted_at IS NULL
WHERE dlp.recargo_planilla_id = 'da56638f-3ec9-481b-92b5-8c10cfcd6b1d'
  AND dlp.deleted_at IS NULL
GROUP BY dlp.id, dlp.dia, dlp.total_horas
HAVING COUNT(dr.id) = 0;
