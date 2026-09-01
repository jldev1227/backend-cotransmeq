-- AlterTable
ALTER TABLE "acciones_correctivas_preventivas" 
ALTER COLUMN "requiere_actualizar_matriz" DROP DEFAULT,
ALTER COLUMN "requiere_actualizar_matriz" TYPE BOOLEAN USING CASE 
  WHEN "requiere_actualizar_matriz" IS NULL THEN NULL
  WHEN "requiere_actualizar_matriz" = 'true' OR "requiere_actualizar_matriz" = 't' OR "requiere_actualizar_matriz" = 'yes' OR "requiere_actualizar_matriz" = 'sí' OR "requiere_actualizar_matriz" = '1' THEN TRUE
  ELSE FALSE
END,
ALTER COLUMN "requiere_actualizar_matriz" SET DEFAULT false;
