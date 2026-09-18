-- Traslado de un item del cierre de placa a OTRO documento del mismo tercero.
--
-- Un item del pivote (`liquidacion_tercero_final_item`) puede QUITARSE del
-- cierre desde «Filas del cierre → Items». Hasta ahora quitarlo era solo eso:
-- el item dejaba de sumar y se quedaba huérfano hasta que alguien lo
-- devolviera. Ahora puede además TRASLADARSE a uno de dos sitios:
--
--   OCASIONAL  → entra como item de la liquidación ocasional del mismo
--                periodo del cierre (`liquidacion_tercero_ocasional_item`).
--   INGRESOS   → su fila de la hoja de ingresos queda marcada INCLUIR
--                (`liquidacion_ingreso_transmeralda_fila.incluir_adicional`),
--                con lo que baja a la hoja de ADICIONALES.
--
-- La marca vive en el PIVOTE y no se deriva de las otras dos tablas a
-- propósito: es la única forma de que «Devolver al cierre» sepa qué deshacer
-- en el otro lado, y de distinguir un item quitado a mano de uno trasladado.
--
-- Aditiva e idempotente. Escrita a mano y NO aplicada por `prisma migrate
-- dev`: el historial de migraciones de este proyecto está desalineado con la
-- base real y `dev` / `deploy` ofrecen un reset que vacía tablas. Se aplica
-- ejecutando este SQL en una transacción y marcándolo después con
-- `prisma migrate resolve --applied 20260918120000_traslado_items_cierre`.

BEGIN;

ALTER TABLE "liquidacion_tercero_final_item"
  ADD COLUMN IF NOT EXISTS "trasladado_a"      VARCHAR(20),
  ADD COLUMN IF NOT EXISTS "trasladado_at"     TIMESTAMPTZ(6),
  ADD COLUMN IF NOT EXISTS "trasladado_por_id" UUID;

-- Solo dos destinos. Un valor fuera de la lista no tendría quién lo
-- revirtiera.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lt_final_item_trasladado_a'
  ) THEN
    ALTER TABLE "liquidacion_tercero_final_item"
      ADD CONSTRAINT "chk_lt_final_item_trasladado_a"
      CHECK ("trasladado_a" IS NULL OR "trasladado_a" IN ('OCASIONAL', 'INGRESOS'));
  END IF;
END $$;

-- El modelo Prisma `usuarios` mapea a la tabla `users`.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'lt_final_item_trasladado_por_fkey'
  ) THEN
    ALTER TABLE "liquidacion_tercero_final_item"
      ADD CONSTRAINT "lt_final_item_trasladado_por_fkey"
      FOREIGN KEY ("trasladado_por_id") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- Un trasladado es siempre un quitado: la fila lleva `deleted_at`. Este índice
-- parcial es el que usa el modal para listar «Quitados del cierre» sin
-- recorrer los vivos, que son la mayoría.
CREATE INDEX IF NOT EXISTS "idx_lt_final_item_trasladado"
  ON "liquidacion_tercero_final_item" ("liquidacion_tercero_final_id", "trasladado_a")
  WHERE "trasladado_a" IS NOT NULL;

COMMIT;
