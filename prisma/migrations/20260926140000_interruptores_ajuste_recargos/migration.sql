-- Interruptores propios para el ajuste de PAREX y de GEOPARK.
--
-- Hasta ahora «¿aplica el ajuste de PAREX?» se deducía de `ajuste_parex > 0`,
-- y ese importe solo lo escribe el cálculo CUANDO EL INTERRUPTOR YA ESTÁ
-- PUESTO. Es un círculo cerrado: un borrador nace con el importe en cero, así
-- que nace apagado y no había forma de encenderlo desde el canvas. En esta
-- base, 83 de 148 liquidaciones con recargos de PAREX lo tienen en cero.
--
-- Con columna propia el interruptor se teclea —como `ajuste_parex_recargos_completos`,
-- que ya era booleano— y el importe vuelve a ser lo que siempre debió ser: una
-- consecuencia.
--
-- SE RELLENAN DESDE EL IMPORTE para que ninguna liquidación existente cambie
-- de comportamiento: las que hoy aplican el ajuste porque tienen importe,
-- siguen aplicándolo.
ALTER TABLE "liquidaciones"
  ADD COLUMN "aplica_ajuste_parex"   BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "aplica_ajuste_geopark" BOOLEAN NOT NULL DEFAULT false;

UPDATE "liquidaciones" SET "aplica_ajuste_parex"   = true WHERE "ajuste_parex"   > 0;
UPDATE "liquidaciones" SET "aplica_ajuste_geopark" = true WHERE "ajuste_geopark" > 0;
