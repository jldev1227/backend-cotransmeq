-- Cédula de los usuarios del dashboard.
--
-- Las listas de asistencia y los resultados de evaluación llevan el documento de
-- quien firma. Los conductores lo tienen en `conductores`; los usuarios no tenían
-- dónde guardarlo. La app de gestión lo pide la primera vez que el usuario firma
-- o responde y queda aquí. Nullable y sin backfill.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007200000_usuario_numero_documento
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS numero_documento varchar(50);
