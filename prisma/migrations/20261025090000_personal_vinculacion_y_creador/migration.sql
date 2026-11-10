ALTER TABLE "conductores"
  ADD COLUMN IF NOT EXISTS "tipo_vinculacion" VARCHAR(40) NOT NULL DEFAULT 'por_definir';

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "tipo_vinculacion" VARCHAR(40) NOT NULL DEFAULT 'por_definir',
  ADD COLUMN IF NOT EXISTS "creado_por_id" UUID;

ALTER TABLE "invitaciones_usuario"
  ADD COLUMN IF NOT EXISTS "tipo_vinculacion" VARCHAR(40) NOT NULL DEFAULT 'por_definir';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_creado_por_id_fkey'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_creado_por_id_fkey"
      FOREIGN KEY ("creado_por_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "users_creado_por_id_idx" ON "users"("creado_por_id");
