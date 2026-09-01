-- Agregar columnas manuales para registro de prima
ALTER TABLE "primas" ADD COLUMN IF NOT EXISTS "tiempo_trabajado_dias" INTEGER;
ALTER TABLE "primas" ADD COLUMN IF NOT EXISTS "sueldo_basico" DECIMAL(10, 2);
ALTER TABLE "primas" ADD COLUMN IF NOT EXISTS "auxilio_transporte" DECIMAL(10, 2);
ALTER TABLE "primas" ADD COLUMN IF NOT EXISTS "sueldo_variable" DECIMAL(10, 2);
ALTER TABLE "primas" ADD COLUMN IF NOT EXISTS "total_base_liquidacion" DECIMAL(10, 2);
