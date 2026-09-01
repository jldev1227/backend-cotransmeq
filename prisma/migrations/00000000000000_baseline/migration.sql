-- BASELINE del esquema de producción (Railway), generado el 2026-08-26.
--
-- El historial anterior nunca fue completo: 27 migraciones creaban solo 63 de
-- las 116 tablas, y no existía ninguna migración inicial. Por eso Prisma no
-- podía reconstruir el esquema en la shadow database y en cada 'migrate dev'
-- proponía un reset — el reset que venía vaciando 'formularios_asistencia'.
--
-- Arrastraba además una migración muerta desde el 2026-07-30
-- ('09-01-2026-add-event-details', 0 pasos aplicados) que bloqueaba por sí
-- sola cualquier 'migrate deploy'.
--
-- Las 27 migraciones históricas quedan en prisma/migrations-archivo/ y los
-- .sql sueltos en prisma/legacy-sql/. Ya están aplicadas: no volver a correrlas.

-- CreateEnum
CREATE TYPE "ActionStatusGlobal" AS ENUM ('EN_PROCESO', 'VENCIDA', 'CUMPLIDA', 'REPLANTEADA');

-- CreateEnum
CREATE TYPE "EstadoAprobacion" AS ENUM ('PENDIENTE', 'APROBADO', 'RECHAZADO');

-- CreateEnum
CREATE TYPE "HallazgoTipo" AS ENUM ('NC_MAYOR', 'NC_MENOR', 'OBSERVACION', 'MEJORA');

-- CreateEnum
CREATE TYPE "Sede" AS ENUM ('yopal', 'villanueva', 'ambas', 'lugar_prestacion');

-- CreateEnum
CREATE TYPE "TipoPreguntaEnum" AS ENUM ('OPCION_UNICA', 'OPCION_MULTIPLE', 'NUMERICA', 'TEXTO', 'RELACION', 'VERDADERO_FALSO');

-- CreateEnum
CREATE TYPE "clasificacion_nc_enum" AS ENUM ('CRITICA', 'MAYOR', 'MENOR');

-- CreateEnum
CREATE TYPE "enum_actividad_pesv_estado" AS ENUM ('PENDIENTE', 'EN_PROGRESO', 'COMPLETADA', 'VENCIDA', 'CANCELADA');

-- CreateEnum
CREATE TYPE "enum_actividad_pesv_frecuencia" AS ENUM ('UNICA', 'DIARIA', 'SEMANAL', 'QUINCENAL', 'MENSUAL', 'BIMESTRAL', 'TRIMESTRAL', 'SEMESTRAL', 'ANUAL');

-- CreateEnum
CREATE TYPE "enum_actividad_pesv_prioridad" AS ENUM ('BAJA', 'MEDIA', 'ALTA', 'CRITICA');

-- CreateEnum
CREATE TYPE "enum_conductores_estado" AS ENUM ('activo', 'inactivo', 'suspendido', 'retirado', 'disponible', 'programado', 'servicio', 'descanso', 'vacaciones', 'incapacidad', 'desvinculado');

-- CreateEnum
CREATE TYPE "enum_conductores_sede_trabajo" AS ENUM ('Yopal', 'Villanueva', 'Tauramena', 'YOPAL', 'VILLANUEVA', 'TAURAMENA');

-- CreateEnum
CREATE TYPE "enum_conductores_tipo_sangre" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- CreateEnum
CREATE TYPE "enum_configuraciones_liquidacion_tipo" AS ENUM ('BONO', 'CONFIGURACION', 'PARAMETRO', 'OTROS', 'VALOR_NUMERICO', 'PORCENTAJE', 'MONTO_FIJO', 'BOOLEAN', 'MULTIPLICADOR', 'DESCUENTO');

-- CreateEnum
CREATE TYPE "enum_configuraciones_liquidacion_tipo_valor" AS ENUM ('VALOR_NUMERICO', 'PORCENTAJE', 'MONTO_FIJO', 'BOOLEAN', 'MULTIPLICADOR', 'DESCUENTO');

-- CreateEnum
CREATE TYPE "enum_configuraciones_salarios_sede" AS ENUM ('YOPAL', 'VILLANUEVA', 'TAURAMENA');

-- CreateEnum
CREATE TYPE "enum_documento_estado" AS ENUM ('vigente', 'proximo_a_vencer', 'vencido');

-- CreateEnum
CREATE TYPE "enum_firmas_desprendibles_estado" AS ENUM ('Activa', 'Revocada', 'Expirada');

-- CreateEnum
CREATE TYPE "enum_historial_recargos_planillas_accion" AS ENUM ('creacion', 'actualizacion', 'eliminacion', 'restauracion', 'aprobacion', 'rechazo', 'marcar_pendiente', 'marcar_no_esta', 'marcar_facturada', 'marcar_encontrada');

-- CreateEnum
CREATE TYPE "enum_liquidaciones_estado" AS ENUM ('Pendiente', 'Liquidado');

-- CreateEnum
CREATE TYPE "enum_liquidaciones_servicio_estado" AS ENUM ('liquidado', 'aprobado', 'rechazada', 'facturado', 'anulado', 'pendiente');

-- CreateEnum
CREATE TYPE "enum_notificacion_tipo" AS ENUM ('LIQUIDACION_ANULADA', 'LIQUIDACION_PENDIENTE', 'GENERAL', 'LIQUIDACION_CREADA', 'LIQUIDACION_ACTUALIZADA', 'ACTIVIDAD_PESV_ASIGNADA', 'ACTIVIDAD_PESV_ACTUALIZADA', 'ACTIVIDAD_PESV_VENCIDA', 'LIQUIDACION_FACTURADA', 'FACTURA_ANULADA', 'ACCION_CORRECTIVA_RECORDATORIO', 'ACCION_CORRECTIVA_VENCIDA');

-- CreateEnum
CREATE TYPE "enum_primas_estado" AS ENUM ('Pendiente', 'Pagado');

-- CreateEnum
CREATE TYPE "enum_recargos_planillas_estado" AS ENUM ('pendiente', 'liquidada', 'facturada', 'no_esta', 'encontrada', 'borrador', 'activo', 'completado', 'liquidado', 'cancelado');

-- CreateEnum
CREATE TYPE "enum_servicio_cancelados_motivo_cancelacion" AS ENUM ('cliente_solicito', 'conductor_no_disponible', 'vehiculo_averiado', 'vehiculo_no_disponible', 'condiciones_climaticas', 'problema_operativo', 'falta_pago', 'problemas_comunidad', 'paro_via', 'emergencia', 'duplicado', 'otro');

-- CreateEnum
CREATE TYPE "enum_servicio_estado" AS ENUM ('solicitado', 'planificado', 'en_curso', 'pendiente', 'realizado', 'planilla_asignada', 'liquidado', 'cancelado');

-- CreateEnum
CREATE TYPE "enum_servicio_historicos_tipo_operacion" AS ENUM ('creacion', 'actualizacion', 'eliminacion');

-- CreateEnum
CREATE TYPE "enum_servicio_proposito_servicio" AS ENUM ('personal', 'personal y herramienta');

-- CreateEnum
CREATE TYPE "enum_snapshots_recargos_planillas_tipo_snapshot" AS ENUM ('automatico', 'manual', 'pre_aprobacion', 'pre_facturacion');

-- CreateEnum
CREATE TYPE "enum_terceros_regimen" AS ENUM ('SIMPLIFICADO', 'COMUN', 'GRAN_CONTRIBUYENTE', 'NO_RESPONSABLE', 'AUTORRETENEDOR', 'ORDINARIO');

-- CreateEnum
CREATE TYPE "enum_terceros_tipo_persona" AS ENUM ('PERSONA', 'EMPRESA', 'PROPIETARIO_VEHICULO', 'PROVEEDOR');

-- CreateEnum
CREATE TYPE "enum_tipos_recargos_categoria" AS ENUM ('HORAS_EXTRAS', 'RECARGOS', 'FESTIVOS', 'SEGURIDAD_SOCIAL', 'PRESTACIONES', 'OTROS');

-- CreateEnum
CREATE TYPE "enum_users_area" AS ENUM ('administracion', 'operaciones', 'contabilidad', 'facturacion', 'talento_humano', 'hseq');

-- CreateEnum
CREATE TYPE "enum_users_role" AS ENUM ('admin', 'liquidador', 'facturador', 'aprobador', 'gestor_flota', 'gestor_nomina', 'consulta', 'usuario', 'gestor_servicio', 'gestor_planillas', 'kilometraje');

-- CreateEnum
CREATE TYPE "enum_vehiculos_estado" AS ENUM ('disponible', 'programado', 'servicio', 'mantenimiento', 'inactivo', 'desvinculado');

-- CreateEnum
CREATE TYPE "estado_factura_liq_enum" AS ENUM ('ACTIVA', 'ANULADA');

-- CreateEnum
CREATE TYPE "estado_liquidacion_servicio_enum" AS ENUM ('BORRADOR', 'LIQUIDADA', 'APROBADA', 'FACTURADA', 'ANULADA');

-- CreateEnum
CREATE TYPE "estado_snc_enum" AS ENUM ('ABIERTA', 'EN_TRATAMIENTO', 'CERRADA');

-- CreateEnum
CREATE TYPE "medio_autorizacion_enum" AS ENUM ('ESCRITO', 'CORREO', 'ACTA');

-- CreateEnum
CREATE TYPE "metodo_verificacion_enum" AS ENUM ('REVISION_DOCUMENTAL', 'VERIFICACION_OPERATIVA_CAMPO', 'CONFIRMACION_GPS_PLATAFORMA', 'CONFIRMACION_CLIENTE_INTERVENTOR', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_cliente_enum" AS ENUM ('EMPRESA', 'PERSONA_NATURAL');

-- CreateEnum
CREATE TYPE "tipo_deteccion_enum" AS ENUM ('DURANTE_SERVICIO', 'POST_SERVICIO', 'AUDITORIA_INTERVENTORIA', 'REPORTE_CLIENTE', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_salida_nc_enum" AS ENUM ('GPS_SISTEMA_TECNOLOGICO', 'INCUMPLIMIENTO_RUTA_HORARIO_DESTINO', 'VEHICULO_DIFERENTE_SIN_APROBACION', 'FALLA_MECANICA_ELECTRICA', 'DOCUMENTACION_VENCIDA_INCOMPLETA', 'CONDUCTOR_NO_APTO_INFRACCION_VIAL', 'QUEJA_CLIENTE', 'HALLAZGO_AUDITORIA_INTERVENTORIA_CLIENTE', 'PERSONAL_NO_AUTORIZADO_TRANSPORTADO', 'OTRO');

-- CreateEnum
CREATE TYPE "tipo_sangre_enum" AS ENUM ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-');

-- CreateEnum
CREATE TYPE "tipo_servicio_tarifa_enum" AS ENUM ('TRANSPORTE_DE_PERSONAL_EN_CAMIONETA', 'TRANSPORTE_DE_PERSONAL_EN_BUSETA', 'TRANSPORTE_DE_PERSONAL_EN_MICROBUS', 'TRANSPORTE_DE_PERSONAL_EN_BUS', 'TRANSPORTE_ADICIONAL_HORA_ADICIONAL', 'TRANSPORTE_ADICIONAL_KM_ADICIONAL', 'TRANSPORTE_ADICIONAL_DISPONIBILIDAD');

-- CreateEnum
CREATE TYPE "tratamiento_snc_enum" AS ENUM ('CORRECCION', 'CONTENCION', 'SUSPENSION', 'CONCESION');

-- CreateTable
CREATE TABLE "Evaluacion" (
    "id" UUID NOT NULL,
    "titulo" TEXT NOT NULL,
    "descripcion" TEXT,
    "requiere_firma" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "Evaluacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Opcion" (
    "id" UUID NOT NULL,
    "preguntaId" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "esCorrecta" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Opcion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pregunta" (
    "id" UUID NOT NULL,
    "evaluacionId" UUID NOT NULL,
    "texto" TEXT NOT NULL,
    "tipo" "TipoPreguntaEnum" NOT NULL,
    "puntaje" INTEGER NOT NULL,
    "relacionIzq" TEXT[],
    "relacionDer" TEXT[],
    "respuestaCorrecta" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Pregunta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Respuesta" (
    "id" UUID NOT NULL,
    "resultadoId" UUID NOT NULL,
    "preguntaId" UUID NOT NULL,
    "valor_texto" TEXT,
    "valor_numero" DOUBLE PRECISION,
    "opcionesIds" TEXT[],
    "relacion" JSONB,
    "puntaje" INTEGER NOT NULL,

    CONSTRAINT "Respuesta_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resultado" (
    "id" UUID NOT NULL,
    "evaluacionId" UUID NOT NULL,
    "nombre_completo" TEXT NOT NULL,
    "numero_documento" TEXT NOT NULL,
    "cargo" TEXT NOT NULL,
    "correo" TEXT NOT NULL,
    "telefono" TEXT NOT NULL,
    "puntaje_total" INTEGER NOT NULL,
    "firma" TEXT,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "device_fingerprint" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Resultado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SequelizeMeta" (
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "SequelizeMeta_pkey" PRIMARY KEY ("name")
);

-- CreateTable
CREATE TABLE "_mensual_origen_cierres" (
    "A" UUID NOT NULL,
    "B" UUID NOT NULL,

    CONSTRAINT "_mensual_origen_cierres_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "acciones_correctivas_preventivas" (
    "id" UUID NOT NULL,
    "accion_numero" VARCHAR(50) NOT NULL,
    "lugar_sede" VARCHAR(255),
    "proceso_origen_hallazgo" VARCHAR(255),
    "componente_elemento_referencia" TEXT,
    "fuente_genero_hallazgo" TEXT,
    "marco_legal_normativo" TEXT,
    "fecha_identificacion_hallazgo" DATE,
    "descripcion_hallazgo" TEXT,
    "tipo_hallazgo_detectado" VARCHAR(100),
    "variable_categoria_analisis" VARCHAR(255),
    "correccion_solucion_inmediata" TEXT,
    "fecha_implementacion" DATE,
    "valoracion_riesgo" VARCHAR(50),
    "requiere_actualizar_matriz" BOOLEAN DEFAULT false,
    "tipo_accion_ejecutar" VARCHAR(100),
    "fecha_evaluacion_eficacia" DATE,
    "criterio_evaluacion_eficacia" TEXT,
    "analisis_evidencias_cierre" TEXT,
    "evaluacion_cierre_eficaz" VARCHAR(50),
    "soporte_cierre_eficaz" TEXT,
    "fecha_cierre_definitivo" DATE,
    "responsable_cierre" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "creado_por_id" UUID,
    "fuente_genero_hallazgo_otros" VARCHAR(255),
    "tipo_hallazgo_otros" VARCHAR(255),
    "hallazgo_tipo" "HallazgoTipo",
    "aplica_correccion_inmediata" BOOLEAN DEFAULT true,
    "justificacion_no_correccion" TEXT,
    "responsable_correccion" VARCHAR(255),
    "registrado_por_id" UUID,
    "fecha_limite_cierre_accion" DATE,
    "responsable_ejecucion" VARCHAR(255),
    "fecha_seguimiento" DATE,
    "estado_accion" VARCHAR(100),
    "estado_global" "ActionStatusGlobal" NOT NULL DEFAULT 'EN_PROCESO',
    "estado_aprobacion" VARCHAR(20) DEFAULT 'PENDIENTE',
    "fecha_actualizacion_estado" DATE,
    "observaciones" TEXT,
    "matriz_a_actualizar" VARCHAR(255),
    "fecha_limite_evaluacion_eficacia" DATE,
    "cargo_responsable_cierre" VARCHAR(255),
    "observaciones_cierre" TEXT,
    "evaluaciones_eficacia" JSONB,
    "aplica_reapertura" BOOLEAN DEFAULT false,
    "fecha_reapertura" DATE,
    "razon_reapertura" TEXT,
    "accion_origen_reapertura" VARCHAR(50),
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "acciones_correctivas_preventivas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "actividades_pesv" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actividades_pesv_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "anticipos" (
    "valor" DECIMAL(10,2) NOT NULL,
    "fecha" DATE NOT NULL,
    "concepto" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "liquidacion_id" UUID,
    "conductor_id" UUID,
    "creado_por_id" UUID,

    CONSTRAINT "anticipos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "aprobaciones_accion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "accion_id" UUID NOT NULL,
    "orden" INTEGER DEFAULT 1,
    "rol" VARCHAR(100) NOT NULL,
    "aprobador_id" UUID,
    "estado" "EstadoAprobacion" NOT NULL DEFAULT 'PENDIENTE',
    "fecha" TIMESTAMPTZ(6),
    "comentario" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "aprobaciones_accion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bonificaciones" (
    "name" VARCHAR(255) NOT NULL,
    "values" TEXT NOT NULL DEFAULT '[]',
    "value" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "old_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "liquidacion_id" UUID,
    "vehiculo_id" UUID,
    "creado_por_id" UUID,

    CONSTRAINT "bonificaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bono_config_visual" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "config_liquidacion_id" UUID NOT NULL,
    "anio" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bono_config_visual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canvas_anotacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "scope" VARCHAR(40) NOT NULL,
    "anio" INTEGER NOT NULL,
    "mes" INTEGER NOT NULL,
    "sheet_key" VARCHAR(80) NOT NULL DEFAULT '',
    "offset_fila" INTEGER NOT NULL,
    "columna" INTEGER NOT NULL,
    "valor" TEXT,
    "estilo" JSONB,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ancla_tipo" VARCHAR(10) NOT NULL DEFAULT 'fila',
    "ancla_ref" VARCHAR(64) NOT NULL DEFAULT '',

    CONSTRAINT "canvas_anotacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "causas_accion_correctiva" (
    "id" UUID NOT NULL,
    "accion_correctiva_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL,
    "analisis_causa" TEXT NOT NULL,
    "descripcion_plan_accion" TEXT,
    "fecha_limite_implementacion" DATE,
    "responsable_ejecucion" VARCHAR(255),
    "fecha_seguimiento" DATE,
    "estado_seguimiento" VARCHAR(50),
    "descripcion_observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "es_causa_raiz" BOOLEAN DEFAULT false,
    "fecha_evaluacion_eficacia" DATE,
    "criterio_evaluacion_eficacia" TEXT,
    "analisis_evidencias_cierre" TEXT,
    "evaluacion_cierre_eficaz" VARCHAR(50),
    "soporte_cierre_eficaz" TEXT,
    "fecha_cierre" DATE,
    "responsable_cierre" VARCHAR(255),
    "sugerencia_ia" JSONB,

    CONSTRAINT "causas_accion_correctiva_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificacion_envio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "certificado_archivo" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "s3_key" VARCHAR(512) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "nit" VARCHAR(50) NOT NULL,
    "anio" INTEGER NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "size" INTEGER NOT NULL DEFAULT 0,
    "tercero_id" UUID,
    "tipo_certificado_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificado_archivo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificado_tercero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tercero_id" UUID NOT NULL,
    "certificado_id" UUID NOT NULL,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "certificado_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ciclos_seguimiento_eficacia" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "conductor_token" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conductor_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conductores" (
    "nombre" VARCHAR(255) NOT NULL,
    "apellido" VARCHAR(255) NOT NULL,
    "tipo_identificacion" VARCHAR(255) NOT NULL,
    "numero_identificacion" VARCHAR(255),
    "email" VARCHAR(255),
    "telefono" VARCHAR(255),
    "fecha_nacimiento" DATE,
    "genero" VARCHAR(255),
    "direccion" VARCHAR(255),
    "fecha_ingreso" DATE,
    "salario_base" DECIMAL(10,2),
    "eps" VARCHAR(255),
    "fondo_pension" VARCHAR(255),
    "arl" VARCHAR(255),
    "termino_contrato" TEXT,
    "fecha_terminacion" TEXT,
    "licencia_conduccion" JSONB,
    "ultimo_acceso" TIMESTAMPTZ(6),
    "permisos" JSONB DEFAULT '{"verViajes": true, "verDocumentos": true, "actualizarPerfil": true, "verMantenimientos": true}',
    "cargo" VARCHAR(255) NOT NULL DEFAULT 'CONDUCTOR',
    "categoria_licencia" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "foto_url" VARCHAR(255),
    "password" VARCHAR(255),
    "tipo_contrato" VARCHAR(255),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "vencimiento_licencia" DATE,
    "id" UUID NOT NULL,
    "estado" "enum_conductores_estado" NOT NULL DEFAULT 'activo',
    "sede_trabajo" "enum_conductores_sede_trabajo",
    "tipo_sangre" "tipo_sangre_enum",
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "oculto" BOOLEAN NOT NULL DEFAULT false,
    "nomina" BOOLEAN DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "conductores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_descuento_tercero" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "categoria" VARCHAR(50) NOT NULL,
    "concepto" VARCHAR(100) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "porcentaje" DECIMAL(8,4) NOT NULL,
    "base_calculo" VARCHAR(100) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "valor_dia_conductor" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "configuracion_descuento_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_liquidacion_servicio" (
    "id" UUID NOT NULL,
    "salario_basico" DECIMAL(12,2) NOT NULL DEFAULT 2358886,
    "cargo" VARCHAR(100) NOT NULL DEFAULT 'Conductor',
    "valor_hora_override" DECIMAL(12,4) NOT NULL DEFAULT 0,
    "conductor_adicional" DECIMAL(12,2) NOT NULL DEFAULT 73693,
    "pct_seg_social" DECIMAL(5,2) NOT NULL DEFAULT 22.96,
    "pct_prestaciones" DECIMAL(5,2) NOT NULL DEFAULT 21.83,
    "pct_admin" DECIMAL(5,2) NOT NULL DEFAULT 8,
    "prueba_covid" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "configuracion_liquidacion_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuracion_liquidador" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "valor" INTEGER NOT NULL,
    "descripcion" VARCHAR(255),
    "activo" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,

    CONSTRAINT "configuracion_liquidador_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_liquidacion" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "tipo" "enum_configuraciones_liquidacion_tipo" NOT NULL DEFAULT 'VALOR_NUMERICO',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "anio" INTEGER DEFAULT 2025,

    CONSTRAINT "configuraciones_liquidacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "configuraciones_salarios" (
    "id" UUID NOT NULL,
    "empresa_id" UUID,
    "salario_basico" DECIMAL(12,2) NOT NULL,
    "valor_hora_trabajador" DECIMAL(12,4) NOT NULL,
    "horas_mensuales_base" INTEGER NOT NULL DEFAULT 240,
    "vigencia_desde" TIMESTAMPTZ(6) NOT NULL,
    "vigencia_hasta" TIMESTAMPTZ(6),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "paga_dias_festivos" BOOLEAN NOT NULL DEFAULT false,
    "porcentaje_festivos" DECIMAL(8,2) NOT NULL DEFAULT 75.0000,
    "seguridad_social" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "administracion" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "prueba_antigeno_covid" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "prestaciones_sociales" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "sede" "enum_configuraciones_salarios_sede",
    "jornada_normal_horas" DECIMAL(4,2) DEFAULT 10.33,
    "jornada_festiva_horas" DECIMAL(4,2) DEFAULT 7.33,

    CONSTRAINT "configuraciones_salarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "detalles_recargos_dias" (
    "id" UUID NOT NULL,
    "dia_laboral_id" UUID NOT NULL,
    "tipo_recargo_id" UUID NOT NULL,
    "horas" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "valor_hora_base" DECIMAL(12,4),
    "valor_calculado" DECIMAL(12,2),
    "observaciones" TEXT,
    "calculado_automaticamente" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "porcentaje_aplicado" DECIMAL(8,2),
    "valor_hora_calculado" DECIMAL(12,4),
    "configuracion_salario_id" UUID,
    "fecha_aplicacion" DATE,
    "jornada_normal_horas" DECIMAL(4,2),
    "jornada_festiva_horas" DECIMAL(4,2),

    CONSTRAINT "detalles_recargos_dias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dias_laborales_planillas" (
    "id" UUID NOT NULL,
    "recargo_planilla_id" UUID NOT NULL,
    "dia" INTEGER NOT NULL,
    "hora_inicio" DECIMAL(4,2),
    "hora_fin" DECIMAL(4,2),
    "total_horas" DECIMAL(4,2) NOT NULL DEFAULT 0,
    "horas_ordinarias" DECIMAL(4,2) DEFAULT 0,
    "es_festivo" BOOLEAN NOT NULL DEFAULT false,
    "es_domingo" BOOLEAN NOT NULL DEFAULT false,
    "observaciones" TEXT,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "disponibilidad" BOOLEAN NOT NULL DEFAULT false,
    "kilometraje_inicial" DECIMAL(10,2),
    "kilometraje_final" DECIMAL(10,2),
    "pernocte" BOOLEAN NOT NULL DEFAULT false,
    "continua_siguiente_dia" BOOLEAN DEFAULT false,
    "horas_sueno" DECIMAL(4,2),
    "excesos_velocidad_dia" INTEGER DEFAULT 0,
    "preoperacional_realizado" BOOLEAN DEFAULT false,
    "siniestros" INTEGER DEFAULT 0,
    "siniestros_detalle" TEXT,

    CONSTRAINT "dias_laborales_planillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documento" (
    "id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "categoria" VARCHAR(255) NOT NULL,
    "nombre_original" VARCHAR(255) NOT NULL,
    "nombre_archivo" VARCHAR(255) NOT NULL,
    "ruta_archivo" VARCHAR(255) NOT NULL,
    "s3_key" VARCHAR(255),
    "filename" VARCHAR(255),
    "mimetype" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "fecha_vigencia" TIMESTAMPTZ(6),
    "estado" VARCHAR(255) NOT NULL DEFAULT 'ACTIVO',
    "upload_date" TIMESTAMPTZ(6) NOT NULL,
    "metadata" JSONB DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "conductor_id" UUID,

    CONSTRAINT "documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_compartidos" (
    "id" UUID NOT NULL,
    "token" VARCHAR(128) NOT NULL,
    "filename" VARCHAR(255) NOT NULL,
    "original_name" VARCHAR(255),
    "s3_key" VARCHAR(512) NOT NULL,
    "s3_url" VARCHAR(1024),
    "expires_at" TIMESTAMPTZ(6),
    "signed" BOOLEAN NOT NULL DEFAULT false,
    "signature_s3_key" VARCHAR(512),
    "signature_url" VARCHAR(1024),
    "ip_address" INET,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "conductor_id" UUID,

    CONSTRAINT "documentos_compartidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documentos_requeridos_conductor" (
    "id" SERIAL NOT NULL,
    "documento" VARCHAR(500) NOT NULL,
    "es_obligatorio" BOOLEAN NOT NULL DEFAULT true,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "fecha_creacion" TIMESTAMPTZ(6) NOT NULL,
    "fecha_actualizacion" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "documentos_requeridos_conductor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresas" (
    "id" UUID NOT NULL,
    "old_id" INTEGER,
    "nit" VARCHAR(50),
    "nombre" VARCHAR(255),
    "representante" VARCHAR(255),
    "cedula" VARCHAR(50),
    "telefono" VARCHAR(50),
    "direccion" VARCHAR(255),
    "createdAt" TIMESTAMP(6),
    "updatedAt" TIMESTAMP(6),
    "deletedAt" TIMESTAMP(6),
    "requiere_osi" BOOLEAN DEFAULT false,
    "paga_recargos" BOOLEAN DEFAULT false,
    "tipo" "tipo_cliente_enum" DEFAULT 'EMPRESA',
    "correo" VARCHAR(255),
    "oculto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evidencias_eficacia_cierre" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "excesos_velocidad" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conductor_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "excesos_velocidad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factura_liquidacion_item" (
    "id" UUID NOT NULL,
    "factura_id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "valor_liquidacion" DECIMAL(14,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factura_liquidacion_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "factura_liquidacion_servicio" (
    "id" UUID NOT NULL,
    "numero_factura" VARCHAR(50) NOT NULL,
    "fecha_facturacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "observaciones" TEXT,
    "valor_total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "estado" "estado_factura_liq_enum" NOT NULL DEFAULT 'ACTIVA',
    "facturado_por_id" UUID NOT NULL,
    "anulado_por_id" UUID,
    "motivo_anulacion" TEXT,
    "fecha_anulacion" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "factura_liquidacion_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firmas_desprendibles" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "firma_url" TEXT NOT NULL,
    "firma_s3_key" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "fecha_firma" TIMESTAMPTZ(6) NOT NULL,
    "hash_firma" TEXT,
    "estado" "enum_firmas_desprendibles_estado" NOT NULL DEFAULT 'Activa',
    "observaciones" TEXT,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "token" VARCHAR(128),
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "firmas_desprendibles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "firmas_primas" (
    "id" UUID NOT NULL,
    "prima_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "firma_url" TEXT NOT NULL,
    "firma_s3_key" TEXT NOT NULL,
    "ip_address" INET,
    "user_agent" TEXT,
    "fecha_firma" TIMESTAMPTZ(6) NOT NULL,
    "hash_firma" TEXT,
    "estado" "enum_firmas_desprendibles_estado" NOT NULL DEFAULT 'Activa',
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "firmas_primas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_answer_options" (
    "answer_id" UUID NOT NULL,
    "option_id" UUID NOT NULL,

    CONSTRAINT "form_answer_options_pkey" PRIMARY KEY ("answer_id","option_id")
);

-- CreateTable
CREATE TABLE "form_answers" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "occurrence_id" UUID,
    "row_index" INTEGER,
    "value_text" TEXT,
    "value_decimal" DECIMAL(18,6),
    "value_boolean" BOOLEAN,
    "value_date" DATE,
    "value_datetime" TIMESTAMPTZ(6),
    "value_json" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_assignment_targets" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "target_type" VARCHAR(30) NOT NULL,
    "conductor_id" UUID,
    "vehicle_id" UUID,
    "sede" VARCHAR(80),
    "group_key" VARCHAR(120),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_assignment_targets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_assignments" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
    "frequency" VARCHAR(30) NOT NULL DEFAULT 'ON_DEMAND',
    "limit_policy" VARCHAR(30) NOT NULL DEFAULT 'UNLIMITED',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'America/Bogota',
    "starts_at" TIMESTAMPTZ(6),
    "ends_at" TIMESTAMPTZ(6),
    "context_schema_json" JSONB NOT NULL DEFAULT '{}',
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_attachments" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "answer_id" UUID,
    "client_attachment_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    "object_key" VARCHAR(1024),
    "original_name" VARCHAR(255),
    "mime_type" VARCHAR(150) NOT NULL,
    "byte_size" BIGINT NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploaded_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_definitions" (
    "id" UUID NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "owner_area" VARCHAR(80) NOT NULL DEFAULT 'hseq',
    "created_by_id" UUID NOT NULL,
    "updated_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_field_options" (
    "id" UUID NOT NULL,
    "field_id" UUID NOT NULL,
    "value" VARCHAR(120) NOT NULL,
    "label" VARCHAR(255) NOT NULL,
    "color" VARCHAR(20),
    "score" DECIMAL(12,2),
    "sort_order" INTEGER NOT NULL,
    "metadata_json" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "form_field_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_field_templates" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(100) NOT NULL,
    "field_type" VARCHAR(40) NOT NULL,
    "template_json" JSONB NOT NULL,
    "owner_area" VARCHAR(80),
    "is_global" BOOLEAN NOT NULL DEFAULT false,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_field_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_fields" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "section_id" UUID NOT NULL,
    "parent_field_id" UUID,
    "key" VARCHAR(120) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "label" VARCHAR(500) NOT NULL,
    "help_text" TEXT,
    "placeholder" VARCHAR(500),
    "required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL,
    "config_json" JSONB NOT NULL DEFAULT '{}',
    "validation_json" JSONB NOT NULL DEFAULT '{}',
    "visibility_rule_json" JSONB,
    "default_value_json" JSONB,

    CONSTRAINT "form_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_sections" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "key" VARCHAR(120) NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "sort_order" INTEGER NOT NULL,
    "settings_json" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "form_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submission_events" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "event_type" VARCHAR(40) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" UUID,
    "payload_json" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "form_submission_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_submissions" (
    "id" UUID NOT NULL,
    "client_submission_id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "service_id" UUID,
    "supersedes_submission_id" UUID,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "business_date" DATE NOT NULL,
    "period_key" VARCHAR(80),
    "context_json" JSONB NOT NULL DEFAULT '{}',
    "device_json" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ(6),
    "voided_at" TIMESTAMPTZ(6),
    "voided_by_id" UUID,
    "void_reason" TEXT,

    CONSTRAINT "form_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "form_versions" (
    "id" UUID NOT NULL,
    "form_id" UUID NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(255) NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "settings_json" JSONB NOT NULL DEFAULT '{}',
    "source_metadata_json" JSONB NOT NULL DEFAULT '{}',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" UUID NOT NULL,
    "published_by_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(6),
    "archived_at" TIMESTAMPTZ(6),

    CONSTRAINT "form_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_sarlaft_ptee" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "radicado" VARCHAR(50) NOT NULL,
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
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulario_sarlaft_ptee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_sarlaft_ptee_documento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "formulario_id" UUID NOT NULL,
    "tipo_documento" VARCHAR(50) NOT NULL,
    "nombre_archivo" VARCHAR(255) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL,
    "tamano_bytes" BIGINT NOT NULL,
    "hash_sha256" VARCHAR(64),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulario_sarlaft_ptee_documento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_sarlaft_ptee_documento_entrega" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "documento_generado_id" UUID NOT NULL,
    "canal" VARCHAR(20) NOT NULL,
    "destinatario" VARCHAR(255),
    "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    "proveedor" VARCHAR(30),
    "provider_message_id" VARCHAR(255),
    "intento" INTEGER NOT NULL DEFAULT 1,
    "error_codigo" VARCHAR(80),
    "token_hash" VARCHAR(64),
    "expires_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulario_sarlaft_ptee_documento_entrega_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formulario_sarlaft_ptee_documento_generado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "formulario_id" UUID NOT NULL,
    "marca" VARCHAR(30) NOT NULL,
    "clase" VARCHAR(50) NOT NULL,
    "version_documento" INTEGER NOT NULL,
    "estado_documental" VARCHAR(20) NOT NULL,
    "codigo_template" VARCHAR(30) NOT NULL,
    "version_template" VARCHAR(20) NOT NULL,
    "template_sha256" VARCHAR(64) NOT NULL,
    "s3_key" VARCHAR(500) NOT NULL,
    "mime_type" VARCHAR(100) NOT NULL DEFAULT 'application/pdf',
    "tamano_bytes" BIGINT NOT NULL,
    "pdf_sha256" VARCHAR(64) NOT NULL,
    "generado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "formulario_sarlaft_ptee_documento_generado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "formularios_asistencia" (
    "id" UUID NOT NULL,
    "tematica" VARCHAR(255) NOT NULL,
    "objetivo" TEXT,
    "fecha" DATE NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "creado_por_id" UUID NOT NULL,
    "hora_inicio" VARCHAR(5),
    "hora_finalizacion" VARCHAR(5),
    "duracion_minutos" INTEGER,
    "tipo_evento" VARCHAR(50) NOT NULL DEFAULT 'capacitacion',
    "tipo_evento_otro" VARCHAR(255),
    "lugar_sede" VARCHAR(255),
    "nombre_instructor" VARCHAR(255),
    "observaciones" TEXT,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "formularios_asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_estado_liquidacion" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "estado_anterior" VARCHAR(50),
    "estado_nuevo" VARCHAR(50) NOT NULL,
    "usuario_id" UUID NOT NULL,
    "motivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "accion" VARCHAR(50) DEFAULT 'cambio_estado',
    "snapshot" JSONB,

    CONSTRAINT "historial_estado_liquidacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_estado_liquidacion_tercero_final" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "estado_anterior" VARCHAR(20),
    "estado_nuevo" VARCHAR(20) NOT NULL,
    "usuario_id" UUID,
    "motivo" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historial_estado_liquidacion_tercero_final_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "historial_recargos_planillas" (
    "id" UUID NOT NULL,
    "recargo_planilla_id" UUID NOT NULL,
    "accion" "enum_historial_recargos_planillas_accion" NOT NULL,
    "version_anterior" INTEGER,
    "version_nueva" INTEGER NOT NULL,
    "datos_anteriores" JSONB,
    "datos_nuevos" JSONB,
    "campos_modificados" VARCHAR(255)[],
    "motivo" TEXT,
    "ip_usuario" INET,
    "user_agent" TEXT,
    "realizado_por_id" UUID NOT NULL,
    "fecha_accion" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "historial_recargos_planillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inducciones_visitantes" (
    "id" TEXT NOT NULL,
    "sede" "Sede" NOT NULL,
    "fecha" TIMESTAMP(6) NOT NULL,
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
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "creado_por_id" UUID,

    CONSTRAINT "inducciones_visitantes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invitaciones_usuario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "correo" VARCHAR(255) NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "area" VARCHAR(255)[] DEFAULT ARRAY[]::VARCHAR(255)[],
    "cargo" VARCHAR(255),
    "invitado_por_id" UUID NOT NULL,
    "estado" VARCHAR(50) NOT NULL DEFAULT 'pendiente',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitaciones_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_chat_mensaje" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "liquidacion_tercero_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "contenido_cifrado" TEXT NOT NULL,
    "nonce" VARCHAR(24) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL DEFAULT 'NOTA',
    "recordatorio_id" UUID,
    "deleted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_chat_mensaje_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_ingreso_transmeralda" (
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
CREATE TABLE "liquidacion_ingreso_transmeralda_concepto" (
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

-- CreateTable
CREATE TABLE "liquidacion_ingreso_transmeralda_fila" (
    "id" UUID NOT NULL,
    "liquidacion_ingreso_id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
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
CREATE TABLE "liquidacion_recordatorio" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_recordatorio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_servicio" (
    "id" UUID NOT NULL,
    "consecutivo" VARCHAR(50) NOT NULL,
    "cliente_id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "fecha_liquidacion" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "valor_servicios" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_recargos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_transporte_adicional" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_administracion_ta" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_pernoctes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentaje_iva" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_iva" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "recargos_data" JSONB,
    "estado" "estado_liquidacion_servicio_enum" NOT NULL DEFAULT 'BORRADOR',
    "motivo_anulacion" TEXT,
    "observaciones" TEXT,
    "osi" TEXT,
    "tercero_liquidado" BOOLEAN NOT NULL DEFAULT false,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "liquidado_por_id" UUID,
    "aprobado_por_id" UUID,
    "fecha_aprobacion" TIMESTAMPTZ(6),
    "fecha_facturacion" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "cantidad_pernoctes" INTEGER NOT NULL DEFAULT 0,
    "valor_unitario_pernoctes" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "operadora" TEXT,

    CONSTRAINT "liquidacion_servicio_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_servicio_item" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "servicio_id" UUID,
    "recargo_planilla_id" UUID,
    "tercero_id" UUID,
    "placa" VARCHAR(20) NOT NULL,
    "fecha_inicial" DATE NOT NULL,
    "fecha_final" DATE NOT NULL,
    "recorrido" VARCHAR(500) NOT NULL,
    "tipo_servicio" "tipo_servicio_tarifa_enum" NOT NULL,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "valor_unitario" DECIMAL(12,2) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "porcentaje_descuento" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_final" DECIMAL(12,2) NOT NULL,
    "numero_planilla" VARCHAR(50),
    "recargos_detalle" JSONB,
    "valor_recargos_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cantidad_pernoctes" INTEGER NOT NULL DEFAULT 0,
    "valor_pernocte_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_pernoctes_total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "liquidacion_servicio_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero" (
    "id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "tercero_id" UUID,
    "placa" VARCHAR(20) NOT NULL,
    "recorrido" VARCHAR(500) NOT NULL,
    "fechas" VARCHAR(100) NOT NULL,
    "valor_unitario" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cantidad" DECIMAL(10,2) NOT NULL DEFAULT 1,
    "total_facturado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "porcentaje_admin" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "valor_admin" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "valor_liquidar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ingreso_extra_global" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ingresos_extra_aval" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "ingreso_empresa" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "src_index" INTEGER NOT NULL DEFAULT 0,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "item_id" UUID,
    "mes" INTEGER,
    "anio" INTEGER,
    "total_costos_laborales" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_gastos_operativos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_impuestos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_descuentos" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_pagar" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'BORRADOR',

    CONSTRAINT "liquidacion_tercero_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_adicional_periodo_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "liquidacion_tercero_concepto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "adicionales" JSONB NOT NULL DEFAULT '[]',
    "es_propietario_overrides" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "color_hoja" VARCHAR(9),
    "es_multi_propietario" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "liquidacion_tercero_final_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final_adicional" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final_concepto" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "propietario_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "liquidacion_tercero_final_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "liquidacion_tercero_id" UUID NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "aplica_impuestos" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final_propietario" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "liquidacion_tercero_final_id" UUID NOT NULL,
    "tercero_id" UUID,
    "nombre" VARCHAR(255) NOT NULL,
    "identificacion" VARCHAR(50),
    "porcentaje" DECIMAL(8,4) NOT NULL,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "liquidacion_tercero_final_propietario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_final_snapshot" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "liquidacion_tercero_ocasional" (
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
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "total_facturado_items" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_admin_items" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total_liquidar_items" DECIMAL(14,2) NOT NULL DEFAULT 0,

    CONSTRAINT "liquidacion_tercero_mensual_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_ocasional_adicional" (
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "liquidacion_tercero_mensual_adicional_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_ocasional_concepto" (
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "actualizado_por_id" UUID,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "liquidacion_tercero_mensual_concepto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_ocasional_draft" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "liquidacion_ocasional_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "liquidacion_tercero_mensual_draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_ocasional_item" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "liquidacion_tercero_mensual_item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_tercero_ocasional_snapshot" (
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

    CONSTRAINT "liquidacion_tercero_mensual_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidacion_vehiculo" (
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,

    CONSTRAINT "liquidacion_vehiculo_pkey" PRIMARY KEY ("liquidacion_id","vehiculo_id")
);

-- CreateTable
CREATE TABLE "liquidaciones" (
    "salud" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "pension" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "cesantias" DECIMAL(10,2) NOT NULL DEFAULT 0.00,
    "observaciones" TEXT,
    "ajuste_parex" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ajuste_salarial" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "ajuste_salarial_por_dia" BOOLEAN NOT NULL DEFAULT false,
    "auxilio_transporte" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "conceptos_adicionales" JSON,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "dias_laborados" INTEGER NOT NULL DEFAULT 0,
    "dias_laborados_anual" INTEGER NOT NULL DEFAULT 0,
    "dias_laborados_villanueva" INTEGER NOT NULL DEFAULT 0,
    "fecha_liquidacion" TIMESTAMPTZ(6),
    "interes_cesantias" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "old_id" INTEGER,
    "periodo_end" VARCHAR(255) NOT NULL,
    "periodo_end_incapacidad" VARCHAR(255),
    "periodo_end_vacaciones" VARCHAR(255),
    "periodo_start" VARCHAR(255) NOT NULL,
    "periodo_start_incapacidad" VARCHAR(255),
    "periodo_start_vacaciones" VARCHAR(255),
    "salario_devengado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "sueldo_total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_anticipos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_bonificaciones" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_pernotes" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_recargos" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total_vacaciones" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "valor_incapacidad" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "id" UUID NOT NULL,
    "estado" "enum_liquidaciones_estado" NOT NULL DEFAULT 'Pendiente',
    "conductor_id" UUID,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "liquidado_por_id" UUID,
    "share_token" VARCHAR(64),
    "share_token_expires_at" TIMESTAMPTZ(6),
    "ajuste_parex_recargos_completos" BOOLEAN NOT NULL DEFAULT false,
    "ajuste_recargos_config" JSON,
    "dias_ajuste_deducciones" INTEGER,
    "disponibilidad" DECIMAL(10,2) DEFAULT 0,
    "desprendible_visible" BOOLEAN NOT NULL DEFAULT false,
    "mostrar_recargos" BOOLEAN NOT NULL DEFAULT false,
    "es_cotransmeq" BOOLEAN NOT NULL DEFAULT false,
    "descontar_salud_salario" BOOLEAN NOT NULL DEFAULT false,
    "descontar_pension_salario" BOOLEAN NOT NULL DEFAULT false,
    "ajuste_geopark" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "liquidaciones_servicios" (
    "id" UUID NOT NULL,
    "consecutivo" VARCHAR(255) NOT NULL,
    "fecha_liquidacion" TIMESTAMPTZ(6) NOT NULL,
    "valor_total" DECIMAL(12,2) NOT NULL,
    "user_id" UUID NOT NULL,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "estado" "enum_liquidaciones_servicio_estado" NOT NULL DEFAULT 'pendiente',

    CONSTRAINT "liquidaciones_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mantenimientos" (
    "values" TEXT NOT NULL DEFAULT '[]',
    "value" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "liquidacion_id" UUID,

    CONSTRAINT "mantenimientos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "municipios" (
    "codigo_departamento" INTEGER NOT NULL,
    "nombre_departamento" VARCHAR(255) NOT NULL,
    "codigo_municipio" INTEGER NOT NULL,
    "nombre_municipio" VARCHAR(255) NOT NULL,
    "longitud" DECIMAL(10,6) NOT NULL,
    "latitud" DECIMAL(10,6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "tipo" VARCHAR(255) NOT NULL,

    CONSTRAINT "municipios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notificacion" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "usuario_id" UUID NOT NULL,
    "tipo" "enum_notificacion_tipo" NOT NULL DEFAULT 'GENERAL',
    "titulo" VARCHAR(255) NOT NULL,
    "mensaje" TEXT NOT NULL,
    "referencia_id" UUID,
    "leida" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "referencia_tipo" VARCHAR(50),

    CONSTRAINT "notificacion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pernotes" (
    "cantidad" INTEGER NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "fechas" TEXT NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "empresa_id" UUID NOT NULL,
    "old_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "liquidacion_id" UUID,
    "creado_por_id" UUID,

    CONSTRAINT "pernotes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "preoperacionales" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "conductor_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "realizado" BOOLEAN NOT NULL DEFAULT true,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preoperacionales_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "primas" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "mes" INTEGER NOT NULL,
    "anio" INTEGER NOT NULL,
    "prima" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "prima_pendiente" DECIMAL(10,2),
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "estado" "enum_primas_estado" NOT NULL DEFAULT 'Pendiente',
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "tiempo_trabajado_dias" INTEGER,
    "sueldo_basico" DECIMAL(10,2),
    "auxilio_transporte" DECIMAL(10,2),
    "sueldo_variable" DECIMAL(10,2),
    "total_base_liquidacion" DECIMAL(10,2),

    CONSTRAINT "primas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recargos" (
    "valor" DECIMAL(10,2) NOT NULL,
    "pag_cliente" BOOLEAN,
    "mes" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "empresa_id" UUID NOT NULL,
    "old_id" INTEGER,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "vehiculo_id" UUID,
    "liquidacion_id" UUID,
    "porcentaje_propietario" DECIMAL(5,2),
    "es_automatico" BOOLEAN NOT NULL DEFAULT false,
    "incluir" BOOLEAN NOT NULL DEFAULT true,
    "emisor" VARCHAR(50),
    "numero_planilla" VARCHAR(50),
    "origen_planilla_id" UUID,
    "es_override" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "recargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recargos_planillas" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "vehiculo_id" UUID NOT NULL,
    "empresa_id" UUID NOT NULL,
    "numero_planilla" VARCHAR(50),
    "mes" INTEGER NOT NULL,
    "año" INTEGER NOT NULL,
    "total_dias_laborados" INTEGER DEFAULT 0,
    "total_horas_trabajadas" DECIMAL(5,2) DEFAULT 0,
    "total_horas_ordinarias" DECIMAL(5,2) DEFAULT 0,
    "archivo_planilla_url" VARCHAR(500),
    "archivo_planilla_nombre" VARCHAR(255),
    "archivo_planilla_tipo" VARCHAR(100),
    "archivo_planilla_tamaño" INTEGER,
    "observaciones" TEXT,
    "estado" "enum_recargos_planillas_estado" NOT NULL DEFAULT 'pendiente',
    "version" INTEGER NOT NULL DEFAULT 1,
    "creado_por_id" UUID,
    "actualizado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "planilla_s3key" TEXT,
    "servicio_id" UUID,
    "estado_conductor" VARCHAR(20),
    "via_trocha" BOOLEAN DEFAULT false,
    "via_afirmado" BOOLEAN DEFAULT false,
    "via_mixto" BOOLEAN DEFAULT false,
    "via_pavimentada" BOOLEAN DEFAULT false,
    "riesgo_desniveles" BOOLEAN DEFAULT false,
    "riesgo_deslizamientos" BOOLEAN DEFAULT false,
    "riesgo_sin_senalizacion" BOOLEAN DEFAULT false,
    "riesgo_animales" BOOLEAN DEFAULT false,
    "riesgo_peatones" BOOLEAN DEFAULT false,
    "riesgo_trafico_alto" BOOLEAN DEFAULT false,
    "fuente_consulta" VARCHAR(20),
    "calificacion_servicio" VARCHAR(20),
    "tiempo_disponibilidad_horas" DECIMAL(5,1),
    "duracion_trayecto_horas" DECIMAL(5,1),
    "numero_dias_servicio" INTEGER,
    "imported_from_transmeralda_id" UUID,
    "imported_from_transmeralda_at" TIMESTAMPTZ(6),

    CONSTRAINT "recargos_planillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_dia_laboral" (
    "id" UUID NOT NULL,
    "conductor_id" UUID NOT NULL,
    "fecha" DATE NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "hora_inicio" VARCHAR(10),
    "hora_fin" VARCHAR(10),
    "horas_conducidas" DECIMAL(4,1),
    "cliente_id" UUID,
    "cliente_nombre" VARCHAR(255),
    "vehiculo_placa" VARCHAR(20),
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "mantenimiento_vehiculo_id" UUID,
    "mantenimiento_vehiculo_placa" VARCHAR(20),

    CONSTRAINT "registro_dia_laboral_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_dia_laboral_bono" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registro_dia_id" UUID NOT NULL,
    "segmento_id" UUID,
    "config_liquidacion_id" UUID NOT NULL,
    "valor" DECIMAL(10,2),
    "creado_por_id" UUID,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "registro_dia_laboral_bono_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "registro_dia_laboral_segmento" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "registro_dia_id" UUID NOT NULL,
    "cliente_id" UUID,
    "cliente_nombre" VARCHAR(255),
    "vehiculo_id" UUID,
    "vehiculo_placa" VARCHAR(20) NOT NULL,
    "hora_inicio" VARCHAR(10) NOT NULL,
    "hora_fin" VARCHAR(10) NOT NULL,
    "horas_conducidas" DECIMAL(4,1) NOT NULL DEFAULT 0,
    "km_inicial" INTEGER,
    "km_final" INTEGER,
    "pernocte" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 1,
    "observaciones" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inicio_dia_siguiente" BOOLEAN DEFAULT false,
    "fin_dia_siguiente" BOOLEAN DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "registro_dia_laboral_segmento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "respuestas_asistencia" (
    "id" UUID NOT NULL,
    "formulario_id" UUID NOT NULL,
    "nombre_completo" VARCHAR(255) NOT NULL,
    "numero_documento" VARCHAR(50) NOT NULL,
    "cargo" VARCHAR(255) NOT NULL,
    "numero_telefono" VARCHAR(20) NOT NULL,
    "firma" TEXT NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "user_agent" TEXT NOT NULL,
    "device_fingerprint" VARCHAR(255) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pertenece_comite" BOOLEAN,
    "nombre_comite" VARCHAR(255),

    CONSTRAINT "respuestas_asistencia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "salidas_no_conformes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
    "resultado_verificacion" TEXT,

    CONSTRAINT "salidas_no_conformes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seguimientos_causa" (
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
CREATE TABLE "seguimientos_correccion_inmediata" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
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
CREATE TABLE "servicio_historicos" (
    "id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "campo_modificado" VARCHAR(255) NOT NULL,
    "valor_anterior" TEXT,
    "valor_nuevo" TEXT NOT NULL,
    "tipo_operacion" "enum_servicio_historicos_tipo_operacion" NOT NULL DEFAULT 'actualizacion',
    "fecha_modificacion" TIMESTAMPTZ(6) NOT NULL,
    "ip_usuario" VARCHAR(255),
    "navegador_usuario" VARCHAR(255),
    "detalles" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "servicio_historicos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicio_liquidaciones" (
    "id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "liquidacion_id" UUID NOT NULL,
    "valor_liquidado" DECIMAL(12,2) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "servicio_liquidaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios" (
    "origen_especifico" VARCHAR(255) NOT NULL,
    "destino_especifico" VARCHAR(255) NOT NULL,
    "fecha_solicitud" TIMESTAMPTZ(6) NOT NULL,
    "fecha_realizacion" TIMESTAMPTZ(6),
    "fecha_finalizacion" TIMESTAMPTZ(6),
    "origen_latitud" DOUBLE PRECISION,
    "origen_longitud" DOUBLE PRECISION,
    "destino_latitud" DOUBLE PRECISION,
    "destino_longitud" DOUBLE PRECISION,
    "valor" DECIMAL(12,2) NOT NULL,
    "numero_planilla" VARCHAR(255),
    "observaciones" TEXT,
    "no_conformidades" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "id" UUID NOT NULL,
    "conductor_id" UUID,
    "vehiculo_id" UUID,
    "cliente_id" UUID NOT NULL,
    "origen_id" UUID NOT NULL,
    "destino_id" UUID NOT NULL,
    "estado" "enum_servicio_estado" NOT NULL DEFAULT 'solicitado',
    "share_token" VARCHAR(64),
    "share_token_expires_at" TIMESTAMPTZ(6),
    "proposito_servicio" "enum_servicio_proposito_servicio" NOT NULL DEFAULT 'personal',

    CONSTRAINT "servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "servicios_cancelados" (
    "id" UUID NOT NULL,
    "servicio_id" UUID NOT NULL,
    "usuario_cancelacion_id" UUID NOT NULL,
    "observaciones" TEXT,
    "fecha_cancelacion" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "user_cancelacion_id" UUID,
    "motivo_cancelacion" "enum_servicio_cancelados_motivo_cancelacion" NOT NULL,

    CONSTRAINT "servicios_cancelados_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sesiones" (
    "id" UUID NOT NULL,
    "usuario_id" UUID NOT NULL,
    "ip" VARCHAR(45),
    "user_agent" TEXT,
    "token_hash" VARCHAR(64),
    "remember_me" BOOLEAN NOT NULL DEFAULT false,
    "token_expiry" TIMESTAMPTZ(6) NOT NULL,
    "last_activity" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(6),

    CONSTRAINT "sesiones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "snapshots_recargos_planillas" (
    "id" UUID NOT NULL,
    "recargo_planilla_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot_completo" JSONB NOT NULL,
    "es_snapshot_mayor" BOOLEAN DEFAULT false,
    "tipo_snapshot" "enum_snapshots_recargos_planillas_tipo_snapshot" DEFAULT 'automatico',
    "tamaño_bytes" INTEGER,
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "snapshots_recargos_planillas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subsystems" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "title" VARCHAR(100) NOT NULL,
    "description" TEXT NOT NULL,
    "url" VARCHAR(255) NOT NULL,
    "health_endpoint" VARCHAR(100) NOT NULL DEFAULT '/',
    "icon_name" VARCHAR(50) NOT NULL,
    "color_gradient" VARCHAR(100) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "required_permission" VARCHAR(50),
    "required_roles" VARCHAR(255)[] DEFAULT (ARRAY[]::character varying[])::character varying(255)[],
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subsystems_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tarifas_servicios" (
    "id" UUID NOT NULL,
    "cliente_id" UUID NOT NULL,
    "operadora" TEXT,
    "anio" INTEGER NOT NULL,
    "valor_24h" DECIMAL(12,2) NOT NULL,
    "valor_12h" DECIMAL(12,2) NOT NULL,
    "valor_hora" DECIMAL(12,2) NOT NULL,
    "valor_km" DECIMAL(12,2) NOT NULL,
    "km_dia" INTEGER NOT NULL DEFAULT 150,
    "valor_pernocte" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tarifas_servicios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tercero_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tercero_id" UUID NOT NULL,
    "token" VARCHAR(512) NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tercero_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terceros" (
    "id" UUID NOT NULL,
    "nombre_completo" VARCHAR(255) NOT NULL,
    "identificacion" VARCHAR(50),
    "telefono" VARCHAR(50),
    "correo" VARCHAR(255),
    "direccion" VARCHAR(500),
    "tipo_persona" "enum_terceros_tipo_persona" NOT NULL DEFAULT 'PERSONA',
    "regimen" "enum_terceros_regimen",
    "notas" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),

    CONSTRAINT "terceros_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipo_certificado" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "codigo" VARCHAR(50) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tipo_certificado_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tipos_recargos" (
    "id" UUID NOT NULL,
    "codigo" VARCHAR(20) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" VARCHAR(255),
    "categoria" "enum_tipos_recargos_categoria" NOT NULL,
    "subcategoria" VARCHAR(50),
    "porcentaje" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "es_valor_fijo" BOOLEAN NOT NULL DEFAULT false,
    "valor_fijo" DECIMAL(12,2) DEFAULT 0,
    "aplica_festivos" BOOLEAN,
    "aplica_domingos" BOOLEAN,
    "aplica_nocturno" BOOLEAN,
    "aplica_diurno" BOOLEAN,
    "orden_calculo" INTEGER NOT NULL DEFAULT 1,
    "es_hora_extra" BOOLEAN NOT NULL DEFAULT false,
    "requiere_horas_extras" BOOLEAN NOT NULL DEFAULT false,
    "limite_horas_diarias" DECIMAL(4,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "vigencia_desde" TIMESTAMPTZ(6) NOT NULL,
    "vigencia_hasta" TIMESTAMPTZ(6),
    "creado_por_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "adicional" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tipos_recargos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "nombre" VARCHAR(255) NOT NULL,
    "correo" VARCHAR(255) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "telefono" VARCHAR(255),
    "role" "enum_users_role" DEFAULT 'usuario',
    "permisos" JSONB DEFAULT '{"flota": false, "nomina": false, "clientes": false, "recargos": false, "usuarios": false, "servicios": false, "asistencias": false, "conductores": false, "evaluaciones": false, "liquidador_terceros": false, "acciones-correctivas": false}',
    "ultimo_acceso" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "areas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "cargo" VARCHAR(255),
    "firma_url" TEXT,
    "es_invitado" BOOLEAN NOT NULL DEFAULT false,
    "invitado_por_id" UUID,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehiculos" (
    "placa" VARCHAR(255) NOT NULL,
    "marca" VARCHAR(255),
    "linea" VARCHAR(255),
    "modelo" VARCHAR(255),
    "color" VARCHAR(255),
    "clase_vehiculo" VARCHAR(255) NOT NULL,
    "tipo_carroceria" VARCHAR(255),
    "combustible" VARCHAR(255),
    "numero_motor" VARCHAR(255),
    "vin" VARCHAR(255),
    "numero_serie" VARCHAR(255),
    "numero_chasis" VARCHAR(255),
    "propietario_nombre" VARCHAR(255),
    "propietario_identificacion" VARCHAR(255),
    "kilometraje" INTEGER DEFAULT 0,
    "fecha_matricula" VARCHAR(255),
    "created_at" TIMESTAMPTZ(6) NOT NULL,
    "propietario_id" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "deleted_at" TIMESTAMPTZ(6),
    "id" UUID NOT NULL,
    "estado" "enum_vehiculos_estado" NOT NULL DEFAULT 'disponible',
    "conductor_id" UUID,
    "oculto" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "vehiculos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "_mensual_origen_cierres_B_idx" ON "_mensual_origen_cierres"("B" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_accion_numero_idx" ON "acciones_correctivas_preventivas"("accion_numero" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "acciones_correctivas_preventivas_accion_numero_key" ON "acciones_correctivas_preventivas"("accion_numero" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_deleted_at_idx" ON "acciones_correctivas_preventivas"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_estado_global_idx" ON "acciones_correctivas_preventivas"("estado_global" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_fecha_identificacion_halla_idx" ON "acciones_correctivas_preventivas"("fecha_identificacion_hallazgo" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_hallazgo_tipo_idx" ON "acciones_correctivas_preventivas"("hallazgo_tipo" ASC);

-- CreateIndex
CREATE INDEX "acciones_correctivas_preventivas_tipo_accion_ejecutar_idx" ON "acciones_correctivas_preventivas"("tipo_accion_ejecutar" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_anio_idx" ON "actividades_pesv"("anio" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_deleted_at_idx" ON "actividades_pesv"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_estado_idx" ON "actividades_pesv"("estado" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_frecuencia_idx" ON "actividades_pesv"("frecuencia" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_prioridad_idx" ON "actividades_pesv"("prioridad" ASC);

-- CreateIndex
CREATE INDEX "actividades_pesv_responsable_ejecucion_id_idx" ON "actividades_pesv"("responsable_ejecucion_id" ASC);

-- CreateIndex
CREATE INDEX "aprobaciones_accion_accion_id_idx" ON "aprobaciones_accion"("accion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "aprobaciones_accion_accion_id_key" ON "aprobaciones_accion"("accion_id" ASC);

-- CreateIndex
CREATE INDEX "aprobaciones_accion_estado_idx" ON "aprobaciones_accion"("estado" ASC);

-- CreateIndex
CREATE INDEX "bono_config_visual_anio_visible_idx" ON "bono_config_visual"("anio" ASC, "visible" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "bono_config_visual_config_liquidacion_id_anio_key" ON "bono_config_visual"("config_liquidacion_id" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "idx_bono_config_visual_anio_visible" ON "bono_config_visual"("anio" ASC, "visible" ASC);

-- CreateIndex
CREATE INDEX "idx_canvas_anotacion_ancla" ON "canvas_anotacion"("scope" ASC, "anio" ASC, "mes" ASC, "ancla_tipo" ASC, "ancla_ref" ASC);

-- CreateIndex
CREATE INDEX "idx_canvas_anotacion_hoja" ON "canvas_anotacion"("scope" ASC, "anio" ASC, "mes" ASC, "sheet_key" ASC);

-- CreateIndex
CREATE INDEX "idx_canvas_anotacion_periodo" ON "canvas_anotacion"("scope" ASC, "anio" ASC, "mes" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_anotacion_celda" ON "canvas_anotacion"("scope" ASC, "anio" ASC, "mes" ASC, "sheet_key" ASC, "ancla_tipo" ASC, "ancla_ref" ASC, "offset_fila" ASC, "columna" ASC);

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_accion_correctiva_id_idx" ON "causas_accion_correctiva"("accion_correctiva_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "causas_accion_correctiva_accion_correctiva_id_orden_key" ON "causas_accion_correctiva"("accion_correctiva_id" ASC, "orden" ASC);

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_estado_seguimiento_idx" ON "causas_accion_correctiva"("estado_seguimiento" ASC);

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_evaluacion_cierre_eficaz_idx" ON "causas_accion_correctiva"("evaluacion_cierre_eficaz" ASC);

-- CreateIndex
CREATE INDEX "causas_accion_correctiva_fecha_cierre_idx" ON "causas_accion_correctiva"("fecha_cierre" ASC);

-- CreateIndex
CREATE INDEX "idx_causas_estado_seguimiento" ON "causas_accion_correctiva"("estado_seguimiento" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_certificado_id_idx" ON "certificacion_envio"("certificado_id" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_email_destino_idx" ON "certificacion_envio"("email_destino" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_emitido_at_idx" ON "certificacion_envio"("emitido_at" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_tercero_id_idx" ON "certificacion_envio"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_tipo_envio_idx" ON "certificacion_envio"("tipo_envio" ASC);

-- CreateIndex
CREATE INDEX "certificacion_envio_token_acceso_idx" ON "certificacion_envio"("token_acceso" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "certificacion_envio_token_acceso_key" ON "certificacion_envio"("token_acceso" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_envio_certif" ON "certificacion_envio"("certificado_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_envio_tercero" ON "certificacion_envio"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_envio_tipo_envio" ON "certificacion_envio"("tipo_envio" ASC);

-- CreateIndex
CREATE INDEX "certificado_archivo_anio_idx" ON "certificado_archivo"("anio" ASC);

-- CreateIndex
CREATE INDEX "certificado_archivo_created_at_idx" ON "certificado_archivo"("created_at" DESC);

-- CreateIndex
CREATE INDEX "certificado_archivo_nit_idx" ON "certificado_archivo"("nit" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "certificado_archivo_s3_key_key" ON "certificado_archivo"("s3_key" ASC);

-- CreateIndex
CREATE INDEX "certificado_archivo_tercero_id_idx" ON "certificado_archivo"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "certificado_archivo_tipo_certificado_id_idx" ON "certificado_archivo"("tipo_certificado_id" ASC);

-- CreateIndex
CREATE INDEX "certificado_archivo_tipo_idx" ON "certificado_archivo"("tipo" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_anio" ON "certificado_archivo"("anio" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_created_at" ON "certificado_archivo"("created_at" DESC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_nit" ON "certificado_archivo"("nit" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_tercero" ON "certificado_archivo"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_tipo" ON "certificado_archivo"("tipo" ASC);

-- CreateIndex
CREATE INDEX "idx_cert_archivo_tipo_certificado" ON "certificado_archivo"("tipo_certificado_id" ASC);

-- CreateIndex
CREATE INDEX "certificado_tercero_certificado_id_idx" ON "certificado_tercero"("certificado_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "certificado_tercero_tercero_id_certificado_id_key" ON "certificado_tercero"("tercero_id" ASC, "certificado_id" ASC);

-- CreateIndex
CREATE INDEX "certificado_tercero_tercero_id_idx" ON "certificado_tercero"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "ciclos_seguimiento_eficacia_accion_correctiva_id_idx" ON "ciclos_seguimiento_eficacia"("accion_correctiva_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ciclos_seguimiento_eficacia_accion_correctiva_id_numero__key" ON "ciclos_seguimiento_eficacia"("accion_correctiva_id" ASC, "numero_ciclo" ASC);

-- CreateIndex
CREATE INDEX "conductor_token_conductor_id_idx" ON "conductor_token"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "conductor_token_token_idx" ON "conductor_token"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conductor_token_token_key" ON "conductor_token"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conductores_email_key" ON "conductores"("email" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "conductores_numero_identificacion_key" ON "conductores"("numero_identificacion" ASC);

-- CreateIndex
CREATE INDEX "configuracion_descuento_tercero_activo_idx" ON "configuracion_descuento_tercero"("activo" ASC);

-- CreateIndex
CREATE INDEX "configuracion_descuento_tercero_categoria_idx" ON "configuracion_descuento_tercero"("categoria" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "configuracion_descuento_tercero_concepto_key" ON "configuracion_descuento_tercero"("concepto" ASC);

-- CreateIndex
CREATE INDEX "idx_config_salario_activo_vigencia" ON "configuraciones_salarios"("activo" ASC, "vigencia_desde" ASC);

-- CreateIndex
CREATE INDEX "idx_config_salario_empresa_vigencia" ON "configuraciones_salarios"("empresa_id" ASC, "vigencia_desde" ASC);

-- CreateIndex
CREATE INDEX "idx_config_salario_paga_festivos" ON "configuraciones_salarios"("paga_dias_festivos" ASC);

-- CreateIndex
CREATE INDEX "idx_config_salario_porcentaje_festivos" ON "configuraciones_salarios"("porcentaje_festivos" ASC);

-- CreateIndex
CREATE INDEX "idx_config_salarios_activo_vigencia" ON "configuraciones_salarios"("activo" ASC, "vigencia_desde" ASC, "vigencia_hasta" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_activo" ON "detalles_recargos_dias"("activo" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_automatico" ON "detalles_recargos_dias"("calculado_automaticamente" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_config_salario" ON "detalles_recargos_dias"("configuracion_salario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_created" ON "detalles_recargos_dias"("created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_dia" ON "detalles_recargos_dias"("dia_laboral_id" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_fecha_aplicacion" ON "detalles_recargos_dias"("fecha_aplicacion" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_horas" ON "detalles_recargos_dias"("horas" ASC);

-- CreateIndex
CREATE INDEX "idx_detalle_recargo_tipo" ON "detalles_recargos_dias"("tipo_recargo_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "idx_dia_laboral_planilla_dia" ON "dias_laborales_planillas"("recargo_planilla_id" ASC, "dia" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "documentos_compartidos_token_key" ON "documentos_compartidos"("token" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_compartidos_conductor_id" ON "documentos_compartidos"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "idx_documentos_compartidos_expires" ON "documentos_compartidos"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "documentos_requeridos_conductor_activo" ON "documentos_requeridos_conductor"("activo" ASC);

-- CreateIndex
CREATE INDEX "documentos_requeridos_conductor_es_obligatorio" ON "documentos_requeridos_conductor"("es_obligatorio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "empresas__n_i_t" ON "empresas"("nit" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_correo_key" ON "empresas"("correo" ASC);

-- CreateIndex
CREATE INDEX "evidencias_eficacia_cierre_accion_correctiva_id_idx" ON "evidencias_eficacia_cierre"("accion_correctiva_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "evidencias_eficacia_cierre_accion_correctiva_id_orden_key" ON "evidencias_eficacia_cierre"("accion_correctiva_id" ASC, "orden" ASC);

-- CreateIndex
CREATE INDEX "excesos_velocidad_conductor_id_idx" ON "excesos_velocidad"("conductor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "excesos_velocidad_conductor_id_vehiculo_id_mes_anio_key" ON "excesos_velocidad"("conductor_id" ASC, "vehiculo_id" ASC, "mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "excesos_velocidad_mes_anio_idx" ON "excesos_velocidad"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "excesos_velocidad_vehiculo_id_idx" ON "excesos_velocidad"("vehiculo_id" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_item_factura_id_idx" ON "factura_liquidacion_item"("factura_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "factura_liquidacion_item_factura_id_liquidacion_id_key" ON "factura_liquidacion_item"("factura_id" ASC, "liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_item_liquidacion_id_idx" ON "factura_liquidacion_item"("liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_servicio_deleted_at_idx" ON "factura_liquidacion_servicio"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_servicio_estado_idx" ON "factura_liquidacion_servicio"("estado" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_servicio_facturado_por_id_idx" ON "factura_liquidacion_servicio"("facturado_por_id" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_servicio_fecha_facturacion_idx" ON "factura_liquidacion_servicio"("fecha_facturacion" ASC);

-- CreateIndex
CREATE INDEX "factura_liquidacion_servicio_numero_factura_idx" ON "factura_liquidacion_servicio"("numero_factura" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "factura_liquidacion_servicio_numero_factura_key" ON "factura_liquidacion_servicio"("numero_factura" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "firmas_desprendibles_token_key" ON "firmas_desprendibles"("token" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_desprendibles_conductor_id" ON "firmas_desprendibles"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_desprendibles_fecha_firma" ON "firmas_desprendibles"("fecha_firma" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_desprendibles_liquidacion_id" ON "firmas_desprendibles"("liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_desprendibles_token" ON "firmas_desprendibles"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uk_firmas_desprendibles_liquidacion_conductor" ON "firmas_desprendibles"("liquidacion_id" ASC, "conductor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uk_firmas_desprendibles_token" ON "firmas_desprendibles"("token" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_primas_conductor_id" ON "firmas_primas"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_primas_fecha_firma" ON "firmas_primas"("fecha_firma" ASC);

-- CreateIndex
CREATE INDEX "idx_firmas_primas_prima_id" ON "firmas_primas"("prima_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uk_firmas_primas_prima_conductor" ON "firmas_primas"("prima_id" ASC, "conductor_id" ASC);

-- CreateIndex
CREATE INDEX "idx_form_answers_field" ON "form_answers"("field_id" ASC);

-- CreateIndex
CREATE INDEX "idx_form_answers_submission" ON "form_answers"("submission_id" ASC);

-- CreateIndex
CREATE INDEX "idx_form_assignments_version" ON "form_assignments"("version_id" ASC);

-- CreateIndex
CREATE INDEX "idx_form_attachments_submission" ON "form_attachments"("submission_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_attachments_client" ON "form_attachments"("client_attachment_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_definitions_code" ON "form_definitions"("code" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_definitions_slug" ON "form_definitions"("slug" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_field_options_order" ON "form_field_options"("field_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_field_options_value" ON "form_field_options"("field_id" ASC, "value" ASC);

-- CreateIndex
CREATE INDEX "idx_form_fields_version_section_order" ON "form_fields"("version_id" ASC, "section_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_fields_key" ON "form_fields"("version_id" ASC, "key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_fields_order" ON "form_fields"("section_id" ASC, "parent_field_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE INDEX "idx_form_sections_version_order" ON "form_sections"("version_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_sections_key" ON "form_sections"("version_id" ASC, "key" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_sections_order" ON "form_sections"("version_id" ASC, "sort_order" ASC);

-- CreateIndex
CREATE INDEX "idx_form_events_submission_time" ON "form_submission_events"("submission_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_form_submissions_portal" ON "form_submissions"("conductor_id" ASC, "business_date" DESC, "status" ASC);

-- CreateIndex
CREATE INDEX "idx_form_submissions_version" ON "form_submissions"("version_id" ASC, "submitted_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_submissions_client" ON "form_submissions"("client_submission_id" ASC);

-- CreateIndex
CREATE INDEX "idx_form_versions_form_status" ON "form_versions"("form_id" ASC, "status" ASC, "version_number" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "uq_form_versions_number" ON "form_versions"("form_id" ASC, "version_number" ASC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_correo_idx" ON "formulario_sarlaft_ptee"("correo" ASC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_estado_idx" ON "formulario_sarlaft_ptee"("estado" ASC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_fecha_envio_idx" ON "formulario_sarlaft_ptee"("fecha_envio" DESC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_numero_documento_idx" ON "formulario_sarlaft_ptee"("numero_documento" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formulario_sarlaft_ptee_radicado_key" ON "formulario_sarlaft_ptee"("radicado" ASC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_tipo_formulario_idx" ON "formulario_sarlaft_ptee"("tipo_formulario" ASC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_correo" ON "formulario_sarlaft_ptee"("correo" ASC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_documento" ON "formulario_sarlaft_ptee"("numero_documento" ASC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_estado" ON "formulario_sarlaft_ptee"("estado" ASC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_fecha_envio" ON "formulario_sarlaft_ptee"("fecha_envio" DESC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_tipo" ON "formulario_sarlaft_ptee"("tipo_formulario" ASC);

-- CreateIndex
CREATE INDEX "formulario_sarlaft_ptee_documento_formulario_id_idx" ON "formulario_sarlaft_ptee_documento"("formulario_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formulario_sarlaft_ptee_documento_formulario_id_tipo_doc_key" ON "formulario_sarlaft_ptee_documento"("formulario_id" ASC, "tipo_documento" ASC);

-- CreateIndex
CREATE INDEX "idx_sarlaft_doc_form" ON "formulario_sarlaft_ptee_documento"("formulario_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "fspd_entrega_doc_canal_dest_intento_key" ON "formulario_sarlaft_ptee_documento_entrega"("documento_generado_id" ASC, "canal" ASC, "destinatario" ASC, "intento" ASC);

-- CreateIndex
CREATE INDEX "fspd_entrega_documento_idx" ON "formulario_sarlaft_ptee_documento_entrega"("documento_generado_id" ASC);

-- CreateIndex
CREATE INDEX "fspd_entrega_estado_idx" ON "formulario_sarlaft_ptee_documento_entrega"("estado" ASC);

-- CreateIndex
CREATE INDEX "fspd_entrega_expires_at_idx" ON "formulario_sarlaft_ptee_documento_entrega"("expires_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "fspd_entrega_token_hash_key" ON "formulario_sarlaft_ptee_documento_entrega"("token_hash" ASC);

-- CreateIndex
CREATE INDEX "fspd_generado_created_at_idx" ON "formulario_sarlaft_ptee_documento_generado"("created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "fspd_generado_formulario_clase_version_key" ON "formulario_sarlaft_ptee_documento_generado"("formulario_id" ASC, "clase" ASC, "version_documento" ASC);

-- CreateIndex
CREATE INDEX "fspd_generado_formulario_idx" ON "formulario_sarlaft_ptee_documento_generado"("formulario_id" ASC);

-- CreateIndex
CREATE INDEX "fspd_generado_pdf_sha256_idx" ON "formulario_sarlaft_ptee_documento_generado"("pdf_sha256" ASC);

-- CreateIndex
CREATE INDEX "formularios_asistencia_deleted_at_idx" ON "formularios_asistencia"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "formularios_asistencia_fecha_idx" ON "formularios_asistencia"("fecha" ASC);

-- CreateIndex
CREATE INDEX "formularios_asistencia_tipo_evento_idx" ON "formularios_asistencia"("tipo_evento" ASC);

-- CreateIndex
CREATE INDEX "formularios_asistencia_token_idx" ON "formularios_asistencia"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "formularios_asistencia_token_key" ON "formularios_asistencia"("token" ASC);

-- CreateIndex
CREATE INDEX "historial_estado_liquidacion_created_at_idx" ON "historial_estado_liquidacion"("created_at" ASC);

-- CreateIndex
CREATE INDEX "historial_estado_liquidacion_liquidacion_id_idx" ON "historial_estado_liquidacion"("liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_hist_estado_lt_final_cierre" ON "historial_estado_liquidacion_tercero_final"("liquidacion_tercero_final_id" ASC, "created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_hist_estado_lt_final_usuario" ON "historial_estado_liquidacion_tercero_final"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_historial_accion" ON "historial_recargos_planillas"("accion" ASC);

-- CreateIndex
CREATE INDEX "idx_historial_fecha" ON "historial_recargos_planillas"("fecha_accion" ASC);

-- CreateIndex
CREATE INDEX "idx_historial_recargo" ON "historial_recargos_planillas"("recargo_planilla_id" ASC);

-- CreateIndex
CREATE INDEX "idx_historial_usuario" ON "historial_recargos_planillas"("realizado_por_id" ASC);

-- CreateIndex
CREATE INDEX "idx_historial_version" ON "historial_recargos_planillas"("version_nueva" ASC);

-- CreateIndex
CREATE INDEX "idx_inducciones_cedula" ON "inducciones_visitantes"("visitante_cedula" ASC);

-- CreateIndex
CREATE INDEX "idx_inducciones_fecha_desc" ON "inducciones_visitantes"("fecha" DESC);

-- CreateIndex
CREATE INDEX "idx_inducciones_sede" ON "inducciones_visitantes"("sede" ASC);

-- CreateIndex
CREATE INDEX "inducciones_visitantes_fecha_idx" ON "inducciones_visitantes"("fecha" DESC);

-- CreateIndex
CREATE INDEX "inducciones_visitantes_sede_idx" ON "inducciones_visitantes"("sede" ASC);

-- CreateIndex
CREATE INDEX "inducciones_visitantes_visitante_cedula_idx" ON "inducciones_visitantes"("visitante_cedula" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "invitaciones_usuario_token_key" ON "invitaciones_usuario"("token" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_chat_mensaje_created_at_idx" ON "liquidacion_chat_mensaje"("created_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_chat_mensaje_liquidacion_tercero_id_idx" ON "liquidacion_chat_mensaje"("liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_chat_mensaje_tipo_idx" ON "liquidacion_chat_mensaje"("tipo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_chat_mensaje_usuario_id_idx" ON "liquidacion_chat_mensaje"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_actualizado_por_id_idx" ON "liquidacion_ingreso_transmeralda"("actualizado_por_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_creado_por_id_idx" ON "liquidacion_ingreso_transmeralda"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_deleted_at_idx" ON "liquidacion_ingreso_transmeralda"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_mes_anio_idx" ON "liquidacion_ingreso_transmeralda"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_ingreso_transmeralda_mes_anio_key" ON "liquidacion_ingreso_transmeralda"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "idx_ingreso_concepto_cabecera" ON "liquidacion_ingreso_transmeralda_concepto"("liquidacion_ingreso_id" ASC);

-- CreateIndex
CREATE INDEX "idx_ingreso_concepto_deleted" ON "liquidacion_ingreso_transmeralda_concepto"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "idx_ingreso_concepto_hoja" ON "liquidacion_ingreso_transmeralda_concepto"("liquidacion_ingreso_id" ASC, "hoja" ASC);

-- CreateIndex
CREATE INDEX "idx_ingreso_concepto_tipo" ON "liquidacion_ingreso_transmeralda_concepto"("tipo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_fila_deleted_at_idx" ON "liquidacion_ingreso_transmeralda_fila"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_fila_incluir_adicional_idx" ON "liquidacion_ingreso_transmeralda_fila"("incluir_adicional" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso_i_idx" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_ingreso_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso_i_key" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_ingreso_id" ASC, "liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_ingreso_transmeralda_fila_liquidacion_tercero_i_idx" ON "liquidacion_ingreso_transmeralda_fila"("liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_recordatorio_aplicado_en_liquidacion_id_idx" ON "liquidacion_recordatorio"("aplicado_en_liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_recordatorio_creado_por_usuario_id_idx" ON "liquidacion_recordatorio"("creado_por_usuario_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_recordatorio_estado_idx" ON "liquidacion_recordatorio"("estado" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_recordatorio_liquidacion_origen_id_idx" ON "liquidacion_recordatorio"("liquidacion_origen_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_recordatorio_placa_mes_anio_idx" ON "liquidacion_recordatorio"("placa" ASC, "mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_cliente_id_idx" ON "liquidacion_servicio"("cliente_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_servicio_consecutivo_key" ON "liquidacion_servicio"("consecutivo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_deleted_at_idx" ON "liquidacion_servicio"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_estado_idx" ON "liquidacion_servicio"("estado" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_mes_anio_idx" ON "liquidacion_servicio"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_item_liquidacion_id_idx" ON "liquidacion_servicio_item"("liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_item_recargo_planilla_id_idx" ON "liquidacion_servicio_item"("recargo_planilla_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_item_servicio_id_idx" ON "liquidacion_servicio_item"("servicio_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_servicio_item_tercero_id_idx" ON "liquidacion_servicio_item"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_item_id_idx" ON "liquidacion_tercero"("item_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_liquidacion_id_idx" ON "liquidacion_tercero"("liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_placa_idx" ON "liquidacion_tercero"("placa" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_tercero_id_idx" ON "liquidacion_tercero"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_adic_periodo_snapshot_created" ON "liquidacion_tercero_adicional_periodo_snapshot"("created_at" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_adic_periodo_snapshot_periodo" ON "liquidacion_tercero_adicional_periodo_snapshot"("anio" ASC, "mes" ASC, "rama" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_adic_periodo_snapshot_usuario" ON "liquidacion_tercero_adicional_periodo_snapshot"("usuario_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_lt_adic_periodo_snapshot_version" ON "liquidacion_tercero_adicional_periodo_snapshot"("anio" ASC, "mes" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_concepto_concepto_idx" ON "liquidacion_tercero_concepto"("concepto" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_concepto_conductor_id_idx" ON "liquidacion_tercero_concepto"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_concepto_liquidacion_tercero_id_idx" ON "liquidacion_tercero_concepto"("liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_concepto_tipo_idx" ON "liquidacion_tercero_concepto"("tipo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_anio_mes_idx" ON "liquidacion_tercero_final"("anio" ASC, "mes" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_tercero_final_consecutivo_key" ON "liquidacion_tercero_final"("consecutivo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_estado_idx" ON "liquidacion_tercero_final"("estado" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_liquidacion_servicio_id_idx" ON "liquidacion_tercero_final"("liquidacion_servicio_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_placa_idx" ON "liquidacion_tercero_final"("placa" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_tercero_id_idx" ON "liquidacion_tercero_final"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_vehiculo_id_idx" ON "liquidacion_tercero_final"("vehiculo_id" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_final_adicional_cierre" ON "liquidacion_tercero_final_adicional"("liquidacion_tercero_final_id" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_final_adicional_cierre_orden" ON "liquidacion_tercero_final_adicional"("liquidacion_tercero_final_id" ASC, "orden" ASC);

-- CreateIndex
CREATE INDEX "idx_lt_final_adicional_deleted_at" ON "liquidacion_tercero_final_adicional"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_concepto_ltf_idx" ON "liquidacion_tercero_final_concepto"("liquidacion_tercero_final_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_concepto_concepto_idx" ON "liquidacion_tercero_final_concepto"("concepto" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_concepto_conductor_id_idx" ON "liquidacion_tercero_final_concepto"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_concepto_tipo_idx" ON "liquidacion_tercero_final_concepto"("tipo" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_item_ltf_idx" ON "liquidacion_tercero_final_item"("liquidacion_tercero_final_id" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_item_lti_idx" ON "liquidacion_tercero_final_item"("liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liq_tercero_final_item_unique" ON "liquidacion_tercero_final_item"("liquidacion_tercero_final_id" ASC, "liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_liq_tercero_final_prop_cierre" ON "liquidacion_tercero_final_propietario"("liquidacion_tercero_final_id" ASC);

-- CreateIndex
CREATE INDEX "idx_liq_tercero_final_prop_deleted_at" ON "liquidacion_tercero_final_propietario"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "idx_liq_tercero_final_prop_tercero" ON "liquidacion_tercero_final_propietario"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_snap_created_at_idx" ON "liquidacion_tercero_final_snapshot"("created_at" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_snap_ltf_rama_idx" ON "liquidacion_tercero_final_snapshot"("liquidacion_tercero_final_id" ASC, "rama" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liq_tercero_final_snap_unique" ON "liquidacion_tercero_final_snapshot"("liquidacion_tercero_final_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "liq_tercero_final_snap_usuario_idx" ON "liquidacion_tercero_final_snapshot"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_liquidacion_tercero_mensual_actualizado_por_id" ON "liquidacion_tercero_ocasional"("actualizado_por_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_tercero_mensual_consecutivo_key" ON "liquidacion_tercero_ocasional"("consecutivo" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_creado_por_id_idx" ON "liquidacion_tercero_ocasional"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_deleted_at_idx" ON "liquidacion_tercero_ocasional"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_estado_idx" ON "liquidacion_tercero_ocasional"("estado" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_mes_anio_idx" ON "liquidacion_tercero_ocasional"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_ocasional_periodo" ON "liquidacion_tercero_ocasional"("mes" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "idx_ocasional_adicional_liquidacion_placa" ON "liquidacion_tercero_ocasional_adicional"("liquidacion_ocasional_id" ASC, "placa" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_adicional_deleted_at_idx" ON "liquidacion_tercero_ocasional_adicional"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_adicional_liquidacion_mensual_id_id" ON "liquidacion_tercero_ocasional_adicional"("liquidacion_ocasional_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_adicional_placa_idx" ON "liquidacion_tercero_ocasional_adicional"("placa" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_adicional_tercero_id_idx" ON "liquidacion_tercero_ocasional_adicional"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_concepto_idx" ON "liquidacion_tercero_ocasional_concepto"("concepto" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_conductor_id_idx" ON "liquidacion_tercero_ocasional_concepto"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_deleted_at_idx" ON "liquidacion_tercero_ocasional_concepto"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_liquidacion_mensual_id_idx" ON "liquidacion_tercero_ocasional_concepto"("liquidacion_ocasional_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_placa_aplicada_idx" ON "liquidacion_tercero_ocasional_concepto"("placa_aplicada" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_concepto_tipo_idx" ON "liquidacion_tercero_ocasional_concepto"("tipo" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_draft_liquidacion" ON "liquidacion_tercero_ocasional_draft"("liquidacion_ocasional_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_draft_updated_at" ON "liquidacion_tercero_ocasional_draft"("updated_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_ocasional_draft_user" ON "liquidacion_tercero_ocasional_draft"("liquidacion_ocasional_id" ASC, "usuario_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_deleted_at" ON "liquidacion_tercero_ocasional_item"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_liquidacion" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_liquidacion_excluido" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id" ASC, "excluido" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_placa" ON "liquidacion_tercero_ocasional_item"("placa" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_tercero" ON "liquidacion_tercero_ocasional_item"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_mensual_item_tercero_documento" ON "liquidacion_tercero_ocasional_item"("tercero_documento" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_ocasional_item_pivote" ON "liquidacion_tercero_ocasional_item"("liquidacion_ocasional_id" ASC, "liquidacion_tercero_id" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_snapshot_created_at_idx" ON "liquidacion_tercero_ocasional_snapshot"("created_at" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_snapshot_liquidacion_mensual_id_ram" ON "liquidacion_tercero_ocasional_snapshot"("liquidacion_ocasional_id" ASC, "rama" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidacion_tercero_mensual_snapshot_liquidacion_mensual_id_ver" ON "liquidacion_tercero_ocasional_snapshot"("liquidacion_ocasional_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "liquidacion_tercero_mensual_snapshot_usuario_id_idx" ON "liquidacion_tercero_ocasional_snapshot"("usuario_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_share_token_key" ON "liquidaciones"("share_token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "liquidaciones_servicios_consecutivo_key" ON "liquidaciones_servicios"("consecutivo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "municipios_codigo_municipio_key" ON "municipios"("codigo_municipio" ASC);

-- CreateIndex
CREATE INDEX "notificacion_created_at_idx" ON "notificacion"("created_at" DESC);

-- CreateIndex
CREATE INDEX "notificacion_leida_idx" ON "notificacion"("leida" ASC);

-- CreateIndex
CREATE INDEX "notificacion_usuario_id_idx" ON "notificacion"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "preoperacionales_conductor_id_idx" ON "preoperacionales"("conductor_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "preoperacionales_conductor_id_vehiculo_id_fecha_key" ON "preoperacionales"("conductor_id" ASC, "vehiculo_id" ASC, "fecha" ASC);

-- CreateIndex
CREATE INDEX "preoperacionales_fecha_idx" ON "preoperacionales"("fecha" ASC);

-- CreateIndex
CREATE INDEX "preoperacionales_vehiculo_id_idx" ON "preoperacionales"("vehiculo_id" ASC);

-- CreateIndex
CREATE INDEX "idx_primas_conductor_periodo" ON "primas"("conductor_id" ASC, "anio" ASC, "mes" ASC);

-- CreateIndex
CREATE INDEX "idx_primas_estado" ON "primas"("estado" ASC);

-- CreateIndex
CREATE INDEX "idx_primas_periodo" ON "primas"("anio" ASC, "mes" ASC);

-- CreateIndex
CREATE INDEX "idx_recargos_es_automatico" ON "recargos"("es_automatico" ASC);

-- CreateIndex
CREATE INDEX "recargos_es_automatico_idx" ON "recargos"("es_automatico" ASC);

-- CreateIndex
CREATE INDEX "recargos_liquidacion_id_idx" ON "recargos"("liquidacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "uniq_recargo_origen_planilla" ON "recargos"("liquidacion_id" ASC, "origen_planilla_id" ASC);

-- CreateIndex
CREATE INDEX "idx_registro_dia_laboral_deleted_at" ON "registro_dia_laboral"("deleted_at" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "registro_dia_laboral_conductor_id_fecha_key" ON "registro_dia_laboral"("conductor_id" ASC, "fecha" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_conductor_id_idx" ON "registro_dia_laboral"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_fecha_idx" ON "registro_dia_laboral"("fecha" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_mantenimiento_vehiculo_id_idx" ON "registro_dia_laboral"("mantenimiento_vehiculo_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rdlb_config" ON "registro_dia_laboral_bono"("config_liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rdlb_registro" ON "registro_dia_laboral_bono"("registro_dia_id" ASC);

-- CreateIndex
CREATE INDEX "idx_rdlb_segmento" ON "registro_dia_laboral_bono"("segmento_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_bono_config_liquidacion_id_idx" ON "registro_dia_laboral_bono"("config_liquidacion_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_bono_creado_por_id_idx" ON "registro_dia_laboral_bono"("creado_por_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_bono_registro_dia_id_idx" ON "registro_dia_laboral_bono"("registro_dia_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_bono_segmento_id_idx" ON "registro_dia_laboral_bono"("segmento_id" ASC);

-- CreateIndex
CREATE INDEX "idx_reg_dia_seg_deleted_at" ON "registro_dia_laboral_segmento"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_segmento_cliente_id_idx" ON "registro_dia_laboral_segmento"("cliente_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_segmento_registro_dia_id_idx" ON "registro_dia_laboral_segmento"("registro_dia_id" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_segmento_registro_dia_id_orden_idx" ON "registro_dia_laboral_segmento"("registro_dia_id" ASC, "orden" ASC);

-- CreateIndex
CREATE INDEX "registro_dia_laboral_segmento_vehiculo_id_idx" ON "registro_dia_laboral_segmento"("vehiculo_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "respuestas_asistencia_formulario_id_device_fingerprint_key" ON "respuestas_asistencia"("formulario_id" ASC, "device_fingerprint" ASC);

-- CreateIndex
CREATE INDEX "respuestas_asistencia_formulario_id_idx" ON "respuestas_asistencia"("formulario_id" ASC);

-- CreateIndex
CREATE INDEX "respuestas_asistencia_numero_documento_idx" ON "respuestas_asistencia"("numero_documento" ASC);

-- CreateIndex
CREATE INDEX "respuestas_asistencia_pertenece_comite_idx" ON "respuestas_asistencia"("pertenece_comite" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_clasificacion_nc_idx" ON "salidas_no_conformes"("clasificacion_nc" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_conductor_id_idx" ON "salidas_no_conformes"("conductor_id" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_estado_idx" ON "salidas_no_conformes"("estado" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_fecha_deteccion_idx" ON "salidas_no_conformes"("fecha_deteccion" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_numero_snc_idx" ON "salidas_no_conformes"("numero_snc" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "salidas_no_conformes_numero_snc_key" ON "salidas_no_conformes"("numero_snc" ASC);

-- CreateIndex
CREATE INDEX "salidas_no_conformes_vehiculo_id_idx" ON "salidas_no_conformes"("vehiculo_id" ASC);

-- CreateIndex
CREATE INDEX "seguimientos_causa_causa_id_idx" ON "seguimientos_causa"("causa_id" ASC);

-- CreateIndex
CREATE INDEX "seguimientos_causa_estado_idx" ON "seguimientos_causa"("estado_accion" ASC);

-- CreateIndex
CREATE INDEX "seguimientos_causa_fecha_idx" ON "seguimientos_causa"("fecha_seguimiento" ASC);

-- CreateIndex
CREATE INDEX "seguimientos_correccion_inmediata_accion_correctiva_id_idx" ON "seguimientos_correccion_inmediata"("accion_correctiva_id" ASC);

-- CreateIndex
CREATE INDEX "seguimientos_correccion_inmediata_fecha_seguimiento_idx" ON "seguimientos_correccion_inmediata"("fecha_seguimiento" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "servicio_liquidaciones_servicio_id_liquidacion_id" ON "servicio_liquidaciones"("servicio_id" ASC, "liquidacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "servicio_liquidaciones_servicio_id_liquidacion_id_key" ON "servicio_liquidaciones"("servicio_id" ASC, "liquidacion_id" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "servicios_share_token_key" ON "servicios"("share_token" ASC);

-- CreateIndex
CREATE INDEX "servicios_cancelados_fecha_cancelacion" ON "servicios_cancelados"("fecha_cancelacion" ASC);

-- CreateIndex
CREATE INDEX "servicios_cancelados_servicio_id" ON "servicios_cancelados"("servicio_id" ASC);

-- CreateIndex
CREATE INDEX "servicios_cancelados_usuario_cancelacion_id" ON "servicios_cancelados"("usuario_cancelacion_id" ASC);

-- CreateIndex
CREATE INDEX "sesiones_is_active_idx" ON "sesiones"("is_active" ASC);

-- CreateIndex
CREATE INDEX "sesiones_token_hash_idx" ON "sesiones"("token_hash" ASC);

-- CreateIndex
CREATE INDEX "sesiones_usuario_id_idx" ON "sesiones"("usuario_id" ASC);

-- CreateIndex
CREATE INDEX "snapshots_recargos_planillas_es_snapshot_mayor" ON "snapshots_recargos_planillas"("es_snapshot_mayor" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "snapshots_recargos_planillas_recargo_planilla_id_version" ON "snapshots_recargos_planillas"("recargo_planilla_id" ASC, "version" ASC);

-- CreateIndex
CREATE INDEX "snapshots_recargos_planillas_tipo_snapshot" ON "snapshots_recargos_planillas"("tipo_snapshot" ASC);

-- CreateIndex
CREATE INDEX "idx_subsystems_active" ON "subsystems"("is_active" ASC);

-- CreateIndex
CREATE INDEX "idx_subsystems_name" ON "subsystems"("name" ASC);

-- CreateIndex
CREATE INDEX "idx_subsystems_order" ON "subsystems"("order_index" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "subsystems_name_key" ON "subsystems"("name" ASC);

-- CreateIndex
CREATE INDEX "tarifas_servicios_activo_idx" ON "tarifas_servicios"("activo" ASC);

-- CreateIndex
CREATE INDEX "tarifas_servicios_anio_idx" ON "tarifas_servicios"("anio" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tarifas_servicios_cliente_id_anio_key" ON "tarifas_servicios"("cliente_id" ASC, "anio" ASC);

-- CreateIndex
CREATE INDEX "tarifas_servicios_operadora_idx" ON "tarifas_servicios"("operadora" ASC);

-- CreateIndex
CREATE INDEX "idx_tercero_token_expires" ON "tercero_token"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "idx_tercero_token_tercero" ON "tercero_token"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "idx_tercero_token_token" ON "tercero_token"("token" ASC);

-- CreateIndex
CREATE INDEX "tercero_token_expires_at_idx" ON "tercero_token"("expires_at" ASC);

-- CreateIndex
CREATE INDEX "tercero_token_tercero_id_idx" ON "tercero_token"("tercero_id" ASC);

-- CreateIndex
CREATE INDEX "tercero_token_token_idx" ON "tercero_token"("token" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tercero_token_token_key" ON "tercero_token"("token" ASC);

-- CreateIndex
CREATE INDEX "terceros_activo_idx" ON "terceros"("activo" ASC);

-- CreateIndex
CREATE INDEX "terceros_deleted_at_idx" ON "terceros"("deleted_at" ASC);

-- CreateIndex
CREATE INDEX "terceros_identificacion_idx" ON "terceros"("identificacion" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "terceros_identificacion_key" ON "terceros"("identificacion" ASC);

-- CreateIndex
CREATE INDEX "terceros_nombre_completo_idx" ON "terceros"("nombre_completo" ASC);

-- CreateIndex
CREATE INDEX "terceros_tipo_persona_idx" ON "terceros"("tipo_persona" ASC);

-- CreateIndex
CREATE INDEX "tipo_certificado_activo_idx" ON "tipo_certificado"("activo" ASC);

-- CreateIndex
CREATE INDEX "tipo_certificado_codigo_idx" ON "tipo_certificado"("codigo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "tipo_certificado_codigo_key" ON "tipo_certificado"("codigo" ASC);

-- CreateIndex
CREATE INDEX "idx_tipo_recargo_adicional" ON "tipos_recargos"("adicional" ASC);

-- CreateIndex
CREATE INDEX "idx_tipo_recargo_categoria" ON "tipos_recargos"("categoria" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "idx_tipo_recargo_orden" ON "tipos_recargos"("orden_calculo" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "idx_tipos_recargos_codigo_activo" ON "tipos_recargos"("codigo" ASC, "activo" ASC);

-- CreateIndex
CREATE INDEX "idx_tipos_recargos_codigo_vigencia" ON "tipos_recargos"("codigo" ASC, "activo" ASC, "vigencia_desde" ASC, "vigencia_hasta" ASC);

-- CreateIndex
CREATE INDEX "idx_users_invitado_por" ON "users"("invitado_por_id" ASC);

-- CreateIndex
CREATE INDEX "users_correo" ON "users"("correo" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "users_correo_key" ON "users"("correo" ASC);

-- CreateIndex
CREATE INDEX "users_role" ON "users"("role" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "vehiculos_placa_key" ON "vehiculos"("placa" ASC);

-- AddForeignKey
ALTER TABLE "Opcion" ADD CONSTRAINT "Opcion_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Pregunta" ADD CONSTRAINT "Pregunta_evaluacionId_fkey" FOREIGN KEY ("evaluacionId") REFERENCES "Evaluacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respuesta" ADD CONSTRAINT "Respuesta_preguntaId_fkey" FOREIGN KEY ("preguntaId") REFERENCES "Pregunta"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Respuesta" ADD CONSTRAINT "Respuesta_resultadoId_fkey" FOREIGN KEY ("resultadoId") REFERENCES "Resultado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resultado" ADD CONSTRAINT "Resultado_evaluacionId_fkey" FOREIGN KEY ("evaluacionId") REFERENCES "Evaluacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_mensual_origen_cierres" ADD CONSTRAINT "_mensual_origen_cierres_A_fkey" FOREIGN KEY ("A") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_mensual_origen_cierres" ADD CONSTRAINT "_mensual_origen_cierres_B_fkey" FOREIGN KEY ("B") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_correctivas_preventivas" ADD CONSTRAINT "acciones_correctivas_preventivas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_correctivas_preventivas" ADD CONSTRAINT "acciones_correctivas_preventivas_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_responsable_ejecucion_id_fkey" FOREIGN KEY ("responsable_ejecucion_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "anticipos" ADD CONSTRAINT "anticipos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_accion_id_fkey" FOREIGN KEY ("accion_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_aprobador_id_fkey" FOREIGN KEY ("aprobador_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bonificaciones" ADD CONSTRAINT "bonificaciones_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "fk_bcv_config_liq" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "fk_bcv_creado_por" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_actualizado_por_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_creado_por_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "causas_accion_correctiva" ADD CONSTRAINT "causas_accion_correctiva_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tipo_certificado_id_fkey" FOREIGN KEY ("tipo_certificado_id") REFERENCES "tipo_certificado"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "ciclos_seguimiento_eficacia" ADD CONSTRAINT "ciclos_seguimiento_eficacia_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "conductor_token" ADD CONSTRAINT "conductor_token_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conductores" ADD CONSTRAINT "conductores_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_liquidador" ADD CONSTRAINT "configuracion_liquidador_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuracion_liquidador" ADD CONSTRAINT "configuracion_liquidador_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "configuraciones_salarios" ADD CONSTRAINT "configuraciones_salarios_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "configuraciones_salarios" ADD CONSTRAINT "configuraciones_salarios_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "detalles_recargos_dias_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "detalles_recargos_dias_configuracion_salario_id_fkey" FOREIGN KEY ("configuracion_salario_id") REFERENCES "configuraciones_salarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "detalles_recargos_dias_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "detalles_recargos_dias_dia_laboral_id_fkey" FOREIGN KEY ("dia_laboral_id") REFERENCES "dias_laborales_planillas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "detalles_recargos_dias_tipo_recargo_id_fkey" FOREIGN KEY ("tipo_recargo_id") REFERENCES "tipos_recargos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "detalles_recargos_dias" ADD CONSTRAINT "fk_detalle_recargo_config_salario" FOREIGN KEY ("configuracion_salario_id") REFERENCES "configuraciones_salarios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dias_laborales_planillas" ADD CONSTRAINT "dias_laborales_planillas_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dias_laborales_planillas" ADD CONSTRAINT "dias_laborales_planillas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "dias_laborales_planillas" ADD CONSTRAINT "dias_laborales_planillas_recargo_planilla_id_fkey" FOREIGN KEY ("recargo_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documento" ADD CONSTRAINT "documento_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documentos_compartidos" ADD CONSTRAINT "documentos_compartidos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_eficacia_cierre" ADD CONSTRAINT "evidencias_eficacia_cierre_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "factura_liquidacion_item" ADD CONSTRAINT "factura_liquidacion_item_factura_id_fkey" FOREIGN KEY ("factura_id") REFERENCES "factura_liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_liquidacion_item" ADD CONSTRAINT "factura_liquidacion_item_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidacion_servicio"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_liquidacion_servicio" ADD CONSTRAINT "factura_liquidacion_servicio_anulado_por_id_fkey" FOREIGN KEY ("anulado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "factura_liquidacion_servicio" ADD CONSTRAINT "factura_liquidacion_servicio_facturado_por_id_fkey" FOREIGN KEY ("facturado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_desprendibles" ADD CONSTRAINT "firmas_desprendibles_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_desprendibles" ADD CONSTRAINT "firmas_desprendibles_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_desprendibles" ADD CONSTRAINT "firmas_desprendibles_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_desprendibles" ADD CONSTRAINT "firmas_desprendibles_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_primas" ADD CONSTRAINT "firmas_primas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "firmas_primas" ADD CONSTRAINT "firmas_primas_prima_id_fkey" FOREIGN KEY ("prima_id") REFERENCES "primas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_answer_options" ADD CONSTRAINT "form_answer_options_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "form_answers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_answer_options" ADD CONSTRAINT "form_answer_options_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "form_field_options"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "form_fields"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_assignment_targets" ADD CONSTRAINT "form_assignment_targets_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "form_assignments"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_assignment_targets" ADD CONSTRAINT "form_assignment_targets_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_assignment_targets" ADD CONSTRAINT "form_assignment_targets_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_assignments" ADD CONSTRAINT "form_assignments_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "form_answers"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_definitions" ADD CONSTRAINT "form_definitions_updated_by_id_fkey" FOREIGN KEY ("updated_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_field_options" ADD CONSTRAINT "form_field_options_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "form_fields"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_field_templates" ADD CONSTRAINT "form_field_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_parent_field_id_fkey" FOREIGN KEY ("parent_field_id") REFERENCES "form_fields"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "form_sections"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "form_assignments"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "servicios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_supersedes_submission_id_fkey" FOREIGN KEY ("supersedes_submission_id") REFERENCES "form_submissions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_submissions" ADD CONSTRAINT "form_submissions_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "form_definitions"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee" ADD CONSTRAINT "fk_sarlaft_evaluador" FOREIGN KEY ("evaluado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee" ADD CONSTRAINT "formulario_sarlaft_ptee_evaluado_por_id_fkey" FOREIGN KEY ("evaluado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento" ADD CONSTRAINT "fk_sarlaft_doc_form" FOREIGN KEY ("formulario_id") REFERENCES "formulario_sarlaft_ptee"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento" ADD CONSTRAINT "formulario_sarlaft_ptee_documento_formulario_id_fkey" FOREIGN KEY ("formulario_id") REFERENCES "formulario_sarlaft_ptee"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_entrega" ADD CONSTRAINT "fspd_entrega_documento_fkey" FOREIGN KEY ("documento_generado_id") REFERENCES "formulario_sarlaft_ptee_documento_generado"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_generado" ADD CONSTRAINT "fspd_generado_formulario_fkey" FOREIGN KEY ("formulario_id") REFERENCES "formulario_sarlaft_ptee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_generado" ADD CONSTRAINT "fspd_generado_usuario_fkey" FOREIGN KEY ("generado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formularios_asistencia" ADD CONSTRAINT "formularios_asistencia_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_liquidacion" ADD CONSTRAINT "historial_estado_liquidacion_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_liquidacion" ADD CONSTRAINT "historial_estado_liquidacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_liquidacion_tercero_final" ADD CONSTRAINT "fk_hist_estado_lt_final_cierre" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_estado_liquidacion_tercero_final" ADD CONSTRAINT "fk_hist_estado_lt_final_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "historial_recargos_planillas" ADD CONSTRAINT "historial_recargos_planillas_realizado_por_id_fkey" FOREIGN KEY ("realizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inducciones_visitantes" ADD CONSTRAINT "inducciones_visitantes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "invitaciones_usuario" ADD CONSTRAINT "invitaciones_usuario_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "fk_lcm_tercero" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "fk_lcm_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "liquidacion_chat_mensaje_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "liquidacion_chat_mensaje_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda_concepto" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_concepto_actualizado_por__fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda_concepto" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_concepto_liquidacion_ingr_fkey" FOREIGN KEY ("liquidacion_ingreso_id") REFERENCES "liquidacion_ingreso_transmeralda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_liquidacion_ingreso__fkey" FOREIGN KEY ("liquidacion_ingreso_id") REFERENCES "liquidacion_ingreso_transmeralda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_ingreso_transmeralda_fila" ADD CONSTRAINT "liquidacion_ingreso_transmeralda_fila_liquidacion_tercero__fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_aplicado_en_liquidacion_id_fkey" FOREIGN KEY ("aplicado_en_liquidacion_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_creado_por_usuario_id_fkey" FOREIGN KEY ("creado_por_usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_liquidacion_origen_id_fkey" FOREIGN KEY ("liquidacion_origen_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio" ADD CONSTRAINT "liquidacion_servicio_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio" ADD CONSTRAINT "liquidacion_servicio_aprobado_por_id_fkey" FOREIGN KEY ("aprobado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio" ADD CONSTRAINT "liquidacion_servicio_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio" ADD CONSTRAINT "liquidacion_servicio_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio" ADD CONSTRAINT "liquidacion_servicio_liquidado_por_id_fkey" FOREIGN KEY ("liquidado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio_item" ADD CONSTRAINT "liquidacion_servicio_item_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_servicio_item" ADD CONSTRAINT "liquidacion_servicio_item_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero" ADD CONSTRAINT "liquidacion_tercero_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "liquidacion_servicio_item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero" ADD CONSTRAINT "liquidacion_tercero_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero" ADD CONSTRAINT "liquidacion_tercero_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" ADD CONSTRAINT "fk_lt_adic_periodo_snapshot_revertido_de" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_adicional_periodo_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" ADD CONSTRAINT "fk_lt_adic_periodo_snapshot_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "fk_ltc_conductor" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "fk_ltc_tercero" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "fk_ltf_actualizado_por" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "fk_ltf_creado_por" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "fk_ltf_servicio" FOREIGN KEY ("liquidacion_servicio_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "fk_ltf_tercero" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "fk_ltf_vehiculo" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_liquidacion_servicio_id_fkey" FOREIGN KEY ("liquidacion_servicio_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "fk_lt_final_adicional_actualizado_por" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "fk_lt_final_adicional_cierre" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" ADD CONSTRAINT "fk_lt_final_adicional_creado_por" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "fk_concepto_propietario" FOREIGN KEY ("propietario_id") REFERENCES "liquidacion_tercero_final_propietario"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "fk_ltfc_conductor" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "fk_ltfc_final" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liq_tercero_final_concepto_ltf_fk" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "fk_ltfi_final" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "fk_ltfi_tercero" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liq_tercero_final_item_ltf_fk" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liq_tercero_final_item_lti_fk" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_pro_liquidacion_tercero_final_id_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_propietario_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "fk_ltfs_final" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "fk_ltfs_revertido_de" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_final_snapshot"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "fk_ltfs_usuario" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liq_tercero_final_snap_ltf_fk" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liq_tercero_final_snap_revertido_fk" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_final_snapshot"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liq_tercero_final_snap_usuario_fk" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional" ADD CONSTRAINT "liquidacion_tercero_ocasional_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional" ADD CONSTRAINT "liquidacion_tercero_ocasional_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_liquidacion_ocasional_i" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_liquidacion_ocasional_id" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_id_fk" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_ocasional_id_fke" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasional_id" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_ocasional_snapshot"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "liquidacion_vehiculo" ADD CONSTRAINT "liquidacion_vehiculo_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_vehiculo" ADD CONSTRAINT "liquidacion_vehiculo_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones" ADD CONSTRAINT "liquidaciones_liquidado_por_id_fkey" FOREIGN KEY ("liquidado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidaciones_servicios" ADD CONSTRAINT "liquidaciones_servicios_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mantenimientos" ADD CONSTRAINT "mantenimientos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pernotes" ADD CONSTRAINT "pernotes_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "primas" ADD CONSTRAINT "primas_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "primas" ADD CONSTRAINT "primas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "primas" ADD CONSTRAINT "primas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "fk_recargos_origen_planilla" FOREIGN KEY ("origen_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_origen_planilla_id_fkey" FOREIGN KEY ("origen_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_empresa_id_fkey" FOREIGN KEY ("empresa_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral" ADD CONSTRAINT "registro_dia_laboral_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral" ADD CONSTRAINT "registro_dia_laboral_mantenimiento_vehiculo_id_fkey" FOREIGN KEY ("mantenimiento_vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "fk_rdlb_config_liq" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "fk_rdlb_creado_por" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "fk_rdlb_registro" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "fk_rdlb_segmento" FOREIGN KEY ("segmento_id") REFERENCES "registro_dia_laboral_segmento"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE RESTRICT ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_registro_dia_id_fkey" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_segmento_id_fkey" FOREIGN KEY ("segmento_id") REFERENCES "registro_dia_laboral_segmento"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_registro_dia_id_fkey" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "respuestas_asistencia" ADD CONSTRAINT "respuestas_asistencia_formulario_id_fkey" FOREIGN KEY ("formulario_id") REFERENCES "formularios_asistencia"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "seguimientos_causa" ADD CONSTRAINT "seguimientos_causa_causa_fkey" FOREIGN KEY ("causa_id") REFERENCES "causas_accion_correctiva"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "seguimientos_causa" ADD CONSTRAINT "seguimientos_causa_usuario_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "seguimientos_correccion_inmediata" ADD CONSTRAINT "seguimientos_correccion_inmediata_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "servicio_historicos" ADD CONSTRAINT "servicio_historicos_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "servicio_liquidaciones" ADD CONSTRAINT "servicio_liquidaciones_liquidacion_id_fkey" FOREIGN KEY ("liquidacion_id") REFERENCES "liquidaciones_servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicio_liquidaciones" ADD CONSTRAINT "servicio_liquidaciones_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_destino_id_fkey" FOREIGN KEY ("destino_id") REFERENCES "municipios"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_origen_id_fkey" FOREIGN KEY ("origen_id") REFERENCES "municipios"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios" ADD CONSTRAINT "servicios_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_cancelados" ADD CONSTRAINT "servicios_cancelados_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_cancelados" ADD CONSTRAINT "servicios_cancelados_user_cancelacion_id_fkey" FOREIGN KEY ("user_cancelacion_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "servicios_cancelados" ADD CONSTRAINT "servicios_cancelados_usuario_cancelacion_id_fkey" FOREIGN KEY ("usuario_cancelacion_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots_recargos_planillas" ADD CONSTRAINT "snapshots_recargos_planillas_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "snapshots_recargos_planillas" ADD CONSTRAINT "snapshots_recargos_planillas_recargo_planilla_id_fkey" FOREIGN KEY ("recargo_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tarifas_servicios" ADD CONSTRAINT "tarifas_servicios_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tercero_token" ADD CONSTRAINT "tercero_token_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "tipos_recargos" ADD CONSTRAINT "tipos_recargos_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "fk_users_invitado_por" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehiculos" ADD CONSTRAINT "vehiculos_propietario_id_fkey" FOREIGN KEY ("propietario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

