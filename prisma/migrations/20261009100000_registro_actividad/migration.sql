-- Registro de actividad: «qué hizo quién», para el panel de inicio y la
-- página de actividad reciente. Lo llena un hook global del backend.
--
-- Idempotente. Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261009100000_registro_actividad

CREATE TABLE IF NOT EXISTS registro_actividad (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  usuario_nombre varchar(255) NOT NULL,
  usuario_areas  text[] NOT NULL DEFAULT '{}',
  modulo         varchar(60) NOT NULL,
  accion         varchar(20) NOT NULL,
  metodo         varchar(8) NOT NULL,
  ruta           varchar(255) NOT NULL,
  recurso_id     varchar(80),
  recurso_ref    varchar(255),
  descripcion    text NOT NULL,
  detalle        jsonb,
  ip             varchar(64),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_registro_actividad_fecha   ON registro_actividad (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registro_actividad_usuario ON registro_actividad (usuario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registro_actividad_modulo  ON registro_actividad (modulo, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_registro_actividad_areas   ON registro_actividad USING gin (usuario_areas);
