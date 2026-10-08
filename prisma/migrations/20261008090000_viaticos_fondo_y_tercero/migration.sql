-- Viáticos: fondo de anticipos de operaciones y tercero del anticipo.
--
-- 1. `viatico_fondo_movimiento`: quien entrega anticipos (operaciones) recibe
--    un saldo cada cierto tiempo y lo registra como RECARGA; cada anticipo lo
--    descuenta (ANTICIPO, negativo); eliminarlo lo devuelve (REVERSO) y cambiar
--    su valor lo ajusta (AJUSTE). El saldo es la suma: sin saldo no hay anticipo.
-- 2. `viatico_anticipo.tercero_id`: propietario de la placa (tercero) al que
--    corresponde el anticipo. Nullable y sin backfill.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261008090000_viaticos_fondo_y_tercero
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS viatico_fondo_movimiento (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  tipo           varchar(20) NOT NULL,
  valor          numeric(12, 2) NOT NULL,
  anticipo_id    uuid REFERENCES viatico_anticipo(id) ON DELETE SET NULL,
  observaciones  text,
  creado_por_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS viatico_fondo_movimiento_usuario_id_created_at_idx ON viatico_fondo_movimiento (usuario_id, created_at);
CREATE INDEX IF NOT EXISTS viatico_fondo_movimiento_anticipo_id_idx ON viatico_fondo_movimiento (anticipo_id);

ALTER TABLE viatico_anticipo ADD COLUMN IF NOT EXISTS tercero_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viatico_anticipo_tercero_id_fkey') THEN
    ALTER TABLE viatico_anticipo
      ADD CONSTRAINT viatico_anticipo_tercero_id_fkey
      FOREIGN KEY (tercero_id) REFERENCES terceros(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
