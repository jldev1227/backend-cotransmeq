ALTER TABLE "liquidacion_tercero_final_concepto"
  ADD COLUMN IF NOT EXISTS "dividir_igual_propietarios" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "liquidacion_tercero_final_propietario"
  ADD COLUMN IF NOT EXISTS "exento_impuestos" BOOLEAN NOT NULL DEFAULT false;
