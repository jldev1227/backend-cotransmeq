-- Tokens personales para conectar herramientas externas (Claude vía MCP) a la
-- app con los permisos de un usuario.
--
-- Solo se guarda el hash SHA-256 del token: el valor completo se muestra una
-- única vez al crearlo. `prefijo` (los primeros caracteres) sirve para que el
-- usuario reconozca cuál es cuál en su lista. Un token revocado no se borra,
-- queda con `revoked_at` para auditoría.
--
-- Tabla nueva, aditiva e idempotente: no toca datos ni columnas existentes.
-- Se aplica a mano (ver memoria «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261003120000_api_tokens
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS api_tokens (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nombre        varchar(60) NOT NULL,
  prefijo       varchar(10) NOT NULL,
  token_hash    varchar(64) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS api_tokens_token_hash_key ON api_tokens (token_hash);
CREATE INDEX IF NOT EXISTS api_tokens_usuario_id_idx ON api_tokens (usuario_id);

COMMENT ON TABLE api_tokens IS
  'Tokens personales (solo hash) para conectar Claude u otras herramientas vía MCP con los permisos del usuario.';
