-- AlterTable
ALTER TABLE "Usuario" ADD COLUMN     "permisos" JSONB,
ADD COLUMN     "ultimoAcceso" TIMESTAMP(3);
