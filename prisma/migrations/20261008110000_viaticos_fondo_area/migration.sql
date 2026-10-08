-- Viáticos: el fondo de anticipos es del ÁREA de operaciones, no de cada persona.
--
-- Todo operaciones entrega anticipos y paga gastos de un mismo saldo, el que
-- recibe el área cada cierto tiempo. `usuario_id` pasa a ser quién hizo el
-- movimiento; `fondo` dice de qué fondo es (hoy solo OPERACIONES). Los
-- movimientos que ya existían quedan en el fondo del área.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261008110000_viaticos_fondo_area

ALTER TABLE viatico_fondo_movimiento ADD COLUMN IF NOT EXISTS fondo varchar(30) NOT NULL DEFAULT 'OPERACIONES';

CREATE INDEX IF NOT EXISTS viatico_fondo_movimiento_fondo_created_at_idx ON viatico_fondo_movimiento (fondo, created_at);
