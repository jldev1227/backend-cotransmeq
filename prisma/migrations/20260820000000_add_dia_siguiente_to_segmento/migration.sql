-- Agrega flags de día siguiente al segmento (tramo) de un día laborado.
-- Necesarios para que la validación de horario (hora_fin > hora_inicio)
-- considere correctamente turnos que cruzan medianoche, y para que el
-- indicador "+1" del portal de conductores sobreviva a una edición.
--
-- Idempotente: se puede ejecutar varias veces sin error.
ALTER TABLE "registro_dia_laboral_segmento"
  ADD COLUMN IF NOT EXISTS "inicio_dia_siguiente" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "fin_dia_siguiente"    BOOLEAN NOT NULL DEFAULT false;
