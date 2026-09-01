-- Pone la base al día con prisma/schema.prisma tras el baseline.
--
-- El schema.prisma de este repo llevaba tiempo por detrás de su propia base:
-- le faltaban 15 modelos que las tablas SÍ tenían (preoperacionales,
-- salidas_no_conformes, PESV, seguimientos de acciones correctivas…), porque
-- ese SQL se aplicó a mano y el esquema nunca se actualizó. Se puso al día
-- copiando el del gemelo, con tres ajustes deliberados:
--
--   · Fuera `bonificaciones_backup`: tabla residual de una migración de datos
--     de Transmeralda, sin código que la use y que aquí no existe.
--   · Se conservan `recargos_planillas.imported_from_transmeralda_{id,at}`:
--     45 filas con valor. Es la única divergencia real de datos frente al gemelo.
--   · El enum `tipo_servicio_tarifa_enum` va SIN `@map`: aquí las etiquetas
--     están escritas con guiones bajos y allí con espacios. Aplicar los `@map`
--     habría hecho fallar el cast de las 66 filas existentes.
--
-- Las sentencias destructivas se verificaron una a una contra los datos:
--
--   DROP TABLE "_mensual_origen_cierres"                   -> 0 filas
--   liquidaciones.share_token{,_expires_at}                -> 0 de 80 con valor
--   registro_dia_laboral (6 columnas)                      -> 16 filas, todas NULL
--   inducciones_visitantes -> TIMESTAMP(3)                 -> 0 filas
--   invitaciones_usuario.area -> TEXT[]                    -> 0 filas
--   conductores.nomina SET NOT NULL                        -> 0 nulos de 168
--   configuraciones_salarios jornada_* SET NOT NULL        -> 0 nulos de 7
--   registro_dia_laboral_segmento *_dia_siguiente NOT NULL -> 0 nulos de 6

-- DropForeignKey
ALTER TABLE "_mensual_origen_cierres" DROP CONSTRAINT "_mensual_origen_cierres_A_fkey";

-- DropForeignKey
ALTER TABLE "_mensual_origen_cierres" DROP CONSTRAINT "_mensual_origen_cierres_B_fkey";

-- DropForeignKey
ALTER TABLE "acciones_correctivas_preventivas" DROP CONSTRAINT "acciones_correctivas_preventivas_registrado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "actividades_pesv" DROP CONSTRAINT "actividades_pesv_actualizado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "actividades_pesv" DROP CONSTRAINT "actividades_pesv_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "actividades_pesv" DROP CONSTRAINT "actividades_pesv_responsable_ejecucion_id_fkey";

-- DropForeignKey
ALTER TABLE "aprobaciones_accion" DROP CONSTRAINT "aprobaciones_accion_accion_id_fkey";

-- DropForeignKey
ALTER TABLE "aprobaciones_accion" DROP CONSTRAINT "aprobaciones_accion_aprobador_id_fkey";

-- DropForeignKey
ALTER TABLE "bono_config_visual" DROP CONSTRAINT "bono_config_visual_config_liquidacion_id_fkey";

-- DropForeignKey
ALTER TABLE "bono_config_visual" DROP CONSTRAINT "bono_config_visual_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "canvas_anotacion" DROP CONSTRAINT "canvas_anotacion_actualizado_por_fkey";

-- DropForeignKey
ALTER TABLE "canvas_anotacion" DROP CONSTRAINT "canvas_anotacion_creado_por_fkey";

-- DropForeignKey
ALTER TABLE "certificacion_envio" DROP CONSTRAINT "certificacion_envio_certificado_id_fkey";

-- DropForeignKey
ALTER TABLE "certificacion_envio" DROP CONSTRAINT "certificacion_envio_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "certificado_archivo" DROP CONSTRAINT "certificado_archivo_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "certificado_archivo" DROP CONSTRAINT "certificado_archivo_tipo_certificado_id_fkey";

-- DropForeignKey
ALTER TABLE "certificado_tercero" DROP CONSTRAINT "certificado_tercero_certificado_id_fkey";

-- DropForeignKey
ALTER TABLE "certificado_tercero" DROP CONSTRAINT "certificado_tercero_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "ciclos_seguimiento_eficacia" DROP CONSTRAINT "ciclos_seguimiento_eficacia_accion_correctiva_id_fkey";

-- DropForeignKey
ALTER TABLE "evidencias_eficacia_cierre" DROP CONSTRAINT "evidencias_eficacia_cierre_accion_correctiva_id_fkey";

-- DropForeignKey
ALTER TABLE "excesos_velocidad" DROP CONSTRAINT "excesos_velocidad_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "excesos_velocidad" DROP CONSTRAINT "excesos_velocidad_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "firmas_primas" DROP CONSTRAINT "firmas_primas_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "firmas_primas" DROP CONSTRAINT "firmas_primas_prima_id_fkey";

-- DropForeignKey
ALTER TABLE "form_answer_options" DROP CONSTRAINT "form_answer_options_answer_id_fkey";

-- DropForeignKey
ALTER TABLE "form_answers" DROP CONSTRAINT "form_answers_submission_id_fkey";

-- DropForeignKey
ALTER TABLE "form_assignment_targets" DROP CONSTRAINT "form_assignment_targets_assignment_id_fkey";

-- DropForeignKey
ALTER TABLE "form_attachments" DROP CONSTRAINT "form_attachments_answer_id_fkey";

-- DropForeignKey
ALTER TABLE "form_attachments" DROP CONSTRAINT "form_attachments_submission_id_fkey";

-- DropForeignKey
ALTER TABLE "form_field_options" DROP CONSTRAINT "form_field_options_field_id_fkey";

-- DropForeignKey
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_parent_field_id_fkey";

-- DropForeignKey
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_section_id_fkey";

-- DropForeignKey
ALTER TABLE "form_fields" DROP CONSTRAINT "form_fields_version_id_fkey";

-- DropForeignKey
ALTER TABLE "form_sections" DROP CONSTRAINT "form_sections_version_id_fkey";

-- DropForeignKey
ALTER TABLE "form_submission_events" DROP CONSTRAINT "form_submission_events_submission_id_fkey";

-- DropForeignKey
ALTER TABLE "form_versions" DROP CONSTRAINT "form_versions_form_id_fkey";

-- DropForeignKey
ALTER TABLE "formulario_sarlaft_ptee" DROP CONSTRAINT "formulario_sarlaft_ptee_evaluado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento" DROP CONSTRAINT "formulario_sarlaft_ptee_documento_formulario_id_fkey";

-- DropForeignKey
ALTER TABLE "inducciones_visitantes" DROP CONSTRAINT "inducciones_visitantes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "invitaciones_usuario" DROP CONSTRAINT "invitaciones_usuario_invitado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_chat_mensaje" DROP CONSTRAINT "liquidacion_chat_mensaje_liquidacion_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_recordatorio" DROP CONSTRAINT "liquidacion_recordatorio_liquidacion_origen_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_concepto" DROP CONSTRAINT "liquidacion_tercero_concepto_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_concepto" DROP CONSTRAINT "liquidacion_tercero_concepto_liquidacion_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "liquidacion_tercero_final_liquidacion_servicio_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "liquidacion_tercero_final_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "liquidacion_tercero_final_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" DROP CONSTRAINT "fk_concepto_propietario";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" DROP CONSTRAINT "liq_tercero_final_concepto_ltf_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" DROP CONSTRAINT "liquidacion_tercero_final_concepto_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_item" DROP CONSTRAINT "liq_tercero_final_item_ltf_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_item" DROP CONSTRAINT "liq_tercero_final_item_lti_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" DROP CONSTRAINT "liquidacion_tercero_final_pro_liquidacion_tercero_final_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" DROP CONSTRAINT "liquidacion_tercero_final_propietario_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "liq_tercero_final_snap_ltf_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "liq_tercero_final_snap_revertido_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "liq_tercero_final_snap_usuario_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" DROP CONSTRAINT "liquidacion_tercero_ocasional_adicional_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" DROP CONSTRAINT "liquidacion_tercero_ocasional_adicional_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" DROP CONSTRAINT "liquidacion_tercero_ocasional_concepto_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" DROP CONSTRAINT "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_id_fk";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" DROP CONSTRAINT "liquidacion_tercero_ocasional_draft_usuario_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" DROP CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_ocasional_id_fke";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" DROP CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" DROP CONSTRAINT "liquidacion_tercero_ocasional_item_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" DROP CONSTRAINT "liquidacion_tercero_ocasional_snapshot_revertido_de_id_fkey";

-- DropForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" DROP CONSTRAINT "liquidacion_tercero_ocasional_snapshot_usuario_id_fkey";

-- DropForeignKey
ALTER TABLE "notificacion" DROP CONSTRAINT "notificacion_usuario_id_fkey";

-- DropForeignKey
ALTER TABLE "preoperacionales" DROP CONSTRAINT "preoperacionales_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "preoperacionales" DROP CONSTRAINT "preoperacionales_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "recargos" DROP CONSTRAINT "recargos_origen_planilla_id_fkey";

-- DropForeignKey
ALTER TABLE "recargos_planillas" DROP CONSTRAINT "recargos_planillas_servicio_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "registro_dia_laboral_bono_config_liquidacion_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "registro_dia_laboral_bono_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "registro_dia_laboral_bono_registro_dia_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "registro_dia_laboral_bono_segmento_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_segmento" DROP CONSTRAINT "registro_dia_laboral_segmento_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_segmento" DROP CONSTRAINT "registro_dia_laboral_segmento_registro_dia_id_fkey";

-- DropForeignKey
ALTER TABLE "registro_dia_laboral_segmento" DROP CONSTRAINT "registro_dia_laboral_segmento_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "salidas_no_conformes" DROP CONSTRAINT "salidas_no_conformes_cliente_id_fkey";

-- DropForeignKey
ALTER TABLE "salidas_no_conformes" DROP CONSTRAINT "salidas_no_conformes_conductor_id_fkey";

-- DropForeignKey
ALTER TABLE "salidas_no_conformes" DROP CONSTRAINT "salidas_no_conformes_creado_por_id_fkey";

-- DropForeignKey
ALTER TABLE "salidas_no_conformes" DROP CONSTRAINT "salidas_no_conformes_vehiculo_id_fkey";

-- DropForeignKey
ALTER TABLE "seguimientos_causa" DROP CONSTRAINT "seguimientos_causa_usuario_fk";

-- DropForeignKey
ALTER TABLE "seguimientos_correccion_inmediata" DROP CONSTRAINT "seguimientos_correccion_inmediata_accion_correctiva_id_fkey";

-- DropForeignKey
ALTER TABLE "tercero_token" DROP CONSTRAINT "tercero_token_tercero_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_invitado_por_id_fkey";

-- DropIndex
DROP INDEX "idx_canvas_anotacion_ancla";

-- DropIndex
DROP INDEX "idx_mensual_item_tercero_documento";

-- DropIndex
-- Prisma lo genera como DROP INDEX, pero en la base real ese índice respalda
-- una UNIQUE y Postgres exige soltar la constraint. En la shadow database, en
-- cambio, el baseline lo crea como índice suelto — así que hay que cubrir las
-- dos formas o el replay de la shadow falla y `migrate dev` vuelve a atascarse.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'liquidaciones_share_token_key') THEN
    ALTER TABLE "liquidaciones" DROP CONSTRAINT "liquidaciones_share_token_key";
  ELSE
    DROP INDEX IF EXISTS "liquidaciones_share_token_key";
  END IF;
END $$;

-- DropIndex
DROP INDEX "respuestas_asistencia_pertenece_comite_idx";

-- DropIndex
DROP INDEX "idx_users_invitado_por";

-- AlterTable
ALTER TABLE "actividades_pesv" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "aprobaciones_accion" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bono_config_visual" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "canvas_anotacion" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "certificacion_envio" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "certificado_archivo" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "certificado_tercero" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "ciclos_seguimiento_eficacia" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "conductores" ALTER COLUMN "nomina" SET NOT NULL;

-- AlterTable
ALTER TABLE "configuracion_descuento_tercero" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "configuraciones_salarios" ALTER COLUMN "jornada_normal_horas" SET NOT NULL,
ALTER COLUMN "jornada_festiva_horas" SET NOT NULL;

-- AlterTable
ALTER TABLE "evidencias_eficacia_cierre" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "excesos_velocidad" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "formulario_sarlaft_ptee" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "formulario_sarlaft_ptee_documento" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "formulario_sarlaft_ptee_documento_entrega" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "formulario_sarlaft_ptee_documento_generado" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "historial_estado_liquidacion_tercero_final" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inducciones_visitantes" ALTER COLUMN "fecha" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "updated_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "invitaciones_usuario" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "area" SET DATA TYPE TEXT[];

-- AlterTable
ALTER TABLE "liquidacion_chat_mensaje" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_recordatorio" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_concepto" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final_adicional" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final_concepto" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final_item" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final_propietario" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_final_snapshot" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional" RENAME CONSTRAINT "liquidacion_tercero_mensual_pkey" TO "liquidacion_tercero_ocasional_pkey";

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional_adicional" RENAME CONSTRAINT "liquidacion_tercero_mensual_adicional_pkey" TO "liquidacion_tercero_ocasional_adicional_pkey";

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional_concepto" RENAME CONSTRAINT "liquidacion_tercero_mensual_concepto_pkey" TO "liquidacion_tercero_ocasional_concepto_pkey";

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional_draft" RENAME CONSTRAINT "liquidacion_tercero_mensual_draft_pkey" TO "liquidacion_tercero_ocasional_draft_pkey";
ALTER TABLE "liquidacion_tercero_ocasional_draft"
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional_item" RENAME CONSTRAINT "liquidacion_tercero_mensual_item_pkey" TO "liquidacion_tercero_ocasional_item_pkey";
ALTER TABLE "liquidacion_tercero_ocasional_item"
ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" RENAME CONSTRAINT "liquidacion_tercero_mensual_snapshot_pkey" TO "liquidacion_tercero_ocasional_snapshot_pkey";

-- AlterTable
ALTER TABLE "liquidaciones" DROP COLUMN "share_token",
DROP COLUMN "share_token_expires_at";

-- AlterTable
ALTER TABLE "notificacion" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "preoperacionales" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "registro_dia_laboral" DROP COLUMN "cliente_id",
DROP COLUMN "cliente_nombre",
DROP COLUMN "hora_fin",
DROP COLUMN "hora_inicio",
DROP COLUMN "horas_conducidas",
DROP COLUMN "vehiculo_placa";

-- AlterTable
ALTER TABLE "registro_dia_laboral_bono" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "registro_dia_laboral_segmento" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "vehiculo_placa" DROP NOT NULL,
ALTER COLUMN "hora_inicio" DROP NOT NULL,
ALTER COLUMN "hora_fin" DROP NOT NULL,
ALTER COLUMN "updated_at" DROP DEFAULT,
ALTER COLUMN "inicio_dia_siguiente" SET NOT NULL,
ALTER COLUMN "fin_dia_siguiente" SET NOT NULL;

-- AlterTable
ALTER TABLE "salidas_no_conformes" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "seguimientos_correccion_inmediata" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tercero_token" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tipo_certificado" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "updated_at" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tipos_recargos" ALTER COLUMN "created_at" SET DEFAULT CURRENT_TIMESTAMP;

-- DropTable
DROP TABLE "_mensual_origen_cierres";

-- CreateTable
CREATE TABLE "custom_places" (
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

-- CreateIndex
CREATE INDEX "idx_custom_places_nombre" ON "custom_places"("nombre");

-- CreateIndex
CREATE INDEX "idx_custom_places_categoria" ON "custom_places"("categoria");

-- CreateIndex
CREATE INDEX "idx_custom_places_activo" ON "custom_places"("activo", "deleted_at");

-- CreateIndex
CREATE INDEX "idx_custom_places_creado_por" ON "custom_places"("creado_por_id");

-- CreateIndex
CREATE INDEX "idx_lt_final_periodo_placa" ON "liquidacion_tercero_final"("anio", "mes", "placa");

-- CreateIndex
CREATE INDEX "liquidacion_tercero_final_concepto_propietario_id_idx" ON "liquidacion_tercero_final_concepto"("propietario_id");

-- RenameForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_entrega" RENAME CONSTRAINT "fspd_entrega_documento_fkey" TO "formulario_sarlaft_ptee_documento_entrega_documento_genera_fkey";

-- RenameForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_generado" RENAME CONSTRAINT "fspd_generado_formulario_fkey" TO "formulario_sarlaft_ptee_documento_generado_formulario_id_fkey";

-- RenameForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento_generado" RENAME CONSTRAINT "fspd_generado_usuario_fkey" TO "formulario_sarlaft_ptee_documento_generado_generado_por_id_fkey";

-- RenameForeignKey
ALTER TABLE "historial_estado_liquidacion_tercero_final" RENAME CONSTRAINT "fk_hist_estado_lt_final_cierre" TO "historial_estado_liquidacion_tercero_final_liquidacion_ter_fkey";

-- RenameForeignKey
ALTER TABLE "historial_estado_liquidacion_tercero_final" RENAME CONSTRAINT "fk_hist_estado_lt_final_usuario" TO "historial_estado_liquidacion_tercero_final_usuario_id_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" RENAME CONSTRAINT "fk_lt_adic_periodo_snapshot_revertido_de" TO "liquidacion_tercero_adicional_periodo_snapshot_revertido_d_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_adicional_periodo_snapshot" RENAME CONSTRAINT "fk_lt_adic_periodo_snapshot_usuario" TO "liquidacion_tercero_adicional_periodo_snapshot_usuario_id_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" RENAME CONSTRAINT "fk_lt_final_adicional_actualizado_por" TO "liquidacion_tercero_final_adicional_actualizado_por_id_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" RENAME CONSTRAINT "fk_lt_final_adicional_cierre" TO "liquidacion_tercero_final_adicional_liquidacion_tercero_fi_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_final_adicional" RENAME CONSTRAINT "fk_lt_final_adicional_creado_por" TO "liquidacion_tercero_final_adicional_creado_por_id_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" RENAME CONSTRAINT "liquidacion_tercero_ocasional_adicional_liquidacion_ocasional_i" TO "liquidacion_tercero_ocasional_adicional_liquidacion_ocasio_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" RENAME CONSTRAINT "liquidacion_tercero_ocasional_concepto_liquidacion_ocasional_id" TO "liquidacion_tercero_ocasional_concepto_liquidacion_ocasion_fkey";

-- RenameForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" RENAME CONSTRAINT "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasional_id" TO "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasion_fkey";

-- RenameForeignKey
ALTER TABLE "seguimientos_causa" RENAME CONSTRAINT "seguimientos_causa_causa_fkey" TO "seguimientos_causa_causa_fk";

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_registro_dia_id_fkey" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_segmento" ADD CONSTRAINT "registro_dia_laboral_segmento_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_registro_dia_id_fkey" FOREIGN KEY ("registro_dia_id") REFERENCES "registro_dia_laboral"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_segmento_id_fkey" FOREIGN KEY ("segmento_id") REFERENCES "registro_dia_laboral_segmento"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "registro_dia_laboral_bono" ADD CONSTRAINT "registro_dia_laboral_bono_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_config_liquidacion_id_fkey" FOREIGN KEY ("config_liquidacion_id") REFERENCES "configuraciones_liquidacion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bono_config_visual" ADD CONSTRAINT "bono_config_visual_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_primas" ADD CONSTRAINT "firmas_primas_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "firmas_primas" ADD CONSTRAINT "firmas_primas_prima_id_fkey" FOREIGN KEY ("prima_id") REFERENCES "primas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos" ADD CONSTRAINT "recargos_origen_planilla_id_fkey" FOREIGN KEY ("origen_planilla_id") REFERENCES "recargos_planillas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recargos_planillas" ADD CONSTRAINT "recargos_planillas_servicio_id_fkey" FOREIGN KEY ("servicio_id") REFERENCES "servicios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitaciones_usuario" ADD CONSTRAINT "invitaciones_usuario_invitado_por_id_fkey" FOREIGN KEY ("invitado_por_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee" ADD CONSTRAINT "formulario_sarlaft_ptee_evaluado_por_id_fkey" FOREIGN KEY ("evaluado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "formulario_sarlaft_ptee_documento" ADD CONSTRAINT "formulario_sarlaft_ptee_documento_formulario_id_fkey" FOREIGN KEY ("formulario_id") REFERENCES "formulario_sarlaft_ptee"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_cliente_id_fkey" FOREIGN KEY ("cliente_id") REFERENCES "empresas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "salidas_no_conformes" ADD CONSTRAINT "salidas_no_conformes_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "acciones_correctivas_preventivas" ADD CONSTRAINT "acciones_correctivas_preventivas_registrado_por_id_fkey" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_accion_id_fkey" FOREIGN KEY ("accion_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "aprobaciones_accion" ADD CONSTRAINT "aprobaciones_accion_aprobador_id_fkey" FOREIGN KEY ("aprobador_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seguimientos_causa" ADD CONSTRAINT "seguimientos_causa_usuario_fk" FOREIGN KEY ("registrado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "seguimientos_correccion_inmediata" ADD CONSTRAINT "seguimientos_correccion_inmediata_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ciclos_seguimiento_eficacia" ADD CONSTRAINT "ciclos_seguimiento_eficacia_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evidencias_eficacia_cierre" ADD CONSTRAINT "evidencias_eficacia_cierre_accion_correctiva_id_fkey" FOREIGN KEY ("accion_correctiva_id") REFERENCES "acciones_correctivas_preventivas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_concepto" ADD CONSTRAINT "liquidacion_tercero_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_liquidacion_servicio_id_fkey" FOREIGN KEY ("liquidacion_servicio_id") REFERENCES "liquidacion_servicio"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final" ADD CONSTRAINT "liquidacion_tercero_final_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liquidacion_tercero_final_item_liquidacion_tercero_final_i_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_item" ADD CONSTRAINT "liquidacion_tercero_final_item_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_liquidacion_tercero_fin_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_concepto" ADD CONSTRAINT "liquidacion_tercero_final_concepto_propietario_id_fkey" FOREIGN KEY ("propietario_id") REFERENCES "liquidacion_tercero_final_propietario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_propietario_liquidacion_tercero__fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_propietario" ADD CONSTRAINT "liquidacion_tercero_final_propietario_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_liquidacion_tercero_fin_fkey" FOREIGN KEY ("liquidacion_tercero_final_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_final_snapshot" ADD CONSTRAINT "liquidacion_tercero_final_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_final_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "excesos_velocidad" ADD CONSTRAINT "excesos_velocidad_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "preoperacionales" ADD CONSTRAINT "preoperacionales_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inducciones_visitantes" ADD CONSTRAINT "inducciones_visitantes_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notificacion" ADD CONSTRAINT "notificacion_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "actividades_pesv" ADD CONSTRAINT "actividades_pesv_responsable_ejecucion_id_fkey" FOREIGN KEY ("responsable_ejecucion_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_archivo" ADD CONSTRAINT "certificado_archivo_tipo_certificado_id_fkey" FOREIGN KEY ("tipo_certificado_id") REFERENCES "tipo_certificado"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificado_tercero" ADD CONSTRAINT "certificado_tercero_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificacion_envio" ADD CONSTRAINT "certificacion_envio_certificado_id_fkey" FOREIGN KEY ("certificado_id") REFERENCES "certificado_archivo"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tercero_token" ADD CONSTRAINT "tercero_token_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_chat_mensaje" ADD CONSTRAINT "liquidacion_chat_mensaje_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_recordatorio" ADD CONSTRAINT "liquidacion_recordatorio_liquidacion_origen_id_fkey" FOREIGN KEY ("liquidacion_origen_id") REFERENCES "liquidacion_tercero_final"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_adicional" ADD CONSTRAINT "liquidacion_tercero_ocasional_adicional_vehiculo_id_fkey" FOREIGN KEY ("vehiculo_id") REFERENCES "vehiculos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_ocasional_i_fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_liquidacion_tercero_id_fkey" FOREIGN KEY ("liquidacion_tercero_id") REFERENCES "liquidacion_tercero"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_item" ADD CONSTRAINT "liquidacion_tercero_ocasional_item_tercero_id_fkey" FOREIGN KEY ("tercero_id") REFERENCES "terceros"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_liquidacion_ocasional__fkey" FOREIGN KEY ("liquidacion_ocasional_id") REFERENCES "liquidacion_tercero_ocasional"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_draft" ADD CONSTRAINT "liquidacion_tercero_ocasional_draft_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_concepto" ADD CONSTRAINT "liquidacion_tercero_ocasional_concepto_conductor_id_fkey" FOREIGN KEY ("conductor_id") REFERENCES "conductores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_usuario_id_fkey" FOREIGN KEY ("usuario_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "liquidacion_tercero_ocasional_snapshot" ADD CONSTRAINT "liquidacion_tercero_ocasional_snapshot_revertido_de_id_fkey" FOREIGN KEY ("revertido_de_id") REFERENCES "liquidacion_tercero_ocasional_snapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_places" ADD CONSTRAINT "custom_places_municipio_id_fkey" FOREIGN KEY ("municipio_id") REFERENCES "municipios"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_places" ADD CONSTRAINT "custom_places_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_creado_por_id_fkey" FOREIGN KEY ("creado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canvas_anotacion" ADD CONSTRAINT "canvas_anotacion_actualizado_por_id_fkey" FOREIGN KEY ("actualizado_por_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_versions" ADD CONSTRAINT "form_versions_form_id_fkey" FOREIGN KEY ("form_id") REFERENCES "form_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_sections" ADD CONSTRAINT "form_sections_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "form_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_section_id_fkey" FOREIGN KEY ("section_id") REFERENCES "form_sections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_fields" ADD CONSTRAINT "form_fields_parent_field_id_fkey" FOREIGN KEY ("parent_field_id") REFERENCES "form_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_field_options" ADD CONSTRAINT "form_field_options_field_id_fkey" FOREIGN KEY ("field_id") REFERENCES "form_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_assignment_targets" ADD CONSTRAINT "form_assignment_targets_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "form_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answers" ADD CONSTRAINT "form_answers_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_answer_options" ADD CONSTRAINT "form_answer_options_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "form_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_attachments" ADD CONSTRAINT "form_attachments_answer_id_fkey" FOREIGN KEY ("answer_id") REFERENCES "form_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "form_submission_events" ADD CONSTRAINT "form_submission_events_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "form_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "idx_canvas_anotacion_hoja" RENAME TO "canvas_anotacion_scope_anio_mes_sheet_key_idx";

-- RenameIndex
ALTER INDEX "idx_canvas_anotacion_periodo" RENAME TO "canvas_anotacion_scope_anio_mes_idx";

-- RenameIndex
ALTER INDEX "uniq_anotacion_celda" RENAME TO "canvas_anotacion_scope_anio_mes_sheet_key_ancla_tipo_ancla__key";

-- RenameIndex
ALTER INDEX "ciclos_seguimiento_eficacia_accion_correctiva_id_numero__key" RENAME TO "ciclos_seguimiento_eficacia_accion_correctiva_id_numero_cic_key";

-- RenameIndex
ALTER INDEX "formulario_sarlaft_ptee_documento_formulario_id_tipo_doc_key" RENAME TO "formulario_sarlaft_ptee_documento_formulario_id_tipo_docume_key";

-- RenameIndex
ALTER INDEX "fspd_entrega_doc_canal_dest_intento_key" RENAME TO "formulario_sarlaft_ptee_documento_entrega_documento_generad_key";

-- RenameIndex
ALTER INDEX "fspd_entrega_documento_idx" RENAME TO "formulario_sarlaft_ptee_documento_entrega_documento_generad_idx";

-- RenameIndex
ALTER INDEX "fspd_entrega_estado_idx" RENAME TO "formulario_sarlaft_ptee_documento_entrega_estado_idx";

-- RenameIndex
ALTER INDEX "fspd_entrega_expires_at_idx" RENAME TO "formulario_sarlaft_ptee_documento_entrega_expires_at_idx";

-- RenameIndex
ALTER INDEX "fspd_entrega_token_hash_key" RENAME TO "formulario_sarlaft_ptee_documento_entrega_token_hash_key";

-- RenameIndex
ALTER INDEX "fspd_generado_created_at_idx" RENAME TO "formulario_sarlaft_ptee_documento_generado_created_at_idx";

-- RenameIndex
ALTER INDEX "fspd_generado_formulario_clase_version_key" RENAME TO "formulario_sarlaft_ptee_documento_generado_formulario_id_cl_key";

-- RenameIndex
ALTER INDEX "fspd_generado_formulario_idx" RENAME TO "formulario_sarlaft_ptee_documento_generado_formulario_id_idx";

-- RenameIndex
ALTER INDEX "fspd_generado_pdf_sha256_idx" RENAME TO "formulario_sarlaft_ptee_documento_generado_pdf_sha256_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_concepto_ltf_idx" RENAME TO "liquidacion_tercero_final_concepto_liquidacion_tercero_fina_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_item_ltf_idx" RENAME TO "liquidacion_tercero_final_item_liquidacion_tercero_final_id_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_item_lti_idx" RENAME TO "liquidacion_tercero_final_item_liquidacion_tercero_id_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_item_unique" RENAME TO "liquidacion_tercero_final_item_liquidacion_tercero_final_id_key";

-- RenameIndex
ALTER INDEX "idx_liq_tercero_final_prop_cierre" RENAME TO "liquidacion_tercero_final_propietario_liquidacion_tercero_f_idx";

-- RenameIndex
ALTER INDEX "idx_liq_tercero_final_prop_deleted_at" RENAME TO "liquidacion_tercero_final_propietario_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_liq_tercero_final_prop_tercero" RENAME TO "liquidacion_tercero_final_propietario_tercero_id_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_snap_created_at_idx" RENAME TO "liquidacion_tercero_final_snapshot_created_at_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_snap_ltf_rama_idx" RENAME TO "liquidacion_tercero_final_snapshot_liquidacion_tercero_fina_idx";

-- RenameIndex
ALTER INDEX "liq_tercero_final_snap_unique" RENAME TO "liquidacion_tercero_final_snapshot_liquidacion_tercero_fina_key";

-- RenameIndex
ALTER INDEX "liq_tercero_final_snap_usuario_idx" RENAME TO "liquidacion_tercero_final_snapshot_usuario_id_idx";

-- RenameIndex
ALTER INDEX "idx_liquidacion_tercero_mensual_actualizado_por_id" RENAME TO "liquidacion_tercero_ocasional_actualizado_por_id_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_consecutivo_key" RENAME TO "liquidacion_tercero_ocasional_consecutivo_key";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_creado_por_id_idx" RENAME TO "liquidacion_tercero_ocasional_creado_por_id_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_deleted_at_idx" RENAME TO "liquidacion_tercero_ocasional_deleted_at_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_estado_idx" RENAME TO "liquidacion_tercero_ocasional_estado_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_mes_anio_idx" RENAME TO "liquidacion_tercero_ocasional_mes_anio_idx";

-- RenameIndex
ALTER INDEX "uniq_ocasional_periodo" RENAME TO "liquidacion_tercero_ocasional_mes_anio_key";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_adicional_deleted_at_idx" RENAME TO "liquidacion_tercero_ocasional_adicional_deleted_at_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_adicional_liquidacion_mensual_id_id" RENAME TO "liquidacion_tercero_ocasional_adicional_liquidacion_ocasion_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_adicional_placa_idx" RENAME TO "liquidacion_tercero_ocasional_adicional_placa_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_adicional_tercero_id_idx" RENAME TO "liquidacion_tercero_ocasional_adicional_tercero_id_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_concepto_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_concepto_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_conductor_id_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_conductor_id_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_deleted_at_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_deleted_at_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_liquidacion_mensual_id_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_liquidacion_ocasiona_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_placa_aplicada_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_placa_aplicada_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_concepto_tipo_idx" RENAME TO "liquidacion_tercero_ocasional_concepto_tipo_idx";

-- RenameIndex
ALTER INDEX "idx_mensual_draft_liquidacion" RENAME TO "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_i_idx";

-- RenameIndex
ALTER INDEX "idx_mensual_draft_updated_at" RENAME TO "liquidacion_tercero_ocasional_draft_updated_at_idx";

-- RenameIndex
ALTER INDEX "uniq_ocasional_draft_user" RENAME TO "liquidacion_tercero_ocasional_draft_liquidacion_ocasional_i_key";

-- RenameIndex
ALTER INDEX "idx_mensual_item_deleted_at" RENAME TO "liquidacion_tercero_ocasional_item_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_mensual_item_liquidacion" RENAME TO "idx_ocasional_item_liquidacion_ocasional";

-- RenameIndex
ALTER INDEX "idx_mensual_item_liquidacion_excluido" RENAME TO "idx_ocasional_item_liquidacion_excluido";

-- RenameIndex
ALTER INDEX "idx_mensual_item_placa" RENAME TO "liquidacion_tercero_ocasional_item_placa_idx";

-- RenameIndex
ALTER INDEX "idx_mensual_item_tercero" RENAME TO "liquidacion_tercero_ocasional_item_tercero_id_idx";

-- RenameIndex
ALTER INDEX "uniq_ocasional_item_pivote" RENAME TO "liquidacion_tercero_ocasional_item_liquidacion_ocasional_id_key";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_snapshot_created_at_idx" RENAME TO "liquidacion_tercero_ocasional_snapshot_created_at_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_snapshot_liquidacion_mensual_id_ram" RENAME TO "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasiona_idx";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_snapshot_liquidacion_mensual_id_ver" RENAME TO "liquidacion_tercero_ocasional_snapshot_liquidacion_ocasiona_key";

-- RenameIndex
ALTER INDEX "liquidacion_tercero_mensual_snapshot_usuario_id_idx" RENAME TO "liquidacion_tercero_ocasional_snapshot_usuario_id_idx";

-- RenameIndex
ALTER INDEX "uniq_recargo_origen_planilla" RENAME TO "recargos_liquidacion_id_origen_planilla_id_key";

-- RenameIndex
ALTER INDEX "idx_registro_dia_laboral_deleted_at" RENAME TO "registro_dia_laboral_deleted_at_idx";

-- RenameIndex
ALTER INDEX "idx_reg_dia_seg_deleted_at" RENAME TO "registro_dia_laboral_segmento_deleted_at_idx";


-- El `SET DATA TYPE TEXT[]` de más arriba se lleva por delante el DEFAULT, y
-- Prisma lo vuelve a poner al reconstruir la shadow database. Sin esto, el
-- replay y la base real difieren en esa sola línea y `migrate dev` lo reporta
-- como drift en cada ejecución. La tabla está vacía, así que no toca datos.
ALTER TABLE "invitaciones_usuario" ALTER COLUMN "area" SET DEFAULT ARRAY[]::TEXT[];
