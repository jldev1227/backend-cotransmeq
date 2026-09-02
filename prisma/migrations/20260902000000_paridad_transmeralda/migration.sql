-- ============================================================================
-- Paridad de esquema cotransmeq <- transmeralda
--
-- Generado con `prisma migrate diff` entre el schema.prisma ANTES y DESPUES
-- del commit de paridad, NO contra la base: asi el script contiene solo lo que
-- se anadio, sin arrastrar la deriva historica que sale al comparar contra una
-- base desincronizada.
--
-- Es ADITIVO: no hay ni un DROP, ni un TRUNCATE, ni un DELETE.
-- Es IDEMPOTENTE: se puede relanzar.
--
-- Contenido: 46 tablas, 15 tipos enum, 59 columnas,
--            99 constraints y 198 indices.
--
-- Ninguna columna nueva es NOT NULL sin DEFAULT, y ningun indice UNIQUE nuevo
-- cae sobre una tabla que ya tuviera datos: comprobado antes de generarlo.
--
-- APLICAR SIEMPRE ASI, en una sola transaccion:
--   psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f paridad-idempotente.sql
-- ============================================================================

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "enum_users_area" AS ENUM ('administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "clasificacion_nc_enum" AS ENUM ('CRITICA', 'MAYOR', 'MENOR');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "tipo_deteccion_enum" AS ENUM ('DURANTE_SERVICIO', 'POST_SERVICIO', 'AUDITORIA_INTERVENTORIA', 'REPORTE_CLIENTE', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "tipo_salida_nc_enum" AS ENUM ('GPS_SISTEMA_TECNOLOGICO', 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO', 'VEHICULO_DIFERENTE_SIN_APROBACION', 'FALLA_MECANICA_ELECTRICA', 'DOCUMENTACION_VENCIDA_INCOMPLETA', 'CONDUCTOR_NO_APTO_INFRACCION_VIAL', 'QUEJA_CLIENTE', 'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE', 'PERSONAL_NO_AUTORIZADO_TRANSPORTADO', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "estado_snc_enum" AS ENUM ('ABIERTA', 'EN_TRATAMIENTO', 'CERRADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "tratamiento_snc_enum" AS ENUM ('CORRECCION', 'CONTENCION', 'SUSPENSION', 'CONCESION');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "medio_autorizacion_enum" AS ENUM ('ESCRITO', 'CORREO', 'ACTA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "metodo_verificacion_enum" AS ENUM ('REVISION_DOCUMENTAL', 'VERIFICACION_OPERATIVA_CAMPO', 'CONFIRMACION_GPS_PLATAFORMA', 'CONFIRMACION_CLIENTE_INTERVENTOR', 'OTRO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "Sede" AS ENUM ('yopal', 'villanueva', 'ambas', 'lugar_prestacion');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "enum_actividad_pesv_estado" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'VENCIDA', 'CANCELADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "enum_actividad_pesv_prioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "enum_actividad_pesv_frecuencia" AS ENUM ('UNICA', 'DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "HallazgoTipo" AS ENUM ('NC_MAYOR', 'NC_MENOR', 'OBSERVACION', 'MEJORA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "EstadoAprobacion" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "ActionStatusGlobal" AS ENUM ('EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "enum_terceros_tipo_persona" ADD VALUE IF NOT EXISTS 'PROPIETARIO_VEHICULO';
ALTER TYPE "enum_terceros_tipo_persona" ADD VALUE IF NOT EXISTS 'PROVEEDOR';

-- AlterTable
ALTER TABLE "Evaluacion" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "registro_dia_laboral" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "registro_dia_laboral_segmento" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "configuraciones_salarios" ADD COLUMN IF NOT EXISTS "jornada_festiva_horas" DECIMAL(4,2) NOT NULL DEFAULT 7.33,
ADD COLUMN IF NOT EXISTS "jornada_normal_horas" DECIMAL(4,2) NOT NULL DEFAULT 10.33;

-- AlterTable
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "excesos_velocidad_dia" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "horas_sueno" DECIMAL(4,2),
ADD COLUMN IF NOT EXISTS "preoperacional_realizado" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "siniestros" INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS "siniestros_detalle" TEXT;

-- AlterTable
ALTER TABLE "firmas_desprendibles" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "estado_flujo" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
ADD COLUMN IF NOT EXISTS "motivo_anulacion" TEXT,
ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "es_invitado" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "invitado_por_id" UUID,
ADD COLUMN IF NOT EXISTS "permisos_rutas" JSONB;

-- AlterTable
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "accion_origen_reapertura" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "aplica_correccion_inmediata" BOOLEAN DEFAULT true,
ADD COLUMN IF NOT EXISTS "aplica_reapertura" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "cargo_responsable_cierre" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS "estado_accion" VARCHAR(100),
ADD COLUMN IF NOT EXISTS "estado_aprobacion" VARCHAR(20) DEFAULT 'PENDIENTE',
ADD COLUMN IF NOT EXISTS "estado_global" "ActionStatusGlobal" NOT NULL DEFAULT 'EN_PROCESO',
ADD COLUMN IF NOT EXISTS "evaluaciones_eficacia" JSONB,
ADD COLUMN IF NOT EXISTS "fecha_actualizacion_estado" DATE,
ADD COLUMN IF NOT EXISTS "fecha_limite_cierre_accion" DATE,
ADD COLUMN IF NOT EXISTS "fecha_limite_evaluacion_eficacia" DATE,
ADD COLUMN IF NOT EXISTS "fecha_reapertura" DATE,
ADD COLUMN IF NOT EXISTS "fecha_seguimiento" DATE,
ADD COLUMN IF NOT EXISTS "fuente_genero_hallazgo_otros" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "hallazgo_tipo" "HallazgoTipo",
ADD COLUMN IF NOT EXISTS "justificacion_no_correccion" TEXT,
ADD COLUMN IF NOT EXISTS "matriz_a_actualizar" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "observaciones" TEXT,
ADD COLUMN IF NOT EXISTS "observaciones_cierre" TEXT,
ADD COLUMN IF NOT EXISTS "razon_reapertura" TEXT,
ADD COLUMN IF NOT EXISTS "registrado_por_id" UUID,
ADD COLUMN IF NOT EXISTS "responsable_correccion" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "responsable_ejecucion" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "tipo_hallazgo_otros" VARCHAR(255);

-- AlterTable
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "analisis_evidencias_cierre" TEXT,
ADD COLUMN IF NOT EXISTS "criterio_evaluacion_eficacia" TEXT,
ADD COLUMN IF NOT EXISTS "es_causa_raiz" BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS "evaluacion_cierre_eficaz" VARCHAR(50),
ADD COLUMN IF NOT EXISTS "fecha_cierre" DATE,
ADD COLUMN IF NOT EXISTS "fecha_evaluacion_eficacia" DATE,
ADD COLUMN IF NOT EXISTS "responsable_cierre" VARCHAR(255),
ADD COLUMN IF NOT EXISTS "soporte_cierre_eficaz" TEXT,
ADD COLUMN IF NOT EXISTS "sugerencia_ia" JSONB;

-- AlterTable
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "anio" INTEGER,
ADD COLUMN IF NOT EXISTS "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
ADD COLUMN IF NOT EXISTS "mes" INTEGER,
ADD COLUMN IF NOT EXISTS "total_costos_laborales" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "total_descuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "total_gastos_operativos" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "total_impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "total_pagar" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "registro_dia_laboral_bono" (
    "id" UUID NOT NULL,
    "registro_dia_id" UUID NOT NULL,
    "segmento_id" UUID,
    "config_liquidacion_id" UUID NOT NULL,
    "valor" DECIMAL(10,2),
    "creado_por_id" UUID,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "registro_dia_laboral_bono_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bono_config_visual" (
    "id" UUID NOT NULL,
    "config_liquidacion_id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bono_config_visual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "historial_estado_liquidacion_nomina" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "estado_anterior" VARCHAR(20),
    "estado_nuevo" VARCHAR(20) NOT NULL,
    "usuario_id" UUID,
    "motivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_estado_liquidacion_nomina_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nomina_periodo_snapshot" (
    "id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "rama" VARCHAR(60) NOT NULL DEFAULT 'main',
    "version" INTEGER NOT NULL,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "revertido_de_id" UUID,
    "usuario_id" UUID,
    "payload" JSONB NOT NULL,
    "diff" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nomina_periodo_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "nomina_envio" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "email_destino" VARCHAR(255) NOT NULL,
    "asunto" TEXT,
    "mensaje" TEXT,
    "adjuntos" JSONB,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "proveedor" VARCHAR(40),
    "message_id" VARCHAR(255),
    "es_prueba" BOOLEAN NOT NULL DEFAULT false,
    "enviado_por_id" UUID,
    "enviado_por" VARCHAR(255),
    "enviado_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nomina_envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "invitaciones_usuario" (
    "id" UUID NOT NULL,
    "correo" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "area" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cargo" VARCHAR(255),
    "invitado_por_id" UUID NOT NULL,
    "estado" VARCHAR(50) NOT NULL DEFAULT 'pendiente',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "salidas_no_conformes" (
    "id" UUID NOT NULL,
    "numero_snc" SERIAL NOT NULL,
    "fecha_deteccion" DATE NOT NULL,
    "fecha_evento" DATE NOT NULL,
    "detectado_por" VARCHAR(255) NOT NULL,
    "area_proceso" VARCHAR(255) NOT NULL,
    "tipo_deteccion" "tipo_deteccion_enum" NOT NULL,
    "tipo_deteccion_otro" VARCHAR(255),
    "vehiculo_placa" VARCHAR(20),
    "ruta_trayecto" VARCHAR(500),
    "turno_horario" VARCHAR(255),
    "conductor_nombre" VARCHAR(255),
    "conductor_cedula" VARCHAR(50),
    "cliente_contrato" VARCHAR(500),
    "servicio_afectado" TEXT,
    "descripcion_nc" TEXT NOT NULL,
    "clasificacion_nc" "clasificacion_nc_enum" NOT NULL,
    "tipo_salida_nc" "tipo_salida_nc_enum" NOT NULL,
    "tipo_salida_nc_otro" VARCHAR(255),
    "estado" "estado_snc_enum" NOT NULL DEFAULT 'ABIERTA',
    "observaciones" TEXT,
    "conductor_id" UUID,
    "vehiculo_id" UUID,
    "cliente_id" UUID,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "autoridad_disposicion" VARCHAR(255),
    "descripcion_accion_tomada" TEXT,
    "fecha_implementacion" DATE,
    "responsable_accion" VARCHAR(255),
    "tratamiento_seleccionado" "tratamiento_snc_enum",
    "concesion_cliente_fecha" DATE,
    "concesion_cliente_nombre" VARCHAR(255),
    "concesion_medio" "medio_autorizacion_enum",
    "concesion_solicitada" BOOLEAN DEFAULT false,
    "condiciones_concesion" TEXT,
    "cumple_requisitos" BOOLEAN,
    "fecha_verificacion" DATE,
    "firma_verificacion" TEXT,
    "metodo_verificacion" "metodo_verificacion_enum",
    "metodo_verificacion_otro" VARCHAR(255),
    "responsable_verificacion" VARCHAR(255),
    "resultado_verificacion" TEXT,

    CONSTRAINT "salidas_no_conformes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "aprobaciones_accion" (
    "id" UUID NOT NULL,
    "accion_id" UUID NOT NULL,
    "orden" INTEGER DEFAULT 1,
    "rol" VARCHAR(100) NOT NULL,
    "aprobador_id" UUID,
    "estado" "EstadoAprobacion" NOT NULL DEFAULT 'PENDIENTE',
    "fecha" TIMESTAMPTZ(6),
    "comentario" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "aprobaciones_accion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seguimientos_causa" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "causa_id" UUID NOT NULL,
    "fecha_seguimiento" DATE NOT NULL,
    "estado_accion" VARCHAR(50) NOT NULL,
    "descripcion_observaciones" TEXT,
    "evaluacion_eficaz" VARCHAR(50),
    "registrado_por_id" UUID,
    "adjunto_url" TEXT,
    "replanteo" JSONB,
    "responsable_seguimiento" VARCHAR(255),
    "cargo_responsable_seguimiento" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seguimientos_causa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "seguimientos_correccion_inmediata" (
    "id" UUID NOT NULL,
    "accion_correctiva_id" UUID NOT NULL,
    "fecha_seguimiento" DATE NOT NULL,
    "descripcion_observaciones" TEXT,
    "estado_accion" VARCHAR(50) NOT NULL,
    "adjunto_url" TEXT,
    "replanteo" JSONB,
    "responsable_seguimiento" VARCHAR(255),
    "cargo_responsable_seguimiento" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "seguimientos_correccion_inmediata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ciclos_seguimiento_eficacia" (
    "id" UUID NOT NULL,
    "accion_correctiva_id" UUID NOT NULL,
    "numero_ciclo" INTEGER NOT NULL,
    "fecha_seguimiento" DATE NOT NULL,
    "descripcion" TEXT,
    "resultado_ciclo" VARCHAR(50),
    "responsable" VARCHAR(255),
    "cargo" VARCHAR(255),
    "criterios_cumplidos" JSONB,
    "adjunto_url" TEXT,
    "impedimento" TEXT,
    "nueva_fecha" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ciclos_seguimiento_eficacia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "evidencias_eficacia_cierre" (
    "id" UUID NOT NULL,
    "accion_correctiva_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "tipo_evidencia" VARCHAR(255),
    "descripcion" TEXT,
    "fecha" DATE,
    "estado_ubicacion" VARCHAR(50),
    "adjunto_url" TEXT,
    "impedimento" TEXT,
    "nueva_fecha" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evidencias_eficacia_cierre_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_concepto" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "conductor_id" UUID,
    "dias" DECIMAL(10,2),
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentaje" DECIMAL(8,4),
    "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "base_calculo" DECIMAL(12,2),
    "calculado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liquidacion_tercero_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "configuracion_descuento_tercero" (
    "id" UUID NOT NULL,
    "categoria" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "porcentaje" DECIMAL(8,4) NOT NULL,
    "base_calculo" VARCHAR(100) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "valor_dia_conductor" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "configuracion_descuento_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final" (
    "id" UUID NOT NULL,
    "consecutivo" VARCHAR(50) NOT NULL,
    "liquidacion_servicio_id" UUID NOT NULL,
    "tercero_id" UUID,
    "vehiculo_id" UUID,
    "placa" VARCHAR(20) NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "valor_liquidar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_costos_laborales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_gastos_operativos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_descuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pagar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "motivo_anulacion" TEXT,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "es_multi_propietario" BOOLEAN NOT NULL DEFAULT false,
    "adicionales" JSONB NOT NULL DEFAULT '[]',
    "es_propietario_overrides" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "color_hoja" VARCHAR(9),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "historial_estado_liquidacion_tercero_final" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "estado_anterior" VARCHAR(20),
    "estado_nuevo" VARCHAR(20) NOT NULL,
    "usuario_id" UUID,
    "motivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_estado_liquidacion_tercero_final_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_envio" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'CIERRE',
    "cierre_id" UUID,
    "origen_id" UUID,
    "tercero_id" UUID,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "placa" VARCHAR(20) NOT NULL,
    "email_destino" VARCHAR(255) NOT NULL,
    "asunto" VARCHAR(500) NOT NULL,
    "mensaje" TEXT,
    "adjuntos" JSONB NOT NULL DEFAULT '[]',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "error" TEXT,
    "proveedor" VARCHAR(30),
    "message_id" VARCHAR(255),
    "es_prueba" BOOLEAN NOT NULL DEFAULT false,
    "enviado_por_id" UUID,
    "enviado_por" VARCHAR(255),
    "enviado_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final_adicional" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "cliente" VARCHAR(255) NOT NULL DEFAULT 'TRANSMERALDA',
    "placa" VARCHAR(20) NOT NULL,
    "tercero_id" UUID,
    "tercero_nombre" VARCHAR(255),
    "vehiculo_id" UUID,
    "recorrido" VARCHAR(500),
    "fechas" VARCHAR(100),
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "porcentaje_admin" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_admin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_liquidar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_adicional_periodo_snapshot" (
    "id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "rama" VARCHAR(60) NOT NULL DEFAULT 'main',
    "version" INTEGER NOT NULL,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "revertido_de_id" UUID,
    "usuario_id" UUID,
    "payload" JSONB NOT NULL,
    "diff" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_adicional_periodo_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final_item" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final_concepto" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "conductor_id" UUID,
    "dias" DECIMAL(10,2),
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentaje" DECIMAL(8,4),
    "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "base_calculo" DECIMAL(12,2),
    "calculado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "propietario_id" UUID,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final_propietario" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "tercero_id" UUID,
    "nombre" VARCHAR(255) NOT NULL,
    "identificacion" VARCHAR(50),
    "porcentaje" DECIMAL(8,4) NOT NULL,
    "porcentaje_efectivo" DECIMAL(8,4),
    "nota" VARCHAR(255),
    "aplica_retenciones" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_propietario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_final_snapshot" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "rama" VARCHAR(60) NOT NULL DEFAULT 'main',
    "version" INTEGER NOT NULL,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "revertido_de_id" UUID,
    "usuario_id" UUID,
    "payload" JSONB NOT NULL,
    "diff" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_final_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "excesos_velocidad" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "excesos_velocidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "preoperacionales" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "realizado" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "preoperacionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "inducciones_visitantes" (
    "id" TEXT NOT NULL,
    "sede" "Sede" NOT NULL,
    "fecha" TIMESTAMP(3) NOT NULL,
    "visitante_nombre" VARCHAR(255) NOT NULL,
    "visitante_cargo" VARCHAR(255) NOT NULL,
    "visitante_cedula" VARCHAR(50) NOT NULL,
    "visitante_entidad" VARCHAR(255) NOT NULL,
    "visitante_firma" TEXT NOT NULL,
    "temas_informados" JSONB NOT NULL DEFAULT '{}',
    "porcentaje_conformidad" INTEGER NOT NULL DEFAULT 0,
    "responsable_nombre" VARCHAR(255),
    "responsable_cargo" VARCHAR(255),
    "responsable_cedula" VARCHAR(50),
    "responsable_firma" TEXT,
    "observaciones" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "creado_por_id" UUID,

    CONSTRAINT "inducciones_visitantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "actividades_pesv" (
    "id" UUID NOT NULL,
    "numero" INTEGER NOT NULL,
    "unidad_programa" VARCHAR(500) NOT NULL,
    "actividad" TEXT NOT NULL,
    "alcance" VARCHAR(500),
    "recursos" VARCHAR(500),
    "responsable_planeacion" VARCHAR(500),
    "metodo_seguimiento" VARCHAR(500),
    "frecuencia" "enum_actividad_pesv_frecuencia" NOT NULL DEFAULT 'ANUAL',
    "fecha_limite" DATE,
    "responsable_ejecucion_id" UUID,
    "estado" "enum_actividad_pesv_estado" NOT NULL DEFAULT 'PENDIENTE',
    "prioridad" "enum_actividad_pesv_prioridad" NOT NULL DEFAULT 'BAJA',
    "fecha_ejecucion" DATE,
    "observacion" TEXT,
    "anio" INTEGER NOT NULL DEFAULT 2026,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "actividades_pesv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "bonificaciones_backup" (
    "name" VARCHAR(255),
    "values" TEXT,
    "value" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ(6),
    "old_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6),
    "id" UUID,
    "liquidacion_id" UUID,
    "vehiculo_id" UUID,
    "creado_por_id" UUID
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tipo_certificado" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "codigo" VARCHAR(50) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tipo_certificado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "certificado_archivo" (
    "id" UUID NOT NULL,
    "s3_key" VARCHAR(512) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "nit" VARCHAR(50) NOT NULL,
    "anio" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "tercero_id" UUID,
    "tipo_certificado_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "certificado_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "certificado_tercero" (
    "id" UUID NOT NULL,
    "tercero_id" UUID NOT NULL,
    "certificado_id" UUID NOT NULL,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificado_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "certificacion_envio" (
    "id" UUID NOT NULL,
    "tercero_id" UUID NOT NULL,
    "certificado_id" UUID,
    "token_acceso" VARCHAR(255) NOT NULL,
    "email_destino" VARCHAR(255) NOT NULL,
    "tipo_envio" VARCHAR(20) NOT NULL DEFAULT 'individual',
    "emitido_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificacion_envio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "tercero_token" (
    "id" UUID NOT NULL,
    "tercero_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tercero_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_chat_mensaje" (
    "id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "contenido_cifrado" TEXT NOT NULL,
    "nonce" VARCHAR(24) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'NOTA',
    "recordatorio_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liquidacion_chat_mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_recordatorio" (
    "id" UUID NOT NULL,
    "liquidacion_origen_id" UUID NOT NULL,
    "placa" VARCHAR(20) NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "descripcion_cifrada" TEXT NOT NULL,
    "descripcion_nonce" VARCHAR(24) NOT NULL,
    "monto" DECIMAL(12,2),
    "moneda" VARCHAR(3) NOT NULL DEFAULT 'COP',
    "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
    "prioridad" VARCHAR(10) NOT NULL DEFAULT 'MEDIA',
    "creado_por_usuario_id" UUID NOT NULL,
    "aplicado_en_liquidacion_id" UUID,
    "aplica_en" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liquidacion_recordatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional" (
    "id" UUID NOT NULL,
    "consecutivo" VARCHAR(50) NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
    "motivo_anulacion" TEXT,
    "observaciones" TEXT,
    "total_adicionales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_gastos_operativos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_impuestos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_anticipos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_descuentos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_pagar" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_facturado_items" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_admin_items" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_liquidar_items" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_ocasional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional_adicional" (
    "id" UUID NOT NULL,
    "liquidacion_ocasional_id" UUID NOT NULL,
    "cliente" VARCHAR(255) NOT NULL DEFAULT 'TRANSMERALDA',
    "placa" VARCHAR(20) NOT NULL,
    "tercero_id" UUID,
    "tercero_nombre" VARCHAR(255),
    "vehiculo_id" UUID,
    "recorrido" VARCHAR(500),
    "fechas" VARCHAR(100),
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "porcentaje_admin" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_admin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_liquidar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_ocasional_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional_item" (
    "id" UUID NOT NULL,
    "liquidacion_ocasional_id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
    "liquidacion_servicio_id" UUID,
    "cliente_nombre" VARCHAR(255) NOT NULL,
    "consecutivo" VARCHAR(50) NOT NULL,
    "placa" VARCHAR(20) NOT NULL,
    "tercero_id" UUID,
    "tercero_nombre" VARCHAR(255) NOT NULL,
    "tercero_documento" VARCHAR(50),
    "recorrido" VARCHAR(500) NOT NULL,
    "fechas" VARCHAR(100) NOT NULL,
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "porcentaje_admin" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_admin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_facturado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_liquidar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "numero_planilla" VARCHAR(50),
    "ingreso_extra_global" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ingresos_extra_aval" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ingreso_empresa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "numero_factura" VARCHAR(50),
    "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
    "excluido" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_ocasional_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional_draft" (
    "id" UUID NOT NULL,
    "liquidacion_ocasional_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liquidacion_tercero_ocasional_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional_concepto" (
    "id" UUID NOT NULL,
    "liquidacion_ocasional_id" UUID NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "conductor_id" UUID,
    "placa_aplicada" VARCHAR(20),
    "dias" DECIMAL(10,2),
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentaje" DECIMAL(8,4),
    "valor_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "base_calculo" DECIMAL(12,2),
    "calculado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_ocasional_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_tercero_ocasional_snapshot" (
    "id" UUID NOT NULL,
    "liquidacion_ocasional_id" UUID NOT NULL,
    "rama" VARCHAR(60) NOT NULL DEFAULT 'main',
    "version" INTEGER NOT NULL,
    "origen" VARCHAR(20) NOT NULL DEFAULT 'manual',
    "revertido_de_id" UUID,
    "usuario_id" UUID,
    "payload" JSONB NOT NULL,
    "diff" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_ocasional_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "custom_places" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "categoria" VARCHAR(50),
    "descripcion" TEXT,
    "direccion" TEXT,
    "latitud" DECIMAL(10,6) NOT NULL,
    "longitud" DECIMAL(10,6) NOT NULL,
    "municipio_id" UUID,
    "creado_por_id" UUID,
    "veces_usado" INTEGER NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "custom_places_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "canvas_anotacion" (
    "id" UUID NOT NULL,
    "scope" VARCHAR(40) NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "sheet_key" VARCHAR(80) NOT NULL DEFAULT '',
    "ancla_tipo" VARCHAR(10) NOT NULL DEFAULT 'fila',
    "ancla_ref" VARCHAR(64) NOT NULL DEFAULT '',
    "offset_fila" INTEGER NOT NULL,
    "columna" INTEGER NOT NULL,
    "valor" TEXT,
    "estilo" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "canvas_anotacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_ingreso_transmeralda" (
    "id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "observaciones" TEXT,
    "pct_admon_ingresos" DECIMAL(8,4) NOT NULL DEFAULT 10,
    "pct_ganancia_adicionales" DECIMAL(8,4) NOT NULL DEFAULT 70,
    "pct_admon_adicionales" DECIMAL(8,4) NOT NULL DEFAULT 10,
    "total_facturado_ingresos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_admon_ingresos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_liquidar_ingresos" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_facturado_adicionales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_admon_adicionales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_liquidar_adicionales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_pagar_adicionales" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_ingreso_transmeralda" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_ingreso_transmeralda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila" (
    "id" UUID NOT NULL,
    "liquidacion_ingreso_id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID,
    "adicional_id" UUID,
    "incluir_adicional" BOOLEAN NOT NULL DEFAULT false,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "pct_admon_ingresos" DECIMAL(8,4),
    "pct_ganancia" DECIMAL(8,4),
    "pct_admon_adicional" DECIMAL(8,4),
    "valor_unitario_adicional" DECIMAL(14,2),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_ingreso_transmeralda_fila_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "liquidacion_ingreso_transmeralda_concepto" (
    "id" UUID NOT NULL,
    "liquidacion_ingreso_id" UUID NOT NULL,
    "hoja" VARCHAR(20) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "persona" VARCHAR(150),
    "dias" DECIMAL(10,2),
    "valor_unitario" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "porcentaje" DECIMAL(8,4),
    "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "base_calculo" DECIMAL(14,2),
    "observaciones" TEXT,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_ingreso_transmeralda_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_bono_registro_dia_id_idx" ON "registro_dia_laboral_bono"("registro_dia_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_bono_segmento_id_idx" ON "registro_dia_laboral_bono"("segmento_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_bono_config_liquidacion_id_idx" ON "registro_dia_laboral_bono"("config_liquidacion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_bono_creado_por_id_idx" ON "registro_dia_laboral_bono"("creado_por_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "bono_config_visual_anio_visible_idx" ON "bono_config_visual"("anio", "visible");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "bono_config_visual_config_liquidacion_id_anio_key" ON "bono_config_visual"("config_liquidacion_id", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "historial_estado_liquidacion_nomina_liquidacion_id_created__idx" ON "historial_estado_liquidacion_nomina"("liquidacion_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "historial_estado_liquidacion_nomina_usuario_id_idx" ON "historial_estado_liquidacion_nomina"("usuario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_periodo_snapshot_anio_mes_rama_idx" ON "nomina_periodo_snapshot"("anio", "mes", "rama");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_periodo_snapshot_created_at_idx" ON "nomina_periodo_snapshot"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_periodo_snapshot_usuario_id_idx" ON "nomina_periodo_snapshot"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "nomina_periodo_snapshot_anio_mes_version_key" ON "nomina_periodo_snapshot"("anio", "mes", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_envio_liquidacion_id_idx" ON "nomina_envio"("liquidacion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_envio_anio_mes_idx" ON "nomina_envio"("anio", "mes");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_envio_conductor_id_idx" ON "nomina_envio"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_envio_estado_idx" ON "nomina_envio"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "nomina_envio_enviado_at_idx" ON "nomina_envio"("enviado_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "invitaciones_usuario_token_key" ON "invitaciones_usuario"("token");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "salidas_no_conformes_numero_snc_key" ON "salidas_no_conformes"("numero_snc");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_numero_snc_idx" ON "salidas_no_conformes"("numero_snc");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_fecha_deteccion_idx" ON "salidas_no_conformes"("fecha_deteccion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_clasificacion_nc_idx" ON "salidas_no_conformes"("clasificacion_nc");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_estado_idx" ON "salidas_no_conformes"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_conductor_id_idx" ON "salidas_no_conformes"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "salidas_no_conformes_vehiculo_id_idx" ON "salidas_no_conformes"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aprobaciones_accion_accion_id_idx" ON "aprobaciones_accion"("accion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "aprobaciones_accion_estado_idx" ON "aprobaciones_accion"("estado");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "aprobaciones_accion_accion_id_key" ON "aprobaciones_accion"("accion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seguimientos_causa_causa_id_idx" ON "seguimientos_causa"("causa_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seguimientos_causa_estado_idx" ON "seguimientos_causa"("estado_accion");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seguimientos_causa_fecha_idx" ON "seguimientos_causa"("fecha_seguimiento");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seguimientos_correccion_inmediata_accion_correctiva_id_idx" ON "seguimientos_correccion_inmediata"("accion_correctiva_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "seguimientos_correccion_inmediata_fecha_seguimiento_idx" ON "seguimientos_correccion_inmediata"("fecha_seguimiento");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ciclos_seguimiento_eficacia_accion_correctiva_id_idx" ON "ciclos_seguimiento_eficacia"("accion_correctiva_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ciclos_seguimiento_eficacia_accion_correctiva_id_numero_cic_key" ON "ciclos_seguimiento_eficacia"("accion_correctiva_id", "numero_ciclo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "evidencias_eficacia_cierre_accion_correctiva_id_idx" ON "evidencias_eficacia_cierre"("accion_correctiva_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "evidencias_eficacia_cierre_accion_correctiva_id_orden_key" ON "evidencias_eficacia_cierre"("accion_correctiva_id", "orden");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_concepto_liquidacion_tercero_id_idx" ON "liquidacion_tercero_concepto"("liquidacion_tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_concepto_conductor_id_idx" ON "liquidacion_tercero_concepto"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_concepto_tipo_idx" ON "liquidacion_tercero_concepto"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_concepto_concepto_idx" ON "liquidacion_tercero_concepto"("concepto");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "configuracion_descuento_tercero_concepto_key" ON "configuracion_descuento_tercero"("concepto");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "configuracion_descuento_tercero_categoria_idx" ON "configuracion_descuento_tercero"("categoria");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "configuracion_descuento_tercero_activo_idx" ON "configuracion_descuento_tercero"("activo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_final_consecutivo_key" ON "liquidacion_tercero_final"("consecutivo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_liquidacion_servicio_id_idx" ON "liquidacion_tercero_final"("liquidacion_servicio_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_tercero_id_idx" ON "liquidacion_tercero_final"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_vehiculo_id_idx" ON "liquidacion_tercero_final"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_placa_idx" ON "liquidacion_tercero_final"("placa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_anio_mes_idx" ON "liquidacion_tercero_final"("anio", "mes");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_estado_idx" ON "liquidacion_tercero_final"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_final_periodo_placa" ON "liquidacion_tercero_final"("anio", "mes", "placa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_hist_estado_lt_final_cierre" ON "historial_estado_liquidacion_tercero_final"("liquidacion_tercero_final_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_hist_estado_lt_final_usuario" ON "historial_estado_liquidacion_tercero_final"("usuario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_cierre_id_idx" ON "liquidacion_tercero_envio"("cierre_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_tipo_anio_mes_idx" ON "liquidacion_tercero_envio"("tipo", "anio", "mes");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_tercero_id_idx" ON "liquidacion_tercero_envio"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_anio_mes_idx" ON "liquidacion_tercero_envio"("anio", "mes");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_estado_idx" ON "liquidacion_tercero_envio"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_envio_enviado_at_idx" ON "liquidacion_tercero_envio"("enviado_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_final_adicional_cierre" ON "liquidacion_tercero_final_adicional"("liquidacion_tercero_final_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_final_adicional_cierre_orden" ON "liquidacion_tercero_final_adicional"("liquidacion_tercero_final_id", "orden");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_final_adicional_deleted_at" ON "liquidacion_tercero_final_adicional"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_adic_periodo_snapshot_periodo" ON "liquidacion_tercero_adicional_periodo_snapshot"("anio", "mes", "rama");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_adic_periodo_snapshot_created" ON "liquidacion_tercero_adicional_periodo_snapshot"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_lt_adic_periodo_snapshot_usuario" ON "liquidacion_tercero_adicional_periodo_snapshot"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_lt_adic_periodo_snapshot_version" ON "liquidacion_tercero_adicional_periodo_snapshot"("anio", "mes", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_item_liquidacion_tercero_final_id_idx" ON "liquidacion_tercero_final_item"("liquidacion_tercero_final_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_item_liquidacion_tercero_id_idx" ON "liquidacion_tercero_final_item"("liquidacion_tercero_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_final_item_liquidacion_tercero_final_id_key" ON "liquidacion_tercero_final_item"("liquidacion_tercero_final_id", "liquidacion_tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_concepto_liquidacion_tercero_fina_idx" ON "liquidacion_tercero_final_concepto"("liquidacion_tercero_final_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_concepto_conductor_id_idx" ON "liquidacion_tercero_final_concepto"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_concepto_tipo_idx" ON "liquidacion_tercero_final_concepto"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_concepto_concepto_idx" ON "liquidacion_tercero_final_concepto"("concepto");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_concepto_propietario_id_idx" ON "liquidacion_tercero_final_concepto"("propietario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_propietario_liquidacion_tercero_f_idx" ON "liquidacion_tercero_final_propietario"("liquidacion_tercero_final_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_propietario_tercero_id_idx" ON "liquidacion_tercero_final_propietario"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_propietario_deleted_at_idx" ON "liquidacion_tercero_final_propietario"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_snapshot_liquidacion_tercero_fina_idx" ON "liquidacion_tercero_final_snapshot"("liquidacion_tercero_final_id", "rama");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_snapshot_created_at_idx" ON "liquidacion_tercero_final_snapshot"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_final_snapshot_usuario_id_idx" ON "liquidacion_tercero_final_snapshot"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_final_snapshot_liquidacion_tercero_fina_key" ON "liquidacion_tercero_final_snapshot"("liquidacion_tercero_final_id", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excesos_velocidad_conductor_id_idx" ON "excesos_velocidad"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excesos_velocidad_vehiculo_id_idx" ON "excesos_velocidad"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "excesos_velocidad_mes_anio_idx" ON "excesos_velocidad"("mes", "anio");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "excesos_velocidad_conductor_id_vehiculo_id_mes_anio_key" ON "excesos_velocidad"("conductor_id", "vehiculo_id", "mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "preoperacionales_conductor_id_idx" ON "preoperacionales"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "preoperacionales_vehiculo_id_idx" ON "preoperacionales"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "preoperacionales_fecha_idx" ON "preoperacionales"("fecha");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "preoperacionales_conductor_id_vehiculo_id_fecha_key" ON "preoperacionales"("conductor_id", "vehiculo_id", "fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inducciones_visitantes_fecha_idx" ON "inducciones_visitantes"("fecha" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inducciones_visitantes_sede_idx" ON "inducciones_visitantes"("sede");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "inducciones_visitantes_visitante_cedula_idx" ON "inducciones_visitantes"("visitante_cedula");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_estado_idx" ON "actividades_pesv"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_prioridad_idx" ON "actividades_pesv"("prioridad");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_anio_idx" ON "actividades_pesv"("anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_responsable_ejecucion_id_idx" ON "actividades_pesv"("responsable_ejecucion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_deleted_at_idx" ON "actividades_pesv"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "actividades_pesv_frecuencia_idx" ON "actividades_pesv"("frecuencia");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tipo_certificado_codigo_key" ON "tipo_certificado"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tipo_certificado_codigo_idx" ON "tipo_certificado"("codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tipo_certificado_activo_idx" ON "tipo_certificado"("activo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificado_archivo_s3_key_key" ON "certificado_archivo"("s3_key");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_nit_idx" ON "certificado_archivo"("nit");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_anio_idx" ON "certificado_archivo"("anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_tercero_id_idx" ON "certificado_archivo"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_tipo_certificado_id_idx" ON "certificado_archivo"("tipo_certificado_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_tipo_idx" ON "certificado_archivo"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_archivo_created_at_idx" ON "certificado_archivo"("created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_tercero_tercero_id_idx" ON "certificado_tercero"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificado_tercero_certificado_id_idx" ON "certificado_tercero"("certificado_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificado_tercero_tercero_id_certificado_id_key" ON "certificado_tercero"("tercero_id", "certificado_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "certificacion_envio_token_acceso_key" ON "certificacion_envio"("token_acceso");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_tercero_id_idx" ON "certificacion_envio"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_token_acceso_idx" ON "certificacion_envio"("token_acceso");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_email_destino_idx" ON "certificacion_envio"("email_destino");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_emitido_at_idx" ON "certificacion_envio"("emitido_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_tipo_envio_idx" ON "certificacion_envio"("tipo_envio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "certificacion_envio_certificado_id_idx" ON "certificacion_envio"("certificado_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "tercero_token_token_key" ON "tercero_token"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tercero_token_token_idx" ON "tercero_token"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tercero_token_tercero_id_idx" ON "tercero_token"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tercero_token_expires_at_idx" ON "tercero_token"("expires_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_chat_mensaje_liquidacion_tercero_id_idx" ON "liquidacion_chat_mensaje"("liquidacion_tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_chat_mensaje_usuario_id_idx" ON "liquidacion_chat_mensaje"("usuario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_chat_mensaje_tipo_idx" ON "liquidacion_chat_mensaje"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_chat_mensaje_created_at_idx" ON "liquidacion_chat_mensaje"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_recordatorio_placa_mes_anio_idx" ON "liquidacion_recordatorio"("placa", "mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_recordatorio_estado_idx" ON "liquidacion_recordatorio"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_recordatorio_creado_por_usuario_id_idx" ON "liquidacion_recordatorio"("creado_por_usuario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_recordatorio_liquidacion_origen_id_idx" ON "liquidacion_recordatorio"("liquidacion_origen_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_recordatorio_aplicado_en_liquidacion_id_idx" ON "liquidacion_recordatorio"("aplicado_en_liquidacion_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_consecutivo_key" ON "liquidacion_tercero_ocasional"("consecutivo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_mes_anio_idx" ON "liquidacion_tercero_ocasional"("mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_estado_idx" ON "liquidacion_tercero_ocasional"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_deleted_at_idx" ON "liquidacion_tercero_ocasional"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_creado_por_id_idx" ON "liquidacion_tercero_ocasional"("creado_por_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_actualizado_por_id_idx" ON "liquidacion_tercero_ocasional"("actualizado_por_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_mes_anio_key" ON "liquidacion_tercero_ocasional"("mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_adicional_liquidacion_ocasion_idx" ON "liquidacion_tercero_ocasional_adicional"("liquidacion_ocasional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_adicional_placa_idx" ON "liquidacion_tercero_ocasional_adicional"("placa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_adicional_tercero_id_idx" ON "liquidacion_tercero_ocasional_adicional"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_adicional_deleted_at_idx" ON "liquidacion_tercero_ocasional_adicional"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ocasional_adicional_liquidacion_placa" ON "liquidacion_tercero_ocasional_adicional"("liquidacion_ocasional_id", "placa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ocasional_item_liquidacion_ocasional" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_item_placa_idx" ON "liquidacion_tercero_ocasional_item"("placa");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_item_tercero_id_idx" ON "liquidacion_tercero_ocasional_item"("tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_item_deleted_at_idx" ON "liquidacion_tercero_ocasional_item"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ocasional_item_liquidacion_excluido" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id", "excluido");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_item_liquidacion_ocasional_id_key" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id", "liquidacion_tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_i_idx" ON "liquidacion_tercero_ocasional_draft"("liquidacion_ocasional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_draft_updated_at_idx" ON "liquidacion_tercero_ocasional_draft"("updated_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_i_key" ON "liquidacion_tercero_ocasional_draft"("liquidacion_ocasional_id", "usuario_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_liquidacion_ocasiona_idx" ON "liquidacion_tercero_ocasional_concepto"("liquidacion_ocasional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_tipo_idx" ON "liquidacion_tercero_ocasional_concepto"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_concepto_idx" ON "liquidacion_tercero_ocasional_concepto"("concepto");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_placa_aplicada_idx" ON "liquidacion_tercero_ocasional_concepto"("placa_aplicada");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_conductor_id_idx" ON "liquidacion_tercero_ocasional_concepto"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_concepto_deleted_at_idx" ON "liquidacion_tercero_ocasional_concepto"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasiona_idx" ON "liquidacion_tercero_ocasional_snapshot"("liquidacion_ocasional_id", "rama");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_snapshot_created_at_idx" ON "liquidacion_tercero_ocasional_snapshot"("created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_snapshot_usuario_id_idx" ON "liquidacion_tercero_ocasional_snapshot"("usuario_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasiona_key" ON "liquidacion_tercero_ocasional_snapshot"("liquidacion_ocasional_id", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_custom_places_nombre" ON "custom_places"("nombre");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_custom_places_categoria" ON "custom_places"("categoria");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_custom_places_activo" ON "custom_places"("activo", "deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_custom_places_creado_por" ON "custom_places"("creado_por_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "canvas_anotacion_scope_anio_mes_idx" ON "canvas_anotacion"("scope", "anio", "mes");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "canvas_anotacion_scope_anio_mes_sheet_key_idx" ON "canvas_anotacion"("scope", "anio", "mes", "sheet_key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "canvas_anotacion_scope_anio_mes_sheet_key_ancla_tipo_ancla__key" ON "canvas_anotacion"("scope", "anio", "mes", "sheet_key", "ancla_tipo", "ancla_ref", "offset_fila", "columna");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_mes_anio_idx" ON "liquidacion_ingreso_transmeralda"("mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_deleted_at_idx" ON "liquidacion_ingreso_transmeralda"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_creado_por_id_idx" ON "liquidacion_ingreso_transmeralda"("creado_por_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_actualizado_por_id_idx" ON "liquidacion_ingreso_transmeralda"("actualizado_por_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_mes_anio_key" ON "liquidacion_ingreso_transmeralda"("mes", "anio");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso_i_idx" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_ingreso_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_liquidacion_tercero_i_idx" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_tercero_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_adicional_id_idx" ON "liquidacion_ingreso_transmeralda_fila"("adicional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_incluir_adicional_idx" ON "liquidacion_ingreso_transmeralda_fila"("incluir_adicional");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_deleted_at_idx" ON "liquidacion_ingreso_transmeralda_fila"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso_i_key" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_ingreso_id", "liquidacion_tercero_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_ingreso_fila_adicional" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_ingreso_id", "adicional_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ingreso_concepto_cabecera" ON "liquidacion_ingreso_transmeralda_concepto"("liquidacion_ingreso_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ingreso_concepto_hoja" ON "liquidacion_ingreso_transmeralda_concepto"("liquidacion_ingreso_id", "hoja");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ingreso_concepto_tipo" ON "liquidacion_ingreso_transmeralda_concepto"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_ingreso_concepto_deleted" ON "liquidacion_ingreso_transmeralda_concepto"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_deleted_at_idx" ON "registro_dia_laboral"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "registro_dia_laboral_segmento_deleted_at_idx" ON "registro_dia_laboral_segmento"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_firmas_desprendibles_token" ON "firmas_desprendibles"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_liquidaciones_estado_flujo" ON "liquidaciones"("estado_flujo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recargos_liquidacion_id_idx" ON "recargos"("liquidacion_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "recargos_es_automatico_idx" ON "recargos"("es_automatico");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "idx_tipos_recargos_codigo_vigencia" ON "tipos_recargos"("codigo", "activo", "vigencia_desde", "vigencia_hasta");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_estado_global_idx" ON "acciones_correctivas_preventivas"("estado_global");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_hallazgo_tipo_idx" ON "acciones_correctivas_preventivas"("hallazgo_tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_deleted_at_idx" ON "acciones_correctivas_preventivas"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "causas_accion_correctiva_evaluacion_cierre_eficaz_idx" ON "causas_accion_correctiva"("evaluacion_cierre_eficaz");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "causas_accion_correctiva_fecha_cierre_idx" ON "causas_accion_correctiva"("fecha_cierre");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'recargos_origen_planilla_id_fkey') THEN
    ALTER TABLE "recargos" ADD CONSTRAINT "recargos_origen_planilla_id_fkey" FOREIGN KEY ("origen_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acciones_correctivas_preventivas_registrado_por_id_fkey') THEN
    ALTER TABLE "acciones_correctivas_preventivas" ADD CONSTRAINT "acciones_correctivas_preventivas_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registro_dia_laboral_bono_registro_dia_id_fkey') THEN
    ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_registro_dia_id_fkey" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registro_dia_laboral_bono_segmento_id_fkey') THEN
    ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_segmento_id_fkey" FOREIGN KEY ("segmento_id") REFERENCES "registro_dia_laboral_segmento"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registro_dia_laboral_bono_config_liquidacion_id_fkey') THEN
    ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'registro_dia_laboral_bono_creado_por_id_fkey') THEN
    ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bono_config_visual_config_liquidacion_id_fkey') THEN
    ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bono_config_visual_creado_por_id_fkey') THEN
    ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_estado_liquidacion_nomina_liquidacion_id_fkey') THEN
    ALTER TABLE "historial_estado_liquidacion_nomina" ADD CONSTRAINT "historial_estado_liquidacion_nomina_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_estado_liquidacion_nomina_usuario_id_fkey') THEN
    ALTER TABLE "historial_estado_liquidacion_nomina" ADD CONSTRAINT "historial_estado_liquidacion_nomina_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomina_periodo_snapshot_usuario_id_fkey') THEN
    ALTER TABLE "nomina_periodo_snapshot" ADD CONSTRAINT "nomina_periodo_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomina_periodo_snapshot_revertido_de_id_fkey') THEN
    ALTER TABLE "nomina_periodo_snapshot" ADD CONSTRAINT "nomina_periodo_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "nomina_periodo_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'nomina_envio_liquidacion_id_fkey') THEN
    ALTER TABLE "nomina_envio" ADD CONSTRAINT "nomina_envio_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'invitaciones_usuario_invitado_por_id_fkey') THEN
    ALTER TABLE "invitaciones_usuario" ADD CONSTRAINT "invitaciones_usuario_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salidas_no_conformes_cliente_id_fkey') THEN
    ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salidas_no_conformes_conductor_id_fkey') THEN
    ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salidas_no_conformes_creado_por_id_fkey') THEN
    ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'salidas_no_conformes_vehiculo_id_fkey') THEN
    ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aprobaciones_accion_accion_id_fkey') THEN
    ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_accion_id_fkey" FOREIGN KEY ("accion_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'aprobaciones_accion_aprobador_id_fkey') THEN
    ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_aprobador_id_fkey" FOREIGN KEY ("aprobador_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seguimientos_causa_causa_fk') THEN
    ALTER TABLE "seguimientos_causa" ADD CONSTRAINT "seguimientos_causa_causa_fk" FOREIGN KEY ("causa_id") REFERENCES "causas_accion_correctiva"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seguimientos_causa_usuario_fk') THEN
    ALTER TABLE "seguimientos_causa" ADD CONSTRAINT "seguimientos_causa_usuario_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'seguimientos_correccion_inmediata_accion_correctiva_id_fkey') THEN
    ALTER TABLE "seguimientos_correccion_inmediata" ADD CONSTRAINT "seguimientos_correccion_inmediata_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ciclos_seguimiento_eficacia_accion_correctiva_id_fkey') THEN
    ALTER TABLE "ciclos_seguimiento_eficacia" ADD CONSTRAINT "ciclos_seguimiento_eficacia_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidencias_eficacia_cierre_accion_correctiva_id_fkey') THEN
    ALTER TABLE "evidencias_eficacia_cierre" ADD CONSTRAINT "evidencias_eficacia_cierre_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_concepto_liquidacion_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_concepto_conductor_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_liquidacion_servicio_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_liquidacion_servicio_id_fkey" FOREIGN KEY ("liquidacion_servicio_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_vehiculo_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_creado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_estado_liquidacion_tercero_final_liquidacion_ter_fkey') THEN
    ALTER TABLE "historial_estado_liquidacion_tercero_final" ADD CONSTRAINT "historial_estado_liquidacion_tercero_final_liquidacion_ter_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'historial_estado_liquidacion_tercero_final_usuario_id_fkey') THEN
    ALTER TABLE "historial_estado_liquidacion_tercero_final" ADD CONSTRAINT "historial_estado_liquidacion_tercero_final_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_envio_cierre_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_envio" ADD CONSTRAINT "liquidacion_tercero_envio_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_envio_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_envio" ADD CONSTRAINT "liquidacion_tercero_envio_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_adicional_liquidacion_tercero_fi_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "liquidacion_tercero_final_adicional_liquidacion_tercero_fi_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_adicional_creado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "liquidacion_tercero_final_adicional_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_adicional_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "liquidacion_tercero_final_adicional_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_adicional_periodo_snapshot_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" ADD CONSTRAINT "liquidacion_tercero_adicional_periodo_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_adicional_periodo_snapshot_revertido_d_fkey') THEN
    ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" ADD CONSTRAINT "liquidacion_tercero_adicional_periodo_snapshot_revertido_d_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_adicional_periodo_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_item_liquidacion_tercero_final_i_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liquidacion_tercero_final_item_liquidacion_tercero_final_i_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_item_liquidacion_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liquidacion_tercero_final_item_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_concepto_liquidacion_tercero_fin_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_liquidacion_tercero_fin_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_concepto_conductor_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_concepto_propietario_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_propietario_id_fkey" FOREIGN KEY ("propietario_id") REFERENCES "liquidacion_tercero_final_propietario"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_propietario_liquidacion_tercero__fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_propietario_liquidacion_tercero__fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_propietario_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_propietario_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_snapshot_liquidacion_tercero_fin_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_liquidacion_tercero_fin_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_snapshot_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_final_snapshot_revertido_de_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_final_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excesos_velocidad_conductor_id_fkey') THEN
    ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'excesos_velocidad_vehiculo_id_fkey') THEN
    ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preoperacionales_conductor_id_fkey') THEN
    ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'preoperacionales_vehiculo_id_fkey') THEN
    ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inducciones_visitantes_creado_por_id_fkey') THEN
    ALTER TABLE "inducciones_visitantes" ADD CONSTRAINT "inducciones_visitantes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_actualizado_por_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_creado_por_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_responsable_ejecucion_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_responsable_ejecucion_id_fkey" FOREIGN KEY ("responsable_ejecucion_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificado_archivo_tercero_id_fkey') THEN
    ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificado_archivo_tipo_certificado_id_fkey') THEN
    ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tipo_certificado_id_fkey" FOREIGN KEY ("tipo_certificado_id") REFERENCES "tipo_certificado"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificado_tercero_tercero_id_fkey') THEN
    ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificado_tercero_certificado_id_fkey') THEN
    ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificacion_envio_tercero_id_fkey') THEN
    ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'certificacion_envio_certificado_id_fkey') THEN
    ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tercero_token_tercero_id_fkey') THEN
    ALTER TABLE "tercero_token" ADD CONSTRAINT "tercero_token_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_chat_mensaje_liquidacion_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "liquidacion_chat_mensaje_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_chat_mensaje_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "liquidacion_chat_mensaje_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_recordatorio_liquidacion_origen_id_fkey') THEN
    ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_liquidacion_origen_id_fkey" FOREIGN KEY ("liquidacion_origen_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_recordatorio_creado_por_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_creado_por_usuario_id_fkey" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_recordatorio_aplicado_en_liquidacion_id_fkey') THEN
    ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_aplicado_en_liquidacion_id_fkey" FOREIGN KEY ("aplicado_en_liquidacion_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_creado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional" ADD CONSTRAINT "liquidacion_tercero_ocasional_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional" ADD CONSTRAINT "liquidacion_tercero_ocasional_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_adicional_liquidacion_ocasio_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_liquidacion_ocasio_fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_adicional_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_adicional_vehiculo_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_item_liquidacion_ocasional_i_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_ocasional_i_fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_item_liquidacion_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_item_tercero_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_draft_liquidacion_ocasional__fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_liquidacion_ocasional__fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_draft_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_concepto_liquidacion_ocasion_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_liquidacion_ocasion_fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_concepto_conductor_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_concepto_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_snapshot_liquidacion_ocasion_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasion_fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_snapshot_usuario_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_tercero_ocasional_snapshot_revertido_de_id_fkey') THEN
    ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_ocasional_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_places_municipio_id_fkey') THEN
    ALTER TABLE "custom_places" ADD CONSTRAINT "custom_places_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'custom_places_creado_por_id_fkey') THEN
    ALTER TABLE "custom_places" ADD CONSTRAINT "custom_places_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canvas_anotacion_creado_por_id_fkey') THEN
    ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'canvas_anotacion_actualizado_por_id_fkey') THEN
    ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_creado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso__fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso__fkey" FOREIGN KEY ("liquidacion_ingreso_id") REFERENCES "liquidacion_ingreso_transmeralda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_fila_liquidacion_tercero__fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_liquidacion_tercero__fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_fila_adicional_id_fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_adicional_id_fkey" FOREIGN KEY ("adicional_id") REFERENCES "liquidacion_tercero_final_adicional"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_fila_actualizado_por_id_fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_concepto_liquidacion_ingr_fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_concepto" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_concepto_liquidacion_ingr_fkey" FOREIGN KEY ("liquidacion_ingreso_id") REFERENCES "liquidacion_ingreso_transmeralda"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidacion_ingreso_transmeralda_concepto_actualizado_por__fkey') THEN
    ALTER TABLE "liquidacion_ingreso_transmeralda_concepto" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_concepto_actualizado_por__fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
END $$;

