# Canvas de nómina

`/api/nomina` · código en [`src/modules/nomina-canvas/`](../../src/modules/nomina-canvas/) · permiso [`nomina`](../permisos.md#catálogo-de-módulos)

El libro de nómina de un periodo: una hoja por conductor, en orden alfabético,
que el dashboard pinta con Univer. Lo arma el servidor a partir de lo que ya hay
en la base —planillas de recargos (`recargos_planillas`,
`dias_laborales_planillas`, `detalles_recargos_dias`), la copia de días de cada
liquidación (`liquidaciones_dias`), los bonos marcados en el
[canvas de recorridos](./recorridos-canvas.md) y la configuración salarial
vigente por fecha—, con el cálculo puro de `src/lib/nomina/`. Las liquidaciones
son las mismas filas de [`liquidaciones`](./liquidaciones.md); este módulo añade
su máquina de estados, la generación de borradores en lote, las versiones del
periodo, el envío de desprendibles por correo y push, y el análisis.

Reglas que un integrador necesita saber:

- **El periodo no es el mes.** Por defecto es un corte: del día 21 del mes
  anterior al 20 del mes indicado, que le da nombre (`anio`, `mes` = mes en que
  termina). El día de corte es un parámetro (1–28; con `1`, el mes natural).
  Para un retiro o un ingreso a mitad de corte se pide un **rango** (`inicio` y
  `fin`, `AAAA-MM-DD`, los dos incluidos, máximo 62 días), que sustituye al
  calendario del corte; `anio`/`mes` siguen siendo la llave del libro (sala del
  socket, snapshots). Con corte, una liquidación es del libro si se **solapa**
  con él; con rango, si **cabe** dentro. El sueldo se paga por mes comercial: 30
  días con corte, días 30/360 del rango con rango.
- **Casi nada es editable.** Días, horas, desglose por empresa y recargos son
  derivados de las planillas; solo se editan los conceptos que una persona
  teclea en el desprendible, y esa edición celda a celda no pasa por esta API
  sino por socket (`sheet:patch` con scope `nomina`, ver
  [tiempo real](../tiempo-real.md)). Lo que cambia la forma de la hoja va por
  REST y avisa a la sala con `sheet:invalidate`.
- **Estados** (`liquidaciones.estado_flujo`):

  | Desde | Hacia | Además, solo Administración |
  |---|---|---|
  | BORRADOR | LIQUIDADA, ANULADA | |
  | LIQUIDADA | APROBADA, BORRADOR, ANULADA | |
  | APROBADA | PAGADA, LIQUIDADA, ANULADA | |
  | PAGADA | ANULADA | APROBADA |
  | FIRMADA | ANULADA | PAGADA |
  | ANULADA | — (terminal, exige motivo) | |

  Entrar en APROBADA, PAGADA o FIRMADA, y salir de APROBADA, PAGADA, FIRMADA o
  ANULADA, exige el área `administracion` (no un nivel del módulo). A FIRMADA no
  se llega por esta API: la pone la firma del conductor en el portal. PAGADA y
  FIRMADA publican el desprendible (`desprendible_visible = true`). El enum
  viejo `estado` se mantiene sincronizado: `Liquidado` desde LIQUIDADA.
- **Bloqueos.** En APROBADA, PAGADA, FIRMADA y ANULADA la hoja es de solo
  lectura: las rutas que cambian el neto responden 409. «Actualizar días», el
  reemplazo al generar y eliminar el borrador exigen además BORRADOR.
- **Concurrencia.** Compare-and-swap sobre `liquidaciones.version`: el cambio
  de estado acepta `base_version`, igual que los *patches* de celda por socket.
  Suben la versión el cambio de estado, las marcas por día, el cambio de
  periodo, el reemplazo al generar y la reversión de una versión; refrescar
  días, rehacer bonos y reparar recargos no la tocan.
- **Colas en memoria.** La generación de borradores y el envío de correos son
  colas en el propio proceso, con un lock por periodo (`anio:mes`); el estado de
  un job se puede consultar unos minutos después de terminar y luego se olvida.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest`) y `permisoPorMetodo('nomina')` en el plugin |
| `GET` | `nomina:read`. La ruta añade `requirePermission('nomina', 'limited')`, pero el hook del plugin ya exige `read` antes |
| `POST`, `PUT`, `PATCH`, `DELETE` | `nomina:full` (en el plugin y otra vez en la ruta) |
| Cambio de estado a APROBADA, PAGADA o FIRMADA, o desde APROBADA, PAGADA, FIRMADA o ANULADA | Además, área `administracion` en el usuario (`esAdmin`, `nomina-estado.service.ts`): si no, 403 `SIN_PERMISO` |
| `DELETE /api/nomina/borradores/job/:jobId` | Solo cancela quien lanzó el job; para otro responde `cancelado: false` |
| `DELETE /api/nomina/envios/job/:jobId` | Sin comprobación de dueño |

El módulo `nomina` da `full` a `administracion`, `talento_humano` y
`facturacion` y no tiene áreas de lectura (ver [permisos](../permisos.md)).

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/nomina/canvas` | `nomina:read` | El libro del periodo |
| GET | `/api/nomina/canvas/resumen` | `nomina:read` | Conteos del periodo, sin hojas |
| GET | `/api/nomina/analisis` | `nomina:read` | Liquidaciones con totales y detalle por vehículo, filtrables |
| GET | `/api/nomina/estados` | `nomina:read` | Vocabulario de estados y lo que el usuario puede hacer |
| PATCH | `/api/nomina/liquidaciones/:id/estado` | `nomina:full` (+ área `administracion` según el estado) | Cambia el estado de una liquidación |
| POST | `/api/nomina/estado-lote` | `nomina:full` (+ área `administracion` según el estado) | Cambia el estado de varias |
| GET | `/api/nomina/liquidaciones/:id/historial-estados` | `nomina:read` | Historial de estados |
| GET | `/api/nomina/borradores/previo` | `nomina:read` | Quién tiene liquidación, planillas o nada, antes de generar |
| POST | `/api/nomina/borradores/generar` | `nomina:full` | Encola la generación de borradores |
| GET | `/api/nomina/borradores/status/:jobId` | `nomina:read` | Estado del job de generación |
| DELETE | `/api/nomina/borradores/job/:jobId` | `nomina:full` | Cancela el job (solo quien lo lanzó) |
| POST | `/api/nomina/borradores/:id/refrescar-dias` | `nomina:full` | Rehace la copia de días desde las planillas |
| POST | `/api/nomina/borradores/:id/rehacer-bonos` | `nomina:full` | Pisa los bonos con lo marcado en recorridos |
| POST | `/api/nomina/borradores/:id/reparar-recargos` | `nomina:full` | Rehace las filas de `recargos` y siembra los bonos que falten |
| GET | `/api/nomina/liquidaciones/:id/desprendible-data` | `nomina:read` | Tablas de recargo del desprendible, desde el canvas |
| PUT | `/api/nomina/liquidaciones/:id/marcas-dias` | `nomina:full` | Guarda «ocultar» y «no sumar» por día |
| PUT | `/api/nomina/liquidaciones/:id/periodo` | `nomina:full` | Cambia las fechas del desprendible y recalcula |
| DELETE | `/api/nomina/liquidaciones/:id` | `nomina:full` | Retira un borrador |
| GET | `/api/nomina/snapshots` | `nomina:read` | Versiones del periodo |
| POST | `/api/nomina/snapshots` | `nomina:full` | Guarda una versión |
| GET | `/api/nomina/snapshots/:id` | `nomina:read` | Una versión con su contenido |
| GET | `/api/nomina/snapshots/:id/diff` | `nomina:read` | Diferencias con la versión anterior u otra |
| POST | `/api/nomina/snapshots/:id/revertir` | `nomina:full` | Restaura los totales de una versión |
| POST | `/api/nomina/envios/lote` | `nomina:full` | Encola el envío de desprendibles por correo |
| GET | `/api/nomina/envios/status/:jobId` | `nomina:read` | Progreso del lote |
| DELETE | `/api/nomina/envios/job/:jobId` | `nomina:full` | Cancela el lote |
| GET | `/api/nomina/envios/periodo` | `nomina:read` | Estado de envío de cada liquidación del periodo |
| GET | `/api/nomina/envios/liquidacion/:id` | `nomina:read` | Historial de envíos de una liquidación |
| POST | `/api/nomina/notificaciones` | `nomina:full` | Aviso push a la app del conductor |

### Parámetros de periodo

Las rutas del libro y del carril de borradores comparten estos parámetros: en la
query en los `GET`, en el body en el resto.

| Parámetro | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `anio` | entero | sí | En `GET /canvas`, entre 2000 y 2100 |
| `mes` | entero | sí | 1–12, mes en que termina el corte |
| día de corte | entero | no | `21` por defecto. Se llama **`desde`** en `GET /canvas` y `GET /canvas/resumen` (allí se valida 1–28) y **`corte`** en las rutas de borradores, `desprendible-data`, `marcas-dias` y snapshots |
| `inicio`, `fin` | `AAAA-MM-DD` | no | Rango específico. Si llega uno solo, o no son fechas reales en orden y dentro de 62 días, la petición es 400: no se cae al corte en silencio |

Errores de periodo: 400 `{ "error": "Periodo inválido (anio/mes)." }` (o el
mensaje de rango, año, mes o corte en `GET /canvas`).

### `GET /api/nomina/canvas`

Query: los de periodo y `conductores` (ids separados por coma).

Solo trae hojas de conductores con liquidación viva en el periodo: crear hojas
es cosa de «Generar borradores». Tope de 120 hojas; si hay más, se sirven las
120 primeras por orden alfabético y se añade un aviso en `avisos`.

**Respuesta 200** — el DTO sin envoltorio (`NominaPeriodoDTO`, en
`nomina-canvas.types.ts`):

```json
{ "anio": 2026, "mes": 9, "corte": 21, "rango": null, "etiqueta": "SEPTIEMBRE 2026 (21 AGO — 20 SEP)",
  "periodo": { "dias": [ { "fecha": "2026-08-21", "dia": 21, "mes": 8, "anio": 2026, "indice": 0, "ocurrencia": 0, "…": "…" } ], "semanas": [] },
  "disponibilidad": { "horasBase": 7, "horasDescuento": 3 },
  "topes": { "horasSemanales": 42, "horasMensuales": 210, "horasExtrasMes": 44 },
  "hojas": [ { "conductorId": "…", "liquidacionId": "…", "version": 3, "estado": "BORRADOR", "nombre": "…", "cedula": "…",
               "correo": "…", "tipoNomina": "PAREX", "dias": [], "tarifas": [], "tramos": [], "bloquesEmpresa": [],
               "matrizBonos": {}, "devengos": [], "deducciones": [], "totales": {}, "periodoLiquidacion": { "desde": "…", "hasta": "…" },
               "sinFilasDeRecargos": false, "avisos": [] } ],
  "clientes": [ { "id": "…", "nombre": "…", "color": "#…" } ],
  "avisos": [] }
```

Un mismo día con dos servicios abre dos columnas (`ocurrencia`). `tarifas` trae
una fila por código de recargo y tramo de vigencia, para cortes que cruzan un
cambio de tarifa.

**Errores:** 400 (rango, año, mes o corte); 500 `{ "error": "No se pudo construir el periodo de nómina." }`.

### `GET /api/nomina/canvas/resumen`

Mismos parámetros, sin `conductores`. A diferencia del libro, cuenta a toda la
nómina del periodo, no solo a quien ya tiene liquidación.
Respuesta: `{ anio, mes, corte, etiqueta, dias, conductores, conPlanilla, conLiquidacion, avisos }`.

### `GET /api/nomina/analisis`

**Query** (todas listas separadas por coma, todas opcionales)

| Parámetro | Descripción |
|---|---|
| `anios` (o `anio`) | Año del final del periodo para el resumen; también año de referencia para los conceptos |
| `meses` (o `mes`) | 1–12; periodo de nómina en el resumen y mes de referencia en las pestañas de conceptos |
| `placas` | Se pasan a mayúsculas |
| `conductores` | Ids |
| `estados` | `estado_flujo`, se pasan a mayúsculas |
| `incluirRecargosJornada` | `true`: añade `recargos_jornada` con días y valores agrupados por empresa desde las planillas activas de Recargos |

**Respuesta 200**

```json
{ "success": true,
  "liquidaciones": [ { "id": "…", "conductor": { "id": "…", "nombre": "…", "cedula": "…" },
                       "periodo_start": "…", "periodo_end": "…", "anio": 2026, "mes": 9, "corte": 21,
                       "estado_flujo": "PAGADA", "firmado": true, "desprendible_visible": true,
                       "dias_laborados": 30, "salario_basico": 0, "salario_devengado": 0, "sueldo_total": 0, "…": "demás totales",
                       "vehiculos": [ { "id": "…", "placa": "…" } ], "bonificaciones": [], "recargos": [], "recargos_jornada": [], "pernotes": [], "mantenimientos": [] } ],
  "catalogos": { "anios": [], "placas": [], "conductores": [ { "id": "…", "nombre": "…" } ], "estados": [] },
  "total": 0,
  "meta": { "recargos_jornada_grupos": 0 } }
```

`meta.recargos_jornada_grupos` cuenta las planillas que aportan grupos al tab
Recargos con los filtros actuales. Se devuelve aunque no se soliciten los días
detallados, para que el contador de la pestaña no muestre cero antes de abrirla.

`anio` y `mes` de cada fila identifican el periodo de nómina (el mes en que
termina el corte). En las pestañas de bonificaciones, recargos, pernoctes y
mantenimientos, los mismos filtros se aplican al mes/año del dato: `values` y
`recargos.mes` guardan `AAAA-MM`, y los pernoctes usan sus fechas. La consulta
incluye cortes que se cruzan con esos meses de referencia; por ejemplo,
diciembre también puede encontrar conceptos en el corte que termina en enero.
El filtro por placa consulta tanto las placas vinculadas al corte como las
placas de los vehículos asociados directamente a sus conceptos, para incluir
detalles aunque falte la relación del corte en `liquidacion_vehiculo`.
Al pedir `incluirRecargosJornada=true`, `recargos_jornada` consulta los detalles
activos de `recargos_planillas`, los mismos registros de la sección Recargos.
Cada fila agrupa la planilla, placa, empresa y mes calendario. Incluye los días
con recargos y el valor total registrado para cada día, sin discriminar tipos ni
horas; se limita al periodo de la liquidación y a los filtros de año, mes y placa.
No usa el snapshot editable del canvas. Estos pagos de jornada se presentan aparte
de recargos, que representa el reparto monetario guardado en la liquidación entre
cliente y propietario.
Sustituye a `GET /api/liquidaciones/analisis`. **Errores:** 500
`{ "success": false, "error": "…" }`.

### `GET /api/nomina/estados`

`{ estados, transiciones, transiciones_admin, bloqueados, exigen_admin, exigen_motivo, permitidas_por_estado }`.
`permitidas_por_estado` ya aplica los guardas al usuario que pregunta, para que
la barra solo pinte los botones que el servidor va a aceptar.

### `PATCH /api/nomina/liquidaciones/:id/estado`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | string | sí | `BORRADOR`, `LIQUIDADA`, `APROBADA`, `PAGADA`, `FIRMADA` o `ANULADA` |
| `motivo` | string | para `ANULADA` | Se guarda en `motivo_anulacion`; cualquier otra transición lo limpia |
| `base_version` | entero | no | Compare-and-swap: si la versión guardada es otra, 409 |

En una transacción: escribe `estado_flujo`, `estado` (`Liquidado` o
`Pendiente`), `actualizado_por_id` y `version + 1`; LIQUIDADA pone
`liquidado_por_id`; PAGADA y FIRMADA ponen `desprendible_visible = true`; y
deja una fila en `historial_estado_liquidacion_nomina`.

**Respuesta 200** — `{ "id": "…", "conductor_id": "…", "estado": "LIQUIDADA", "estado_anterior": "BORRADOR", "version": 4, "motivo": null }`.

**Errores** — cuerpo `{ "error": "…", "code": "…", …detalle }`, en este orden de comprobación:

| Código | `code` | Cuándo |
|---|---|---|
| 400 | `ESTADO_INVALIDO` | El estado no es del vocabulario |
| 404 | `NO_ENCONTRADO` | No existe o está retirada |
| 409 | `TRANSICION_INVALIDA` | La transición no existe, ni siquiera por la puerta de Administración; trae `estado_actual` |
| 403 | `SIN_PERMISO` | Existe, pero entra o sale de un estado reservado a Administración |
| 400 | `FALTA_MOTIVO` | `ANULADA` sin motivo |
| 409 | `VERSION_CONFLICT` | Otro cambio llegó antes; trae `estado_servidor` y `version_servidor` |
| 500 | — | `{ "error": "No se pudo cambiar el estado." }` |

### `POST /api/nomina/estado-lote`

Body `ids` (string[], 1 a 200; más → 413), `estado` y `motivo`; sin
`base_version`. No es una transacción única: cada liquidación se cambia por
separado y un fallo no revierte las demás.
Respuesta `{ "total": 3, "cambiados": [ …como el PATCH… ], "fallidos": [ { "id": "…", "error": "…", "code": "SIN_PERMISO" } ] }`.
**Errores:** 400 sin ids; 413; 500.

### `GET /api/nomina/liquidaciones/:id/historial-estados`

Últimos 100 cambios, del más reciente al más antiguo: filas de
`historial_estado_liquidacion_nomina` (`estado_anterior`, `estado_nuevo`,
`motivo`, `created_at`…) con `usuario: { id, nombre, correo }`. Un id inexistente
da arreglo vacío.

### `GET /api/nomina/borradores/previo`

Query: parámetros de periodo. Lista a todo conductor no retirado, también a quien
no tiene marcado `conductores.nomina` (sale con `en_nomina: false`): primero los
que tienen algo en el periodo, con el sueldo estimado; después el resto de la
empresa sin cálculo (`con_datos: false`).

```json
{ "anio": 2026, "mes": 9, "etiqueta": "…", "desde": "2026-08-21", "hasta": "2026-09-20",
  "conductores": [ { "conductor_id": "…", "nombre": "…", "cedula": "…", "en_nomina": true, "estado_conductor": "activo",
                     "dias": 18, "placas": ["…"], "liquidacion_id": null, "estado": null,
                     "sueldo_estimado": 0, "con_datos": true, "avisos": [] } ] }
```

`liquidacion_id: null` indica que generar crearía; con valor, que reemplazaría.
**Errores:** 400 periodo; 500 `{ error }`.

### `POST /api/nomina/borradores/generar`

**Body** — periodo, y:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_ids` | string[] | no | Máximo 200. Vacío: los conductores del libro (los marcados en `conductores.nomina`, más quien ya tenga liquidación en el corte) que tienen días en el periodo |
| `sobrescribir` | string[] | no | Conductores cuya liquidación existente se reemplaza; solo cuentan los que también vienen en `conductor_ids` |

Encola y responde enseguida. Por cada conductor:

- Ya tiene liquidación y no está en `sobrescribir` → `omitido`.
- Está en `sobrescribir` pero su liquidación no está en BORRADOR → `omitido`.
- No tiene días y no se pidió por id → `omitido` («Sin planillas en el periodo»).
- Si no, crea (o reemplaza) la liquidación con los totales de su hoja,
  `estado_flujo: BORRADOR`, `dias_laborados` = 30 (o los días comerciales del
  rango) y `salario_basico` congelado; rehace las filas automáticas de
  `recargos`, siembra los bonos marcados en recorridos si no hay ninguno, vincula
  vehículos y, solo al crear, copia los días.

**Respuesta 200** — `{ "job_id": "…", "status": "queued", "total": 2 }` (`total` es
el número de ids enviados; `0` cuando se genera el periodo entero).

**Errores:** 400 periodo, más de 200 ids o cola llena (10 jobs,
`BORRADOR_QUEUE_MAX_SIZE`); 409 `{ error, job_id, locked_by }` si ya hay una
generación de ese periodo en curso.

### `GET /api/nomina/borradores/status/:jobId`

El job sin su payload:

```json
{ "jobId": "…", "userId": "…", "userName": "…", "status": "running", "progress": 40, "currentStep": "Generando …",
  "processed": 4, "total": 10, "anio": 2026, "mes": 9,
  "items": [ { "conductorId": "…", "nombre": "…", "estado": "creado", "liquidacionId": "…", "sueldoTotal": 0 },
             { "conductorId": "…", "nombre": "…", "estado": "omitido", "motivo": "Ya tiene liquidación en este periodo (LIQUIDADA)." } ],
  "startedAt": 1760000000000 }
```

`status`: `queued`, `running`, `complete`, `error` o `cancelled`; `items[].estado`:
`creado`, `reemplazado`, `omitido` o `error`. `error` y `finishedAt` aparecen
cuando el job falla o termina. **Errores:** 404 `Job no encontrado o expirado.`
(el job se olvida 5 min después de terminar, `BORRADOR_QUEUE_JOB_TTL_MS`).

### `DELETE /api/nomina/borradores/job/:jobId`

`{ "cancelado": true, "nota": "Se detiene al terminar el conductor en curso." }`, o
`{ "cancelado": false }` si no existe, no es de quien lo pide o ya terminó. No
deshace los borradores ya creados.

### `POST /api/nomina/borradores/:id/refrescar-dias`

Body: periodo. Solo en BORRADOR (409 con la explicación). Reconstruye la hoja
**ignorando** la copia de días y la reemplaza con lo que dicen las planillas:
descarta las horas corregidas a mano, y no toca bonos, vacaciones ni conceptos.
Respuesta `{ "dias": 22 }`. **Errores:** 400 periodo o fallo; 404 liquidación, o
conductor que no está en el periodo; 409.

### `POST /api/nomina/borradores/:id/rehacer-bonos`

Body: periodo. 409 si la liquidación está bloqueada. Pisa las **cantidades** de
`bonificaciones` con el conteo de marcas de recorridos por (bono, vehículo, mes),
solo en los meses del corte: un bono que la liquidación tiene y recorridos no
marca queda en 0 (no se borra), el precio unitario de una fila existente no
cambia y una fila nueva toma el valor de la configuración. Respuesta
`{ "creadas": 1, "celdas": 4 }`. **Errores:** 400; 404; 409.

### `POST /api/nomina/borradores/:id/reparar-recargos`

Body: periodo. 409 si está bloqueada. Rehace las filas automáticas de `recargos`
(una por planilla) repartiendo el total de recargos de la hoja por cliente y
dejando fuera los días «no sumar»; los recargos escritos a mano no se tocan. Los
bonos se siembran solo si la liquidación no tiene ninguno. Después recalcula y
guarda los totales. Respuesta `{ "filas": 3, "total": 0, "sinAtribuir": 0, "bonos": 0 }`.

### `GET /api/nomina/liquidaciones/:id/desprendible-data`

Query: parámetros de periodo. Las tablas de recargo del desprendible construidas
desde la copia de días que paga el canvas, no desde las planillas: en cuanto
alguien corrige una hora, las planillas dejan de cuadrar con lo pagado. Tienen la
misma forma que `GET /api/liquidaciones/preview-recargos`, para que el
generador del PDF no cambie; agrupan por empresa · mes · vehículo y omiten los
días marcados «ocultar». El [portal del conductor](./conductor-portal.md) usa la
misma función.

```json
{ "conductor_id": "…", "periodo": { "desde": "2026-08-21", "hasta": "2026-09-20" },
  "planillas": [ { "planilla_id": "<empresa>|2026-9|<vehiculo>", "numero_planilla": null, "vehiculo": { "id": "…", "placa": "…" },
                   "empresa": { "id": "…", "nombre": "…" }, "mes": 9, "año": 2026, "total_dias": 0, "total_horas": 0, "total_valor": 0,
                   "configuracion_salarial": { "valor_hora_trabajador": 0 },
                   "dias": [ { "…": "…", "recargos": [ { "tipo_codigo": "RN", "horas": 0, "valor_hora_base": 0, "valor_hora_calculada": 0, "valor_total": 0 } ] } ] } ],
  "total_recargos": 0, "dias_sin_recargo": [] }
```

**Errores:** 400 periodo o fallo; 404 liquidación o conductor fuera del periodo.

### `PUT /api/nomina/liquidaciones/:id/marcas-dias`

**Body** — periodo, y `marcas`:

```json
{ "anio": 2026, "mes": 9,
  "marcas": { "2026-09-03|<empresa_id>": { "ocultar": true, "noSumar": false } } }
```

Reemplaza el mapa entero (desmarcar es no mandar la clave). Claves que no tienen
la forma `AAAA-MM-DD|<uuid>` y días sin ninguna marca se descartan; un mapa vacío
se guarda como `null`. `ocultar` saca el día de las tablas sin mover dinero;
`noSumar` lo deja visible pero fuera de los recargos pagados. Si cambia el
conjunto de días «no sumar», rehace las filas de recargos y recalcula el neto.
409 si está bloqueada. Respuesta `{ "marcas": {…}, "recargos": { "filas": 3, "total": 0, "sinAtribuir": 0 } }`
(`recargos: null` si no cambió el dinero).

### `PUT /api/nomina/liquidaciones/:id/periodo`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `inicio`, `fin` | `AAAA-MM-DD` | sí | En orden y como mucho 62 días |
| `ajustarDias` | boolean | no | `true` por defecto: `dias_laborados` pasa a los días comerciales del rango |

Cambia las fechas que imprime el desprendible (`periodo_start`/`periodo_end`),
rehace los recargos con la ventana nueva (respetando «no sumar») y recalcula los
totales. No toca la copia de días: los que quedan fuera no se ven y, si el rango
crece, «Actualizar días» trae los nuevos. Respuesta
`{ "periodo": { "desde": "…", "hasta": "…" }, "diasLaborados": 10, "recargos": {…} }`.

**Errores:** 400 fechas; 404; 409 si está bloqueada o si otra liquidación viva
del mismo conductor se solapa con las fechas nuevas (el mensaje dice cuál).

### `DELETE /api/nomina/liquidaciones/:id`

Solo BORRADOR; en otro estado, 409 (hay que devolverla a BORRADOR o anularla).
Hace el mismo borrado lógico que `DELETE /api/liquidaciones/:id`: marca la
liquidación y deja sus hijas, firma incluida. El body puede traer `anio` y `mes`
solo para avisar a la sala. Respuesta `{ "ok": true, "conductor_id": "…" }`.

### `GET /api/nomina/snapshots`

Query `anio` y `mes`. Hasta 100 versiones, de la más reciente a la más antigua:

```json
[ { "id": "…", "version": 12, "origen": "auto", "rama": "main", "created_at": "…",
    "usuario": { "id": "…", "nombre": "…" }, "revertido_de_id": null,
    "hojas": 27, "conductores_con_planilla": 25, "cambios": 3 } ]
```

`origen`: `manual`, `auto` o `revert`. `cambios` cuenta las diferencias con la
versión anterior, las mismas que enseña `diff`.

### `POST /api/nomina/snapshots`

Body `anio`, `mes` y `corte` (opcional). Captura el libro del corte entero (no
admite rango). Una captura manual siempre crea versión. Respuesta
`{ "id": "…", "version": 13 }`; el servicio podría devolver `{ "sinCambios": true }`,
pero eso solo ocurre en las capturas automáticas. **Errores:** 400 periodo; 500.

### `GET /api/nomina/snapshots/:id`

La fila completa con `payload` (periodo, constantes y, por hoja, días, tarifas,
bloques por empresa, devengos, deducciones y totales) y `usuario`. 404 `Versión no encontrada.`

### `GET /api/nomina/snapshots/:id/diff`

Query `vs` (id de otra versión; por defecto, la anterior). Compara por conductor
solo estado, días laborados, total de horas, total de recargos, total
devengado, deducciones y neto, más las hojas que aparecen o desaparecen.
Respuesta `{ "actual": { "id", "version", "created_at" }, "previo": {…} | null, "cambios": [ { "conductorId", "nombre", "campo", "antes", "despues" } ], "truncado": false }`
(máximo 200 cambios). 404 si `:id` no existe.

### `POST /api/nomina/snapshots/:id/revertir`

Restaura las **columnas de totales** de cada liquidación viva del snapshot
(salario devengado, auxilio, bonificaciones, pernoctes, recargos, vacaciones,
anticipos, salud, pensión, neto, ajustes PAREX y GEOPARK, nivelación,
incapacidad, intereses de cesantías y disponibilidad) y les sube la versión.
Omite las hojas en APROBADA, PAGADA, FIRMADA o ANULADA y las liquidaciones que ya
no existen. Al final captura un snapshot con `origen: 'revert'`, para que la
reversión también se pueda deshacer.
Respuesta `{ "restauradas": 20, "omitidas": [ { "conductorId", "nombre", "estado" } ], "nuevoSnapshot": { "id", "version" } }`.
**Errores:** 500 `No se pudo restaurar la versión.`, también si el snapshot no existe.

### `POST /api/nomina/envios/lote`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `anio`, `mes` | entero | sí | Periodo del lote; también la llave del lock |
| `items` | array | sí | 1 a 150 (`MAX_ITEMS`; más → 413): `{ liquidacion_id, cc? }` |
| `items[].cc` | string[] | no | Copias. Las que no parecen un correo se descartan en silencio; como mucho 5 válidas |
| `asunto` | string | sí | Hasta 200 caracteres; admite `{NOMBRE}` y `{PERIODO}` |
| `mensaje` | string | no | Se recorta a 4000; se pinta bajo el saludo |
| `es_prueba` | boolean | no | Todo va a `destino_prueba`, el asunto lleva `[PRUEBA] ` y no hay copias ni copia oculta |
| `destino_prueba` | string | con `es_prueba` | Correo válido; si no, 400 |

Por cada ítem, con una pausa de 800 ms entre correos (`ENVIO_LIQ_DELAY_MS`;
Resend corta a dos peticiones por segundo): si la liquidación no existe, no
tiene conductor o el conductor no tiene correo, `OMITIDO` y sin constancia; si
no, crea la fila de `nomina_envio` en `ENVIANDO`, reutiliza o emite el token del
portal del conductor y manda el correo de la empresa (sin adjunto) con el enlace
`<frontend>/public/portal?token=…&desprendible=<id>&tab=desprendibles`; la fila
pasa a `ENVIADO` o `ERROR`.

**Respuesta 200** — `{ "job_id": "…", "total": 25 }`.
**Errores:** 400 validación; 413; 409 si la cola está llena (5 lotes,
`ENVIO_LIQ_MAX_QUEUE`) o si ya se está enviando ese periodo.

### `GET /api/nomina/envios/status/:jobId`

```json
{ "job_id": "…", "status": "running", "total": 25, "hechos": 10, "progress": 40, "currentStep": "Enviando a …",
  "resultados": [ { "liquidacion_id": "…", "conductor": "…", "email": "…", "estado": "ENVIADO" },
                  { "liquidacion_id": "…", "conductor": "…", "email": "—", "estado": "OMITIDO", "error": "El conductor no tiene correo registrado." } ],
  "error": null }
```

404 `El lote ya no está disponible.` (se olvida a los 10 min, `ENVIO_LIQ_JOB_TTL_MS`).

### `DELETE /api/nomina/envios/job/:jobId`

`{ "cancelado": true }`. Un lote en cola se retira; uno en curso se detiene antes
del siguiente correo. `false` si no existe o ya terminó.

### `GET /api/nomina/envios/periodo`

Query `anio` y `mes`. Objeto indexado por `liquidacion_id`:

```json
{ "<liquidacion_id>": { "liquidacion_id": "…", "ultimo_enviado": { "email_destino": "…", "enviado_at": "…" },
                        "ultimo_error": null, "enviados": 1, "pruebas": 2 } }
```

Un envío real correcto borra el error anterior; las pruebas solo se cuentan.

### `GET /api/nomina/envios/liquidacion/:id`

Últimas 50 filas de `nomina_envio` de la liquidación (`email_destino`, `asunto`,
`estado`, `error`, `es_prueba`, `proveedor`, `message_id`, `enviado_por`,
`enviado_at`…), de la más reciente a la más antigua.

### `POST /api/nomina/notificaciones`

Body `liquidacion_ids` (string[], 1 a 200 tras quitar repetidos; más → 413),
`anio` y `mes` (solo para el texto del aviso). Solo notifica liquidaciones en
PAGADA o FIRMADA; el resto sale `OMITIDA`. Por cada una crea primero el aviso en
`conductor_notification` (`tipo: NOMINA_DISPONIBLE`) y después intenta el push
por Expo a los `conductor_push_device` activos del conductor; un
`DeviceNotRegistered` desactiva ese dispositivo.

```json
{ "total": 3, "enviadas": 1, "sin_dispositivo": 1,
  "resultados": [ { "liquidacion_id": "…", "conductor": "…", "estado": "ENVIADA" },
                  { "liquidacion_id": "…", "conductor": "…", "estado": "OMITIDA", "error": "Solo se notifican liquidaciones PAGADAS." } ] }
```

`estado`: `ENVIADA`, `SIN_DISPOSITIVO`, `ERROR` u `OMITIDA`. **Errores:** 400
sin ids o periodo inválido; 413; 500.

## Efectos

- **Socket** (ver [tiempo real](../tiempo-real.md)). La sala del libro es
  `sheet:nomina:<anio>:<mes>`.
  - Generación: al usuario que la lanzó (`user-<id>`), `borrador-nomina:queued`,
    `:start`, `:progress`, `:complete`, `:error` y `:cancelled` con el job; a la
    sala, `borrador-nomina:item` por cada conductor.
  - Envío: al usuario, `envio-nomina:queued`, `:start`, `:progress`,
    `:complete`, `:error` y `:cancelled`; a la sala, `envio-nomina:item`
    `{ liquidacion_id, estado, es_prueba?, error?, by }`.
  - `sheet:invalidate` a la sala tras `rehacer-bonos` y `reparar-recargos`
    (`accion: 'bonos'`), `marcas-dias`, `periodo` (a la sala vieja y a la nueva) y
    eliminar borrador (`borrador-eliminado`, solo si el body trae `anio` y `mes`).
  - Cambiar estado, refrescar días y revertir una versión no emiten nada.
- **Correo.** Remitente `Cotransmeq <noreply@cotransmeq.com>`, copia oculta a
  `NOTIF_BCC_EMAIL` en los envíos reales. Puede crear filas en `conductor_token`.
- **Push.** Expo Push (`https://exp.host/--/api/v2/push/send`), canal `nomina`.
- **Registros.** `historial_estado_liquidacion_nomina`, `nomina_envio`,
  `conductor_notification`, `nomina_periodo_snapshot`.
- **Cron.** `snapshot-nomina`, cada hora a los :25 (America/Bogota), captura con
  `origen: 'auto'` los dos periodos vivos: el que se liquida y el abierto, según
  si ya pasó el día 21. Se salta la captura si hay otra automática en los últimos
  50 min (`SNAPSHOT_ANTIRREBOTE_MIN`) o si el contenido es idéntico al último. No
  tiene disparador HTTP. Ver [tareas programadas](../tareas-programadas.md).

## Observaciones

- El bono de nivelación se calcula siempre a prorrata de los días trabajados en
  Villanueva (`base mensual / 30 × días`); el canvas no aplica el corte de 17 días.
- **Revertir una versión solo reescribe las columnas de totales.** No restaura
  las filas de `recargos`, `bonificaciones` ni la copia de días, así que después
  de revertir los totales pueden no cuadrar con esas filas hasta el siguiente
  recálculo; tampoco deja historial ni avisa a la sala. `nomina-snapshots.service.ts`.
- `POST /api/nomina/snapshots/:id/revertir` con un id inexistente responde 500,
  no 404. `nomina-estado.controller.ts`.
- Cancelar un envío (`DELETE /api/nomina/envios/job/:jobId`) no comprueba quién
  lo lanzó: cualquiera con `nomina:full` puede cortar el lote de otro, a
  diferencia de la cancelación de borradores. `nomina-envios.controller.ts`.
- Las dos colas viven en la memoria del proceso: un reinicio o un despliegue
  pierde los jobs en curso y su estado, y con más de una instancia el lock por
  periodo no se comparte. `queue/borrador-nomina-queue.service.ts`, `queue/envio-nomina-queue.service.ts`.
- `POST /api/nomina/notificaciones` usa `anio`/`mes` solo para el texto: no
  comprueba que la liquidación sea de ese periodo.
- `refrescar-dias` reemplaza la copia de días sin subir `version` ni avisar a la
  sala: otro canvas abierto sobre esa hoja sigue enseñando los días viejos y sus
  *patches* no chocan. `rehacer-bonos` y `reparar-recargos` tampoco suben la
  versión, aunque sí emiten `sheet:invalidate`. `nomina-borradores.controller.ts`.
- La guarda `limited` de las rutas de lectura nunca decide: el hook del plugin
  exige `read` antes. `nomina-canvas.routes.ts`.
- El CRUD de [`liquidaciones`](./liquidaciones.md) puede editar o retirar
  liquidaciones que aquí están bloqueadas, sin subir `version`.

