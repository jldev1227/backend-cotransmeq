-- Horas de recargo corregidas a mano en el canvas de nómina.
--
-- Aditivo e idempotente a propósito: el historial de migraciones de este
-- proyecto no coincide con el de la base, así que esto se aplica con
-- `psql --single-transaction` y se registra con `prisma migrate resolve`.
-- Nada de DROP ni de ALTER sobre lo que ya existe.
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS "ajustes_horas_recargo" (
    "id"             UUID         NOT NULL,
    "liquidacion_id" UUID         NOT NULL,
    "codigo"         VARCHAR(10)  NOT NULL,
    "tramo"          INTEGER      NOT NULL DEFAULT 0,
    "horas"          DECIMAL(7,2) NOT NULL,
    "motivo"         TEXT,
    "creado_por_id"  UUID,
    "deleted_at"     TIMESTAMPTZ(6),
    "created_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ajustes_horas_recargo_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
    ALTER TABLE "ajustes_horas_recargo"
        ADD CONSTRAINT "ajustes_horas_recargo_liquidacion_id_fkey"
        FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id")
        ON UPDATE CASCADE ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "ajustes_horas_recargo"
        ADD CONSTRAINT "ajustes_horas_recargo_creado_por_id_fkey"
        FOREIGN KEY ("creado_por_id") REFERENCES "users"("id")
        ON UPDATE CASCADE ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "ajustes_horas_recargo_liquidacion_id_idx"
    ON "ajustes_horas_recargo"("liquidacion_id");
CREATE INDEX IF NOT EXISTS "ajustes_horas_recargo_deleted_at_idx"
    ON "ajustes_horas_recargo"("deleted_at");

-- Un solo ajuste vivo por liquidación, código y tramo. Parcial porque el
-- soft-delete deja filas antiguas con la misma clave, y un unique normal
-- impediría volver a ajustar algo que ya se ajustó y se deshizo.
CREATE UNIQUE INDEX IF NOT EXISTS "ajustes_horas_recargo_vivo_idx"
    ON "ajustes_horas_recargo"("liquidacion_id", "codigo", "tramo")
    WHERE "deleted_at" IS NULL;
