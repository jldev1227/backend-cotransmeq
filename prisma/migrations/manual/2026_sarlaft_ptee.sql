-- ═══════════════════════════════════════════════════════════════════════════
-- SARLAFT + PTEE — Formularios públicos de conocimiento de COTRANSMEQ
--
-- Crea las tablas que respaldan el módulo `formularios-sarlaft`:
--   · formulario_sarlaft_ptee            → un registro por radicado recibido
--   · formulario_sarlaft_ptee_documento  → anexos subidos a S3 por radicado
--
-- El script es IDEMPOTENTE: todo va con IF NOT EXISTS / DO $$ ... $$, así que
-- puede reejecutarse sin efectos secundarios. No borra ni trunca nada.
--
-- Aplicar con:
--   psql "$DATABASE_URL" -f prisma/migrations/manual/2026_sarlaft_ptee.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- gen_random_uuid() vive en pgcrypto en versiones < PG13
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─── Tabla principal ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS formulario_sarlaft_ptee (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  radicado                 VARCHAR(50)  NOT NULL,
  tipo_formulario          VARCHAR(50)  NOT NULL,
  codigo_formulario        VARCHAR(20)  NOT NULL,
  version                  VARCHAR(10)  NOT NULL DEFAULT '001',
  fecha_diligenciamiento   DATE,
  fecha_envio              TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Snapshot completo de las respuestas del titular
  respuestas               JSONB NOT NULL,

  -- Datos extraídos para búsqueda/filtrado rápido
  nombre_completo          VARCHAR(255),
  tipo_documento           VARCHAR(50),
  numero_documento         VARCHAR(50),
  correo                   VARCHAR(255),
  telefono                 VARCHAR(50),

  -- Contexto HTTP de la solicitud (trazabilidad SARLAFT)
  ip_origen                VARCHAR(64),
  user_agent               TEXT,
  referer                  TEXT,

  -- Evaluación del Oficial de Cumplimiento
  estado                   VARCHAR(30) NOT NULL DEFAULT 'recibido',
  evaluado_por_id          UUID,
  evaluado_at              TIMESTAMPTZ(6),
  evaluacion_concepto      VARCHAR(50),
  evaluacion_observaciones TEXT,

  created_at               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unicidad del radicado (el servicio reintenta el correlativo ante colisión)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'formulario_sarlaft_ptee_radicado_key'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'formulario_sarlaft_ptee_radicado_key'
  ) THEN
    ALTER TABLE formulario_sarlaft_ptee
      ADD CONSTRAINT formulario_sarlaft_ptee_radicado_key UNIQUE (radicado);
  END IF;
END $$;

-- FK al usuario evaluador (tabla `users`). SET NULL para no perder el
-- radicado si se da de baja al Oficial de Cumplimiento que lo evaluó.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users')
     AND NOT EXISTS (
       SELECT 1 FROM pg_constraint
       WHERE conname = 'formulario_sarlaft_ptee_evaluado_por_id_fkey'
     ) THEN
    ALTER TABLE formulario_sarlaft_ptee
      ADD CONSTRAINT formulario_sarlaft_ptee_evaluado_por_id_fkey
      FOREIGN KEY (evaluado_por_id) REFERENCES users(id)
      ON UPDATE CASCADE ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_tipo_formulario_idx  ON formulario_sarlaft_ptee (tipo_formulario);
CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_numero_documento_idx ON formulario_sarlaft_ptee (numero_documento);
CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_correo_idx           ON formulario_sarlaft_ptee (correo);
CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_estado_idx           ON formulario_sarlaft_ptee (estado);
CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_fecha_envio_idx      ON formulario_sarlaft_ptee (fecha_envio DESC);

-- ─── Documentos adjuntos ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS formulario_sarlaft_ptee_documento (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  formulario_id  UUID NOT NULL,
  tipo_documento VARCHAR(50)  NOT NULL,
  nombre_archivo VARCHAR(255) NOT NULL,
  s3_key         VARCHAR(500) NOT NULL,
  mime_type      VARCHAR(100) NOT NULL,
  tamano_bytes   BIGINT       NOT NULL,
  hash_sha256    VARCHAR(64),
  created_at     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'formulario_sarlaft_ptee_documento_formulario_id_fkey'
  ) THEN
    ALTER TABLE formulario_sarlaft_ptee_documento
      ADD CONSTRAINT formulario_sarlaft_ptee_documento_formulario_id_fkey
      FOREIGN KEY (formulario_id) REFERENCES formulario_sarlaft_ptee(id)
      ON UPDATE CASCADE ON DELETE CASCADE;
  END IF;
END $$;

-- Un solo archivo por (radicado, tipo de documento): reemplazar un anexo
-- implica actualizar la fila, no acumular duplicados.
CREATE UNIQUE INDEX IF NOT EXISTS formulario_sarlaft_ptee_documento_formulario_id_tipo_doc_key
  ON formulario_sarlaft_ptee_documento (formulario_id, tipo_documento);

CREATE INDEX IF NOT EXISTS formulario_sarlaft_ptee_documento_formulario_id_idx
  ON formulario_sarlaft_ptee_documento (formulario_id);

COMMIT;
