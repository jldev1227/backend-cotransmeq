# Aprovechamiento de datos y trazabilidad

## Inventario de fuentes actuales

| Dominio | Datos disponibles | Aprovechamiento PESV | Estado y trabajo requerido |
|---|---|---|---|
| Conductores | Identificación, vínculo laboral, estado, licencia, categoría y vencimiento | Diagnóstico, competencia, jornada, inspecciones y siniestros | `NORMALIZAR`: completar expediente y relación de documentos |
| Vehículos | Placa, clase, modelo, propietario, conductor, estado y kilometraje | Diagnóstico, inspección, mantenimiento y contratistas | `NORMALIZAR`: categorías y vigencias documentales |
| Servicios | Fecha, cliente, origen/destino, propósito, vehículo, conductor y estado | Desplazamientos, exposición, velocidad y FUEC | `NORMALIZAR`: contrato, FUEC y distancia |
| Registro diario | Segmentos, horarios, kilómetros, pernocte, cliente y vehículo | Jornada, fatiga, kilómetros y exposición | `LISTA`: sustituir consultas a planillas antiguas |
| Clientes | NIT, nombre, contacto y configuración | Diagnóstico, rutas, contratos y gestión del cambio | `LISTA`, con clasificación de riesgo por añadir |
| Terceros | Identidad, tipo, estado y SARLAFT | Contratistas, propietarios y conductores ocasionales | `NORMALIZAR`: perfil y obligaciones PESV |
| Formularios | Definiciones, versiones, asignaciones, envíos, respuestas y adjuntos | Inspecciones, reportes, firmas y evidencia | `LISTA`, falta etiquetar paso y propósito PESV |
| Asistencias | Tema, objetivo, fecha, tipo, instructor y participantes | Formación, comité, comunicación y cobertura | `LISTA`, falta vincular al plan PESV |
| Evaluaciones | Preguntas, respuestas y resultado | Competencia y comportamiento | `LISTA`, falta clasificación PESV |
| Acciones correctivas | Hallazgo, causas, responsables, evidencias, eficacia y cierre | Pasos 13, 22 y 23; indicador NCAC | `LISTA`, falta ciclo y paso PESV |
| Actividades PESV | Actividad, responsable, frecuencia, fechas, recursos y estado | Plan anual | `NORMALIZAR`: ciclo, paso, programa, meta y soporte |
| Excesos de velocidad | Total mensual por conductor y vehículo | Referencia histórica | `HISTORICA`: no prueba el evento ni su desplazamiento |
| Preoperacionales | Booleano diario manual | Referencia histórica | `HISTORICA`: Formularios será la fuente nueva |
| Documentos | Archivo, categoría, vehículo/conductor y fecha de vigencia | Habilitación y alertas | `NORMALIZAR`: tipos, número, emisor, revisión y relaciones |
| Extractos | TXT con contratante, ruta, vigencia, vehículo y conductores | Cobertura contractual y FUEC | `NORMALIZAR`: importar a base relacional y guardar PDF |
| Siniestros | Conteo y observación en planilla | Señal histórica | `FALTANTE`: registro estructurado e investigación |
| Mantenimientos | Valores de liquidación | Ninguno como hoja de vida técnica | `FALTANTE`: plan y órdenes operativas |

## Fuente de verdad por proceso

- Jornada y kilómetros: `registro_dia_laboral` y sus segmentos activos.
- Operación ejecutada: `servicio` no eliminado y su estado real.
- Preoperacional nuevo: `form_submission` entregado, no anulado y contextualizado.
- Formación realizada: evento de Asistencias con participantes verificables.
- Competencia evaluada: resultado de Evaluaciones ligado al plan.
- Hallazgo cerrado: Acción Correctiva cerrada y con eficacia aprobada.
- Vigencia documental: documento normalizado y aprobado, evaluado contra la fecha de corte.
- Cobertura contractual: contrato/FUEC relacional, no el texto presentado en una tabla.

## Reglas de calidad

1. Todas las consultas excluyen filas con borrado lógico.
2. Los borradores de formularios no cuentan; `VOIDED` no cuenta y una corrección vigente
   sustituye a su antecedente.
3. Un vehículo cuenta una vez por día en el denominador de preoperacionales aunque tenga
   varios segmentos o servicios.
4. `km_final` debe ser mayor o igual a `km_inicial`. El dato inválido se excluye y genera una
   inconsistencia visible.
5. Los cruces de medianoche usan las banderas de día siguiente; no se restan strings de hora.
6. Un vínculo de evidencia conserva un snapshot legible del registro fuente para que una
   edición o baja posterior no altere lo que se auditó.
7. Las fechas de negocio se evalúan en `America/Bogota`.
8. Cada agregado devuelve `dataCoverage`: registros esperados, válidos, excluidos y motivos.

## Estados documentales

La aprobación y la vigencia son ejes separados:

- Revisión: `PENDIENTE`, `APROBADO`, `RECHAZADO`.
- Vigencia: `SIN_FECHA`, `VIGENTE`, `POR_VENCER`, `VENCIDO`.
- `POR_VENCER` usa inicialmente una ventana de 30 días, configurable por tipo documental.
- Un documento rechazado o vencido no acredita un requisito aunque el archivo exista.

## Brechas que el dashboard debe admitir

Durante la transición habrá indicadores parcialmente calculables. La API no rellenará faltantes
con ceros ni inferirá datos legales desde textos libres. Devolverá el valor disponible, cobertura,
causas de exclusión y acción sugerida para corregir la fuente.

