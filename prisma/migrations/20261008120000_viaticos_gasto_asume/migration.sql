-- Viáticos: quién asume cada gasto directo.
--
-- Un gasto que se paga con viáticos (sin ser anticipo) lo puede reconocer la
-- EMPRESA o el TERCERO propietario de la placa; en ese caso se guarda el
-- tercero para descontárselo. Los cobros del banco (4x1000, cuota de manejo)
-- son la categoría BANCARIO, siempre de la empresa, pagados por débito
-- automático. Los gastos que ya existían quedan como de la empresa.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261008120000_viaticos_gasto_asume

ALTER TABLE viatico_gasto_empresa ADD COLUMN IF NOT EXISTS asume varchar(20) NOT NULL DEFAULT 'EMPRESA';
ALTER TABLE viatico_gasto_empresa ADD COLUMN IF NOT EXISTS tercero_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viatico_gasto_empresa_tercero_id_fkey') THEN
    ALTER TABLE viatico_gasto_empresa
      ADD CONSTRAINT viatico_gasto_empresa_tercero_id_fkey
      FOREIGN KEY (tercero_id) REFERENCES terceros(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS viatico_gasto_empresa_tercero_id_idx ON viatico_gasto_empresa (tercero_id);
