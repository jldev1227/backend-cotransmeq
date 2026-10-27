# Recargos (planillas)

`/api/recargos` · código en [`src/modules/recargos/`](../../src/modules/recargos/) · permiso [`recargos`](../permisos.md#catálogo-de-módulos) para escribir

Una planilla de recargos (`recargos_planillas`) es lo que un conductor trabajó
con un vehículo para una empresa (cliente) en un mes: un número de planilla,
condiciones de la vía y riesgos del recorrido, y sus días laborados
(`dias_laborales_planillas`) con hora de inicio y fin. A partir de los días el
backend calcula las horas por tipo de recargo (`HED`, `HEN`, `HEFD`, `HEFN`,
`RN`, `RD`, `RNDF`) y su valor, y guarda el resultado en
`detalles_recargos_dias`. El «valor a pagar» de una planilla es la suma de esos
`valor_calculado`. El módulo incluye también el CRUD de las configuraciones
salariales que alimentan el cálculo y la importación de planillas desde la base
de Transmeralda.

Reglas que un integrador necesita saber:

- **Todo se valora con lo vigente en la fecha de cada día**, no con lo actual:
  el porcentaje del tipo de recargo (`tipos_recargos`, una fila por vigencia) y
  la configuración salarial (`configuraciones_salarios`: la de la empresa si
  existe, si no la base con `empresa_id` nulo). Cada detalle guarda esos
  valores como instantánea, así que un cambio de tarifa no altera planillas ya
  guardadas hasta que se recalculan.
- Las horas van en decimal (`hora_inicio: 6.5`). Un turno que pasa la
  medianoche se escribe con horas mayores de 24 o con `continua_siguiente_dia`,
  que une ese día con el siguiente de la misma planilla. Un día con
  `disponibilidad` no genera recargos ni cuenta en los totales.
- PAREX (un id fijo en `EMPRESAS_SIN_RNDF`) no reconoce `RNDF`. `RN` y `RNDF`
  se pagan como recargo puro (valor hora × %); las horas extras y `RD`,
  completas (valor hora × (1 + %)).
- El borrado es lógico y en cascada (planilla, días y detalles).
- Las planillas no tienen historial de cambios.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo: las lecturas se dejan solo con sesión a propósito, para no dejar fuera a quien tiene `limited` |
| `POST`, `PUT`, `PATCH`, `DELETE` | `recargos:full` (`puedeEscribir`, ruta por ruta) |
| `GET /api/recargos/importar-desde-transmeralda/preview` | `recargos:full` (`puedeEscribir`), igual que el `POST`: el preview trae nombres, cédulas y placas de la base de Transmeralda |
| `GET /api/recargos/recalcular-bulk/:batchId` | además, solo el usuario que lanzó el lote (con otro responde 404) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/recargos` | sesión | Planillas del canvas, con filtros y totales por tipo |
| GET | `/api/recargos/:id` | sesión | Planilla completa con días y detalles |
| POST | `/api/recargos/next-numero-planilla` | `recargos:full` | Reserva de forma atómica un número para un formulario |
| GET | `/api/recargos/next-numero-planilla` | `recargos:full` | Alias temporal para pestañas antiguas; también reserva |
| DELETE | `/api/recargos/reservas-planilla/:reservaId` | `recargos:full` | Libera la sugerencia al cerrar el formulario |
| GET | `/api/recargos/estadisticas/resumen` | sesión | Total y conteo por estado |
| GET | `/api/recargos/tipos-recargo/activos` | sesión | Tipos de recargo activos |
| GET | `/api/recargos/tipos-recargo/vigentes` | sesión | Tipos vigentes en una fecha o rango |
| GET | `/api/recargos/reporte` | sesión | PDF de servicios por conductor y placa de un mes |
| POST | `/api/recargos` | `recargos:full` | Crea una planilla con sus días |
| PUT | `/api/recargos/:id` | `recargos:full` | Edita una planilla |
| DELETE | `/api/recargos/:id` | `recargos:full` | Retira una planilla (borrado lógico) |
| POST | `/api/recargos/eliminar-multiple` | `recargos:full` | Retira varias |
| PATCH | `/api/recargos/restaurar/:id` | `recargos:full` | Restaura una planilla retirada |
| POST | `/api/recargos/restaurar-multiple` | `recargos:full` | Restaura varias |
| PATCH | `/api/recargos/cambiar-estado-multiple` | `recargos:full` | Cambia el estado de varias |
| POST | `/api/recargos/:id/liquidar` | `recargos:full` | Marca la planilla como `liquidada` |
| POST | `/api/recargos/:id/duplicar` | `recargos:full` | Copia la planilla con sus días |
| POST | `/api/recargos/:id/recalcular` | `recargos:full` | Revalora los días con lo vigente |
| POST | `/api/recargos/recalcular-bulk` | `recargos:full` | Recalcula muchas en segundo plano |
| GET | `/api/recargos/recalcular-bulk/:batchId` | sesión (dueño) | Estado de un recálculo en lote |
| POST | `/api/recargos/importar-desde-transmeralda/sincronizar-conductores-cotransmeq` | `recargos:full` | Marca activos e inactivos **en la base de Transmeralda** |
| POST | `/api/recargos/importar-desde-transmeralda/preview` | `recargos:full` | Planillas de Transmeralda importables de un mes |
| GET | `/api/recargos/importar-desde-transmeralda/preview` | `recargos:full` | Lo mismo, con los parámetros en el query |
| POST | `/api/recargos/importar-desde-transmeralda/crear-entidades-faltantes` | `recargos:full` | Crea aquí las placas y empresas que faltan |
| POST | `/api/recargos/importar-desde-transmeralda` | `recargos:full` | Importa las planillas elegidas |
| GET | `/api/recargos/configuraciones-salarios` | sesión | Lista las configuraciones salariales |
| GET | `/api/recargos/configuraciones-salarios/vigentes` | sesión | Configuración vigente para una empresa y fecha |
| GET | `/api/recargos/configuraciones-salarios/:id` | sesión | Una configuración |
| POST | `/api/recargos/configuraciones-salarios` | `recargos:full` | Crea una configuración |
| PUT | `/api/recargos/configuraciones-salarios/:id` | `recargos:full` | Edita una configuración |
| DELETE | `/api/recargos/configuraciones-salarios/:id` | `recargos:full` | Retira una configuración |
| GET | `/api/recargos/empresas-disponibles` | sesión | Empresas para el selector de configuraciones |

**Errores comunes.** Ninguna ruta tiene esquema JSON de Fastify. Salvo donde se
indica, los controladores responden **400** `{ success: false, message }` con el
mensaje de cualquier error, incluidos los de Prisma; los de zod,
**400** `{ success: false, message, errors }`, donde `message` es la primera
regla propia incumplida (ya en español y con el día) o «Error de validación», y
`errors` trae el detalle para marcar la celda.

### `GET /api/recargos`

**Query** (zod `buscarRecargosSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `mes` | string numérico | — | |
| `año` (o `ano`) | string numérico | — | Con eñe; `ano` es el alias sin ella |
| `conductor_id`, `vehiculo_id`, `empresa_id` | uuid | — | |
| `estado` | string | — | Igualdad con el enum de la planilla |
| `numero_planilla` | string | — | Contiene, sin distinguir mayúsculas |
| `eliminados` | `'true'` \| ausente | ausente | Con `'true'` lista la papelera |
| `imported_from_transmeralda` | `si` \| `no` \| `all` | `all` | Solo importadas de Transmeralda, solo nativas o todas |
| `page` | string numérico | `1` | |
| `limit` | string numérico | `200` | Tope 200: un valor mayor se recorta |

**Respuesta 200**

```json
{
  "success": true,
  "data": [ {
    "id": "uuid", "numero_planilla": "CM-0123", "mes": 9, "año": 2026, "estado": "pendiente",
    "conductor_id": "uuid", "vehiculo_id": "uuid", "empresa_id": "uuid", "servicio_id": "uuid",
    "planilla_s3key": null, "tiene_documento": false, "deleted_at": null,
    "imported_from_transmeralda": false, "imported_from_transmeralda_id": null, "imported_from_transmeralda_at": null,
    "total_hed": 4, "total_hen": 0, "total_hefd": 0, "total_hefn": 0, "total_rndf": 0, "total_rn": 2, "total_rd": 0,
    "total_horas": 48, "total_dias": 4,
    "conductor": { "id": "uuid", "nombre": "…", "apellido": "…", "numero_identificacion": "…" },
    "vehiculo": { "id": "uuid", "placa": "…" }, "empresa": { "id": "uuid", "nombre": "…" },
    "servicio": { "id": "uuid", "fecha_realizacion": "…", "fecha_solicitud": "…" },
    "dias_laborales": [ { "dia": 1, "hora_inicio": "6", "hora_fin": "18", "detalles_recargos_dias": [ { "horas": "2", "tipos_recargos": { "codigo": "HED" } } ], "…": "…" } ]
  } ],
  "pagination": { "page": 1, "limit": 200, "total": 340, "totalPages": 2 },
  "meta": { "total_valor_pagar": 1234567 }
}
```

`meta.total_valor_pagar` suma el valor de **todas** las planillas del filtro, no
solo de la página. Orden: `created_at` descendente.

### `GET /api/recargos/:id`

`{ success: true, data }` con la fila de la planilla y: `conductor` y `vehiculo`
(filas completas; la del conductor sin `password`, que quita el
`preSerialization` global), `clientes` (fila completa), `servicio` (con
municipios y cliente), `dias_laborales_planillas` activos con sus `detalles_recargos_dias`
activos y el tipo de cada uno, y quién la creó y la actualizó por última vez.
También devuelve una planilla eliminada. **404** `{ success: false, message: 'Recargo no encontrado' }`.

### `POST /api/recargos`

**Body** (zod `createRecargoSchema`; lo que no reconoce se descarta)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id`, `vehiculo_id`, `empresa_id` | uuid | sí | `empresa_id` es el cliente |
| `mes` | entero 1–12 | sí | |
| `año` | entero 2000–2100 | sí | Con eñe |
| `numero_planilla` | string ≤ 50 | no | Ver `next-numero-planilla` |
| `observaciones` | string | no | |
| `dias_laborales` | arreglo | no | Ver la tabla del día. Un día repetido llega a la base y vuelve como 400 con el error de unicidad de Prisma |
| `servicio_id` | uuid | no | Vincula un servicio existente |
| `servicio_origen_id`, `servicio_destino_id` | uuid | no | Con los dos y sin `servicio_id`, crea el servicio (ver abajo) |
| `servicio_origen_especifico`, `servicio_destino_especifico`, `servicio_observaciones` | string | no | Para ese servicio |
| `servicio_origen_latitud`, `…_longitud`, `servicio_destino_latitud`, `…_longitud` | number | no | |
| `servicio_proposito` | `personal` \| `personal y herramienta` \| `personal_y_herramienta` | no | |
| `servicio_fecha_realizacion` | string de fecha | no | |
| `estado_conductor` | `optimo` \| `fatigado` \| `regular` \| `malo` | no | |
| `via_trocha`, `via_afirmado`, `via_mixto`, `via_pavimentada` | boolean | no | `false` por defecto |
| `riesgo_desniveles`, `riesgo_deslizamientos`, `riesgo_sin_senalizacion`, `riesgo_animales`, `riesgo_peatones`, `riesgo_trafico_alto` | boolean | no | `false` por defecto |
| `fuente_consulta` | `conductor` \| `gps` \| `cliente` \| `sistema` | no | |
| `calificacion_servicio` | `excelente` \| `bueno` \| `regular` \| `malo` | no | |
| `tiempo_disponibilidad_horas`, `duracion_trayecto_horas` | number 0–999 | no | |
| `numero_dias_servicio` | entero 1–31 | no | |

**Un día de `dias_laborales`** (`diaLaboralSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `dia` | entero 1–31 | sí | |
| `hora_inicio`, `hora_fin` | number 0–100 \| `null` | no | La de fin no puede ser menor que la de inicio (400 que nombra el día) |
| `total_horas` | number 0–100 | no | `0` por defecto |
| `es_festivo`, `es_domingo`, `pernocte`, `disponibilidad`, `continua_siguiente_dia` | boolean | no | `false` por defecto |
| `kilometraje_inicial`, `kilometraje_final` | number \| `null` | no | |
| `observaciones` | string \| `null` | no | |

La planilla nace en `pendiente`, versión 1. Si crea el servicio, este toma
cliente, conductor y vehículo de la planilla, valor 0, y un estado deducido de
los días: sin días `solicitado`, todos pasados `realizado`, alguno hoy o
mezclados `en_curso`, todos futuros `planificado`.

**Respuesta 201**: `{ success: true, message: 'Recargo creado exitosamente', data: <como GET /:id>, valor_pagar }`.

### `PUT /api/recargos/:id`

**Body**: los campos del alta, todos opcionales, más `estado` (`pendiente`,
`liquidada`, `facturada`, `encontrada` o `no_esta`). Solo se cambia lo que
llega y la versión sube en uno.

- `dias_laborales` con al menos un día **reemplaza** todos los días: los
  anteriores y sus detalles se marcan como retirados y los nuevos se valoran
  con lo vigente. Un arreglo vacío no borra nada.
- Con `servicio_origen_id` y `servicio_destino_id` actualiza el servicio
  vinculado (o lo crea si no hay). El estado deducido de los días no se aplica
  si el conductor inició el servicio desde la app.

**Respuesta 200**: `{ success: true, message: 'Recargo actualizado exitosamente', data, valor_pagar }`.
Una planilla inexistente responde 400 «Recargo no encontrado».

### `DELETE /api/recargos/:id` · `POST /api/recargos/eliminar-multiple` · `PATCH /api/recargos/restaurar/:id` · `POST /api/recargos/restaurar-multiple`

Las múltiples reciben `{ "ids": ["uuid", …] }` (sin `ids` o vacío: 400 «Debe
proporcionar un array de IDs válido») y procesan solo los que están en el
estado de partida; los demás se ignoran. Restaurar revive todos los días y
detalles retirados de la planilla (ver Observaciones).

| Ruta | Respuesta 200 | 400 si |
|---|---|---|
| `DELETE /:id` | `{ success, message }` | «Recargo no encontrado o ya está eliminado» |
| `POST /eliminar-multiple` | `{ success, message, data: { eliminados } }` | ninguno estaba activo |
| `PATCH /restaurar/:id` | `{ success, message }` | «Recargo no encontrado o ya está restaurado» |
| `POST /restaurar-multiple` | `{ success, message, data: { restaurados } }` | ninguno estaba eliminado |

### `PATCH /api/recargos/cambiar-estado-multiple`

**Body**: `ids` (uuid[], al menos uno) y `estado` (`pendiente`, `liquidada`,
`facturada`, `no_esta`, `encontrada`, `borrador`, `activo`, `completado`,
`liquidado` o `cancelado`). Solo toca planillas activas.
**Respuesta 200**: `{ success, message, data: { actualizados, estado } }`.

### `POST /api/recargos/:id/liquidar` · `POST /api/recargos/:id/duplicar`

`liquidar` pone `liquidada` y sube la versión; responde `{ success, message, data }`
con la planilla y las filas completas de conductor (sin `password`), vehículo y
cliente. El body no se lee. Un id inexistente responde 400 con el error de Prisma.

`duplicar` crea una planilla nueva con el mismo conductor, vehículo, empresa,
mes, año, observaciones y días, y el número `<original>-COPIA`. No copia el
servicio, la vía, los riesgos ni el documento. Los días se revaloran con lo
vigente. **201** `{ success, message, data }`.

### `POST /api/recargos/:id/recalcular`

Revalora los días de la planilla con el porcentaje y la configuración salarial
vigentes en la fecha de cada uno. No cambia horas: reemplaza los detalles (los
anteriores quedan retirados) y actualiza totales y versión.

```json
{ "success": true, "message": "Recargo recalculado exitosamente con la config vigente",
  "data": { "planilla": { "id": "uuid", "conductor_id": "uuid", "empresa_id": "uuid", "mes": 9, "a_o": 2026 },
            "breakdown": { "dias": [ { "dia": 1, "recargos": [ { "tipo_codigo": "HED", "porcentaje": 25, "horas": 2, "valor_total": 25000, "…": "…" } ],
                                       "total_valor_dia": 25000, "…": "…" } ],
                           "total_horas": 48, "total_dias": 4, "total_valor": 120000 } },
  "valor_pagar": 120000 }
```

Los detalles que escribe llevan `configuracion_salario_id` nulo, jornadas fijas
de 10 y 7 horas y el tipo activo de cada código, no el de la vigencia del día:
el valor sale bien, pero el rastro no. **400** «Recargo no encontrado» o
«Recargo eliminado».

### `POST /api/recargos/recalcular-bulk` · `GET /api/recargos/recalcular-bulk/:batchId`

`POST` recibe `{ "ids": ["uuid", …] }` (se usan los primeros 500) y responde
enseguida **202** `{ success, message, batchId, total }`. El lote corre en
segundo plano, de tres en tres, con un tope de 60 s por planilla, y avisa por
socket (ver Efectos). La importación desde Transmeralda lanza uno al terminar.

`GET` devuelve `{ success, data: { batchId, status, processed, total, okCount, errCount, results, startedAt, completedAt } }`,
con `status` `running`, `completed` o `failed` y `results` = `[{ id, ok, valor_pagar?, error? }]`.
El estado vive en memoria: se pierde si el proceso se reinicia y se purga una
hora después de terminar. **404** si no existe, se purgó o es de otro usuario.

### `POST /api/recargos/next-numero-planilla` · `GET` temporal

`POST` acepta `{ "reserva_id": "<UUID del formulario>" }` y responde
`{ success: true, data: { numero_planilla: "CM-0124" } }`. La primera llamada
asigna un número bajo advisory lock de PostgreSQL; repetirla con el mismo ID y
usuario conserva su número, salvo que se haya liberado uno anterior en la cola
o que el propio ya se haya guardado. En ese caso toma el primer disponible y
libera el anterior. Un ID de otro usuario devuelve **403**.
El prefijo sale de `PLANILLA_PREFIX` (el ejemplo usa `CM`; el valor por defecto
sigue siendo `TM`). Requiere `recargos:full`; **500** si falla. El GET temporal y
los POST sin ID de clientes antiguos crean una reserva anónima que caduca.

El siguiente se calcula desde el máximo **guardado** más las reservas aún
activas. `DELETE /api/recargos/reservas-planilla/:reservaId` devuelve el número
del formulario a la cola; exige el mismo usuario y es idempotente. La sala
Socket.IO `recargos-planilla` (`recargos-planilla:entrar`, `:renovar`, `:salir`)
libera al desconectarse y mantiene vivas las reservas abiertas. Si falla la
salida, caducan tras 10 minutos sin latidos. Cuando todos cierran, el siguiente
vuelve a ser el del último recargo guardado + 1. La creación rechaza bajo lock
un número ya guardado, incluidos envíos concurrentes.

### `GET /api/recargos/estadisticas/resumen` · `GET /api/recargos/tipos-recargo/activos`

`estadisticas/resumen` acepta `mes`, `año` y `empresa_id` y responde
`{ success, data: { total, por_estado: [{ estado, cantidad }] } }` sobre las
planillas activas. `tipos-recargo/activos` devuelve `{ success, data }` con
todas las filas de `tipos_recargos` con `activo = true`, por código.

### `GET /api/recargos/tipos-recargo/vigentes`

**Query**: `fecha=AAAA-MM-DD`, o `fecha_desde` y `fecha_hasta`. Devuelve todas
las versiones activas que se solapan con la fecha o el rango (para pintar la
línea de tiempo de porcentajes), por código y vigencia descendente.
**400** si no llega ninguna de las dos formas.

### `GET /api/recargos/reporte`

**Query**: `mes` y `anio` (sin eñe aquí). PDF `Reporte_Servicios_<mes>_<anio>.pdf`
con los días trabajados por conductor y placa, solo de conductores de nómina
(`nomina = true`) y planillas activas. Lo dibuja PDFKit. Los parámetros no se
validan; un fallo responde **400** con su mensaje.

### Importar desde Transmeralda

Trae a esta base planillas de la base de Transmeralda, que se lee con un
segundo cliente de Prisma (`src/config/prismaTransmeralda.ts`, variable
`TRANSMERALDA_DATABASE_URL`). Sin la variable, las cinco rutas responden
**503** `{ success: false, message }` sin intentar conectar. El flujo es:
sincronizar conductores (una vez), pedir el preview de un mes, opcionalmente
crear las entidades faltantes, e importar las elegidas.

Reglas:

- El conductor se cruza por `numero_identificacion`. Tiene que existir aquí
  (los conductores no se crean solos, por temas contractuales) y no estar
  `inactivo` **en Transmeralda**; su estado en Cotransmeq no decide.
- La placa y la empresa que falten se crean aquí con los datos de allá (la
  empresa se busca por nombre).
- El número se normaliza: solo dígitos pasa a `TM-<n>`; con `TM-` o con texto
  se deja igual.
- No se importa dos veces: se reconoce por `imported_from_transmeralda_id` (el
  id de la planilla de origen) y, para registros viejos sin ese id, por
  conductor, número, mes y año.
- La planilla importada nace en `pendiente`, sin servicio, con las
  observaciones precedidas de «[Importado de Transmeralda]», la vía, los
  riesgos y los días de origen. Después se recalculan todas en un lote.

**`POST /importar-desde-transmeralda/sincronizar-conductores-cotransmeq`** (sin
body). En la base de **Transmeralda**: pasa a `inactivo` a los conductores
`activo` sin liquidaciones en 2026, y devuelve a `activo` solo a los que sí
tienen y están en `inactivo` (el estado que pone el primer paso). Cualquier
otro estado de allá (`desvinculado`, `retirado`, `vacaciones`, `programado`…)
no se toca. Los borrados (`deleted_at`) no cuentan en ninguno de
los dos pasos.
`{ success, data: { year: 2026, conductores_con_liquidaciones_2026, activos_antes, activos_despues, marcados_inactivos, reactivados } }`.

**`POST|GET /importar-desde-transmeralda/preview`**. Parámetros en el body
(`POST`) o en el query (`GET`):

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `mes` | entero 1–12 | sí | |
| `año` | entero 2000–2100 | sí | Con eñe |
| `incluir_no_importables` | boolean | no | `false` por defecto: solo importables y ya importadas. Con `true`, todas, con su `motivo_no_importable` |

```json
{ "success": true, "data": {
  "mes": 9, "año": 2026, "total": 26, "importables": 20, "ya_importadas": 4, "no_importables": 2,
  "filtradas_por_conductor_inactivo": 6, "vehiculos_a_crear": 1, "empresas_a_crear": 0, "incluir_no_importables": false,
  "planillas": [ { "source_id": "uuid", "conductor_nombre": "…", "conductor_identificacion": "…",
                   "empresa_nombre": "…", "vehiculo_placa": "…", "numero_planilla_original": "7176",
                   "numero_planilla_normalizado": "TM-7176", "numero_planilla": "TM-7176",
                   "dias_count": 6, "dias_lista": [1, 2, 3, 5, 6, 7], "dias_rangos": "1-3, 5-7",
                   "empresa_origen_id": "uuid", "empresa_destino_id": "uuid", "empresa_destino_nombre": "…",
                   "empresa_coincidencia": "nit", "empresa_coincidencia_score": 100,
                   "empresa_sugerencias": [], "empresa_requiere_revision": false,
                   "empresa_nit_en_empresa_eliminada": false,
                   "ya_importado": false, "imported_id": null, "conductor_existe_en_destino": true,
                   "conductor_activo_en_destino": true, "conductor_activo_en_origen": true,
                   "vehiculo_no_existe_en_destino": false, "empresa_no_existe_en_destino": false,
                   "motivo_no_importable": null, "…": "…" } ] } }
```

`conductor_activo_en_destino` conserva el nombre por compatibilidad, pero ya
significa «existe aquí y no está inactivo en Transmeralda».

La empresa destino se resuelve primero por NIT normalizado y luego por nombre
normalizado. Una similitud de nombre **mayor a 80/100** se asigna automáticamente;
si la mejor opción da 80 o menos, el preview devuelve hasta cinco sugerencias con
su score y exige escoger una. Solo se ofrece crear una empresa nueva cuando no
hay coincidencias; en filas ambiguas, “crear como nueva” requiere confirmación
explícita. Si el NIT pertenece a una empresa eliminada en Cotransmeq, no se crea
otra empresa con ese NIT.

**`POST /importar-desde-transmeralda/crear-entidades-faltantes`**. Body
`{ mes, año }`. Crea las placas (en `disponible`) y empresas que el preview
completo marca como faltantes; no importa planillas.
`{ success, data: { vehiculos_creados, empresas_creadas, errores: [{ tipo, origen_id, error }] } }`.

**`POST /importar-desde-transmeralda`**. Body de 1 a 200 `source_ids`, más la
resolución de empresa opcional que presenta el preview:

```json
{
  "source_ids": [
    "11111111-1111-4111-8111-111111111111",
    "33333333-3333-4333-8333-333333333333"
  ],
  "empresa_destino_por_planilla": {
    "11111111-1111-4111-8111-111111111111": "22222222-2222-4222-8222-222222222222"
  },
  "empresas_confirmadas_nuevas": ["33333333-3333-4333-8333-333333333333"]
}
```

`empresa_destino_por_planilla` asigna una sugerencia activa para la planilla;
`empresas_confirmadas_nuevas` confirma crear una empresa cuando existen opciones
ambiguas. Ambos campos son opcionales si la resolución fue automática o el
preview determinó que no hay coincidencias.

```json
{ "success": true, "message": "Importación completada: 20 importadas, 4 omitidas, 0 con error",
  "recalculoBatchId": "uuid",
  "data": { "solicitadas": 24, "importadas": 20, "omitidas": 4, "errores": 0, "vehiculos_creados": 1, "empresas_creadas": 0,
            "recalculoBatchId": "uuid",
            "detalle": { "importadas": [ { "source_id": "uuid", "new_id": "uuid", "numero_planilla": "TM-7176" } ],
                         "omitidas": [ { "source_id": "uuid", "motivo": "Ya importada (recargo_id=…)" } ],
                         "errores": [ { "source_id": "uuid", "error": "…" } ] } } }
```

`recalculoBatchId` es el lote de recálculo que se puede seguir con
`GET /recalcular-bulk/:batchId` (nulo si no se importó nada).

**Errores**: **503** sin `TRANSMERALDA_DATABASE_URL`; **400**
`{ success: false, message: 'Error de validación', errors }` con lo que rechaza
zod; **400** `{ success: false, message }` con otros fallos (por ejemplo,
«Ninguna de las planillas solicitadas existe en Transmeralda»).

### Configuraciones salariales

Una fila de `configuraciones_salarios` fija, para una empresa (o para todas si
`empresa_id` es nulo) y un intervalo de vigencia, el salario, el valor hora, las
horas mensuales base y los umbrales de jornada.

| Ruta | Qué hace |
|---|---|
| `GET /configuraciones-salarios` | Query `activo` (`'true'`/`'false'`) y `empresa_id`. `{ success, data }` con las no eliminadas, cada una con `clientes` y el usuario que la creó (`usuarios`); activas primero |
| `GET /configuraciones-salarios/:id` | `{ success, data }`; **404** `{ success: false, message: 'Configuración no encontrada' }` si no existe o está eliminada |
| `GET /configuraciones-salarios/vigentes` | Query `fecha` (`AAAA-MM-DD`, obligatoria; **400** sin ella) y `empresa_id`. `{ success, data }` con la vigente de esa empresa, o la base, o `null` |
| `POST /configuraciones-salarios` | **201** `{ success, message, data }` |
| `PUT /configuraciones-salarios/:id` | Solo lo que llega; **404** si no existe o está eliminada |
| `DELETE /configuraciones-salarios/:id` | Marca `deleted_at` y `activo = false`; **404** igual |
| `GET /empresas-disponibles` | `{ success, data: [{ id, nombre, nit, oculto }] }` con los clientes no eliminados |

**Body del alta** (sin validación: se pasa a Prisma tal cual)

| Campo | Tipo | Obligatorio | Por defecto |
|---|---|---|---|
| `salario_basico`, `valor_hora_trabajador` | number | sí | — |
| `vigencia_desde` | fecha | sí | — |
| `vigencia_hasta` | fecha \| `null` | no | `null` (sin fin) |
| `empresa_id` | uuid \| `null` | no | `null` (base) |
| `horas_mensuales_base` | entero | no | `240` |
| `jornada_normal_horas`, `jornada_festiva_horas` | number | no | `10.33`, `7.33` |
| `paga_dias_festivos` | boolean | no | `false` |
| `porcentaje_festivos` | number | no | `75` |
| `seguridad_social`, `administracion`, `prueba_antigeno_covid`, `prestaciones_sociales` | number | no | `0` |
| `activo` | boolean | no | `true` |
| `observaciones`, `sede` | string | no | `null` |

Los errores de estas rutas son **500** `{ success: false, message }` con el
mensaje de Prisma.

## Efectos

- **Socket.IO** (ver [tiempo-real](../tiempo-real.md)). Las escrituras REST
  avisan a todos los conectados con `avisarRecargos()`
  (`recargos.controller.ts`, también usado por `recargos.routes.ts`): `getIo()`
  dentro de un `try/catch` (un aviso que no sale no deshace la operación) y el
  payload pasado por `sinCredenciales`.

  | Evento | Lo emite | Payload |
  |---|---|---|
  | `recargo-creado` | `POST /` | `{ recargoId, valor_pagar }` |
  | `recargo-actualizado` | `PUT /:id` | `{ recargoId, valor_pagar }` |
  | `recargo-eliminado` / `recargo-restaurado` | `DELETE /:id` / `PATCH /restaurar/:id` | `{ recargoId }` |
  | `recargos-eliminados` / `recargos-restaurados` | `POST /eliminar-multiple` / `POST /restaurar-multiple` | `{ recargoIds, cantidad }` |
  | `recargos-estado-actualizado` | `PATCH /cambiar-estado-multiple` | `{ recargoIds, estado, cantidad }` |
  | `recargo-recalculado` | `POST /:id/recalcular` | `{ recargoId, conductorId, empresaId, mes, año, recargo, valor_pagar, timestamp }` |
  | `recargos-importados-transmeralda` | `POST /importar-desde-transmeralda` | `{ importadas, omitidas, errores }` |
  | `config-salario-creada` / `config-salario-actualizada` / `config-salario-eliminada` | `POST`, `PUT` y `DELETE` de `/configuraciones-salarios` | `{ configId, config }` / `{ configId }` |

  El recálculo en lote (`recargos.service.ts`) avisa al room `user-<id>` de
  quien lo lanzó: `recargos-bulk-recalc:progress`
  (`{ batchId, processed, total, currentId, ok, valor_pagar, error, elapsedMs }`),
  `recargos-bulk-recalc:done` (`{ batchId, status, processed, total, okCount, errCount, results, timestamp }`)
  y `recargo-recalculado` por cada planilla. Si el room está vacío, el progreso
  se emite a todos con `targetUserId` para que el cliente filtre.
- **Base de Transmeralda**: `sincronizar-conductores-cotransmeq` escribe el
  estado de sus conductores; el resto de la importación solo la lee.
- **Altas en esta base** por la importación: vehículos, empresas y planillas.
- **Servicios**: alta y edición pueden crear o actualizar el servicio vinculado;
  el cron `cerrar-servicios-con-planilla` cierra los servicios con planilla
  numerada (ver [servicios](./servicios.md)).

## Observaciones

- **Escritura en la base de la otra empresa.** Con `recargos:full` de aquí,
  `sincronizar-conductores-cotransmeq` hace dos `updateMany` sobre los
  conductores de Transmeralda: pasa a `inactivo` a los `activo` sin
  liquidaciones en 2026 y reactiva a los `inactivo` que sí las tienen
  (`recargosImportarTransmeralda.service.ts`).
- `incluir_no_importables` usa `z.coerce.boolean()`: en el query, `false` llega
  como texto y se convierte en `true`.
- El cliente de Transmeralda se genera con el esquema de este repo: una columna
  que solo exista aquí rompe la lectura allá (por eso se omiten
  `imported_from_transmeralda_*` al leer `recargos_planillas`).
- La empresa se busca por nombre: si aquí existe con otro nombre y el mismo
  NIT (o el NIT está en la papelera), crearla choca con la unicidad del NIT y
  la planilla sale en `errores`.
- **Restaurar revive versiones viejas.** `restored` y `restoredMany` quitan la
  marca a todos los días y detalles retirados de la planilla, también a los que
  retiró una edición anterior. Si coinciden en día con los vigentes, el índice
  único parcial lo rechaza y la restauración responde 400 con el error de
  Prisma.
- **Datos de más.** `GET /:id` (solo sesión) y `POST /:id/liquidar` devuelven la
  fila completa del conductor, sin `password` pero con `salario_base`, EPS,
  fecha de nacimiento y dirección.
- Cuando el room del usuario está vacío, el progreso del lote (ids, valores,
  errores) se emite a todos los conectados.
- `PUT` y `liquidar` no miran `deleted_at`: se puede editar o liquidar una
  planilla que está en la papelera.
- `cambiar-estado-multiple` acepta estados (`borrador`, `activo`, `completado`,
  `liquidado`, `cancelado`) que el `PUT` no admite.
- `tipos-recargo/activos` no filtra `deleted_at` ni vigencia: devuelve todas
  las versiones de cada código.
- Con `eliminados=true`, `meta.total_valor_pagar` sale siempre en 0 (la suma
  filtra detalles no retirados).
- `reporte` arma el nombre del archivo con el query sin validar.
- El body de las configuraciones salariales no se valida: un campo obligatorio
  que falta o un tipo equivocado sale como 500 con el texto de Prisma.

## Diferencias con Transmeralda

- **Rutas.** Solo aquí: las cinco de `importar-desde-transmeralda`. Solo en
  Transmeralda: `GET /api/recargos/:id/historial` (historial de cambios con
  quién, IP, versión y antes/después) y `POST /api/recargos/planilla/upload`
  (documento de la planilla en S3).
- **`planilla_s3key` y `motivo`**: Transmeralda los acepta en las escrituras
  (el documento y el motivo que va al historial); aquí se descartan.
- **Días repetidos**: Transmeralda los rechaza con un 400 legible antes de
  tocar la base.
- **Listado**: el filtro y los campos `imported_from_transmeralda*` solo
  existen aquí.
- **Reporte**: Transmeralda valida `mes` y `anio` (400) y lo pinta Chromium con
  el nombre de quien lo generó.
- **Cálculo**: Transmeralda paga `RNDF` completo (valor hora × (1 + %)); al
  recalcular mira los días del conductor en otras planillas del mes; guarda
  `configuracion_salario_id` y las jornadas vigentes en cada detalle, y su
  `breakdown` trae además `configuracion_salario_id`, `jornada_*` y
  `tipo_recargo_id`. El mismo mes puede dar valores distintos en las dos
  empresas.
- **Restaurar**: Transmeralda revive solo lo que se retiró en la misma
  eliminación.
