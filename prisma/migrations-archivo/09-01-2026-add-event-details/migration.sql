-- AlterTable: Agregar nuevos campos a formularios_asistencia
ALTER TABLE "formularios_asistencia" 
  RENAME COLUMN "descripcion" TO "objetivo";

ALTER TABLE "formularios_asistencia" 
  ADD COLUMN IF NOT EXISTS "hora_inicio" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "hora_finalizacion" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "duracion_minutos" INTEGER,
  ADD COLUMN IF NOT EXISTS "tipo_evento" VARCHAR(50) DEFAULT 'capacitacion' NOT NULL,
  ADD COLUMN IF NOT EXISTS "tipo_evento_otro" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "lugar_sede" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "nombre_instructor" VARCHAR(255);

-- Crear índice para tipo_evento
CREATE INDEX IF NOT EXISTS "formularios_asistencia_tipo_evento_idx" ON "formularios_asistencia"("tipo_evento");
