-- ============================================================
-- MIGRACIÓN: Cotransmeq -> Esquema de Transmeralda
-- Generado: 2026-07-21
-- Fuente  : transmeralda/backend-nest/prisma/schema.prisma
-- Destino : cotransmeq/backend-nest-main 2/prisma/schema.prisma
--
-- Esta migración aplica TODAS las diferencias del schema.prisma
-- de Transmeralda sobre la base de datos actual de Cotransmeq.
--
-- EJECUCIÓN:
--   - Automática:  npx prisma migrate deploy
--   - Manual    :  psql -U <user> -d <db> -f migration.sql
--
-- IMPORTANTE:
--   * Hacer BACKUP completo antes de ejecutar.
--   * Revisar el README.md incluido en esta misma carpeta.
--   * Prisma envuelve TODO el archivo en una transacción.
-- ============================================================

-- ============================================================
-- SECCIÓN 0: PRE-REQUISITOS
-- ============================================================
-- Habilita pgcrypto para gen_random_uuid() (usado por seguimientos_causa)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- SECCIÓN 1: CREAR ENUMS NUEVOS (16 enums solo en transmeralda)
-- ============================================================

-- 1.1 enum_users_area
CREATE TYPE "enum_users_area" AS ENUM (
  'administracion', 'operaciones', 'contabilidad', 'facturacion',
  'talento_humano', 'hseq'
);

-- 1.2 clasificacion_nc_enum
CREATE TYPE "clasificacion_nc_enum" AS ENUM (
  'CRITICA', 'MAYOR', 'MENOR'
);

-- 1.3 tipo_deteccion_enum
CREATE TYPE "tipo_deteccion_enum" AS ENUM (
  'DURANTE_SERVICIO', 'POST_SERVICIO', 'AUDITORIA_INTERVENTORIA',
  'REPORTE_CLIENTE', 'OTRO'
);

-- 1.4 tipo_salida_nc_enum
CREATE TYPE "tipo_salida_nc_enum" AS ENUM (
  'GPS_SISTEMA_TECNOLOGICO', 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO',
  'VEHICULO_DIFERENTE_SIN_APROBACION', 'FALLA_MECANICA_ELECTRICA',
  'DOCUMENTACION_VENCIDA_INCOMPLETA', 'CONDUCTOR_NO_APTO_INFRACCION_VIAL',
  'QUEJA_CLIENTE', 'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE',
  'PERSONAL_NO_AUTORIZADO_TRANSPORTADO', 'OTRO'
);

-- 1.5 estado_snc_enum
CREATE TYPE "estado_snc_enum" AS ENUM (
  'ABIERTA', 'EN_TRATAMIENTO', 'CERRADA'
);

-- 1.6 tratamiento_snc_enum
CREATE TYPE "tratamiento_snc_enum" AS ENUM (
  'CORRECCION', 'CONTENCION', 'SUSPENSION', 'CONCESION'
);

-- 1.7 medio_autorizacion_enum
CREATE TYPE "medio_autorizacion_enum" AS ENUM (
  'ESCRITO', 'CORREO', 'ACTA'
);

-- 1.8 metodo_verificacion_enum
CREATE TYPE "metodo_verificacion_enum" AS ENUM (
  'REVISION_DOCUMENTAL', 'VERIFICACION_OPERATIVA_CAMPO',
  'CONFIRMACION_GPS_PLATAFORMA', 'CONFIRMACION_CLIENTE_INTERVENTOR', 'OTRO'
);

-- 1.9 Sede
CREATE TYPE "Sede" AS ENUM (
  'yopal', 'villanueva', 'ambas', 'lugar_prestacion'
);

-- 1.10 enum_notificacion_tipo
CREATE TYPE "enum_notificacion_tipo" AS ENUM (
  'LIQUIDACION_ANULADA', 'LIQUIDACION_PENDIENTE', 'GENERAL',
  'LIQUIDACION_CREADA', 'LIQUIDACION_ACTUALIZADA',
  'ACTIVIDAD_PESV_ASIGNADA', 'ACTIVIDAD_PESV_ACTUALIZADA', 'ACTIVIDAD_PESV_VENCIDA',
  'LIQUIDACION_FACTURADA', 'FACTURA_ANULADA',
  'ACCION_CORRECTIVA_RECORDATORIO', 'ACCION_CORRECTIVA_VENCIDA'
);

-- 1.11 enum_actividad_pesv_estado
CREATE TYPE "enum_actividad_pesv_estado" AS ENUM (
  'PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'VENCIDA', 'CANCELADA'
);

-- 1.12 enum_actividad_pesv_prioridad
CREATE TYPE "enum_actividad_pesv_prioridad" AS ENUM (
  'BAJA', 'MEDIA', 'ALTA', 'CRITICA'
);

-- 1.13 enum_actividad_pesv_frecuencia
CREATE TYPE "enum_actividad_pesv_frecuencia" AS ENUM (
  'UNICA', 'DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL',
  'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL'
);

-- 1.14 HallazgoTipo
CREATE TYPE "HallazgoTipo" AS ENUM (
  'NC_MAYOR', 'NC_MENOR', 'OBSERVACION', 'MEJORA'
);

-- 1.15 EstadoAprobacion
CREATE TYPE "EstadoAprobacion" AS ENUM (
  'PENDIENTE', 'APROBADO', 'RECHAZADO'
);

-- 1.16 ActionStatusGlobal
CREATE TYPE "ActionStatusGlobal" AS ENUM (
  'EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA'
);

-- ============================================================
-- SECCIÓN 2: ACTUALIZAR ENUMS EXISTENTES
-- ============================================================

-- 2.1 enum_terceros_tipo_persona: añadir PROPIETARIO_VEHICULO, PROVEEDOR
ALTER TYPE "enum_terceros_tipo_persona" ADD VALUE IF NOT EXISTS 'PROPIETARIO_VEHICULO';
ALTER TYPE "enum_terceros_tipo_persona" ADD VALUE IF NOT EXISTS 'PROVEEDOR';

-- 2.2 enum_conductores_estado: añadir 'programado'
ALTER TYPE "enum_conductores_estado" ADD VALUE IF NOT EXISTS 'programado';

-- 2.3 tipo_servicio_tarifa_enum: REEMPLAZO TOTAL DE VALORES
--   Antiguos: HORA_24, HORA_12, HORA, KILOMETRO
--   Nuevos  : TRANSPORTE_* (7 valores)
-- Estrategia: crear nuevo enum, migrar columnas, eliminar antiguo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'tipo_servicio_tarifa_enum') THEN
    CREATE TYPE "tipo_servicio_tarifa_enum_new" AS ENUM (
      'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA',
      'TRANSPORTE_DE_PERSONAL_EN_BUSETA',
      'TRANSPORTE_DE_PERSONAL_EN_MICROBUS',
      'TRANSPORTE_DE_PERSONAL_EN_BUS',
      'TRANSPORTE_ADICIONAL_HORA_ADICIONAL',
      'TRANSPORTE_ADICIONAL_KM_ADICIONAL',
      'TRANSPORTE_ADICIONAL_DISPONIBILIDAD'
    );

    -- Backup del valor actual (mapeo interpretativo - revisar con negocio)
    CREATE TEMP TABLE _lsi_tipo_mapping AS
      SELECT
        id,
        CASE tipo_servicio
          WHEN 'HORA_24'   THEN 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA'::tipo_servicio_tarifa_enum_new
          WHEN 'HORA_12'   THEN 'TRANSPORTE_DE_PERSONAL_EN_BUSETA'::tipo_servicio_tarifa_enum_new
          WHEN 'HORA'      THEN 'TRANSPORTE_ADICIONAL_HORA_ADICIONAL'::tipo_servicio_tarifa_enum_new
          WHEN 'KILOMETRO' THEN 'TRANSPORTE_ADICIONAL_KM_ADICIONAL'::tipo_servicio_tarifa_enum_new
          ELSE 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA'::tipo_servicio_tarifa_enum_new
        END AS new_val
      FROM liquidacion_servicio_item
      WHERE tipo_servicio IS NOT NULL;

    ALTER TABLE liquidacion_servicio_item ALTER COLUMN tipo_servicio DROP DEFAULT;
    ALTER TABLE liquidacion_servicio_item
      ALTER COLUMN tipo_servicio TYPE tipo_servicio_tarifa_enum_new
      USING 'TRANSPORTE_DE_PERSONAL_EN_CAMIONETA'::tipo_servicio_tarifa_enum_new;

    UPDATE liquidacion_servicio_item lsi
      SET tipo_servicio = m.new_val
      FROM _lsi_tipo_mapping m
      WHERE lsi.id = m.id;

    DROP TYPE tipo_servicio_tarifa_enum;
    ALTER TYPE tipo_servicio_tarifa_enum_new RENAME TO tipo_servicio_tarifa_enum;
  END IF;
END $$;

-- ============================================================
-- SECCIÓN 3: NORMALIZAR ENUMS CASE-SENSITIVE (Postgres distingue)
-- ============================================================

-- 3.1 enum_conductores_estado: normalización case-insensitive
-- Estrategia: crear un enum nuevo con los valores exactos de transmeralda,
-- migrar la columna usando LOWER() para tolerar mayúsculas/minúsculas,
-- reemplazar el enum. Es idempotente y robusto.
DO $$
BEGIN
  -- Solo actuar si el enum actual aún tiene valores en MAYÚSCULAS
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'enum_conductores_estado'
      AND e.enumlabel IN ('ACTIVO','INACTIVO','SUSPENDIDO','RETIRADO')
  ) THEN
    CREATE TYPE "enum_conductores_estado_new" AS ENUM (
      'activo', 'inactivo', 'suspendido', 'retirado', 'disponible',
      'programado', 'servicio', 'descanso', 'vacaciones', 'incapacidad', 'desvinculado'
    );

    ALTER TABLE conductores ALTER COLUMN estado DROP DEFAULT;

    -- Forzar todos los datos a minúscula; LOWER() de un valor ya minúscula no cambia nada
    ALTER TABLE conductores
      ALTER COLUMN estado TYPE enum_conductores_estado_new
      USING LOWER(estado::text)::enum_conductores_estado_new;

    ALTER TABLE conductores
      ALTER COLUMN estado SET DEFAULT 'activo'::enum_conductores_estado_new;

    DROP TYPE enum_conductores_estado;
    ALTER TYPE enum_conductores_estado_new RENAME TO enum_conductores_estado;
  END IF;
END $$;

-- 3.2 enum_vehiculos_estado: caso especial con duplicados
-- Antiguos: DISPONIBLE, NO_DISPONIBLE, SERVICIO, MANTENIMIENTO, INACTIVO,
--           DESVINCULADO, activo, inactivo, mantenimiento
-- Nuevos  : disponible, programado, servicio, mantenimiento, inactivo, desvinculado
-- Mapeo interpretativo de NO_DISPONIBLE -> inactivo (REVISAR con negocio).
DO $$
BEGIN
  -- Solo actuar si el enum actual aún tiene los valores antiguos en MAYÚSCULAS
  IF EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'enum_vehiculos_estado'
      AND e.enumlabel IN ('DISPONIBLE','NO_DISPONIBLE','SERVICIO','MANTENIMIENTO','INACTIVO','DESVINCULADO')
  ) THEN
    CREATE TYPE "enum_vehiculos_estado_new" AS ENUM (
      'disponible', 'programado', 'servicio', 'mantenimiento', 'inactivo', 'desvinculado'
    );

    ALTER TABLE vehiculos ALTER COLUMN estado DROP DEFAULT;

    -- Mapeo: normalizar mayúsculas y traducir NO_DISPONIBLE → inactivo
    ALTER TABLE vehiculos
      ALTER COLUMN estado TYPE enum_vehiculos_estado_new
      USING (
        CASE LOWER(estado::text)
          WHEN 'disponible'    THEN 'disponible'
          WHEN 'no_disponible' THEN 'inactivo'  -- mapeo interpretativo
          WHEN 'servicio'      THEN 'servicio'
          WHEN 'mantenimiento' THEN 'mantenimiento'
          WHEN 'inactivo'      THEN 'inactivo'
          WHEN 'desvinculado'  THEN 'desvinculado'
          ELSE LOWER(estado::text)
        END::enum_vehiculos_estado_new
      );

    ALTER TABLE vehiculos
      ALTER COLUMN estado SET DEFAULT 'disponible'::enum_vehiculos_estado_new;

    DROP TYPE enum_vehiculos_estado;
    ALTER TYPE enum_vehiculos_estado_new RENAME TO enum_vehiculos_estado;
  END IF;
END $$;

-- ============================================================
-- SECCIÓN 4: AÑADIR COLUMNAS FALTANTES A TABLAS EXISTENTES
-- ============================================================

-- 4.1 Evaluacion
ALTER TABLE "Evaluacion" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- 4.2 conductores
ALTER TABLE "conductores" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- 4.3 firmas_desprendibles
ALTER TABLE "firmas_desprendibles" ADD COLUMN IF NOT EXISTS "expires_at" TIMESTAMPTZ(6);
-- token: transmeralda = String? @unique @db.VarChar(128)
-- Si ya existe la columna token sin unique, se ajusta tamaño y se crea unique.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'firmas_desprendibles' AND column_name = 'token'
  ) THEN
    -- Ajustar tamaño si es mayor a 128
    ALTER TABLE "firmas_desprendibles"
      ALTER COLUMN "token" TYPE VARCHAR(128) USING "token"::VARCHAR(128);
    -- Crear unique constraint si no existe
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = 'firmas_desprendibles_token_key'
    ) THEN
      ALTER TABLE "firmas_desprendibles" ADD CONSTRAINT "firmas_desprendibles_token_key" UNIQUE ("token");
    END IF;
  ELSE
    ALTER TABLE "firmas_desprendibles" ADD COLUMN "token" VARCHAR(128) UNIQUE;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS "idx_firmas_desprendibles_token" ON "firmas_desprendibles" ("token");

-- 4.4 formularios_asistencia
ALTER TABLE "formularios_asistencia" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
CREATE INDEX IF NOT EXISTS "formularios_asistencia_deleted_at_idx" ON "formularios_asistencia" ("deleted_at");

-- 4.5 respuestas_asistencia
ALTER TABLE "respuestas_asistencia" ADD COLUMN IF NOT EXISTS "pertenece_comite" BOOLEAN;
ALTER TABLE "respuestas_asistencia" ADD COLUMN IF NOT EXISTS "nombre_comite" VARCHAR(255);

-- 4.6 liquidaciones
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "es_cotransmeq" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "descontar_salud_salario" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "liquidaciones" ADD COLUMN IF NOT EXISTS "descontar_pension_salario" BOOLEAN NOT NULL DEFAULT false;

-- 4.7 liquidacion_servicio
ALTER TABLE "liquidacion_servicio" ADD COLUMN IF NOT EXISTS "cantidad_pernoctes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_servicio" ADD COLUMN IF NOT EXISTS "valor_unitario_pernoctes" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_servicio" ADD COLUMN IF NOT EXISTS "operadora" TEXT;

-- 4.8 liquidacion_tercero
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "mes" INTEGER;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "anio" INTEGER;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "total_costos_laborales" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "total_gastos_operativos" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "total_impuestos" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "total_descuentos" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "total_pagar" NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE "liquidacion_tercero" ADD COLUMN IF NOT EXISTS "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR';

-- 4.9 recargos
ALTER TABLE "recargos" ADD COLUMN IF NOT EXISTS "origen_planilla_id" UUID;
ALTER TABLE "recargos" ADD COLUMN IF NOT EXISTS "es_override" BOOLEAN NOT NULL DEFAULT false;

-- 4.10 usuarios
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "es_invitado" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "invitado_por_id" UUID;

-- 4.11 dias_laborales_planillas: 5 columnas nuevas
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "horas_sueno" NUMERIC(4,2);
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "excesos_velocidad_dia" INTEGER DEFAULT 0;
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "preoperacional_realizado" BOOLEAN DEFAULT false;
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "siniestros" INTEGER DEFAULT 0;
ALTER TABLE "dias_laborales_planillas" ADD COLUMN IF NOT EXISTS "siniestros_detalle" TEXT;

-- 4.12 acciones_correctivas_preventivas: 24 columnas nuevas
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fuente_genero_hallazgo_otros" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "tipo_hallazgo_otros" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "hallazgo_tipo" "HallazgoTipo";
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "aplica_correccion_inmediata" BOOLEAN DEFAULT true;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "justificacion_no_correccion" TEXT;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "responsable_correccion" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "registrado_por_id" UUID;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fecha_limite_cierre_accion" DATE;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "responsable_ejecucion" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fecha_seguimiento" DATE;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "estado_accion" VARCHAR(100);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "estado_global" "ActionStatusGlobal" NOT NULL DEFAULT 'EN_PROCESO';
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "estado_aprobacion" VARCHAR(20) DEFAULT 'PENDIENTE';
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fecha_actualizacion_estado" DATE;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "observaciones" TEXT;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "matriz_a_actualizar" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fecha_limite_evaluacion_eficacia" DATE;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "cargo_responsable_cierre" VARCHAR(255);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "observaciones_cierre" TEXT;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "evaluaciones_eficacia" JSONB;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "aplica_reapertura" BOOLEAN DEFAULT false;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "fecha_reapertura" DATE;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "razon_reapertura" TEXT;
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "accion_origen_reapertura" VARCHAR(50);
ALTER TABLE "acciones_correctivas_preventivas" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);

-- 4.13 causas_accion_correctiva: 9 columnas nuevas
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "es_causa_raiz" BOOLEAN DEFAULT false;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "fecha_evaluacion_eficacia" DATE;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "criterio_evaluacion_eficacia" TEXT;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "analisis_evidencias_cierre" TEXT;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "evaluacion_cierre_eficaz" VARCHAR(50);
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "soporte_cierre_eficaz" TEXT;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "fecha_cierre" DATE;
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "responsable_cierre" VARCHAR(255);
ALTER TABLE "causas_accion_correctiva" ADD COLUMN IF NOT EXISTS "sugerencia_ia" JSONB;

-- ============================================================
-- SECCIÓN 5: MODIFICAR TIPOS DE COLUMNAS EXISTENTES
-- ============================================================

-- 5.1 detalles_recargos_dias.horas: NUMERIC(5,2) → NUMERIC(4,2)
ALTER TABLE "detalles_recargos_dias"
  ALTER COLUMN "horas" TYPE NUMERIC(4,2) USING "horas"::NUMERIC(4,2);

-- 5.2 dias_laborales_planillas: precisión de horas
ALTER TABLE "dias_laborales_planillas"
  ALTER COLUMN "hora_inicio"      TYPE NUMERIC(4,2) USING "hora_inicio"::NUMERIC(4,2),
  ALTER COLUMN "hora_fin"         TYPE NUMERIC(4,2) USING "hora_fin"::NUMERIC(4,2),
  ALTER COLUMN "total_horas"      TYPE NUMERIC(4,2) USING "total_horas"::NUMERIC(4,2),
  ALTER COLUMN "horas_ordinarias" TYPE NUMERIC(4,2) USING "horas_ordinarias"::NUMERIC(4,2);

-- 5.3 dias_laborales_planillas.continua_siguiente_dia: NOT NULL → NULL
ALTER TABLE "dias_laborales_planillas"
  ALTER COLUMN "continua_siguiente_dia" DROP NOT NULL;

-- 5.4 recargos_planillas: precisión de horas (6,2) → (5,2)
ALTER TABLE "recargos_planillas"
  ALTER COLUMN "total_horas_trabajadas" TYPE NUMERIC(5,2) USING "total_horas_trabajadas"::NUMERIC(5,2),
  ALTER COLUMN "total_horas_ordinarias" TYPE NUMERIC(5,2) USING "total_horas_ordinarias"::NUMERIC(5,2);

-- 5.5 liquidacion_servicio: Decimal(15,2) → Decimal(12,2)
-- ADVERTENCIA: si hay valores > 9,999,999,999.99 la conversión fallará.
-- Validar antes con: SELECT MAX(valor_servicios) FROM liquidacion_servicio;
DO $$
BEGIN
  IF (SELECT MAX(valor_servicios) FROM liquidacion_servicio) IS NULL
     OR (SELECT MAX(valor_servicios) FROM liquidacion_servicio) <= 9999999999.99 THEN
    ALTER TABLE "liquidacion_servicio"
      ALTER COLUMN "valor_servicios"            TYPE NUMERIC(12,2) USING "valor_servicios"::NUMERIC(12,2),
      ALTER COLUMN "valor_recargos"             TYPE NUMERIC(12,2) USING "valor_recargos"::NUMERIC(12,2),
      ALTER COLUMN "valor_transporte_adicional" TYPE NUMERIC(12,2) USING "valor_transporte_adicional"::NUMERIC(12,2),
      ALTER COLUMN "valor_administracion_ta"    TYPE NUMERIC(12,2) USING "valor_administracion_ta"::NUMERIC(12,2),
      ALTER COLUMN "valor_pernoctes"            TYPE NUMERIC(12,2) USING "valor_pernoctes"::NUMERIC(12,2),
      ALTER COLUMN "subtotal"                   TYPE NUMERIC(12,2) USING "subtotal"::NUMERIC(12,2),
      ALTER COLUMN "valor_iva"                  TYPE NUMERIC(12,2) USING "valor_iva"::NUMERIC(12,2),
      ALTER COLUMN "total"                      TYPE NUMERIC(12,2) USING "total"::NUMERIC(12,2);
  ELSE
    RAISE EXCEPTION 'Hay registros con valor_servicios > 9,999,999,999.99. Revisar antes de continuar.';
  END IF;
END $$;

-- 5.6 liquidacion_servicio_item: Decimal(15,2) → Decimal(12,2)
DO $$
BEGIN
  IF (SELECT MAX(valor_unitario) FROM liquidacion_servicio_item) IS NULL
     OR (SELECT MAX(valor_unitario) FROM liquidacion_servicio_item) <= 9999999999.99 THEN
    ALTER TABLE "liquidacion_servicio_item"
      ALTER COLUMN "valor_unitario"          TYPE NUMERIC(12,2) USING "valor_unitario"::NUMERIC(12,2),
      ALTER COLUMN "subtotal"                TYPE NUMERIC(12,2) USING "subtotal"::NUMERIC(12,2),
      ALTER COLUMN "valor_final"             TYPE NUMERIC(12,2) USING "valor_final"::NUMERIC(12,2),
      ALTER COLUMN "valor_recargos_total"    TYPE NUMERIC(12,2) USING "valor_recargos_total"::NUMERIC(12,2),
      ALTER COLUMN "valor_pernocte_unitario" TYPE NUMERIC(12,2) USING "valor_pernocte_unitario"::NUMERIC(12,2),
      ALTER COLUMN "valor_pernoctes_total"   TYPE NUMERIC(12,2) USING "valor_pernoctes_total"::NUMERIC(12,2);
  ELSE
    RAISE EXCEPTION 'Hay registros en liquidacion_servicio_item con valor_unitario > 9,999,999,999.99. Revisar antes de continuar.';
  END IF;
END $$;

-- 5.7 liquidacion_tercero: Decimal(15,2) → Decimal(12,2)
DO $$
BEGIN
  IF (SELECT MAX(valor_liquidar) FROM liquidacion_tercero) IS NULL
     OR (SELECT MAX(valor_liquidar) FROM liquidacion_tercero) <= 9999999999.99 THEN
    ALTER TABLE "liquidacion_tercero"
      ALTER COLUMN "valor_unitario"        TYPE NUMERIC(12,2) USING "valor_unitario"::NUMERIC(12,2),
      ALTER COLUMN "total_facturado"       TYPE NUMERIC(12,2) USING "total_facturado"::NUMERIC(12,2),
      ALTER COLUMN "valor_admin"           TYPE NUMERIC(12,2) USING "valor_admin"::NUMERIC(12,2),
      ALTER COLUMN "valor_liquidar"        TYPE NUMERIC(12,2) USING "valor_liquidar"::NUMERIC(12,2),
      ALTER COLUMN "ingreso_extra_global"  TYPE NUMERIC(12,2) USING "ingreso_extra_global"::NUMERIC(12,2),
      ALTER COLUMN "ingresos_extra_aval"   TYPE NUMERIC(12,2) USING "ingresos_extra_aval"::NUMERIC(12,2),
      ALTER COLUMN "ingreso_empresa"       TYPE NUMERIC(12,2) USING "ingreso_empresa"::NUMERIC(12,2);
  ELSE
    RAISE EXCEPTION 'Hay registros en liquidacion_tercero con valor_liquidar > 9,999,999,999.99. Revisar antes de continuar.';
  END IF;
END $$;

-- 5.8 terceros.notas: TEXT (sin modificador es lo mismo, no requiere cambio)
--     Prisma transmeralda: String? (sin @db.Text) -> Postgres TEXT implícito
--     Cotransmeq: String? @db.Text -> Postgres TEXT explícito
--     Ambos son TEXT en Postgres, NO se requiere ALTER.

-- 5.9 acciones_correctivas_preventivas: TEXT explícito → TEXT implícito
--     Idéntico al caso anterior. Postgres no distingue.

-- ============================================================
-- SECCIÓN 6: ELIMINAR COLUMNAS OBSOLETAS
-- ============================================================
-- ADVERTENCIA: Si hay datos, hacer backup antes.
-- (comentadas por seguridad; descomentar si se confirma)

-- 6.1 liquidaciones: share_token, share_token_expires_at
-- ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "share_token";
-- ALTER TABLE "liquidaciones" DROP COLUMN IF EXISTS "share_token_expires_at";

-- 6.2 registro_dia_laboral: 6 columnas migradas a registro_dia_laboral_segmento
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "hora_inicio";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "hora_fin";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "horas_conducidas";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "cliente_id";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "cliente_nombre";
-- ALTER TABLE "registro_dia_laboral" DROP COLUMN IF EXISTS "vehiculo_placa";

-- ============================================================
-- SECCIÓN 7: CREAR ÍNDICES FALTANTES EN TABLAS EXISTENTES
-- ============================================================

-- 7.1 recargos
CREATE INDEX IF NOT EXISTS "recargos_liquidacion_id_idx"     ON "recargos" ("liquidacion_id");
CREATE INDEX IF NOT EXISTS "recargos_es_automatico_idx"      ON "recargos" ("es_automatico");
CREATE UNIQUE INDEX IF NOT EXISTS "uniq_recargo_origen_planilla"
  ON "recargos" ("liquidacion_id", "origen_planilla_id");

-- 7.2 acciones_correctivas_preventivas
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_estado_global_idx"
  ON "acciones_correctivas_preventivas" ("estado_global");
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_hallazgo_tipo_idx"
  ON "acciones_correctivas_preventivas" ("hallazgo_tipo");
CREATE INDEX IF NOT EXISTS "acciones_correctivas_preventivas_deleted_at_idx"
  ON "acciones_correctivas_preventivas" ("deleted_at");

-- 7.3 causas_accion_correctiva
CREATE INDEX IF NOT EXISTS "causas_accion_correctiva_evaluacion_cierre_eficaz_idx"
  ON "causas_accion_correctiva" ("evaluacion_cierre_eficaz");
CREATE INDEX IF NOT EXISTS "causas_accion_correctiva_fecha_cierre_idx"
  ON "causas_accion_correctiva" ("fecha_cierre");
CREATE INDEX IF NOT EXISTS "idx_causas_estado_seguimiento"
  ON "causas_accion_correctiva" ("estado_seguimiento");

-- 7.4 FK de recargos.origen_planilla_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'recargos_origen_planilla_id_fkey'
  ) THEN
    ALTER TABLE "recargos"
      ADD CONSTRAINT "recargos_origen_planilla_id_fkey"
      FOREIGN KEY ("origen_planilla_id") REFERENCES "recargos_planillas"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 7.5 FK de usuarios.invitado_por_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_invitado_por_id_fkey'
  ) THEN
    ALTER TABLE "users"
      ADD CONSTRAINT "users_invitado_por_id_fkey"
      FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id")
      ON DELETE SET NULL;
  END IF;
END $$;

-- 7.6 FK de acciones_correctivas_preventivas.registrado_por_id
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'acciones_correctivas_preventivas_registrado_por_id_fkey'
  ) THEN
    ALTER TABLE "acciones_correctivas_preventivas"
      ADD CONSTRAINT "acciones_correctivas_preventivas_registrado_por_id_fkey"
      FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id");
  END IF;
END $$;

-- 7.7 Modificar FK de recargos_planillas.servicio_id:
--     Quitar onDelete: SetNull para que sea NoAction (default).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname LIKE 'recargos_planillas_servicio_id_fkey%'
  ) THEN
    ALTER TABLE "recargos_planillas"
      DROP CONSTRAINT "recargos_planillas_servicio_id_fkey",
      ADD CONSTRAINT "recargos_planillas_servicio_id_fkey"
        FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id");
  END IF;
END $$;

-- ============================================================
-- SECCIÓN 8: CREAR TABLAS NUEVAS (32 tablas solo en transmeralda)
-- ============================================================

-- 8.1 registro_dia_laboral_segmento
CREATE TABLE "registro_dia_laboral_segmento" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "registro_dia_id" UUID NOT NULL,
  "cliente_id" UUID,
  "cliente_nombre" VARCHAR(255),
  "vehiculo_id" UUID,
  "vehiculo_placa" VARCHAR(20) NOT NULL,
  "hora_inicio" VARCHAR(10) NOT NULL,
  "hora_fin" VARCHAR(10) NOT NULL,
  "horas_conducidas" NUMERIC(4,1) NOT NULL DEFAULT 0,
  "km_inicial" INTEGER,
  "km_final" INTEGER,
  "pernocte" BOOLEAN NOT NULL DEFAULT false,
  "orden" INTEGER NOT NULL DEFAULT 1,
  "observaciones" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "registro_dia_laboral_segmento_registro_dia_id_idx" ON "registro_dia_laboral_segmento" ("registro_dia_id");
CREATE INDEX "registro_dia_laboral_segmento_cliente_id_idx"      ON "registro_dia_laboral_segmento" ("cliente_id");
CREATE INDEX "registro_dia_laboral_segmento_vehiculo_id_idx"     ON "registro_dia_laboral_segmento" ("vehiculo_id");
CREATE INDEX "registro_dia_laboral_segmento_registro_dia_id_orden_idx" ON "registro_dia_laboral_segmento" ("registro_dia_id", "orden");
ALTER TABLE "registro_dia_laboral_segmento"
  ADD CONSTRAINT "registro_dia_laboral_segmento_registro_dia_id_fkey"
  FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE;
ALTER TABLE "registro_dia_laboral_segmento"
  ADD CONSTRAINT "registro_dia_laboral_segmento_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL;
ALTER TABLE "registro_dia_laboral_segmento"
  ADD CONSTRAINT "registro_dia_laboral_segmento_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL;

-- 8.2 registro_dia_laboral_bono
CREATE TABLE "registro_dia_laboral_bono" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "registro_dia_id" UUID NOT NULL,
  "segmento_id" UUID,
  "config_liquidacion_id" UUID NOT NULL,
  "valor" NUMERIC(10,2),
  "creado_por_id" UUID,
  "observaciones" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "registro_dia_laboral_bono_registro_dia_id_idx"       ON "registro_dia_laboral_bono" ("registro_dia_id");
CREATE INDEX "registro_dia_laboral_bono_segmento_id_idx"           ON "registro_dia_laboral_bono" ("segmento_id");
CREATE INDEX "registro_dia_laboral_bono_config_liquidacion_id_idx" ON "registro_dia_laboral_bono" ("config_liquidacion_id");
CREATE INDEX "registro_dia_laboral_bono_creado_por_id_idx"         ON "registro_dia_laboral_bono" ("creado_por_id");
ALTER TABLE "registro_dia_laboral_bono"
  ADD CONSTRAINT "registro_dia_laboral_bono_registro_dia_id_fkey"
  FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE;
ALTER TABLE "registro_dia_laboral_bono"
  ADD CONSTRAINT "registro_dia_laboral_bono_segmento_id_fkey"
  FOREIGN KEY ("segmento_id") REFERENCES "registro_dia_laboral_segmento"("id") ON DELETE CASCADE;
ALTER TABLE "registro_dia_laboral_bono"
  ADD CONSTRAINT "registro_dia_laboral_bono_config_liquidacion_id_fkey"
  FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE RESTRICT;
ALTER TABLE "registro_dia_laboral_bono"
  ADD CONSTRAINT "registro_dia_laboral_bono_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- 8.3 bono_config_visual
CREATE TABLE "bono_config_visual" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "config_liquidacion_id" UUID NOT NULL,
  "anio" INTEGER NOT NULL,
  "visible" BOOLEAN NOT NULL DEFAULT true,
  "creado_por_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "bono_config_visual_config_liquidacion_id_anio_key"
  ON "bono_config_visual" ("config_liquidacion_id", "anio");
CREATE INDEX "bono_config_visual_anio_visible_idx" ON "bono_config_visual" ("anio", "visible");
ALTER TABLE "bono_config_visual"
  ADD CONSTRAINT "bono_config_visual_config_liquidacion_id_fkey"
  FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE CASCADE;
ALTER TABLE "bono_config_visual"
  ADD CONSTRAINT "bono_config_visual_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- 8.4 invitaciones_usuario
CREATE TABLE "invitaciones_usuario" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "correo" VARCHAR(255) NOT NULL,
  "token" VARCHAR(255) NOT NULL UNIQUE,
  "area" VARCHAR(255)[] NOT NULL DEFAULT '{}',
  "cargo" VARCHAR(255),
  "invitado_por_id" UUID NOT NULL,
  "estado" VARCHAR(50) NOT NULL DEFAULT 'pendiente',
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "invitaciones_usuario"
  ADD CONSTRAINT "invitaciones_usuario_invitado_por_id_fkey"
  FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id");

-- 8.5 formulario_sarlaft_ptee
CREATE TABLE "formulario_sarlaft_ptee" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "radicado" VARCHAR(50) NOT NULL UNIQUE,
  "tipo_formulario" VARCHAR(50) NOT NULL,
  "codigo_formulario" VARCHAR(20) NOT NULL,
  "version" VARCHAR(10) NOT NULL DEFAULT '001',
  "fecha_diligenciamiento" DATE,
  "fecha_envio" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "respuestas" JSONB NOT NULL,
  "nombre_completo" VARCHAR(255),
  "tipo_documento" VARCHAR(50),
  "numero_documento" VARCHAR(50),
  "correo" VARCHAR(255),
  "telefono" VARCHAR(50),
  "ip_origen" VARCHAR(64),
  "user_agent" TEXT,
  "referer" TEXT,
  "estado" VARCHAR(30) NOT NULL DEFAULT 'recibido',
  "evaluado_por_id" UUID,
  "evaluado_at" TIMESTAMPTZ(6),
  "evaluacion_concepto" VARCHAR(50),
  "evaluacion_observaciones" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "formulario_sarlaft_ptee_tipo_formulario_idx"  ON "formulario_sarlaft_ptee" ("tipo_formulario");
CREATE INDEX "formulario_sarlaft_ptee_numero_documento_idx" ON "formulario_sarlaft_ptee" ("numero_documento");
CREATE INDEX "formulario_sarlaft_ptee_correo_idx"           ON "formulario_sarlaft_ptee" ("correo");
CREATE INDEX "formulario_sarlaft_ptee_estado_idx"           ON "formulario_sarlaft_ptee" ("estado");
CREATE INDEX "formulario_sarlaft_ptee_fecha_envio_idx"      ON "formulario_sarlaft_ptee" ("fecha_envio" DESC);
ALTER TABLE "formulario_sarlaft_ptee"
  ADD CONSTRAINT "formulario_sarlaft_ptee_evaluado_por_id_fkey"
  FOREIGN KEY ("evaluado_por_id") REFERENCES "users"("id") ON DELETE SET NULL;

-- 8.6 formulario_sarlaft_ptee_documento
CREATE TABLE "formulario_sarlaft_ptee_documento" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "formulario_id" UUID NOT NULL,
  "tipo_documento" VARCHAR(50) NOT NULL,
  "nombre_archivo" VARCHAR(255) NOT NULL,
  "s3_key" VARCHAR(500) NOT NULL,
  "mime_type" VARCHAR(100) NOT NULL,
  "tamano_bytes" BIGINT NOT NULL,
  "hash_sha256" VARCHAR(64),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "formulario_sarlaft_ptee_documento_formulario_id_tipo_doc_key"
  ON "formulario_sarlaft_ptee_documento" ("formulario_id", "tipo_documento");
CREATE INDEX "formulario_sarlaft_ptee_documento_formulario_id_idx"
  ON "formulario_sarlaft_ptee_documento" ("formulario_id");
ALTER TABLE "formulario_sarlaft_ptee_documento"
  ADD CONSTRAINT "formulario_sarlaft_ptee_documento_formulario_id_fkey"
  FOREIGN KEY ("formulario_id") REFERENCES "formulario_sarlaft_ptee"("id") ON DELETE CASCADE;

-- 8.7 salidas_no_conformes
CREATE TABLE "salidas_no_conformes" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "numero_snc" SERIAL UNIQUE,
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
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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
  "resultado_verificacion" TEXT
);
CREATE INDEX "salidas_no_conformes_numero_snc_idx"        ON "salidas_no_conformes" ("numero_snc");
CREATE INDEX "salidas_no_conformes_fecha_deteccion_idx"   ON "salidas_no_conformes" ("fecha_deteccion");
CREATE INDEX "salidas_no_conformes_clasificacion_nc_idx" ON "salidas_no_conformes" ("clasificacion_nc");
CREATE INDEX "salidas_no_conformes_estado_idx"            ON "salidas_no_conformes" ("estado");
CREATE INDEX "salidas_no_conformes_conductor_id_idx"      ON "salidas_no_conformes" ("conductor_id");
CREATE INDEX "salidas_no_conformes_vehiculo_id_idx"       ON "salidas_no_conformes" ("vehiculo_id");
ALTER TABLE "salidas_no_conformes"
  ADD CONSTRAINT "salidas_no_conformes_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id");
ALTER TABLE "salidas_no_conformes"
  ADD CONSTRAINT "salidas_no_conformes_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id");
ALTER TABLE "salidas_no_conformes"
  ADD CONSTRAINT "salidas_no_conformes_cliente_id_fkey"
  FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id");
ALTER TABLE "salidas_no_conformes"
  ADD CONSTRAINT "salidas_no_conformes_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id");

-- 8.8 aprobaciones_accion
CREATE TABLE "aprobaciones_accion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accion_id" UUID NOT NULL,
  "orden" INTEGER DEFAULT 1,
  "rol" VARCHAR(100) NOT NULL,
  "aprobador_id" UUID,
  "estado" "EstadoAprobacion" NOT NULL DEFAULT 'PENDIENTE',
  "fecha" TIMESTAMPTZ(6),
  "comentario" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "aprobaciones_accion_accion_id_key" ON "aprobaciones_accion" ("accion_id");
CREATE INDEX "aprobaciones_accion_accion_id_idx"     ON "aprobaciones_accion" ("accion_id");
CREATE INDEX "aprobaciones_accion_estado_idx"        ON "aprobaciones_accion" ("estado");
ALTER TABLE "aprobaciones_accion"
  ADD CONSTRAINT "aprobaciones_accion_accion_id_fkey"
  FOREIGN KEY ("accion_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE;
ALTER TABLE "aprobaciones_accion"
  ADD CONSTRAINT "aprobaciones_accion_aprobador_id_fkey"
  FOREIGN KEY ("aprobador_id") REFERENCES "users"("id");

-- 8.9 seguimientos_causa
CREATE TABLE "seguimientos_causa" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  CONSTRAINT "seguimientos_causa_causa_fkey"
    FOREIGN KEY ("causa_id") REFERENCES "causas_accion_correctiva"("id") ON DELETE CASCADE,
  CONSTRAINT "seguimientos_causa_usuario_fk"
    FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id")
);
CREATE INDEX "seguimientos_causa_causa_id_idx"               ON "seguimientos_causa" ("causa_id");
CREATE INDEX "seguimientos_causa_estado_idx"                 ON "seguimientos_causa" ("estado_accion");
CREATE INDEX "seguimientos_causa_fecha_idx"                  ON "seguimientos_causa" ("fecha_seguimiento");

-- 8.10 seguimientos_correccion_inmediata
CREATE TABLE "seguimientos_correccion_inmediata" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accion_correctiva_id" UUID NOT NULL,
  "fecha_seguimiento" DATE NOT NULL,
  "descripcion_observaciones" TEXT,
  "estado_accion" VARCHAR(50) NOT NULL,
  "adjunto_url" TEXT,
  "replanteo" JSONB,
  "responsable_seguimiento" VARCHAR(255),
  "cargo_responsable_seguimiento" VARCHAR(255),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "seguimientos_correccion_inmediata_accion_correctiva_id_idx" ON "seguimientos_correccion_inmediata" ("accion_correctiva_id");
CREATE INDEX "seguimientos_correccion_inmediata_fecha_seguimiento_idx"   ON "seguimientos_correccion_inmediata" ("fecha_seguimiento");
ALTER TABLE "seguimientos_correccion_inmediata"
  ADD CONSTRAINT "seguimientos_correccion_inmediata_accion_correctiva_id_fkey"
  FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE;

-- 8.11 ciclos_seguimiento_eficacia
CREATE TABLE "ciclos_seguimiento_eficacia" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ciclos_seguimiento_eficacia_accion_correctiva_id_numero__key"
  ON "ciclos_seguimiento_eficacia" ("accion_correctiva_id", "numero_ciclo");
CREATE INDEX "ciclos_seguimiento_eficacia_accion_correctiva_id_idx"
  ON "ciclos_seguimiento_eficacia" ("accion_correctiva_id");
ALTER TABLE "ciclos_seguimiento_eficacia"
  ADD CONSTRAINT "ciclos_seguimiento_eficacia_accion_correctiva_id_fkey"
  FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE;

-- 8.12 evidencias_eficacia_cierre
CREATE TABLE "evidencias_eficacia_cierre" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "accion_correctiva_id" UUID NOT NULL,
  "orden" INTEGER NOT NULL,
  "tipo_evidencia" VARCHAR(255),
  "descripcion" TEXT,
  "fecha" DATE,
  "estado_ubicacion" VARCHAR(50),
  "adjunto_url" TEXT,
  "impedimento" TEXT,
  "nueva_fecha" DATE,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "evidencias_eficacia_cierre_accion_correctiva_id_orden_key"
  ON "evidencias_eficacia_cierre" ("accion_correctiva_id", "orden");
CREATE INDEX "evidencias_eficacia_cierre_accion_correctiva_id_idx"
  ON "evidencias_eficacia_cierre" ("accion_correctiva_id");
ALTER TABLE "evidencias_eficacia_cierre"
  ADD CONSTRAINT "evidencias_eficacia_cierre_accion_correctiva_id_fkey"
  FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE;

-- 8.13 liquidacion_tercero_concepto
CREATE TABLE "liquidacion_tercero_concepto" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_tercero_id" UUID NOT NULL,
  "tipo" VARCHAR(50) NOT NULL,
  "concepto" VARCHAR(100) NOT NULL,
  "conductor_id" UUID,
  "dias" NUMERIC(10,2),
  "valor_unitario" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "porcentaje" NUMERIC(8,4),
  "valor_total" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "base_calculo" NUMERIC(12,2),
  "calculado" BOOLEAN NOT NULL DEFAULT false,
  "observaciones" TEXT,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "liquidacion_tercero_concepto_liquidacion_tercero_id_idx" ON "liquidacion_tercero_concepto" ("liquidacion_tercero_id");
CREATE INDEX "liquidacion_tercero_concepto_conductor_id_idx"           ON "liquidacion_tercero_concepto" ("conductor_id");
CREATE INDEX "liquidacion_tercero_concepto_tipo_idx"                   ON "liquidacion_tercero_concepto" ("tipo");
CREATE INDEX "liquidacion_tercero_concepto_concepto_idx"               ON "liquidacion_tercero_concepto" ("concepto");
ALTER TABLE "liquidacion_tercero_concepto"
  ADD CONSTRAINT "liquidacion_tercero_concepto_liquidacion_tercero_id_fkey"
  FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_tercero_concepto"
  ADD CONSTRAINT "liquidacion_tercero_concepto_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL;

-- 8.14 configuracion_descuento_tercero
CREATE TABLE "configuracion_descuento_tercero" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "categoria" VARCHAR(50) NOT NULL,
  "concepto" VARCHAR(100) NOT NULL UNIQUE,
  "nombre" VARCHAR(200) NOT NULL,
  "porcentaje" NUMERIC(8,4) NOT NULL,
  "base_calculo" VARCHAR(100) NOT NULL,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "valor_dia_conductor" NUMERIC(12,2),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "configuracion_descuento_tercero_categoria_idx" ON "configuracion_descuento_tercero" ("categoria");
CREATE INDEX "configuracion_descuento_tercero_activo_idx"    ON "configuracion_descuento_tercero" ("activo");

-- 8.15 liquidacion_tercero_final
CREATE TABLE "liquidacion_tercero_final" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "consecutivo" VARCHAR(50) NOT NULL UNIQUE,
  "liquidacion_servicio_id" UUID NOT NULL,
  "tercero_id" UUID,
  "vehiculo_id" UUID,
  "placa" VARCHAR(20) NOT NULL,
  "mes" INTEGER NOT NULL,
  "anio" INTEGER NOT NULL,
  "valor_liquidar" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_costos_laborales" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_gastos_operativos" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_impuestos" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_descuentos" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "total_pagar" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',
  "motivo_anulacion" TEXT,
  "creado_por_id" UUID,
  "actualizado_por_id" UUID,
  "adicionales" JSONB NOT NULL DEFAULT '[]',
  "es_propietario_overrides" JSONB NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6)
);
CREATE INDEX "liquidacion_tercero_final_liquidacion_servicio_id_idx" ON "liquidacion_tercero_final" ("liquidacion_servicio_id");
CREATE INDEX "liquidacion_tercero_final_tercero_id_idx"              ON "liquidacion_tercero_final" ("tercero_id");
CREATE INDEX "liquidacion_tercero_final_vehiculo_id_idx"             ON "liquidacion_tercero_final" ("vehiculo_id");
CREATE INDEX "liquidacion_tercero_final_placa_idx"                   ON "liquidacion_tercero_final" ("placa");
CREATE INDEX "liquidacion_tercero_final_anio_mes_idx"                ON "liquidacion_tercero_final" ("anio", "mes");
CREATE INDEX "liquidacion_tercero_final_estado_idx"                  ON "liquidacion_tercero_final" ("estado");
ALTER TABLE "liquidacion_tercero_final"
  ADD CONSTRAINT "liquidacion_tercero_final_liquidacion_servicio_id_fkey"
  FOREIGN KEY ("liquidacion_servicio_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_tercero_final"
  ADD CONSTRAINT "liquidacion_tercero_final_tercero_id_fkey"
  FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id");
ALTER TABLE "liquidacion_tercero_final"
  ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id");
ALTER TABLE "liquidacion_tercero_final"
  ADD CONSTRAINT "liquidacion_tercero_final_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id");
ALTER TABLE "liquidacion_tercero_final"
  ADD CONSTRAINT "liquidacion_tercero_final_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id");

-- 8.16 liquidacion_tercero_final_item
-- Nombres acortados (<=63 chars) para evitar truncado automático de Postgres
CREATE TABLE "liquidacion_tercero_final_item" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_tercero_final_id" UUID NOT NULL,
  "liquidacion_tercero_id" UUID NOT NULL,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6)
);
CREATE UNIQUE INDEX "liq_tercero_final_item_unique"
  ON "liquidacion_tercero_final_item" ("liquidacion_tercero_final_id", "liquidacion_tercero_id");
CREATE INDEX "liq_tercero_final_item_ltf_idx" ON "liquidacion_tercero_final_item" ("liquidacion_tercero_final_id");
CREATE INDEX "liq_tercero_final_item_lti_idx"  ON "liquidacion_tercero_final_item" ("liquidacion_tercero_id");
ALTER TABLE "liquidacion_tercero_final_item"
  ADD CONSTRAINT "liq_tercero_final_item_ltf_fk"
  FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_tercero_final_item"
  ADD CONSTRAINT "liq_tercero_final_item_lti_fk"
  FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE;

-- 8.17 liquidacion_tercero_final_concepto
CREATE TABLE "liquidacion_tercero_final_concepto" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_tercero_final_id" UUID NOT NULL,
  "tipo" VARCHAR(50) NOT NULL,
  "concepto" VARCHAR(100) NOT NULL,
  "conductor_id" UUID,
  "dias" NUMERIC(10,2),
  "valor_unitario" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "porcentaje" NUMERIC(8,4),
  "valor_total" NUMERIC(12,2) NOT NULL DEFAULT 0,
  "base_calculo" NUMERIC(12,2),
  "calculado" BOOLEAN NOT NULL DEFAULT false,
  "observaciones" TEXT,
  "orden" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" TIMESTAMPTZ(6)
);
CREATE INDEX "liq_tercero_final_concepto_ltf_idx" ON "liquidacion_tercero_final_concepto" ("liquidacion_tercero_final_id");
CREATE INDEX "liq_tercero_final_concepto_conductor_idx" ON "liquidacion_tercero_final_concepto" ("conductor_id");
CREATE INDEX "liq_tercero_final_concepto_tipo_idx"     ON "liquidacion_tercero_final_concepto" ("tipo");
CREATE INDEX "liq_tercero_final_concepto_concepto_idx" ON "liquidacion_tercero_final_concepto" ("concepto");
ALTER TABLE "liquidacion_tercero_final_concepto"
  ADD CONSTRAINT "liq_tercero_final_concepto_ltf_fk"
  FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_tercero_final_concepto"
  ADD CONSTRAINT "liq_tercero_final_concepto_conductor_fk"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL;

-- 8.18 liquidacion_tercero_final_snapshot
CREATE TABLE "liquidacion_tercero_final_snapshot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_tercero_final_id" UUID NOT NULL,
  "rama" VARCHAR(60) NOT NULL DEFAULT 'main',
  "version" INTEGER NOT NULL,
  "origen" VARCHAR(20) NOT NULL DEFAULT 'manual',
  "revertido_de_id" UUID,
  "usuario_id" UUID,
  "payload" JSONB NOT NULL,
  "diff" JSONB,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "liq_tercero_final_snap_unique"
  ON "liquidacion_tercero_final_snapshot" ("liquidacion_tercero_final_id", "version");
CREATE INDEX "liq_tercero_final_snap_ltf_rama_idx"
  ON "liquidacion_tercero_final_snapshot" ("liquidacion_tercero_final_id", "rama");
CREATE INDEX "liq_tercero_final_snap_created_at_idx" ON "liquidacion_tercero_final_snapshot" ("created_at");
CREATE INDEX "liq_tercero_final_snap_usuario_idx"   ON "liquidacion_tercero_final_snapshot" ("usuario_id");
ALTER TABLE "liquidacion_tercero_final_snapshot"
  ADD CONSTRAINT "liq_tercero_final_snap_ltf_fk"
  FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_tercero_final_snapshot"
  ADD CONSTRAINT "liq_tercero_final_snap_usuario_fk"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL;
ALTER TABLE "liquidacion_tercero_final_snapshot"
  ADD CONSTRAINT "liq_tercero_final_snap_revertido_fk"
  FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_final_snapshot"("id") ON DELETE SET NULL;

-- 8.19 excesos_velocidad
CREATE TABLE "excesos_velocidad" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conductor_id" UUID NOT NULL,
  "vehiculo_id" UUID NOT NULL,
  "mes" INTEGER NOT NULL,
  "anio" INTEGER NOT NULL,
  "cantidad" INTEGER NOT NULL DEFAULT 0,
  "observaciones" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "excesos_velocidad_conductor_id_vehiculo_id_mes_anio_key"
  ON "excesos_velocidad" ("conductor_id", "vehiculo_id", "mes", "anio");
CREATE INDEX "excesos_velocidad_conductor_id_idx"  ON "excesos_velocidad" ("conductor_id");
CREATE INDEX "excesos_velocidad_vehiculo_id_idx"   ON "excesos_velocidad" ("vehiculo_id");
CREATE INDEX "excesos_velocidad_mes_anio_idx"      ON "excesos_velocidad" ("mes", "anio");
ALTER TABLE "excesos_velocidad"
  ADD CONSTRAINT "excesos_velocidad_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE;
ALTER TABLE "excesos_velocidad"
  ADD CONSTRAINT "excesos_velocidad_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE;

-- 8.20 preoperacionales
CREATE TABLE "preoperacionales" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "conductor_id" UUID NOT NULL,
  "vehiculo_id" UUID NOT NULL,
  "fecha" DATE NOT NULL,
  "realizado" BOOLEAN NOT NULL DEFAULT true,
  "observaciones" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "preoperacionales_conductor_id_vehiculo_id_fecha_key"
  ON "preoperacionales" ("conductor_id", "vehiculo_id", "fecha");
CREATE INDEX "preoperacionales_conductor_id_idx" ON "preoperacionales" ("conductor_id");
CREATE INDEX "preoperacionales_vehiculo_id_idx"  ON "preoperacionales" ("vehiculo_id");
CREATE INDEX "preoperacionales_fecha_idx"         ON "preoperacionales" ("fecha");
ALTER TABLE "preoperacionales"
  ADD CONSTRAINT "preoperacionales_conductor_id_fkey"
  FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE;
ALTER TABLE "preoperacionales"
  ADD CONSTRAINT "preoperacionales_vehiculo_id_fkey"
  FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE;

-- 8.21 inducciones_visitantes
CREATE TABLE "inducciones_visitantes" (
  "id" TEXT PRIMARY KEY,
  "sede" "Sede" NOT NULL,
  "fecha" TIMESTAMP NOT NULL,
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
  "created_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "creado_por_id" UUID
);
CREATE INDEX "inducciones_visitantes_fecha_idx"          ON "inducciones_visitantes" ("fecha" DESC);
CREATE INDEX "inducciones_visitantes_sede_idx"           ON "inducciones_visitantes" ("sede");
CREATE INDEX "inducciones_visitantes_visitante_cedula_idx" ON "inducciones_visitantes" ("visitante_cedula");
ALTER TABLE "inducciones_visitantes"
  ADD CONSTRAINT "inducciones_visitantes_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id");

-- 8.22 notificacion
CREATE TABLE "notificacion" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "usuario_id" UUID NOT NULL,
  "tipo" "enum_notificacion_tipo" NOT NULL DEFAULT 'GENERAL',
  "titulo" VARCHAR(255) NOT NULL,
  "mensaje" TEXT NOT NULL,
  "referencia_id" UUID,
  "leida" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "referencia_tipo" VARCHAR(50)
);
CREATE INDEX "notificacion_usuario_id_idx"     ON "notificacion" ("usuario_id");
CREATE INDEX "notificacion_leida_idx"          ON "notificacion" ("leida");
CREATE INDEX "notificacion_created_at_idx"     ON "notificacion" ("created_at" DESC);
ALTER TABLE "notificacion"
  ADD CONSTRAINT "notificacion_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id");

-- 8.23 actividades_pesv
CREATE TABLE "actividades_pesv" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
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
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "actividades_pesv_estado_idx"        ON "actividades_pesv" ("estado");
CREATE INDEX "actividades_pesv_prioridad_idx"     ON "actividades_pesv" ("prioridad");
CREATE INDEX "actividades_pesv_anio_idx"          ON "actividades_pesv" ("anio");
CREATE INDEX "actividades_pesv_responsable_ejecucion_id_idx" ON "actividades_pesv" ("responsable_ejecucion_id");
CREATE INDEX "actividades_pesv_deleted_at_idx"    ON "actividades_pesv" ("deleted_at");
CREATE INDEX "actividades_pesv_frecuencia_idx"    ON "actividades_pesv" ("frecuencia");
ALTER TABLE "actividades_pesv"
  ADD CONSTRAINT "actividades_pesv_actualizado_por_id_fkey"
  FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id");
ALTER TABLE "actividades_pesv"
  ADD CONSTRAINT "actividades_pesv_creado_por_id_fkey"
  FOREIGN KEY ("creado_por_id") REFERENCES "users"("id");
ALTER TABLE "actividades_pesv"
  ADD CONSTRAINT "actividades_pesv_responsable_ejecucion_id_fkey"
  FOREIGN KEY ("responsable_ejecucion_id") REFERENCES "users"("id");

-- 8.24 tipo_certificado
CREATE TABLE "tipo_certificado" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nombre" VARCHAR(100) NOT NULL,
  "descripcion" TEXT,
  "codigo" VARCHAR(50) NOT NULL UNIQUE,
  "activo" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "tipo_certificado_codigo_idx" ON "tipo_certificado" ("codigo");
CREATE INDEX "tipo_certificado_activo_idx"  ON "tipo_certificado" ("activo");

-- 8.25 certificado_archivo
CREATE TABLE "certificado_archivo" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "s3_key" VARCHAR(512) NOT NULL UNIQUE,
  "filename" VARCHAR(255) NOT NULL,
  "nit" VARCHAR(50) NOT NULL,
  "anio" INTEGER NOT NULL,
  "tipo" VARCHAR(50) NOT NULL,
  "size" INTEGER NOT NULL DEFAULT 0,
  "tercero_id" UUID,
  "tipo_certificado_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "certificado_archivo_nit_idx"                ON "certificado_archivo" ("nit");
CREATE INDEX "certificado_archivo_anio_idx"               ON "certificado_archivo" ("anio");
CREATE INDEX "certificado_archivo_tercero_id_idx"         ON "certificado_archivo" ("tercero_id");
CREATE INDEX "certificado_archivo_tipo_certificado_id_idx" ON "certificado_archivo" ("tipo_certificado_id");
CREATE INDEX "certificado_archivo_tipo_idx"                ON "certificado_archivo" ("tipo");
CREATE INDEX "certificado_archivo_created_at_idx"         ON "certificado_archivo" ("created_at" DESC);
ALTER TABLE "certificado_archivo"
  ADD CONSTRAINT "certificado_archivo_tercero_id_fkey"
  FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL;
ALTER TABLE "certificado_archivo"
  ADD CONSTRAINT "certificado_archivo_tipo_certificado_id_fkey"
  FOREIGN KEY ("tipo_certificado_id") REFERENCES "tipo_certificado"("id") ON DELETE SET NULL;

-- 8.26 certificado_tercero
CREATE TABLE "certificado_tercero" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tercero_id" UUID NOT NULL,
  "certificado_id" UUID NOT NULL,
  "creado_por_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "certificado_tercero_tercero_id_certificado_id_key"
  ON "certificado_tercero" ("tercero_id", "certificado_id");
CREATE INDEX "certificado_tercero_tercero_id_idx"     ON "certificado_tercero" ("tercero_id");
CREATE INDEX "certificado_tercero_certificado_id_idx" ON "certificado_tercero" ("certificado_id");
ALTER TABLE "certificado_tercero"
  ADD CONSTRAINT "certificado_tercero_tercero_id_fkey"
  FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE;
ALTER TABLE "certificado_tercero"
  ADD CONSTRAINT "certificado_tercero_certificado_id_fkey"
  FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE CASCADE;

-- 8.27 certificacion_envio
CREATE TABLE "certificacion_envio" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tercero_id" UUID NOT NULL,
  "certificado_id" UUID,
  "token_acceso" VARCHAR(255) NOT NULL UNIQUE,
  "email_destino" VARCHAR(255) NOT NULL,
  "tipo_envio" VARCHAR(20) NOT NULL DEFAULT 'individual',
  "emitido_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "certificacion_envio_tercero_id_idx"    ON "certificacion_envio" ("tercero_id");
CREATE INDEX "certificacion_envio_token_acceso_idx"  ON "certificacion_envio" ("token_acceso");
CREATE INDEX "certificacion_envio_email_destino_idx" ON "certificacion_envio" ("email_destino");
CREATE INDEX "certificacion_envio_emitido_at_idx"    ON "certificacion_envio" ("emitido_at");
CREATE INDEX "certificacion_envio_tipo_envio_idx"    ON "certificacion_envio" ("tipo_envio");
CREATE INDEX "certificacion_envio_certificado_id_idx" ON "certificacion_envio" ("certificado_id");
ALTER TABLE "certificacion_envio"
  ADD CONSTRAINT "certificacion_envio_tercero_id_fkey"
  FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE;
ALTER TABLE "certificacion_envio"
  ADD CONSTRAINT "certificacion_envio_certificado_id_fkey"
  FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE SET NULL;

-- 8.28 tercero_token
CREATE TABLE "tercero_token" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tercero_id" UUID NOT NULL,
  "token" VARCHAR(512) NOT NULL UNIQUE,
  "expires_at" TIMESTAMPTZ(6) NOT NULL,
  "used" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "tercero_token_token_idx"      ON "tercero_token" ("token");
CREATE INDEX "tercero_token_tercero_id_idx" ON "tercero_token" ("tercero_id");
CREATE INDEX "tercero_token_expires_at_idx" ON "tercero_token" ("expires_at");
ALTER TABLE "tercero_token"
  ADD CONSTRAINT "tercero_token_tercero_id_fkey"
  FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE;

-- 8.29 liquidacion_chat_mensaje
CREATE TABLE "liquidacion_chat_mensaje" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_tercero_id" UUID NOT NULL,
  "usuario_id" UUID NOT NULL,
  "contenido_cifrado" TEXT NOT NULL,
  "nonce" VARCHAR(24) NOT NULL,
  "tipo" VARCHAR(20) NOT NULL DEFAULT 'NOTA',
  "recordatorio_id" UUID,
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "liquidacion_chat_mensaje_liquidacion_tercero_id_idx" ON "liquidacion_chat_mensaje" ("liquidacion_tercero_id");
CREATE INDEX "liquidacion_chat_mensaje_usuario_id_idx"             ON "liquidacion_chat_mensaje" ("usuario_id");
CREATE INDEX "liquidacion_chat_mensaje_tipo_idx"                    ON "liquidacion_chat_mensaje" ("tipo");
CREATE INDEX "liquidacion_chat_mensaje_created_at_idx"             ON "liquidacion_chat_mensaje" ("created_at");
ALTER TABLE "liquidacion_chat_mensaje"
  ADD CONSTRAINT "liquidacion_chat_mensaje_liquidacion_tercero_id_fkey"
  FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_chat_mensaje"
  ADD CONSTRAINT "liquidacion_chat_mensaje_usuario_id_fkey"
  FOREIGN KEY ("usuario_id") REFERENCES "users"("id");

-- 8.30 liquidacion_recordatorio
CREATE TABLE "liquidacion_recordatorio" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "liquidacion_origen_id" UUID NOT NULL,
  "placa" VARCHAR(20) NOT NULL,
  "mes" INTEGER NOT NULL,
  "anio" INTEGER NOT NULL,
  "descripcion_cifrada" TEXT NOT NULL,
  "descripcion_nonce" VARCHAR(24) NOT NULL,
  "monto" NUMERIC(12,2),
  "moneda" VARCHAR(3) NOT NULL DEFAULT 'COP',
  "estado" VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE',
  "prioridad" VARCHAR(10) NOT NULL DEFAULT 'MEDIA',
  "creado_por_usuario_id" UUID NOT NULL,
  "aplicado_en_liquidacion_id" UUID,
  "aplica_en" TIMESTAMPTZ(6),
  "deleted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "liquidacion_recordatorio_placa_mes_anio_idx"        ON "liquidacion_recordatorio" ("placa", "mes", "anio");
CREATE INDEX "liquidacion_recordatorio_estado_idx"                ON "liquidacion_recordatorio" ("estado");
CREATE INDEX "liquidacion_recordatorio_creado_por_usuario_id_idx" ON "liquidacion_recordatorio" ("creado_por_usuario_id");
CREATE INDEX "liquidacion_recordatorio_liquidacion_origen_id_idx" ON "liquidacion_recordatorio" ("liquidacion_origen_id");
CREATE INDEX "liquidacion_recordatorio_aplicado_en_liquidacion_id_idx" ON "liquidacion_recordatorio" ("aplicado_en_liquidacion_id");
ALTER TABLE "liquidacion_recordatorio"
  ADD CONSTRAINT "liquidacion_recordatorio_liquidacion_origen_id_fkey"
  FOREIGN KEY ("liquidacion_origen_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE;
ALTER TABLE "liquidacion_recordatorio"
  ADD CONSTRAINT "liquidacion_recordatorio_creado_por_usuario_id_fkey"
  FOREIGN KEY ("creado_por_usuario_id") REFERENCES "users"("id");
ALTER TABLE "liquidacion_recordatorio"
  ADD CONSTRAINT "liquidacion_recordatorio_aplicado_en_liquidacion_id_fkey"
  FOREIGN KEY ("aplicado_en_liquidacion_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE SET NULL;

-- 8.31 bonificaciones_backup (tabla ignorada por Prisma, opcional)
-- No se crea. Se incluye solo como referencia del schema.

-- ============================================================
-- SECCIÓN 9: TABLA ADICIONAL
-- ============================================================

-- 8.32 liquidacion_tercero_concepto: crear FK desde conductores (back-relation)
-- Ya cubierta en 8.13. Nada adicional.

-- ============================================================
-- SECCIÓN 10: AJUSTES DE RELACIONES RENOMBRADAS
-- ============================================================
-- Nota: Prisma gestiona los @relation internamente en el cliente.
-- Los nombres @relation NO afectan la estructura de BD, solo el cliente Prisma.
-- Si el schema.prisma se mantiene actualizado con los nuevos nombres
-- de @relation ("liquidacion_servicio_creado_por" etc.) se requiere
-- regenerar el cliente con: npx prisma generate

-- ============================================================
-- SECCIÓN 11: VERIFICACIONES POST-MIGRACIÓN
-- ============================================================
-- SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';
-- SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname;
-- SELECT conname FROM pg_constraint WHERE contype = 'f' ORDER BY conname;
-- SELECT * FROM "_prisma_migrations" ORDER BY started_at DESC LIMIT 5;
