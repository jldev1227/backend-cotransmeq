-- Placa del vehículo en un día de MANTENIMIENTO.
--
-- Un día de mantenimiento sin placa no permite auditar la disponibilidad de la
-- flota ni cruzar el día con la orden de taller. La columna vive en el padre
-- (`registro_dia_laboral`) y no en un segmento porque un mantenimiento no es un
-- recorrido: no tiene cliente, horario ni horas conducidas, y los segmentos
-- alimentan la liquidación.
--
-- `mantenimiento_vehiculo_placa` es un snapshot: si el vehículo se da de baja o
-- cambia de placa, el histórico debe seguir diciendo qué carro fue. Por eso la
-- FK es ON DELETE SET NULL y la placa queda intacta.
--
-- Ambas columnas son NULL en la BD (no NOT NULL) por los registros históricos
-- anteriores a esta regla; la obligatoriedad se aplica en la capa de
-- aplicación (zod + servicio + UI) para no romper la edición ni el soft-delete
-- de esos registros viejos.
--
-- Idempotente: se puede ejecutar varias veces sin error.

ALTER TABLE "registro_dia_laboral"
  ADD COLUMN IF NOT EXISTS "mantenimiento_vehiculo_id"    UUID,
  ADD COLUMN IF NOT EXISTS "mantenimiento_vehiculo_placa" VARCHAR(20);

CREATE INDEX IF NOT EXISTS "registro_dia_laboral_mantenimiento_vehiculo_id_idx"
  ON "registro_dia_laboral" ("mantenimiento_vehiculo_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'registro_dia_laboral_mantenimiento_vehiculo_id_fkey'
  ) THEN
    ALTER TABLE "registro_dia_laboral"
      ADD CONSTRAINT "registro_dia_laboral_mantenimiento_vehiculo_id_fkey"
      FOREIGN KEY ("mantenimiento_vehiculo_id")
      REFERENCES "vehiculos" ("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
