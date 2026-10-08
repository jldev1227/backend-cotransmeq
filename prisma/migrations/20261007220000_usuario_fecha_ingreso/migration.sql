-- Fecha de ingreso de los usuarios del dashboard.
--
-- Las asistencias a capacitaciones que le faltan firmar a alguien se cuentan
-- desde que entró a la empresa: los conductores ya tienen `conductores.fecha_ingreso`;
-- los usuarios no tenían el dato. Se rellena con la fecha en que se creó el
-- usuario, que es lo más cercano que hay; se corrige a mano donde no coincida.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007220000_usuario_fecha_ingreso
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

ALTER TABLE users ADD COLUMN IF NOT EXISTS fecha_ingreso date;

UPDATE users
SET fecha_ingreso = (created_at AT TIME ZONE 'America/Bogota')::date
WHERE fecha_ingreso IS NULL;
