# Cierres de terceros

`/api/liquidaciones-terceros/*`, `/api/liquidaciones-terceros-descuentos`, `/api/configuracion-descuentos-tercero` · código en [`src/modules/liquidaciones-terceros-descuentos/`](../../src/modules/liquidaciones-terceros-descuentos/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

El **cierre** (`liquidacion_tercero_final`) es lo que se le liquida a un
propietario por una placa en un mes. Une, mediante un pivote
(`liquidacion_tercero_final_item`), filas de terceros de una o varias
liquidaciones de servicio (ver [liquidaciones de terceros](./liquidaciones-terceros.md)
para el reparto del dominio) y les resta sus propios conceptos
(`liquidacion_tercero_final_concepto`) de cuatro tipos: `COSTO_LABORAL`
(salario, auxilio, bonificaciones, recargos, prestaciones y seguridad social de
cada conductor), `GASTO_OPERATIVO` (papelería, gastos diversos, combustible…),
`IMPUESTO` y `ANTICIPO`. El consecutivo es `LIQ-TERC-<año>-NNNNN`, generado bajo
`pg_advisory_xact_lock`. Una placa puede tener dos cierres en el mes si se
liquida a dos propietarios; cada uno es una hoja del canvas del periodo. La
carpeta se llama «descuentos» por historia: es el CRUD completo del cierre.

Reglas de cálculo que un integrador tiene que conocer:

- **Totales** (fuente única `totales-cierre.ts`): `valor_liquidar` = Σ
  `valor_liquidar` de los ítems vivos del pivote + Σ adicionales (tabla
  `liquidacion_tercero_final_adicional`; el JSONB `adicionales` solo cuenta si
  la tabla está vacía, nunca los dos); `total_descuentos` = Σ conceptos vivos;
  `total_pagar` = `valor_liquidar − total_descuentos`.
- **Impuestos**: RETENCION_ICA grava los ítems con `aplica_impuestos` más los
  adicionales que aplican; RETENCION_FUENTE grava **todos** los ítems más esos
  adicionales; AVISOS_TABLEROS y SOBRETASA_BOMBERIL se calculan sobre el valor
  de RETENCION_ICA, sea cual sea su configuración. Los porcentajes salen de
  `configuracion_descuento_tercero`. Con copropietarios
  (`es_multi_propietario`) cada impuesto se reparte en una fila por
  copropietario según el porcentaje efectivo de la cascada (el primero toma su
  porcentaje y el resto reparte el remanente); los porcentajes no se validan
  contra 100 %.
- **Gastos de vehículo**: papelería y gastos diversos salen de
  `configuracion_gastos_periodo` (una fila por mes); dotación y examen médico
  usan las tarifas globales de `configuracion_valores_tercero`. Un mes sin
  fila usa los valores de respaldo de `reglas-conceptos.ts`. Cambiar la
  configuración no reescribe cierres ya generados.
- **Estados** (`cierre-estado.service.ts`, espejo de
  `cierres-finales-estado.ts` del frontend). PAGADA reemplazó a FACTURADA en
  oct-2026: con terceros quien factura es el propietario y la empresa le paga.
  FACTURADA queda como **heredado**: se lee, bloquea la hoja y solo se puede
  anular, pero ya no es destino. Cambiar de estado usa concurrencia optimista
  (`version`) y deja historial en `historial_estado_liquidacion_tercero_final`.

| Desde | Hacia | Restricción |
|---|---|---|
| BORRADOR | LIQUIDADA, ANULADA | — |
| LIQUIDADA | APROBADA, BORRADOR, ANULADA | APROBADA solo Administración |
| APROBADA | LIQUIDADA, ANULADA, PAGADA | Salir de APROBADA es de Administración; PAGADA exige `pago` |
| PAGADA | ANULADA; APROBADA (puerta de atrás) | Solo Administración; volver a APROBADA archiva el pago |
| FACTURADA (heredado) | ANULADA | Solo Administración |
| REEMPLAZADA | BORRADOR | — |
| ANULADA | — | Estado final |

Pasar a ANULADA exige motivo y a PAGADA los datos del pago. APROBADA, PAGADA,
FACTURADA, ANULADA y REEMPLAZADA dejan la hoja en solo lectura: la edición por
celda, los conductores y las filas de gastos y anticipos los rechazan con 409,
y copropietarios, `refresh-items`, `items-agregar` y los traslados exigen
además BORRADOR (algunas rutas no miran el estado: ver Observaciones). La
edición celda a celda del canvas no pasa por aquí: va por socket (`sheet:patch`
en `src/sockets/sheet.gateway.ts`, ver [tiempo real](../tiempo-real.md)); estas
rutas son las que cambian la geometría de la hoja (altas y bajas de filas) o el
cierre entero.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| Lecturas y `POST …/generar-borrador` (previsualiza sin persistir) | `liquidaciones-terceros:limited` (`preHandler` por ruta) |
| Escrituras, salvo borrar un cierre | `liquidaciones-terceros:limited`: facturación y contabilidad también editan cierres |
| `DELETE /api/liquidaciones-terceros/:id` | `liquidaciones-terceros:full` (administración y operaciones) |
| Cambio de estado | Además, regla por **área** dentro del servicio: entrar en APROBADA/PAGADA y salir de APROBADA/PAGADA/FACTURADA exige el área `administracion` (403 `SIN_PERMISO`) |
| Colas | Cancelar un borrador y leer o cancelar un guardado masivo solo actúan sobre jobs del propio usuario; el estado de un borrador (`borrador-status`) no comprueba dueño |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/configuracion-descuentos-tercero` | `liquidaciones-terceros:limited` | Porcentajes de prestaciones, seguridad social e impuestos |
| PUT | `/api/configuracion-descuentos-tercero` | `liquidaciones-terceros:limited` | Actualiza esos porcentajes por concepto |
| GET | `/api/liquidaciones-terceros/config-gastos` | `liquidaciones-terceros:limited` | Papelería y gastos diversos de un periodo |
| PUT | `/api/liquidaciones-terceros/config-gastos` | `liquidaciones-terceros:limited` | Crea o actualiza la configuración de gastos del periodo |
| GET | `/api/liquidaciones-terceros/config-valores` | `liquidaciones-terceros:limited` | Tarifas diarias de conductores y gastos automáticos |
| PUT | `/api/liquidaciones-terceros/config-valores` | `liquidaciones-terceros:limited` | Actualiza esas tarifas globales |
| GET | `/api/liquidaciones-terceros-descuentos` | `liquidaciones-terceros:limited` | Historial paginado de cierres |
| GET | `/api/liquidaciones-terceros-descuentos/:id` | `liquidaciones-terceros:limited` | Detalle completo de un cierre |
| GET | `/api/liquidaciones-terceros/periodo` | `liquidaciones-terceros:limited` | Índice de hojas del periodo, o el detalle de un lote de cierres |
| POST | `/api/liquidaciones-terceros/generar-borrador` | `liquidaciones-terceros:limited` | Previsualiza cierres desde liquidaciones de servicio, sin guardar |
| POST | `/api/liquidaciones-terceros/generar-borrador-async` | `liquidaciones-terceros:limited` | Lo mismo en cola; opcionalmente persiste cada cierre |
| GET | `/api/liquidaciones-terceros/borrador-status/:jobId` | `liquidaciones-terceros:limited` | Estado de un job de borradores |
| DELETE | `/api/liquidaciones-terceros/borrador-job/:jobId` | `liquidaciones-terceros:limited` | Cancela un job de borradores propio |
| POST | `/api/liquidaciones-terceros/guardar-borrador` | `liquidaciones-terceros:limited` | Crea el cierre (o varios en modo lote) con pivote y conceptos |
| POST | `/api/liquidaciones-terceros/guardar-borrador-bulk-async` | `liquidaciones-terceros:limited` | Guardado masivo en segundo plano |
| GET | `/api/liquidaciones-terceros/save-bulk/:batchId` | `liquidaciones-terceros:limited` | Estado de un guardado masivo propio |
| DELETE | `/api/liquidaciones-terceros/save-bulk-job/:batchId` | `liquidaciones-terceros:limited` | Marca como cancelado un guardado masivo propio |
| GET | `/api/liquidaciones-terceros/autocompletar-nomina` | `liquidaciones-terceros:limited` | Conductores y costos laborales de una placa en un mes, desde nómina |
| GET | `/api/liquidaciones-terceros/bonificaciones` | `liquidaciones-terceros:limited` | Bonos de nómina de una placa en un mes, por conductor |
| GET | `/api/liquidaciones-terceros/anticipos-vehiculo` | `liquidaciones-terceros:limited` | Anticipos de nómina de una placa en un mes |
| GET | `/api/liquidaciones-terceros/:id/conceptos` | `liquidaciones-terceros:limited` | Conceptos vivos del cierre |
| PUT | `/api/liquidaciones-terceros/:id/conceptos` | `liquidaciones-terceros:limited` | Reemplaza todos los conceptos del cierre |
| PUT | `/api/liquidaciones-terceros/:id/conductores` | `liquidaciones-terceros:limited` | Altas, bajas y días de los conductores del cierre |
| POST | `/api/liquidaciones-terceros/:id/conceptos-fila` | `liquidaciones-terceros:limited` | Añade una fila de GASTOS DE VEHÍCULO o ANTICIPOS |
| DELETE | `/api/liquidaciones-terceros/conceptos-fila/:conceptoId` | `liquidaciones-terceros:limited` | Quita (marca) una fila de gastos o anticipos |
| GET | `/api/liquidaciones-terceros/:id/propietarios` | `liquidaciones-terceros:limited` | Copropietarios del cierre |
| PUT | `/api/liquidaciones-terceros/:id/propietarios` | `liquidaciones-terceros:limited` | Reemplaza la lista de copropietarios |
| GET | `/api/liquidaciones-terceros/:id/calcular-impuestos` | `liquidaciones-terceros:limited` | Calcula **y persiste** las filas de impuesto |
| POST | `/api/liquidaciones-terceros/:id/recalcular-totales` | `liquidaciones-terceros:limited` | Recalcula y guarda los totales del cierre |
| PUT | `/api/liquidaciones-terceros/:id/items` | `liquidaciones-terceros:limited` | Reemplaza los ítems del pivote |
| POST | `/api/liquidaciones-terceros/:id/refresh-items` | `liquidaciones-terceros:limited` | Añade ítems nuevos del mismo periodo, placa y tercero |
| GET | `/api/liquidaciones-terceros/:id/items-disponibles` | `liquidaciones-terceros:limited` | Ítems de la misma placa, de cualquier mes, libres de cierre |
| POST | `/api/liquidaciones-terceros/:id/items-agregar` | `liquidaciones-terceros:limited` | Añade al pivote los ítems elegidos |
| PATCH | `/api/liquidaciones-terceros/items/:pivoteId/aplica-impuestos` | `liquidaciones-terceros:limited` | Marca si un ítem entra en la base de ICA/avisos/bomberil |
| PATCH | `/api/liquidaciones-terceros/items/:pivoteId/excluir` | `liquidaciones-terceros:limited` | Quita (marca) o devuelve un ítem del pivote |
| POST | `/api/liquidaciones-terceros/items/:pivoteId/trasladar` | `liquidaciones-terceros:limited` | Traslada un ítem del cierre a ocasional o ingresos |
| POST | `/api/liquidaciones-terceros/items/:pivoteId/revertir-traslado` | `liquidaciones-terceros:limited` | Devuelve al cierre un ítem trasladado |
| PATCH | `/api/liquidaciones-terceros/:id/estado` | `liquidaciones-terceros:limited` + área | Cambia el estado de un cierre |
| POST | `/api/liquidaciones-terceros/estado-lote` | `liquidaciones-terceros:limited` + área | Cambia el estado de varios cierres del periodo |
| GET | `/api/liquidaciones-terceros/:id/historial-estados` | `liquidaciones-terceros:limited` | Quién cambió el estado y cuándo |
| PATCH | `/api/liquidaciones-terceros/:id/color-hoja` | `liquidaciones-terceros:limited` | Fija el color de la pestaña en el canvas |
| DELETE | `/api/liquidaciones-terceros/:id` | `liquidaciones-terceros:full` | Borrado lógico del cierre |

## Configuración

### `GET /api/configuracion-descuentos-tercero`

Arreglo plano de las filas activas de `configuracion_descuento_tercero`,
ordenadas por `categoria` y `orden`: `{ id, categoria, concepto, nombre,
porcentaje, base_calculo, activo, orden, … }`. Las categorías que usa el
cálculo son `PRESTACION_SOCIAL`, `SEGURIDAD_SOCIAL` e `IMPUESTO`.

### `PUT /api/configuracion-descuentos-tercero`

**Body** `{ "items": [{ "concepto": "RETENCION_ICA", "porcentaje": 1 }] }`

| Campo de cada ítem | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `concepto` | string | sí | Clave única de la fila a actualizar |
| `porcentaje` | number | no | Solo se cambia lo que llega |
| `base_calculo` | string | no | Ver la regla fija de AVISOS/BOMBERIL arriba |
| `valor_dia_conductor` | number | no | Compatibilidad con clientes anteriores; sincroniza la tarifa diaria de nómina con la configuración global. |

**Respuesta 200** — arreglo con las filas actualizadas. 400 si `items` no es un
arreglo; un `concepto` inexistente sale como 500. Las filas se actualizan una a
una, sin transacción.

### `GET /api/liquidaciones-terceros/config-gastos`

**Query** `anio`, `mes` (obligatorios; 400 si faltan).

**Respuesta 200** — nunca 404: un periodo sin fila devuelve los valores de
respaldo con `configurado: false`.

```json
{ "anio": 2026, "mes": 7, "configurado": true,
  "pct_gastos_diversos": 0.4, "fijo_gastos_diversos": 20000,
  "papeleria_alta": 25000, "papeleria_baja": 20000, "papeleria_umbral": 1000000,
  "actualizado_por_id": "uuid", "updated_at": "…" }
```

`GASTOS_DIVERSOS = fijo + pct % × (Σ total de los ítems + Σ bruto de
adicionales)`, con `pct` en puntos porcentuales (0,4 es 0,4 %). `PAPELERIA` vale
`papeleria_alta` si el `valor_liquidar` del cierre supera el umbral y
`papeleria_baja` si no.

### `PUT /api/liquidaciones-terceros/config-gastos`

**Body** `{ anio, mes, pct_gastos_diversos?, fijo_gastos_diversos?, papeleria_alta?, papeleria_baja?, papeleria_umbral? }`.
Upsert sobre `(anio, mes)`; los campos que no llegan conservan el valor
vigente, y un periodo retirado revive. Responde lo mismo que el `GET`.

| Código | Cuándo |
|---|---|
| 400 | Año fuera de 2000–2100, mes fuera de 1–12, algún valor negativo, o `pct_gastos_diversos > 100` |

### `GET /api/liquidaciones-terceros/config-valores`

Devuelve las tarifas globales que antes eran constantes de código:

```json
{
  "valor_dia_conductor_nomina": 78629.9,
  "valor_salario_manual": 69510,
  "valor_auxilio_transporte_manual": 8303,
  "valor_bonificacion_manual": 26061,
  "valor_bonificacion_turno_doble_manual": 25000,
  "valor_dotacion": 3985,
  "valor_examen_medico": 2882
}
```

### `PUT /api/liquidaciones-terceros/config-valores`

Recibe cualquiera de esos campos; los omitidos conservan su valor vigente.
Guarda una única configuración global. Estos valores se usan al sincronizar o
crear bloques de conductores y al sembrar o recalcular dotación y examen médico.
La migración inicial conserva `valor_dia_conductor` previo cuando existía y
mantiene como respaldo los demás importes que ya usaba el cálculo. No altera
automáticamente cierres guardados.

Los porcentajes de cada fila de `configuracion-descuentos-tercero` siguen
controlando prestaciones sociales, seguridad social e impuestos. Las tarifas
por periodo de papelería y gastos diversos siguen en `config-gastos`.

## Listados y detalle

### `GET /api/liquidaciones-terceros-descuentos`

**Query**: `page` (1), `limit` (50, sin tope), `placa` (`contains`), `mes`,
`anio`, `tercero_id`, `busqueda` (placa, consecutivo, nombre del tercero o
consecutivo de la liquidación de servicio). Solo cierres vivos, de cualquier
estado; orden por año, mes y fecha de creación descendentes.

**Respuesta 200**

```json
{ "items": [{ "id": "uuid", "consecutivo": "LIQ-TERC-2026-00012", "placa": "ABC123",
    "mes": 7, "anio": 2026, "estado": "BORRADOR", "tercero_id": "uuid",
    "es_multi_propietario": false, "valor_liquidar": 0, "total_costos_laborales": 0,
    "total_gastos_operativos": 0, "total_impuestos": 0, "total_descuentos": 0,
    "total_pagar": 0, "tercero": { "nombre_completo": "…" }, "numero_factura": "",
    "created_at": "…", "creado_por": { "id": "…", "nombre": "…", "correo": "…" },
    "snapshot_count": 4 }],
  "total": 80, "totalPages": 2, "page": 1 }
```

### `GET /api/liquidaciones-terceros-descuentos/:id`

**Query**: `includeDeleted` (`'true'` incluye los ítems del pivote quitados o
trasladados, que la vista de edición muestra tachados).

**Respuesta 200** — la cabecera con los decimales como número, más:
`liquidacion` (liquidación de servicio de referencia, con `cliente`, `facturas`,
`factura_anulada` y solo las facturas visibles), `facturas` (números
consolidados del cierre), `items` (pivote con `aplica_impuestos`, `deleted_at`,
`trasladado_a`, `trasladado_at`, `liquidacion_tercero` anidado, `facturas` y
`factura_anulada`, ordenado por número de factura), `items_adicionales` (tabla
primero, JSONB como respaldo), `conceptos` (vivos, con `conductor` y
`propietario`), `es_multi_propietario` y `propietarios` (con
`porcentaje_efectivo`). Una factura anulada solo se muestra si la liquidación no
tiene ninguna vigente.

Un cierre inexistente o borrado responde **500** con
`{ "error": "Liquidación final de tercero no encontrada" }`.

### `GET /api/liquidaciones-terceros/periodo`

**Query**

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `anio` | number | sí | 2000–2100 |
| `mes` | number | sí | 1–12 |
| `ids` | string | no | Ids de cierre separados por coma, máximo 40 |

Sin `ids` devuelve el índice de hojas, ordenado por placa, propietario y
consecutivo, con **todos** los estados:

```json
{ "anio": 2026, "mes": 7, "modo": "lite", "total": 41,
  "hojas": [{ "id": "uuid", "consecutivo": "…", "placa": "ABC123", "tercero_id": "uuid",
    "tercero_nombre": "…", "tercero_correo": "…", "tercero_identificacion": "…",
    "tercero_tipo_persona": "PERSONA", "estado": "BORRADOR", "es_multi_propietario": false,
    "total_pagar": 0, "valor_liquidar": 0, "version": 3, "color_hoja": null,
    "orden_alfabetico": "…", "copropietarios": 0 }] }
```

Con `ids` devuelve `{ anio, mes, modo: "full", cierres: [...] }`, cada uno con
la forma del detalle. Los ids que no son del periodo se ignoran y un cierre que
falla al leerse se omite del lote sin tumbarlo.

| Código | Cuándo |
|---|---|
| 400 | `anio` o `mes` inválidos, o más de 40 `ids` |

## Generar y guardar borradores

Generar es **solo lectura**: arma, por cada par (placa, tercero) de las
liquidaciones de servicio indicadas, el cierre que saldría (ítems, costos
laborales de nómina, anticipos del vehículo y totales). Si ya existe un cierre
BORRADOR vivo de esa placa, tercero y periodo, reutiliza sus conceptos y sus
adicionales en vez de los de nómina. Solo `guardar-borrador` (o la cola con
`persistir`) escribe.

### `POST /api/liquidaciones-terceros/generar-borrador`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidacion_servicio_ids` | uuid[] | uno de los dos | Preferido |
| `liquidacion_servicio_id` | uuid | uno de los dos | Compatibilidad |
| `placa` | string | no | Filtra los ítems por placa (normalizada) |
| `tercero_id` | uuid | no | Filtra por propietario: una placa que cambió de dueño a mitad de mes |

**Respuesta 200** — `{ liquidacion_servicio: { id, consecutivo, mes, anio, cliente, facturas }, terceros: [...] }`.
Cada entrada de `terceros` lleva `placa`, `liquidacion_servicio_id`,
`liquidacion_tercero_final` (cierre persistido o en memoria), `conceptos`,
`resumen_nomina`, `conductores`, `items_adicionales`, `items` (ids de
`liquidacion_tercero`) y `liquidacion_tercero`; hay una entrada por ítem, todas
con los mismos conceptos. Una placa que falla sale como `{ placa, error, conceptos: [] }`.
400 si no llega ningún id.

### `POST /api/liquidaciones-terceros/generar-borrador-async`

Mismo body que la versión síncrona, más:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `persistir` | boolean | no | `true`: además guarda cada cierre y anuncia su hoja (modo canvas) |
| `anio`, `mes` | number | si `persistir` | Periodo del libro; también es la clave del lock |
| `placas` | string[] | no | Subconjunto de placas a persistir |
| `force_new` | boolean | no | Crea un cierre nuevo aunque haya uno APROBADA/PAGADA, marcándolo REEMPLAZADA |

La cola vive en memoria, en un solo proceso. Hay un lock por periodo
(`anio:mes`; sin periodo, la clave `sin-periodo`), un job en cola por usuario
(si ya tiene uno, se devuelve ese `job_id`), un tope de 10 jobs en cola y los
jobs terminados se purgan a los 5 minutos (`BORRADOR_QUEUE_*` en
`src/config/env.ts`). Con `persistir`, agrupa por (placa, tercero), fusiona los
ítems de varias liquidaciones de servicio en un solo cierre y una placa que
falla no detiene al resto.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 202 | Encolado | `{ "job_id": "uuid", "status": "queued" }` |
| 400 | Sin ids, o `persistir` sin `anio`/`mes` | `{ "error": "…" }` |
| 409 | Otro job corre sobre el mismo periodo | `{ "job_id": null, "status": "locked", "locked_by": { "userId", "userName", "startedAt", "currentStep", "progress", "jobId", "anio", "mes" } }` |
| 500 | Cola llena y otros fallos | `{ "error": "La cola de borradores esta llena" }` |

### `GET /api/liquidaciones-terceros/borrador-status/:jobId` y `DELETE /api/liquidaciones-terceros/borrador-job/:jobId`

`GET` devuelve el job tal cual: `{ id, status (queued|running|complete|error|cancelled), userId, userName, payload, progress, currentStep, processed, total, result?, error?, createdAt, startedAt?, finishedAt?, guardados?, fallidos? }`,
o 404 `{ "error": "job_not_found" }`. `result` es la previsualización completa.

`DELETE` responde `{ "cancelled": true|false }`; `false` si el job no existe,
no es del usuario o ya terminó. Un job en curso se detiene al terminar la placa
que está guardando; lo ya persistido no se deshace.

### `POST /api/liquidaciones-terceros/guardar-borrador`

**Body** (sin esquema; tipos en `ConceptoInput` y `AdicionalInput` de
`liquidaciones-terceros-descuentos.service.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liquidacion_servicio_id` | uuid | sí | Liquidación de servicio de referencia |
| `placa` | string | sí | |
| `tercero_id` | uuid | no | Propietario; entra en la comprobación de duplicados |
| `mes`, `anio` | number | sí | |
| `item_ids` | uuid[] | sí | Filas de `liquidacion_tercero`; todas deben pertenecer a `liquidacion_servicio_id` |
| `conceptos` | `ConceptoInput[]` | no | Se recalcula `valor_total` si llega en 0; los ids se regeneran siempre |
| `adicionales` | `AdicionalInput[]` | no | Se descartan los que tienen valor y cantidad en 0; se guardan en el JSONB `adicionales` |
| `es_propietario_overrides` | `{ [conductor_id]: boolean }` | no | Solo se conservan valores booleanos |
| `force_new` | boolean | no | Ver abajo |
| `bulk_mode` | boolean | no | `true`: un cierre por placa de `placas` o `placas_payload` |
| `placas`, `placas_payload` | arreglos | con `bulk_mode` | `placas_payload[i] = { placa, item_ids, conceptos, adicionales?, tercero_id?, liquidacion_servicio_id? }` |

Siempre **crea** un cierre BORRADOR nuevo: el controlador no reenvía `id`, así
que la rama de actualización en sitio del servicio no es alcanzable por HTTP.
Si ya hay un cierre vivo APROBADA, PAGADA o FACTURADA para la misma placa
(normalizada), periodo y tercero, responde 409; con `force_new: true` ese
cierre pasa a REEMPLAZADA y se crea el nuevo. Tras crear, siembra los gastos de
vehículo y calcula los impuestos (si eso falla, el cierre queda igual) y toma
un snapshot.

**Respuesta 200** — `{ "ok": true, "id": "uuid", "accion": "created", "cierre": { …, "items": [...], "conceptos": [...] } }`.
En modo lote: `{ ok, bulk: true, count, results: [...], errors: [{ placa, error }] }`;
solo falla entero si fallan todas las placas.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 409 | Existe un cierre bloqueado y no se mandó `force_new` | `{ "error": "Ya existe una liquidación APROBADA para la placa … Usa force_new=true…" }` |
| 500 | Ítems que no pertenecen a la liquidación, consecutivo imposible tras 5 intentos y el resto | `{ "error": "<mensaje>" }` |

### `POST /api/liquidaciones-terceros/guardar-borrador-bulk-async`, `GET /api/liquidaciones-terceros/save-bulk/:batchId` y `DELETE /api/liquidaciones-terceros/save-bulk-job/:batchId`

`POST` recibe `{ placas: [{ placa, tercero_id, liquidacion_servicio_id, item_ids, conceptos, adicionales?, es_propietario_overrides? }], mes, anio, force_new? }`
y llama a `guardarBorrador` placa a placa en segundo plano. Responde **202**
`{ "success": true, "batchId": "uuid", "total": 12, "status": "queued" }`; 400
si `placas` está vacío o `mes`/`anio` no son números. El cliente guarda el
`batchId` para reanudar la interfaz tras recargar.

`GET` devuelve `{ success: true, data: job }` con `status`
(`queued|running|completed|failed`), `processed`, `total`, `currentPlaca`,
`results: [{ placa, ok, id?, error?, value? }]` y el payload de entrada; 404
`{ "error": "batch_not_found" }` si no existe o es de otro usuario. Los jobs
terminados viven una hora. `DELETE` responde `{ "cancelled": true|false }`.

## Datos de nómina

Las tres rutas reciben **Query** `placa`, `mes`, `anio` (400
`Se requiere placa, mes y anio` si falta alguno) y resuelven el vehículo con
`placa contains` sin distinguir mayúsculas. Si no existe el vehículo responden
500 con `Vehículo con placa "X" no encontrado`.

### `GET /api/liquidaciones-terceros/autocompletar-nomina`

Arma los costos laborales del cierre desde las liquidaciones de nómina del
vehículo. El ciclo de nómina va del 21 al 20, así que un mes natural lo parten
dos ciclos: días, salario y auxilio salen del ciclo que **cierra** en el mes;
los bonos de alimentación se atribuyen por el mes del JSON `values` y los
recargos por la columna `mes` de `recargos`, filtrados por el vehículo.

**Respuesta 200** — `{ vehiculo, conductores, conceptos, conceptos_impuestos, resumen }`.
`conceptos` trae por conductor SALARIO (días × `valor_dia_conductor`),
AUXILIO_TRANSPORTE (si hay), BONIFICACION, BONIFICACION_TURNO_DOBLE y RECARGOS
(siempre, aunque sea en cero), y una fila por prestación y por seguridad
social. `conceptos_impuestos` trae los impuestos activos en 0. `resumen` =
`{ base_salarios, base_auxilio_transporte, base_recargos, base_bonificaciones, total_base }`.
Sin nómina en el mes: `{ vehiculo, conductores: [], conceptos: [], resumen }`.

### `GET /api/liquidaciones-terceros/bonificaciones`

**Respuesta 200** — `{ vehiculo: { id, placa }, mes: "2026-07", por_conductor: [{ conductor_id, conductor_nombre, conductor_numero_identificacion, bonos: [{ nombre, cantidad, valor_unitario, valor_total, liquidacion_id, periodo_end }], total }], total }`.
Consolida los bonos de todos los ciclos que solapan el mes; la tarifa es la del
ciclo con `periodo_end` más reciente.

### `GET /api/liquidaciones-terceros/anticipos-vehiculo`

**Respuesta 200** — `{ vehiculo: { id, placa }, anticipos: [{ id, concepto, fecha, valor }], total }`,
de las liquidaciones de nómina del vehículo que cierran dentro del mes.

## Conceptos, conductores y copropietarios

### `GET /api/liquidaciones-terceros/:id/conceptos`

Arreglo de los conceptos vivos del cierre, por `orden` y `concepto`, con
`conductor`. Un cierre inexistente devuelve `[]`.

### `PUT /api/liquidaciones-terceros/:id/conceptos`

**Body** `{ "conceptos": ConceptoInput[] }`: `tipo`
(`COSTO_LABORAL|GASTO_OPERATIVO|IMPUESTO|ANTICIPO`), `concepto`,
`conductor_id?`, `propietario_id?`, `dias?`, `valor_unitario?`, `porcentaje?`,
`valor_total?`, `base_calculo?`, `calculado?`, `observaciones?`, `orden?`, `id?`.

Reemplazo completo: marca los conceptos vivos y crea los recibidos. Se
deduplica por `(tipo, concepto, conductor_id, propietario_id)` y gana la última
ocurrencia; `dias: 0` se guarda como 0 (cero es un dato). Después recalcula los
totales (y, si es multi-propietario, los impuestos por copropietario).

**Respuesta 200** — arreglo de conceptos. 400 si `conceptos` no es un arreglo;
cierre inexistente → 500.

### `PUT /api/liquidaciones-terceros/:id/conductores`

**Body** `{ "conductores": [{ "conductor_id": "uuid", "dias": 30, "es_propietario": false }] }`:
la lista **completa** que debe quedar, no un delta.

Un conductor nuevo recibe su bloque (SALARIO, AUXILIO_TRANSPORTE,
BONIFICACION, BONIFICACION_TURNO_DOBLE, RECARGOS, prestaciones y seguridad
social); uno que sale se marca entero; a los que siguen solo se les cambian los
días de SALARIO y AUXILIO_TRANSPORTE. `es_propietario` reemplaza los overrides
del cierre: al propietario no se le imputan DOTACION ni EXAMEN_MEDICO. Siembra
los gastos de vehículo que falten y recalcula la cascada.

**Respuesta 200** — `{ agregados: [ids], eliminados: [ids], mes, anio, totales }`.

| Código | Cuándo |
|---|---|
| 400 | `conductores` no es arreglo, falta `conductor_id` o `dias` negativo o no numérico |
| 409 | Cierre inexistente o en estado bloqueado (el mensaje contiene «estado» o «no encontrado») |

### `POST /api/liquidaciones-terceros/:id/conceptos-fila` y `DELETE /api/liquidaciones-terceros/conceptos-fila/:conceptoId`

`POST` **Body** `{ tipo: "GASTO_OPERATIVO" | "ANTICIPO", concepto, dias, valor_unitario, observaciones? }`.
La fila nace en el servidor para que llegue con id y binding; el concepto se
normaliza a mayúsculas con guiones bajos y en ANTICIPOS `observaciones` lleva
la fecha. Los impuestos no se añaden así: salen de la configuración.
Responde `{ id, mes, anio, totales }`.

`DELETE` marca la fila (solo GASTO_OPERATIVO o ANTICIPO) y responde
`{ cierreId, mes, anio, totales }`.

| Código | Cuándo |
|---|---|
| 400 | `POST`: `tipo` distinto de los dos admitidos, `concepto` vacío, `dias`/`valor_unitario` no numéricos |
| 409 | Cierre o concepto inexistente, estado bloqueado, concepto ya presente en la sección, o tipo no eliminable |

### `GET /api/liquidaciones-terceros/:id/propietarios` y `PUT /api/liquidaciones-terceros/:id/propietarios`

`GET` responde `{ es_multi_propietario, propietarios: [{ id, tercero_id, nombre, identificacion, porcentaje, porcentaje_efectivo, nota, aplica_retenciones, orden, tercero, … }] }`;
404 si el cierre no existe.

`PUT` **Body** `{ "propietarios": [{ id?, tercero_id?, nombre, identificacion?, porcentaje, nota?, aplica_retenciones?, orden? }] }`.
Solo en BORRADOR. Con `id` actualiza, sin `id` crea, y los que faltan se marcan;
los de nombre vacío se descartan. Lista vacía desactiva el modo
multi-propietario y vuelve a las cuatro filas de impuesto globales. Recalcula
impuestos y totales y responde lo mismo que el `GET` más `anio` y `mes`.

| Código | Cuándo |
|---|---|
| 400 | `propietarios` no es un arreglo |
| 404 | Cierre inexistente |
| 409 | Cierre que no está en BORRADOR |

### `GET /api/liquidaciones-terceros/:id/calcular-impuestos`

Pese a ser `GET`, **escribe**. Con un propietario, calcula los impuestos
activos y, si el cierre está en BORRADOR o LIQUIDADA, actualiza en sitio la
fila de cada impuesto (empareja por concepto para conservar su `id`, que es lo
que atan las celdas del canvas), crea las que falten, marca las sobrantes y
actualiza `total_impuestos`. Responde el arreglo de impuestos calculados
`[{ tipo: "IMPUESTO", concepto, porcentaje, base_calculo, valor_total, calculado: true }]`.
Con copropietarios delega en el reparto por copropietario y responde todos los
conceptos vivos del cierre. Cierre inexistente → 500.

### `POST /api/liquidaciones-terceros/:id/recalcular-totales`

Sin body. Recalcula y persiste los totales (y los impuestos por copropietario
si aplica) y toma un snapshot. Responde
`{ valor_liquidar, total_costos_laborales, total_gastos_operativos, total_impuestos, total_descuentos, total_pagar }`.

## Ítems del pivote

### `PUT /api/liquidaciones-terceros/:id/items`

**Body** `{ "item_ids": ["uuid"] }` (ids de `liquidacion_tercero` vivos). Marca
los ítems vivos del pivote y reinserta los recibidos (los que vuelven se borran
antes de verdad, porque el único `(cierre, ítem)` cuenta también las filas
marcadas). Rechaza traer de vuelta un ítem trasladado. Recalcula totales, toma
snapshot y responde el detalle del cierre.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `item_ids` no es un arreglo | `{ "error": "…" }` |
| 500 | Cierre o ítems inexistentes, ítem trasladado y cualquier otro fallo | `{ "error": "<mensaje>", "stack": "<traza>" }` |

### `POST /api/liquidaciones-terceros/:id/refresh-items`

Sin body. Solo en BORRADOR. Añade al pivote las filas vivas de
`liquidacion_tercero` con la misma placa, `mes`, `anio` y tercero que el cierre
y que todavía no están en él (las quitadas a mano no se reactivan). Responde
`{ ok: true, agregados, ya_existentes, message }`; 404 si el cierre no existe,
409 si no es BORRADOR.

### `GET /api/liquidaciones-terceros/:id/items-disponibles` y `POST /api/liquidaciones-terceros/:id/items-agregar`

`GET` lista las filas de la **misma placa**, de cualquier mes y tercero, que no
están en ningún cierre vivo: `{ cierre: { id, placa, mes, anio, estado, consecutivo, editable }, disponibles: [{ id, placa, recorrido, fechas, mes, anio, tercero_id, tercero_nombre, otro_tercero, cliente_nombre, liquidacion_consecutivo, numero_planilla, numero_factura, valor_unitario, cantidad, total_facturado, valor_liquidar, … }], ocupados, total }`.
`otro_tercero` avisa de que el ítem iba con un propietario distinto al del
cierre. 404 si el cierre no existe o no tiene placa.

`POST` **Body** `{ "liquidacion_tercero_ids": ["uuid"] }`. Solo en BORRADOR;
cada id debe existir, ser de la placa del cierre y no estar en otro cierre vivo.
Responde `{ ok: true, agregados, message }`.

| Código | Cuándo |
|---|---|
| 400 | `liquidacion_tercero_ids` no es arreglo |
| 404 | Cierre inexistente |
| 409 | Cierre no BORRADOR, ítem de otra placa, ítem ya en otro cierre, ítems que ya no existen |

### `PATCH /api/liquidaciones-terceros/items/:pivoteId/aplica-impuestos` y `PATCH /api/liquidaciones-terceros/items/:pivoteId/excluir`

`aplica-impuestos` **Body** `{ "aplica_impuestos": true }`; `excluir` **Body**
`{ "excluir": true }` (explícito, no un toggle: `true` marca `deleted_at`,
`false` lo devuelve; idempotente). Las dos recalculan impuestos y totales y
responden el detalle del cierre (`excluir`, con `includeDeleted`). Un ítem
trasladado no se devuelve por `excluir`: hay que usar `revertir-traslado`. 400
si el campo no es booleano; pivote inexistente u otro fallo → 500.

### `POST /api/liquidaciones-terceros/items/:pivoteId/trasladar` y `POST /api/liquidaciones-terceros/items/:pivoteId/revertir-traslado`

`trasladar` **Body** `{ "destino": "OCASIONAL" | "INGRESOS" }`. Saca el ítem del
cierre y lo mete en el otro documento del mismo tercero en una sola operación,
**destino primero**: si el destino lo rechaza, el cierre no se toca. Los dos
destinos usan el **periodo del cierre**, no el de la liquidación de servicio.

- `OCASIONAL`: crea la fila en la liquidación ocasional del periodo (y la
  cabecera en BORRADOR si no existía).
- `INGRESOS`: marca INCLUIR en la hoja de ingresos del periodo (el ítem debe
  tener ingreso para la empresa, factura activa y no estar en un ocasional) y
  recalcula su cabecera.

El pivote queda con `deleted_at`, `trasladado_a`, `trasladado_at` y
`trasladado_por_id`. `revertir-traslado` (sin body) deshace el otro lado y
reactiva el pivote. Ambas recalculan impuestos y totales y responden
`{ ok: true, destino, destino_info, cierre }` (`cierre` con `includeDeleted`).

| Código | Cuándo |
|---|---|
| 400 | `destino` inválido |
| 404 | Pivote o cierre inexistente |
| 409 | Cierre no BORRADOR, ítem ya trasladado (o no trasladado, al revertir), ítem borrado, rechazo del destino y **cualquier otro error** |

## Estado, color y borrado

### `PATCH /api/liquidaciones-terceros/:id/estado`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | string | sí | `BORRADOR`, `LIQUIDADA`, `APROBADA`, `PAGADA` o `ANULADA` |
| `motivo_anulacion` | string | para ANULADA | |
| `base_version` | number | no | Compare-and-swap con `version`; sin ella el `UPDATE` solo exige que el estado no haya cambiado desde la lectura |
| `pago` | objeto | para PAGADA | `{ fecha: "AAAA-MM-DD", medio: TRANSFERENCIA\|CONSIGNACION\|CHEQUE\|EFECTIVO\|OTRO, referencia?, observaciones?, comprobante_s3_key?, comprobante_nombre? }` (ver [pagos](./liquidaciones-terceros-pagos.md)) |

El pago se registra en la **misma transacción** que el estado; volver de PAGADA
a APROBADA archiva el pago vivo. Toma un snapshot.

**Respuesta 200** — el cierre serializado con `version` (la nueva, para el
siguiente cambio), `estado_anterior`, `tercero`, `liquidacion` y `conceptos`.

**Errores** — `{ error, code, …detalle }`

| Código | `code` | Cuándo |
|---|---|---|
| 400 | — | Falta `estado` |
| 400 | `ESTADO_INVALIDO` | Estado fuera de la lista (FACTURADA ya no es destino) |
| 400 | `FALTA_MOTIVO` | ANULADA sin motivo |
| 400 | `FALTA_PAGO` | PAGADA sin `pago` válido; el mensaje es el primer error de validación |
| 403 | `SIN_PERMISO` | Entrar en APROBADA/PAGADA o salir de APROBADA/PAGADA/FACTURADA sin área Administración |
| 404 | `NO_ENCONTRADO` | Cierre inexistente o borrado |
| 409 | `TRANSICION_INVALIDA` | Transición no permitida; trae `estado_actual` |
| 409 | `VERSION_CONFLICT` | Otro usuario cambió el estado; trae `estado_servidor` y `version_servidor` |

### `POST /api/liquidaciones-terceros/estado-lote`

**Body** `{ anio, mes, hacia, desde?, ids?, motivo?, pago? }`: con `ids`
(máximo 1000) mueve esas hojas, cada una desde su estado; sin `ids` mueve todos
los cierres del periodo que estén en `desde`. No es una transacción única: cada
cierre pasa por la misma validación que el cambio individual y un fallo no
revierte los demás. Un mismo `pago` vale para todo el lote.

**Respuesta** — 200 si todo fue bien, **207** si alguno falló:
`{ total, cambiados: [{ id, estado, estado_anterior, version, anio, mes, placa, motivo_anulacion }], fallidos: [{ id, placa, error }] }`.
400 si faltan `anio`, `mes`, `hacia` y (`desde` o `ids`); los `ErrorEstado`
globales (destino inválido, transición `desde → hacia` imposible, falta de
área, pago inválido) responden antes de tocar ninguna hoja, como en el cambio
individual.

### `GET /api/liquidaciones-terceros/:id/historial-estados`

Arreglo, del más reciente al más antiguo:
`[{ id, estado_anterior, estado_nuevo, motivo, fecha, usuario: { id, nombre, correo } | null }]`.

### `PATCH /api/liquidaciones-terceros/:id/color-hoja`

**Body** `{ "color": "#RRGGBB" | "#RRGGBBAA" | null }` (`null` o `''` vuelve al
color automático del estado). Es una preferencia visual que se persiste para
que sobreviva a las recargas. Responde `{ id, color_hoja, anio, mes }`; 400 con
formato inválido, 404 si el cierre no existe.

### `DELETE /api/liquidaciones-terceros/:id`

Borrado lógico: marca la cabecera, sus ítems del pivote y sus conceptos con la
misma fecha. No se puede borrar un cierre APROBADA, PAGADA o FACTURADA: primero
hay que anularlo.

**Respuesta 200** — `{ ok: true, id, deleted_at, items_eliminados, conceptos_eliminados, anio, mes, placa, consecutivo }`.

| Código | Cuándo |
|---|---|
| 404 | Cierre inexistente o ya borrado |
| 409 | Cierre APROBADA, PAGADA o FACTURADA |

## Efectos

**Sockets** (ver [tiempo real](../tiempo-real.md)). La sala del libro es
`sheet:cierres-finales:<anio>:<mes>`:

| Evento | Destino | Cuándo |
|---|---|---|
| `sheet:invalidate` | sala del periodo | Copropietarios, conductores, alta o baja de fila de gastos/anticipos (cambian la geometría de la hoja) |
| `sheet:estado-changed` | sala del periodo | Cambio de estado (individual o lote), fuera de la transacción |
| `sheet:hoja-color` | sala del periodo | `color-hoja` |
| `sheet:sheet-removed` | sala del periodo | Borrado del cierre |
| `sheet:sheet-added` | sala del periodo | Cada cierre que persiste la cola con `persistir` |
| `row:updated` (`changes.itemsRefreshed`) | `row:liquidacion-tercero-final:<id>` | `refresh-items`, `items-agregar`, `trasladar`, `revertir-traslado` |
| `liquidacion-tercero:created` | todos (`io.emit`) | Alta de un cierre por `guardar-borrador` |
| `borrador:queued\|start\|progress\|complete\|cancelled\|error\|locked` | `user-<id>` | Progreso de la cola de borradores |
| `liquidaciones-terceros-save-bulk:start\|progress\|done` | `user-<id>` | Progreso del guardado masivo |

Por socket también se cancelan los jobs (`borrador:cancel` y
`liquidaciones-terceros-save-bulk:cancel`, en `src/queue/*.gateway.ts`), con la
identidad sacada del token.

**Snapshots.** Toman un snapshot del cierre, con su origen (`manual`,
`refresh-items`, `items-manuales`, `trasladar-item`, `revertir-traslado`):
crear un borrador, `PUT /:id/conceptos`, `PUT /:id/items`,
`PUT /:id/propietarios`, `POST /:id/recalcular-totales` y lo que pasa por él
(`aplica-impuestos`, `excluir`, traslados), `refresh-items`, `items-agregar` y
el cambio de estado individual. No lo toman los conductores, las filas de
gastos y anticipos, el lote de estados ni el color. Ver
[snapshots de cierres](./liquidaciones-terceros-snapshots.md). Un fallo del
snapshot no tumba la operación.

**Otros módulos.** `trasladar` y `revertir-traslado` escriben en la
[liquidación ocasional](./liquidaciones-terceros-ocasional.md) y en la
[hoja de ingresos](./liquidaciones-terceros-ingresos.md); pasar a PAGADA crea la
fila de [pago](./liquidaciones-terceros-pagos.md). Las escrituras que terminan
bien dejan fila en `registro_actividad` (ver [actividad](./actividad.md)).

## Observaciones

- **Rutas de escritura sin guarda de estado.** `PUT /:id/conceptos`,
  `PUT /:id/items`, `PATCH items/:pivoteId/aplica-impuestos`,
  `PATCH items/:pivoteId/excluir` y `POST /:id/recalcular-totales` no miran el
  estado del cierre: un cierre APROBADA o PAGADA se puede modificar por ellas,
  mientras que conductores, filas de gastos, copropietarios, `refresh-items`,
  `items-agregar` y los traslados sí lo rechazan.
- **Multi-propietario en estados cerrados.** El reparto de impuestos por
  copropietario marca las filas de impuesto automáticas sea cual sea el estado
  y solo las recrea en BORRADOR o LIQUIDADA. Sobre un cierre multi-propietario
  APROBADA o PAGADA, `GET /:id/calcular-impuestos` o
  `POST /:id/recalcular-totales` lo dejan sin esas filas, y el segundo además
  reescribe `total_impuestos` y `total_pagar`
  (`recalcularImpuestosPorPropietario` en `liquidaciones-terceros-descuentos.service.ts`).
- `GET /:id/calcular-impuestos` escribe en la base aunque sea un `GET`. En un
  cierre de un propietario actualiza `total_impuestos` pero no
  `total_descuentos` ni `total_pagar`: quedan desalineados hasta el siguiente
  recálculo.
- `PUT /:id/conceptos`: si el body trae el `id` de un concepto vivo (como los
  devuelve el `GET`), el `createMany` choca con la clave primaria de la fila
  recién marcada (P2002 → 500). Además la respuesta no filtra `deleted_at` y
  devuelve también los conceptos que acaba de retirar. La respuesta de
  `PATCH /:id/estado` tampoco filtra los conceptos borrados.
- `PUT /:id/items` devuelve en el 500 la **traza** del error (`stack`).
- `refresh-items` filtra por `liquidacion_tercero.mes`/`anio`, columnas que
  ningún camino de escritura actual rellena (lo dice el propio
  `liquidaciones-terceros-ingresos.service.ts`); para filas creadas por el
  código actual no encuentra candidatos. `items-disponibles` sí cae al periodo
  de la liquidación de servicio.
- `guardar-borrador` no comprueba que los `item_ids` estén ya en otro cierre
  vivo (`items-agregar` sí): generar dos veces el mismo periodo deja dos
  BORRADOR con los mismos ítems.
- `GET /anticipos-vehiculo` no filtra `anticipos.deleted_at`: devuelve también
  anticipos retirados de la nómina.
- La placa se busca con `contains` en las tres rutas de nómina: una placa que
  sea subcadena de otra puede resolver al vehículo equivocado.
- Errores que salen como 500 aunque son de cliente: cierre inexistente en el
  detalle, en `PUT /:id/conceptos`, en `calcular-impuestos` y en
  `recalcular-totales`; vehículo inexistente en las rutas de nómina; pivote
  inexistente en `aplica-impuestos` y `excluir`, o trasladado en `excluir`. En
  los traslados
  ocurre lo contrario: cualquier error inesperado (incluido uno de base de
  datos) sale como **409**.
- En `listar` del historial, `numero_factura` sale siempre vacío: el `select`
  no incluye la liquidación de servicio de la que se lee.
- `PUT /:id/propietarios` actualiza por `id` sin comprobar que el copropietario
  sea de ese cierre.
- `DELETE …/save-bulk-job/:batchId` marca el job como fallido y emite `done`,
  pero el bucle no lo mira: sigue guardando las placas restantes y al final
  vuelve a fijar el estado y a emitir `done`.
- `GET …/borrador-status/:jobId` no comprueba el dueño: cualquiera con el
  permiso y el `jobId` lee el payload y la previsualización de otro usuario.
- `PUT /api/configuracion-descuentos-tercero` cambia porcentajes de todos los
  cierres futuros con el mismo nivel `limited` que editar una hoja.
- `PATCH /:id/color-hoja` actualiza por `id` sin filtrar `deleted_at`: pinta
  también un cierre borrado.
