-- Quién creó cada servicio (usuario del dashboard: web, app de gestión o
-- asistente; también al nacer desde una planilla de recargos).
--
-- Nullable y sin backfill: los servicios anteriores no lo registraron, y
-- deducirlo de recargos_planillas.creado_por_id solo cubre los que tienen
-- planilla. Si se borra el usuario, el servicio queda sin creador.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261007180000_servicio_creado_por
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

ALTER TABLE servicios ADD COLUMN IF NOT EXISTS creado_por_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicios_creado_por_id_fkey') THEN
    ALTER TABLE servicios
      ADD CONSTRAINT servicios_creado_por_id_fkey
      FOREIGN KEY (creado_por_id) REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
