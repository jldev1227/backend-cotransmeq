# Adicionales de cierres de terceros

`/api/liquidaciones-terceros-adicionales` · código en [`src/modules/liquidaciones-terceros-adicionales/`](../../src/modules/liquidaciones-terceros-adicionales/) · permiso [`liquidaciones-terceros-adicionales`](../permisos.md#catálogo-de-módulos)

Un **adicional** es una fila de un [cierre](./liquidaciones-terceros-descuentos.md)
que no sale de un servicio facturado: un pago manual al propietario
(`liquidacion_tercero_final_adicional`). Este módulo los expone **por periodo**
para el canvas anual de adicionales (una hoja por mes con las filas de todos
los cierres del mes). Las filas viven en tabla con UUID estable desde que
sustituyeron al JSONB `liquidacion_tercero_final.adicionales`, que identificaba
cada fila por su posición y hacía que dos usuarios se pisaran.

Reglas: `valor_admin = round(valor_unitario × cantidad × porcentaje_admin / 100)`
y `valor_liquidar = bruto − valor_admin` se derivan **siempre en el servidor**
(el canvas las espeja con fórmulas). Cada fila suma al `valor_liquidar` de su
cierre; con `aplica_impuestos` entra además en la base de ICA, avisos,
bomberil y retención en la fuente. La edición es por celda con concurrencia
optimista: el `PATCH` exige `base_version` y responde 409 con la fila del
servidor si otro escribió antes. Un cierre APROBADA, PAGADA, FACTURADA o ANULADA
no admite cambios en sus adicionales. Ver
[liquidaciones de terceros](./liquidaciones-terceros.md) para el reparto del
dominio.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros-adicionales:limited` (`preHandler` por ruta) |
| `POST`, `PATCH`, `DELETE`, `PUT` | `liquidaciones-terceros-adicionales:limited`: facturación y contabilidad también editan |

`liquidaciones-terceros-adicionales` es un módulo propio en `ROUTE_PERMISSIONS`
con las mismas áreas que `liquidaciones-terceros`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros-adicionales/anual` | `liquidaciones-terceros-adicionales:limited` | Adicionales de los 12 meses de un año |
| GET | `/api/liquidaciones-terceros-adicionales` | `liquidaciones-terceros-adicionales:limited` | Adicionales de un mes |
| POST | `/api/liquidaciones-terceros-adicionales` | `liquidaciones-terceros-adicionales:limited` | Crea una fila al final de un cierre |
| PATCH | `/api/liquidaciones-terceros-adicionales/:id` | `liquidaciones-terceros-adicionales:limited` | Cambia un campo de una fila (compare-and-swap) |
| DELETE | `/api/liquidaciones-terceros-adicionales/:id` | `liquidaciones-terceros-adicionales:limited` | Borrado lógico de una fila |
| PUT | `/api/liquidaciones-terceros-adicionales` | `liquidaciones-terceros-adicionales:limited` | **Deprecado**: guardado en lote de un periodo |

### Forma de una fila

Todas las rutas que devuelven filas usan esta forma (`AdicionalListado`):

```json
{ "id": "uuid", "cierre_id": "uuid", "cierre_consecutivo": "LIQ-TERC-2026-00012",
  "placa": "ABC123", "tercero_id": "uuid", "tercero_nombre": "…",
  "estado": "BORRADOR", "cliente": "TRANSMERALDA", "recorrido": "…", "fechas": "…",
  "valor_unitario": 450000, "cantidad": 1, "porcentaje_admin": 0, "valor_admin": 0,
  "valor_liquidar": 450000, "aplica_impuestos": true, "orden": 0, "version": 3 }
```

`estado` es el del **cierre**, no de la fila: el canvas lo usa para saber si es
editable. `placa`, `tercero_id` y `tercero_nombre` caen a los del cierre si la
fila no los tiene.

### `GET /api/liquidaciones-terceros-adicionales/anual` y `GET /api/liquidaciones-terceros-adicionales`

- `anual?anio=` → `{ anio, meses: { "1": [...], …, "12": [...] }, total }`,
  siempre con las 12 claves.
- `?mes=&anio=` → `{ items: [...], total }`.

Solo filas vivas de cierres vivos (de cualquier estado), por consecutivo del
cierre y luego `orden`. 400 si `mes` o `anio` no pasan la validación zod.

### `POST /api/liquidaciones-terceros-adicionales`

**Body** (zod `crearAdicionalSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cierre_id` | uuid | sí | Cierre editable y vivo |
| `cliente` | string ≤ 255 | no | `"TRANSMERALDA"` por defecto |
| `placa` | string ≤ 20 | no | Vacía por defecto (se muestra la del cierre) |
| `tercero_id`, `vehiculo_id` | uuid \| null | no | |
| `tercero_nombre` | string ≤ 255 \| null | no | |
| `recorrido` | string ≤ 500 \| null | no | |
| `fechas` | string ≤ 100 \| null | no | |
| `valor_unitario`, `porcentaje_admin` | number | no | 0 por defecto |
| `cantidad` | number | no | 1 si falta o es 0 |
| `aplica_impuestos` | boolean | no | `true` por defecto |

**Respuesta 201** — la fila creada. Recalcula los totales del cierre en la
misma transacción.

### `PATCH /api/liquidaciones-terceros-adicionales/:id`

**Body** `{ field, value, base_version }`

| Campo | Tipo | Notas |
|---|---|---|
| `field` | string | Lista blanca: `valor_unitario`, `cantidad`, `porcentaje_admin`, `aplica_impuestos`, `cliente`, `recorrido`, `fechas` |
| `value` | string \| number \| boolean \| null | |
| `base_version` | entero ≥ 1 | Obligatorio: sin él no habría compare-and-swap |

El `UPDATE` exige `version = base_version` e incrementa la versión; al cambiar
un importe se rederivan `valor_admin` y `valor_liquidar`. Recalcula los totales
del cierre. Responde la fila actualizada.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `:id` no es UUID, `field` fuera de la lista blanca o body inválido | `{ "error": "Payload inválido", "detalles": [{ "campo", "mensaje" }] }` |
| 404 | Fila o cierre inexistente | `{ "error": "Adicional … no encontrado" }` |
| 409 | Cierre bloqueado | `{ "error": "No se pueden modificar los adicionales de un cierre en estado …" }` |
| 409 | Otro usuario escribió antes | `{ "error": "La fila fue modificada por otro usuario", "code": "VERSION_CONFLICT", "entity_id", "server_row" }` |

### `DELETE /api/liquidaciones-terceros-adicionales/:id`

Marca `deleted_at` (y sube la versión), recalcula los totales del cierre y
responde `{ "ok": true }`. Mismos 400/404/409 que el `PATCH`.

### `PUT /api/liquidaciones-terceros-adicionales`

Deprecado: el canvas ya usa `POST`/`PATCH`/`DELETE` por fila; se conserva un
ciclo para clientes viejos. **Body** `{ mes, anio, items: [{ id, cierre_id, valor_unitario, cantidad, porcentaje_admin, aplica_impuestos, cliente, recorrido, fechas }] }`.
Solo **actualiza** las filas existentes y vivas de cada cierre (no crea ni
borra), sin compare-and-swap, y valida que cada cierre sea del periodo y
editable. Los ítems sin `id` o sin `cierre_id` se ignoran.

**Respuesta 200** — `{ ok: true, actualizados, cierres }`. 400 si un cierre es
de otro periodo (`… pertenece a M/AAAA …`); 404/409 como arriba; todo o nada
(una transacción).

## Efectos

- Toda escritura emite `sheet:invalidate` a la sala anual
  `sheet:adicionales:<anio>` (`{ scope: "adicionales", mes, anio, updatedBy, updatedAt, accion, … }`)
  para que los demás relean el mes, y `row:updated:global` a todos por cada
  cierre tocado (ver [tiempo real](../tiempo-real.md)).
- Toda escritura recalcula y persiste los totales del cierre con
  `totales-cierre.ts` (fuente única, compartida con [descuentos](./liquidaciones-terceros-descuentos.md)).
- Las filas aparecen también en la [hoja de ingresos](./liquidaciones-terceros-ingresos.md)
  del mes del cierre, con ingreso negativo para la empresa.
- Versiones por periodo en [snapshots de adicionales](./liquidaciones-terceros-adicionales-snapshots.md).
- Las escrituras que terminan bien dejan fila en `registro_actividad` (ver
  [actividad](./actividad.md)).

## Observaciones

- Editar un adicional recalcula los **totales** del cierre pero no sus filas de
  IMPUESTO: cambiar un importe o `aplica_impuestos` deja las retenciones sobre
  la base anterior hasta que algo llame a `calcularImpuestos`.
- La lista de estados bloqueados de este módulo no incluye REEMPLAZADA: los
  adicionales de un cierre reemplazado se siguen editando, cuando el resto del
  módulo de cierres lo trata como bloqueado.
- El mapeo de errores es por texto del mensaje (`statusDeError` en el
  controlador): cualquier error cuyo mensaje mencione un estado sale como 409.
- **`cliente` por defecto es `TRANSMERALDA`**, el nombre de la otra empresa: lo
  ponen el alta y el `PUT` de este módulo, el `@default` de la columna en
  `schema.prisma` y también los adicionales de `guardar-borrador` en
  [cierres](./liquidaciones-terceros-descuentos.md) y en el
  [ocasional](./liquidaciones-terceros-ocasional.md). Una fila creada sin
  `cliente` sale con ese texto en la hoja y en el PDF.
