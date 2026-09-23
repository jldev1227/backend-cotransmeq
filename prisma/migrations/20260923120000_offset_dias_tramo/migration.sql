-- Días de desfase de un tramo, como número en vez de como sí/no.
--
-- `inicio_dia_siguiente` y `fin_dia_siguiente` eran BOOLEAN: solo sabían decir
-- «mismo día» o «el siguiente». El «+1» que salía en pantalla no se entendía, y
-- al querer escribirlo en palabras —«2 días después»— resultó que el dato no
-- existía: la columna no lo podía representar.
--
-- Pasan a INTEGER con el número de días:
--
--   false → 0   (mismo día)
--   true  → 1   (el día siguiente)
--
-- La conversión no pierde nada: todo lo que era `true` cabe en el 1. En las
-- bases revisadas hay 1 tramo con inicio al día siguiente y 25 con fin al día
-- siguiente, todos en cotransmeq.
--
-- El tope lo pone la validación, no la columna: se aceptan 0, 1 y 2. En la
-- operación un tramo nunca cruza más de una medianoche, y el 2 está solo para
-- que un caso raro no quede sin poder registrarse. Sin tope, un dedo torcido
-- convierte un turno en uno de sesenta días.
--
-- Idempotente y en una transacción. Escrita a mano y NO aplicada por `prisma
-- migrate dev`: el historial de migraciones de este proyecto está desalineado
-- con la base real y `dev` / `deploy` ofrecen un reset que vacía tablas. Se
-- aplica con psql dentro de la transacción de abajo y después se marca con
-- `prisma migrate resolve --applied 20260923120000_offset_dias_tramo`.

BEGIN;

ALTER TABLE "registro_dia_laboral_segmento"
  ADD COLUMN IF NOT EXISTS "dias_offset_inicio" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "dias_offset_fin"    INTEGER NOT NULL DEFAULT 0;

-- El traspaso y el DROP van juntos y bajo la misma condición: si las columnas
-- viejas ya no están, esta migración ya corrió y no hay nada que convertir.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = current_schema()
       AND table_name   = 'registro_dia_laboral_segmento'
       AND column_name  = 'inicio_dia_siguiente'
  ) THEN
    UPDATE "registro_dia_laboral_segmento"
       SET "dias_offset_inicio" = CASE WHEN "inicio_dia_siguiente" THEN 1 ELSE 0 END,
           "dias_offset_fin"    = CASE WHEN "fin_dia_siguiente"    THEN 1 ELSE 0 END;

    ALTER TABLE "registro_dia_laboral_segmento"
      DROP COLUMN "inicio_dia_siguiente",
      DROP COLUMN "fin_dia_siguiente";
  END IF;
END $$;

-- La guarda también en la base y no solo en el DTO: el canvas y la carga por
-- lote escriben por caminos distintos, y basta que uno se salte la validación
-- para meter un desfase absurdo que después nadie entiende de dónde salió.
ALTER TABLE "registro_dia_laboral_segmento"
  DROP CONSTRAINT IF EXISTS "chk_segmento_offset_dias";
ALTER TABLE "registro_dia_laboral_segmento"
  ADD CONSTRAINT "chk_segmento_offset_dias"
  CHECK (
    "dias_offset_inicio" BETWEEN 0 AND 2
    AND "dias_offset_fin" BETWEEN 0 AND 2
    AND "dias_offset_fin" >= "dias_offset_inicio"
  );

-- `chk_segmento_horas` daba por hecho que un tramo empieza y termina el mismo
-- día: exigía `pernocte` para que la hora de fin pudiera ser menor que la de
-- inicio. Eso mezclaba dos cosas distintas — pernoctar es dormir fuera de base,
-- no cruzar la medianoche — y dejaba sin registrar un turno de 18:00 a 06:00 en
-- el que el conductor volvió a casa. Con el desfase en días la regla se puede
-- escribir bien.
--
-- Solo se toca si ya existía: en cotransmeq esta CHECK nunca se creó, y
-- añadírsela aquí sería cambiarle el comportamiento de paso.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'registro_dia_laboral_segmento'::regclass
       AND conname  = 'chk_segmento_horas'
  ) THEN
    ALTER TABLE "registro_dia_laboral_segmento" DROP CONSTRAINT "chk_segmento_horas";
    ALTER TABLE "registro_dia_laboral_segmento"
      ADD CONSTRAINT "chk_segmento_horas"
      CHECK (
        "pernocte" = true
        OR "dias_offset_fin" > "dias_offset_inicio"
        OR "hora_fin" > "hora_inicio"
      );
  END IF;
END $$;

COMMIT;
