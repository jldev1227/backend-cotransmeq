-- Eliminar columnas de prima de liquidaciones
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "prima";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "prima_pendiente";
ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "prima_mes";

-- Crear enum
CREATE TYPE "enum_primas_estado" AS ENUM ('Pendiente', 'Pagado');

-- Crear tabla primas
CREATE TABLE "primas" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "prima" DECIMAL(10, 2) NOT NULL DEFAULT 0,
    "prima_pendiente" DECIMAL(10, 2),
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "estado" "enum_primas_estado" NOT NULL DEFAULT 'Pendiente',
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,

    CONSTRAINT "primas_pkey" PRIMARY KEY ("id")
);

-- Índices
CREATE INDEX "idx_primas_conductor_periodo" ON "primas"("conductor_id", "anio", "mes");
CREATE INDEX "idx_primas_periodo" ON "primas"("anio", "mes");
CREATE INDEX "idx_primas_estado" ON "primas"("estado");

-- Foreign keys
ALTER TABLE "primas" ADD CONSTRAINT "primas_conductor_id_fkey"
    FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "primas" ADD CONSTRAINT "primas_creado_por_id_fkey"
    FOREIGN KEY ("creado_por_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;

ALTER TABLE "primas" ADD CONSTRAINT "primas_actualizado_por_id_fkey"
    FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
