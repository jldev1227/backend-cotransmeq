-- Ajustes de la empresa por clave (seguridad social por defecto, etc.).
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261009110000_configuracion_empresa

CREATE TABLE IF NOT EXISTS configuracion_empresa (
  clave              varchar(80) PRIMARY KEY,
  valor              jsonb NOT NULL,
  actualizado_por_id uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at         timestamptz NOT NULL DEFAULT now()
);
