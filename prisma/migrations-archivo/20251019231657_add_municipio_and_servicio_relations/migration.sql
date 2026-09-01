/*
  Warnings:

  - Added the required column `destino_id` to the `servicios` table without a default value. This is not possible if the table is not empty.
  - Added the required column `origen_id` to the `servicios` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TipoMunicipio" AS ENUM ('Municipio', 'Isla', 'Area_no_municipalizada');

-- AlterTable
ALTER TABLE "servicios" ADD COLUMN     "destino_id" TEXT NOT NULL,
ADD COLUMN     "origen_id" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "municipios" (
    "id" TEXT NOT NULL,
    "codigo_departamento" INTEGER NOT NULL,
    "nombre_departamento" TEXT NOT NULL,
    "codigo_municipio" INTEGER NOT NULL,
    "nombre_municipio" TEXT NOT NULL,
    "tipo" "TipoMunicipio" NOT NULL,
    "longitud" DECIMAL(10,6) NOT NULL,
    "latitud" DECIMAL(10,6) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "municipios_codigo_municipio_key" ON "municipios"("codigo_municipio");

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_origen_id_fkey" FOREIGN KEY ("origen_id") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "municipios"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
