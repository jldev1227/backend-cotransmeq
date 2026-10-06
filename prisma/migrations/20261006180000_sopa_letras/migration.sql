-- Tipo de pregunta «Sopa de letras» para las evaluaciones.
--
-- La cuadrícula se genera en el backend al guardar la pregunta y se persiste
-- en `configuracion` (jsonb) junto con la ubicación de cada palabra, para que
-- todos los evaluados vean la misma sopa y el PDF pueda dibujarla.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261006180000_sopa_letras

ALTER TYPE "TipoPreguntaEnum" ADD VALUE IF NOT EXISTS 'SOPA_LETRAS';
ALTER TABLE "Pregunta" ADD COLUMN IF NOT EXISTS "configuracion" jsonb;
