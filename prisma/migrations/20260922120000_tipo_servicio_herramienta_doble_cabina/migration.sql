-- Nuevo tipo de servicio en liquidaciones de servicio:
-- «Transporte de herramienta en camioneta doble cabina».
--
-- En ESTE proyecto el enum de Postgres guarda la clave con guiones bajos
-- (sin `@map`, ver 20260721000000_align_to_transmeralda). En transmeralda el
-- enum guarda la etiqueta con espacios; por eso el SQL de allá difiere.
--
-- Aditiva e idempotente. Escrita a mano y NO aplicada por `prisma migrate
-- dev`/`deploy` (historial desalineado con la base real). Se aplica con:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
-- y después:
--   npx prisma migrate resolve --applied 20260922120000_tipo_servicio_herramienta_doble_cabina
--
-- `ALTER TYPE ... ADD VALUE` acepta transacción desde Postgres 12; el valor
-- nuevo solo es usable tras el COMMIT, que aquí es inmediato.

ALTER TYPE "tipo_servicio_tarifa_enum"
  ADD VALUE IF NOT EXISTS 'TRANSPORTE_DE_HERRAMIENTA_EN_CAMIONETA_DOBLE_CABINA'
  AFTER 'TRANSPORTE_DE_PERSONAL_EN_BUS';
