-- Tabla firmas_primas (replica de firmas_desprendibles pero para la entidad primas)
CREATE TABLE "firmas_primas" (
    "id" UUID NOT NULL,
    "prima_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "firma_url" TEXT NOT NULL,
    "firma_s3_key" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "fecha_firma" TIMESTAMPTZ(6) NOT NULL,
    "hash_firma" TEXT,
    "estado" "enum_firmas_desprendibles_estado" NOT NULL DEFAULT 'Activa',
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "firmas_primas_pkey" PRIMARY KEY ("id")
);

-- Unique: una firma activa por (prima, conductor)
CREATE UNIQUE INDEX "uk_firmas_primas_prima_conductor"
  ON "firmas_primas" ("prima_id", "conductor_id");

-- Indexes de búsqueda
CREATE INDEX "idx_firmas_primas_conductor_id" ON "firmas_primas" ("conductor_id");
CREATE INDEX "idx_firmas_primas_fecha_firma" ON "firmas_primas" ("fecha_firma");
CREATE INDEX "idx_firmas_primas_prima_id" ON "firmas_primas" ("prima_id");

-- FKs
ALTER TABLE "firmas_primas"
  ADD CONSTRAINT "firmas_primas_prima_id_fkey"
  FOREIGN KEY ("prima_id") REFERENCES "primas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "firmas_primas"
  ADD CONSTRAINT "firmas_primas_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
