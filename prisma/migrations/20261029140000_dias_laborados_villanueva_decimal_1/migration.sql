-- El bono de nivelación puede cubrir una fracción de día, por ejemplo 13.5.
ALTER TABLE "liquidaciones"
  ALTER COLUMN "dias_laborados_villanueva"
  TYPE DECIMAL(12, 1)
  USING "dias_laborados_villanueva"::DECIMAL(12, 1);
