-- Migración: AUDIENCIA DE USUARIOS INTERNOS en formularios dinámicos
-- Fecha: 01-09-2026
--
-- Hasta ahora el módulo solo sabía de conductores: la audiencia de una
-- asignación se expresaba con `ALL_CONDUCTORS`/`CONDUCTOR`/`VEHICLE`/`SEDE`, y
-- `form_submissions.conductor_id` era NOT NULL. Eso obligaba a crear un
-- formulario aparte —y un mecanismo aparte— cada vez que un formato tenía que
-- diligenciarlo también personal administrativo.
--
-- Esta migración hace dos cosas y ninguna más:
--
--   1. Añade cuatro tipos de audiencia (`ALL_USERS`, `USER`, `AREA`, `CARGO`)
--      con sus columnas, de modo que UNA asignación pueda apuntar a la vez a
--      todos los conductores y al área de administración.
--   2. Generaliza el autor de un envío: `conductor_id` pasa a ser NULLABLE y
--      aparece `usuario_id`, con un CHECK que obliga a que haya exactamente uno
--      de los dos.
--
-- NO borra ni renombra nada, y ninguna fila existente necesita backfill: todas
-- tienen `conductor_id` y por tanto ya cumplen el CHECK nuevo.
--
-- Los "enums" siguen siendo VARCHAR + CHECK, como el resto del módulo: añadir
-- un valor es un DROP/ADD CONSTRAINT reversible dentro de la transacción, y no
-- un `ALTER TYPE ... ADD VALUE`, que en Postgres no se puede deshacer. Esta
-- migración es justamente el caso que esa decisión anticipaba.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. AUDIENCIA: nuevos tipos de target
-- ---------------------------------------------------------------------------

-- Una columna por tipo, como las cuatro que ya había. Reutilizar `group_key`
-- para área y cargo ahorraría dos columnas pero haría inverificable el CHECK
-- de "exactamente una poblada", que es lo que impide un target AREA sin área.
--
-- `area` a 40: los valores son la lista canónica de `config/permissions.ts`
-- (`administracion`, `talento_humano`, …), el más largo tiene 14 caracteres.
-- `cargo` a 255 porque es el ancho de `users.cargo`, que es texto libre.
ALTER TABLE form_assignment_targets
  ADD COLUMN usuario_id UUID REFERENCES users(id),
  ADD COLUMN area       VARCHAR(40),
  ADD COLUMN cargo      VARCHAR(255);

ALTER TABLE form_assignment_targets
  DROP CONSTRAINT ck_form_assignment_targets_type,
  DROP CONSTRAINT ck_form_assignment_targets_value;

ALTER TABLE form_assignment_targets
  ADD CONSTRAINT ck_form_assignment_targets_type CHECK (target_type IN (
    'ALL_CONDUCTORS','CONDUCTOR','VEHICLE','SEDE','GROUP',
    'ALL_USERS','USER','AREA','CARGO'
  )),
  ADD CONSTRAINT ck_form_assignment_targets_value CHECK (
    (target_type = 'ALL_CONDUCTORS' AND num_nonnulls(conductor_id, vehicle_id, sede, group_key, usuario_id, area, cargo) = 0) OR
    (target_type = 'ALL_USERS'      AND num_nonnulls(conductor_id, vehicle_id, sede, group_key, usuario_id, area, cargo) = 0) OR
    (target_type = 'CONDUCTOR'      AND conductor_id IS NOT NULL AND num_nonnulls(vehicle_id, sede, group_key, usuario_id, area, cargo) = 0) OR
    (target_type = 'VEHICLE'        AND vehicle_id   IS NOT NULL AND num_nonnulls(conductor_id, sede, group_key, usuario_id, area, cargo) = 0) OR
    (target_type = 'SEDE'           AND sede         IS NOT NULL AND num_nonnulls(conductor_id, vehicle_id, group_key, usuario_id, area, cargo) = 0) OR
    (target_type = 'GROUP'          AND group_key    IS NOT NULL AND num_nonnulls(conductor_id, vehicle_id, sede, usuario_id, area, cargo) = 0) OR
    (target_type = 'USER'           AND usuario_id   IS NOT NULL AND num_nonnulls(conductor_id, vehicle_id, sede, group_key, area, cargo) = 0) OR
    (target_type = 'AREA'           AND area         IS NOT NULL AND num_nonnulls(conductor_id, vehicle_id, sede, group_key, usuario_id, cargo) = 0) OR
    (target_type = 'CARGO'          AND cargo        IS NOT NULL AND num_nonnulls(conductor_id, vehicle_id, sede, group_key, usuario_id, area) = 0)
  );

-- Índices parciales, en la misma forma que los tres que ya existen: la consulta
-- del listado busca por el valor del target, no por la asignación.
--
-- El de cargo va sobre `lower(cargo)` porque la resolución compara sin
-- distinguir mayúsculas (`users.cargo` es texto libre y "Analista HSEQ" y
-- "ANALISTA HSEQ" son la misma persona en la práctica).
CREATE INDEX idx_form_assignment_targets_usuario ON form_assignment_targets (usuario_id, assignment_id) WHERE usuario_id IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_area    ON form_assignment_targets (area, assignment_id)       WHERE area IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_cargo   ON form_assignment_targets (lower(cargo), assignment_id) WHERE cargo IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. DILIGENCIAMIENTO: el autor puede ser un conductor o un usuario interno
-- ---------------------------------------------------------------------------

ALTER TABLE form_submissions
  ALTER COLUMN conductor_id DROP NOT NULL,
  ADD COLUMN usuario_id UUID REFERENCES users(id);

-- Esto es lo que sustituye al NOT NULL que se acaba de quitar. Sin él, un bug
-- en el servicio podría escribir un envío huérfano —sin conductor y sin
-- usuario— que no aparecería en el historial de nadie y tampoco fallaría.
ALTER TABLE form_submissions
  ADD CONSTRAINT ck_form_submissions_actor
  CHECK (num_nonnulls(conductor_id, usuario_id) = 1);

-- Espejo de `idx_form_submissions_portal`, que sirve a la misma consulta
-- (mis envíos, por fecha de negocio y estado) para el otro tipo de actor.
CREATE INDEX idx_form_submissions_usuario
  ON form_submissions (usuario_id, business_date DESC, status)
  WHERE usuario_id IS NOT NULL;

COMMIT;
