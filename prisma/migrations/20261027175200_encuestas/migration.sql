-- Las encuestas comparten enlace público, pero sus respuestas y señales de origen
-- permanecen aisladas por empresa y por encuesta.
CREATE TABLE "encuesta" (
  "id" UUID NOT NULL,
  "token" VARCHAR(64) NOT NULL,
  "titulo" VARCHAR(180) NOT NULL,
  "descripcion" TEXT,
  "mensaje_final" TEXT,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  "nombre_modo" VARCHAR(12) NOT NULL DEFAULT 'NO',
  "correo_modo" VARCHAR(12) NOT NULL DEFAULT 'NO',
  "registrar_origen" BOOLEAN NOT NULL DEFAULT false,
  "politica_origen" VARCHAR(20) NOT NULL DEFAULT 'PERMITIR',
  "preguntas" JSONB NOT NULL DEFAULT '[]',
  "fecha_cierre" TIMESTAMPTZ(6),
  "publicado_at" TIMESTAMPTZ(6),
  "creado_por_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "encuesta_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "encuesta_token_key" ON "encuesta"("token");
CREATE INDEX "encuesta_estado_created_at_idx" ON "encuesta"("estado", "created_at" DESC);
CREATE INDEX "encuesta_deleted_at_idx" ON "encuesta"("deleted_at");

CREATE TABLE "encuesta_respuesta" (
  "id" UUID NOT NULL,
  "encuesta_id" UUID NOT NULL,
  "nombre" VARCHAR(160),
  "correo" VARCHAR(254),
  "respuestas" JSONB NOT NULL,
  "ip_hash" VARCHAR(64),
  "dispositivo_hash" VARCHAR(64),
  "coincide_ip" BOOLEAN NOT NULL DEFAULT false,
  "coincide_dispositivo" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6),
  CONSTRAINT "encuesta_respuesta_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "encuesta_respuesta_encuesta_id_created_at_idx" ON "encuesta_respuesta"("encuesta_id", "created_at" DESC);
CREATE INDEX "encuesta_respuesta_encuesta_id_ip_hash_idx" ON "encuesta_respuesta"("encuesta_id", "ip_hash");
CREATE INDEX "encuesta_respuesta_encuesta_id_dispositivo_hash_idx" ON "encuesta_respuesta"("encuesta_id", "dispositivo_hash");
ALTER TABLE "encuesta_respuesta" ADD CONSTRAINT "encuesta_respuesta_encuesta_id_fkey"
  FOREIGN KEY ("encuesta_id") REFERENCES "encuesta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
