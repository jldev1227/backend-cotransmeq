-- RECOMENDACIONES DEL CONDUCTOR AL TERMINAR EL SERVICIO.
--
-- Después de liberar, la app felicita al conductor y le pide —opcional—
-- recomendaciones u observaciones sobre el servicio. Es aparte de `novedades`,
-- que es el reporte del recorrido que acompaña la liberación.
--
-- `recomendaciones_at`: cuándo llegó al servidor; se reescribe si el conductor
-- la corrige.
--
-- Aditiva: dos columnas nulas. Ningún dato existente cambia.
ALTER TABLE "servicio_ejecucion" ADD COLUMN IF NOT EXISTS "recomendaciones" TEXT;
ALTER TABLE "servicio_ejecucion" ADD COLUMN IF NOT EXISTS "recomendaciones_at" TIMESTAMPTZ(6);
