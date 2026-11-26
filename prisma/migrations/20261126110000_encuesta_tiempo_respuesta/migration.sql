-- Las respuestas históricas no tienen una hora de apertura verificable.
ALTER TABLE "encuesta_respuesta"
  ADD COLUMN IF NOT EXISTS "tiempo_respuesta_segundos" INTEGER;
