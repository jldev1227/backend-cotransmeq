-- Centro de cumplimiento PESV — modelo persistente.
--
-- MOTIVO
--
-- El módulo PESV era un panel de conteos sobre planillas: días trabajados,
-- un booleano de preoperacional y un total mensual de excesos. No había con
-- qué demostrar un solo paso de la metodología ni con qué reproducir un
-- indicador, y «cumple» acababa significando «hay un archivo subido».
--
-- QUÉ AÑADE
--
--   1. Ciclo anual, matriz de 24 pasos, evidencias con revisión e historial.
--   2. Metas, riesgos, programas críticos y cobertura de flota.
--   3. Siniestros estructurados y eventos de velocidad individuales.
--   4. Planes y eventos de mantenimiento con hoja de vida por vehículo.
--   5. Contratos de transporte y extractos FUEC relacionales, con bandeja de
--      conciliación para lo que el TXT no permita resolver con seguridad.
--   6. Normalización documental sobre la tabla `documento` que ya existe.
--   7. Bitácora de auditoría del módulo.
--
-- QUÉ NO HACE
--
-- No borra ni reescribe una sola fila. `preoperacionales`, `excesos_velocidad`
-- y `dias_laborales_planillas.siniestros` se quedan como están y se exponen
-- como serie histórica: un booleano diario y un total mensual no prueban el
-- evento, así que convertirlos en registros detallados sería inventarlos.
--
-- Las columnas nuevas de `documento` nacen todas NULL salvo `estado_revision`,
-- que nace `PENDIENTE` a propósito: los documentos cargados hasta hoy no han
-- pasado por revisión de HSEQ y decir lo contrario sería justo el problema que
-- este módulo viene a resolver.
--
-- `documento.tercero_id`, `documento.contrato_id` y `documento.revisado_por_id`
-- se crean SIN clave foránea: la tabla arrastra filas cuyo `conductor_id` ya no
-- existe, y añadir integridad referencial ahora exigiría depurarlas primero.
--
-- Es idempotente y se puede reintentar entera.

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_nivel') THEN
    CREATE TYPE "enum_pesv_nivel" AS ENUM ('BASICO', 'ESTANDAR', 'AVANZADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_ciclo_estado') THEN
    CREATE TYPE "enum_pesv_ciclo_estado" AS ENUM ('BORRADOR', 'ACTIVO', 'CERRADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_requisito_estado') THEN
    CREATE TYPE "enum_pesv_requisito_estado" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'EN_REVISION', 'CUMPLE', 'NO_CUMPLE', 'NO_APLICA');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_evidencia_origen') THEN
    CREATE TYPE "enum_pesv_evidencia_origen" AS ENUM ('ARCHIVO', 'REGISTRO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_revision_estado') THEN
    CREATE TYPE "enum_pesv_revision_estado" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_meta_sentido') THEN
    CREATE TYPE "enum_pesv_meta_sentido" AS ENUM ('MAYOR_ES_MEJOR', 'MENOR_ES_MEJOR');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_riesgo_nivel') THEN
    CREATE TYPE "enum_pesv_riesgo_nivel" AS ENUM ('BAJO', 'MEDIO', 'ALTO', 'CRITICO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_severidad') THEN
    CREATE TYPE "enum_pesv_severidad" AS ENUM ('FATALIDAD', 'LESION_GRAVE', 'LESION_LEVE', 'SOLO_DANOS');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_trayecto') THEN
    CREATE TYPE "enum_pesv_trayecto" AS ENUM ('LABORAL', 'IN_ITINERE', 'MISION', 'PARTICULAR');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_mantenimiento_tipo') THEN
    CREATE TYPE "enum_pesv_mantenimiento_tipo" AS ENUM ('PREVENTIVO', 'CORRECTIVO', 'PREDICTIVO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_mantenimiento_estado') THEN
    CREATE TYPE "enum_pesv_mantenimiento_estado" AS ENUM ('PROGRAMADO', 'EJECUTADO', 'CANCELADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_pesv_contrato_estado') THEN
    CREATE TYPE "enum_pesv_contrato_estado" AS ENUM ('BORRADOR', 'VIGENTE', 'VENCIDO', 'TERMINADO', 'ANULADO');
  END IF;
END $$;

-- CreateEnum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_fuec_estado') THEN
    CREATE TYPE "enum_fuec_estado" AS ENUM ('BORRADOR', 'VIGENTE', 'VENCIDO', 'ANULADO');
  END IF;
END $$;

-- AlterTable
ALTER TABLE "documento" ADD COLUMN IF NOT EXISTS     "contrato_id" UUID,
ADD COLUMN IF NOT EXISTS     "deleted_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "emisor" VARCHAR(255),
ADD COLUMN IF NOT EXISTS     "estado_revision" "enum_pesv_revision_estado" NOT NULL DEFAULT 'PENDIENTE',
ADD COLUMN IF NOT EXISTS     "fecha_expedicion" DATE,
ADD COLUMN IF NOT EXISTS     "fecha_vencimiento" DATE,
ADD COLUMN IF NOT EXISTS     "numero" VARCHAR(80),
ADD COLUMN IF NOT EXISTS     "observacion_revision" TEXT,
ADD COLUMN IF NOT EXISTS     "revisado_at" TIMESTAMPTZ(6),
ADD COLUMN IF NOT EXISTS     "revisado_por_id" UUID,
ADD COLUMN IF NOT EXISTS     "tercero_id" UUID,
ADD COLUMN IF NOT EXISTS     "tipo_documento" VARCHAR(60);

-- AlterTable
ALTER TABLE "servicios" ADD COLUMN IF NOT EXISTS     "contrato_id" UUID,
ADD COLUMN IF NOT EXISTS     "fuec_id" UUID;

-- AlterTable
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS     "origen_pesv" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "pesv_cycle_id" UUID,
ADD COLUMN IF NOT EXISTS     "pesv_step_number" INTEGER;

-- AlterTable
ALTER TABLE "actividades_pesv" ADD COLUMN IF NOT EXISTS     "cycle_id" UUID,
ADD COLUMN IF NOT EXISTS     "fecha_planificada_fin" DATE,
ADD COLUMN IF NOT EXISTS     "fecha_planificada_inicio" DATE,
ADD COLUMN IF NOT EXISTS     "goal_id" UUID,
ADD COLUMN IF NOT EXISTS     "program_id" UUID,
ADD COLUMN IF NOT EXISTS     "requiere_evidencia" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS     "step_number" INTEGER;

-- AlterTable
ALTER TABLE "form_assignments" ADD COLUMN IF NOT EXISTS     "pesv_proposito" VARCHAR(40),
ADD COLUMN IF NOT EXISTS     "pesv_step_number" INTEGER;

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_cycle" (
    "id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "nivel" "enum_pesv_nivel" NOT NULL DEFAULT 'AVANZADO',
    "estado" "enum_pesv_ciclo_estado" NOT NULL DEFAULT 'BORRADOR',
    "version" INTEGER NOT NULL DEFAULT 1,
    "lider_id" UUID,
    "lider_nombre" VARCHAR(255),
    "lider_cargo" VARCHAR(255),
    "vigencia_desde" DATE,
    "vigencia_hasta" DATE,
    "dias_por_vencer" INTEGER NOT NULL DEFAULT 30,
    "observaciones" TEXT,
    "cerrado_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_cycle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_requirement_status" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "step_number" INTEGER NOT NULL,
    "estado" "enum_pesv_requisito_estado" NOT NULL DEFAULT 'PENDIENTE',
    "area_responsable" VARCHAR(40),
    "responsable_id" UUID,
    "fecha_limite" DATE,
    "justificacion" TEXT,
    "notas" TEXT,
    "completado_at" TIMESTAMPTZ(6),
    "deleted_at" TIMESTAMPTZ(6),
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_requirement_status_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_evidence" (
    "id" UUID NOT NULL,
    "requirement_id" UUID NOT NULL,
    "origen" "enum_pesv_evidencia_origen" NOT NULL,
    "titulo" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "s3_key" VARCHAR(500),
    "nombre_archivo" VARCHAR(255),
    "mime_type" VARCHAR(120),
    "size_bytes" INTEGER,
    "sha256" VARCHAR(64),
    "source_domain" VARCHAR(60),
    "source_id" UUID,
    "source_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "fecha_documento" DATE,
    "vigencia_desde" DATE,
    "vigencia_hasta" DATE,
    "estado_revision" "enum_pesv_revision_estado" NOT NULL DEFAULT 'PENDIENTE',
    "revisado_por_id" UUID,
    "revisado_at" TIMESTAMPTZ(6),
    "observacion_revision" TEXT,
    "reemplaza_a_id" UUID,
    "cargado_por_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_evidence_review" (
    "id" UUID NOT NULL,
    "evidence_id" UUID NOT NULL,
    "decision" "enum_pesv_revision_estado" NOT NULL,
    "observacion" TEXT,
    "revisor_id" UUID,
    "revisor_nombre" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pesv_evidence_review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_goal" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "indicador_codigo" VARCHAR(20),
    "nombre" VARCHAR(255) NOT NULL,
    "descripcion" TEXT,
    "linea_base" DECIMAL(18,4),
    "valor_meta" DECIMAL(18,4),
    "unidad" VARCHAR(20),
    "sentido" "enum_pesv_meta_sentido" NOT NULL DEFAULT 'MAYOR_ES_MEJOR',
    "umbral_alerta" DECIMAL(18,4),
    "fecha_limite" DATE,
    "responsable_id" UUID,
    "lograda" BOOLEAN,
    "resultado_observacion" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_risk" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "codigo" VARCHAR(40),
    "proceso" VARCHAR(255),
    "actor_vial" VARCHAR(120),
    "peligro" TEXT NOT NULL,
    "exposicion" VARCHAR(120),
    "consecuencia" TEXT,
    "probabilidad_inicial" INTEGER,
    "severidad_inicial" INTEGER,
    "nivel_inicial" "enum_pesv_riesgo_nivel",
    "controles" TEXT,
    "probabilidad_final" INTEGER,
    "severidad_final" INTEGER,
    "nivel_final" "enum_pesv_riesgo_nivel",
    "responsable_id" UUID,
    "fecha_valoracion" DATE,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_risk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_program" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "alcance" TEXT,
    "lineamientos" TEXT,
    "fecha_inicio" DATE,
    "fecha_fin" DATE,
    "metodo_medicion" TEXT,
    "responsable_id" UUID,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_program_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_program_vehicle" (
    "id" UUID NOT NULL,
    "program_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "mecanismo" VARCHAR(60),
    "desde" DATE,
    "hasta" DATE,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_program_vehicle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_incident" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "consecutivo" INTEGER,
    "fecha" DATE NOT NULL,
    "hora" VARCHAR(5),
    "severidad" "enum_pesv_severidad" NOT NULL,
    "trayecto" "enum_pesv_trayecto" NOT NULL DEFAULT 'LABORAL',
    "tipo_evento" VARCHAR(60),
    "lugar" VARCHAR(255),
    "municipio_id" UUID,
    "descripcion" TEXT,
    "conductor_id" UUID,
    "vehiculo_id" UUID,
    "servicio_id" UUID,
    "cliente_id" UUID,
    "heridos" INTEGER DEFAULT 0,
    "fallecidos" INTEGER DEFAULT 0,
    "terceros_involucrados" INTEGER DEFAULT 0,
    "costo_directo" DECIMAL(14,2),
    "costo_indirecto" DECIMAL(14,2),
    "investigacion_realizada" BOOLEAN NOT NULL DEFAULT false,
    "causas_identificadas" TEXT,
    "fecha_investigacion" DATE,
    "accion_correctiva_id" UUID,
    "registrado_por_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_speed_event" (
    "id" UUID NOT NULL,
    "ocurrido_at" TIMESTAMPTZ(6) NOT NULL,
    "business_date" DATE NOT NULL,
    "vehiculo_id" UUID,
    "conductor_id" UUID,
    "servicio_id" UUID,
    "velocidad_kmh" DECIMAL(6,2),
    "limite_kmh" DECIMAL(6,2),
    "duracion_segundos" INTEGER,
    "latitud" DOUBLE PRECISION,
    "longitud" DOUBLE PRECISION,
    "via" VARCHAR(255),
    "fuente" VARCHAR(30) NOT NULL DEFAULT 'MANUAL',
    "observaciones" TEXT,
    "registrado_por_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_speed_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_training_plan" (
    "id" UUID NOT NULL,
    "cycle_id" UUID NOT NULL,
    "tema" VARCHAR(255) NOT NULL,
    "objetivo" TEXT,
    "tipo" VARCHAR(40) NOT NULL DEFAULT 'CAPACITACION',
    "trimestre" INTEGER,
    "fecha_planificada" DATE,
    "fecha_ejecucion" DATE,
    "poblacion_objetivo" INTEGER,
    "poblacion_snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "asistencia_id" UUID,
    "evaluacion_id" UUID,
    "responsable_id" UUID,
    "ejecutado" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_training_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "vehicle_maintenance_plan" (
    "id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "tipo" "enum_pesv_mantenimiento_tipo" NOT NULL DEFAULT 'PREVENTIVO',
    "periodicidad_dias" INTEGER,
    "periodicidad_km" INTEGER,
    "ultima_ejecucion_fecha" DATE,
    "ultima_ejecucion_km" INTEGER,
    "proxima_fecha" DATE,
    "proximo_km" INTEGER,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_maintenance_plan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "vehicle_maintenance_event" (
    "id" UUID NOT NULL,
    "plan_id" UUID,
    "vehiculo_id" UUID NOT NULL,
    "tipo" "enum_pesv_mantenimiento_tipo" NOT NULL DEFAULT 'PREVENTIVO',
    "estado" "enum_pesv_mantenimiento_estado" NOT NULL DEFAULT 'PROGRAMADO',
    "descripcion" TEXT NOT NULL,
    "fecha_programada" DATE,
    "km_programado" INTEGER,
    "fecha_ejecucion" DATE,
    "km_ejecucion" INTEGER,
    "taller" VARCHAR(255),
    "responsable" VARCHAR(255),
    "repuestos" TEXT,
    "costo" DECIMAL(14,2),
    "s3_key" VARCHAR(500),
    "observaciones" TEXT,
    "ejecutado_por_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "vehicle_maintenance_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "transport_contract" (
    "id" UUID NOT NULL,
    "numero" VARCHAR(60) NOT NULL,
    "contratante_nombre" VARCHAR(255) NOT NULL,
    "contratante_nit" VARCHAR(50),
    "cliente_id" UUID,
    "tercero_id" UUID,
    "objeto" TEXT,
    "tipo_servicio" VARCHAR(60),
    "origen" VARCHAR(255),
    "destino" VARCHAR(255),
    "fecha_inicio" DATE NOT NULL,
    "fecha_fin" DATE NOT NULL,
    "estado" "enum_pesv_contrato_estado" NOT NULL DEFAULT 'VIGENTE',
    "cantidad_vehiculos" INTEGER,
    "clase_vehiculos" VARCHAR(120),
    "s3_key" VARCHAR(500),
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "source_line" INTEGER,
    "source_text" TEXT,
    "source_hash" VARCHAR(64),
    "observaciones" TEXT,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "transport_contract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuec_extract" (
    "id" UUID NOT NULL,
    "consecutivo" INTEGER NOT NULL,
    "numero_completo" VARCHAR(80) NOT NULL,
    "contrato_id" UUID,
    "vehiculo_id" UUID,
    "vehiculo_placa" VARCHAR(20),
    "numero_interno" VARCHAR(40),
    "tarjeta_operacion" VARCHAR(60),
    "origen_destino" VARCHAR(500),
    "vigencia_desde" DATE NOT NULL,
    "vigencia_hasta" DATE NOT NULL,
    "estado" "enum_fuec_estado" NOT NULL DEFAULT 'VIGENTE',
    "responsable" VARCHAR(255),
    "s3_key" VARCHAR(500),
    "snapshot_json" JSONB NOT NULL DEFAULT '{}',
    "source" VARCHAR(20) NOT NULL DEFAULT 'MANUAL',
    "source_line" INTEGER,
    "source_text" TEXT,
    "source_hash" VARCHAR(64),
    "anulado_at" TIMESTAMPTZ(6),
    "anulado_por_id" UUID,
    "motivo_anulacion" TEXT,
    "reemplaza_a_id" UUID,
    "external_id" VARCHAR(120),
    "external_status" VARCHAR(60),
    "last_sync_at" TIMESTAMPTZ(6),
    "request_snapshot" JSONB,
    "response_snapshot" JSONB,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuec_extract_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuec_extract_driver" (
    "id" UUID NOT NULL,
    "fuec_id" UUID NOT NULL,
    "conductor_id" UUID,
    "nombre" VARCHAR(255) NOT NULL,
    "identificacion" VARCHAR(50),
    "licencia_vigencia" DATE,
    "orden" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fuec_extract_driver_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "fuec_import_issue" (
    "id" UUID NOT NULL,
    "source_hash" VARCHAR(64) NOT NULL,
    "source_line" INTEGER NOT NULL,
    "source_text" TEXT NOT NULL,
    "motivo" VARCHAR(60) NOT NULL,
    "detalle_json" JSONB NOT NULL DEFAULT '{}',
    "resuelto" BOOLEAN NOT NULL DEFAULT false,
    "resuelto_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "fuec_import_issue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_document_type_config" (
    "id" UUID NOT NULL,
    "tipo" VARCHAR(60) NOT NULL,
    "etiqueta" VARCHAR(120) NOT NULL,
    "ambito" VARCHAR(20) NOT NULL,
    "dias_por_vencer" INTEGER NOT NULL DEFAULT 30,
    "obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 100,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_document_type_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "pesv_audit_log" (
    "id" UUID NOT NULL,
    "entidad" VARCHAR(40) NOT NULL,
    "entidad_id" UUID,
    "accion" VARCHAR(60) NOT NULL,
    "usuario_id" UUID,
    "usuario_nombre" VARCHAR(255),
    "detalle_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pesv_audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_cycle_estado_idx" ON "pesv_cycle"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_cycle_deleted_at_idx" ON "pesv_cycle"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pesv_cycle_anio_activo_uniq"
  ON "pesv_cycle"("anio") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_requirement_status_cycle_id_estado_idx" ON "pesv_requirement_status"("cycle_id", "estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_requirement_status_responsable_id_idx" ON "pesv_requirement_status"("responsable_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_requirement_status_area_responsable_idx" ON "pesv_requirement_status"("area_responsable");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_requirement_status_deleted_at_idx" ON "pesv_requirement_status"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pesv_requirement_cycle_step_activo_uniq"
  ON "pesv_requirement_status"("cycle_id", "step_number") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_requirement_id_estado_revision_idx" ON "pesv_evidence"("requirement_id", "estado_revision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_estado_revision_idx" ON "pesv_evidence"("estado_revision");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_vigencia_hasta_idx" ON "pesv_evidence"("vigencia_hasta");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_source_domain_source_id_idx" ON "pesv_evidence"("source_domain", "source_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_deleted_at_idx" ON "pesv_evidence"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_evidence_review_evidence_id_created_at_idx" ON "pesv_evidence_review"("evidence_id", "created_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_goal_cycle_id_idx" ON "pesv_goal"("cycle_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_goal_indicador_codigo_idx" ON "pesv_goal"("indicador_codigo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_goal_deleted_at_idx" ON "pesv_goal"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_risk_cycle_id_idx" ON "pesv_risk"("cycle_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_risk_nivel_final_idx" ON "pesv_risk"("nivel_final");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_risk_deleted_at_idx" ON "pesv_risk"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_program_cycle_id_tipo_idx" ON "pesv_program"("cycle_id", "tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_program_deleted_at_idx" ON "pesv_program"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_program_vehicle_vehiculo_id_idx" ON "pesv_program_vehicle"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_program_vehicle_deleted_at_idx" ON "pesv_program_vehicle"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pesv_program_vehicle_activo_uniq"
  ON "pesv_program_vehicle"("program_id", "vehiculo_id") WHERE "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_incident_cycle_id_fecha_idx" ON "pesv_incident"("cycle_id", "fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_incident_fecha_severidad_idx" ON "pesv_incident"("fecha", "severidad");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_incident_conductor_id_idx" ON "pesv_incident"("conductor_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_incident_vehiculo_id_idx" ON "pesv_incident"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_incident_deleted_at_idx" ON "pesv_incident"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_speed_event_business_date_idx" ON "pesv_speed_event"("business_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_speed_event_vehiculo_id_business_date_idx" ON "pesv_speed_event"("vehiculo_id", "business_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_speed_event_conductor_id_business_date_idx" ON "pesv_speed_event"("conductor_id", "business_date");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_speed_event_servicio_id_idx" ON "pesv_speed_event"("servicio_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_speed_event_deleted_at_idx" ON "pesv_speed_event"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_training_plan_cycle_id_trimestre_idx" ON "pesv_training_plan"("cycle_id", "trimestre");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_training_plan_asistencia_id_idx" ON "pesv_training_plan"("asistencia_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_training_plan_deleted_at_idx" ON "pesv_training_plan"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_plan_vehiculo_id_activo_idx" ON "vehicle_maintenance_plan"("vehiculo_id", "activo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_plan_proxima_fecha_idx" ON "vehicle_maintenance_plan"("proxima_fecha");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_plan_deleted_at_idx" ON "vehicle_maintenance_plan"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_event_vehiculo_id_fecha_programada_idx" ON "vehicle_maintenance_event"("vehiculo_id", "fecha_programada");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_event_estado_idx" ON "vehicle_maintenance_event"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_event_plan_id_idx" ON "vehicle_maintenance_event"("plan_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vehicle_maintenance_event_deleted_at_idx" ON "vehicle_maintenance_event"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "transport_contract_source_hash_key" ON "transport_contract"("source_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transport_contract_numero_idx" ON "transport_contract"("numero");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transport_contract_cliente_id_idx" ON "transport_contract"("cliente_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transport_contract_fecha_inicio_fecha_fin_idx" ON "transport_contract"("fecha_inicio", "fecha_fin");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transport_contract_estado_idx" ON "transport_contract"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "transport_contract_deleted_at_idx" ON "transport_contract"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fuec_extract_source_hash_key" ON "fuec_extract"("source_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_consecutivo_idx" ON "fuec_extract"("consecutivo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_contrato_id_idx" ON "fuec_extract"("contrato_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_vehiculo_id_idx" ON "fuec_extract"("vehiculo_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_vigencia_desde_vigencia_hasta_idx" ON "fuec_extract"("vigencia_desde", "vigencia_hasta");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_estado_idx" ON "fuec_extract"("estado");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_deleted_at_idx" ON "fuec_extract"("deleted_at");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_driver_fuec_id_idx" ON "fuec_extract_driver"("fuec_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_extract_driver_conductor_id_idx" ON "fuec_extract_driver"("conductor_id");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "fuec_import_issue_source_hash_key" ON "fuec_import_issue"("source_hash");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_import_issue_resuelto_idx" ON "fuec_import_issue"("resuelto");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "fuec_import_issue_motivo_idx" ON "fuec_import_issue"("motivo");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "pesv_document_type_config_tipo_key" ON "pesv_document_type_config"("tipo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_document_type_config_ambito_activo_idx" ON "pesv_document_type_config"("ambito", "activo");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_audit_log_entidad_entidad_id_idx" ON "pesv_audit_log"("entidad", "entidad_id");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_audit_log_created_at_idx" ON "pesv_audit_log"("created_at" DESC);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "pesv_audit_log_usuario_id_idx" ON "pesv_audit_log"("usuario_id");

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicios_contrato_id_fkey') THEN
    ALTER TABLE "servicios" ADD CONSTRAINT "servicios_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "transport_contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'servicios_fuec_id_fkey') THEN
    ALTER TABLE "servicios" ADD CONSTRAINT "servicios_fuec_id_fkey" FOREIGN KEY ("fuec_id") REFERENCES "fuec_extract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acciones_correctivas_preventivas_pesv_cycle_id_fkey') THEN
    ALTER TABLE "acciones_correctivas_preventivas" ADD CONSTRAINT "acciones_correctivas_preventivas_pesv_cycle_id_fkey" FOREIGN KEY ("pesv_cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_cycle_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_program_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "pesv_program"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'actividades_pesv_goal_id_fkey') THEN
    ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_goal_id_fkey" FOREIGN KEY ("goal_id") REFERENCES "pesv_goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_cycle_lider_id_fkey') THEN
    ALTER TABLE "pesv_cycle" ADD CONSTRAINT "pesv_cycle_lider_id_fkey" FOREIGN KEY ("lider_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_cycle_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_cycle" ADD CONSTRAINT "pesv_cycle_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_cycle_actualizado_por_id_fkey') THEN
    ALTER TABLE "pesv_cycle" ADD CONSTRAINT "pesv_cycle_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_requirement_status_cycle_id_fkey') THEN
    ALTER TABLE "pesv_requirement_status" ADD CONSTRAINT "pesv_requirement_status_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_requirement_status_responsable_id_fkey') THEN
    ALTER TABLE "pesv_requirement_status" ADD CONSTRAINT "pesv_requirement_status_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_requirement_status_actualizado_por_id_fkey') THEN
    ALTER TABLE "pesv_requirement_status" ADD CONSTRAINT "pesv_requirement_status_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_requirement_id_fkey') THEN
    ALTER TABLE "pesv_evidence" ADD CONSTRAINT "pesv_evidence_requirement_id_fkey" FOREIGN KEY ("requirement_id") REFERENCES "pesv_requirement_status"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_cargado_por_id_fkey') THEN
    ALTER TABLE "pesv_evidence" ADD CONSTRAINT "pesv_evidence_cargado_por_id_fkey" FOREIGN KEY ("cargado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_revisado_por_id_fkey') THEN
    ALTER TABLE "pesv_evidence" ADD CONSTRAINT "pesv_evidence_revisado_por_id_fkey" FOREIGN KEY ("revisado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_reemplaza_a_id_fkey') THEN
    ALTER TABLE "pesv_evidence" ADD CONSTRAINT "pesv_evidence_reemplaza_a_id_fkey" FOREIGN KEY ("reemplaza_a_id") REFERENCES "pesv_evidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_review_evidence_id_fkey') THEN
    ALTER TABLE "pesv_evidence_review" ADD CONSTRAINT "pesv_evidence_review_evidence_id_fkey" FOREIGN KEY ("evidence_id") REFERENCES "pesv_evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_evidence_review_revisor_id_fkey') THEN
    ALTER TABLE "pesv_evidence_review" ADD CONSTRAINT "pesv_evidence_review_revisor_id_fkey" FOREIGN KEY ("revisor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_goal_cycle_id_fkey') THEN
    ALTER TABLE "pesv_goal" ADD CONSTRAINT "pesv_goal_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_goal_responsable_id_fkey') THEN
    ALTER TABLE "pesv_goal" ADD CONSTRAINT "pesv_goal_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_goal_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_goal" ADD CONSTRAINT "pesv_goal_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_risk_cycle_id_fkey') THEN
    ALTER TABLE "pesv_risk" ADD CONSTRAINT "pesv_risk_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_risk_responsable_id_fkey') THEN
    ALTER TABLE "pesv_risk" ADD CONSTRAINT "pesv_risk_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_risk_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_risk" ADD CONSTRAINT "pesv_risk_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_program_cycle_id_fkey') THEN
    ALTER TABLE "pesv_program" ADD CONSTRAINT "pesv_program_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_program_responsable_id_fkey') THEN
    ALTER TABLE "pesv_program" ADD CONSTRAINT "pesv_program_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_program_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_program" ADD CONSTRAINT "pesv_program_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_program_vehicle_program_id_fkey') THEN
    ALTER TABLE "pesv_program_vehicle" ADD CONSTRAINT "pesv_program_vehicle_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "pesv_program"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_program_vehicle_vehiculo_id_fkey') THEN
    ALTER TABLE "pesv_program_vehicle" ADD CONSTRAINT "pesv_program_vehicle_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_cycle_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_conductor_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_vehiculo_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_servicio_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_cliente_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_accion_correctiva_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_incident_registrado_por_id_fkey') THEN
    ALTER TABLE "pesv_incident" ADD CONSTRAINT "pesv_incident_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_speed_event_vehiculo_id_fkey') THEN
    ALTER TABLE "pesv_speed_event" ADD CONSTRAINT "pesv_speed_event_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_speed_event_conductor_id_fkey') THEN
    ALTER TABLE "pesv_speed_event" ADD CONSTRAINT "pesv_speed_event_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_speed_event_servicio_id_fkey') THEN
    ALTER TABLE "pesv_speed_event" ADD CONSTRAINT "pesv_speed_event_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_speed_event_registrado_por_id_fkey') THEN
    ALTER TABLE "pesv_speed_event" ADD CONSTRAINT "pesv_speed_event_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_training_plan_cycle_id_fkey') THEN
    ALTER TABLE "pesv_training_plan" ADD CONSTRAINT "pesv_training_plan_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "pesv_cycle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_training_plan_asistencia_id_fkey') THEN
    ALTER TABLE "pesv_training_plan" ADD CONSTRAINT "pesv_training_plan_asistencia_id_fkey" FOREIGN KEY ("asistencia_id") REFERENCES "formularios_asistencia"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_training_plan_evaluacion_id_fkey') THEN
    ALTER TABLE "pesv_training_plan" ADD CONSTRAINT "pesv_training_plan_evaluacion_id_fkey" FOREIGN KEY ("evaluacion_id") REFERENCES "Evaluacion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_training_plan_responsable_id_fkey') THEN
    ALTER TABLE "pesv_training_plan" ADD CONSTRAINT "pesv_training_plan_responsable_id_fkey" FOREIGN KEY ("responsable_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_training_plan_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_training_plan" ADD CONSTRAINT "pesv_training_plan_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_plan_vehiculo_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_plan" ADD CONSTRAINT "vehicle_maintenance_plan_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_plan_creado_por_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_plan" ADD CONSTRAINT "vehicle_maintenance_plan_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_event_plan_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_event" ADD CONSTRAINT "vehicle_maintenance_event_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "vehicle_maintenance_plan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_event_vehiculo_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_event" ADD CONSTRAINT "vehicle_maintenance_event_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_event_ejecutado_por_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_event" ADD CONSTRAINT "vehicle_maintenance_event_ejecutado_por_id_fkey" FOREIGN KEY ("ejecutado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicle_maintenance_event_creado_por_id_fkey') THEN
    ALTER TABLE "vehicle_maintenance_event" ADD CONSTRAINT "vehicle_maintenance_event_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_contract_cliente_id_fkey') THEN
    ALTER TABLE "transport_contract" ADD CONSTRAINT "transport_contract_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_contract_tercero_id_fkey') THEN
    ALTER TABLE "transport_contract" ADD CONSTRAINT "transport_contract_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transport_contract_creado_por_id_fkey') THEN
    ALTER TABLE "transport_contract" ADD CONSTRAINT "transport_contract_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_contrato_id_fkey') THEN
    ALTER TABLE "fuec_extract" ADD CONSTRAINT "fuec_extract_contrato_id_fkey" FOREIGN KEY ("contrato_id") REFERENCES "transport_contract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_vehiculo_id_fkey') THEN
    ALTER TABLE "fuec_extract" ADD CONSTRAINT "fuec_extract_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_creado_por_id_fkey') THEN
    ALTER TABLE "fuec_extract" ADD CONSTRAINT "fuec_extract_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_anulado_por_id_fkey') THEN
    ALTER TABLE "fuec_extract" ADD CONSTRAINT "fuec_extract_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_reemplaza_a_id_fkey') THEN
    ALTER TABLE "fuec_extract" ADD CONSTRAINT "fuec_extract_reemplaza_a_id_fkey" FOREIGN KEY ("reemplaza_a_id") REFERENCES "fuec_extract"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_driver_fuec_id_fkey') THEN
    ALTER TABLE "fuec_extract_driver" ADD CONSTRAINT "fuec_extract_driver_fuec_id_fkey" FOREIGN KEY ("fuec_id") REFERENCES "fuec_extract"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fuec_extract_driver_conductor_id_fkey') THEN
    ALTER TABLE "fuec_extract_driver" ADD CONSTRAINT "fuec_extract_driver_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- AddForeignKey
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_audit_log_usuario_id_fkey') THEN
    ALTER TABLE "pesv_audit_log" ADD CONSTRAINT "pesv_audit_log_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


-- Índices de la normalización documental.
--
-- `documento` no tenía ninguno: las alertas de vencimiento recorren la tabla
-- entera por `fecha_vencimiento` y el expediente de un conductor la recorre por
-- `conductor_id`, que hasta ahora era una columna suelta sin siquiera índice.
CREATE INDEX IF NOT EXISTS "documento_conductor_id_idx"     ON "documento"("conductor_id");
CREATE INDEX IF NOT EXISTS "documento_tipo_documento_idx"   ON "documento"("tipo_documento");
CREATE INDEX IF NOT EXISTS "documento_fecha_vencimiento_idx" ON "documento"("fecha_vencimiento");
CREATE INDEX IF NOT EXISTS "documento_estado_revision_idx"  ON "documento"("estado_revision");
CREATE INDEX IF NOT EXISTS "documento_deleted_at_idx"       ON "documento"("deleted_at");

-- Catálogo inicial de tipos documentales.
--
-- Se siembra aquí y no en un seed de aplicación porque las alertas del panel
-- dependen de que exista: sin filas, «próximo a vencer» no tendría ventana que
-- aplicar y todo documento con fecha aparecería como vigente hasta el día
-- siguiente a su vencimiento.
--
-- `ON CONFLICT DO NOTHING` sobre `tipo`, que es UNIQUE: si HSEQ ya ajustó los
-- días de preaviso de un tipo, reaplicar la migración no se los pisa.
INSERT INTO "pesv_document_type_config"
  ("id", "tipo", "etiqueta", "ambito", "dias_por_vencer", "obligatorio", "activo", "orden", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'LICENCIA_CONDUCCION', 'Licencia de conducción',      'CONDUCTOR', 30, true,  true, 10, now(), now()),
  (gen_random_uuid(), 'CERTIFICADO_MEDICO',  'Certificado médico',          'CONDUCTOR', 30, false, true, 20, now(), now()),
  (gen_random_uuid(), 'AFILIACION_SEGURIDAD_SOCIAL', 'Afiliación a seguridad social', 'CONDUCTOR', 30, true, true, 30, now(), now()),
  (gen_random_uuid(), 'SOAT',                'SOAT',                        'VEHICULO',  30, true,  true, 40, now(), now()),
  (gen_random_uuid(), 'RTM',                 'Revisión técnico-mecánica',   'VEHICULO',  30, true,  true, 50, now(), now()),
  (gen_random_uuid(), 'TARJETA_OPERACION',   'Tarjeta de operación',        'VEHICULO',  30, true,  true, 60, now(), now()),
  (gen_random_uuid(), 'TARJETA_PROPIEDAD',   'Tarjeta de propiedad',        'VEHICULO',  30, true,  true, 70, now(), now()),
  (gen_random_uuid(), 'POLIZA_RCC',          'Póliza de responsabilidad civil contractual',   'VEHICULO', 30, true, true, 80, now(), now()),
  (gen_random_uuid(), 'POLIZA_RCE',          'Póliza de responsabilidad civil extracontractual', 'VEHICULO', 30, true, true, 90, now(), now()),
  (gen_random_uuid(), 'SOPORTE_INSPECCION',  'Soporte de inspección',       'VEHICULO',  30, false, true, 100, now(), now()),
  (gen_random_uuid(), 'SOPORTE_MANTENIMIENTO','Soporte de mantenimiento',   'VEHICULO',  30, false, true, 110, now(), now()),
  (gen_random_uuid(), 'CONTRATO_TRANSPORTE', 'Contrato de transporte',      'CONTRATO',  30, true,  true, 120, now(), now()),
  (gen_random_uuid(), 'EXTRACTO_FUEC',       'Extracto del contrato (FUEC)','CONTRATO',  15, true,  true, 130, now(), now()),
  (gen_random_uuid(), 'EVIDENCIA_CAPACITACION', 'Evidencia de capacitación','EMPRESA',   30, false, true, 140, now(), now()),
  (gen_random_uuid(), 'HABILITACION_EMPRESA','Habilitación de la empresa',  'EMPRESA',   60, true,  true, 150, now(), now()),
  (gen_random_uuid(), 'SARLAFT_TERCERO',     'Documentación SARLAFT del tercero', 'TERCERO', 30, false, true, 160, now(), now())
ON CONFLICT ("tipo") DO NOTHING;

-- Política de jornada de conducción, con vigencia.
--
-- El indicador EJLC compara cada día contra el límite VIGENTE esa fecha. Con
-- una constante en el código, cambiar el límite reescribiría los meses ya
-- reportados.
--
-- Se siembra una fila con el límite de 8 horas diarias de conducción efectiva
-- que la empresa aplica hoy, vigente desde el 1 de enero del año en curso y sin
-- fecha de fin. HSEQ puede corregirla o cerrarla y abrir otra; lo que no se
-- puede es quedarse sin ninguna, porque entonces todos los días se excluyen
-- por `SIN_POLITICA_VIGENTE` y el indicador queda en SIN_DATOS.
CREATE TABLE IF NOT EXISTS "pesv_jornada_policy" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "horas_maximas_conduccion" DECIMAL(4,1) NOT NULL,
    "horas_descanso_minimo" DECIMAL(4,1),
    "vigente_desde" DATE NOT NULL,
    "vigente_hasta" DATE,
    "fundamento" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "deleted_at" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "pesv_jornada_policy_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "pesv_jornada_policy_vigente_desde_vigente_hasta_idx"
  ON "pesv_jornada_policy"("vigente_desde", "vigente_hasta");
CREATE INDEX IF NOT EXISTS "pesv_jornada_policy_deleted_at_idx"
  ON "pesv_jornada_policy"("deleted_at");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'pesv_jornada_policy_creado_por_id_fkey') THEN
    ALTER TABLE "pesv_jornada_policy" ADD CONSTRAINT "pesv_jornada_policy_creado_por_id_fkey"
      FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

INSERT INTO "pesv_jornada_policy"
  ("id", "nombre", "horas_maximas_conduccion", "horas_descanso_minimo",
   "vigente_desde", "vigente_hasta", "fundamento", "activo", "created_at", "updated_at")
SELECT
  gen_random_uuid(),
  'Límite diario de conducción efectiva',
  8.0,
  8.0,
  make_date(EXTRACT(YEAR FROM now())::int, 1, 1),
  NULL,
  'Valor de arranque aplicado por la empresa. HSEQ debe validarlo contra la jornada máxima legal vigente y su propio reglamento antes de cerrar el ciclo.',
  true,
  now(),
  now()
WHERE NOT EXISTS (SELECT 1 FROM "pesv_jornada_policy" WHERE "deleted_at" IS NULL);
