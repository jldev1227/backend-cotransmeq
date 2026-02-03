-- Agregar campos de evento si no existen
ALTER TABLE "formularios_asistencia" 
  ADD COLUMN IF NOT EXISTS "hora_inicio" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "hora_finalizacion" VARCHAR(5),
  ADD COLUMN IF NOT EXISTS "duracion_minutos" INTEGER,
  ADD COLUMN IF NOT EXISTS "tipo_evento" VARCHAR(50) DEFAULT 'capacitacion',
  ADD COLUMN IF NOT EXISTS "tipo_evento_otro" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "lugar_sede" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "nombre_instructor" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "observaciones" TEXT;

-- Crear índice para tipo_evento si no existe
CREATE INDEX IF NOT EXISTS "formularios_asistencia_tipo_evento_idx" ON "formularios_asistencia"("tipo_evento");

-- Agregar comentarios
COMMENT ON COLUMN "formularios_asistencia"."hora_inicio" IS 'Hora de inicio del evento (formato HH:MM)';
COMMENT ON COLUMN "formularios_asistencia"."hora_finalizacion" IS 'Hora de finalización del evento (formato HH:MM)';
COMMENT ON COLUMN "formularios_asistencia"."duracion_minutos" IS 'Duración del evento en minutos';
COMMENT ON COLUMN "formularios_asistencia"."tipo_evento" IS 'Tipo de evento: capacitacion, asesoria, charla, induccion, reunion, divulgacion, otro';
COMMENT ON COLUMN "formularios_asistencia"."tipo_evento_otro" IS 'Descripción del tipo de evento cuando se selecciona "otro"';
COMMENT ON COLUMN "formularios_asistencia"."lugar_sede" IS 'Lugar o sede donde se realiza el evento';
COMMENT ON COLUMN "formularios_asistencia"."nombre_instructor" IS 'Nombre del instructor o facilitador del evento';
COMMENT ON COLUMN "formularios_asistencia"."observaciones" IS 'Observaciones generales del evento o capacitación';
