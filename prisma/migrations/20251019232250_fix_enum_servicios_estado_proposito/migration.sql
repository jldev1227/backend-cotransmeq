/*
  Warnings:

  - The values [asignado,completado] on the enum `EstadoServicio` will be removed. If these variants are still used in the database, this will fail.
  - The values [empresarial,medico,aeropuerto] on the enum `PropositoServicio` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "EstadoServicio_new" AS ENUM ('en_curso', 'pendiente', 'realizado', 'cancelado', 'planificado', 'solicitado', 'planilla_asignada', 'liquidado');
ALTER TABLE "servicios" ALTER COLUMN "estado" DROP DEFAULT;
ALTER TABLE "servicios" ALTER COLUMN "estado" TYPE "EstadoServicio_new" USING ("estado"::text::"EstadoServicio_new");
ALTER TYPE "EstadoServicio" RENAME TO "EstadoServicio_old";
ALTER TYPE "EstadoServicio_new" RENAME TO "EstadoServicio";
DROP TYPE "EstadoServicio_old";
ALTER TABLE "servicios" ALTER COLUMN "estado" SET DEFAULT 'solicitado';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PropositoServicio_new" AS ENUM ('personal', 'personal_y_herramienta');
ALTER TABLE "servicios" ALTER COLUMN "proposito_servicio" DROP DEFAULT;
ALTER TABLE "servicios" ALTER COLUMN "proposito_servicio" TYPE "PropositoServicio_new" USING ("proposito_servicio"::text::"PropositoServicio_new");
ALTER TYPE "PropositoServicio" RENAME TO "PropositoServicio_old";
ALTER TYPE "PropositoServicio_new" RENAME TO "PropositoServicio";
DROP TYPE "PropositoServicio_old";
ALTER TABLE "servicios" ALTER COLUMN "proposito_servicio" SET DEFAULT 'personal';
COMMIT;
