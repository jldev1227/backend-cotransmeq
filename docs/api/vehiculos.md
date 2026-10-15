# Vehículos (flota)

`/api/vehiculos` y `/api/flota/basicos` · código en [`src/modules/vehiculos/`](../../src/modules/vehiculos/) · permiso [`flota`](../permisos.md#catálogo-de-módulos) para escribir

Ficha de cada vehículo de la flota (tabla `vehiculos`): placa única, datos de la
tarjeta de propiedad, propietario vinculado por `tercero_propietario_id` a
[terceros](./terceros.md) y su snapshot visible en `propietario_nombre` y
`propietario_identificacion`,
conductor titular (`conductor_id`), estado operativo (`disponible`, `programado`,
`servicio`, `mantenimiento`, `inactivo`, `desvinculado`) y kilometraje. La hoja de
vida documental está en [vehiculos-documentos](./vehiculos-documentos.md), los
planes y órdenes de taller en [mantenimiento](./mantenimiento.md) y los tanqueos en
[combustible](./combustible.md).

Hay dos maneras de sacar un vehículo de las listas, y no son lo mismo:
**ocultar** (`oculto = true`) lo quita de las tablas pero lo deja elegible en los
selectores (`GET /api/flota/basicos` y `GET /api/vehiculos?incluir_ocultos=true`
lo siguen trayendo); **eliminar** lo manda a la papelera (`deleted_at`, borrado
lógico) y se puede restaurar. El `kilometraje` de la ficha no lo mantiene esta API:
lo escribe cada hora el cron `sincronizar-kilometraje` con el `km_final` del último
preoperacional entregado, y nunca lo baja. Las columnas del FUEC
(`numero_interno`, `tarjeta_operacion`, `empresa_afiliacion`) tampoco se escriben
aquí: las completa la emisión de [extractos](./extractos.md).

Cambiar `tercero_propietario_id` modifica la afiliación vigente. No reescribe los
propietarios ni valores guardados en liquidaciones y cierres finales anteriores.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo, a propósito: exigir `read` dejaría fuera a quien tiene `limited` (comentario en `vehiculos.routes.ts`) |
| `POST`, `PUT`, `PATCH`, `DELETE` | `flota:full` (`preHandler` en la constante `puedeEscribir`) |
| `GET /api/vehiculos/ocultos`, `PATCH /api/vehiculos/:id/ocultar`, `POST /api/vehiculos/masivo` | además, el controlador exige `role === 'admin'` o área `operaciones` o `talento_humano`; si no, 403 `{ success: false, message }` |

`flota` es `general: true`: cualquier usuario autenticado tiene `full`, así que
`flota:full` solo deja fuera a quien tenga lista blanca (`permisos_rutas`) sin ese
nivel. En la práctica cualquiera del equipo crea, edita o manda a la papelera un
vehículo; solo ocultar y las operaciones masivas miran el área.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/flota/basicos` | sesión | Lista liviana para selectores (incluye ocultos) |
| GET | `/api/vehiculos` | sesión | Lista completa, sin eliminados ni ocultos |
| GET | `/api/vehiculos/ocultos` | sesión + admin/operaciones/talento_humano | Vehículos ocultos |
| GET | `/api/vehiculos/deleted/list` | sesión | Papelera |
| GET | `/api/vehiculos/:id` | sesión | Ficha con conductor y servicios |
| POST | `/api/vehiculos` | `flota:full` | Crea un vehículo |
| PUT | `/api/vehiculos/:id` | `flota:full` | Edita un vehículo |
| DELETE | `/api/vehiculos/:id` | `flota:full` | Lo manda a la papelera |
| POST | `/api/vehiculos/:id/restore` | `flota:full` | Lo saca de la papelera |
| PATCH | `/api/vehiculos/:id/ocultar` | `flota:full` + admin/operaciones/talento_humano | Oculta o vuelve a mostrar |
| POST | `/api/vehiculos/masivo` | `flota:full` + admin/operaciones/talento_humano | Oculta, muestra, elimina o restaura en lote |

Las rutas con `:id` validan el parámetro con el esquema JSON de Fastify
(`format: 'uuid'`): un id mal formado responde 400 con el formato de Fastify.

### `GET /api/flota/basicos`

Para `<select>`: vehículos no eliminados, ocultos incluidos, ordenados por placa.

**Respuesta 200**

```json
{ "success": true, "count": 1,
  "data": [ { "id": "uuid", "placa": "ABC123", "marca": "…", "modelo": "…", "clase_vehiculo": "…",
              "estado": "disponible", "oculto": false,
              "conductores": { "id": "uuid", "nombre": "…", "apellido": "…" } } ] }
```

### `GET /api/vehiculos`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `incluir_ocultos` | `'true'` \| ausente | ausente | Con `'true'` trae también los ocultos (para selectores) |

**Respuesta 200** — `{ success, data, count }`. Cada elemento lleva todas las
columnas de `vehiculos` y `conductores: { id, nombre, apellido, email, telefono, estado }`
(o `null`). Sin eliminados; orden por `created_at` descendente.

### `GET /api/vehiculos/ocultos`, `GET /api/vehiculos/deleted/list`

- `ocultos`: vehículos con `oculto = true` y sin borrar, por `updated_at`
  descendente. Responde `{ success, message, data, total }` (ojo: `total`, no
  `count`). 403 si el usuario no es admin ni de operaciones o talento humano.
- `deleted/list`: los que tienen `deleted_at`, por `deleted_at` descendente.
  Responde `{ success, data, count }`.

En los dos, cada elemento lleva el conductor como en `GET /api/vehiculos`.

### `GET /api/vehiculos/:id`

**Respuesta 200** — `{ success, data }` con todas las columnas del vehículo,
`conductores: { id, nombre, apellido, email, telefono, estado } | null` y
`servicio: [{ id, estado, fecha_solicitud, origen_especifico, destino_especifico }]`.

No filtra `deleted_at`: también devuelve vehículos que están en la papelera.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 404 | No existe | `{ "success": false, "message": "Vehículo no encontrado" }` |

### `POST /api/vehiculos`

**Body** — pasa dos validaciones: el esquema JSON de la ruta (Fastify, 400) y
después zod (`createVehiculoSchema` en `vehiculos.schema.ts`), que descarta lo que
no conoce.

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `placa` | string | sí | Mínimo 6 caracteres; única |
| `clase_vehiculo` | string | sí | Mínimo 2 |
| `marca`, `linea` | string | no | Mínimo 2 |
| `modelo` | string | no | Mínimo 1 |
| `color`, `tipo_carroceria`, `combustible`, `numero_motor`, `vin`, `numero_serie`, `numero_chasis` | string | no | |
| `propietario_nombre`, `propietario_identificacion` | string | no | Texto libre |
| `kilometraje` | entero ≥ 0 | no | El esquema JSON admite decimales; zod exige entero |
| `estado` | enum | no | `disponible` (defecto de la base), `programado`, `servicio`, `mantenimiento`, `inactivo`, `desvinculado` |
| `fecha_matricula` | string | no | La columna es texto |
| `conductor_id` | uuid | no | Conductor titular |
| `capacidad_pasajeros` | number ≥ 1 | — | Lo acepta el esquema JSON, pero zod lo descarta: no existe en la tabla |

**Respuesta 201** — `{ success, message, data }` con el vehículo creado y
`conductores: { id, nombre, apellido, email, telefono }`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Esquema JSON (campo requerido, `minLength`, enum, uuid) | formato de Fastify |
| 400 | Placa repetida (`Unique constraint`) | `{ "success": false, "message": "Ya existe un vehículo con esa placa" }` |
| 500 | Rechazo de zod, `conductor_id` inexistente y cualquier otro fallo | formato de Fastify (`{ statusCode, error, message }`) |

### `PUT /api/vehiculos/:id`

Mismos campos que el alta, todos opcionales (`updateVehiculoSchema`); no hay
esquema JSON de body, solo zod. Solo cambia lo que llega.

**Respuesta 200** — `{ success, message, data }` con el vehículo y su conductor.

**Errores**: 404 `{ success: false, message: 'Vehículo no encontrado' }` si no
existe (error `P2025` de Prisma); un rechazo de zod o una placa repetida salen como
500 con el formato de Fastify.

### `DELETE /api/vehiculos/:id`

Borrado lógico: pone `deleted_at`. Responde `{ success, message }`. No mira si ya
estaba en la papelera (vuelve a escribir la fecha).

### `POST /api/vehiculos/:id/restore`

Pone `deleted_at = null`. Responde `{ success, message, data: {} }` (ver
Observaciones: `data` llega vacío). 404 `{ success: false, message }` si no existe.

### `PATCH /api/vehiculos/:id/ocultar`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `oculto` | boolean | sí | `true` oculta, `false` vuelve a mostrar. El esquema JSON convierte `"true"`/`"false"` |

**Respuesta 200** — `{ success, message, data: {} }` (`data` llega vacío, ver
Observaciones).

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 403 | Ni admin ni área operaciones/talento humano | `{ "success": false, "message": "No autorizado. …" }` |
| 404 | No existe | `{ "success": false, "message": "Vehículo no encontrado" }` |
| 500 | Cualquier otro fallo | `{ "success": false, "message": "Error al cambiar estado de ocultamiento", "error": "…" }` |

### `POST /api/vehiculos/masivo`

**Body** (esquema JSON de la ruta)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `ids` | uuid[] | sí | Vacío → 400 |
| `accion` | enum | sí | `ocultar`, `mostrar`, `eliminar` (papelera), `restaurar` |

Es un `updateMany` sobre los ids, sin mirar el estado de cada uno (ocultar alcanza
también a los que están en la papelera).

**Respuesta 200** — `{ success, message: "N vehículos …", data: { count } }`.

**Errores**: 400 `Se requieren IDs para la operación masiva`; 403 como en
`ocultar`; 500 `{ success: false, message: 'Error en operación masiva', error }`.

## Efectos

- **Socket.IO** (a todos los conectados, ver [tiempo real](../tiempo-real.md)):
  `vehiculo-creado` (el vehículo), `vehiculo-actualizado` (el vehículo) y
  `vehiculo-eliminado` (`{ id }`), declarados en `EVENTOS_VEHICULO`
  (`vehiculos.events.ts`); `vehiculo:oculto` (`{ id, oculto, placa }`) y
  `vehiculos:actualizacion-masiva` (`{ accion, count }`) desde el controlador.
  Restaurar no emite nada. La mezcla de guion y dos puntos es heredada: los nombres
  son los que ya escucha `/dashboard/flota` y no se renombran.
- **Registro de actividad**: el hook global anota cada escritura que termina bien
  (ver [actividad](./actividad.md)). `POST /api/vehiculos/masivo` queda con la
  frase «importó vehículos», aunque la ruta oculta, muestra, elimina o restaura.
- **Cron `sincronizar-kilometraje`** (cada hora, minuto 20, hora de Bogotá):
  actualiza `vehiculos.kilometraje` desde los preoperacionales (ver
  [tareas programadas](../tareas-programadas.md)).

## Observaciones

- `POST /api/vehiculos/:id/restore` y `PATCH /api/vehiculos/:id/ocultar` responden
  `data: {}`: su esquema de respuesta declara `data: { type: 'object' }` sin
  propiedades y el serializador de Fastify la vacía. El alta sí declara
  `additionalProperties: true` y devuelve el vehículo (`vehiculos.routes.ts`).
- Por el mismo motivo, el 403 de `requirePermission` en `PATCH …/ocultar` sale sin
  el campo `error` (el esquema 403 solo tiene `success` y `message`).
- `DELETE /api/vehiculos/:id` con un id inexistente responde **500**, no 404: el
  controlador busca el texto `Record to delete does not exist`, pero el servicio
  hace un `update` y Prisma dice `Record to update not found`
  (`vehiculos.controller.ts`).
- Los rechazos de zod salen como 500 con el JSON de zod en `message`: el
  controlador los relanza y no hay manejador de errores. Le pasa siempre a `PUT`, y
  a `POST` cuando el esquema JSON los deja pasar (un `kilometraje` decimal).
- Placa repetida: 400 en `POST`, 500 en `PUT`.
- Los comentarios de `deleted/list` y `restore` dicen «solo para administradores»,
  pero el código no lo comprueba: listar la papelera pide solo sesión.
- `GET /api/vehiculos/:id` trae **todos** los servicios del vehículo, sin límite y
  sin filtrar los borrados.
- `PUT`, `DELETE` y `restore` no actualizan `updated_at` (la columna no tiene
  `@updatedAt`); ocultar y las operaciones masivas sí.
