-- Ocultar conductores y vehículos sin actividad en todo el 2026.
--
-- «Sin actividad» = ninguna planilla de recargos del año 2026 (no borrada) y
-- ningún servicio (no borrado) solicitado o realizado desde el 2026-01-01.
-- Solo se marca `oculto = true` (las fichas siguen existiendo y se pueden
-- volver a mostrar desde «ocultos»); no se borra nada. Idempotente: los que
-- ya están ocultos o borrados no se tocan.
--
-- Primero mirar: ocultar-inactivos-2026.preview.sql.
--
-- Aplicar (una transacción; si algo falla no queda a medias):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f scripts/sql/ocultar-inactivos-2026.sql
--
-- Deshacer lo que hizo ESTA corrida: las filas quedan con updated_at = ahora;
--   UPDATE conductores SET oculto = false WHERE oculto AND updated_at >= '<fecha-hora de la corrida>';
--   UPDATE vehiculos   SET oculto = false WHERE oculto AND updated_at >= '<fecha-hora de la corrida>';

\set desde '''2026-01-01'''

WITH candidatos AS (
  SELECT c.id
  FROM conductores c
  WHERE c.deleted_at IS NULL AND c.oculto = false
    AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.conductor_id = c.id AND p.deleted_at IS NULL AND p."año" = 2026)
    AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.conductor_id = c.id AND s.deleted_at IS NULL
                      AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))
), ocultados AS (
  UPDATE conductores c SET oculto = true, updated_at = now()
  FROM candidatos k WHERE k.id = c.id
  RETURNING c.id, c.nombre || ' ' || c.apellido AS conductor, c.estado
)
SELECT count(*) AS conductores_ocultados FROM ocultados;

WITH candidatos AS (
  SELECT v.id
  FROM vehiculos v
  WHERE v.deleted_at IS NULL AND v.oculto = false
    AND NOT EXISTS (SELECT 1 FROM recargos_planillas p WHERE p.vehiculo_id = v.id AND p.deleted_at IS NULL AND p."año" = 2026)
    AND NOT EXISTS (SELECT 1 FROM servicios s WHERE s.vehiculo_id = v.id AND s.deleted_at IS NULL
                      AND (s.fecha_realizacion >= :desde::timestamptz OR s.fecha_solicitud >= :desde::timestamptz))
), ocultados AS (
  UPDATE vehiculos v SET oculto = true, updated_at = now()
  FROM candidatos k WHERE k.id = v.id
  RETURNING v.id, v.placa, v.estado
)
SELECT count(*) AS vehiculos_ocultados FROM ocultados;
