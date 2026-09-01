-- AlterTable: agregar campos para trazabilidad de overrides manuales
-- de recargos automáticos. Cuando un usuario crea un recargo manual en una
-- liquidación para un (vehiculo, empresa, mes) que ya tenía un recargo
-- automático, marcamos el nuevo como override del automático y guardamos
-- el id del recargo automático que está siendo sustituido.

ALTER TABLE "recargos"
  ADD COLUMN IF NOT EXISTS "es_override" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "recargos"
  ADD COLUMN IF NOT EXISTS "origen_planilla_id" UUID;

-- Índice para acelerar la búsqueda del recargo automático origen
-- (lookup por liquidacion + vehiculo + empresa + mes + es_automatico)
CREATE INDEX IF NOT EXISTS "idx_recargos_override_lookup"
  ON "recargos" ("liquidacion_id", "vehiculo_id", "empresa_id", "mes")
  WHERE "es_automatico" = true;
