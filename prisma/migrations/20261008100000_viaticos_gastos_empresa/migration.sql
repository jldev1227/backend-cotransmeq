-- Viáticos: gastos que asume la empresa.
--
-- No todo el dinero de viáticos va a un conductor para una placa: hay gastos
-- de la oficina, mantenimientos de un vehículo sin pasar por un conductor o
-- dinero a un conductor sin vehículo. Los reconoce la empresa, no el tercero
-- propietario. Conductor y vehículo son opcionales.
--
-- Si los paga alguien de operaciones, salen de su fondo de anticipos: el
-- movimiento del fondo los referencia en `gasto_empresa_id`.
--
-- Aditiva e idempotente. Se aplica a mano (ver memoria
-- «migraciones-historial-divergente»):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261008100000_viaticos_gastos_empresa
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS viatico_gasto_empresa (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  categoria           varchar(30) NOT NULL,
  descripcion         text NOT NULL,
  beneficiario        varchar(255),
  valor               numeric(12, 2) NOT NULL,
  fecha               date NOT NULL,
  metodo              varchar(20) NOT NULL,
  numero_comprobante  varchar(60),
  comprobante_key     text,
  comprobante_mime    varchar(100),
  comprobante_nombre  varchar(255),
  vehiculo_id         uuid REFERENCES vehiculos(id) ON DELETE SET NULL,
  conductor_id        uuid REFERENCES conductores(id) ON DELETE SET NULL,
  creado_por_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  actualizado_por_id  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz
);

CREATE INDEX IF NOT EXISTS viatico_gasto_empresa_fecha_idx ON viatico_gasto_empresa (fecha DESC);
CREATE INDEX IF NOT EXISTS viatico_gasto_empresa_categoria_idx ON viatico_gasto_empresa (categoria);
CREATE INDEX IF NOT EXISTS viatico_gasto_empresa_vehiculo_id_idx ON viatico_gasto_empresa (vehiculo_id);
CREATE INDEX IF NOT EXISTS viatico_gasto_empresa_conductor_id_idx ON viatico_gasto_empresa (conductor_id);

ALTER TABLE viatico_fondo_movimiento ADD COLUMN IF NOT EXISTS gasto_empresa_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'viatico_fondo_movimiento_gasto_empresa_id_fkey') THEN
    ALTER TABLE viatico_fondo_movimiento
      ADD CONSTRAINT viatico_fondo_movimiento_gasto_empresa_id_fkey
      FOREIGN KEY (gasto_empresa_id) REFERENCES viatico_gasto_empresa(id) ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS viatico_fondo_movimiento_gasto_empresa_id_idx ON viatico_fondo_movimiento (gasto_empresa_id);
