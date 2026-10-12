# Versiones de cierres de terceros

`/api/liquidaciones-terceros/:id/snapshots`, `/api/liquidaciones-terceros-snapshots/cron-hora` · código en [`src/modules/liquidaciones-terceros-snapshots/`](../../src/modules/liquidaciones-terceros-snapshots/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Historial inmutable de un [cierre](./liquidaciones-terceros-descuentos.md)
(`liquidacion_tercero_final_snapshot`): deshacer y trazabilidad campo a campo.
Cada snapshot guarda en `payload` la cabecera, los totales, el estado y el
motivo de anulación, el JSONB `adicionales`, los ítems vivos del pivote
(`liquidacion_tercero_id`, `orden`), los conceptos vivos y el color de la
pestaña; `diff` resume los cambios respecto al anterior (salvo en las capturas
`auto`). La versión es un contador por cierre reservado bajo advisory lock
(`src/utils/snapshot-version.ts`). Orígenes: `manual`, `auto` (cron), `revert`,
`refresh-items`, `items-manuales`, `trasladar-item` y `revertir-traslado`. Las
capturas las disparan las escrituras del módulo de cierres; aquí solo se
listan, comparan y revierten, más el disparador del cron.

Revertir marca los ítems y conceptos vivos y reinserta los del snapshot (los
ítems que vuelven se borran antes en duro, porque el único `(cierre, ítem)`
cuenta también las filas marcadas), restaura totales, el JSONB de adicionales
y el color, y crea un snapshot `revert`. Los ítems que hoy están
**trasladados** fuera del cierre no se restauran: reinsertarlos los pagaría
aquí y en su destino.

**El estado y el motivo de anulación NO se restauran**: se quedan los de hoy.
Copiarlos del snapshot saltaba la máquina de estados de
[`cierre-estado.service.ts`](../../src/modules/liquidaciones-terceros-descuentos/cierre-estado.service.ts)
y sus reglas de área (un ANULADA volvía a BORRADOR, un LIQUIDADA a APROBADA con
nivel `limited`); el estado se cambia por su ruta. Y solo se revierte un cierre
vivo y **editable**, BORRADOR o LIQUIDADA: los `ESTADOS_BLOQUEADOS` de esa
máquina (APROBADA, PAGADA, FACTURADA, ANULADA, REEMPLAZADA) son los que el
canvas deja en solo lectura, y revertir es editar. La cabecera se reescribe con
el estado leído en el `WHERE`: si alguien lo cambió entretanto, no se aplica
nada.

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
| GET | `/api/liquidaciones-terceros/:id/snapshots` | `liquidaciones-terceros:limited` | Versiones de un cierre |
| GET | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId` | `liquidaciones-terceros:limited` | Un snapshot con su `payload` |
| GET | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId/diff` | `liquidaciones-terceros:limited` | Compara dos snapshots campo a campo |
| POST | `/api/liquidaciones-terceros/:id/snapshots/:snapshotId/revertir` | `liquidaciones-terceros:limited` | Restaura el cierre a un snapshot |
| POST | `/api/liquidaciones-terceros-snapshots/cron-hora` | `x-cron-secret` | Captura horaria de todos los cierres activos |

### `GET /api/liquidaciones-terceros/:id/snapshots`

**Query**: `rama` (opcional; `main` es la vigente).

**Respuesta 200** — arreglo de la versión más antigua a la más reciente:
`[{ id, version, rama, origen, revertido_de_id, usuario: { id, nombre, correo } | null, created_at, diff, meta }]`,
con `meta = { capturado_en, capturado_por, version_origen, items_pivote_count, conceptos_count }`.

### `GET /api/liquidaciones-terceros/:id/snapshots/:snapshotId`

El snapshot completo (con `payload` y `usuario`) si pertenece a ese cierre; 404
`{ "error": "Snapshot no encontrado" }` si no.

### `GET /api/liquidaciones-terceros/:id/snapshots/:snapshotId/diff`

**Query**: `con` (obligatorio, id del otro snapshot). Responde
`{ fields: [{ path, anterior, nuevo }] }` con `anterior` = valor en
`:snapshotId` y `nuevo` = valor en `con`. 400
`Se requiere query param ?con=<snapshotId>`; 404 si alguno no existe.

### `POST /api/liquidaciones-terceros/:id/snapshots/:snapshotId/revertir`

Sin body. Responde el snapshot `revert` recién creado (fila + `payload`,
`diff`, `omitido`) más `estado_conservado` (el estado del cierre, que no
cambió) y `estado_del_snapshot` (el que guardaba la versión restaurada), para
que la pantalla avise si no coinciden.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 401 | Sin id de usuario en el token | `{ "error": "Usuario no autenticado" }` |
| 404 | Snapshot que no es de ese cierre, o cierre inexistente o en la papelera | `{ "error": "Snapshot no encontrado" \| "Cierre no encontrado" }` |
| 409 | Cierre APROBADA, PAGADA, FACTURADA, ANULADA o REEMPLAZADA, o que cambió de estado durante la reversión | `{ "error": "<mensaje>" }` |
| 400 | Otro fallo (base de datos) | `{ "error": "<mensaje>" }` |

### `POST /api/liquidaciones-terceros-snapshots/cron-hora`

Sin body. Captura con origen `auto` todos los cierres vivos que no estén
ANULADA, saltándose los que tienen una captura `auto` dentro de la ventana
antirrebote y los que no cambiaron desde el último snapshot.

**Respuesta 200** — `{ ok, omitidos, errors }` (contadores). 403
`{ "error": "No autorizado" }` si la cabecera falta o no coincide, o si no hay
`CRON_SECRET`.

## Efectos

- El mismo `capturarHorario` corre in-process cada hora a los :05
  (`src/jobs/snapshot-liquidaciones.job.ts`, ver
  [tareas programadas](../tareas-programadas.md)); el endpoint es un segundo
  disparador y el antirrebote absorbe el doble disparo.
- Revertir no emite eventos de socket ni deja fila en el historial de estados.
- `cron-hora` está excluido del registro de actividad.

## Observaciones

- El `payload` no guarda la tabla `liquidacion_tercero_final_adicional`, el
  `propietario_id` de los conceptos ni el `aplica_impuestos` de los ítems:
  revertir restaura los adicionales solo en el JSONB heredado, deja las filas de
  impuesto de un cierre multi-propietario sin su copropietario y reinserta los
  ítems con `aplica_impuestos: true`.
- El `payload` guarda `dias`, `porcentaje` y `base_calculo` en 0 como `null`
  (`c.dias ? … : null`), y así vuelven al revertir: es el «cero es un dato» que
  `guardarConceptos` corrigió en descuentos (una BONIFICACION de 0 bonos sale
  con la cantidad en blanco en el PDF).
- `diff` compara dos snapshots cualesquiera: no comprueba que pertenezcan al
  cierre `:id`.
