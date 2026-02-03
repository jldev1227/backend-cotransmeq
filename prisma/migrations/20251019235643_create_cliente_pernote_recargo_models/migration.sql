-- CreateEnum
CREATE TYPE "TipoCliente" AS ENUM ('EMPRESA', 'PERSONA');

-- CreateEnum
CREATE TYPE "EstadoLiquidacion" AS ENUM ('PENDIENTE', 'LIQUIDADO');

-- CreateTable
CREATE TABLE "clientes" (
    "id" TEXT NOT NULL,
    "tipo" "TipoCliente" NOT NULL DEFAULT 'EMPRESA',
    "nit" TEXT,
    "nombre" TEXT NOT NULL,
    "representante" TEXT,
    "cedula" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "correo" TEXT,
    "requiere_osi" BOOLEAN NOT NULL DEFAULT false,
    "paga_recargos" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "clientes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pernotes" (
    "id" TEXT NOT NULL,
    "cantidad" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "fechas" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cliente_id" TEXT,
    "vehiculo_id" TEXT,
    "liquidacion_id" TEXT,
    "creado_por_id" TEXT,
    "empresa_id" TEXT,

    CONSTRAINT "pernotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recargos" (
    "id" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "pag_cliente" BOOLEAN,
    "mes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "cliente_id" TEXT,
    "vehiculo_id" TEXT,
    "liquidacion_id" TEXT,
    "empresa_id" TEXT,

    CONSTRAINT "recargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificaciones" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '[]',
    "value" DECIMAL(10,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "liquidacion_id" TEXT,
    "vehiculo_id" TEXT,
    "creado_por_id" TEXT,
    "empresa_id" TEXT,

    CONSTRAINT "bonificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anticipos" (
    "id" TEXT NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "concepto" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "liquidacion_id" TEXT,
    "conductor_id" TEXT,
    "creado_por_id" TEXT,

    CONSTRAINT "anticipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones" (
    "id" TEXT NOT NULL,
    "periodoStart" TIMESTAMP(3) NOT NULL,
    "periodoEnd" TIMESTAMP(3) NOT NULL,
    "auxilioTransporte" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "sueldoTotal" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "salarioDevengado" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalPernotes" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalBonificaciones" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalRecargos" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalAnticipos" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "totalVacaciones" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "periodoStartVacaciones" TIMESTAMP(3),
    "periodoEndVacaciones" TIMESTAMP(3),
    "periodoStartIncapacidad" TIMESTAMP(3),
    "periodoEndIncapacidad" TIMESTAMP(3),
    "diasLaborados" INTEGER NOT NULL DEFAULT 0,
    "diasLaboradosVillanueva" INTEGER NOT NULL DEFAULT 0,
    "diasLaboradosAnual" INTEGER NOT NULL DEFAULT 0,
    "ajusteSalarial" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "ajusteParex" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "ajusteSalarialPorDia" BOOLEAN NOT NULL DEFAULT false,
    "valorIncapacidad" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "salud" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "pension" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "cesantias" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "interesCesantias" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "estado" "EstadoLiquidacion" NOT NULL DEFAULT 'PENDIENTE',
    "fechaLiquidacion" TIMESTAMP(3),
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conductor_id" TEXT,
    "creado_por_id" TEXT,
    "actualizado_por_id" TEXT,
    "liquidado_por_id" TEXT,

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_vehiculo" (
    "id" TEXT NOT NULL,
    "liquidacion_id" TEXT NOT NULL,
    "vehiculo_id" TEXT NOT NULL,

    CONSTRAINT "liquidacion_vehiculo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mantenimientos" (
    "id" TEXT NOT NULL,
    "values" JSONB NOT NULL DEFAULT '[]',
    "value" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vehiculo_id" TEXT,
    "liquidacion_id" TEXT,
    "empresa_id" TEXT,

    CONSTRAINT "mantenimientos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clientes_nit_key" ON "clientes"("nit");

-- CreateIndex
CREATE UNIQUE INDEX "clientes_correo_key" ON "clientes"("correo");

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_vehiculo_liquidacion_id_vehiculo_id_key" ON "liquidacion_vehiculo"("liquidacion_id", "vehiculo_id");

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "clientes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_liquidado_por_id_fkey" FOREIGN KEY ("liquidado_por_id") REFERENCES "Usuario"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_vehiculo" ADD CONSTRAINT "liquidacion_vehiculo_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_vehiculo" ADD CONSTRAINT "liquidacion_vehiculo_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
