-- Borrado lógico de certificados tributarios.
--
-- MOTIVO
--
-- `deleteCertificado()` destruía tres cosas de golpe: el archivo del
-- certificado, los vínculos con los terceros a los que se emitió, y los
-- `certificacion_envio` —el registro de CUÁNDO y A QUIÉN se envió—.
--
-- Ese último es evidencia de entrega de un documento tributario. Borrarlo deja
-- a la empresa sin forma de demostrar que envió el certificado a un tercero que
-- luego dice no haberlo recibido.
--
-- La función devuelve la `s3_key` para que quien llama borre el objeto de S3,
-- así que el archivo físico sí se va; lo que se conserva aquí es la constancia
-- de que existió y de a quién se le mandó.
--
-- QUÉ HACE
--
--   1. `deleted_at` en las tres tablas.
--   2. La unicidad `(tercero_id, certificado_id)` de `certificado_tercero` pasa
--      a PARCIAL: sin eso, un vínculo archivado impediría volver a emitir el
--      mismo certificado al mismo tercero.
--   3. Índices parciales por tercero, que es la ruta de consulta del módulo.
--
-- QUÉ NO HACE
--
-- No toca una sola fila. No añade la columna a `tipo_certificado`, que es un
-- catálogo y ya se gestiona por su cuenta.
--
-- Es idempotente.

ALTER TABLE certificado_archivo  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE certificado_tercero  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
ALTER TABLE certificacion_envio  ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificado_tercero_tercero_id_certificado_id_key') THEN
    ALTER TABLE certificado_tercero DROP CONSTRAINT certificado_tercero_tercero_id_certificado_id_key;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'certificado_tercero_tercero_id_certificado_id_key' AND relkind = 'i') THEN
    DROP INDEX certificado_tercero_tercero_id_certificado_id_key;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS certificado_tercero_activo_uniq
  ON certificado_tercero (tercero_id, certificado_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS certificado_archivo_activos_idx
  ON certificado_archivo (tercero_id) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS certificacion_envio_activos_idx
  ON certificacion_envio (tercero_id) WHERE deleted_at IS NULL;
