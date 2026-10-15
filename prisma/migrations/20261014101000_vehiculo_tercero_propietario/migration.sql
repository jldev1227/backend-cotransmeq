ALTER TABLE "vehiculos" ADD COLUMN "tercero_propietario_id" UUID;
UPDATE "vehiculos" AS v
SET "tercero_propietario_id" = t."id"
FROM "terceros" AS t
WHERE v."propietario_identificacion" IS NOT NULL
  AND t."deleted_at" IS NULL
  AND regexp_replace(v."propietario_identificacion", '[^0-9A-Za-z]', '', 'g') =
      regexp_replace(t."identificacion", '[^0-9A-Za-z]', '', 'g');
CREATE INDEX "vehiculos_tercero_propietario_id_idx" ON "vehiculos"("tercero_propietario_id");
ALTER TABLE "vehiculos"
  ADD CONSTRAINT "vehiculos_tercero_propietario_id_fkey"
  FOREIGN KEY ("tercero_propietario_id") REFERENCES "terceros"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
