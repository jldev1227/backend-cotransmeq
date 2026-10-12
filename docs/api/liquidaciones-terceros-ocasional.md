# Liquidación ocasional de terceros

`/api/liquidaciones-terceros-ocasional` · código en [`src/modules/liquidaciones-terceros-ocasional/`](../../src/modules/liquidaciones-terceros-ocasional/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

La liquidación ocasional (`liquidacion_tercero_ocasional`, consecutivo
`LOC-<mes>-<año>-<seq>`) es el documento de un **mes** con las filas de
terceros que **no** entraron en un cierre de placa: lo que se liquida por fuera
del cierre mensual. Hay como mucho una cabecera viva por periodo
(`@@unique([mes, anio])`) y es el libro anual del canvas «ocasional» (una hoja
por mes). Sus filas son copias desnormalizadas de `liquidacion_tercero`
(`liquidacion_tercero_ocasional_item`, que guarda el `liquidacion_tercero_id`
de origen), más adicionales y conceptos propios (gastos operativos, impuestos y
anticipos; `placa_aplicada` los ata a una placa). Ver
[liquidaciones de terceros](./liquidaciones-terceros.md) para el reparto del
dominio.

La regla del módulo es que un ítem no se pague dos veces: los candidatos son
filas vivas del periodo cuya **placa no tiene cierre final** en ese mes, y un
ítem no puede estar en otro ocasional vivo. Un ítem de una placa con cierre
solo entra trasladado desde el cierre (`POST /liquidaciones-terceros/items/:pivoteId/trasladar`,
en [descuentos](./liquidaciones-terceros-descuentos.md)). Totales de la
cabecera: `total_pagar = Σ valor_liquidar de los ítems no excluidos + Σ
adicionales − (gastos + impuestos + anticipos)`. Estados: los de la cabecera
(`BORRADOR`, `LIQUIDADA`, `APROBADA`, `FACTURADA`, `ANULADA`, `REEMPLAZADA`);
aquí FACTURADA sigue siendo un estado vigente (el paso a PAGADA solo se hizo en
los cierres) y APROBADA, FACTURADA y ANULADA bloquean la entrada de ítems. Las
transiciones de `PATCH /:id/estado` están en
[`estado-ocasional.ts`](../../src/modules/liquidaciones-terceros-ocasional/estado-ocasional.ts)
(ver ese endpoint). La edición celda a celda del canvas va por socket
(`sheet:patch`), no por estas rutas.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros:limited` (`permisoPorMetodo`) |
| `POST`, `PATCH`, `DELETE` | `liquidaciones-terceros:limited`, borrar incluido |
| `PATCH /:id/estado` a `APROBADA`/`FACTURADA`, o desde ellas | además, área `administracion` (403 si no) |
| Borradores de autoguardado | Cada usuario solo ve y borra el suyo (clave `(cabecera, usuario)` sacada del token) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/liquidaciones-terceros-ocasional/previsualizar` | `liquidaciones-terceros:limited` | Cuenta qué ítems entrarían, sin crear nada |
| GET | `/api/liquidaciones-terceros-ocasional/terceros-candidatos` | `liquidaciones-terceros:limited` | Terceros o placas con ítems en el periodo, para el selector |
| POST | `/api/liquidaciones-terceros-ocasional/generar-borrador` | `liquidaciones-terceros:limited` | Crea la cabecera del mes con sus ítems, o añade los filtrados |
| POST | `/api/liquidaciones-terceros-ocasional/refrescar` | `liquidaciones-terceros:limited` | Añade los ítems que se volvieron elegibles |
| GET | `/api/liquidaciones-terceros-ocasional/items-disponibles` | `liquidaciones-terceros:limited` | Ítems sueltos de cualquier mes que podrían entrar |
| POST | `/api/liquidaciones-terceros-ocasional/items-agregar` | `liquidaciones-terceros:limited` | Añade los ítems elegidos |
| POST | `/api/liquidaciones-terceros-ocasional/guardar-borrador` | `liquidaciones-terceros:limited` | Guardado idempotente de ítems, adicionales y conceptos |
| GET | `/api/liquidaciones-terceros-ocasional/anual` | `liquidaciones-terceros:limited` | Los 12 meses de un año |
| GET | `/api/liquidaciones-terceros-ocasional/por-periodo` | `liquidaciones-terceros:limited` | La cabecera de un mes, o `null` |
| GET | `/api/liquidaciones-terceros-ocasional` | `liquidaciones-terceros:limited` | Listado de cabeceras con conteos |
| GET | `/api/liquidaciones-terceros-ocasional/:id` | `liquidaciones-terceros:limited` | Detalle de una cabecera |
| POST | `/api/liquidaciones-terceros-ocasional/draft` | `liquidaciones-terceros:limited` | Guarda el autoguardado del usuario |
| GET | `/api/liquidaciones-terceros-ocasional/:id/draft` | `liquidaciones-terceros:limited` | Lee el autoguardado del usuario |
| DELETE | `/api/liquidaciones-terceros-ocasional/:id/draft` | `liquidaciones-terceros:limited` | Descarta el autoguardado del usuario |
| POST | `/api/liquidaciones-terceros-ocasional/:id/recalcular-totales` | `liquidaciones-terceros:limited` | Recalcula y guarda los totales |
| POST | `/api/liquidaciones-terceros-ocasional/:id/cerrar-distribuir` | `liquidaciones-terceros:limited` | Valida que cada placa tenga cierre y pasa a LIQUIDADA |
| PATCH | `/api/liquidaciones-terceros-ocasional/:id/estado` | `liquidaciones-terceros:limited` (+ administración según estado) | Cambia el estado según la tabla de transiciones |
| DELETE | `/api/liquidaciones-terceros-ocasional/:id` | `liquidaciones-terceros:limited` | Borrado lógico de la cabecera |
| GET | `/api/liquidaciones-terceros-ocasional/:id/preview-data` | `liquidaciones-terceros:limited` | Datos para la vista previa / PDF, agrupados por placa |

Las rutas estáticas (`/anual`, `/por-periodo`, `/items-disponibles`, `/draft`…)
se declaran antes de `/:id`.

### `POST /api/liquidaciones-terceros-ocasional/previsualizar`

**Body** `{ mes, anio, terceros_filtro? }`. `terceros_filtro` mezcla UUIDs
(`tercero_id`) y textos (placas); vacío = todo el mes. Lee como mucho 500 filas
y las agrupa por (tercero, placa, liquidación de servicio).

**Respuesta 200** — `{ cierres_candidatos: [{ id: "preview-0", consecutivo, placa, estado: "BORRADOR", tercero_id, _count: { items } }], cierres_bloqueados: [], total_items_estimados, total_cierres }`
(la forma se conserva por compatibilidad con el frontend; no se crea ningún
cierre). 400 si faltan `mes` o `anio`.

### `GET /api/liquidaciones-terceros-ocasional/terceros-candidatos`

**Query**: `mes`, `anio` (obligatorios), `busqueda`, `filtro_tipo`
(`documento` | `placa` | `nombre`, por defecto `nombre`). La búsqueda por placa
prueba también la versión sin separadores. Lee como mucho 500 filas.

**Respuesta 200** — `{ items: [{ candidato_id, tercero_id, tercero_nombre, tercero_documento, placas, cierres_count, cierres_bloqueados: 0 }] }`.
`candidato_id` es la clave estable de la lista: los ítems sin tercero se
agrupan por placa (`placa:<PLACA>`) y comparten `tercero_id: ""`.

### `POST /api/liquidaciones-terceros-ocasional/generar-borrador`

**Body** `{ mes, anio, terceros_filtro? }`. Los candidatos son las filas vivas
del periodo (por la liquidación padre) cuya placa no tiene cierre final.

| Situación | Respuesta 200 |
|---|---|
| No hay candidatos | `{ ok: false, accion: "no_data", message }` |
| Sin cabecera en el mes | Crea la cabecera BORRADOR con los ítems: `{ ok: true, accion: "created", id, consecutivo, message, items_extraidos, adicionales_extraidos }` |
| Con cabecera y sin filtro | No toca nada: `{ ok: true, accion: "existente", id, message }` |
| Con cabecera y con filtro | Añade los filtrados que no estén ya (vivos o borrados): `{ ok: true, accion: "updated", id, message, items_extraidos }`, o `existente` si no había nuevos |

400 si faltan `mes` o `anio`.

### `POST /api/liquidaciones-terceros-ocasional/refrescar`

**Body** `{ mes, anio }`. Aditivo: añade al final los candidatos que no están
ya en la cabecera (por `liquidacion_tercero_id`), sin tocar lo guardado.
Responde siempre 200:

| `accion` | Cuándo |
|---|---|
| `sin_borrador` (`ok: false`) | El mes no tiene cabecera |
| `estado_bloqueado` (`ok: false`) | Cabecera APROBADA, FACTURADA o ANULADA |
| `sin_cambios` | No hay ítems nuevos |
| `actualizado` | `{ id, agregados, placas, message }` |

### `GET /api/liquidaciones-terceros-ocasional/items-disponibles` y `POST /api/liquidaciones-terceros-ocasional/items-agregar`

`GET` **Query** `mes`, `anio`. Lista filas sueltas de **cualquier** mes que
podrían cobrarse en este ocasional: facturadas (factura activa), de una
liquidación no anulada, que no estén en un cierre vivo, cuya placa no tenga
cierre en el mes **del ítem** y que no estén en otro ocasional vivo.

**Respuesta 200** — `{ cabecera: { id, consecutivo, estado, mes, anio, editable }, disponibles: [{ id, placa, recorrido, fechas, mes, anio, tercero_id, tercero_nombre, tercero_documento, cliente_nombre, liquidacion_consecutivo, numero_planilla, numero_factura, valor_unitario, cantidad, porcentaje_admin, valor_admin, total_facturado, valor_liquidar }], descartados_por_cierre, descartados_por_ocasional, total }`.

`POST` **Body** `{ mes, anio, liquidacion_tercero_ids: [uuid] }`. Exige
cabecera no bloqueada; cada id debe existir y no estar en un cierre vivo.
Responde `{ ok: true, id, agregados, placas, message }`.

| Código | Cuándo |
|---|---|
| 400 | Faltan `mes`/`anio` o `liquidacion_tercero_ids` no es arreglo |
| 404 | El mes no tiene cabecera («No hay borrador…») |
| 409 | Cabecera bloqueada, ítems ya en la liquidación o que ya no existen, ítem en un cierre |

### `POST /api/liquidaciones-terceros-ocasional/guardar-borrador`

**Body** (sin esquema; tipos `ItemOcasionalInput`, `AdicionalOcasionalInput` y
`ConceptoOcasionalInput` en `liquidaciones-terceros-ocasional.service.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `mes`, `anio` | number | sí | |
| `id` | uuid | no | Cabecera; sin él se busca la del periodo y, si no hay, se crea |
| `items` | arreglo | no | Los que llegan sin `placa` se ignoran y los que llegan sin `liquidacion_tercero_id` se descartan con aviso en el log |
| `adicionales` | arreglo | no | `valor_admin`/`valor_liquidar` se derivan; se descartan los de valor y cantidad 0 |
| `conceptos` | arreglo | no | `tipo` y `concepto` obligatorios; `valor_total` se calcula si llega en 0 |
| `observaciones` | string | no | |
| `force_new` | boolean | no | Con la cabecera APROBADA o FACTURADA: la marca REEMPLAZADA (y borrada) y crea otra |

Upsert por `id` en un solo lote atómico: lo que está en la base y no llega se
marca con `deleted_at`; un `id` que no es UUID se sustituye por uno nuevo; un
`id` que existía en otra cabecera se reasigna a esta. Los totales se recalculan
con lo recibido. Tras guardar se borra el autoguardado del usuario.

**Respuesta 200** — `{ ok: true, id, accion: "created" | "updated", message }`.
409 si la cabecera está APROBADA o FACTURADA sin `force_new`; cualquier otro
fallo, 500.

### `GET /api/liquidaciones-terceros-ocasional/anual`, `GET /api/liquidaciones-terceros-ocasional/por-periodo`, `GET /api/liquidaciones-terceros-ocasional` y `GET /api/liquidaciones-terceros-ocasional/:id`

- `anual?anio=` (400 si falta o está fuera de 2000–2100):
  `{ anio, meses: [{ mes, cabecera, items, adicionales, conceptos }] }`, siempre
  12 entradas; un mes sin cabecera llega con `cabecera: null`.
- `por-periodo?mes=&anio=` (400 si faltan): la cabecera viva del mes con
  `creado_por`, `actualizado_por`, `items`, `adicionales` y `conceptos` vivos, o
  `null`.
- `?mes=&anio=` (opcionales): `{ items: [cabecera + creado_por + actualizado_por + _count { adicionales, conceptos, items, snapshots }], total }`,
  sin paginar.
- `/:id`: la cabecera viva con lo mismo que `por-periodo`; 404 si no existe.

Los ítems que devuelven `anual`, `por-periodo` y `/:id` llevan además
`numero_factura` (el propio o, si está vacío o anulado, el vigente del
servicio), `factura_anulada` y `liquidacion_servicio: { id, valor_recargos, numero_factura }`.

### `POST /api/liquidaciones-terceros-ocasional/draft`, `GET /api/liquidaciones-terceros-ocasional/:id/draft` y `DELETE /api/liquidaciones-terceros-ocasional/:id/draft`

Autoguardado del canvas por `(cabecera, usuario)`; el usuario sale del token.

- `POST` **Body** `{ liquidacion_ocasional_id, payload }` (estado serializado
  del canvas, sin validar). Responde `{ ok: true, id, version }`; la versión
  sube en cada guardado. 400 `Faltan parámetros` sin
  `liquidacion_ocasional_id`.
- `GET` responde `{ id, payload, version, updated_at }` o `null`.
- `DELETE` lo borra en duro (los borradores no llevan `deleted_at`) y responde
  `{ ok: true }`.

### `POST /api/liquidaciones-terceros-ocasional/:id/recalcular-totales`

Sin body. Recalcula los totales con los ítems, adicionales y conceptos vivos y
responde la cabecera actualizada. Una cabecera inexistente sale como 500.

### `POST /api/liquidaciones-terceros-ocasional/:id/cerrar-distribuir`

Sin body. Solo desde BORRADOR o LIQUIDADA. Reúne las placas de los ítems no
excluidos, los adicionales y los conceptos con `placa_aplicada`, y exige que
cada una tenga un cierre final vivo en el mes. Si lo cumplen, pasa la cabecera a
LIQUIDADA.

**Respuesta 200** — `{ ok: true, id, estado: "LIQUIDADA", cierres_asociados, message }`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 409 | Alguna placa sin cierre | `{ "error": "Faltan N cierre(s)…", "code": "PLACAS_FALTANTES", "placas_faltantes": [{ "placa", "motivo" }] }` |
| 500 | Cabecera inexistente, estado no admitido, sin placas y el resto | `{ "error": "<mensaje>" }` |

### `PATCH /api/liquidaciones-terceros-ocasional/:id/estado`

**Body** `{ estado, motivo_anulacion? }`. Valida valor, transición, área y
motivo con `validarCambioEstadoOcasional`
([`estado-ocasional.ts`](../../src/modules/liquidaciones-terceros-ocasional/estado-ocasional.ts)),
escribe el estado (y el motivo si es ANULADA) y responde la cabecera
actualizada. Es la máquina de los cierres finales con FACTURADA en lugar de
PAGADA:

| Desde | Hacia | Además |
|---|---|---|
| `BORRADOR` | `ANULADA` | A `LIQUIDADA` se llega con `cerrar-distribuir`, que comprueba los cierres de cada placa (409 si se pide aquí) |
| `LIQUIDADA` | `APROBADA`, `BORRADOR`, `ANULADA` | `APROBADA` solo Administración |
| `APROBADA` | `LIQUIDADA`, `FACTURADA`, `ANULADA` | Solo Administración (salir de `APROBADA`; entrar en `FACTURADA`) |
| `FACTURADA` | `ANULADA`; `APROBADA` solo Administración (puerta de atrás, como PAGADA → APROBADA en cierres) | Solo Administración |
| `ANULADA`, `REEMPLAZADA` | — | Terminales |

Anular exige `motivo_anulacion` no vacío. El `UPDATE` lleva el estado leído en
el `WHERE` y `deleted_at: null`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta `estado`, valor fuera de la lista (`ESTADO_INVALIDO`) o anular sin motivo (`FALTA_MOTIVO`) | `{ "code"?, "error" }` |
| 403 | Entrar en APROBADA/FACTURADA o salir de ellas sin el área `administracion` (`SIN_PERMISO`) | `{ code, error }` |
| 404 | Cabecera inexistente o en la papelera (`NO_ENCONTRADO`) | `{ code, error }` |
| 409 | Transición fuera de la tabla (`TRANSICION_INVALIDA`) u otro usuario cambió el estado entretanto (`ESTADO_CAMBIADO`) | `{ code, error }` |

### `DELETE /api/liquidaciones-terceros-ocasional/:id`

Marca `deleted_at` en la cabecera (no en sus filas, que dejan de verse con
ella). Responde `{ ok: true, id, deleted_at }`; 404 si no existe o ya estaba
borrada, 409 si está APROBADA o FACTURADA.

### `GET /api/liquidaciones-terceros-ocasional/:id/preview-data`

**Respuesta 200** — `{ cabecera: { id, consecutivo, mes, anio, estado, observaciones, creado_por, actualizado_por, created_at, updated_at }, items, adicionales, conceptos, por_placa: [{ placa, adicionales_count, items_count, valor_liquidar, tercero_nombre }], totales: { total_facturado_items, total_admin_items, total_liquidar_items, total_adicionales, total_gastos_operativos, total_impuestos, total_anticipos, total_descuentos, total_pagar } }`;
404 si no existe.

## Efectos

- `guardar-borrador`, `recalcular-totales`, `cerrar-distribuir` y el cambio de
  estado emiten `row:updated` a la sala `row:liquidacion-tercero-ocasional:<id>`
  y `row:updated:global` a todos. `cerrar-distribuir` emite además
  `liquidacion-tercero-ocasional:cerrada` y el borrado
  `liquidacion-tercero-ocasional:deleted`, ambos a todos (ver
  [tiempo real](../tiempo-real.md)).
- Versiones y reversión en [snapshots del ocasional](./liquidaciones-terceros-ocasional-snapshots.md);
  el cron horario captura las cabeceras BORRADOR y LIQUIDADA.
- El traslado desde un cierre de placa crea o reactiva la fila aquí (y la
  cabecera en BORRADOR si no había) y la devolución la marca.
- Las escrituras que terminan bien dejan fila en `registro_actividad` (ver
  [actividad](./actividad.md)).

## Observaciones

- `guardar-borrador` solo protege APROBADA y FACTURADA: una cabecera ANULADA se
  sigue editando.
- `refrescar` e `items-agregar` insertan con `createMany` contra el único
  `(cabecera, liquidacion_tercero_id)`, que cuenta también las filas marcadas.
  Si un ítem se quitó del canvas (fila con `deleted_at`) y sigue siendo
  candidato, el reintento choca (P2002) y sale como 500. `generar-borrador` con
  filtro sí excluye las borradas, y el traslado desde un cierre reactiva la
  fila.
- Según las migraciones del repo, el único `(mes, anio)` de la cabecera es
  total, no parcial: una cabecera borrada sigue ocupando el periodo. Volver a
  generar el mes tras un `DELETE`, o `force_new`, chocarían con ese índice. No
  verificado contra la base.
- `cerrar-distribuir` no distribuye nada: solo valida que haya cierres y cambia
  el estado.
- `generar-borrador` con filtro sobre una cabecera existente recalcula los
  totales sin los conceptos: `total_descuentos` y `total_pagar` quedan sin
  descuentos hasta el siguiente guardado o recálculo.
- `items-agregar` no comprueba que el ítem esté en otro ocasional vivo (el
  listado de disponibles sí lo descarta).
- El body de `guardar-borrador` y el `payload` de los borradores no se validan;
  el borrador de una cabecera inexistente falla por FK (500).
- Cabecera inexistente en `recalcular-totales` y `cerrar-distribuir` responde
  500, no 404.
