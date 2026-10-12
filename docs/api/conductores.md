# Conductores

`/api/conductores` · código en [`src/modules/conductores/`](../../src/modules/conductores/) · permiso [`conductores`](../permisos.md#catálogo-de-módulos) para escribir

Ficha de cada conductor (tabla `conductores`): identificación, contacto, datos
laborales (`cargo`, `fecha_ingreso`, `salario_base`, `tipo_contrato`, EPS, fondo de
pensión, ARL), licencia (`categoria_licencia` y `vencimiento_licencia`, que leen el
FUEC y el panel de talento humano), `estado`, `sede_trabajo`, `tipo_sangre` y foto.
Los documentos de su hoja de vida están en
[conductores-documentos](./conductores-documentos.md).

Lo que normaliza el módulo antes de escribir:

- **Nombre y apellido** siempre en MAYÚSCULAS, sin dígitos ni puntuación y sin
  espacios de más; se conservan tildes, Ñ, apóstrofo y guion (`nombre-persona.ts`).
  Así se ven en la ficha, el canvas de recorridos y los PDF, y así ordena bien por
  apellido.
- **Los tres enums** (`conductores.enums.ts`) se traducen del vocabulario del
  dashboard al de Prisma: `estado` en minúscula (`ACTIVO` → `activo`, con
  sinónimos como `incapacitado` → `incapacidad` o `en_servicio` → `servicio`),
  `sede_trabajo` en mayúscula (`YOPAL`, `VILLANUEVA`, `TAURAMENA`; `Yopal` se acepta
  de entrada) y `tipo_sangre` con el nombre del miembro (`O+`, `o +` u `O_POSITIVO`
  → `O_POSITIVO`; Prisma guarda `O+`). Un valor desconocido no se descarta: responde
  400 con la lista de valores permitidos (error con código `ENUM_CONDUCTOR_INVALIDO`).

Un conductor sale de las listas de dos maneras: **ocultar** (`oculto = true`: fuera
de las tablas, pero elegible en `select-list` y con `?incluir_ocultos=true`) o la
**papelera** (`deleted_at` y `estado = 'retirado'`; restaurar lo deja `activo`).
Aparte está el **borrado permanente**, el único borrado físico legítimo del módulo,
solo para administradores y con comprobación de datos históricos.

La foto se guarda en S3 y su key en `conductores.foto_url`. Las lecturas firman la
URL (1 hora), pero buscan primero un `documento` con `categoria = 'FOTO_PERFIL'` y
`estado = 'vigente'` y solo si no lo hay usan `foto_url`.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin; `POST …/foto` lo declara además en la ruta, así que corre dos veces) |
| `GET` | sin permiso de módulo, a propósito: exigir `read` dejaría fuera a quien tiene `limited` (comentario en `conductores.routes.ts`) |
| `POST`, `PUT`, `PATCH`, `DELETE` | `conductores:full` (`preHandler` en `puedeEscribir`) |
| `GET /api/conductores/ocultos`, `GET /api/conductores/papelera`, `PATCH /api/conductores/:id/ocultar`, `PATCH /api/conductores/:id/restaurar`, `POST /api/conductores/masivo` | además, el controlador exige `role === 'admin'` o área `operaciones` o `talento_humano`; si no, 403 `{ success: false, message }` |
| `GET /api/conductores/:id/relaciones`, `DELETE /api/conductores/:id/permanente` | además, el controlador exige `role === 'admin'`; si no, 403 |

`conductores` es `general: true`: cualquier usuario autenticado tiene `full`, y
`conductores:full` solo deja fuera a quien tenga lista blanca (`permisos_rutas`) sin
ese nivel. Crear, editar, cambiar estado, mandar a la papelera y cambiar la foto
quedan abiertos a todo el equipo; las demás escrituras miran además el rol o el
área.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/conductores` | sesión | Lista paginada, sin ocultos ni eliminados, con foto firmada |
| GET | `/api/conductores/select-list` | sesión | Lista liviana para selectores |
| GET | `/api/conductores/ocultos` | sesión + admin/operaciones/talento_humano | Conductores ocultos |
| GET | `/api/conductores/papelera` | sesión + admin/operaciones/talento_humano | Papelera |
| GET | `/api/conductores/:id` | sesión | Ficha completa |
| GET | `/api/conductores/:id/relaciones` | sesión + admin | Qué datos tiene antes de un borrado permanente |
| POST | `/api/conductores` | `conductores:full` | Crea un conductor |
| PUT | `/api/conductores/:id` | `conductores:full` | Edita la ficha |
| PATCH | `/api/conductores/:id/estado` | `conductores:full` | Cambia solo el estado |
| PATCH | `/api/conductores/:id/ocultar` | `conductores:full` + admin/operaciones/talento_humano | Oculta o vuelve a mostrar |
| DELETE | `/api/conductores/:id` | `conductores:full` | Lo manda a la papelera (`retirado`) |
| PATCH | `/api/conductores/:id/restaurar` | `conductores:full` + admin/operaciones/talento_humano | Lo saca de la papelera como `activo` |
| DELETE | `/api/conductores/:id/permanente` | `conductores:full` + admin | Borrado físico |
| POST | `/api/conductores/masivo` | `conductores:full` + admin/operaciones/talento_humano | Oculta, muestra, elimina o restaura en lote |
| POST | `/api/conductores/:id/foto` | `conductores:full` | Sube o reemplaza la foto |
| DELETE | `/api/conductores/:id/foto` | `conductores:full` | Quita la foto |

Ninguna ruta valida el formato de `:id`. Salvo en `…/relaciones` y
`…/permanente`, los 500 de este controlador tienen la forma
`{ success: false, message, error }`, con el mensaje interno en `error`.

Las respuestas que devuelven «la fila completa» del conductor la devuelven sin
`password` (el hash argon2 con que entra
`POST /api/conductor-portal/acceso-revision`): lo quita el `preSerialization`
global ([middlewares](../middlewares.md#después-del-handler)).

### `GET /api/conductores`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | número | `1` | |
| `limit` | número | `50` | Sin tope |
| `search` | string | — | Contiene, sin distinguir mayúsculas, en nombre, apellido, identificación o email |
| `estado` | string | — | Se normaliza como en la escritura (`ACTIVO` vale) |
| `sede_trabajo` | string | — | Se normaliza (`Yopal` vale) |
| `orden` | `asc` \| `desc` | `asc` | Alfabético por nombre y apellido |
| `incluir_ocultos` | `'true'` \| ausente | ausente | Con `'true'` trae también los ocultos |

**Respuesta 200**

```json
{ "success": true,
  "data": [ { "id": "uuid", "nombre": "…", "apellido": "…", "tipo_identificacion": "CC", "numero_identificacion": "…",
              "email": "…", "telefono": "…", "foto_url": "conductores/…", "fecha_nacimiento": "…", "genero": "…",
              "direccion": "…", "cargo": "CONDUCTOR", "fecha_ingreso": "…", "salario_base": "…", "estado": "activo",
              "eps": "…", "fondo_pension": "…", "arl": "…", "tipo_contrato": "…", "categoria_licencia": "C2",
              "vencimiento_licencia": "…", "sede_trabajo": "YOPAL", "tipo_sangre": "O_POSITIVO",
              "created_at": "…", "updated_at": "…", "foto_signed_url": "https://…" } ],
  "pagination": { "page": 1, "limit": 50, "total": 120, "totalPages": 3 } }
```

**Errores**: 400 `{ success: false, message }` si `estado` o `sede_trabajo` no
existen; 500 `Error al obtener conductores`.

### `GET /api/conductores/select-list`

Para `<select>`: sin eliminados ni conductores en `inactivo`, `retirado` o
`suspendido`; incluye ocultos; orden A-Z por nombre y apellido. Sin fotos ni joins.

**Respuesta 200** — `{ success, data: [{ id, nombre, apellido, numero_identificacion, estado, oculto }], count }`.

### `GET /api/conductores/ocultos`, `GET /api/conductores/papelera`

**Query**: `page` (1), `limit` (50), `search` (nombre, apellido o identificación).

**Respuesta 200** — `{ success, data, pagination: { page, limit, total, totalPages } }`.
Cada elemento: `id, nombre, apellido, numero_identificacion, email, telefono,
estado, sede_trabajo, cargo, salario_base, created_at, updated_at`, más `oculto`
(en `ocultos`) o `deleted_at` (en `papelera`). Orden por nombre. `ocultos` no
filtra `deleted_at`: incluye ocultos que están en la papelera.

**Errores**: 403 si no es admin ni de operaciones o talento humano; 500.

### `GET /api/conductores/:id`

**Respuesta 200** — `{ success, data }` con todas las columnas de
`conductores` salvo `password`, más `vehiculos: [{ id, placa, marca, modelo, estado }]`,
`servicio: [{ id, fecha_solicitud, estado, valor }]` (los 10 más recientes) y
`foto_signed_url`. No filtra `deleted_at`: devuelve también conductores en la
papelera.

**Errores**: un id inexistente responde **500**
`{ success: false, message: 'Error al obtener conductor', error: 'Conductor no encontrado' }`
(ver Observaciones).

### `GET /api/conductores/:id/relaciones`

Vista previa del borrado permanente: cuántos registros tiene el conductor en cada
tabla y cuáles lo impiden.

**Respuesta 200**

```json
{ "success": true, "data": {
  "conductor": { "id": "uuid", "nombre": "NOMBRE APELLIDO", "identificacion": "…", "en_papelera": true },
  "relaciones": [ { "tabla": "recargos_planillas", "etiqueta": "Recargos en planilla de nómina", "icono": "…",
                    "cantidad": 3, "bloquea": true, "descripcion": "…" } ],
  "total_relaciones": 3, "hay_bloqueos": true, "mensaje_bloqueo": "…" } }
```

Tablas: `recargos_planillas`, `liquidaciones`, `servicio` y `vehiculos` (sin las
borradas), `registro_dia_laboral` (sin los días retirados), `firmas_desprendibles`,
`preoperacionales`, `excesos_velocidad` y `salidas_no_conformes` bloquean si hay
alguno; `documentos_compartidos` y `conductor_token` se informan pero no bloquean
(se borrarían).

**Errores**: 403 `{ success: false, message: 'No autorizado.' }`; 404
`{ success: false, message: 'Conductor no encontrado' }`.

### `POST /api/conductores`

**Body** (sin esquema de validación; el tipo `ConductorBody` del controlador está
desactualizado: habla de `nombres`/`apellidos` y el servicio lee `nombre`/`apellido`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre`, `apellido` | string | sí (los exige la base) | Se normalizan |
| `numero_identificacion` | string | no | Única: repetida → 400 |
| `tipo_identificacion` | string | no | `CC` por defecto |
| `email` | string | no | Único: repetido → 400 |
| `telefono`, `direccion`, `genero`, `eps`, `fondo_pension`, `arl`, `tipo_contrato`, `categoria_licencia` | string | no | |
| `fecha_nacimiento`, `vencimiento_licencia` | fecha | no | Una fecha que no se puede leer se guarda `null`, sin error |
| `fecha_ingreso` | fecha | no | Hoy por defecto |
| `cargo` | string | no | `CONDUCTOR` por defecto |
| `salario_base` | número | no | |
| `estado` | string | no | Se normaliza; `activo` por defecto |
| `sede_trabajo`, `tipo_sangre` | string | no | Se normalizan |

Cualquier otro campo se ignora.

**Respuesta 201** — `{ success, data, message }` con la fila creada completa.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Enum desconocido | `{ "success": false, "message": "\"X\" no es un valor válido para estado. Valores permitidos: …" }` |
| 400 | Identificación o email repetidos | `{ "success": false, "message": "Ya existe un conductor con ese número de identificación" }` (o `… ese email`) |
| 500 | Falta `nombre`/`apellido` y cualquier otro fallo | `{ "success": false, "message": "Error al crear conductor", "error": "…" }` |

### `PUT /api/conductores/:id`

**Body** — solo se aplican los campos de la lista `allowedFields` del servicio; lo
demás se ignora y un campo ausente no se toca:

`nombre`, `apellido`, `tipo_identificacion`, `numero_identificacion`, `email`,
`telefono`, `fecha_nacimiento`, `genero`, `direccion`, `fecha_ingreso`,
`salario_base`, `eps`, `fondo_pension`, `arl`, `termino_contrato`,
`fecha_terminacion`, `licencia_conduccion`, `ultimo_acceso`, `cargo`,
`categoria_licencia`, `foto_url`, `tipo_contrato`, `vencimiento_licencia`,
`estado`, `sede_trabajo`, `tipo_sangre`.

`password`, `permisos` y `oculto` quedan fuera a propósito: `conductores` es
`general: true`, y con `permisos.google_play_review` y una contraseña propia
cualquiera del equipo entraría al portal de cualquier conductor por
`acceso-revision`; `oculto` tiene su propia ruta con control de área
(`PATCH …/ocultar`).

- Fechas: `''` o una fecha ilegible se guardan como `null`; `YYYY-MM-DD` se guarda a
  las 12:00 (hora del servidor).
- `licencia_conduccion` (JSON) en `null` se ignora.
- Los enums se normalizan; nombre y apellido también.
- Identificación y email solo se comprueban si cambian.

**Respuesta 200** — `{ success, data, message }` con la fila completa.

**Errores**: 400 (enum, identificación o email repetidos); 404
`{ success: false, message: 'Conductor no encontrado' }`; 500 `Error al actualizar conductor`.

### `PATCH /api/conductores/:id/estado`

**Body**: `estado` (string, obligatorio; se normaliza).

**Respuesta 200** — `{ success, data, message }` con la fila completa.

**Errores**: 400 `El campo estado es requerido` o enum desconocido; 404; 500.

### `PATCH /api/conductores/:id/ocultar`

**Body**: `oculto` (boolean). No se valida: si falta, Prisma no cambia nada y la
respuesta dice «Conductor visible nuevamente».

**Respuesta 200** — `{ success, message, data: { id, nombre, apellido, oculto } }`.

**Errores**: 403; un id inexistente responde 500
`Error al cambiar estado de visibilidad`.

### `DELETE /api/conductores/:id`

Borrado lógico: `deleted_at = ahora` y `estado = 'retirado'`. Responde
`{ success, data, message }` con la fila; 404 si no existe. No mira si ya estaba en
la papelera.

### `PATCH /api/conductores/:id/restaurar`

`deleted_at = null` y `estado = 'activo'` (no recupera el estado que tenía).
Responde `{ success, message, data }`. 403 por rol/área; un id inexistente responde
500 `Error al restaurar conductor`.

### `DELETE /api/conductores/:id/permanente`

**Body** (opcional)

| Campo | Tipo | Notas |
|---|---|---|
| `forzar` | boolean | Sin él, se rechaza si hay datos históricos |

Sin `forzar`, responde 409 si el conductor tiene recargos, liquidaciones o
servicios sin borrar, firmas de desprendibles o preoperacionales. Con `forzar` (o
sin esos datos): borra la foto de S3 y, en una transacción, borra **en duro** sus
filas de `recargos_planillas`, `liquidaciones`, `firmas_desprendibles`,
`preoperacionales`, `excesos_velocidad`, `salidas_no_conformes`,
`registro_dia_laboral`, `servicio`, `documentos_compartidos` y `conductor_token`
(también las ya marcadas como borradas), desvincula sus vehículos
(`conductor_id = null`) y borra el conductor. Al terminar la transacción, haya
ido bien o no, vacía la caché de tokens del portal
(`olvidarTokensPortalEnCache`): sus enlaces dejan de abrir el portal en el
acto, sin esperar los 30 s de la caché de `tokenPortalRegistrado` (ver
[autenticación](../autenticacion.md#portal-del-conductor)). Las demás tablas
siguen el `onDelete` del esquema Prisma: primas y sus firmas, dispositivos push y
notificaciones del conductor se van en cascada; anticipos, conceptos de
liquidaciones de terceros, extractos FUEC y registros PESV quedan con
`conductor_id = null`; envíos y asignaciones de formularios, viáticos y
ejecuciones de servicio restringen y hacen fallar la transacción (500). Las filas
de `documento` (hoja de vida) no tienen FK y quedan con el `conductor_id` huérfano.

**Respuesta 200** — `{ success, message, data }` con la fila borrada.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 403 | No es `admin` | `{ "success": false, "message": "No autorizado. Solo administradores pueden eliminar permanentemente." }` |
| 409 | Datos históricos sin `forzar` | `{ "success": false, "message": "…", "bloqueantes": { "recargos": 0, "liquidaciones": 2, "firmas": 0, "preoperacionales": 5, "servicios": 0 } }` |
| 500 | Conductor inexistente, FK que restringe, cualquier otro fallo | `{ "success": false, "message": "<mensaje del error>" }` |

### `POST /api/conductores/masivo`

**Body** (sin esquema)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `ids` | string[] | sí | Vacío o ausente → 400 |
| `accion` | string | sí | `ocultar`, `mostrar`, `eliminar` (papelera y `retirado`), `restaurar` (`activo`); otra → 400 |

**Respuesta 200** — `{ success, message: "N conductores …", data: { count } }`.

**Errores**: 400 `Se requiere una lista de IDs válida` / `Acción no válida`; 403;
500 `Error en operación masiva`.

### `POST /api/conductores/:id/foto`, `DELETE /api/conductores/:id/foto`

`POST` recibe `multipart/form-data` y toma el primer archivo, con cualquier nombre de
campo. No valida tipo ni tamaño (solo el límite global de 200 MB del plugin
multipart). Borra de S3 la foto anterior (si falla, sigue), sube la nueva a
`conductores/<id>/<timestamp>-<nombre original>` y guarda la key en `foto_url`.
Responde `{ success, data, message }` con la fila y `foto_url_firmada` (1 hora).

`DELETE` borra el objeto de S3 y pone `foto_url = null` (si tenía).
Responde `{ success, data: { message }, message }`.

**Errores** (las dos): 400 `No se ha proporcionado ningún archivo` (solo `POST`);
404 `Conductor no encontrado`; 500.

## Efectos

- **Socket.IO** (a todos los conectados, ver [tiempo real](../tiempo-real.md)):
  `conductor:oculto` (`{ id, oculto }`), `conductor:foto-actualizada`
  (`{ conductorId, fotoUrl, fotoUrlFirmada }`) y `conductores:actualizacion-masiva`
  (`{ accion, count }`). Crear, editar, cambiar estado, borrar y restaurar no emiten
  nada.
- **S3**: fotos bajo `conductores/<id>/`; reemplazar o quitar la foto borra el
  objeto anterior (ver [integraciones](../integraciones.md)).
- **Registro de actividad**: hook global de [actividad](./actividad.md).
  `POST /api/conductores/masivo` queda con la frase «importó conductores», aunque la
  ruta oculta, muestra, elimina o restaura.
- **Avisos de licencia**: el cron `vencimientos-documentos-conductor` lee
  `vencimiento_licencia` de la ficha (ver
  [conductores-documentos](./conductores-documentos.md)).

## Observaciones

- `PUT` escribe `ultimo_acceso` tal como llega del cliente.
- `GET /api/conductores/:id` con un id inexistente responde 500: el servicio lanza
  `Conductor no encontrado` y el controlador esperaba `null`. Lo mismo en
  `PATCH …/restaurar`, `PATCH …/ocultar` y `DELETE …/permanente`, cuyos `catch` no
  distinguen el 404.
- `PUT` con `fecha_terminacion` no vacía responde 500: la columna es texto y el
  servicio la convierte en `Date`.
- Una fecha ilegible en `POST` o `PUT` se guarda como `null` sin avisar.
- **Foto.** Las lecturas prefieren el `documento` `FOTO_PERFIL` vigente sobre
  `foto_url`, pero `POST`/`DELETE …/foto` solo tocan `foto_url`: si el conductor
  tiene ese documento, la foto nueva (o quitarla) no se refleja. Esa consulta además
  no filtra `deleted_at`.
- La vista previa (`…/relaciones`) marca como bloqueantes excesos, vehículos,
  salidas no conformes y días laborados, pero `…/permanente` sin `forzar` solo mira
  recargos, liquidaciones, firmas, preoperacionales y servicios: un conductor con
  días laborados y sin nómina se borra igual, días incluidos.
- El comentario de `select-list` dice que solo entran activos, vacaciones,
  servicio, descanso, programado y disponible, pero el código solo excluye
  `inactivo`, `retirado` y `suspendido`: también salen `incapacidad` y
  `desvinculado`.
- `GET /api/conductores` no tiene tope de `limit` y hace una consulta a `documento`
  y una firma de S3 por cada conductor de la página.
- `POST …/foto` no valida el tipo ni el tamaño del archivo.
- `GET …/ocultos` no filtra `deleted_at`.

## Diferencias con Transmeralda

- `GET /api/conductores/papelera` y `GET /api/conductores/ocultos` incluyen
  `salario_base` en cada elemento en Cotransmeq; en Transmeralda no (es la única
  diferencia funcional del módulo entre los dos repos). El listado principal
  (`GET /api/conductores`) lo trae en los dos.
