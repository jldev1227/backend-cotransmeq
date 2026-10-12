-- Combustible: tanqueos de la flota.
--
-- Una fila por tanqueo: vehículo, conductor (opcional), fecha y hora, odómetro,
-- galones, valor pagado, tipo de combustible, estación, si quedó con tanque
-- lleno, medio de pago y el comprobante en S3. El rendimiento (km/gal) NO se
-- guarda: se calcula al leer entre llenos consecutivos, así que editar o
-- retirar un tanqueo no deja vecinos desactualizados.
--
-- Los CHECK repiten lo que valida la API (zod): galones y valor mayores que
-- cero, odómetro no negativo. Un cero en galones sería una división entre cero
-- en el rendimiento, venga de donde venga la fila.
--
-- Aditiva e idempotente. Se aplica a mano (el historial de migraciones diverge
-- de la base; `migrate deploy` es destructivo aquí):
--   psql "<DATABASE_URL sin ?schema=>" -v ON_ERROR_STOP=1 --single-transaction -f migration.sql
--   npx prisma migrate resolve --applied 20261011140000_combustible_tanqueos
--
-- OJO: el modelo Prisma `usuarios` mapea a la tabla `users`.

CREATE TABLE IF NOT EXISTS combustible_tanqueos (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehiculo_id         uuid NOT NULL REFERENCES vehiculos(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  conductor_id        uuid REFERENCES conductores(id) ON DELETE SET NULL ON UPDATE CASCADE,
  fecha_hora          timestamptz NOT NULL,
  kilometraje         integer NOT NULL,
  galones             numeric(10, 3) NOT NULL,
  valor_total         numeric(12, 2) NOT NULL,
  tipo_combustible    varchar(20) NOT NULL,
  estacion            varchar(255),
  tanque_lleno        boolean NOT NULL DEFAULT true,
  medio_pago          varchar(30),
  comprobante_key     text,
  comprobante_mime    varchar(100),
  comprobante_nombre  varchar(255),
  observaciones       text,
  creado_por_id       uuid REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  actualizado_por_id  uuid REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  deleted_at          timestamptz,
  CONSTRAINT combustible_tanqueos_galones_positivos CHECK (galones > 0),
  CONSTRAINT combustible_tanqueos_valor_positivo CHECK (valor_total > 0),
  CONSTRAINT combustible_tanqueos_km_no_negativo CHECK (kilometraje >= 0)
);

CREATE INDEX IF NOT EXISTS combustible_tanqueos_vehiculo_id_fecha_hora_idx ON combustible_tanqueos (vehiculo_id, fecha_hora);
CREATE INDEX IF NOT EXISTS combustible_tanqueos_fecha_hora_idx ON combustible_tanqueos (fecha_hora DESC);
CREATE INDEX IF NOT EXISTS combustible_tanqueos_conductor_id_idx ON combustible_tanqueos (conductor_id);
