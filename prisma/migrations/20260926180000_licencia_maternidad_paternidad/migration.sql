-- LICENCIA DE MATERNIDAD / PATERNIDAD.
--
-- Mismo patrón que las vacaciones: dos fechas, un interruptor y el importe
-- derivado. Los DÍAS no se guardan —salen de restar las fechas, con el de
-- inicio incluido— porque un número guardado que no cuadre con sus propias
-- fechas es un dato que miente.
--
-- Las fechas van como VarChar `YYYY-MM-DD`, que es como ya viajan las de
-- vacaciones y las de incapacidad en esta tabla.
--
-- `total_licencia` se guarda aunque sea derivado porque es lo que imprime el
-- desprendible, igual que `total_vacaciones`.
ALTER TABLE "liquidaciones"
  ADD COLUMN "aplica_licencia"         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "periodo_start_licencia"  VARCHAR(255),
  ADD COLUMN "periodo_end_licencia"    VARCHAR(255),
  ADD COLUMN "total_licencia"          DECIMAL(10,2) NOT NULL DEFAULT 0;
