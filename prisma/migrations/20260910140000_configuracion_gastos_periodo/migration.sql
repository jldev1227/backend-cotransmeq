-- Valores de partida de los gastos de vehículo calculados, por PERIODO.
--
-- Papelería y gastos diversos vivían como constantes de código
-- (`reglas-conceptos.ts`), iguales para todos los meses. Son tarifas del
-- negocio y cambian, así que pasan a configurarse mes a mes.
--
-- Una fila POR MES y no por año: el porcentaje de gastos diversos se negocia
-- periodo a periodo, y un cierre de julio tiene que seguir liquidándose con lo
-- que valía en julio aunque en agosto cambie.
--
-- La tabla nace VACÍA a propósito. `obtenerConfigGastosPeriodo` cae a los
-- valores de código cuando el mes no tiene fila, que son los que han regido
-- hasta ahora: mientras nadie configure nada, el cálculo no cambia. Sembrarla
-- con doce filas por año daría la falsa impresión de que alguien las revisó.
--
-- Escrita a mano y NO aplicada por `prisma migrate dev`: el historial de
-- migraciones de este proyecto está desalineado con la base real y `dev` /
-- `deploy` ofrecen un reset que vacía tablas. Se aplica ejecutando este SQL en
-- una transacción y marcándolo después con `prisma migrate resolve --applied`.

BEGIN;

CREATE TABLE IF NOT EXISTS "configuracion_gastos_periodo" (
  "id"                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "anio"                 INTEGER      NOT NULL,
  "mes"                  INTEGER      NOT NULL,

  -- En puntos porcentuales: 0.4 es 0,4 %.
  "pct_gastos_diversos"  DECIMAL(8,4)  NOT NULL DEFAULT 0.4,
  "fijo_gastos_diversos" DECIMAL(12,2) NOT NULL DEFAULT 20000,

  -- Tarifa por tramo. El umbral se compara contra `valor_liquidar` del cierre
  -- (la suma de los items, ANTES de descuentos), no contra el total a pagar:
  -- papelería es un descuento y sobre el total oscilaría.
  "papeleria_alta"       DECIMAL(12,2) NOT NULL DEFAULT 25000,
  "papeleria_baja"       DECIMAL(12,2) NOT NULL DEFAULT 20000,
  "papeleria_umbral"     DECIMAL(14,2) NOT NULL DEFAULT 1000000,

  "actualizado_por_id"   UUID,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"           TIMESTAMPTZ(6),

  CONSTRAINT "configuracion_gastos_periodo_actualizado_por_id_fkey"
    FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

-- Un periodo, una configuración. El upsert del PUT se apoya en esta unicidad.
CREATE UNIQUE INDEX IF NOT EXISTS "configuracion_gastos_periodo_anio_mes_key"
  ON "configuracion_gastos_periodo" ("anio", "mes");

CREATE INDEX IF NOT EXISTS "configuracion_gastos_periodo_anio_mes_idx"
  ON "configuracion_gastos_periodo" ("anio", "mes");
CREATE INDEX IF NOT EXISTS "configuracion_gastos_periodo_deleted_at_idx"
  ON "configuracion_gastos_periodo" ("deleted_at");

COMMIT;
