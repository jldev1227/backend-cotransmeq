-- Selector de placa dentro de la rama VEHICULO de FR-04/05/17/22.
--
-- Este es un cambio de DATOS, no de esquema. Aplicarlo solo después de desplegar
-- el backend y el frontend que entienden LOOKUP + bindContext=vehicleId.
-- No ejecutar contra una base local: este archivo se entrega para una ventana de
-- producción y hace mutaciones transaccionales sobre versiones publicadas.
--
-- Actualiza el árbol publicado en su lugar para conservar los version_id que
-- usan las asignaciones activas. Incrementa revision para invalidar el ETag y
-- forzar que el portal descargue la definición nueva.
--
-- Idempotente: si las cuatro filas ya existen con la definición esperada, no
-- cambia órdenes, estado ni revision. Si encuentra datos distintos, aborta.

BEGIN;

SELECT pg_advisory_xact_lock(hashtext('formularios:lookup-vehiculo:hseq:v1'));

CREATE TEMP TABLE _lookup_vehiculo_solicitado (
  code text PRIMARY KEY,
  source_revision text NOT NULL,
  field_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO _lookup_vehiculo_solicitado (code, source_revision, field_id) VALUES
  ('HSEQ-FR-04', '3', '1145a5d4-a7ca-5e4f-95c8-1b82bdfd4a90'),
  ('HSEQ-FR-05', '2', '38e741f4-5d1b-5155-82b4-4fa017a3f7b6'),
  ('HSEQ-FR-17', '2', 'f52ebf95-dfc5-5b0a-8d67-65f72f569022'),
  ('HSEQ-FR-22', '3', '3f26ab20-74da-5373-a4d0-306f1da3415f');

-- La revision documental y los UUID son los de las semillas HSEQ locales.
-- Escoger la última versión publicada de esa revisión mantiene el árbol que
-- realmente usan las asignaciones, sin tocar borradores ni versiones archivadas.
CREATE TEMP TABLE _lookup_vehiculo_target ON COMMIT DROP AS
SELECT
  req.code,
  req.field_id,
  v.id AS version_id,
  v.status AS status_original,
  v.revision AS revision_original,
  sec.id AS section_id,
  ubicacion.sort_order AS ubicacion_sort_order
FROM _lookup_vehiculo_solicitado req
JOIN form_definitions def
  ON def.code = req.code
 AND def.deleted_at IS NULL
JOIN LATERAL (
  SELECT version.*
  FROM form_versions version
  WHERE version.form_id = def.id
    AND version.status = 'PUBLISHED'
    AND version.source_metadata_json->>'sourceRevision' = req.source_revision
  ORDER BY version.version_number DESC
  LIMIT 1
) v ON true
JOIN form_sections sec
  ON sec.version_id = v.id
 AND sec.key = 'identificacion'
JOIN form_fields ubicacion
  ON ubicacion.version_id = v.id
 AND ubicacion.section_id = sec.id
 AND ubicacion.key = 'ubicacion_tipo'
 AND ubicacion.type = 'SINGLE_CHOICE'
WHERE EXISTS (
  SELECT 1
  FROM form_field_options opt
  WHERE opt.field_id = ubicacion.id
    AND opt.value = 'VEHICULO'
)
AND EXISTS (
  SELECT 1
  FROM form_field_options opt
  WHERE opt.field_id = ubicacion.id
    AND opt.value = 'SEDE'
);

DO $$
DECLARE
  faltantes text;
  conflictos text;
BEGIN
  SELECT string_agg(req.code, ', ' ORDER BY req.code)
    INTO faltantes
  FROM _lookup_vehiculo_solicitado req
  LEFT JOIN _lookup_vehiculo_target target USING (code)
  WHERE target.version_id IS NULL;

  IF faltantes IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTADO: no encontré una versión PUBLISHED con ubicacion_tipo y ambas opciones para: %. Verifica revisión/código antes de aplicar.',
      faltantes;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _lookup_vehiculo_target target
    JOIN form_versions target_version ON target_version.id = target.version_id
    JOIN form_assignments assignment
      ON assignment.deleted_at IS NULL
     AND assignment.status = 'ACTIVE'
    JOIN form_versions assigned_version ON assigned_version.id = assignment.version_id
    WHERE assigned_version.form_id = target_version.form_id
      AND assignment.version_id <> target.version_id
      AND assigned_version.status = 'PUBLISHED'
  ) THEN
    RAISE EXCEPTION
      'ABORTADO: hay una asignación ACTIVE apuntando a otra versión publicada de uno de los cuatro formatos. Resuelve qué versión está vigente antes de aplicar.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _lookup_vehiculo_target target
    WHERE target.ubicacion_sort_order <> 100
  ) THEN
    RAISE EXCEPTION
      'ABORTADO: ubicacion_tipo no está en la posición 100 esperada por la semilla. Revisa el orden del formulario antes de aplicar.';
  END IF;

  -- El ID determinístico no debe estar ocupado por otra versión o campo.
  SELECT string_agg(req.code, ', ' ORDER BY req.code)
    INTO conflictos
  FROM _lookup_vehiculo_solicitado req
  JOIN form_fields existente ON existente.id = req.field_id
  JOIN _lookup_vehiculo_target target USING (code)
  WHERE existente.version_id <> target.version_id
     OR existente.key <> 'vehiculo';

  IF conflictos IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTADO: UUID determinístico ocupado por otra fila para: %. No se modificó nada.',
      conflictos;
  END IF;

  -- Si ya hay un campo vehiculo, solo se acepta la definición exacta generada
  -- por la semilla. No se pisa una respuesta o configuración distinta.
  SELECT string_agg(target.code, ', ' ORDER BY target.code)
    INTO conflictos
  FROM _lookup_vehiculo_target target
  JOIN form_fields existente
    ON existente.version_id = target.version_id
   AND existente.key = 'vehiculo'
  WHERE existente.id <> target.field_id
     OR existente.section_id <> target.section_id
     OR existente.parent_field_id IS NOT NULL
     OR existente.type <> 'LOOKUP'
     OR existente.label <> 'Placa del vehículo'
     OR existente.sort_order <> target.ubicacion_sort_order + 100
     OR existente.required IS DISTINCT FROM true
     OR existente.placeholder IS DISTINCT FROM 'Buscar placa…'
     OR existente.config_json <> '{"source":"VEHICLE","bindContext":"vehicleId"}'::jsonb
     OR existente.visibility_rule_json <>
       '{"version":1,"all":[{"fieldKey":"ubicacion_tipo","operator":"equals","value":"VEHICULO"}],"effect":{"action":"show","targetFieldKey":"vehiculo"}}'::jsonb;

  IF conflictos IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORTADO: existe un campo vehiculo con datos distintos en: %. Revisa la versión manualmente.',
      conflictos;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM _lookup_vehiculo_target target
    JOIN form_fields field
      ON field.version_id = target.version_id
     AND field.section_id = target.section_id
     AND field.parent_field_id IS NULL
    WHERE field.sort_order < 0
  ) THEN
    RAISE EXCEPTION
      'ABORTADO: hay sort_order negativo en una sección destino; no se puede desplazar el orden de forma segura.';
  END IF;
END $$;

CREATE TEMP TABLE _lookup_vehiculo_pendiente ON COMMIT DROP AS
SELECT target.*
FROM _lookup_vehiculo_target target
WHERE NOT EXISTS (
  SELECT 1
  FROM form_fields existente
  WHERE existente.version_id = target.version_id
    AND existente.key = 'vehiculo'
);

-- Las versiones publicadas son inmutables desde la aplicación. La transacción
-- las cambia temporalmente a DRAFT y restaura su estado antes del COMMIT.
UPDATE form_versions version
SET status = 'DRAFT'
FROM _lookup_vehiculo_pendiente pendiente
WHERE version.id = pendiente.version_id;

-- Inserta en la posición 200, siguiendo el paso de 100 usado por las semillas.
-- Para evitar colisiones con el índice único parcial (no diferible), mueve
-- primero las posiciones afectadas a negativos y luego las vuelve a su lugar +100.
UPDATE form_fields field
SET sort_order = -field.sort_order - 100
FROM _lookup_vehiculo_pendiente pendiente
WHERE field.version_id = pendiente.version_id
  AND field.section_id = pendiente.section_id
  AND field.parent_field_id IS NULL
  AND field.sort_order > pendiente.ubicacion_sort_order;

UPDATE form_fields field
SET sort_order = -field.sort_order
FROM _lookup_vehiculo_pendiente pendiente
WHERE field.version_id = pendiente.version_id
  AND field.section_id = pendiente.section_id
  AND field.parent_field_id IS NULL
  AND field.sort_order < 0;

INSERT INTO form_fields (
  id,
  version_id,
  section_id,
  parent_field_id,
  key,
  type,
  label,
  help_text,
  placeholder,
  required,
  sort_order,
  config_json,
  validation_json,
  visibility_rule_json,
  default_value_json
)
SELECT
  pendiente.field_id,
  pendiente.version_id,
  pendiente.section_id,
  NULL,
  'vehiculo',
  'LOOKUP',
  'Placa del vehículo',
  'Busca y selecciona la placa del vehículo inspeccionado.',
  'Buscar placa…',
  true,
  pendiente.ubicacion_sort_order + 100,
  '{"source":"VEHICLE","bindContext":"vehicleId"}'::jsonb,
  '{}'::jsonb,
  '{"version":1,"all":[{"fieldKey":"ubicacion_tipo","operator":"equals","value":"VEHICULO"}],"effect":{"action":"show","targetFieldKey":"vehiculo"}}'::jsonb,
  NULL
FROM _lookup_vehiculo_pendiente pendiente;

-- Restaurar estado y invalidar ETag solo para las versiones realmente editadas.
UPDATE form_versions version
SET status = pendiente.status_original,
    revision = version.revision + 1,
    updated_at = NOW()
FROM _lookup_vehiculo_pendiente pendiente
WHERE version.id = pendiente.version_id;

-- Verificación previa al COMMIT: cuatro campos con la relación y regla correctas.
DO $$
DECLARE
  encontrados integer;
BEGIN
  SELECT count(*) INTO encontrados
  FROM _lookup_vehiculo_target target
  JOIN form_fields field
    ON field.version_id = target.version_id
   AND field.id = target.field_id
   AND field.key = 'vehiculo'
   AND field.type = 'LOOKUP'
   AND field.config_json = '{"source":"VEHICLE","bindContext":"vehicleId"}'::jsonb
   AND field.visibility_rule_json =
     '{"version":1,"all":[{"fieldKey":"ubicacion_tipo","operator":"equals","value":"VEHICULO"}],"effect":{"action":"show","targetFieldKey":"vehiculo"}}'::jsonb;

  IF encontrados <> 4 THEN
    RAISE EXCEPTION
      'ABORTADO: verificación final esperaba 4 campos LOOKUP correctos y encontró %.',
      encontrados;
  END IF;
END $$;

SELECT
  target.code,
  target.version_id,
  field.id AS field_id,
  field.key,
  field.type,
  field.required,
  field.sort_order,
  version.status,
  version.revision
FROM _lookup_vehiculo_target target
JOIN form_fields field
  ON field.version_id = target.version_id
 AND field.key = 'vehiculo'
JOIN form_versions version ON version.id = target.version_id
ORDER BY target.code;

COMMIT;
