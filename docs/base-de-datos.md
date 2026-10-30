# Base de datos

PostgreSQL con Prisma 5. Este documento recorre los 171 modelos de
[`prisma/schema.prisma`](../prisma/schema.prisma) agrupados por dominio, las
convenciones que no se ven a simple vista (tablas renombradas con `@@map`, ids
sin valor por defecto, `updated_at` que hay que escribir a mano), el borrado
lógico, **cómo se aplica una migración** —no con `prisma migrate deploy`—, la
lectura cruzada de la base de Transmeralda y qué bases hay en local y para las
pruebas. Léelo antes de tocar el esquema, de escribir SQL a mano o de apuntar
cualquier comando a una base.

## Piezas

- **Motor.** PostgreSQL 18. La base de pruebas usa `postgres:18-alpine` por ser
  «la misma major que producción» ([`docker-compose.test.yml`](../docker-compose.test.yml)),
  y los paquetes de migraciones de producción hablan de la 18.6.
- **ORM.** Prisma 5 (`@prisma/client` y `prisma` fijados en 5.22.0), generador
  `prisma-client-js` con `previewFeatures = ["omitApi"]`. El `datasource` lee
  `env("DATABASE_URL")`, igual que la CLI (`generate`, `migrate`, `db push`).
- **Cliente principal**, [`src/config/prisma.ts`](../src/config/prisma.ts).
  Carga `.env`, quita comillas a `DATABASE_URL` (si llega vacía, la arma con
  `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` y `DB_PORT`) y le añade
  `connection_limit=10`, `pool_timeout=30` y `connect_timeout=10`. Fuera de
  producción registra cada consulta a nivel `debug`. El `request.prisma` que
  cuelga `app.ts` en cada petición es ese mismo cliente.
- **Cliente de Transmeralda**,
  [`src/config/prismaTransmeralda.ts`](../src/config/prismaTransmeralda.ts).
  `getPrismaTransmeralda()` abre la base de Transmeralda con
  `TRANSMERALDA_DATABASE_URL` (perezoso, `connection_limit=5`, solo registra
  errores) para importar recargos. Sin la variable, las rutas
  `importar-desde-transmeralda` responden 503 y no se intenta conectar. Ver
  [Lectura cruzada](#lectura-cruzada-de-la-base-de-transmeralda).
- **Arranque.** `server.ts` llama a `testDatabaseConnection()` (`$connect` y
  `SELECT 1`) antes de registrar nada: si la base no responde, el proceso sale
  con código 1.
- **Lo que Prisma no ve.** Prisma solo gestiona el schema `public`. El schema
  `auditoria` (`borrado_asistencia`, `borrado_logico`), los disparadores que
  protegen las asistencias, los índices únicos parciales, los `CHECK`, los
  comentarios de columna, la identidad de `pesv_incident.consecutivo` y las FK
  de `combustible_tanqueos` existen solo en las migraciones SQL. Por eso un
  `prisma db push` desde el esquema no reproduce la base entera (ver
  [Base de pruebas](#base-de-pruebas)), y por eso esas piezas se escriben a mano
  en cada migración.

## Mapa de modelos

El nombre del modelo es el del cliente (`prisma.servicio`, `prisma.usuarios`).
La tabla se llama igual salvo cuando hay `@@map`, y **en SQL se escribe la
tabla**: `users` y no `usuarios`, `servicios` y no `servicio`, `empresas` y no
`clientes`. Escribir `REFERENCES "usuarios"` en una migración falla con
«relation does not exist». La columna «Tabla» solo se rellena en esos casos;
«`deleted_at`» marca los 84 modelos con borrado lógico.

Los modelos marcados como heredados no los usa nada en `src/`: vienen de la
época de Sequelize o de módulos reemplazados. No los borres sin mirar antes la
base (pueden tener datos), pero no construyas nada nuevo sobre ellos. Los
modelos `liquidacion_ingreso_transmeralda*` conservan el nombre del gemelo: en
esta base guardan la hoja de ingresos de Cotransmeq.

### Operación: servicios, días laborados, recorridos y FUEC

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `servicio` | `servicios` | sí | Servicio de transporte: cliente, conductor, vehículo, origen y destino, estado. |
| `servicio_ejecucion` |  |  | Inicio y liberación del servicio desde la app del conductor, incluido lo que llega diferido de la cola offline. La clave es `servicio_id`. |
| `servicios_cancelados` |  |  | Quién canceló un servicio y por qué. |
| `servicio_historicos` |  |  | Bitácora de cambios por campo. Heredada: nada en `src/` la usa. |
| `municipios` |  |  | Catálogo de municipios. |
| `custom_places` |  | sí | Lugares propios (pozos, campamentos, patios) que se mezclan con HERE en el autocompletado. |
| `registro_dia_laboral` |  | sí | Día laborado de un conductor: tipo, fecha, observaciones. El detalle va en los tramos. |
| `registro_dia_laboral_segmento` |  | sí | Tramos del día: cliente, vehículo, horarios, desfase de días. |
| `registro_dia_laboral_bono` |  | sí | Bono asignado a un día o tramo, con la configuración de la que sale. |
| `registro_dia_laboral_adjunto` |  | sí | Soportes (facturas) de los días de mantenimiento, en S3 y verificados por SHA-256. |
| `recorridos_periodo_snapshot` |  |  | Versiones del canvas de recorridos por periodo (deshacer). |
| `canvas_anotacion` |  |  | Notas por celda de los canvas, con `version` para el compare-and-swap. |
| `transport_contract` |  | sí | Contrato de transporte especial: contratante y vigencia. |
| `fuec_extract` |  | sí | Extracto FUEC expedido: copia de lo impreso y firma HMAC. Corregir es anular y expedir otro. |
| `fuec_extract_driver` |  |  | Conductores autorizados en un extracto. |
| `fuec_contratante` |  | sí | Contratantes con su número de contrato y el responsable que firma. |
| `fuec_catalogo` |  | sí | Textos que se repiten entre extractos (objeto, convenio, origen-destino). |
| `fuec_import_issue` |  |  | Filas de la importación de extractos que no se pudieron resolver solas. |
| `solicitud_web` |  |  | Solicitudes del formulario público de la landing, con radicado, para la bandeja del panel. |

### Flota

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `vehiculos` |  | sí | Vehículos: placa, propietario, estado. |
| `documento` |  | sí | Documentos de vehículos y de conductores (SOAT, revisión, hoja de vida) en S3, con vencimiento. |
| `vehicle_maintenance_plan` |  | sí | Plan de mantenimiento por vehículo. |
| `vehicle_maintenance_event` |  | sí | Orden de trabajo: programada y, si ocurrió, ejecutada. |
| `vehicle_maintenance_attachment` |  | sí | Soportes de una orden de trabajo (factura, fotos) en S3. |
| `combustible_tanqueo` | `combustible_tanqueos` | sí | Tanqueos de combustible. Sin relaciones Prisma a propósito: las FK solo están en la migración. |

### Personas y empresas

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `conductores` |  | sí | Conductores: datos personales y laborales, sede, estado. |
| `terceros` |  | sí | Terceros a los que se liquida: propietarios de vehículos, proveedores. |
| `clientes` | `empresas` |  | Clientes (empresas contratantes). Ojo: `createdAt`/`updatedAt`/`deletedAt` en camelCase y sin zona horaria; se oculta con `oculto`. |
| `documentos_requeridos_conductor` |  |  | Heredada y sin uso: el catálogo de documentos del conductor vive en `conductores-documentos/catalogo.ts`. |

### Nómina de conductores

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `liquidaciones` |  | sí | Liquidación de nómina de un conductor por periodo: devengados, deducciones, neto, estado del flujo y `version`. |
| `liquidaciones_dias` |  | sí | Copia de los días que entraron en una liquidación. Las anteriores a la tabla no tienen filas y se derivan de las planillas. |
| `liquidacion_vehiculo` |  | sí | Vehículos de una liquidación (clave compuesta). |
| `anticipos` |  | sí | Anticipos que se descuentan en la liquidación. |
| `bonificaciones` |  | sí | Bonos de la liquidación. |
| `pernotes` |  | sí | Pernoctes de la liquidación, por cliente y vehículo. |
| `recargos` |  | sí | Recargos de la liquidación; pueden venir de una planilla (`origen_planilla_id`). |
| `mantenimientos` |  | sí | Valores de mantenimiento dentro de la liquidación. No es una hoja de vida técnica. |
| `historial_estado_liquidacion_nomina` |  |  | Cambios de estado de una liquidación de nómina. |
| `nomina_periodo_snapshot` |  |  | Versiones del canvas de nómina por periodo (deshacer). |
| `nomina_envio` |  |  | Constancia de cada envío de desprendible por correo (nace ENVIANDO, termina ENVIADO o ERROR). |
| `firmas_desprendibles` |  |  | Firma del desprendible por el conductor, por enlace con token. |
| `primas` |  | sí | Primas de servicios, con desprendible aparte. |
| `firmas_primas` |  |  | Firma de la prima por el conductor. |
| `documentos_compartidos` |  |  | Desprendibles independientes compartidos por enlace (token, vencimiento, firma). |
| `configuraciones_liquidacion` |  | sí | Parámetros de nómina por concepto y año (bonos, porcentajes, auxilio de transporte). |
| `bono_config_visual` |  |  | Si un bono se muestra o no en el canvas, por año. |
| `configuraciones_salarios` |  | sí | Salario base, valor hora y horas mensuales por cliente y vigencia. |
| `configuracion_liquidador` |  |  | Heredada: nada en `src/` la usa. |
| `bonificaciones_backup` |  |  | Copia heredada sin clave primaria; `@@ignore`, el cliente no la expone. |

### Recargos (planillas)

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `recargos_planillas` |  | sí | Planilla de recargos por conductor, vehículo, cliente y mes. |
| `dias_laborales_planillas` |  | sí | Días de una planilla. |
| `detalles_recargos_dias` |  | sí | Horas por tipo de recargo de cada día. |
| `tipos_recargos` |  | sí | Tipos de recargo con su porcentaje y vigencia (varias filas por código cuando cambia la ley). |
| `ajustes_horas_recargo` |  | sí | Ajustes manuales de horas por código y tramo de vigencia. |
| `historial_recargos_planillas` |  |  | Historial de cambios de cada planilla (antes y después). |
| `snapshots_recargos_planillas` |  |  | Heredada: nada en `src/` la usa. |

### Liquidaciones de servicios y facturación a clientes

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `tarifas_servicios` |  |  | Tarifas por cliente, año y operadora (24 h, 12 h, hora, km, pernocte). |
| `operadoras` |  |  | Catálogo de operadoras de las liquidaciones de servicios. No gobierna `tarifas_servicios.operadora`. |
| `configuracion_liquidacion_servicio` |  |  | Costos por cargo con los que se valoran los servicios (salario, seguridad social, prestaciones, administración). |
| `liquidacion_servicio` |  | sí | Liquidación de servicios a un cliente por mes: totales, IVA, estado. |
| `liquidacion_servicio_item` |  | sí | Filas de la liquidación. Se reconcilian por `id` y `client_key`, nunca por posición. |
| `liquidacion_servicio_draft` |  |  | Borrador privado de una liquidación que aún no tiene ítems. |
| `historial_estado_liquidacion` |  |  | Cambios de estado de una liquidación de servicios, con snapshot. Es evidencia. |
| `factura_liquidacion_servicio` |  | sí | Factura a un cliente: número, emisión, vencimiento, estado. |
| `factura_liquidacion_item` |  | sí | Pivote factura ↔ liquidación, con el valor facturado. |
| `factura_liquidacion_abono` |  | sí | Pagos recibidos de una factura (cartera), con las retenciones desglosadas. |
| `liquidaciones_servicios` |  |  | Heredada: nada en `src/` la usa. |
| `servicio_liquidaciones` |  |  | Heredada: nada en `src/` la usa. |

### Cierres y liquidaciones de terceros

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `liquidacion_tercero` |  | sí | Parte de un ítem de la liquidación de servicios que corresponde a un tercero (placa, valores, administración). |
| `liquidacion_tercero_concepto` |  | sí | Conceptos (descuentos) de esa parte. |
| `configuracion_descuento_tercero` |  |  | Catálogo de descuentos a terceros: porcentaje y base de cálculo. |
| `configuracion_gastos_periodo` |  | sí | Gastos de un periodo de cierres, congelados. Sin fila valen los de `reglas-conceptos.ts`. |
| `liquidacion_tercero_final` |  | sí | Cierre final de un tercero por placa y periodo; su estado llega hasta PAGADA. |
| `liquidacion_tercero_final_item` |  | sí | Pivote cierre ↔ `liquidacion_tercero` incluidos. |
| `liquidacion_tercero_final_concepto` |  | sí | Conceptos propios del cierre. |
| `liquidacion_tercero_final_propietario` |  | sí | Copropietarios de un cierre multi-propietario. |
| `liquidacion_tercero_final_adicional` |  | sí | Adicionales del periodo, con `version` para la concurrencia optimista. |
| `liquidacion_tercero_final_pago` |  | sí | Pago de un cierre (fecha, medio, soporte); un pago vivo por cierre. |
| `liquidacion_tercero_final_snapshot` |  |  | Snapshot inmutable del cierre (deshacer, trazabilidad). |
| `liquidacion_tercero_adicional_periodo_snapshot` |  |  | Snapshot de los adicionales de un periodo. |
| `historial_estado_liquidacion_tercero_final` |  |  | Cambios de estado de un cierre. |
| `liquidacion_tercero_envio` |  |  | Cada correo enviado, o intentado, desde el canvas de cierres (marca los de prueba). |
| `liquidacion_tercero_ocasional` |  | sí | Cabecera de la liquidación ocasional (mensual) de terceros. |
| `liquidacion_tercero_ocasional_item` |  | sí | Ítems generados desde los cierres seleccionados; se excluyen con `excluido`. |
| `liquidacion_tercero_ocasional_adicional` |  | sí | Adicionales con su cierre de origen y de destino. |
| `liquidacion_tercero_ocasional_concepto` |  | sí | Conceptos, por placa o prorrateados. |
| `liquidacion_tercero_ocasional_draft` |  |  | Último borrador del canvas por cabecera y usuario. |
| `liquidacion_tercero_ocasional_snapshot` |  |  | Snapshots de la liquidación ocasional. |
| `liquidacion_ingreso_transmeralda` |  | sí | Hoja de ingresos de la empresa por mes (cabecera). |
| `liquidacion_ingreso_transmeralda_fila` |  | sí | Ingresos tocados a mano: marcados para adicionales, cantidades, porcentajes. |
| `liquidacion_ingreso_transmeralda_concepto` |  | sí | Conceptos del pie de cada hoja. |
| `liquidacion_chat_mensaje` |  | sí | Chat por liquidación, cifrado con AES-256-GCM (clave de `LIQ_CHAT_SECRET`). |
| `liquidacion_recordatorio` |  | sí | Recordatorios para liquidaciones futuras de una placa. |

### Formularios dinámicos

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `form_definition` | `form_definitions` | sí | Identidad estable de un formulario (código HSEQ, slug). |
| `form_version` | `form_versions` |  | Versión del formulario; `revision` es el contador de concurrencia del constructor. |
| `form_section` | `form_sections` |  | Secciones de una versión. |
| `form_field` | `form_fields` |  | Campos; `parent_field_id` modela repetibles y matrices. |
| `form_field_option` | `form_field_options` |  | Opciones de selección; `value` es el token estable. |
| `form_field_template` | `form_field_templates` | sí | Biblioteca de campos preconfigurados que se copian al insertarlos. |
| `form_assignment` | `form_assignments` | sí | Quién diligencia qué versión publicada, cuándo y con qué límite. |
| `form_assignment_target` | `form_assignment_targets` |  | Audiencia de una asignación: conductores y usuarios internos. |
| `form_submission` | `form_submissions` | sí | Envío o borrador; `client_submission_id` hace idempotente el POST. |
| `form_answer` | `form_answers` |  | Respuestas. Borrador y envío usan columnas distintas (ver `AGENTS.md`). |
| `form_answer_option` | `form_answer_options` |  | Opciones marcadas en una respuesta (clave compuesta). |
| `form_attachment` | `form_attachments` |  | Evidencias subidas directo a S3, con su SHA-256. |
| `form_submission_event` | `form_submission_events` |  | Bitácora append-only del envío (creación, sincronización, anulación). |

### Asistencias, evaluaciones y SARLAFT

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `formularios_asistencia` |  | sí | Formularios de asistencia a capacitaciones y eventos. Protegida por disparadores. |
| `respuestas_asistencia` |  |  | Firmas de asistencia de cada persona. Protegida por disparadores. |
| `Evaluacion` |  | sí | Evaluación (examen) con preguntas; puede pedir firma. |
| `Pregunta` |  |  | Pregunta de una evaluación (tipo y puntaje). |
| `Opcion` |  |  | Opciones de una pregunta. |
| `Resultado` |  |  | Intento de una persona: datos, puntaje total, firma. |
| `Respuesta` |  |  | Respuesta a una pregunta dentro de un resultado. |
| `formulario_sarlaft_ptee` |  |  | Formularios públicos SARLAFT + PTEE (cliente o proveedor, accionistas, personal, declaración). |
| `formulario_sarlaft_ptee_documento` |  |  | Adjuntos de esos formularios. |
| `formulario_sarlaft_ptee_documento_generado` |  |  | PDF emitido por versión; la versión 1 no se reescribe nunca. |
| `formulario_sarlaft_ptee_documento_entrega` |  |  | Intentos de entrega (correo, aviso interno, descarga temporal); el token se guarda solo como SHA-256. |

### HSEQ y PESV

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `acciones_correctivas_preventivas` |  | sí | Acciones correctivas, preventivas y de mejora: hallazgo, análisis, estado. |
| `aprobaciones_accion` |  | sí | Aprobaciones por rol de una acción. |
| `causas_accion_correctiva` |  |  | Causas de una acción y su plan. |
| `seguimientos_causa` |  |  | Seguimientos de cada causa. |
| `seguimientos_correccion_inmediata` |  |  | Seguimientos de la corrección inmediata. |
| `ciclos_seguimiento_eficacia` |  |  | Ciclos de verificación de la eficacia. |
| `evidencias_eficacia_cierre` |  |  | Evidencias para cerrar por eficacia. |
| `salidas_no_conformes` |  |  | Salidas no conformes del servicio. |
| `inducciones_visitantes` |  |  | Inducción de visitantes en sede, con firmas. |
| `preoperacionales` |  |  | Preoperacional diario del vehículo. |
| `excesos_velocidad` |  |  | Total mensual de excesos de velocidad por conductor y vehículo. |
| `pesv_speed_event` |  | sí | Un evento de exceso de velocidad por fila (lo que el total mensual no permite contar). |
| `pesv_cycle` |  | sí | Ciclo anual del PESV: la unidad de auditoría. |
| `pesv_requirement_status` |  | sí | Estado de cada uno de los 24 pasos dentro de un ciclo (el catálogo vive en código). |
| `pesv_evidence` |  | sí | Evidencia aportada a un paso; nace PENDIENTE. |
| `pesv_evidence_review` |  |  | Decisiones sobre una evidencia. Inmutable. |
| `pesv_goal` |  | sí | Meta de un indicador para un ciclo. |
| `pesv_risk` |  | sí | Riesgo vial con su valoración inicial y final. |
| `pesv_program` |  | sí | Programa de gestión de un riesgo crítico. |
| `pesv_program_vehicle` |  | sí | Vehículos cubiertos por un programa. |
| `pesv_incident` |  | sí | Incidentes y siniestros, con su investigación. |
| `incidente_evidencias` |  | sí | Evidencias de un incidente en S3. |
| `incidente_acciones` |  |  | Acciones correctivas que salen de un incidente (unión N-M, clave compuesta). |
| `pesv_training_plan` |  | sí | Plan de formación, con la población objetivo congelada por periodo. |
| `pesv_document_type_config` |  |  | Días de preaviso y obligatoriedad por tipo de documento. |
| `pesv_audit_log` |  |  | Bitácora del módulo PESV. Append-only. |
| `pesv_jornada_policy` |  | sí | Políticas de jornada y descanso con vigencia. |
| `actividades_pesv` |  | sí | Plan de actividades del PESV anterior al centro de cumplimiento. Heredada: nada en `src/` la usa. |

### Finanzas: viáticos y certificados tributarios

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `viatico_anticipo` |  | sí | Anticipo de viáticos entregado a un conductor. |
| `viatico_solicitud` |  |  | Solicitud de anticipo que hace el conductor desde la app. |
| `viatico_gasto` |  |  | Gasto legalizado contra un anticipo; se anula, no se borra. |
| `viatico_gasto_adjunto` |  | sí | Comprobante de un gasto, en S3. |
| `viatico_fondo_movimiento` |  |  | Movimientos del fondo de anticipos de operaciones; el saldo es la suma. |
| `viatico_gasto_empresa` |  | sí | Gasto pagado con viáticos sin ser un anticipo (oficina, vehículo, banco). |
| `tipo_certificado` |  |  | Tipos de certificado tributario. |
| `certificado_archivo` |  | sí | Cada archivo de certificado subido a S3. |
| `certificado_tercero` |  | sí | Vínculo entre un tercero y sus certificados. |
| `certificacion_envio` |  | sí | Bitácora de envíos de certificados por correo. |

### Plataforma, seguridad y avisos

| Modelo | Tabla | `deleted_at` | Qué guarda |
|---|---|---|---|
| `usuarios` | `users` |  | Cuentas del dashboard: rol, áreas, permisos, datos de contacto. |
| `sesiones` |  |  | Una fila por inicio de sesión (hash del token); el middleware exige la fila activa. |
| `invitaciones_usuario` |  |  | Invitaciones por correo para crear una cuenta. |
| `usuario_enlace_app` |  |  | Enlaces de la app de administrativos (solo el hash del código; revocables). |
| `api_tokens` |  |  | Tokens personales para el servidor MCP (solo el hash). |
| `conductor_token` |  |  | Enlaces mágicos del portal del conductor (y del reporte de días laborados). La guarda del portal exige la fila vigente: borrarla revoca el enlace. |
| `tercero_token` |  |  | Enlaces de acceso de terceros a sus certificados. |
| `conductor_push_device` |  |  | Teléfonos del conductor que reciben avisos (Expo). |
| `conductor_notification` |  |  | Bandeja persistente de avisos del conductor. |
| `usuario_push_device` |  |  | Teléfonos de usuarios con la app de gestión. |
| `usuario_web_push` |  |  | Suscripciones Web Push de los navegadores. |
| `notificacion` |  |  | Notificaciones de la campana del dashboard. |
| `registro_actividad` |  |  | Qué hizo quién: una fila por cada escritura que termina bien. |
| `configuracion_empresa` |  |  | Ajustes de la empresa por clave, con el valor en JSON (la clave es `clave`). |
| `subsystems` |  |  | Heredada: nada en `src/` la usa. |
| `SequelizeMeta` |  |  | Registro de migraciones de la época de Sequelize. Heredada. |

## Convenciones

### Nombres

Español y `snake_case` en tablas, columnas y casi todos los modelos. Las
excepciones vienen del origen de cada módulo: formularios dinámicos (`form_*`),
PESV (`pesv_*`), mantenimiento (`vehicle_maintenance_*`), FUEC (`fuec_*`,
`transport_contract`) y `api_tokens` están en inglés; las evaluaciones
(`Evaluacion`, `Pregunta`, `Opcion`, `Resultado`, `Respuesta`) en PascalCase, y
en SQL hay que entrecomillarlas (`"Evaluacion"`); `clientes` conserva
`createdAt`, `updatedAt` y `deletedAt` en camelCase.

Tablas renombradas con `@@map`: `clientes` → `empresas`, `servicio` →
`servicios`, `usuarios` → `users`, `combustible_tanqueo` →
`combustible_tanqueos` y los trece `form_*`, que pasan a plural
(`form_definitions`, `form_submissions`…).

### Identificadores

Todos son UUID (`@db.Uuid`), con tres variantes que importan al insertar:

| Forma | Dónde | Qué implica |
|---|---|---|
| `@default(uuid())` | La mayoría de tablas nuevas | Lo genera Prisma. Un `INSERT` por SQL tiene que dar el id |
| `@default(dbgenerated("gen_random_uuid()"))` | Viáticos, `combustible_tanqueos`, `registro_actividad`, `solicitud_web`, `usuario_enlace_app`, `registro_dia_laboral_adjunto`, `seguimientos_causa` | Lo pone Postgres; sirve también para SQL a mano |
| Sin valor por defecto | Tablas heredadas: `usuarios`, `conductores`, `vehiculos`, `clientes`, `liquidaciones` y sus líneas (`anticipos`, `bonificaciones`, `pernotes`, `recargos`, `mantenimientos`), `recargos_planillas`, `dias_laborales_planillas`, `detalles_recargos_dias`, `tipos_recargos`, `municipios`, `documento`, `configuraciones_*`, `firmas_*`, `servicios_cancelados` | El código pasa `id: randomUUID()`. Un `create` sin `id` falla |

Excepciones: enteros autoincrementales en `documentos_requeridos_conductor` y
`subsystems`; `cuid()` en `inducciones_visitantes`; claves compuestas en
`liquidacion_vehiculo`, `form_answer_option` e `incidente_acciones`;
`servicio_ejecucion` usa `servicio_id` y `configuracion_empresa`, `clave`.

### Fechas

- `timestamptz(6)` en casi todas las columnas de fecha y hora; las fechas sin
  hora van como `@db.Date`. Sin zona horaria solo quedan `clientes`
  (`timestamp(6)`) e `inducciones_visitantes` (`timestamp(3)`).
- `created_at` lleva `@default(now())` en lo nuevo; en las tablas heredadas
  (incluida `tipos_recargos`) no tiene valor por defecto.
- **`updated_at` no siempre se actualiza solo.** En 32 modelos no lleva
  `@updatedAt`: las tablas heredadas (donde tampoco tiene valor por defecto, así
  que hay que pasar `created_at` y `updated_at` al crear) y algunas nuevas que
  solo tienen `@default(now())` (viáticos, `combustible_tanqueos`). En todas
  ellas un `update` que no escriba `updated_at: new Date()` deja la fecha vieja.

### Enums

60 enums de Postgres. Los que llevan `@map` guardan en la base un valor físico
distinto de la clave de Prisma (`A+` en los tipos de sangre). Ver
[Enums con valores físicos distintos](#enums-con-valores-físicos-distintos).

## Borrado lógico

Nada que sea un dato del usuario se borra en duro: se marca `deleted_at` y se
filtra al leer. El incidente que lo originó y los helpers están en
[borrado-logico-liquidaciones.md](./borrado-logico-liquidaciones.md); la regla
completa, en [`AGENTS.md`](../AGENTS.md). Lo que no se negocia:

- **Toda lectura filtra, en sus cuatro formas.** Consulta directa
  (`where: { deleted_at: null }`), `include` a-muchos
  (`hija: { where: { deleted_at: null } }`), conteos
  (`_count: { select: { hija: { where: { deleted_at: null } } } }`) y filtro por
  relación (`madre: { some: { deleted_at: null } }`). Un `include` a-uno no
  admite `where` ni puede duplicar: se deja. Si se marca sin filtrar, la fila
  retirada y la nueva se cuentan las dos; en tablas con dinero eso es pagar de
  más.
- **Sin middleware de Prisma.** Los filtros son explícitos para que la auditoría
  siga viendo lo retirado; los eliminados se listan con
  `deleted_at: { not: null }`.
- **Índices únicos parciales.** Con un `@@unique`, la fila marcada sigue
  ocupando la clave y el guardado siguiente choca. La migración sustituye el
  índice por uno parcial (`… WHERE deleted_at IS NULL`) y en el esquema se deja
  el `@@unique` declarado, porque Prisma no sabe expresar índices parciales.
  Ejemplos: `recargos_origen_activo_uniq`,
  `dias_laborales_planillas_dia_activo_uniq`,
  `liquidacion_servicio_item_client_key_uniq`, `lt_final_pago_activo_uniq`. La
  excepción deliberada es `registro_dia_laboral`, que conserva
  `(conductor_id, fecha)` global para que el `upsert` reviva el día marcado.
- **Qué no lleva `deleted_at`.** Tokens y sesiones (revocar es borrar);
  `historial_*`, `*_snapshot` y firmas, que son la evidencia y no se tocan ni al
  retirar la madre; borradores `*_draft`; catálogos con `activo` u `oculto`; y
  uniones N-M que se reemplazan enteras.
- **Nunca `deleteMany` + `createMany` al guardar una lista.** `reconciliarItems`
  correlaciona por `id` y luego por `client_key`, nunca por posición.
- Los helpers viven en [`src/lib/soft-delete/`](../src/lib/soft-delete/) y no en
  los servicios, para que un test del marcado no arrastre sockets ni colas.
- Borrados físicos legítimos: `eliminarPermanente()` con su endpoint propio y
  los *rollback* de algo creado en la misma llamada.

**Asistencias, protegidas en la propia base.** La migración
`20260830120000_auditoria_asistencias` (idéntica en los dos repos) instala
disparadores: todo `DELETE` sobre `formularios_asistencia` se bloquea (se usa
borrado lógico), un `DELETE` sin filtro sobre `respuestas_asistencia` —el
`WHERE 1=1` que emite `deleteMany()` sin argumentos— también, y `TRUNCATE`
falla en las dos. Cada intento queda en `auditoria.borrado_asistencia`. Existen
porque el 28-ago-2026 la suite de tests del gemelo corrió contra su base real y
borró 2042 respuestas.

## Migraciones

### El historial no coincide con la base

`prisma/migrations/` acumula todo lo que se fue escribiendo desde 2025: desde
`20251018035437_init` hasta las de octubre de 2026, mezclado con carpetas de
nombre no estándar (`19-08-2026-formularios-dinamicos`,
`22-01-2026-create-causas-accion-correctiva`…), un `.sql` suelto
(`03-01-2026-add-tipo-correo-to-clientes.sql`) y la subcarpeta `manual/`. Hay
migraciones viejas destructivas: `20251021224958_add_rol_enum_and_conductor_relation`
borra columnas (`conductores.password`, `empresa_id` de varias tablas),
`20260630120000_add_primas_table_and_remove_prima_from_liquidaciones` borra las
columnas de prima de `liquidaciones`, y `20260721000000_align_to_transmeralda`
borra y recrea tipos enum. Las propias migraciones recientes lo advierten: «el
historial de migraciones de este proyecto está desalineado con la base real».
Desde el código no se puede saber qué tiene anotado `_prisma_migrations`.

De ahí salen tres reglas:

- **`prisma migrate deploy` es destructivo aquí.** Aplica todo lo que no
  encuentre anotado por nombre, incluidas esas migraciones con `DROP`. No lo
  ejecutes contra ninguna base con datos, aunque el comentario de
  `20260721000000_align_to_transmeralda` lo proponga como vía «automática».
- **`prisma migrate dev` tampoco** (`npm run prisma:migrate`): reconstruye el
  esquema en una base sombra a partir de la carpeta y, si no cuadra con la base,
  ofrece resetearla.
- **Comparar nombres no basta.** Que una migración no esté en
  `_prisma_migrations` no significa que su SQL no se haya aplicado, ni al revés.
  Comprueba los objetos (`to_regclass('public.tabla')`,
  `information_schema.columns`), como hace el paso de verificación de los
  paquetes de producción.

`prisma/migrations/manual/` guarda cuatro migraciones de septiembre y octubre de
2026 (`salario_licencia_y_marcas_dias`, `servicio_ejecucion`,
`registro_dia_laboral_adjunto`, `servicio_ejecucion_recomendaciones`) con el
mismo SQL que en el gemelo, fuera del nivel en el que Prisma busca migraciones.
Sus tablas y columnas sí están en el esquema.

### Cómo se escribe

1. Carpeta `prisma/migrations/<AAAAMMDDHHMMSS>_<nombre>/migration.sql` con SQL
   escrito a mano, **aditivo e idempotente**: `CREATE TABLE IF NOT EXISTS`,
   `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, y
   `DO $$ … EXCEPTION WHEN duplicate_object …` para tipos y constraints. Con
   los nombres reales de las tablas.
2. El cambio equivalente en `schema.prisma`, y `npm run prisma:generate`.
3. Lo que Prisma no expresa (índice parcial, `CHECK`, disparador) va solo en el
   SQL.
4. El mismo archivo en `backend-nest`, aplicado como el mismo parche y
   comprobado con `diff`. Diferencias conocidas: los literales de
   `tipo_servicio_tarifa_enum` y los códigos de los formatos SARLAFT (aquí
   `GC-FR-0X`; por eso existe `20260910120000_revertir_recodificacion_sarlaft`,
   que deshace la recodificación a `SLFT-PTEE-FR-0X` que trajo la migración
   compartida del 2-sep-2026).
5. Si el código nuevo lee columnas nuevas, la migración se aplica **antes** del
   despliegue.

### Cómo se aplica

Contra cualquier base con datos, local o de producción:

```bash
# Para psql, la URL sin `?schema=public` (psql la rechaza); Prisma sí la acepta.
psql "$URL_PSQL" -c 'select count(*) from <tabla>'                  # 1. recuento antes
psql "$URL_PSQL" -v ON_ERROR_STOP=1 --single-transaction \
     -f prisma/migrations/<nombre>/migration.sql                       # 2. aplicar
psql "$URL_PSQL" -c 'select count(*) from <tabla>'                  # 3. recuento después
DATABASE_URL="$URL_PRISMA" npx prisma migrate resolve --applied <nombre>   # 4. anotar
```

- `--single-transaction` con `ON_ERROR_STOP` es lo que protege: un error a mitad
  revierte todo y la base no queda a medias.
- Los recuentos deben coincidir, porque las migraciones son aditivas. Si una
  rellena datos a propósito, compara lo que toca: el paquete del 11-oct-2026
  compara `count` y `sum(valor_total)` de las facturas antes y después.
- `migrate resolve --applied` solo anota la migración en `_prisma_migrations`;
  no ejecuta SQL. Se corre desde este repo, que es donde está la carpeta de la
  migración.
- **Si el SQL falla**, la transacción ya lo revirtió. Si llegaste a anotarla,
  borra ese registro (`DELETE FROM _prisma_migrations WHERE migration_name =
  '<nombre>'`) antes de reintentar, o quedará anotada una migración que no se
  aplicó.
- **Dueño de la tabla.** Algunas sentencias solo las puede ejecutar el dueño:
  `20261011150000_incidentes_investigacion` convierte
  `pesv_incident.consecutivo` en columna de identidad. Si el usuario de la
  aplicación no es el dueño, ese archivo se corre con el usuario de
  migraciones.
- `ALTER TYPE … ADD VALUE` dentro de una transacción necesita PostgreSQL 12 o
  superior, y el valor nuevo no se puede usar en esa misma transacción.
- Después, lo mismo contra la base de Transmeralda: cada empresa tiene la suya.

### Producción

La base de producción solo se alcanza por túnel SSH; los paquetes de producción
usan `127.0.0.1:15433` para Cotransmeq (y `127.0.0.1:15432` para
Transmeralda). Las credenciales no están en el repo. Las migraciones de cada
entrega se agrupan en un paquete `migraciones-produccion-AAAA-MM-DD.sql` que
vive en la carpeta de los repos de Transmeralda (`github/transmeralda/`), **fuera
de git y fuera de este repo**: el mismo paquete sirve para las dos bases porque
incluye con `\ir` cada `migration.sql` de `backend-nest`, que es idéntico al de
aquí (salvo las excepciones de arriba, que van aparte). Tiene un paso 0 de solo
lectura (qué falta en `_prisma_migrations`, si el usuario puede alterar las
tablas, recuentos), una comprobación final y, al pie, los
`migrate resolve --applied` que hay que correr después, desde este repo. Se
ejecuta una vez por base, desde aquella carpeta:

```bash
psql "$URL_DEL_TUNEL" -v ON_ERROR_STOP=1 --single-transaction \
     -f migraciones-produccion-2026-10-11.sql
```

El orden respecto al despliegue está en [despliegue.md](./despliegue.md).

### Lo que no hay que ejecutar

| Comando | Por qué |
|---|---|
| `npx prisma migrate deploy` | Ver arriba. Este repo no tiene script npm para él, pero la CLI está instalada |
| `npm run prisma:migrate` | `prisma migrate dev --name init`: ofrece resetear la base |
| `npx tsx scripts/mark-pending-as-applied.ts` | Anota como aplicadas, sin ejecutar su SQL, todas las carpetas de `prisma/migrations/` que no estén en `_prisma_migrations`. Esconde migraciones pendientes de verdad |
| `npx tsx scripts/mark-pending-tm.ts` | Lo mismo, contra la base de Transmeralda (`TRANSMERALDA_DATABASE_URL`) y con la carpeta de este repo |
| `npm run seed` | [`prisma/seed.ts`](../prisma/seed.ts) empieza con `deleteMany({})` sobre liquidaciones, servicios, vehículos, conductores, clientes y usuarios. Usa nombres de modelo que ya no existen y fallaría antes de borrar: no lo «arregles» |
| `npm run migrate:check`, `migrate:compare`, `migrate:to-azure`, `migrate:fixed` | Scripts de la migración a Azure, escritos para aquellas bases. Toman origen y destino de `MIGRACION_ORIGEN_URL` y `MIGRACION_DESTINO_URL` (ver [variables-de-entorno.md](./variables-de-entorno.md#scripts-de-migración-entre-bases)); `migrate:to-azure` y `migrate:fixed` escriben en el destino |

Las semillas de formularios y de operadoras (`npm run seeds:*`) escriben en la
base del `.env`, pero por defecto hacen un simulacro; para escribir hay que
pedirlo explícitamente (ver
[`prisma/seeds/formularios-hseq/README.md`](../prisma/seeds/formularios-hseq/README.md)
y la cabecera de `prisma/seeds/operadoras/cargar.ts`).

### SQL sueltos

Los `*.sql` de la raíz (`add-*.sql`, `fix-creado-por-id.sql`,
`insert-tipos-recargo.sql`, `recalcular-recargos.sql`, `check-*.sql`…) y la
carpeta `migrations/` de la raíz (`dd-mm-aaaa-*.sql`, `migrate-recargos.*`) son
históricos: se aplicaron a mano en su momento y algunos recalculan datos.
Ningún flujo los usa; no se vuelven a ejecutar. `scripts/sql/` guarda arreglos
de datos puntuales (`ocultar-inactivos-2026.sql` con su `.preview.sql`).
`prisma/schema.production.prisma` y `prisma/schema.prisma.backup` son copias
viejas del esquema que nada referencia.

## Lectura cruzada de la base de Transmeralda

`recargosImportarTransmeralda.service.ts` lee la base del gemelo con
`getPrismaTransmeralda()`: `clientes`, `conductores`, `vehiculos`,
`liquidaciones` y `recargos_planillas`. El cliente se genera con **este**
esquema y se apunta allí, así que una consulta sin `select` pide todas las
columnas del modelo de aquí; si alguna solo existe en esta base, Postgres
responde que la columna no existe. Pasa hoy con
`recargos_planillas.imported_from_transmeralda_id` y `_at` (la contabilidad de
qué se importó y cuándo, que la reconciliación del gemelo borró a propósito).

- En las lecturas cruzadas se excluye lo propio con `omit`, no con `select`: con
  `select` hay que enumerar todas las columnas y una nueva se pierde en
  silencio; con `omit`, lo nuevo sigue llegando. Por eso el generador lleva
  `omitApi`.
- Añadir una columna solo aquí a una de esas cinco tablas obliga a añadirla al
  `omit` de las lecturas cruzadas. El fallo aparece al regenerar el cliente,
  aunque la columna lleve tiempo en el esquema.

## Bases en local

Esto no está en el código: es la configuración de la máquina de desarrollo
(octubre de 2026).

- PostgreSQL 18 de Homebrew en el puerto **5434**. No arranca solo:

  ```bash
  LC_ALL=en_US.UTF-8 /opt/homebrew/opt/postgresql@18/bin/pg_ctl \
    -D /opt/homebrew/var/postgresql@18 \
    -l /opt/homebrew/var/log/postgresql@18.log \
    -o "-p 5434" start -w
  ```

  Sin `LC_ALL` se ha caído al arrancar con «postmaster became multithreaded
  during startup». El 5433 lo ocupa un contenedor de otro proyecto y el 5432 es
  un PostgreSQL 17 con otras bases.
- Bases `cotransmeq_kody_20261006` (este repo) y `transmeralda_kody_20261006`,
  restauradas del respaldo del 6-oct-2026.
- `DATABASE_URL` sale del `.env`, pero `dotenv` no pisa una variable que ya esté
  en el entorno: `DATABASE_URL=… npm run dev` manda sobre el archivo. Antes de
  cualquier comando que escriba, mira a qué base apuntan `DATABASE_URL` y
  `TRANSMERALDA_DATABASE_URL`.
- El backend se levanta en el 4000 (`PORT`, ver
  [variables-de-entorno.md](./variables-de-entorno.md)).

## Base de pruebas

Contenedor desechable de [`docker-compose.test.yml`](../docker-compose.test.yml):
`postgres:18-alpine`, base `cotransmeq_test` en `localhost:55433`, datos en
`tmpfs` (al pararlo no queda nada) y `fsync` apagado. `npm run test:setup`
([`scripts/test-setup.sh`](../scripts/test-setup.sh)) lo levanta, instala
`pgcrypto`, aplica el esquema con `prisma db push` (no con `migrate`: en una
base efímera solo importa que la forma coincida) y después ejecuta a mano las
migraciones `*_soft_delete_*` y `*_auditoria_*`, porque `db push` no crea los
índices parciales ni el schema `auditoria`. Cómo se usa y qué impide borrar
datos reales: [pruebas.md](./pruebas.md).

## Enums con valores físicos distintos

`tipo_servicio_tarifa_enum` (tipo de servicio de los ítems de las liquidaciones
de servicios) tiene las mismas claves en los dos repos, pero aquí no lleva
`@map`: la base guarda la clave con guiones bajos
(`TRANSPORTE_DE_PERSONAL_EN_CAMIONETA`) desde
`20260721000000_align_to_transmeralda`. En Transmeralda cada valor lleva `@map`
y la base guarda la etiqueta con espacios y paréntesis
(`'TRANSPORTE DE PERSONAL EN CAMIONETA'`).

El TypeScript es idéntico; **el SQL no**. Un `ALTER TYPE … ADD VALUE` o un
`WHERE tipo = '…'` se escribe dos veces, con literales distintos: así quedó
`20260922120000_tipo_servicio_herramienta_doble_cabina`, cuyo SQL difiere entre
repos. Copiar el de un repo al otro crea en la base un valor que Prisma nunca
mapea. El backend tampoco avisa antes: pasa el tipo a Prisma tal cual
(`as any` en `liquidaciones-servicios.service.ts`) y el error, si lo hay, sale
de Prisma. Los demás enums con `@map` (tipos de sangre,
`enum_servicio_proposito_servicio`) son iguales en los dos.

## Diferencias con Transmeralda

- **Mismos 171 modelos, mismos `@@map`, mismo `deleted_at`.** Cambian algunas
  columnas: aquí existen además `liquidaciones.share_token` y
  `share_token_expires_at`, `recargos_planillas.imported_from_transmeralda_id` y
  `_at`; Transmeralda tiene los campos inversos
  `recargos_planillas.imported_from_cotransmeq_id` y `_at`, y columnas viejas de
  `registro_dia_laboral` (`cliente_id`,
  `vehiculo_placa`, `hora_inicio`, `hora_fin`…) que en Transmeralda viven solo
  en los tramos. `municipios` y `tipos_recargos` no tienen id por defecto aquí
  (allí, `uuid()`), y `tipos_recargos` tampoco tiene `@updatedAt`.
- **Campos de relación con otro nombre.** `clientes.registro_dia_laboral_segmento`
  y `vehiculos.registro_dia_laboral_segmento` aquí se llaman
  `registros_dia_segmento` allí; `conductores.conductor_token` y
  `conductores.registro_dia_laboral` son `conductor_tokens` y
  `registros_dia_laboral`; y cambian las relaciones de `usuarios` con
  `liquidacion_servicio` (`liq_serv_*` aquí), `primas` e
  `historial_estado_liquidacion`. Un `include` o `select` con esos nombres no
  compila en el otro repo: al replicar un parche, revísalos.
- **Historial de migraciones.** Transmeralda arrancó de nuevo con un
  `00000000000000_baseline` y `20260831000000_reconciliar_schema`, y archivó lo
  anterior en `prisma/migrations-archivo/`. Aquí no hay baseline. La regla de
  aplicación es la misma en los dos: SQL a mano en una transacción y
  `migrate resolve`.
- **Scripts.** Transmeralda tiene además `prisma:deploy`, `start:docker`,
  `prisma:recover` y `prisma:baseline` en `package.json` y un
  `docker-entrypoint.sh` que corre `prisma migrate deploy` con
  `PRISMA_MIGRATE_ON_START=true`; aquí no existen.
- **Enum `tipo_servicio_tarifa_enum`** y **códigos SARLAFT**: ver arriba.
- Base de pruebas `transmeralda_test` en el 55432; base local
  `transmeralda_kody_20261006`.
