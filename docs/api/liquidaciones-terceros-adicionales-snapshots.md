# Versiones de adicionales por periodo

`/api/liquidaciones-terceros-adicionales/snapshots` · código en [`src/modules/liquidaciones-terceros-adicionales-snapshots/`](../../src/modules/liquidaciones-terceros-adicionales-snapshots/) · permiso [`liquidaciones-terceros-adicionales`](../permisos.md#catálogo-de-módulos)

Historial de los [adicionales](./liquidaciones-terceros-adicionales.md) de un
**periodo** (`liquidacion_tercero_adicional_periodo_snapshot`). A diferencia de
los snapshots del ocasional o de un cierre, aquí no hay cabecera a la que
colgarse: los adicionales de un mes pertenecen a varios cierres, así que la
identidad es `(anio, mes, version)` y el `payload` guarda cada fila viva con su
`cierre_id`: `{ periodo: { anio, mes }, filas: [...], totales: { filas, cierres, suma_valor_liquidar }, meta }`.
La versión se reserva bajo advisory lock; una captura `auto` idéntica a la
anterior no se inserta.

Revertir marca las filas vivas de todos los cierres **editables** del periodo,
reinserta las del snapshot y recalcula `valor_liquidar` y `total_pagar` de
esos cierres. Los cierres APROBADA, PAGADA, FACTURADA o ANULADA se saltan y se
devuelven en `cierres_omitidos`: revertir no puede ser una vía indirecta para
tocarlos.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros-adicionales:limited` (`preHandler` por ruta) |
| `POST` | `liquidaciones-terceros-adicionales:limited` |

No hay endpoint de cron: la captura automática solo corre in-process.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros-adicionales/snapshots` | `liquidaciones-terceros-adicionales:limited` | Versiones de un periodo |
| POST | `/api/liquidaciones-terceros-adicionales/snapshots` | `liquidaciones-terceros-adicionales:limited` | Captura manual de un periodo |
| GET | `/api/liquidaciones-terceros-adicionales/snapshots/:id` | `liquidaciones-terceros-adicionales:limited` | Un snapshot con su `payload` |
| GET | `/api/liquidaciones-terceros-adicionales/snapshots/:id/diff` | `liquidaciones-terceros-adicionales:limited` | Diff contra otro snapshot o contra el anterior |
| POST | `/api/liquidaciones-terceros-adicionales/snapshots/:id/revertir` | `liquidaciones-terceros-adicionales:limited` | Restaura el periodo a un snapshot |

### `GET /api/liquidaciones-terceros-adicionales/snapshots`

**Query**: `anio` (2000–2100) y `mes` (1–12), obligatorios; 400
`Se requiere anio y mes válidos` si no.

**Respuesta 200** — `{ anio, mes, snapshots: [{ id, version, rama, origen, revertido_de_id, usuario, created_at, diff, meta, totales }] }`,
de la versión más alta a la más baja.

### `POST /api/liquidaciones-terceros-adicionales/snapshots`

**Body** `{ anio, mes }` (enteros, `mes` 1–12; 400 si no). Captura con origen
`manual` y el usuario del token. **Respuesta 201** — la fila creada más
`payload`, `diff` y `omitido`.

### `GET /api/liquidaciones-terceros-adicionales/snapshots/:id`

El snapshot completo con `usuario`; 404 si no existe.

### `GET /api/liquidaciones-terceros-adicionales/snapshots/:id/diff`

**Query**: `vs` (opcional). Con `vs`, compara contra ese snapshot; sin él,
contra la versión inmediatamente anterior del mismo periodo. Responde
`{ fields: [{ path, anterior, nuevo }] }` (`anterior` = el otro snapshot,
`nuevo` = `:id`); sin snapshot con el que comparar, `{ fields: [] }`. 404 si
`:id` no existe.

### `POST /api/liquidaciones-terceros-adicionales/snapshots/:id/revertir`

Sin body. Responde el snapshot `revert` recién creado más
`{ restauradas, cierres_afectados, cierres_omitidos: [{ id, consecutivo, estado }] }`.
401 sin usuario en el token; 404 si el snapshot no existe; 500 el resto.

## Efectos

- Revertir emite `sheet:reverted` a la sala `sheet:adicionales:<anio>` (a
  todos, emisor incluido) y sube el `epoch` del periodo (ver
  [tiempo real](../tiempo-real.md)).
- Captura automática cada hora a los :35 (`src/jobs/snapshot-adicionales-periodo.job.ts`,
  ver [tareas programadas](../tareas-programadas.md)), solo de los periodos con
  adicionales tocados en las últimas 24 h; si la tabla de snapshots aún no
  existe (migración pendiente), el job se omite con un aviso.

## Observaciones

- **Revertir no restaura las filas.** Reinserta las filas del snapshot con su
  `id` original y `skipDuplicates: true`, pero esas filas siguen en la tabla
  —marcadas justo antes, en la misma transacción—, así que el insert se las
  salta en silencio. El resultado es que los cierres editables del periodo se
  quedan **sin** adicionales y sus totales se recalculan así; `restauradas`
  informa las filas que se intentaron, no las que entraron. El módulo de
  snapshots del ocasional tuvo el mismo fallo y lo resolvió borrando antes las
  filas que vuelven (`liquidaciones-terceros-adicionales-snapshots.service.ts`).
- El recálculo de totales del revert va aparte de `totales-cierre.ts`: suma la
  tabla sin caer al JSONB y no toca impuestos ni descuentos.
- La lista de estados bloqueados no incluye REEMPLAZADA.
