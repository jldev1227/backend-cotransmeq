# Canvas de recorridos

`/api/recorridos/canvas`, `/api/recorridos/snapshots`, `/api/recorridos-snapshots/cron-hora` · código en [`src/modules/recorridos-canvas/`](../../src/modules/recorridos-canvas/) · permiso [`recorridos`](../permisos.md#catálogo-de-módulos)

La hoja de cálculo (Univer) donde Operaciones revisa y corrige los recorridos que
los conductores registran día a día en
[días laborados](./dias-laborados.md): `registro_dia_laboral` (el día) →
`registro_dia_laboral_segmento` (cada recorrido o tramo) →
`registro_dia_laboral_bono` (los bonos marcados). Un libro por corte, una hoja
por conductor y una fila por recorrido, o por día sin recorridos (DISPONIBLE,
DESCANSO o MANTENIMIENTO).

La hoja alimenta la nómina: los bonos que se marcan aquí son los que el
[canvas de nómina](./nomina-canvas.md) siembra en las `bonificaciones` de cada
liquidación. Por eso es un módulo de permiso propio, `recorridos`, y no
`conductores`, que es `general: true`: editarla es una operación contable, no
una consulta.

Reglas que un integrador necesita saber:

- **El corte, no el mes.** El libro se pide con dos fechas libres (`desde`,
  `hasta`, `AAAA-MM-DD`, como mucho 92 días). Sin fechas se sirve el corte
  21→20 vivo: hasta el día 27 de cada mes, el que cierra el 20 de ese mes; desde
  el 28, el del mes siguiente (siete días de gracia para terminar de revisar el
  que cerró). El periodo del libro (`anio`, `mes`) es el mes en que **cierra**
  el corte (el de `hasta`): identifica la sala del socket y los snapshots.
- **Por REST solo cambia la forma de la hoja.** Alta y baja de filas van por
  esta API y devuelven la fila entera; la edición celda a celda va por socket
  (`sheet:patch` con scope `recorridos`, ver [tiempo real](../tiempo-real.md)),
  que comprueba los permisos con la misma función (`RecorridosPatchService.puedeEditar`).
  Los campos editables son una lista blanca.
- **Bonos.** Las columnas son las `configuraciones_liquidacion` del año de tipo
  `VALOR_NUMERICO`, activas y no ocultadas en `bono_config_visual` (sin fila, se
  ven). Marcar crea una fila de `registro_dia_laboral_bono` con el `valor` de la
  configuración congelado; desmarcar le pone `deleted_at`. Marcar exige el
  permiso individual `bonos-planilla`. La nómina paga cada bono con el valor
  vigente de la configuración, no con el congelado en la marca.
- **Borrado lógico.** Retirar un recorrido retira sus bonos; retirar el último
  recorrido de un día LABORADO retira el día. La unicidad `(conductor_id, fecha)`
  es global, así que un día retirado se **revive** al volver a crearlo.
- **Concurrencia.** Cada fila lleva `version` (la del segmento si es un
  recorrido, la del día si no); un `base_version` que no coincide da 409 con la
  fila del servidor.

## Acceso

| Operación | Guarda |
|---|---|
| `GET /api/recorridos/canvas*`, `GET /api/recorridos/snapshots*` | `sesión` (hook `onRequest`) y `recorridos:read` |
| Alta y baja de filas, capturar y revertir snapshots | `sesión`, `recorridos:full` y `requireRecorridosEdicion` (`recorridos.middleware.ts`), que vuelve a exigir `full` con `checkAccess` y responde 403 incluso con `PERMISSIONS_MODE=warn` |
| `POST /api/recorridos/canvas/filas` con `bonos` | `+ bonos-planilla`, comprobado dentro del servicio (`RecorridosPatchService.puedeMarcarBonos`, que lee `usuarios.permisos` de la base), no con `bonos.middleware.ts` |
| `POST /api/recorridos-snapshots/cron-hora` | `x-cron-secret`, comparado con `CRON_SECRET` en tiempo constante (`cronAutorizado`, `src/lib/cron-secreto.ts`). Va en un plugin aparte (`recorridosSnapshotsCronRoutes`) sin `authMiddleware`; sin `CRON_SECRET` configurado responde siempre 403 |

`recorridos` da `full` a `administracion` y `operaciones`, y `read` a
`contabilidad`, `facturacion`, `talento_humano`, `hseq` y `mantenimiento`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/recorridos/canvas` | `recorridos:read` | El libro de un corte |
| GET | `/api/recorridos/canvas/bonos` | `recorridos:read` | Columnas de bono de un año |
| GET | `/api/recorridos/canvas/placas` | `recorridos:read` | Placas de la flota, para validar lo que se teclea |
| POST | `/api/recorridos/canvas/filas` | `recorridos:full` (`+ bonos-planilla` si trae bonos) | Inserta una fila |
| DELETE | `/api/recorridos/canvas/filas/:tipo/:id` | `recorridos:full` | Retira una fila |
| GET | `/api/recorridos/snapshots` | `recorridos:read` | Versiones del periodo |
| POST | `/api/recorridos/snapshots` | `recorridos:full` | Captura una versión |
| GET | `/api/recorridos/snapshots/:id` | `recorridos:read` | Una versión con su contenido |
| GET | `/api/recorridos/snapshots/:id/diff` | `recorridos:read` | Diferencias con la versión anterior u otra |
| POST | `/api/recorridos/snapshots/:id/revertir` | `recorridos:full` | Restaura el periodo a una versión |
| POST | `/api/recorridos-snapshots/cron-hora` | `x-cron-secret` | Disparo de la captura horaria |

### `GET /api/recorridos/canvas`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `desde`, `hasta` | `AAAA-MM-DD` | el corte vivo | Si llega una, tienen que llegar las dos, válidas, en orden y a 92 días como mucho |
| `conductores` | ids separados por coma | todos | |

Tope de 120 hojas: si hay más conductores, se sirven los 120 primeros por
apellido y se añade un aviso.

**Respuesta 200** (sin envoltorio; `RecorridosPeriodoDTO` en `recorridos-canvas.types.ts`)

```json
{ "anio": 2026, "mes": 9, "desde": "2026-08-21", "hasta": "2026-09-20", "etiqueta": "…",
  "bonos": [ { "config_id": "uuid", "nombre": "Bono …", "valor": 0, "anio": 2026 } ],
  "hojas": [ { "conductor_id": "…", "nombre": "…", "apellido": "…", "numero_identificacion": "…", "nombre_hoja": "…",
               "filas": [ { "tipo_fila": "segmento", "registro_dia_id": "…", "segmento_id": "…", "version": 2,
                            "fecha": "2026-09-03", "tipo_dia": "LABORADO", "orden": 1,
                            "cliente_id": "…", "cliente_nombre": "…", "vehiculo_id": "…", "vehiculo_placa": "…",
                            "hora_inicio": "06:00", "hora_fin": "18:00", "dias_offset_inicio": 0, "dias_offset_fin": 0,
                            "horas_conducidas": 10, "km_inicial": null, "km_final": null, "pernocte": false,
                            "descripcion": "…", "bonos": { "<config_id>": true } } ] } ],
  "avisos": [] }
```

En una fila de día (`tipo_fila: "dia"`) `segmento_id` es `null`, `orden` es `0` y
`descripcion` son las `observaciones` del día; en un recorrido, la
`descripcion_servicio` del tramo. `dias_offset_*` (0–2) dicen si el inicio o el
fin caen uno o dos días después de `fecha`. `bonos` solo trae las columnas visibles.

**Errores:** 400 `{ error }` (fechas inválidas, desordenadas o corte de más de 92 días); 500.

### `GET /api/recorridos/canvas/bonos`

Query `anio` (entero 2000–2100, obligatorio; si no, 400). Respuesta
`{ "anio": 2026, "bonos": [ { "config_id", "nombre", "valor", "anio" } ] }`: las
mismas columnas que trae el libro, para refrescarlas sin recargar el periodo.

### `GET /api/recorridos/canvas/placas`

`{ "placas": [ { "id": "…", "placa": "…" } ] }`: los vehículos no retirados,
ordenados por placa.

### `POST /api/recorridos/canvas/filas`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id` | uuid | sí | 400 si falta |
| `desde`, `hasta` | `AAAA-MM-DD` | sí | El corte que se está mirando: la fecha tiene que caer dentro |
| `fecha` | `AAAA-MM-DD` | sí | No puede ser futura (hoy de Bogotá) |
| `vehiculo_placa`, `hora_inicio`, `hora_fin` | string | para un recorrido | Con placa u horario la fila es un recorrido (salvo `tipo_dia: MANTENIMIENTO`) y exige placa, las dos horas y `descripcion`. La placa tiene que existir en Flota |
| `descripcion` | string | para un recorrido | En un recorrido va a `descripcion_servicio`; en un día sin recorridos, a `observaciones` |
| `horas_conducidas` | number | no | |
| `cliente_nombre` | string | no | Tiene que coincidir, sin distinguir mayúsculas, con un único cliente |
| `km_inicial`, `km_final` | entero | no | |
| `pernocte` | boolean | no | |
| `tipo_dia` | string | para un día sin recorridos | `DISPONIBLE`, `DESCANSO` o `MANTENIMIENTO` (este, con placa). `LABORADO` solo con recorrido |
| `bonos` | string[] | no | `config_id` a marcar en la fila nueva; exige `bonos-planilla`. Las configuraciones inactivas o retiradas se ignoran |

Si ya hay un día vivo en esa fecha, una fila de día se rechaza (422) y un
recorrido se añade como tramo nuevo; si ese día no era LABORADO, pasa a serlo,
se retiran sus soportes de mantenimiento y la respuesta trae `recargar: true`.
También se solicita recargar cuando el día LABORADO todavía no tenía tramos y
recibe el primero, para sustituir su fila de día por la nueva fila de recorrido.
Un día retirado se revive con lo tecleado.

**Respuesta 201** — `{ "fila": { …FilaRecorrido… }, "recargar": false }`.

**Errores** — cuerpo `{ "error": "…", "code": "…" }`:

| Código | Cuándo |
|---|---|
| 400 | Falta `conductor_id`, o `desde`/`hasta` no son un corte válido |
| 403 | `SIN_PERMISO`: sin nivel `full` en `recorridos`, o con `bonos` y sin `bonos-planilla` |
| 404 | `NO_ENCONTRADO`: el conductor no existe |
| 422 | `REGLA_NEGOCIO` (fecha fuera del corte o futura, fila incompleta, día ya existente…) o `VALOR_INVALIDO` (placa o cliente que no existen, valor mal formado) |
| 500 | `{ "error": "No se pudo crear la fila" }` |

### `DELETE /api/recorridos/canvas/filas/:tipo/:id`

| Parámetro | Dónde | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | ruta | sí | `segmento` (un recorrido; `id` es el segmento) o `dia` (`id` es el `registro_dia_laboral`) |
| `desde`, `hasta` | query | sí | El corte abierto; solo sirve para avisar a la sala |
| `base_version` | query | no | Compare-and-swap |

Un `segmento` se retira con sus bonos; si era el último recorrido de un día
LABORADO, se retira el día entero (con sus bonos y soportes). Un `dia` se retira
entero. Respuesta `{ "eliminado": "segmento", "registro_dia_id": "…" }`
(`eliminado: "dia"` cuando cayó el día).

**Errores:** 400 (`tipo`, `base_version` no entero, fechas); 403; 404 si ya no
existe; 409 `{ error, code: "VERSION_CONFLICT", server_row }`; 500.

### `GET /api/recorridos/snapshots`

Query `anio` (2000–2100) y `mes` (1–12); si no, 400 `{ "error": "anio inválido" }`
o `mes inválido`. Hasta 100 versiones, de la más reciente a la más antigua, sin
contenido:

```json
[ { "id": "…", "anio": 2026, "mes": 9, "rama": "main", "version": 7, "origen": "auto",
    "revertido_de_id": null, "usuario_id": null, "created_at": "…", "usuario": null } ]
```

### `POST /api/recorridos/snapshots`

`anio` y `mes` van en la **query**, no en el body. Se captura siempre el corte
canónico 21→20 que cierra en ese mes, no el que el usuario tenga en pantalla:
si no, dos capturas del mismo periodo con rangos distintos no serían comparables.
Respuesta 201 `{ "id", "anio", "mes", "version", "origen": "manual", "created_at", "usuario_id" }`
(una manual siempre crea versión; `{ "sinCambios": true }` solo se daría en las
automáticas). **Errores:** 400 periodo o fallo.

### `GET /api/recorridos/snapshots/:id`

La fila completa con `payload`: `{ anio, mes, bonos, hojas: [ { conductor_id, nombre, apellido, filas } ], meta }`.
404 `{ "error": "Snapshot no encontrado" }`.

### `GET /api/recorridos/snapshots/:id/diff`

Query `vs` (id de otra versión; por defecto, la anterior del mismo periodo).
Empareja las filas por `segmento_id` (o `dia:<registro_dia_id>`) y compara
`fecha`, `tipo_dia`, `cliente_nombre`, `vehiculo_placa`, `hora_inicio`,
`hora_fin`, `horas_conducidas`, `km_inicial`, `km_final`, `pernocte`,
`descripcion` y el conjunto de bonos marcados (por nombre, tal como se llamaban
en el snapshot).

```json
{ "contra": { "id": "…", "version": 6 },
  "cambios": [ { "clave": "…", "tipo": "alta", "fecha": "…" },
               { "clave": "…", "fecha": "…", "campo": "hora_fin", "antes": "17:00", "ahora": "18:00" } ],
  "truncado": false }
```

Máximo 200 cambios. Sin versión con la que comparar (o con un `vs` que no
existe): `{ "cambios": [], "truncado": false, "contra": null }`. 404 si `:id` no existe.

### `POST /api/recorridos/snapshots/:id/revertir`

Restaura el periodo hoja por hoja, con una transacción por conductor: devuelve
cada fila **viva** del snapshot a sus valores (en un tramo, cliente, vehículo,
horas, desfases, km, pernocte y descripción; en un día, tipo y observaciones),
sube su `version` y deja sus bonos como estaban (marca los que sobran y crea los
que faltan con el valor actual de la configuración). Después captura un snapshot
`revert` y emite `sheet:reverted`, que cambia la época de la sala: los *patches*
en vuelo con la época anterior se rechazan.

**Respuesta 200** — `{ "filasRestauradas": 340, "fallidas": [ { "conductor_id": "…", "error": "…" } ], "snapshot": { …el nuevo… } }`.
**Errores:** 404 si el snapshot no existe; 400 ante otro fallo.

### `POST /api/recorridos-snapshots/cron-hora`

Cabecera `x-cron-secret` con el valor de `CRON_SECRET`; sin ella, o sin la
variable configurada, 403 `{ "error": "Prohibido" }`. Captura con
`origen: 'auto'` el mes en curso y, del día 1 al 10, también el anterior, que se
sigue editando mientras se cierra la planilla. Respuesta
`{ "capturados": 1, "periodos": [ { "anio": 2026, "mes": 10 } ] }`.

## Efectos

- **Socket** (sala `sheet:recorridos:<anio>:<mes>`, ver [tiempo real](../tiempo-real.md)):
  `sheet:invalidate` con `accion: 'filas'` tras el alta o la baja de una fila, y
  `sheet:reverted` `{ scope, anio, mes, version, epoch, by }` tras revertir.
- **Cron.** `snapshot-recorridos` corre en el propio proceso cada hora a los :45
  (America/Bogota) con la misma lógica que `cron-hora`. Una captura automática se
  salta si hay otra en los últimos 50 min (`SNAPSHOT_ANTIRREBOTE_MIN`), que es lo
  que absorbe el doble disparo cron + endpoint, o si el contenido es idéntico al
  último. Ver [tareas programadas](../tareas-programadas.md).
- **Registros.** `recorridos_periodo_snapshot`. Lo marcado aquí lo leen
  `POST /api/nomina/borradores/generar`, `rehacer-bonos` y `reparar-recargos`.

## Observaciones

- **Revertir cambia bonos sin `bonos-planilla`.** La reversión marca y desmarca
  bonos con solo `recorridos:full`; quien no tiene el permiso individual no puede
  marcar un bono en una celda, pero sí devolver el periodo a una versión con otros
  bonos. `recorridos-snapshots.service.ts`.
- Revertir no revive filas retiradas después del snapshot ni retira las creadas
  después: solo toca las filas que siguen vivas. `recorridos-snapshots.service.ts`.
- `POST /api/recorridos/snapshots` lee `anio` y `mes` de la query aunque es un
  `POST`. `recorridos-snapshots.controller.ts`.
- El alta de fila busca el conductor sin filtrar `deleted_at`: se pueden crear
  recorridos de un conductor retirado. `recorridos-patch.service.ts`.
- El comentario de `recorridos.middleware.ts` dice que el modo por defecto de
  `requirePermission` es `warn`; desde oct-2026 es `enforce`. No cambia nada para
  la API: `requireRecorridosEdicion` rechaza en los dos modos.
