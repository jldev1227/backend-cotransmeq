-- Las tablas de recargo del desprendible salen por defecto.
--
-- `liquidaciones.mostrar_recargos` es el interruptor que decide si el
-- comprobante imprime el detalle de recargos por planilla. Nació con
-- DEFAULT false, así que toda liquidación creada desde el canvas —que no
-- toca el campo— salía sin esas páginas: el conductor recibía un
-- desprendible con «Otros … $ X» y ninguna tabla que lo respaldara.
--
-- Cuántas estaban así cuando se escribió esto:
--
--   cotransmeq    65 de 101   (el canvas nunca lo enciende)
--   transmeralda   3 de 601   (ahí el formulario sí lo pone en true)
--
-- Se cambia el DEFAULT y se rellenan las existentes. El false no distinguía
-- «nadie lo tocó» de «alguien lo apagó», y en cotransmeq la inmensa mayoría
-- es lo primero; las tres de transmeralda se revisan a mano si hiciera falta.
-- El interruptor SIGUE EXISTIENDO: quien quiera ocultar el detalle lo apaga
-- desde la liquidación, y a partir de ahora eso es una decisión, no el
-- estado por defecto.
--
-- `desprendible_visible` NO se toca: es otra cosa —si el conductor puede ver
-- el desprendible— y su defecto en false es deliberado.
--
-- Idempotente y en una transacción. Escrita a mano y NO aplicada por `prisma
-- migrate dev`: el historial de migraciones de este proyecto está desalineado
-- con la base real y `dev` / `deploy` ofrecen un reset que vacía tablas. Se
-- aplica con psql dentro de la transacción de abajo y después se marca con
-- `prisma migrate resolve --applied 20260924210000_mostrar_recargos_por_defecto`.

BEGIN;

ALTER TABLE "liquidaciones" ALTER COLUMN "mostrar_recargos" SET DEFAULT true;

UPDATE "liquidaciones" SET "mostrar_recargos" = true WHERE "mostrar_recargos" = false;

COMMIT;
