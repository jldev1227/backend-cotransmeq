-- Descripción del servicio, obligatoria por tramo de recorrido.
--
-- Sustituye a `observaciones` en el TRAMO (`registro_dia_laboral_segmento`).
-- No toca las otras dos columnas con ese mismo nombre, que son de cosas
-- distintas y siguen siendo opcionales:
--
--   • `registro_dia_laboral.observaciones`       → nota del DÍA. Es lo único
--     que llevan los días de DESCANSO y MANTENIMIENTO, que no tienen tramo.
--   • `registro_dia_laboral_bono.observaciones`  → por qué se otorgó un bono.
--
-- El cambio es de fondo, no de nombre: `observaciones` era un campo libre y
-- opcional, y la descripción del servicio es el dato que dice QUÉ se transportó
-- en ese tramo. Por eso queda NOT NULL.
--
-- Qué hace con lo que ya existe:
--
--   1. Crea la columna nullable.
--   2. Copia el texto de `observaciones` del tramo cuando lo haya. En las dos
--      bases locales revisadas los 259 tramos la tienen en NULL, pero esto no
--      se puede dar por hecho en producción, así que no se descarta nada.
--   3. Lo que quede sin texto recibe el centinela 'Sin descripción registrada'.
--      Es deliberadamente legible: son las filas que alguien tiene que repasar,
--      y con un `WHERE descripcion_servicio = 'Sin descripción registrada'` se
--      listan en cualquier momento.
--   4. Pone NOT NULL y retira `observaciones` del tramo.
--
-- Solo entonces se retira la columna vieja: si el paso 2 no hubiera corrido,
-- `DROP COLUMN` perdería texto escrito por los conductores.
--
-- Idempotente y en una transacción. Escrita a mano y NO aplicada por `prisma
-- migrate dev`: el historial de migraciones de este proyecto está desalineado
-- con la base real y `dev` / `deploy` ofrecen un reset que vacía tablas. Se
-- aplica con psql dentro de la transacción de abajo y después se marca con
-- `prisma migrate resolve --applied 20260922210000_descripcion_servicio_tramo`.

BEGIN;

ALTER TABLE "registro_dia_laboral_segmento"
  ADD COLUMN IF NOT EXISTS "descripcion_servicio" TEXT;

-- El traspaso y el DROP van juntos y bajo la misma condición: si la columna
-- vieja ya no está, esta migración ya corrió y no hay nada que mover.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name   = 'registro_dia_laboral_segmento'
       AND column_name  = 'observaciones'
  ) THEN
    UPDATE "registro_dia_laboral_segmento"
       SET "descripcion_servicio" = NULLIF(btrim("observaciones"), '')
     WHERE "descripcion_servicio" IS NULL;

    ALTER TABLE "registro_dia_laboral_segmento" DROP COLUMN "observaciones";
  END IF;
END $$;

UPDATE "registro_dia_laboral_segmento"
   SET "descripcion_servicio" = 'Sin descripción registrada'
 WHERE "descripcion_servicio" IS NULL
    OR btrim("descripcion_servicio") = '';

ALTER TABLE "registro_dia_laboral_segmento"
  ALTER COLUMN "descripcion_servicio" SET NOT NULL;

COMMIT;
