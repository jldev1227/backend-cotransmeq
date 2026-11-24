-- El bono de nivelación permite hasta dos decimales de día, por ejemplo 12.25.
ALTER TABLE "liquidaciones"
  ALTER COLUMN "dias_laborados_villanueva"
  TYPE DECIMAL(12, 2)
  USING "dias_laborados_villanueva"::DECIMAL(12, 2);
