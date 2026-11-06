ALTER TABLE "liquidacion_tercero_final_concepto"
  ADD COLUMN "dividir_igual_propietarios" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "liquidacion_tercero_final_propietario"
  ADD COLUMN "exento_impuestos" BOOLEAN NOT NULL DEFAULT false;
