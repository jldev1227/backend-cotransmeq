-- ═══════════════════════════════════════════════════════════════════════════
-- Declaración SARLAFT/PTEE para empresa de transporte — COTRANSMEQ S.A.S. (GC-FOR-13)
-- Versiones inmutables del PDF generado + trazabilidad de entrega
--
-- EJECUCIÓN MANUAL. Este archivo NO fue aplicado por el agente.
-- Idempotente: se puede correr varias veces sin efecto adicional.
--
-- Orden: 1) tabla documento_generado  2) tabla documento_entrega
--        3) índices  4) claves foráneas
-- Requiere la extensión pgcrypto (gen_random_uuid). En PostgreSQL 13+ la
-- función viene en el core, así que la creación es defensiva.
-- ═══════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ───────────────────────────────────────────────────────────────────────────
-- 1. Versiones inmutables del documento generado
--
-- Se guarda el binario EXACTO que se entregó (su s3_key y su hash), no una
-- receta para regenerarlo: regenerar desde el JSON produce otro archivo y no
-- sirve como evidencia de qué firmó el declarante.
--
-- La versión 1 (`recibida`) nunca se actualiza. Cada decisión final inserta
-- una fila nueva (`evaluada`) con su propio hash.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "formulario_sarlaft_ptee_documento_generado" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "formulario_id"     UUID         NOT NULL,
  "marca"             VARCHAR(30)  NOT NULL,
  "clase"             VARCHAR(50)  NOT NULL,
  "version_documento" INTEGER      NOT NULL,
  "estado_documental" VARCHAR(20)  NOT NULL,
  "codigo_template"   VARCHAR(30)  NOT NULL,
  "version_template"  VARCHAR(20)  NOT NULL,
  "template_sha256"   VARCHAR(64)  NOT NULL,
  "s3_key"            VARCHAR(500) NOT NULL,
  "mime_type"         VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
  "tamano_bytes"      BIGINT       NOT NULL,
  "pdf_sha256"        VARCHAR(64)  NOT NULL,
  "generado_por_id"   UUID,
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "formulario_sarlaft_ptee_documento_generado_pkey" PRIMARY KEY ("id")
);

-- ───────────────────────────────────────────────────────────────────────────
-- 2. Intentos de entrega de cada versión documental
--
-- El token del enlace público NO se almacena en claro: solo su SHA-256. Así un
-- volcado de esta tabla no permite descargar los documentos.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "formulario_sarlaft_ptee_documento_entrega" (
  "id"                    UUID         NOT NULL DEFAULT gen_random_uuid(),
  "documento_generado_id" UUID         NOT NULL,
  "canal"                 VARCHAR(20)  NOT NULL,
  "destinatario"          VARCHAR(255),
  "estado"                VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
  "proveedor"             VARCHAR(30),
  "provider_message_id"   VARCHAR(255),
  "intento"               INTEGER      NOT NULL DEFAULT 1,
  "error_codigo"          VARCHAR(80),
  "token_hash"            VARCHAR(64),
  "expires_at"            TIMESTAMPTZ(6),
  "completed_at"          TIMESTAMPTZ(6),
  "created_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"            TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "formulario_sarlaft_ptee_documento_entrega_pkey" PRIMARY KEY ("id")
);

-- ───────────────────────────────────────────────────────────────────────────
-- 3. Índices y unicidad
-- ───────────────────────────────────────────────────────────────────────────

-- Una sola fila por (formulario, clase, versión): es lo que impide que un
-- reintento sobrescriba o duplique la versión 1 ya entregada.
CREATE UNIQUE INDEX IF NOT EXISTS "fspd_generado_formulario_clase_version_key"
  ON "formulario_sarlaft_ptee_documento_generado" ("formulario_id", "clase", "version_documento");

CREATE INDEX IF NOT EXISTS "fspd_generado_formulario_idx"
  ON "formulario_sarlaft_ptee_documento_generado" ("formulario_id");

CREATE INDEX IF NOT EXISTS "fspd_generado_created_at_idx"
  ON "formulario_sarlaft_ptee_documento_generado" ("created_at" DESC);

-- Permite verificar por hash que un PDF recibido por correo es el archivado.
CREATE INDEX IF NOT EXISTS "fspd_generado_pdf_sha256_idx"
  ON "formulario_sarlaft_ptee_documento_generado" ("pdf_sha256");

-- Hace idempotente el reintento de entrega.
CREATE UNIQUE INDEX IF NOT EXISTS "fspd_entrega_doc_canal_dest_intento_key"
  ON "formulario_sarlaft_ptee_documento_entrega"
     ("documento_generado_id", "canal", "destinatario", "intento");

CREATE UNIQUE INDEX IF NOT EXISTS "fspd_entrega_token_hash_key"
  ON "formulario_sarlaft_ptee_documento_entrega" ("token_hash");

CREATE INDEX IF NOT EXISTS "fspd_entrega_documento_idx"
  ON "formulario_sarlaft_ptee_documento_entrega" ("documento_generado_id");

CREATE INDEX IF NOT EXISTS "fspd_entrega_estado_idx"
  ON "formulario_sarlaft_ptee_documento_entrega" ("estado");

-- Soporta el barrido de enlaces vencidos.
CREATE INDEX IF NOT EXISTS "fspd_entrega_expires_at_idx"
  ON "formulario_sarlaft_ptee_documento_entrega" ("expires_at");

-- ───────────────────────────────────────────────────────────────────────────
-- 4. Claves foráneas
--
-- Se agregan con DO/EXCEPTION porque PostgreSQL no admite
-- `ADD CONSTRAINT IF NOT EXISTS` y este archivo debe poder re-ejecutarse.
-- `usuarios` está mapeado a la tabla real `users` en Prisma (@@map).
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ALTER TABLE "formulario_sarlaft_ptee_documento_generado"
    ADD CONSTRAINT "fspd_generado_formulario_fkey"
    FOREIGN KEY ("formulario_id")
    REFERENCES "formulario_sarlaft_ptee"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN RAISE NOTICE 'fspd_generado_formulario_fkey ya existe, se omite.';
END $$;

DO $$
BEGIN
  ALTER TABLE "formulario_sarlaft_ptee_documento_generado"
    ADD CONSTRAINT "fspd_generado_usuario_fkey"
    FOREIGN KEY ("generado_por_id")
    REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN RAISE NOTICE 'fspd_generado_usuario_fkey ya existe, se omite.';
  WHEN undefined_table THEN RAISE NOTICE 'Tabla users no encontrada; revisar el @@map del modelo usuarios.';
END $$;

DO $$
BEGIN
  ALTER TABLE "formulario_sarlaft_ptee_documento_entrega"
    ADD CONSTRAINT "fspd_entrega_documento_fkey"
    FOREIGN KEY ("documento_generado_id")
    REFERENCES "formulario_sarlaft_ptee_documento_generado"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN RAISE NOTICE 'fspd_entrega_documento_fkey ya existe, se omite.';
END $$;

-- ───────────────────────────────────────────────────────────────────────────
-- 5. Reglas de dominio
--
-- El estado administrativo `condicionado` es nuevo. La columna `estado` de
-- `formulario_sarlaft_ptee` es VARCHAR(30) libre, así que NO requiere ALTER:
-- basta con que backend y dashboards lo acepten. Este CHECK es opcional y se
-- deja comentado a propósito, porque activarlo rechazaría cualquier estado
-- que se agregue después sin tocar la base.
--
-- ALTER TABLE "formulario_sarlaft_ptee"
--   ADD CONSTRAINT "formulario_sarlaft_ptee_estado_check"
--   CHECK ("estado" IN ('recibido','en_revision','aprobado','condicionado','rechazado','escalado'));
-- ───────────────────────────────────────────────────────────────────────────


-- ═══════════════════════════════════════════════════════════════════════════
-- CONSULTAS DE VERIFICACIÓN (ejecutar después de aplicar lo anterior)
-- ═══════════════════════════════════════════════════════════════════════════

-- 5.1 Las dos tablas existen
-- SELECT table_name
--   FROM information_schema.tables
--  WHERE table_schema = 'public'
--    AND table_name IN ('formulario_sarlaft_ptee_documento_generado',
--                       'formulario_sarlaft_ptee_documento_entrega')
--  ORDER BY table_name;
-- Esperado: 2 filas.

-- 5.2 Columnas y tipos
-- SELECT table_name, column_name, data_type, character_maximum_length, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND table_name IN ('formulario_sarlaft_ptee_documento_generado',
--                       'formulario_sarlaft_ptee_documento_entrega')
--  ORDER BY table_name, ordinal_position;
-- Esperado: 15 columnas en documento_generado y 14 en documento_entrega.

-- 5.3 Índices
-- SELECT tablename, indexname, indexdef
--   FROM pg_indexes
--  WHERE schemaname = 'public'
--    AND tablename IN ('formulario_sarlaft_ptee_documento_generado',
--                      'formulario_sarlaft_ptee_documento_entrega')
--  ORDER BY tablename, indexname;
-- Esperado: 5 en documento_generado (PK + 4) y 6 en documento_entrega (PK + 5).

-- 5.4 Claves foráneas y su regla de borrado
-- SELECT tc.constraint_name, tc.table_name, kcu.column_name,
--        ccu.table_name AS referencia, rc.delete_rule
--   FROM information_schema.table_constraints tc
--   JOIN information_schema.key_column_usage kcu
--     ON tc.constraint_name = kcu.constraint_name
--   JOIN information_schema.constraint_column_usage ccu
--     ON tc.constraint_name = ccu.constraint_name
--   JOIN information_schema.referential_constraints rc
--     ON tc.constraint_name = rc.constraint_name
--  WHERE tc.constraint_type = 'FOREIGN KEY'
--    AND tc.table_name IN ('formulario_sarlaft_ptee_documento_generado',
--                          'formulario_sarlaft_ptee_documento_entrega')
--  ORDER BY tc.table_name, tc.constraint_name;
-- Esperado: 3 filas. CASCADE en las dos FK a formulario/documento, SET NULL en la de users.

-- 5.5 Ningún token de descarga almacenado en claro
--     (todo token_hash presente debe medir 64 hex).
-- SELECT count(*) AS tokens_mal_formados
--   FROM "formulario_sarlaft_ptee_documento_entrega"
--  WHERE token_hash IS NOT NULL
--    AND token_hash !~ '^[0-9a-f]{64}$';
-- Esperado: 0.

-- 5.6 Nunca debe haber dos versiones con el mismo número para un formulario
-- SELECT formulario_id, clase, version_documento, count(*)
--   FROM "formulario_sarlaft_ptee_documento_generado"
--  GROUP BY 1,2,3 HAVING count(*) > 1;
-- Esperado: 0 filas.

-- 5.7 Toda versión 1 debe ser `recibida` y toda versión >1 `evaluada`
-- SELECT id, formulario_id, version_documento, estado_documental
--   FROM "formulario_sarlaft_ptee_documento_generado"
--  WHERE (version_documento = 1 AND estado_documental <> 'recibida')
--     OR (version_documento > 1 AND estado_documental <> 'evaluada');
-- Esperado: 0 filas.
