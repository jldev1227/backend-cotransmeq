-- Depura 27 claves foráneas DUPLICADAS.
--
-- Cada una de estas tablas tenía DOS foreign keys para la misma relación: una
-- con nombre legado (`fk_*`) y otra con el nombre canónico. Vienen de aplicar
-- el mismo SQL dos veces a mano, con nombres distintos. Postgres las admite
-- —son constraints diferentes— pero Prisma solo modela una por relación, así
-- que al reconciliar intentaba renombrar la legada al nombre canónico y
-- chocaba con la que ya lo tenía ("constraint ... already exists").
--
-- Se borra la legada y se conserva la canónica: la integridad referencial no
-- cambia, la sigue garantizando la que queda. El gemelo (Transmeralda) no
-- tiene ninguna duplicada.

ALTER TABLE "bono_config_visual" DROP CONSTRAINT "fk_bcv_config_liq";
ALTER TABLE "bono_config_visual" DROP CONSTRAINT "fk_bcv_creado_por";
ALTER TABLE "detalles_recargos_dias" DROP CONSTRAINT "fk_detalle_recargo_config_salario";
ALTER TABLE "formulario_sarlaft_ptee" DROP CONSTRAINT "fk_sarlaft_evaluador";
ALTER TABLE "formulario_sarlaft_ptee_documento" DROP CONSTRAINT "fk_sarlaft_doc_form";
ALTER TABLE "liquidacion_chat_mensaje" DROP CONSTRAINT "fk_lcm_tercero";
ALTER TABLE "liquidacion_chat_mensaje" DROP CONSTRAINT "fk_lcm_usuario";
ALTER TABLE "liquidacion_tercero_concepto" DROP CONSTRAINT "fk_ltc_conductor";
ALTER TABLE "liquidacion_tercero_concepto" DROP CONSTRAINT "fk_ltc_tercero";
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "fk_ltf_actualizado_por";
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "fk_ltf_creado_por";
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "fk_ltf_servicio";
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "fk_ltf_tercero";
ALTER TABLE "liquidacion_tercero_final" DROP CONSTRAINT "fk_ltf_vehiculo";
ALTER TABLE "liquidacion_tercero_final_concepto" DROP CONSTRAINT "fk_ltfc_conductor";
ALTER TABLE "liquidacion_tercero_final_concepto" DROP CONSTRAINT "fk_ltfc_final";
ALTER TABLE "liquidacion_tercero_final_item" DROP CONSTRAINT "fk_ltfi_final";
ALTER TABLE "liquidacion_tercero_final_item" DROP CONSTRAINT "fk_ltfi_tercero";
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "fk_ltfs_final";
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "fk_ltfs_revertido_de";
ALTER TABLE "liquidacion_tercero_final_snapshot" DROP CONSTRAINT "fk_ltfs_usuario";
ALTER TABLE "recargos" DROP CONSTRAINT "fk_recargos_origen_planilla";
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "fk_rdlb_config_liq";
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "fk_rdlb_creado_por";
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "fk_rdlb_registro";
ALTER TABLE "registro_dia_laboral_bono" DROP CONSTRAINT "fk_rdlb_segmento";
ALTER TABLE "users" DROP CONSTRAINT "fk_users_invitado_por";
