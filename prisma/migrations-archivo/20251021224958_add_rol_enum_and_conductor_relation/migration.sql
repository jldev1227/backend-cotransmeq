/*
  Warnings:

  - You are about to drop the column `empresa_id` on the `bonificaciones` table. All the data in the column will be lost.
  - You are about to drop the column `password` on the `conductores` table. All the data in the column will be lost.
  - You are about to drop the column `empresa_id` on the `mantenimientos` table. All the data in the column will be lost.
  - You are about to drop the column `empresa_id` on the `pernotes` table. All the data in the column will be lost.
  - You are about to drop the column `empresa_id` on the `recargos` table. All the data in the column will be lost.
  - You are about to drop the `Usuario` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `empresas` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[usuarioId]` on the table `conductores` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `usuarioId` to the `conductores` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "Rol" AS ENUM ('ADMIN', 'GESTOR', 'CONDUCTOR', 'USER');

-- DropForeignKey
ALTER TABLE "anticipos" DROP CONSTRAINT "anticipos_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "bonificaciones" DROP CONSTRAINT "bonificaciones_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "bonificaciones" DROP CONSTRAINT "bonificaciones_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidaciones" DROP CONSTRAINT "liquidaciones_actualizado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidaciones" DROP CONSTRAINT "liquidaciones_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidaciones" DROP CONSTRAINT "liquidaciones_liquidado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "mantenimientos" DROP CONSTRAINT "mantenimientos_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "pernotes" DROP CONSTRAINT "pernotes_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "pernotes" DROP CONSTRAINT "pernotes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "pernotes" DROP CONSTRAINT "pernotes_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "recargos" DROP CONSTRAINT "recargos_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "recargos" DROP CONSTRAINT "recargos_empresa_id_fkey";

-- DropForeignKey
ALTER TABLE "servicios" DROP CONSTRAINT "servicios_cliente_id_fkey";

-- AlterTable
ALTER TABLE "anticipos" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "bonificaciones" DROP COLUMN "empresa_id",
ADD COLUMN     "cliente_id" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "conductores" DROP COLUMN "password",
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "usuarioId" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "mantenimientos" DROP COLUMN "empresa_id",
ADD COLUMN     "cliente_id" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "municipios" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "pernotes" DROP COLUMN "empresa_id",
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "recargos" DROP COLUMN "empresa_id",
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "deletedAt" TIMESTAMP(3),
ALTER COLUMN "cliente_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "vehiculos" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- DropTable
DROP TABLE "Usuario";

-- DropTable
DROP TABLE "empresas";

-- CreateTable
CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "telefono" TEXT,
    "correo" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "rol" "Rol" NOT NULL DEFAULT 'USER',
    "permisos" JSONB,
    "ultimoAcceso" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "usuarios_correo_key" ON "usuarios"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "conductores_usuarioId_key" ON "conductores"("usuarioId");

-- AddForeignKey
ALTER TABLE "conductores" ADD CONSTRAINT "conductores_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_liquidado_por_id_fkey" FOREIGN KEY ("liquidado_por_id") REFERENCES "usuarios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
