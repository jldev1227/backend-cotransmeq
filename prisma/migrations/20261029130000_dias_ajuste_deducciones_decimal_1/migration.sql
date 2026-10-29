-- La fracción del ajuste a la base admite una cifra decimal, por ejemplo 13.5.
ALTER TABLE "liquidaciones"
  ALTER COLUMN "dias_ajuste_deducciones"
  TYPE DECIMAL(12, 1)
  USING "dias_ajuste_deducciones"::DECIMAL(12, 1);
