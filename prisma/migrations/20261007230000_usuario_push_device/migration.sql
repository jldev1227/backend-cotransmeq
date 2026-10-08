-- Dispositivos push de los usuarios del dashboard (app de gestión).
--
-- Hasta ahora solo los conductores recibían push. Los usuarios administrativos
-- que entran a la app de gestión registran aquí su token de Expo para enterarse
-- en el teléfono de lo que ya les llega a la campana de la web (p. ej. que les
-- aprobaron una liquidación). Un token pertenece a un solo usuario: si otro
-- inicia sesión en el mismo teléfono, el token pasa a él.
--
-- Tabla nueva, aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007230000_usuario_push_device
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS usuario_push_device (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expo_push_token  varchar(255) NOT NULL UNIQUE,
  plataforma       varchar(20) NOT NULL,
  activo           boolean NOT NULL DEFAULT true,
  last_seen_at     timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS usuario_push_device_usuario_id_activo_idx ON usuario_push_device (usuario_id, activo);
