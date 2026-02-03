/*
  Warnings:

  - Added the required column `nombre` to the `Usuario` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "nombre" TEXT NOT NULL DEFAULT 'Usuario',
ADD COLUMN     "telefono" TEXT;

-- Update existing records to have a proper name based on email
UPDATE "Usuario" SET "nombre" = SPLIT_PART("correo", '@', 1) WHERE "nombre" = 'Usuario';

-- Remove the default after updating existing records
ALTER TABLE "Usuario" ALTER COLUMN "nombre" DROP DEFAULT;
