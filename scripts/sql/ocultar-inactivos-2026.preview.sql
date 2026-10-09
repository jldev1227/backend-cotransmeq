-- Vista previa de ocultar-inactivos-2026.sql: NO cambia nada.
-- Muestra totales y la lista de quién quedaría oculto, con una columna que
-- avisa si, aun sin planillas ni servicios, tiene recorridos registrados en
-- 2026 (para que no se oculte por error a alguien que sí trabaja).
--
--   psql "<DATABASE_URL sin ?schema=>" -f scripts/sql/ocultar-inactivos-2026.preview.sql

\set desde '''2026-01-01'''

SELECT
  (SELECT count(*) FROM conductores WHERE deleted_at IS NULL AND oculto = false) AS conductores_visibles,
  (SELECT count(*) FROM conductores c WHERE c.deleted_at IS NULL AND c.oculto = false
     AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.conductor_id = c.id AND p.deleted_at IS NULL AND p."año" = 2026)
     AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.conductor_id = c.id AND s.deleted_at IS NULL
                       AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))) AS conductores_a_ocultar,
  (SELECT count(*) FROM vehiculos WHERE deleted_at IS NULL AND oculto = false) AS vehiculos_visibles,
  (SELECT count(*) FROM vehiculos v WHERE v.deleted_at IS NULL AND v.oculto = false
     AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.vehiculo_id = v.id AND p.deleted_at IS NULL AND p."año" = 2026)
     AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.vehiculo_id = v.id AND s.deleted_at IS NULL
                       AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))) AS vehiculos_a_ocultar;

-- Conductores que quedarían ocultos
SELECT c.nombre || ' ' || c.apellido AS conductor, c.estado, c.tipo_contrato, c.fecha_ingreso::date,
       EXISTS (SELECT 1 FROM registro_dia_laboral r WHERE r.conductor_id = c.id AND r.deleted_at IS NULL AND r.fecha >= :desde::date) AS tiene_recorridos_2026
FROM conductores c
WHERE c.deleted_at IS NULL AND c.oculto = false
  AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.conductor_id = c.id AND p.deleted_at IS NULL AND p."año" = 2026)
  AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.conductor_id = c.id AND s.deleted_at IS NULL
                    AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))
ORDER BY tiene_recorridos_2026 DESC, c.estado, conductor;

-- Vehículos que quedarían ocultos
SELECT v.placa, v.estado, v.clase_vehiculo,
       EXISTS (SELECT 1 FROM registro_dia_laboral_segmento sg JOIN registro_dia_laboral r ON r.id = sg.registro_dia_id
               WHERE sg.vehiculo_id = v.id AND sg.deleted_at IS NULL AND r.deleted_at IS NULL AND r.fecha >= :desde::date) AS tiene_recorridos_2026
FROM vehiculos v
WHERE v.deleted_at IS NULL AND v.oculto = false
  AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.vehiculo_id = v.id AND p.deleted_at IS NULL AND p."año" = 2026)
  AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.vehiculo_id = v.id AND s.deleted_at IS NULL
                    AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))
ORDER BY tiene_recorridos_2026 DESC, v.estado, v.placa;
