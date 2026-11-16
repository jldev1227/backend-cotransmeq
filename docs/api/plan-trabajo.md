# Plan anual HSEQ/PESV

`/api/plan-trabajo` · código en [`src/modules/plan-trabajo/`](../../src/modules/plan-trabajo/)

Recurso administrativo protegido por `acciones-correctivas`: las lecturas requieren `read` y las escrituras `full`. Cada empresa conserva su propia versión, responsables, ocurrencias y evidencias. El portal del conductor usa las rutas específicas documentadas en [conductor-portal](./conductor-portal.md).

La importación inicial se ejecuta con `npm run plan-trabajo:importar -- /ruta/al/archivo.xlsx`. Verifica las 167 actividades, 724 ocurrencias mensuales, 536 ejecuciones históricas y los seis indicadores antes de escribir. Repetir una importación completa no duplica ni sobrescribe los datos.

## Endpoints

### Progreso individual

Las asignaciones de una ocurrencia crean una participación estable por persona (usuario o conductor), aunque esa persona tenga varios roles. `cuota` indica cuántas ventanas del mes debe cumplir; las ventanas se distribuyen entre la fecha local de asignación y el corte de la ocurrencia. Una foto o envío válido cuenta una sola vez por ventana. Si se vincula `form_assignment_id`, solo cuentan envíos de ese formulario en estado `SUBMITTED`, con `submitted_at` posterior a la asignación; los borradores y las fotos no avanzan esa cuota. El progreso se calcula al consultar la participación, por lo que también incorpora un borrador que se confirme más tarde, sin duplicar el conteo en reintentos. Cada endpoint de envío sincroniza la participación después del commit; al llegar a la cuota se completa automáticamente y no requiere una acción manual en la app. La ocurrencia del Excel se cierra únicamente cuando todas las participaciones activas están completadas.

| Método | Ruta | Uso |
| --- | --- | --- |
| GET | `/api/plan-trabajo/mis-actividades` | Tareas y avance del usuario administrativo autenticado |
| GET | `/api/plan-trabajo/ocurrencias/:id/participaciones` | Avance de cada persona para gestión |
| PATCH | `/api/plan-trabajo/participaciones/:id` | Configura `cuota` (1–31) y `form_assignment_id` opcional |
| POST | `/api/plan-trabajo/participaciones/:id/evidencias` | Sube soporte propio del usuario |
| POST | `/api/plan-trabajo/participaciones/:id/completar` | Cierra solo la participación propia |

Los recordatorios usan el primer corte aún pendiente de cada persona: 7 y 1 día antes, el día del corte y cada tres días hábiles después. La clave de deduplicación incluye la ventana. La migración `20261116030000_plan_trabajo_progreso_individual` crea la tabla y reconoce los cierres históricos sin cambiar las ocurrencias importadas. Debe aplicarse en cada base durante el despliegue correspondiente.

| Método | Ruta                                                    | Acceso                    | Qué hace                                                                                             |
| ------ | ------------------------------------------------------- | ------------------------- | ---------------------------------------------------------------------------------------------------- |
| GET    | `/api/plan-trabajo`                                     | acciones-correctivas:read | Lista versiones y resumen de actividades, ocurrencias y atraso                                       |
| GET    | `/api/plan-trabajo/:planId/gestion`                     | acciones-correctivas:read | Devuelve actividades, ocurrencias, asignaciones, personal activo, conductores y soportes             |
| GET    | `/api/plan-trabajo/:planId/indicadores`                 | acciones-correctivas:read | Calcula los seis indicadores; `trimestre=1..4` filtra los indicadores de seguimiento trimestral      |
| PUT    | `/api/plan-trabajo/:planId/cargos`                      | acciones-correctivas:full | Relaciona cada grupo de cargos indicado en el plan con un área y guarda su equipo de apoyo opcional |
| PUT    | `/api/plan-trabajo/:planId/cargos/lote`                 | acciones-correctivas:full | Guarda en una sola transacción los cambios de área, colaboradores y suplentes de varios cargos       |
| POST   | `/api/plan-trabajo/:planId/activar`                     | acciones-correctivas:full | Activa la versión y sus recordatorios después de validar el mapa cargo-área y sus responsables       |
| POST   | `/api/plan-trabajo/:planId/clonar`                      | acciones-correctivas:full | Clona actividades, calendario, áreas por cargo y configuración fuente sin copiar cierres ni soportes |
| PUT    | `/api/plan-trabajo/ocurrencias/:id/asignaciones`        | acciones-correctivas:full | Asigna en una ocurrencia mensual personal administrativo y/o conductores como responsables, colaboradores o suplentes |
| PUT    | `/api/plan-trabajo/ocurrencias/:id/conductores`         | acciones-correctivas:full | Asigna conductores concretos a una ocurrencia mensual                                                |
| PATCH  | `/api/plan-trabajo/ocurrencias/:id/completar`           | acciones-correctivas:full | Cierra una ocurrencia; exige evidencia cuando la actividad la requiere                               |
| PATCH  | `/api/plan-trabajo/ocurrencias/:id/no-aplica`           | acciones-correctivas:full | Registra motivo y aprobador de una excepción fuera de los indicadores                                |
| POST   | `/api/plan-trabajo/ocurrencias/:id/evidencias`          | acciones-correctivas:full | Adjunta PDF, imagen, texto u Office (máximo 8 MB)                                                    |
| PUT    | `/api/plan-trabajo/:planId/indicadores/:numero`         | acciones-correctivas:full | Registra el resultado documental manual de los indicadores 1 y 2                                     |
| PUT    | `/api/plan-trabajo/:planId/indicadores/:numero/bandas`  | acciones-correctivas:full | Edita las bandas de referencia conservadas del Excel sin alterar la meta del cálculo                 |
| POST   | `/api/plan-trabajo/indicadores/:id/evidencias`          | acciones-correctivas:full | Adjunta soporte documental a un indicador manual                                                     |
| GET    | `/api/plan-trabajo/evidencias/:id/url`                  | acciones-correctivas:read | Entrega URL firmada temporal para consultar un soporte                                               |
| PATCH  | `/api/plan-trabajo/actividades/:id/evidencia-requerida` | acciones-correctivas:full | Cambia si el cierre de la actividad exige soporte                                                    |

## Indicadores

- 1 y 2 son registros documentales anuales. Se consideran cumplidos solo cuando el administrador marca cumplimiento y adjunta evidencia.
- 3 es el porcentaje anual de ocurrencias completadas sobre ocurrencias planificadas. “No aplica” no entra en el denominador.
- 4 mide cierres dentro del cronograma para el trimestre solicitado, o el año completo sin `trimestre`. Las ejecuciones importadas se consideran puntuales al nivel mensual, sin asignarles un día exacto.
- 5 filtra no conformidades de HSEQ/PESV identificadas en el periodo y calcula las cerradas eficazmente sin reapertura sobre las detectadas.
- 6 calcula el porcentaje de ocurrencias PESV completadas en el trimestre indicado (o el acumulado anual si no se indica trimestre).
- Las metas principales se comparan en el cálculo; las bandas del Excel quedan como referencia editable porque sus intervalos no son consistentes.

Los recordatorios salen a las 08:00 en `America/Bogota`: siete y un día antes, el día del vencimiento y cada tres días hábiles después. `plan_trabajo_recordatorio` deduplica por ocurrencia, destinatario y regla. La activación inicial fija el inicio del recordatorio para ocurrencias ya vencidas, evitando avisos retroactivos.

Los responsables se administran en `Personal → Responsables por área` mediante `GET /api/usuarios/responsables-area` y `PUT /api/usuarios/responsables-area/:area` (`{ "usuario_id": "uuid" }`). Cada una de las siete áreas tiene una sola persona responsable, que debe estar activa y pertenecer a ella. En la configuración del plan, cada texto único de responsables se relaciona con un área; la persona responsable de esa área recibe las tareas abiertas asociadas. Colaboradores y suplentes siguen siendo asignaciones opcionales por grupo de cargos. La activación requiere relacionar todos los grupos y tener un responsable activo en cada área. Cambiar el responsable reasigna las tareas abiertas y conserva las cerradas; no se envían avisos retroactivos.

`PUT /api/plan-trabajo/ocurrencias/:id/asignaciones` recibe `{ "asignaciones": [{ "destinatario_tipo": "ADMIN", "destinatario_id": "…", "rol": "RESPONSABLE" }] }`. El tipo puede ser `ADMIN` o `CONDUCTOR`; los roles son `RESPONSABLE`, `COLABORADOR` y `SUPLENTE`. Reemplaza las asignaciones de esa ocurrencia y notifica a las personas nuevas por los canales internos de la app cuando sigue pendiente; los cierres históricos no generan avisos.

`PUT /api/plan-trabajo/:planId/cargos/lote` recibe `{ "configuraciones": [{ "cargo": "…", "area": "HSEQ", "asignaciones": [{ "usuario_id": "…", "rol": "COLABORADOR" }] }] }`. Valida todos los cargos y usuarios antes de guardar; un error revierte el lote completo. Solo recalcula asignaciones de ocurrencias abiertas y conserva los cierres.
