-- SOPORTES (FACTURAS) DE LOS DÍAS DE MANTENIMIENTO.
--
-- El conductor puede adjuntar, de forma opcional, fotos o PDF de las facturas
-- de un día MANTENIMIENTO desde la app. Los bytes van directo a S3 con una URL
-- prefirmada (con checksum SHA-256, igual que los adjuntos de formularios); aquí
-- queda la fila que los describe.
--
-- `client_attachment_id` lo genera el teléfono: es la llave de idempotencia de
-- la cola offline. `status` pasa de PENDING a UPLOADED cuando el backend
-- verifica el objeto contra S3 (tamaño + checksum).
--
-- Cuelga del día (`registro_dia_laboral.id`). El guardado del día hace upsert
-- por (conductor_id, fecha) y conserva el id, así que re-guardarlo no pierde los
-- adjuntos. Si el día se retira o deja de ser MANTENIMIENTO se marcan con
-- `deleted_at` desde la aplicación; el CASCADE solo actúa en borrados físicos.
--
-- Aditiva: tabla nueva e índices. Ningún dato existente cambia.
CREATE TABLE IF NOT EXISTS "registro_dia_laboral_adjunto" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "registro_dia_id"      UUID NOT NULL,
  "conductor_id"         UUID NOT NULL,
  "client_attachment_id" VARCHAR(64) NOT NULL,
  "object_key"           TEXT NOT NULL,
  "mime_type"            VARCHAR(100) NOT NULL,
  "byte_size"            INTEGER NOT NULL,
  "sha256"               VARCHAR(64) NOT NULL,
  "original_name"        VARCHAR(255),
  "status"               VARCHAR(20) NOT NULL DEFAULT 'PENDING',
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "uploaded_at"          TIMESTAMPTZ(6),
  "deleted_at"           TIMESTAMPTZ(6),
  CONSTRAINT "registro_dia_laboral_adjunto_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "registro_dia_laboral_adjunto_client_attachment_id_key" UNIQUE ("client_attachment_id"),
  CONSTRAINT "registro_dia_laboral_adjunto_registro_dia_id_fkey"
    FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "registro_dia_laboral_adjunto_conductor_id_fkey"
    FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "ck_registro_dia_laboral_adjunto_status"
    CHECK ("status" IN ('PENDING', 'UPLOADED')),
  CONSTRAINT "ck_registro_dia_laboral_adjunto_byte_size"
    CHECK ("byte_size" > 0 AND "byte_size" <= 10485760)
);

-- Lecturas por día: solo los vivos. Parcial, así que no se declara en
-- schema.prisma (Prisma no expresa índices con WHERE).
CREATE INDEX IF NOT EXISTS "idx_registro_dia_laboral_adjunto_dia_vivos"
  ON "registro_dia_laboral_adjunto" ("registro_dia_id")
  WHERE "deleted_at" IS NULL;

CREATE INDEX IF NOT EXISTS "idx_registro_dia_laboral_adjunto_conductor"
  ON "registro_dia_laboral_adjunto" ("conductor_id");
