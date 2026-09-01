-- CreateEnum
CREATE TYPE "EstadoVehiculo" AS ENUM ('DISPONIBLE', 'SERVICIO', 'MANTENIMIENTO', 'DESVINCULADO');

-- CreateEnum
CREATE TYPE "EstadoConductor" AS ENUM ('servicio', 'disponible', 'descanso', 'vacaciones', 'incapacidad', 'desvinculado');

-- CreateEnum
CREATE TYPE "SedeTrabajo" AS ENUM ('YOPAL', 'VILLANUEVA', 'TAURAMENA');

-- CreateEnum
CREATE TYPE "TipoSangre" AS ENUM ('A_plus', 'A_minus', 'B_plus', 'B_minus', 'AB_plus', 'AB_minus', 'O_plus', 'O_minus');

-- CreateEnum
CREATE TYPE "EstadoServicio" AS ENUM ('solicitado', 'asignado', 'en_curso', 'completado', 'cancelado');

-- CreateEnum
CREATE TYPE "PropositoServicio" AS ENUM ('personal', 'empresarial', 'medico', 'aeropuerto');

-- CreateTable
CREATE TABLE "conductores" (
    "id" TEXT NOT NULL,
    "nombre" TEXT,
    "apellido" TEXT,
    "tipo_identificacion" TEXT NOT NULL DEFAULT 'CC',
    "numero_identificacion" TEXT,
    "email" TEXT,
    "telefono" TEXT,
    "password" TEXT,
    "fecha_nacimiento" TIMESTAMP(3),
    "genero" TEXT,
    "direccion" TEXT,
    "fecha_ingreso" TIMESTAMP(3),
    "salario_base" DECIMAL(10,2),
    "estado" "EstadoConductor" NOT NULL DEFAULT 'disponible',
    "eps" TEXT,
    "fondo_pension" TEXT,
    "arl" TEXT,
    "termino_contrato" TEXT,
    "fecha_terminacion" TEXT,
    "licencia_conduccion" JSONB,
    "ultimo_acceso" TIMESTAMP(3),
    "sede_trabajo" "SedeTrabajo",
    "tipo_sangre" "TipoSangre",
    "permisos" JSONB,
    "creado_por_id" TEXT,
    "actualizado_por_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conductores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "id" TEXT NOT NULL,
    "placa" TEXT NOT NULL,
    "marca" TEXT NOT NULL,
    "linea" TEXT,
    "modelo" TEXT NOT NULL,
    "color" TEXT,
    "clase_vehiculo" TEXT NOT NULL,
    "tipo_carroceria" TEXT,
    "combustible" TEXT,
    "numero_motor" TEXT,
    "vin" TEXT,
    "numero_serie" TEXT,
    "numero_chasis" TEXT,
    "propietario_nombre" TEXT,
    "propietario_identificacion" TEXT,
    "kilometraje" INTEGER DEFAULT 0,
    "estado" "EstadoVehiculo" DEFAULT 'DISPONIBLE',
    "fecha_matricula" TEXT,
    "conductor_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "representante" TEXT,
    "cedula" TEXT,
    "telefono" TEXT,
    "direccion" TEXT,
    "requiere_osi" BOOLEAN NOT NULL DEFAULT false,
    "paga_recargos" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "id" TEXT NOT NULL,
    "conductor_id" TEXT,
    "vehiculo_id" TEXT,
    "cliente_id" TEXT NOT NULL,
    "origen_especifico" TEXT,
    "destino_especifico" TEXT,
    "estado" "EstadoServicio" NOT NULL DEFAULT 'solicitado',
    "proposito_servicio" "PropositoServicio" NOT NULL DEFAULT 'personal',
    "fecha_solicitud" TIMESTAMP(3) NOT NULL,
    "fecha_realizacion" TIMESTAMP(3),
    "fecha_finalizacion" TIMESTAMP(3),
    "origen_latitud" DOUBLE PRECISION,
    "origen_longitud" DOUBLE PRECISION,
    "destino_latitud" DOUBLE PRECISION,
    "destino_longitud" DOUBLE PRECISION,
    "valor" DECIMAL(65,30) NOT NULL,
    "numero_planilla" TEXT,
    "observaciones" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conductores_email_key" ON "conductores"("email");

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_placa_key" ON "vehiculos"("placa");

-- CreateIndex
CREATE UNIQUE INDEX "empresas_nit_key" ON "empresas"("nit");

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
