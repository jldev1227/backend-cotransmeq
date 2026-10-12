# Mantenimiento de flota

`/api/mantenimiento` · código en [`src/modules/mantenimiento/`](../../src/modules/mantenimiento/) · permiso [`mantenimiento`](../permisos.md#catálogo-de-módulos)

Planes de mantenimiento preventivo por vehículo (`vehicle_maintenance_plan`) y
órdenes de trabajo, OT (`vehicle_maintenance_event`), con sus soportes
(`vehicle_maintenance_attachment`). Son tablas que nacieron con el PESV y estaban
vacías; nada de esto toca `mantenimientos`, que es un concepto de nómina. El
catálogo de categorías vive solo en `catalogo.ts` y llega al cliente por
`GET /api/mantenimiento/opciones`: `CAMBIO_ACEITE`, `FILTROS`, `FRENOS`, `LLANTAS`,
`ALINEACION_BALANCEO`, `SINCRONIZACION`, `REVISION_GENERAL` y `OTRO`, con
sugerencias de km y meses que solo prellenan el formulario.

**Plan.** Dice cada cuánto (kilómetros, meses o ambos; al menos uno) y cuál fue la
última ejecución (km y fecha). De ahí salen el próximo km y la próxima fecha, cada
eje por su cuenta: sin último km no hay próximo km y sin última fecha no hay próxima
fecha (inventar una base escondería un plan que nunca se ha hecho). Los meses son de
calendario y se recortan al último día del mes (31-ago + 3 meses = 30-nov).

**El estado del plan no se guarda**: se calcula al leer (`evaluarPlan` en
`calculo.ts`) con el kilometraje de la ficha del vehículo —que mueve cada hora el
cron de preoperacionales; 0 o vacío es «no se sabe»— y la fecha de hoy en Bogotá:

| Estado | Cuándo |
|---|---|
| `vencido` | Km restantes ≤ 0 (a los 10.000 km ya toca) o la fecha ya pasó (el mismo día todavía es a tiempo) |
| `proximo` | Faltan 500 km o menos, o 15 días o menos (lo que llegue primero) |
| `al_dia` | Hay datos y no está en los anteriores |
| `sin_datos` | No hay ni próximo km medible ni próxima fecha |
| `pausado` | `activo = false`; no avisa |

`motivo` dice qué eje puso el estado (`km`, `fecha` o `ambos`).

**Orden de trabajo.** `PREVENTIVO` (ligada a un plan, del que hereda el vehículo; un
plan no puede tener dos OT abiertas) o `CORRECTIVO` (ligada a un vehículo). Ciclo:
`PROGRAMADO` → `EN_CURSO` → `EJECUTADO`, o `CANCELADO` (con motivo) desde
cualquiera de los dos primeros; cerrar y anular son terminales. Los costos los
calcula el servidor: `costo_repuestos` (Σ cantidad × valor unitario),
`costo_mano_obra` y `costo` (la suma), redondeados a centavos; el cliente no manda
totales. **Cerrar una preventiva mueve su plan** (última ejecución = la de la OT y
nuevo próximo) en la misma transacción, salvo que la OT sea más vieja que la última
ejecución registrada. Los cambios de estado usan un `updateMany` condicionado al
estado previo: si dos personas cierran la misma OT, la segunda recibe 409.
`consecutivo` es el número visible de la OT («OT 12»).

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `mantenimiento:read` (administración y mantenimiento `full`; operaciones y HSEQ `read`) |
| `POST`, `PATCH`, `DELETE` | `mantenimiento:full` (administración y mantenimiento) |
| Rutas con `:id` o `:adjuntoId` | hook `preValidation`: un UUID mal formado responde 400 `{ success: false, message: 'Identificador inválido' }` antes de mirar el permiso |

`GET /api/mantenimiento/preoperacionales/:id` sirve datos de un envío de
formulario con solo `mantenimiento:read`, a propósito: quien repara no tiene por
qué tener el módulo `formularios`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/mantenimiento/opciones` | `mantenimiento:read` | Catálogo, umbrales y vehículos elegibles |
| GET | `/api/mantenimiento/resumen` | `mantenimiento:read` | Cifras de la cabecera |
| GET | `/api/mantenimiento/planes` | `mantenimiento:read` | Planes evaluados, filtrados y paginados |
| GET | `/api/mantenimiento/planes/:id` | `mantenimiento:read` | Un plan con sus últimas 50 OT |
| POST | `/api/mantenimiento/planes` | `mantenimiento:full` | Aplica un plan a uno o varios vehículos |
| PATCH | `/api/mantenimiento/planes/:id` | `mantenimiento:full` | Edita un plan y recalcula el próximo |
| DELETE | `/api/mantenimiento/planes/:id` | `mantenimiento:full` | Borrado lógico (no con una OT abierta) |
| GET | `/api/mantenimiento/ordenes` | `mantenimiento:read` | OT filtradas y paginadas |
| GET | `/api/mantenimiento/ordenes/:id` | `mantenimiento:read` | Una OT con el detalle de sus adjuntos |
| POST | `/api/mantenimiento/ordenes` | `mantenimiento:full` | Abre una OT |
| PATCH | `/api/mantenimiento/ordenes/:id` | `mantenimiento:full` | Corrige una OT |
| POST | `/api/mantenimiento/ordenes/:id/estado` | `mantenimiento:full` | Inicia, cierra o anula una OT |
| POST | `/api/mantenimiento/ordenes/:id/adjuntos` | `mantenimiento:full` | Sube una factura, foto u otro soporte |
| GET | `/api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId/url` | `mantenimiento:read` | URL firmada de 15 minutos |
| DELETE | `/api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId` | `mantenimiento:full` | Retira un adjunto (lógico) |
| GET | `/api/mantenimiento/preoperacionales/:id` | `mantenimiento:read` | Ítems en «Malo» de un preoperacional |
| GET | `/api/mantenimiento/vehiculos/:id` | `mantenimiento:read` | Pestaña «Mantenimiento» de la ficha del vehículo |
| GET | `/api/mantenimiento/costos` | `mantenimiento:read` | Costo por vehículo y por mes |

Las respuestas correctas van en `{ success: true, data }` (los `DELETE`, solo
`{ success: true }`). Los errores (`responderError` en `mantenimiento.routes.ts`):

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `:id`/`:adjuntoId` mal formado | `{ "success": false, "message": "Identificador inválido" }` |
| 422 | Rechazo de zod (query o body) | `{ "success": false, "message": "<primer error>", "details": ["campo: mensaje", "…"] }` |
| 400 / 404 / 409 / 422 | Error de dominio (`MantenimientoError`) | `{ "success": false, "message": "…", "code": "…" }` |
| 500 | Cualquier otro fallo (va al log) | `{ "success": false, "message": "<mensaje fijo de la ruta>" }` |

Códigos de dominio: `NO_ENCONTRADO` (404), `VEHICULO_INVALIDO` (400),
`SIN_PERIODICIDAD` (422), `PLAN_CON_ORDEN_ABIERTA` (409), `ORDEN_ABIERTA_EXISTE`
(409), `ORDEN_ANULADA` (409), `TRANSICION_INVALIDA` (409), `ORDEN_CAMBIO` (409),
`FECHA_FUTURA` (422), `FALTA_KM` (422), `RANGO_INVALIDO` (422).

En los bodies, un `''` cuenta como `null` y los números pueden llegar como texto
(`mantenimiento.schema.ts`).

### Forma de un plan y de una OT

**Plan** (`serializarPlan`):

```json
{ "id": "uuid", "vehiculo": { "id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…" },
  "categoria": "CAMBIO_ACEITE", "categoria_etiqueta": "Cambio de aceite", "nombre": "Aceite motor",
  "periodicidad_km": 5000, "periodicidad_meses": 3, "periodicidad_dias": null,
  "ultima_ejecucion_fecha": "2026-08-31", "ultima_ejecucion_km": 120000, "ultimo_evento_id": "uuid",
  "proxima_fecha": "2026-11-30", "proximo_km": 125000, "km_actual": 124700,
  "activo": true, "observaciones": null,
  "orden_abierta": { "id": "uuid", "consecutivo": 12, "estado": "PROGRAMADO" },
  "estado": "proximo", "km_restantes": 300, "dias_restantes": 50, "motivo": "km" }
```

`periodicidad_dias` es una columna heredada del PESV: la pantalla solo escribe
meses, y si vienen los dos mandan los meses.

**OT** (`serializarOrden`):

```json
{ "id": "uuid", "consecutivo": 12, "tipo": "PREVENTIVO", "estado": "EJECUTADO", "descripcion": "…",
  "vehiculo": { "id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…", "km_actual": 124700 },
  "plan": { "id": "uuid", "nombre": "…", "categoria": "CAMBIO_ACEITE", "categoria_etiqueta": "…", "eliminado": false },
  "fecha": "2026-10-01", "km": 125000, "fecha_ejecucion": "2026-10-02", "km_ejecucion": 125100,
  "taller": "…", "responsable": "…", "numero_factura": "…",
  "repuestos": [ { "descripcion": "Filtro", "cantidad": 1, "valor_unitario": 45000 } ],
  "costo_repuestos": 45000, "costo_mano_obra": 30000, "costo": 75000,
  "observaciones": null, "motivo_anulacion": null,
  "iniciado_at": "…", "cerrado_at": "…", "anulado_at": null, "creado_at": "…",
  "creado_por": "Nombre", "cerrado_por": "Nombre", "adjuntos": 2 }
```

`fecha` y `km` son los programados; `plan` es `null` en las correctivas; los costos
salen como número.

### `GET /api/mantenimiento/opciones`

**Respuesta 200** — `data`:
`{ hoy, categorias: [{ clave, etiqueta, sugerenciaKm, sugerenciaMeses }], umbrales: { km: 500, dias: 15 }, vehiculos: [{ id, placa, marca, linea, kilometraje, estado }] }`.
Vehículos no eliminados ni ocultos, por placa; `kilometraje` es `null` si la ficha
tiene 0.

### `GET /api/mantenimiento/resumen`

**Respuesta 200** — `data`:
`{ hoy, planes: { vencido, proximo, al_dia, sin_datos, pausado, total }, ordenes: { abiertas, programadas, en_curso }, costo_mes: { mes: "YYYY-MM", total, ordenes } }`.
Los planes son los de vehículos no eliminados ni ocultos; el costo del mes suma las
OT `EJECUTADO` con fecha de ejecución en el mes en curso.

### `GET /api/mantenimiento/planes`

**Query** (`listarPlanesSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string ≤ 120 | — | Todas las palabras, sin tildes, en placa, marca, línea, nombre o categoría |
| `estado` | enum | `todos` | `todos`, `vencido`, `proximo`, `al_dia`, `sin_datos`, `pausado`, `alerta` (= vencido + próximo) |
| `categoria` | clave del catálogo | — | |
| `vehiculo_id` | uuid | — | |
| `page` | entero ≥ 1 | `1` | |
| `limit` | 1–500 | `50` | |

**Respuesta 200** — `data: { items: [plan], total, page, limit, conteos }`.
`conteos` (`{ vencido, proximo, al_dia, sin_datos, pausado, total }`) se calcula
sobre la búsqueda sin el filtro de estado, para que las pastillas digan cuántos hay
de cada uno. Orden: urgencia (estado y, dentro de él, cercanía relativa a su umbral)
y luego placa. Solo planes vivos de vehículos no eliminados ni ocultos; se evalúa la
flota entera en memoria porque el estado no es una columna.

### `GET /api/mantenimiento/planes/:id`

**Respuesta 200** — `data`: el plan más `ordenes: [OT]` (sus últimas 50, por
consecutivo descendente). 404 `NO_ENCONTRADO` si el plan está borrado o su vehículo
está en la papelera.

### `POST /api/mantenimiento/planes`

Aplica un plan a uno o varios vehículos: una fila por vehículo, cada una con su
propio punto de partida (cada vehículo tiene su odómetro).

**Body** (`crearPlanSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `categoria` | clave del catálogo | sí | |
| `nombre` | string 2–255 | sí | |
| `periodicidad_km` | entero 1–500.000 | uno de los dos | |
| `periodicidad_meses` | entero 1–120 | uno de los dos | Sin ninguno → 422 |
| `observaciones` | string ≤ 2000 | no | |
| `vehiculos` | arreglo (1–500) | sí | `{ vehiculo_id, ultima_ejecucion_km?, ultima_ejecucion_fecha? }`; km entero 0–3.000.000, fecha `YYYY-MM-DD` |

Todos los vehículos tienen que existir y no estar en la papelera (si falla uno, 400
`VEHICULO_INVALIDO` y no se crea nada). Los que ya tienen un plan vivo con la misma
categoría y el mismo nombre (sin distinguir mayúsculas) se omiten y se informan:
volver a aplicar el «plan de aceite» a toda la flota no lo duplica.

**Respuesta 201** — `data: { creados, ids, omitidos: [{ vehiculo_id, placa, motivo: "Ya tiene este plan" }] }`.

### `PATCH /api/mantenimiento/planes/:id`

**Body** (`actualizarPlanSchema`, todo opcional): `categoria`, `nombre`,
`periodicidad_km`, `periodicidad_meses`, `observaciones`, `ultima_ejecucion_km`,
`ultima_ejecucion_fecha`, `activo` (boolean; `false` = pausado). Ausente = se
conserva; `null` = se vacía.

Recalcula el próximo km y la próxima fecha. Si se corrige a mano el último km o la
última fecha, el plan deja de apoyarse en la OT que lo había dejado así
(`ultimo_evento_id = null`).

**Respuesta 200** — `data`: el plan como en `GET /api/mantenimiento/planes/:id`.
**Errores**: 404 `NO_ENCONTRADO`; 422 `SIN_PERIODICIDAD` si queda sin kilómetros ni
meses.

### `DELETE /api/mantenimiento/planes/:id`

Borrado lógico. Responde `{ success: true }`. 409 `PLAN_CON_ORDEN_ABIERTA` (con el
número de la OT en el mensaje) si tiene una OT `PROGRAMADO` o `EN_CURSO`: quedaría
huérfana a medio trabajo. Las OT cerradas siguen apuntando al plan
(`plan.eliminado: true`). 404 `NO_ENCONTRADO`.

### `GET /api/mantenimiento/ordenes`

**Query** (`listarOrdenesSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string ≤ 120 | — | Descripción, taller, factura, placa (sin espacios ni guiones), nombre del plan o número de OT (`12` u `OT 12`) |
| `estado` | enum | `todas` | `todas`, `abiertas` (= `PROGRAMADO` + `EN_CURSO`), `PROGRAMADO`, `EN_CURSO`, `EJECUTADO`, `CANCELADO` |
| `tipo` | enum | `todos` | `todos`, `PREVENTIVO`, `CORRECTIVO` |
| `vehiculo_id`, `plan_id` | uuid | — | |
| `desde`, `hasta` | `YYYY-MM-DD` | — | Fecha de ejecución si está cerrada; si no, la programada |
| `page` | entero ≥ 1 | `1` | |
| `limit` | 1–200 | `20` | |

**Respuesta 200** — `data: { items: [OT], total, page, limit, conteos: { PROGRAMADO, EN_CURSO, EJECUTADO, CANCELADO } }`,
por consecutivo descendente. `conteos` ignora el filtro de estado. Deja fuera las OT
de vehículos en la papelera.

### `GET /api/mantenimiento/ordenes/:id`

**Respuesta 200** — `data`: la OT más
`adjuntos_detalle: [{ id, tipo, nombre, mimetype, size, created_at }]`. 404
`NO_ENCONTRADO`.

### `POST /api/mantenimiento/ordenes`

**Body** (`crearOrdenSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `PREVENTIVO` \| `CORRECTIVO` | sí | |
| `plan_id` | uuid | si es `PREVENTIVO` | En una correctiva se ignora |
| `vehiculo_id` | uuid | si es `CORRECTIVO` | En una preventiva se ignora: manda el vehículo del plan |
| `descripcion` | string 3–4000 | sí | |
| `fecha` | `YYYY-MM-DD` | no | Fecha programada; hoy por defecto |
| `km` | entero 0–3.000.000 | no | Km programado |
| `taller`, `responsable` | string ≤ 255 | no | |
| `numero_factura` | string ≤ 60 | no | |
| `repuestos` | arreglo ≤ 200 | no | `{ descripcion (1–255), cantidad (> 0, por defecto 1), valor_unitario (≥ 0) }` |
| `costo_mano_obra` | número ≥ 0 | no | |
| `observaciones` | string ≤ 4000 | no | |

La OT nace en `PROGRAMADO`. Además del detalle de repuestos (`repuestos_detalle`),
guarda un resumen en texto en la columna heredada `repuestos`.

**Respuesta 201** — `data`: la OT como en `GET /api/mantenimiento/ordenes/:id`.

**Errores**: 422 si falta el plan de una preventiva o el vehículo de una correctiva;
404 `NO_ENCONTRADO` si el plan no existe, está borrado o su vehículo está en la
papelera; 409 `ORDEN_ABIERTA_EXISTE` si el plan ya tiene una OT abierta (casi
siempre un doble clic); 400 `VEHICULO_INVALIDO` si el vehículo de la correctiva no
existe o está en la papelera.

### `PATCH /api/mantenimiento/ordenes/:id`

**Body** (`actualizarOrdenSchema`, todo opcional): `descripcion`, `fecha`, `km`,
`taller`, `responsable`, `numero_factura`, `repuestos`, `costo_mano_obra`,
`observaciones`. `repuestos`, si llega, reemplaza la lista entera. Los totales se
recalculan siempre.

Abierta o en curso se edita todo. **Cerrada**, solo lo que suele llegar después
(taller, responsable, factura, repuestos, mano de obra y observaciones):
`descripcion`, `fecha` y `km` se ignoran sin error, porque la fecha y el km de
ejecución ya movieron el plan.

**Respuesta 200** — `data`: la OT. **Errores**: 404 `NO_ENCONTRADO`; 409
`ORDEN_ANULADA`.

### `POST /api/mantenimiento/ordenes/:id/estado`

**Body** (`cambiarEstadoOrdenSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | `EN_CURSO` \| `EJECUTADO` \| `CANCELADO` | sí | |
| `fecha_ejecucion` | `YYYY-MM-DD` | no | Al cerrar; por defecto la programada o, si no hay, hoy |
| `km_ejecucion` | entero 0–3.000.000 | no | Al cerrar; por defecto el programado |
| `motivo` | string ≤ 1000 | si es `CANCELADO` | Sin él → 422 |

- `EN_CURSO`: marca `iniciado_at`.
- `CANCELADO`: marca `anulado_at` y guarda `motivo_anulacion`.
- `EJECUTADO`: guarda fecha y km de ejecución, `cerrado_at` y quién cerró (y
  `iniciado_at` si venía de `PROGRAMADO`). Si es preventiva y la fecha no es anterior
  a la última del plan, el plan pasa a apoyarse en esta OT y recalcula el próximo.

**Respuesta 200** — `data`: la OT.

**Errores**: 404 `NO_ENCONTRADO`; 409 `TRANSICION_INVALIDA` (p. ej. cerrar una
anulada); 409 `ORDEN_CAMBIO` si otra persona la cambió entre la lectura y la
escritura; 422 `FECHA_FUTURA` (fecha de cierre posterior a hoy); 422 `FALTA_KM`
(preventiva cuyo plan cuenta por kilómetros, sin km).

### `POST /api/mantenimiento/ordenes/:id/adjuntos`

**Body** `multipart/form-data`. El comentario de la ruta pide `tipo` antes del
archivo; el controlador lee todas las partes antes de procesar.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `FACTURA` \| `FOTO` \| `OTRO` | no | Cualquier otro valor (o ninguno) queda `OTRO` |
| `archivo` | PDF, PNG, JPG, WEBP, HEIC o HEIF | sí | Máx. 15 MB. Se toma cualquier parte de tipo archivo; si llegan varias, queda la última |

Sube a S3 en `vehiculos/<vehiculo_id>/mantenimiento/<orden_id>/<adjunto_id><ext>`:
la hoja de vida completa de una placa queda bajo un solo prefijo.

**Respuesta 201** — `data: { id, tipo, nombre, mimetype, size, created_at }`.

**Errores**: 400 `Solo PDF o imagen` / `Falta el archivo`; 413
`El archivo supera 15 MB`; 404 `NO_ENCONTRADO`; 409 `ORDEN_ANULADA`; 500 si el
cuerpo no es multipart.

### `GET /api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId/url`, `DELETE /api/mantenimiento/ordenes/:id/adjuntos/:adjuntoId`

- `GET …/url`: `data: { url }`, firmada por 15 minutos. 404 `NO_ENCONTRADO` si el
  adjunto no existe, está retirado, es de otra OT o la OT está borrada.
- `DELETE`: borrado lógico; el objeto de S3 se conserva. Responde
  `{ success: true }`; 404 `NO_ENCONTRADO`.

### `GET /api/mantenimiento/preoperacionales/:id`

`:id` es el envío (`form_submission`) de un preoperacional (`HSEQ-FR-08` o
`HSEQ-FR-09`) entregado (`SUBMITTED`) y sin borrar. Es a donde lleva el aviso de
«ítems en Malo» (ver Efectos).

**Respuesta 200**

```json
{ "success": true, "data": {
  "id": "uuid", "formulario": "Preoperacional livianos", "codigo": "HSEQ-FR-08", "fecha": "2026-10-11",
  "enviado_at": "…", "conductor": "NOMBRE APELLIDO",
  "vehiculo": { "id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…", "km_actual": 124700 },
  "items": [ { "key": "frenos", "label": "Frenos", "observacion": "Chillan al frenar" } ] } }
```

`items` son los campos con la opción `M` («Malo»); `label` va sin la ayuda entre
paréntesis y `observacion` sale del campo `<clave>_obs` si lo hay. `conductor` es el
nombre del conductor o, si lo envió un usuario del equipo, el del usuario.

**Errores**: 404 `{ success: false, message: 'Preoperacional no encontrado', code: 'NO_ENCONTRADO' }`
si no existe, no está entregado o no es un preoperacional.

### `GET /api/mantenimiento/vehiculos/:id`

Pestaña «Mantenimiento» de la ficha del vehículo.

**Respuesta 200** — `data`:
`{ vehiculo: { id, placa, km_actual }, planes: [plan], conteos, ordenes: [OT], costos: { historico, ultimos_12_meses, anio_actual } }`.
`planes` va por urgencia (incluye los pausados); `ordenes` son las 30 más
recientes; cada costo es `{ total, ordenes }` sobre las OT `EJECUTADO` por su fecha
de ejecución. 404 `NO_ENCONTRADO` si el vehículo no existe o está en la papelera
(un vehículo oculto sí responde).

### `GET /api/mantenimiento/costos`

Costo de las OT **cerradas** en el periodo, por su fecha de ejecución.

**Query** (`costosSchema`): `desde` (`YYYY-MM-DD`, por defecto el 1 de enero del
año en curso), `hasta` (por defecto hoy), `vehiculo_id`.

**Respuesta 200** — `data`:

```json
{ "desde": "2026-01-01", "hasta": "2026-10-11",
  "totales": { "total": 0, "repuestos": 0, "mano_obra": 0, "ordenes": 0, "preventivo": 0, "correctivo": 0 },
  "por_vehiculo": [ { "vehiculo_id": "uuid", "placa": "ABC123", "marca": "…", "linea": "…", "ordenes": 3,
                      "preventivas": 2, "correctivas": 1, "repuestos": 0, "mano_obra": 0, "total": 0 } ],
  "por_mes": [ { "mes": "2026-09", "ordenes": 3, "preventivo": 0, "correctivo": 0, "total": 0 } ] }
```

`por_vehiculo` va del más costoso al menos; deja fuera vehículos en la papelera.
**Errores**: 422 `RANGO_INVALIDO` si `desde` es posterior a `hasta`.

## Efectos

- **S3** (ver [integraciones](../integraciones.md)): adjuntos bajo
  `vehiculos/<vehiculo_id>/mantenimiento/`; retirar un adjunto no borra el objeto.
- **Cron `mantenimiento-planes`** (`src/jobs/mantenimiento-planes.cron.ts`, todos los
  días a las 7:15 de Bogotá): evalúa los planes activos y avisa de los que están en
  `vencido` o `proximo` a las áreas `mantenimiento` y `administracion`, una vez por
  plan y por estado. La huella (`mant:<estado>:<proximo_km>:<proxima_fecha>` en
  `notificacion.referencia_tipo`) lleva el punto de vencimiento: cuando una OT cierra
  el plan y el próximo cambia, el ciclo de avisos empieza de cero. Ver
  [tareas programadas](../tareas-programadas.md).
- **Aviso de preoperacional con ítems en «Malo»** (`aviso-preoperacional.ts`): no es
  una ruta de este módulo; lo disparan las entregas de formularios
  (`formularios-portal.routes.ts` y `formularios-mis.routes.ts`, ver
  [formularios-dinamicos](./formularios-dinamicos.md)). Notifica al área
  `mantenimiento` una vez por envío (`referencia_tipo = 'preop_malo'`); el aviso abre
  `GET /api/mantenimiento/preoperacionales/:id`. Solo avisa: no bloquea el servicio
  ni el vehículo, y nunca tumba el envío.
- **Kilometraje**: el estado de los planes depende de `vehiculos.kilometraje`, que
  escribe cada hora el cron `sincronizar-kilometraje` (ver [vehiculos](./vehiculos.md)).
- **Registro de actividad**: hook global de [actividad](./actividad.md).

## Observaciones

- `PATCH /api/mantenimiento/planes/:id` no mira el vehículo: si está en la
  papelera, el cambio se guarda y la respuesta es 404 (la relectura con
  `detallePlan` sí lo filtra) (`mantenimiento.service.ts`).
- `PATCH /api/mantenimiento/ordenes/:id` sobre una OT cerrada ignora en silencio
  `descripcion`, `fecha` y `km` y responde 200.
- `DELETE …/adjuntos/:adjuntoId` no mira el estado de la OT: a una OT cerrada o
  anulada se le puede retirar la factura.
- Un cuerpo que no es multipart en `POST …/adjuntos` responde 500 genérico (el error
  del plugin no es de zod ni de dominio).
- Aquí un rechazo de zod es 422; en la mayoría de los módulos es 400.
