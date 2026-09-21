-- Pernocte de un día SIN recorridos.
--
-- El pernocte de una jornada con viajes vive en el segmento
-- (`registro_dia_laboral_segmento.pernocte`), porque se pernocta EN un
-- recorrido. Pero un día de DISPONIBLE o DESCANSO fuera de base también se
-- pernocta, y esos días no tienen segmento donde colgarlo. En el canvas de
-- recorridos son más de la mitad de las filas de un corte —86 de 147 en el
-- periodo 21-ago/20-sep— y en todas ellas la casilla PERNOTE se pintaba pero
-- no se podía marcar: el clic moría con un «esta celda no se edita aquí».
--
-- No se unifican las dos columnas. Mover el pernocte del segmento al día
-- perdería el detalle de QUÉ tramo lo causó en las jornadas con varios
-- recorridos, que es justo lo que se mira cuando alguien reclama uno.
--
-- Aditiva e idempotente. Escrita a mano y NO aplicada por `prisma migrate
-- dev`: el historial de migraciones de este proyecto está desalineado con la
-- base real y `dev` / `deploy` ofrecen un reset que vacía tablas. Se aplica
-- con psql dentro de la transacción de abajo y después se marca con
-- `prisma migrate resolve --applied 20260921160000_pernocte_dia_sin_recorridos`.

BEGIN;

ALTER TABLE "registro_dia_laboral"
  ADD COLUMN IF NOT EXISTS "pernocte" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
