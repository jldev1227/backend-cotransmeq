# Días laborados

`/api/dias-laborados` · código en [`src/modules/dias-laborados/`](../../src/modules/dias-laborados/) · permiso [`recorridos`](../permisos.md#catálogo-de-módulos) para reescribir recorridos y permiso individual [`bonos-planilla`](../permisos.md#permisos-individuales-permisos) para los bonos

Registro diario de actividad de cada conductor: la fuente del canvas de
[recorridos](./recorridos-canvas.md) y de lo que la nómina paga por días, bonos
y pernoctes. Entidades:

- `registro_dia_laboral`: un día por conductor y fecha, con `tipo` (`LABORADO`,
  `DISPONIBLE`, `DESCANSO`, `MANTENIMIENTO`), `observaciones` y, si es de
  mantenimiento, el vehículo intervenido (`mantenimiento_vehiculo_id` y la placa
  como copia, para que el histórico siga diciendo qué carro fue).
- `registro_dia_laboral_segmento`: los tramos del día —cliente, vehículo,
  horario con desfase de días, horas conducidas, kilómetros, pernocte y
  `descripcion_servicio`—. Son la fuente de verdad de cliente, vehículo y horas.
- `registro_dia_laboral_bono`: bonos de planilla, del día o de un tramo, contra
  una `configuraciones_liquidacion`.
- `registro_dia_laboral_adjunto`: soportes de los días de mantenimiento; se suben
  desde el [portal del conductor](./conductor-portal.md).
- `bono_config_visual`: qué bonos salen como columna en el canvas, por año.

Tiene tres clientes: el **reporte diario** del conductor, un flujo anterior al
portal con su propio enlace y token (`conductor_dias_laborados`, página
`/public/dias-laborados`); el **dashboard** (calendario, carga masiva por
patrones, edición de tramos y bonos); y el **portal del conductor**, que guarda
por `/api/conductor-portal/dias-laborados/*` con este mismo servicio.

Reglas que un integrador necesita saber:

- **Nada se borra en duro.** Días, tramos, bonos y soportes se marcan con
  `deleted_at` y las lecturas filtran (`src/lib/soft-delete/dia-laboral.ts`). La
  unicidad `(conductor_id, fecha)` es global a propósito: el día retirado
  conserva su fila y volver a registrarlo la **revive** con el `upsert`.
- **Guardar un día reemplaza sus tramos**: se retiran los vivos con sus bonos
  (`retirarSegmentos`) y se insertan los nuevos. En el flujo del conductor solo
  `LABORADO` conserva tramos; en la carga masiva, `LABORADO` y `DISPONIBLE`.
  Pasar a un tipo que no es `MANTENIMIENTO` retira los soportes.
- **Un día de mantenimiento exige placa.** El zod pide el texto de
  `mantenimiento_vehiculo_placa` siempre que el tipo sea `MANTENIMIENTO`, aunque
  llegue el id, y el servicio lo vuelve a comprobar. Con
  `mantenimiento_vehiculo_id` se guarda la placa del catálogo; con solo el texto
  se intenta enlazar el vehículo por placa (sin distinguir mayúsculas) y, si no
  existe, se guarda el texto: hay vehículos de terceros que entran a taller sin
  estar registrados. Cualquier otro tipo limpia la placa.
- **Horario coherente con el desfase** (`exigirHorarioCoherente`,
  `dias-laborados.schema.ts`): `dias_offset_inicio` y `dias_offset_fin` van de 0
  a 2 (0 = ese día, 1 = el siguiente) y el fin, contando el desfase, tiene que
  ser posterior al inicio. `descripcion_servicio` es obligatoria en todo tramo
  nuevo (1–500 caracteres sin contar espacios) y nunca se admite en blanco.
- **Bonos**: el `valor` se copia de la configuración al crearlos (el del body se
  ignora) y la configuración tiene que existir y estar activa.

## Acceso

| Rutas | Guarda |
|---|---|
| `POST /solicitar-acceso` | `pública · límite 3/h por cédula y 30/h por IP` ([límites de intentos](../autenticacion.md#límites-de-intentos)) |
| `GET /verificar-token` | `pública · token`: el JWT del enlace en la query, verificado contra `conductor_token` |
| `POST /registros`, `GET /registros`, `DELETE /registros/:fecha` | `portal`: `conductorAuthMiddleware` (hook `onRequest` del sub-plugin, en este archivo) acepta solo `tipo: 'conductor_dias_laborados'`; el conductor sale del token. El token del portal (`conductor_portal`) y los del equipo reciben 401 |
| `GET /calendar-admin`, `/clientes`, `/vehiculos`, `/bonos`, `/bonos-config-visual` | sesión + `recorridos:read`; también aplica el límite personalizado `permisos_rutas` |
| `POST /admin/registros-masivos`, `PUT` y `DELETE /admin/segmento/:id`, `PUT` y `DELETE /admin/registro/:id` | `requireRecorridosEdicion`: requiere `recorridos:full` efectivo por área; en Cotransmeq solo Administración edita. `permisos_rutas` puede reducir, no conceder ese nivel; se aplica también a `sheet:patch`. 403 `{ error, message }` |
| `POST /bonos`, `POST /bonos/sync`, `DELETE /bonos/:id`, `PUT /bonos-config-visual` | `recorridos:full` efectivo + `bonos-planilla`; el mapa de rutas limita la edición y el permiso puntual sigue siendo requisito adicional. 403 `{ error, message }` si falta cualquiera |

En las cuatro rutas de escritura de bonos la autenticación corre en `preHandler`,
después de validar el esquema: un body inválido sin token recibe 400, no 401.

**Flujo del reporte diario**: `solicitar-acceso` firma un JWT de 30 días
(`{ sub, cedula, nombre, tipo: 'conductor_dias_laborados' }`), lo guarda en
`conductor_token` y envía al correo `<origen>/public/dias-laborados?token=<JWT>`
(`<origen>`: `EMAIL_FRONTEND_URL` o el primer `FRONTEND_URL`). La página llama
`verificar-token`, que devuelve el **mismo** token, y lo usa como
`Authorization: Bearer`. El middleware solo verifica firma, vencimiento y `tipo`;
no vuelve a mirar `conductor_token`. Ver [autenticación](../autenticacion.md#días-laborados).

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/dias-laborados/solicitar-acceso` | pública · límite 3/h por cédula, 30/h por IP | Envía al correo el enlace del reporte diario |
| GET | `/api/dias-laborados/verificar-token` | pública · token | Valida el enlace y devuelve el token con el perfil |
| POST | `/api/dias-laborados/registros` | portal | Crea o reemplaza un día del conductor |
| GET | `/api/dias-laborados/registros` | portal | Lista los días del conductor |
| DELETE | `/api/dias-laborados/registros/:fecha` | portal | Retira un día del conductor |
| GET | `/api/dias-laborados/calendar-admin` | sesión | Días del mes de todos los conductores (o de uno) |
| GET | `/api/dias-laborados/clientes` | sesión | Catálogo de clientes para los selects |
| GET | `/api/dias-laborados/vehiculos` | sesión | Catálogo de vehículos para los selects |
| POST | `/api/dias-laborados/admin/registros-masivos` | `recorridos:full` | Carga los días de un mes de un conductor por patrones |
| PUT | `/api/dias-laborados/admin/segmento/:id` | `recorridos:full` | Edita un tramo |
| DELETE | `/api/dias-laborados/admin/segmento/:id` | `recorridos:full` | Retira un tramo |
| PUT | `/api/dias-laborados/admin/registro/:id` | `recorridos:full` | Edita tipo, observaciones, placa y el tramo único de un día |
| DELETE | `/api/dias-laborados/admin/registro/:id` | `recorridos:full` | Retira un día con sus tramos y soportes |
| GET | `/api/dias-laborados/bonos` | sesión | Bonos de un rango de fechas |
| POST | `/api/dias-laborados/bonos` | sesión + bonos-planilla | Crea un bono |
| POST | `/api/dias-laborados/bonos/sync` | sesión + bonos-planilla | Crea y retira bonos en bloque |
| DELETE | `/api/dias-laborados/bonos/:id` | sesión + bonos-planilla | Retira un bono |
| GET | `/api/dias-laborados/bonos-config-visual` | sesión | Configuraciones de bono del año con su visibilidad |
| PUT | `/api/dias-laborados/bonos-config-visual` | sesión + bonos-planilla | Reemplaza la visibilidad de bonos del año |

Las respuestas llevan `{ success, … }`. Los errores propios son
`{ success: false, message }`, salvo los de las guardas del equipo
(`{ error, message }`) y los del esquema de Fastify (`{ statusCode, error, message }`).

### `POST /api/dias-laborados/solicitar-acceso`

**Body**: `numero_identificacion` (string de 5 a 12 caracteres, obligatorio).

**Respuesta 200** — `{ "success": true, "message": "Se ha enviado un enlace de acceso a tu correo electrónico", "email": "jua***@dominio.com" }`.
Cada petición firma un token nuevo.

**Errores**: 400 esquema o conductor sin correo; 404 cédula sin conductor; 429
tope de intentos; 500 si falla el correo (el token ya quedó guardado).

### `GET /api/dias-laborados/verificar-token`

**Query**: `token` (obligatorio).

**Respuesta 200** — `{ success, data: { token, conductor: { id, nombre, apellido, numero_identificacion, email, estado }, expires_at } }`;
`token` es el mismo que llegó.

**Errores**: 400 sin `token` o vacío; 401 «Token inválido» (otro `tipo`), «Token
expirado o inválido» (sin fila en `conductor_token` o vencida) o «Token inválido
o expirado» (firma o vencimiento del JWT).

### `POST /api/dias-laborados/registros`

Crea o reemplaza el día del conductor del token. El body lo valida
`crearRegistroSchema` (zod), el mismo que usa el portal: `fecha`
(`AAAA-MM-DD`, no futura), `tipo`, `observaciones`, `mantenimiento_vehiculo_id`,
`mantenimiento_vehiculo_placa` y `segmentos` (tramos; solo se guardan si el día
es `LABORADO`). Los campos de cada tramo y sus reglas están en
[`POST /api/conductor-portal/dias-laborados/registros`](./conductor-portal.md#post-apiconductor-portaldias-laboradosregistros).

El esquema de Fastify de esta ruta todavía declara campos sueltos del formato
viejo (`hora_inicio`, `hora_fin`, `horas_conducidas`, `cliente_id`,
`cliente_nombre`, `vehiculo_placa`): zod los ignora y los tramos solo se leen de
`segmentos`. Frente a la ruta del portal, aquí no se avisa al equipo, la
respuesta no trae `adjuntos` y los errores de zod salen como 500.

**Respuesta 200** — `{ success, message: "Registro guardado exitosamente", data: { …registro_dia_laboral, segmentos } }`.

**Errores**: 400 día futuro, vehículo de mantenimiento inexistente o esquema de
Fastify; 500 reglas de zod (con el JSON de los problemas en `message`) y otros fallos.

### `GET /api/dias-laborados/registros`

**Query**: `mes` (`AAAA-MM`, con prioridad) o `desde` y `hasta` (`AAAA-MM-DD`,
los dos); sin filtro, todos.

**Respuesta 200** — `{ success, data, count }`: los días vivos del conductor por
fecha, cada uno con `adjuntos` (soportes `UPLOADED` de los días de mantenimiento,
URL de 1 h) y, en los `LABORADO`, sus tramos vivos en `segmentos`. Si en el rango
no hay ningún día `LABORADO`, ningún registro trae la clave `segmentos`.

### `DELETE /api/dias-laborados/registros/:fecha`

Retira el día vivo de esa fecha (`AAAA-MM-DD`) con sus tramos, sus bonos
—también los del día sin tramo— y sus soportes (`retirarDiaLaboral`). 200
`{ success, message: "Registro eliminado exitosamente" }`; 404 «Registro no
encontrado» si no hay día vivo (también la segunda vez).

### `GET /api/dias-laborados/calendar-admin`

**Query**

| Parámetro | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `mes` | número 1–12 | sí | |
| `anio` | número 2020–2100 | sí | |
| `conductor_id` | uuid | no | Uno solo |

**Respuesta 200**

```json
{ "success": true, "data": {
  "registros": [ { "id": "…", "fecha": "…", "tipo": "LABORADO", "observaciones": null,
    "mantenimiento_vehiculo_id": null, "mantenimiento_vehiculo_placa": null,
    "created_at": "…", "updated_at": "…", "segmentos_count": 2, "segmentos": [ … ], "adjuntos": [],
    "conductor": { "id": "…", "nombre": "…", "apellido": "…", "numero_identificacion": "…" } } ],
  "total": 1,
  "stats": { "total": 1, "laborados": 1, "disponibles": 0, "descansos": 0, "mantenimiento": 0 }
} }
```

Solo días y tramos vivos; `adjuntos` con URL firmada de 1 h.

### `GET /api/dias-laborados/clientes` y `GET /api/dias-laborados/vehiculos`

Catálogos para los selects del modal de carga masiva. `{ success, data, count }`
con los clientes sin borrar (`{ id, nombre, nit, tipo, oculto }`) o los vehículos
sin borrar (`{ id, placa, marca, linea, modelo, estado, conductor_id, oculto }`).
Los ocultos llegan con su marca: no se filtran.

### `POST /api/dias-laborados/admin/registros-masivos`

Registra de una vez los días de un mes de un conductor a partir de patrones (uno
por cada conjunto de días que comparten tipo y tramo). Valida el esquema de
Fastify y después `guardarRegistrosMasivosSchema` (`dias-laborados-admin.schema.ts`).

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `conductor_id` | uuid | sí | Conductor existente y sin borrar |
| `mes` | entero 1–12 | sí | |
| `anio` | entero 2000–2100 | sí | |
| `patrones` | arreglo (máx. 60) | sí | Cada fecha en un solo patrón y todas dentro de `mes`/`anio` |

Cada patrón:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tipo` | `LABORADO` \| `DISPONIBLE` \| `DESCANSO` \| `MANTENIMIENTO` | no | `LABORADO` por defecto |
| `fechas` | `AAAA-MM-DD`[] | sí | 1 a 366 |
| `segmento` | objeto | no | Solo se usa en `LABORADO` y `DISPONIBLE`: `cliente_id`, `cliente_nombre`, `vehiculo_id`, `vehiculo_placa`, `hora_inicio`, `hora_fin`, `horas_conducidas`, `km_inicial`, `km_final` (≥ inicial), `pernocte`, `dias_offset_inicio`, `dias_offset_fin`, todos opcionales, y `descripcion_servicio` obligatoria |
| `mantenimiento_vehiculo_id` | uuid \| null | no | |
| `mantenimiento_vehiculo_placa` | string ≤ 20 \| null | si `MANTENIMIENTO` | También cuando llega el id |
| `observaciones` | string ≤ 500 \| null | no | Se copia en cada día del patrón |

En una transacción (30 s): en las fechas tocadas retira los tramos y bonos vivos,
hace `upsert` de cada día (revive los retirados), retira los soportes si el día
no es de mantenimiento y crea un tramo (`orden: 1`) si el patrón lo lleva. Las
fechas que no están en ningún patrón no se tocan, y aquí no se rechazan fechas
futuras.

**Respuesta 200**

```json
{ "success": true, "message": "Recorridos guardados",
  "resumen": { "conductor_id": "…", "conductor_nombre": "…", "mes": 9, "anio": 2026,
    "patrones_procesados": 3, "registros_laborado_creados": 20, "registros_descanso_creados": 4,
    "registros_mantenimiento_creados": 1, "registros_disponible_creados": 5, "total_creados": 30 },
  "ids": [ { "id": "…", "fecha": "2026-09-01", "tipo": "LABORADO" } ] }
```

**Errores**: 400 esquema de Fastify o vehículo de mantenimiento inexistente; 404
«Conductor no encontrado»; 500 las reglas de zod (fechas fuera del mes o
repetidas, km, horario, descripción, placa de mantenimiento).

### `PUT /api/dias-laborados/admin/segmento/:id`

**Body** parcial: `cliente_id`, `cliente_nombre`, `vehiculo_id`,
`vehiculo_placa`, `hora_inicio`, `hora_fin`, `dias_offset_inicio`,
`dias_offset_fin`, `horas_conducidas`, `km_inicial`, `km_final`, `pernocte`,
`descripcion_servicio` (si llega, no puede ir en blanco). Solo cambia lo que
llega; `null` en `cliente_id` o `vehiculo_id` desconecta la relación. `km_final`
tiene que ser ≥ `km_inicial`, contando el valor guardado. No toca el día.

**Respuesta 200** — `{ success, message: "Segmento actualizado", data: <tramo> }`.

**Errores**: 404 tramo inexistente o retirado; 400 km incoherentes contra el
valor guardado, o `hora_fin` no posterior a `hora_inicio` cuando llegan las dos
(sin contar el desfase, ver Observaciones); 500 reglas de zod (horario, km de
la misma petición, descripción en blanco).

### `DELETE /api/dias-laborados/admin/segmento/:id`

Marca `deleted_at` del tramo. 200 `{ success, message: "Segmento eliminado (soft delete)", id }`;
404 si no existe o ya estaba retirado.

### `PUT /api/dias-laborados/admin/registro/:id`

**Body** parcial:

| Campo | Tipo | Notas |
|---|---|---|
| `tipo` | `LABORADO` \| `DISPONIBLE` \| `DESCANSO` \| `MANTENIMIENTO` | |
| `observaciones` | string ≤ 500 \| null | |
| `mantenimiento_vehiculo_id`, `mantenimiento_vehiculo_placa` | uuid / string ≤ 20 | Si no llegan, valen los guardados; pero con `tipo: 'MANTENIMIENTO'` explícito el zod exige la placa en el body |
| `segmento` | objeto \| null | Tramo único, con los campos de `PUT /admin/segmento/:id` |

Si el tipo final es `LABORADO` o `DISPONIBLE` y llega `segmento`, actualiza el
primer tramo vivo y retira el resto; si no había tramos, crea uno (y entonces
`descripcion_servicio` es obligatoria). Si el tipo final es `DESCANSO` o
`MANTENIMIENTO`, retira todos los tramos e ignora `segmento`. Terminar en
`MANTENIMIENTO` sin placa por ningún camino es error; cualquier otro tipo limpia
la placa y retira los soportes.

**Respuesta 200** — `{ success, message: "Registro actualizado", data: <registro_dia_laboral> }`.

**Errores**: 404 día inexistente o retirado; 400 placa ausente (cuando el tipo no
viene en el body), vehículo inexistente o tramo nuevo sin descripción; 500 reglas
de zod (placa ausente con `tipo` explícito, horario, km).

### `DELETE /api/dias-laborados/admin/registro/:id`

Marca el día, sus tramos vivos y sus soportes. 200 `{ success, message: "Registro eliminado (soft delete)", id }`;
404 si no existe o ya estaba retirado.

### `GET /api/dias-laborados/bonos`

**Query**: `desde` y `hasta` (`AAAA-MM-DD`, obligatorias; se comparan con la
fecha del día) y `conductor_id` (uuid, opcional).

**Respuesta 200** — `{ success, data, count }`, por `created_at`. Cada bono:
`id`, `registro_dia_id`, `segmento_id`, `config_liquidacion_id`, `valor` (el
copiado al crearlo), `creado_por_id`, `observaciones`, `created_at`,
`updated_at`, `config_liquidacion` (`{ id, nombre, valor, anio, activo }`, con el
valor vigente), `fecha`, `conductor_id`, `vehiculo_id` y `vehiculo_placa` (del
tramo, si es de tramo). Solo bonos vivos.

### `POST /api/dias-laborados/bonos`

**Body** (`bonoInputSchema`, `bonos.schema.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `registro_dia_id` | uuid | sí | |
| `config_liquidacion_id` | uuid | sí | Configuración existente y activa |
| `segmento_id` | uuid \| null | no | Bono del tramo; sin él, del día |
| `valor` | número \| null | no | Se ignora: se copia el de la configuración |
| `observaciones` | string ≤ 500 \| null | no | |

**Respuesta 201** — `{ success, data: <bono con config_liquidacion> }`, importes como número.

**Errores**: 400 configuración inexistente o inactiva; 409 «Este bono ya existe
para el recorrido seleccionado»; 500 reglas de zod o día/tramo inexistente.

### `POST /api/dias-laborados/bonos/sync`

Aplica en bloque el diff que calcula el canvas. **Body**: `crear` (arreglo de
bonos con la forma de `POST /bonos`) y `eliminar` (uuid[]); zod exige los dos
aunque el esquema de Fastify no. En una transacción (30 s) retira los de
`eliminar` y crea los de `crear`, ignorando en silencio los que ya existen. Una
configuración inexistente o inactiva aborta todo con 400.

**Respuesta 200** — `{ success, created, deleted, total }` (`total = created − deleted`).

### `DELETE /api/dias-laborados/bonos/:id`

Marca `deleted_at` del bono. 200 `{ success, id, message: "Bono eliminado" }`;
404 si no existe o ya estaba retirado.

### `GET /api/dias-laborados/bonos-config-visual`

**Query**: `anio` (entero 2000–2100, obligatorio). **Respuesta 200** — las
configuraciones de liquidación activas del año con `visible` resuelto (`true` si
no hay fila): `{ success, data: [ { id, nombre, valor, tipo, anio, activo, visible } ] }`.

### `PUT /api/dias-laborados/bonos-config-visual`

**Body**: `anio` (entero) y `visibles` (uuid[], las configuraciones que se quieren
ver). Decisión global de la empresa por año: cada configuración activa del año
queda `visible` según esté o no en la lista (upsert en `bono_config_visual` con
`creado_por_id`). **Respuesta 200** — `{ success, message: "Visibilidad de bonos actualizada", data: <lo mismo que el GET> }`.

## Efectos

- **Correo**: `solicitar-acceso` envía el enlace (`EmailService.sendMagicLink`,
  remitente `Cotransmeq <noreply@cotransmeq.com>`) y deja una fila en
  `conductor_token`.
- **Sockets** ([tiempo real](../tiempo-real.md)), a todos los conectados (`io.emit`):
  - `dias-laborados:registro-actualizado` `{ conductor_id, conductor_nombre, conductor_apellido, fecha, tipo, segmentos_count, eliminado?, timestamp }`
    al guardar o retirar un día del conductor, en la carga masiva (`tipo:
    'MASIVO'`, `fecha` = día 1 del mes) y al editar o retirar tramos y días
    desde el dashboard;
  - `dias-laborados:bonos-actualizados` `{ usuario_id, usuario_nombre, created, deleted, timestamp }`
    al sincronizar bonos. `POST /bonos`, `DELETE /bonos/:id` y
    `PUT /bonos-config-visual` no emiten nada.
- **Borrado lógico**: `src/lib/soft-delete/dia-laboral.ts` (`retirarSegmentos`,
  `retirarAdjuntosDelDia`, `retirarDiaLaboral`). Los objetos de S3 de los
  soportes se conservan.

## Observaciones

- **Bonos vivos tras retirar desde el dashboard.** `DELETE /admin/registro/:id`,
  `DELETE /admin/segmento/:id` y `PUT /admin/registro/:id` (al recortar a un
  tramo o pasar a `DESCANSO`/`MANTENIMIENTO`) marcan tramos con `updateMany`
  directo, no con `retirarSegmentos`/`retirarDiaLaboral`, así que los bonos que
  cuelgan de ellos quedan vivos. `GET /bonos` filtra solo el `deleted_at` del
  propio bono, no el del día ni el del tramo: esos bonos se siguen listando, y
  según el comentario del servicio esa consulta «alimenta lo que se paga».
  `dias-laborados.service.ts`, `bonos.service.ts`.
- **Turnos que cruzan la medianoche rechazados en dos rutas.** En la carga
  masiva, `patronSchema` añade un `refine` que compara `hora_fin > hora_inicio`
  sin el desfase: un patrón 22:00 → 06:00 con `dias_offset_fin: 1` se rechaza
  aunque el tramo lo admita (el comentario del esquema dice justo lo contrario).
  `editarSegmento` repite esa comparación sin desfase (400).
  `dias-laborados-admin.schema.ts`, `dias-laborados.service.ts`.
- **Los errores de zod salen como 500**: los controladores usan `.parse()` y
  responden `err.statusCode || 500`, con el JSON de los problemas en `message`.
  Afecta a todo lo que solo valida zod: descripción en blanco, horario
  incoherente, placa de mantenimiento con `tipo` explícito, fechas del masivo
  fuera del mes o repetidas, `conductor_id` que no es UUID en `calendar-admin`,
  `crear`/`eliminar` ausentes en `bonos/sync`. `dias-laborados.controller.ts`,
  `bonos.controller.ts`, `bonos-config-visual.controller.ts`.
- Ids que no son UUID en `admin/segmento/:id`, `admin/registro/:id` y
  `bonos/:id` llegan a Prisma y salen como 500.
- Las lecturas del dashboard (`calendar-admin`, `bonos`, catálogos) solo piden
  sesión: cualquier persona del equipo ve los días de todos los conductores con
  su cédula y los bonos con su valor. Los comentarios de las rutas lo asumen a
  propósito.
- `POST /bonos` y `bonos/sync` no comprueban que `segmento_id` pertenezca a
  `registro_dia_id`.
- Los `410` de `editarSegmento`, `softDeleteSegmento`, `editarRegistro` y
  `softDeleteRegistro` son inalcanzables: la comprobación anterior ya respondió 404.
- `POST /registros` del conductor guarda un día `LABORADO` sin tramos, aunque el
  comentario del servicio dice que se exige al menos uno.
- **El token del reporte diario no se puede revocar** ni mira el estado del
  conductor: `conductorAuthMiddleware` solo verifica firma, vencimiento y
  `tipo`, sin contrastar `conductor_token` (al revés que el portal, ver
  [conductor-portal](./conductor-portal.md#flujo-de-acceso)). Comparte esa
  tabla con el token del portal; `tokenPortalVigente` lo descarta al reutilizar
  tokens para los correos. `solicitar-acceso` distingue 404 y 400, lo que deja
  saber si una cédula es de un conductor.
