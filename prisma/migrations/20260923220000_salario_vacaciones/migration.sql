-- Salario sobre el que se liquidan las vacaciones.
--
-- Las vacaciones no siempre se pagan sobre el básico vigente: se liquidan sobre
-- el promedio del último año, o sobre lo pactado, y ese número no está en
-- ninguna parte del sistema. Hasta ahora `total_vacaciones` se tecleaba entero
-- y el criterio con el que salió se perdía.
--
-- Nullable a propósito: `NULL` significa «usa el básico del tramo», que es el
-- comportamiento de siempre para las liquidaciones que ya existen.
ALTER TABLE "liquidaciones"
    ADD COLUMN IF NOT EXISTS "salario_vacaciones" DECIMAL(10,2);
