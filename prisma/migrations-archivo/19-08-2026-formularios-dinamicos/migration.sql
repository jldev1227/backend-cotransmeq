-- Migración: FORMULARIOS DINÁMICOS (módulo `formularios-dinamicos`)
-- Fecha: 19-08-2026
--
-- Crea 13 tablas nuevas. NO altera, renombra ni borra ninguna tabla existente.
-- En particular NO toca las tablas legacy de evaluaciones (`Evaluacion`,
-- `Pregunta`, `Opcion`, `Resultado`, `Respuesta`) ni las de asistencias: el
-- motor dinámico es un dominio aparte y convive con ellas.
--
-- Referencias externas (solo FKs de lectura, ningún ON DELETE CASCADE hacia
-- ellas): `users`, `conductores`, `vehiculos`, `servicios`.
--
-- ORDEN DE EJECUCIÓN: el script ya viene ordenado (tablas en orden de
-- dependencia → índices). Ejecutar de una sola vez; todo va dentro de una
-- transacción, así que si algo falla no queda nada a medias.
--
-- Los "enums" son VARCHAR + CHECK a propósito. Añadir un valor nuevo será un
-- DROP/ADD CONSTRAINT reversible dentro de una transacción, y no un
-- `ALTER TYPE ... ADD VALUE`, que en Postgres no se puede deshacer.

BEGIN;

-- ---------------------------------------------------------------------------
-- CATÁLOGO
-- ---------------------------------------------------------------------------

-- Identidad estable del formulario; sobrevive a todas sus versiones.
CREATE TABLE form_definitions (
  id            UUID PRIMARY KEY,
  code          VARCHAR(50)  NOT NULL,
  slug          VARCHAR(120) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  description   TEXT,
  owner_area    VARCHAR(80)  NOT NULL DEFAULT 'hseq',
  created_by_id UUID         NOT NULL REFERENCES users(id),
  updated_by_id UUID         REFERENCES users(id),
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ(6),
  CONSTRAINT uq_form_definitions_code UNIQUE (code),
  CONSTRAINT uq_form_definitions_slug UNIQUE (slug)
);

-- Una revisión completa. Solo DRAFT es editable; publicar la congela.
CREATE TABLE form_versions (
  id                   UUID PRIMARY KEY,
  form_id              UUID    NOT NULL REFERENCES form_definitions(id) ON DELETE CASCADE,
  version_number       INTEGER NOT NULL,
  status               VARCHAR(20)  NOT NULL DEFAULT 'DRAFT',
  title                VARCHAR(255) NOT NULL,
  description          TEXT,
  instructions         TEXT,
  settings_json        JSONB   NOT NULL DEFAULT '{}'::jsonb,
  source_metadata_json JSONB   NOT NULL DEFAULT '{}'::jsonb,
  -- Contador de concurrencia optimista del autosave del builder. No tiene
  -- relación con `version_number`, que es la línea de versionado funcional.
  revision             INTEGER NOT NULL DEFAULT 1,
  created_by_id        UUID    NOT NULL REFERENCES users(id),
  published_by_id      UUID    REFERENCES users(id),
  created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  published_at         TIMESTAMPTZ(6),
  archived_at          TIMESTAMPTZ(6),
  CONSTRAINT ck_form_versions_status   CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  CONSTRAINT ck_form_versions_number   CHECK (version_number > 0),
  CONSTRAINT ck_form_versions_revision CHECK (revision > 0),
  CONSTRAINT uq_form_versions_number   UNIQUE (form_id, version_number)
);

-- Agrupador visual de campos.
--
-- `uq_form_sections_order` es DEFERRABLE INITIALLY DEFERRED: reordenar la
-- colección en una sola transacción intercambia sort_orders y colisionaría a
-- mitad de camino con una restricción inmediata.
CREATE TABLE form_sections (
  id            UUID PRIMARY KEY,
  version_id    UUID    NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  key           VARCHAR(120) NOT NULL,
  title         VARCHAR(255) NOT NULL,
  description   TEXT,
  sort_order    INTEGER NOT NULL,
  settings_json JSONB   NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_form_sections_key   UNIQUE (version_id, key),
  CONSTRAINT uq_form_sections_order UNIQUE (version_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED
);

-- Card del constructor. `parent_field_id` modela REPEATABLE_GROUP y MATRIX.
--
-- `uq_form_fields_order` NO cubre los campos de primer nivel: en Postgres una
-- UNIQUE con una columna NULL no compara esas filas entre sí. El índice
-- parcial `uq_form_fields_top_order`, más abajo, cierra ese hueco.
CREATE TABLE form_fields (
  id                   UUID PRIMARY KEY,
  version_id           UUID    NOT NULL REFERENCES form_versions(id) ON DELETE CASCADE,
  section_id           UUID    NOT NULL REFERENCES form_sections(id) ON DELETE CASCADE,
  parent_field_id      UUID    REFERENCES form_fields(id) ON DELETE CASCADE,
  key                  VARCHAR(120) NOT NULL,
  type                 VARCHAR(40)  NOT NULL,
  label                VARCHAR(500) NOT NULL,
  help_text            TEXT,
  placeholder          VARCHAR(500),
  required             BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order           INTEGER NOT NULL,
  config_json          JSONB   NOT NULL DEFAULT '{}'::jsonb,
  validation_json      JSONB   NOT NULL DEFAULT '{}'::jsonb,
  visibility_rule_json JSONB,
  default_value_json   JSONB,
  CONSTRAINT ck_form_fields_type CHECK (type IN (
    'SHORT_TEXT','LONG_TEXT','INTEGER','DECIMAL','DATE','TIME','DATETIME',
    'SINGLE_CHOICE','MULTIPLE_CHOICE','BOOLEAN','SIGNATURE','PHOTO','FILE',
    'LOCATION','INFO','REPEATABLE_GROUP','MATRIX','LOOKUP','CALCULATED'
  )),
  CONSTRAINT ck_form_fields_not_self_parent CHECK (parent_field_id IS NULL OR parent_field_id <> id),
  CONSTRAINT uq_form_fields_key   UNIQUE (version_id, key),
  CONSTRAINT uq_form_fields_order UNIQUE (section_id, parent_field_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED
);

-- Opción de SINGLE_CHOICE / MULTIPLE_CHOICE. `value` es el token estable que
-- referencian las reglas condicionales; `label` es texto corregible.
CREATE TABLE form_field_options (
  id            UUID PRIMARY KEY,
  field_id      UUID    NOT NULL REFERENCES form_fields(id) ON DELETE CASCADE,
  value         VARCHAR(120) NOT NULL,
  label         VARCHAR(255) NOT NULL,
  color         VARCHAR(20),
  score         DECIMAL(12,2),
  sort_order    INTEGER NOT NULL,
  metadata_json JSONB   NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT uq_form_field_options_value UNIQUE (field_id, value),
  CONSTRAINT uq_form_field_options_order UNIQUE (field_id, sort_order)
    DEFERRABLE INITIALLY DEFERRED
);

-- Biblioteca de cards preconfiguradas. Insertarlas COPIA el snapshot: no hay
-- FK desde form_fields hacia aquí, así que editar la plantilla nunca muta un
-- formulario ya construido.
CREATE TABLE form_field_templates (
  id            UUID PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(100) NOT NULL,
  field_type    VARCHAR(40)  NOT NULL,
  template_json JSONB        NOT NULL,
  owner_area    VARCHAR(80),
  is_global     BOOLEAN      NOT NULL DEFAULT FALSE,
  created_by_id UUID         NOT NULL REFERENCES users(id),
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at    TIMESTAMPTZ(6),
  CONSTRAINT ck_form_field_templates_type CHECK (field_type IN (
    'SHORT_TEXT','LONG_TEXT','INTEGER','DECIMAL','DATE','TIME','DATETIME',
    'SINGLE_CHOICE','MULTIPLE_CHOICE','BOOLEAN','SIGNATURE','PHOTO','FILE',
    'LOCATION','INFO','REPEATABLE_GROUP','MATRIX','LOOKUP','CALCULATED'
  ))
);

-- ---------------------------------------------------------------------------
-- ASIGNACIÓN
-- ---------------------------------------------------------------------------

-- Apunta a una versión PUBLICADA exacta, nunca a "la última": publicar una v3
-- no debe cambiar de forma retroactiva lo que el conductor tiene abierto.
--
-- Sin ON DELETE CASCADE contra form_versions: una versión con asignaciones se
-- archiva, no se borra.
CREATE TABLE form_assignments (
  id                  UUID PRIMARY KEY,
  version_id          UUID NOT NULL REFERENCES form_versions(id),
  name                VARCHAR(255) NOT NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',
  frequency           VARCHAR(30)  NOT NULL DEFAULT 'ON_DEMAND',
  limit_policy        VARCHAR(30)  NOT NULL DEFAULT 'UNLIMITED',
  -- Zona con la que el servidor calcula `business_date`. Con UTC, un
  -- preoperacional de las 19:00 en Bogotá contaría para el día siguiente.
  timezone            VARCHAR(64)  NOT NULL DEFAULT 'America/Bogota',
  starts_at           TIMESTAMPTZ(6),
  ends_at             TIMESTAMPTZ(6),
  context_schema_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  settings_json       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_id       UUID  NOT NULL REFERENCES users(id),
  created_at          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  deleted_at          TIMESTAMPTZ(6),
  CONSTRAINT ck_form_assignments_status    CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
  CONSTRAINT ck_form_assignments_frequency CHECK (frequency IN ('ON_DEMAND','ONCE','DAILY','WEEKLY','MONTHLY','PER_SERVICE')),
  CONSTRAINT ck_form_assignments_limit     CHECK (limit_policy IN ('UNLIMITED','ONE_PER_PERIOD','ONE_PER_CONTEXT')),
  CONSTRAINT ck_form_assignments_dates     CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

-- Una audiencia. El CHECK obliga a que esté poblada exactamente la columna
-- que corresponde al `target_type`, para que no exista un target CONDUCTOR
-- sin conductor ni un SEDE que además traiga vehículo.
CREATE TABLE form_assignment_targets (
  id            UUID PRIMARY KEY,
  assignment_id UUID NOT NULL REFERENCES form_assignments(id) ON DELETE CASCADE,
  target_type   VARCHAR(30) NOT NULL,
  conductor_id  UUID REFERENCES conductores(id),
  vehicle_id    UUID REFERENCES vehiculos(id),
  sede          VARCHAR(80),
  group_key     VARCHAR(120),
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_assignment_targets_type CHECK (target_type IN ('ALL_CONDUCTORS','CONDUCTOR','VEHICLE','SEDE','GROUP')),
  CONSTRAINT ck_form_assignment_targets_value CHECK (
    (target_type = 'ALL_CONDUCTORS' AND conductor_id IS NULL     AND vehicle_id IS NULL     AND sede IS NULL     AND group_key IS NULL) OR
    (target_type = 'CONDUCTOR'      AND conductor_id IS NOT NULL AND vehicle_id IS NULL     AND sede IS NULL     AND group_key IS NULL) OR
    (target_type = 'VEHICLE'        AND conductor_id IS NULL     AND vehicle_id IS NOT NULL AND sede IS NULL     AND group_key IS NULL) OR
    (target_type = 'SEDE'           AND conductor_id IS NULL     AND vehicle_id IS NULL     AND sede IS NOT NULL AND group_key IS NULL) OR
    (target_type = 'GROUP'          AND conductor_id IS NULL     AND vehicle_id IS NULL     AND sede IS NULL     AND group_key IS NOT NULL)
  )
);

-- ---------------------------------------------------------------------------
-- DILIGENCIAMIENTO
-- ---------------------------------------------------------------------------

-- Un envío. SUBMITTED es terminal: una corrección crea otro envío con
-- `supersedes_submission_id` y se conservan los dos.
--
-- `client_submission_id` lo genera el dispositivo antes de empezar y es
-- UNIQUE: es lo que hace idempotente el POST cuando la red se corta después
-- de que el servidor ya guardó el envío.
CREATE TABLE form_submissions (
  id                       UUID PRIMARY KEY,
  client_submission_id     UUID NOT NULL,
  assignment_id            UUID NOT NULL REFERENCES form_assignments(id),
  version_id               UUID NOT NULL REFERENCES form_versions(id),
  conductor_id             UUID NOT NULL REFERENCES conductores(id),
  vehicle_id               UUID REFERENCES vehiculos(id),
  service_id               UUID REFERENCES servicios(id),
  supersedes_submission_id UUID REFERENCES form_submissions(id),
  status                   VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
  business_date            DATE NOT NULL,
  period_key               VARCHAR(80),
  context_json             JSONB NOT NULL DEFAULT '{}'::jsonb,
  device_json              JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  submitted_at             TIMESTAMPTZ(6),
  voided_at                TIMESTAMPTZ(6),
  voided_by_id             UUID REFERENCES users(id),
  void_reason              TEXT,
  CONSTRAINT uq_form_submissions_client UNIQUE (client_submission_id),
  CONSTRAINT ck_form_submissions_status CHECK (status IN ('DRAFT','SUBMITTED','VOIDED')),
  CONSTRAINT ck_form_submissions_no_self_supersede CHECK (supersedes_submission_id IS NULL OR supersedes_submission_id <> id),
  -- Un VOIDED conserva `submitted_at` y exige actor: anular no reabre el
  -- registro, deja rastro de quién lo hizo.
  CONSTRAINT ck_form_submissions_terminal CHECK (
    (status = 'DRAFT'     AND submitted_at IS NULL     AND voided_at IS NULL) OR
    (status = 'SUBMITTED' AND submitted_at IS NOT NULL AND voided_at IS NULL) OR
    (status = 'VOIDED'    AND submitted_at IS NOT NULL AND voided_at IS NOT NULL AND voided_by_id IS NOT NULL)
  )
);

-- Una respuesta. El escalar va en la columna tipada del tipo del campo; las
-- opciones marcadas se normalizan en form_answer_options.
--
-- `occurrence_id` agrupa las celdas de una fila de un repetible; `row_index`
-- solo da el orden de presentación.
CREATE TABLE form_answers (
  id             UUID PRIMARY KEY,
  submission_id  UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  field_id       UUID NOT NULL REFERENCES form_fields(id),
  occurrence_id  UUID,
  row_index      INTEGER,
  value_text     TEXT,
  value_decimal  DECIMAL(18,6),
  value_boolean  BOOLEAN,
  value_date     DATE,
  value_datetime TIMESTAMPTZ(6),
  value_json     JSONB,
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_answers_row CHECK (row_index IS NULL OR row_index >= 0),
  -- Cero es válido: MULTIPLE_CHOICE guarda su valor en form_answer_options y
  -- deja todas las columnas escalares en NULL.
  CONSTRAINT ck_form_answers_single_scalar CHECK (
    num_nonnulls(value_text, value_decimal, value_boolean, value_date, value_datetime, value_json) <= 1
  )
);

-- Opciones marcadas. Tabla puente y no un array de texto: así borrar una
-- opción usada falla en vez de dejar envíos apuntando a un token inexistente.
CREATE TABLE form_answer_options (
  answer_id UUID NOT NULL REFERENCES form_answers(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES form_field_options(id),
  PRIMARY KEY (answer_id, option_id)
);

-- Evidencia. El binario vive en S3; aquí solo metadata y el sha256 con el que
-- se verifica el objeto subido.
CREATE TABLE form_attachments (
  id                   UUID PRIMARY KEY,
  submission_id        UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  answer_id            UUID REFERENCES form_answers(id) ON DELETE CASCADE,
  client_attachment_id UUID NOT NULL,
  kind                 VARCHAR(20) NOT NULL,
  status               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  object_key           VARCHAR(1024),
  original_name        VARCHAR(255),
  mime_type            VARCHAR(150) NOT NULL,
  byte_size            BIGINT NOT NULL,
  sha256               VARCHAR(64) NOT NULL,
  metadata_json        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  uploaded_at          TIMESTAMPTZ(6),
  CONSTRAINT uq_form_attachments_client UNIQUE (client_attachment_id),
  CONSTRAINT ck_form_attachments_kind   CHECK (kind IN ('PHOTO','FILE','SIGNATURE')),
  CONSTRAINT ck_form_attachments_status CHECK (status IN ('PENDING','UPLOADED','FAILED')),
  CONSTRAINT ck_form_attachments_size   CHECK (byte_size > 0)
);

-- Bitácora append-only. `actor_id` no tiene FK a propósito: apunta a
-- `users` o a `conductores` según `actor_type`, y es NULL si el actor es el
-- sistema.
CREATE TABLE form_submission_events (
  id            UUID PRIMARY KEY,
  submission_id UUID NOT NULL REFERENCES form_submissions(id) ON DELETE CASCADE,
  event_type    VARCHAR(40) NOT NULL,
  actor_type    VARCHAR(20) NOT NULL,
  actor_id      UUID,
  payload_json  JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_form_submission_events_actor CHECK (actor_type IN ('CONDUCTOR','USER','SYSTEM'))
);

-- ---------------------------------------------------------------------------
-- ÍNDICES ÚNICOS PARCIALES
--
-- Cierran lo que una UNIQUE con columnas NULL no puede: en Postgres dos filas
-- con NULL en la misma columna nunca se consideran duplicadas.
-- ---------------------------------------------------------------------------

-- Una sola respuesta por campo no repetible.
CREATE UNIQUE INDEX uq_form_answers_scalar
  ON form_answers (submission_id, field_id)
  WHERE occurrence_id IS NULL;

-- Una sola respuesta por campo y ocurrencia en repetibles.
CREATE UNIQUE INDEX uq_form_answers_occurrence
  ON form_answers (submission_id, field_id, occurrence_id)
  WHERE occurrence_id IS NOT NULL;

-- Orden único entre los campos de primer nivel de una sección.
CREATE UNIQUE INDEX uq_form_fields_top_order
  ON form_fields (section_id, sort_order)
  WHERE parent_field_id IS NULL;

-- ---------------------------------------------------------------------------
-- ÍNDICES DE CONSULTA
-- ---------------------------------------------------------------------------

CREATE INDEX idx_form_definitions_active            ON form_definitions (updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_form_versions_form_status          ON form_versions (form_id, status, version_number DESC);
CREATE INDEX idx_form_sections_version_order        ON form_sections (version_id, sort_order);
CREATE INDEX idx_form_fields_version_section_order  ON form_fields (version_id, section_id, sort_order);
CREATE INDEX idx_form_fields_parent_order           ON form_fields (parent_field_id, sort_order) WHERE parent_field_id IS NOT NULL;
CREATE INDEX idx_form_assignments_version           ON form_assignments (version_id);
CREATE INDEX idx_form_assignments_active_window     ON form_assignments (status, starts_at, ends_at) WHERE deleted_at IS NULL;
CREATE INDEX idx_form_assignment_targets_conductor  ON form_assignment_targets (conductor_id, assignment_id) WHERE conductor_id IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_vehicle    ON form_assignment_targets (vehicle_id, assignment_id) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_form_assignment_targets_sede       ON form_assignment_targets (sede, assignment_id) WHERE sede IS NOT NULL;
CREATE INDEX idx_form_submissions_portal            ON form_submissions (conductor_id, business_date DESC, status);
CREATE INDEX idx_form_submissions_admin             ON form_submissions (assignment_id, submitted_at DESC) WHERE status = 'SUBMITTED';
CREATE INDEX idx_form_submissions_version           ON form_submissions (version_id, submitted_at DESC);
CREATE INDEX idx_form_submissions_vehicle           ON form_submissions (vehicle_id, business_date DESC) WHERE vehicle_id IS NOT NULL;
CREATE INDEX idx_form_answers_submission            ON form_answers (submission_id);
CREATE INDEX idx_form_answers_field                 ON form_answers (field_id);
CREATE INDEX idx_form_attachments_submission        ON form_attachments (submission_id);
CREATE INDEX idx_form_attachments_pending           ON form_attachments (status, created_at) WHERE status <> 'UPLOADED';
CREATE INDEX idx_form_events_submission_time        ON form_submission_events (submission_id, created_at);

COMMIT;

-- ---------------------------------------------------------------------------
-- ROLLBACK TÉCNICO
--
-- Solo aplicable mientras no exista ningún envío real: borra datos. El
-- rollback FUNCIONAL de una versión ya usada es pausar/cerrar sus
-- asignaciones y archivar la versión, nunca borrar la tabla.
--
--   BEGIN;
--   DROP TABLE IF EXISTS form_submission_events;
--   DROP TABLE IF EXISTS form_attachments;
--   DROP TABLE IF EXISTS form_answer_options;
--   DROP TABLE IF EXISTS form_answers;
--   DROP TABLE IF EXISTS form_submissions;
--   DROP TABLE IF EXISTS form_assignment_targets;
--   DROP TABLE IF EXISTS form_assignments;
--   DROP TABLE IF EXISTS form_field_templates;
--   DROP TABLE IF EXISTS form_field_options;
--   DROP TABLE IF EXISTS form_fields;
--   DROP TABLE IF EXISTS form_sections;
--   DROP TABLE IF EXISTS form_versions;
--   DROP TABLE IF EXISTS form_definitions;
--   COMMIT;
-- ---------------------------------------------------------------------------
