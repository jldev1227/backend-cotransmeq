ALTER TABLE "liquidacion_tercero_final"
ADD COLUMN "novedades_conductores" JSONB NOT NULL DEFAULT '{}'::jsonb;
