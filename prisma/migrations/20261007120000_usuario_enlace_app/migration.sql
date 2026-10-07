-- Enlace de acceso a la app móvil para usuarios administrativos.
--
-- Un usuario de administración, operaciones o HSEQ genera desde su perfil un
-- enlace que abre la app y le da una sesión de 30 días. El enlace lleva un
-- código opaco, nunca el JWT: aquí solo se guarda su sha256.
--
-- Un usuario tiene a lo sumo un enlace vigente: generar otro revoca el anterior,
-- y revocar un enlace corta también las sesiones de la app que salieron de él
-- (el middleware lo comprueba en cada petición, con caché de 30 s).
--
-- Tabla nueva, aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007120000_usuario_enlace_app
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS usuario_enlace_app (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  codigo_hash    varchar(64) NOT NULL UNIQUE,
  expires_at     timestamptz NOT NULL,
  revoked_at     timestamptz,
  ultimo_uso_at  timestamptz,
  usos           integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usuario_enlace_app_usuario_idx ON usuario_enlace_app (usuario_id);
