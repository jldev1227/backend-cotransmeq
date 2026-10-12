# Versiones de la liquidación ocasional

`/api/liquidaciones-terceros-ocasional/:id/snapshots`, `/api/liquidaciones-terceros-ocasional-snapshots/cron-hora` · código en [`src/modules/liquidaciones-terceros-ocasional-snapshots/`](../../src/modules/liquidaciones-terceros-ocasional-snapshots/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Historial inmutable de una [liquidación ocasional](./liquidaciones-terceros-ocasional.md)
(`liquidacion_tercero_ocasional_snapshot`). Cada snapshot guarda en `payload`
la cabecera, los totales, el estado, los ítems, adicionales y conceptos vivos,
los cierres de origen de sus ítems y las anotaciones del canvas de ese mes;
`diff` resume los cambios respecto al anterior. La versión es un contador por
cabecera que se reserva bajo advisory lock (`src/utils/snapshot-version.ts`).
Origen `manual`, `auto` (cron) o `revert`. Una captura `auto` cuyo contenido es
idéntico al último snapshot no se inserta.

Revertir sustituye ítems, adicionales y conceptos por los del snapshot (los
que vuelven se borran en duro antes de reinsertarse, porque los únicos cuentan
también las filas marcadas), restaura observaciones y totales de la cabecera,
restaura las anotaciones y crea un snapshot `revert`. Los ítems que hoy están
vivos en un cierre final no vuelven.

**El estado y el motivo de anulación NO se restauran**: se quedan los de hoy.
Copiarlos del snapshot saltaba las transiciones y el área (una ANULADA volvía
a BORRADOR, una LIQUIDADA a APROBADA con nivel `limited`); el estado se cambia
con `PATCH /api/liquidaciones-terceros-ocasional/:id/estado`
([liquidaciones-terceros-ocasional](./liquidaciones-terceros-ocasional.md)).
Solo se revierte una cabecera viva y editable (BORRADOR o LIQUIDADA):
`ESTADOS_OCASIONAL_NO_EDITABLES` de
[`estado-ocasional.ts`](../../src/modules/liquidaciones-terceros-ocasional/estado-ocasional.ts)
son APROBADA, FACTURADA, ANULADA y REEMPLAZADA. La cabecera se reescribe con el
estado leído en el `WHERE`: si alguien lo cambió entretanto, se deshace todo.

## Acceso

| Operación | Guarda |
|---|---|
| Todas menos el cron | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros:limited` (`permisoPorMetodo`) |
| `POST` | `liquidaciones-terceros:limited` |
| `POST …/cron-hora` | Solo `x-cron-secret` igual a `CRON_SECRET` (`cronAutorizado`, comparación en tiempo constante); sin `CRON_SECRET` configurado, rechaza siempre. No pide sesión ni permiso: el hook `onRequest` se salta esta ruta y `permisoPorMetodo` la deja en `excepto` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots` | `liquidaciones-terceros:limited` | Lista las versiones de una cabecera |
| POST | `/api/liquidaciones-terceros-ocasional/:id/snapshots` | `liquidaciones-terceros:limited` | Captura manual |
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId` | `liquidaciones-terceros:limited` | Un snapshot con su `payload` |
| GET | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/diff` | `liquidaciones-terceros:limited` | Compara dos snapshots campo a campo |
| POST | `/api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/revertir` | `liquidaciones-terceros:limited` | Restaura la cabecera a un snapshot |
| POST | `/api/liquidaciones-terceros-ocasional-snapshots/cron-hora` | `x-cron-secret` | Captura horaria de todas las cabeceras activas |

### `GET /api/liquidaciones-terceros-ocasional/:id/snapshots`

**Query**: `rama` (opcional; `main` es la vigente).

**Respuesta 200** — arreglo, de la versión más alta a la más baja:
`[{ id, version, rama, origen, revertido_de_id, usuario: { id, nombre, correo } | null, created_at, diff, meta }]`.
`meta` = `{ capturado_en, capturado_por, version_origen, items_count, adicionales_count, conceptos_count }`.
Cualquier fallo responde 500.

### `POST /api/liquidaciones-terceros-ocasional/:id/snapshots`

Sin body. Captura con origen `manual` y el usuario del token. Responde **200**
con la fila creada más `payload`, `diff` y `omitido: false`. 404 si la cabecera
no existe.

### `GET /api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId`

El snapshot completo (con `payload` y `usuario`) si pertenece a esa cabecera; 404
`{ "error": "Snapshot no encontrado" }` si no.

### `GET /api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/diff`

**Query**: `con` (obligatorio, id del otro snapshot). Responde
`{ fields: [{ path, anterior, nuevo }] }`, donde `anterior` es el valor en
`:snapshotId` y `nuevo` el valor en `con`. 400 `Falta el parámetro 'con'`; 404 si
alguno no existe.

### `POST /api/liquidaciones-terceros-ocasional/:id/snapshots/:snapshotId/revertir`

Sin body. Responde el snapshot `revert` recién creado (fila + `payload`,
`diff`, `omitido`) más `estado_conservado` (el de la cabecera, que no cambió)
y `estado_del_snapshot` (el que guardaba la versión restaurada).

| Código | Cuándo |
|---|---|
| 401 | Sin id de usuario en el token |
| 404 | Snapshot inexistente, o cabecera inexistente o en la papelera |
| 409 | Cabecera APROBADA, FACTURADA, ANULADA o REEMPLAZADA, o que cambió de estado durante la reversión |
| 500 | Cualquier otro fallo |

### `POST /api/liquidaciones-terceros-ocasional-snapshots/cron-hora`

Sin body. Captura las cabeceras vivas en BORRADOR o LIQUIDADA, saltándose las
que tienen una captura `auto` dentro de la ventana antirrebote.

**Respuesta 200** — `{ total, capturadas, omitidas, results: [{ id, ok, version?, omitido?, error? }] }`.
401 `{ "error": "Unauthorized" }` si la cabecera falta o no coincide, o si no
hay `CRON_SECRET`.

## Efectos

- Revertir emite `sheet:reverted` a la sala `sheet:ocasional:<anio>` (a todos,
  emisor incluido) y sube el `epoch` del periodo, con lo que se rechazan los
  patches que estuvieran en vuelo (ver [tiempo real](../tiempo-real.md)).
- Revertir restaura las [anotaciones del canvas](./canvas-anotaciones.md) del
  mes fuera de la transacción: si fallan, el revert de los importes se mantiene.
- El mismo `capturarHorario` corre in-process cada hora a los :15
  (`src/jobs/snapshot-liquidaciones-mensual.job.ts`, ver
  [tareas programadas](../tareas-programadas.md)); el endpoint es un segundo
  disparador, y el antirrebote absorbe el doble disparo.

## Observaciones

- `diff` compara dos snapshots cualesquiera: no comprueba que pertenezcan a la
  cabecera `:id`.
- El cron de cierres responde 403 con la cabecera mala; este responde 401.
