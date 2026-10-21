# Servicios

`/api/servicios` · código en [`src/modules/servicios/`](../../src/modules/servicios/) · permiso [`servicios`](../permisos.md#catálogo-de-módulos) para escribir

Un servicio es un desplazamiento contratado por un cliente entre dos municipios
(`origen_id`, `destino_id`, con dirección específica y coordenadas opcionales),
con conductor y vehículo asignados o por asignar. Vive en la tabla `servicios`
(modelo `servicio`) y se retira con `deleted_at`: un servicio eliminado se
comporta como inexistente en casi todas las lecturas (excepción en
Observaciones).

El estado sigue una máquina de transiciones (`servicios.estados.ts`) y mueve a
la vez el estado operativo del conductor y del vehículo: un servicio en
`planificado` los deja en `programado`, uno en `en_curso` en `servicio`, y al
terminar o cancelarse vuelven a `disponible` si no tienen otro servicio que los
bloquee (`planificado`, `en_curso`, `planilla_asignada`). Un servicio que el
conductor inició desde la app queda «gobernado por el conductor»: los procesos
que deducen el estado (el recálculo de planillas, el cron de cierre) no lo
pisan. El número de planilla puede vivir en el propio servicio o en la planilla
de recargos vinculada; las lecturas completan `numero_planilla` con el de la
primera planilla activa y lo marcan con `numero_planilla_origen: 'recargo'`.

| Desde | Puede pasar a |
|---|---|
| `solicitado` | `planificado`, `en_curso`, `cancelado` |
| `planificado` | `en_curso`, `cancelado`, `realizado` |
| `en_curso` | `realizado`, `cancelado` |
| `pendiente` | `solicitado`, `planificado`, `cancelado` |
| `realizado` | `planilla_asignada`, `liquidado` |
| `planilla_asignada` | `liquidado` |
| `liquidado`, `cancelado` | (terminales) |

Pasar al mismo estado siempre es válido y no tiene efectos.

## Acceso

| Operación | Guarda |
|---|---|
| `GET /api/servicios/public/:token` | `pública · token`: el `share_token` del servicio (64 hex aleatorios), en la lista `RUTAS_PUBLICAS` del hook |
| Todo lo demás | `sesión` (hook `onRequest` propio del plugin, con `RUTAS_PUBLICAS` como única excepción) |
| `GET` | sin permiso de módulo: las lecturas se dejan a propósito solo con sesión, para no dejar fuera a quien tiene `limited` |
| `POST`, `PUT`, `PATCH`, `DELETE` | `servicios:full` (`puedeEscribir`, ruta por ruta) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/servicios/public/:token` | pública · token | Servicio compartido por enlace |
| GET | `/api/servicios` | sesión | Lista paginada con filtros, búsqueda y conteos por estado |
| GET | `/api/servicios/stats` | sesión | Conteos globales por estado |
| GET | `/api/servicios/buscar` | sesión | Búsqueda paginada por filtros exactos |
| GET | `/api/servicios/calendar` | sesión | Servicios de un mes, sin paginar |
| GET | `/api/servicios/filtros/conductores` | sesión | Conductores para el selector de filtros |
| GET | `/api/servicios/filtros/vehiculos` | sesión | Vehículos para el selector de filtros |
| GET | `/api/servicios/filtros/clientes` | sesión | Clientes para el selector de filtros |
| GET | `/api/servicios/:id` | sesión | Detalle de un servicio |
| GET | `/api/servicios/:id/rutograma` | sesión | PDF del rutograma |
| GET | `/api/servicios/:id/ejecucion` | sesión | Inicio y liberación del conductor, preoperacional y reporte |
| POST | `/api/servicios` | `servicios:full` | Crea un servicio |
| PUT | `/api/servicios/:id` | `servicios:full` | Edita un servicio |
| DELETE | `/api/servicios/:id` | `servicios:full` | Retira el servicio (borrado lógico) y sus planillas |
| PATCH | `/api/servicios/:id/cancelar` | `servicios:full` | Cancela con motivo |
| PATCH | `/api/servicios/:id/estado` | `servicios:full` | Cambia el estado |
| PATCH | `/api/servicios/:id/planilla` | `servicios:full` | Asigna el número de planilla |
| POST | `/api/servicios/:id/compartir` | `servicios:full` | Genera (o devuelve) el enlace público |
| DELETE | `/api/servicios/token/:token` | `servicios:full` | Revoca un enlace público |

Las rutas con esquema JSON de Fastify validan solas y responden **400** con el
formato por defecto (`{ statusCode, error, message }`); los parámetros `:id`
declaran `format: 'uuid'`.

### Forma de un servicio

Las lecturas y escrituras devuelven el servicio «aplanado»
(`transformarServiciosBatch` en `servicios.service.ts`): todos los campos de la
fila (`valor` llega como texto decimal) más `conductor`, `cliente`, `vehiculo`,
`origen` y `destino` en vez de las relaciones de Prisma. `conductor` trae
`foto_signed_url`, una URL firmada de S3 de una hora (la `foto_url` de la ficha
o, si no hay, la última `FOTO_PERFIL` vigente). Qué campos trae cada relación
depende del endpoint; el listado añade `creado_por`, `ejecucion` y las
`recargos_planillas` activas con sus días. En las respuestas JSON, `conductor`
nunca es la fila entera de `conductores`: cada consulta lo trae con un
`select`. `PATCH /estado`, `/cancelar` y `/planilla` usan el select reducido
(`CONDUCTOR_DE_SERVICIO`: `id`, `nombre`, `apellido`, `telefono`, `email`,
`estado`, `tipo_identificacion`, `numero_identificacion` y `foto_url`), que es
también lo que viaja en su evento de socket. `GET /api/servicios/:id` añade
`vencimiento_licencia` para mostrar la vigencia en la ficha del servicio.

### `GET /api/servicios`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page`, `limit` | string numérico | `1`, `20` | Sin tope para `limit` |
| `estado` | enum | — | `solicitado`, `en_curso`, `planificado`, `realizado`, `cancelado` o `liquidado` (el esquema no admite `pendiente` ni `planilla_asignada`) |
| `search` | string | — | Busca en dirección de origen y destino, número de planilla (propio o de sus planillas activas), estado (los que contienen el texto), cliente (nombre, NIT), conductor (nombre, apellido), placa y municipios/departamentos de origen y destino |
| `conductor_id`, `vehiculo_id`, `cliente_id` | uuid | — | Igualdad |
| `fecha_desde`, `fecha_hasta` | `AAAA-MM-DD` | — | Rango inclusivo; los límites se fijan a 00:00 y 23:59:59.999 **UTC** |
| `campo_fecha` | enum | `fecha_solicitud` | Columna del rango: `fecha_solicitud`, `fecha_realizacion`, `created_at` o `fecha_finalizacion` |
| `orderBy` | enum | `created_at desc` | `fecha_solicitud`, `fecha_realizacion`, `estado`, `cliente` (nombre) o `conductor` (nombre) |
| `orderDirection` | `asc` \| `desc` | `desc` | Solo con `orderBy` |

**Respuesta 200**

```json
{
  "success": true,
  "data": [ { "id": "uuid", "estado": "planificado", "numero_planilla": "CM-0123", "conductor": { "…": "…" }, "…": "…" } ],
  "stats": { "total": 120, "solicitado": 10, "en_curso": 3, "planificado": 20, "realizado": 80, "cancelado": 5, "liquidado": 2 },
  "pagination": { "page": 1, "limit": 20, "total": 120, "totalPages": 6 }
}
```

`stats` cuenta con los mismos filtros de la consulta. **Error 500**:
`{ success: false, error: 'Error al obtener servicios', details }`.

### `GET /api/servicios/stats`

Sin parámetros. `{ success: true, data: { total, solicitado, en_curso, planificado, realizado, cancelado, liquidado } }`
sobre todos los servicios no eliminados. `total` incluye `pendiente` y
`planilla_asignada`, que no tienen contador propio.

### `GET /api/servicios/buscar`

**Query**: `estado` (los ocho valores), `conductor_id`, `vehiculo_id`,
`cliente_id`, `fecha_desde` y `fecha_hasta` (fecha-hora ISO; filtran
`fecha_solicitud`), `proposito_servicio`, `page` y `limit` (máximo 100, por
defecto 1 y 20). Orden: `created_at` descendente.

**Respuesta 200**: `{ success, data, pagination: { page, limit, total, totalPages }, filters }`,
donde `filters` repite los filtros aplicados.

### `GET /api/servicios/calendar`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `mes` | `1`–`12` | mes actual (reloj del servidor) | |
| `anio` | 4 dígitos | año actual | |
| `campo_fecha` | enum | `fecha_realizacion` | `fecha_solicitud`, `fecha_realizacion` o `fecha_finalizacion` |
| `estado`, `conductor_id`, `vehiculo_id`, `cliente_id` | | — | Igualdad |

**Respuesta 200**: `{ success, data: { servicios, total, mes, anio, campo_fecha, rango: { desde, hasta } } }`.
El rango es el mes en UTC, sin paginar, ordenado por el campo de fecha.
**Error 500**: `{ success: false, error, details }`.

### `GET /api/servicios/filtros/conductores` · `/filtros/vehiculos` · `/filtros/clientes`

**Query**: `search` opcional (conductores: nombre, apellido o teléfono;
vehículos: placa, marca o modelo; clientes: nombre o NIT). Devuelven
`{ success, data }` con los no eliminados, ocultos incluidos (cada fila trae
`oculto`): un selector sí puede elegir un recurso oculto.

### `GET /api/servicios/:id`

`{ success: true, data }` con el detalle: conductor (con identificación, correo
y vencimiento de licencia), vehículo (con clase, línea y color), cliente (con
representante y dirección), municipios con coordenadas, `creado_por` y planillas
activas con vía, riesgos y calificación. **404**
`{ success: false, message: 'Servicio no encontrado' }`.

### `GET /api/servicios/:id/rutograma`

PDF (`Content-Disposition: attachment; filename="rutograma-<id>.pdf"`), formato
`HSEG-FR-23` v1, a nombre de COOPERATIVA DE TRANSPORTADORES DEL META Y CASANARE
(NIT 892099216-1; ver Observaciones). Reúne la
ruta por carretera (Mapbox, con `MAPBOX_ACCESS_TOKEN` o
`VITE_MAPBOX_ACCESS_TOKEN`), peajes y paradas (Overpass), estaciones Distracom de
un JSON local, vía y riesgos de la planilla más reciente y las firmas de los
usuarios con cargo «Jefe de Operaciones» y «Coordinadora HSEQ». Sin token de
Mapbox o sin coordenadas sale igual, sin mapa ni distancia. Lo renderiza
Chromium (`pdfFromHtml`).

**Errores**: **404** `{ success: false, message: 'Servicio no encontrado' }`;
**400** `{ success: false, message }` con cualquier otro fallo.

### `GET /api/servicios/:id/ejecucion`

Lo que hizo el conductor desde la app (lo escribe el portal del conductor; aquí
solo se lee):

```json
{
  "success": true,
  "data": {
    "ejecucion": { "conductor_id": "uuid", "iniciado_at": "…", "liberado_at": "…", "iniciado_diferido": false,
                   "liberado_diferido": false, "reporte": { "km_final": 0, "via_trocha": false, "…": "…" },
                   "pausas_activas_cada_horas": 2, "recomendaciones": "…", "…": "…" },
    "preoperacional": { "submission_id": "uuid", "code": "…", "status": "SUBMITTED", "etapas_cerradas": [1, 2, 3],
                        "eliminado": false, "detalle_path": "/dashboard/formularios/envios/<id>", "…": "…" },
    "fotos_desplazamiento": [ { "id": "uuid", "field_key": "…", "pausa_activa": true, "url": "<firmada>", "…": "…" } ]
  }
}
```

Sin ejecución: `{ ejecucion: null, preoperacional: null, fotos_desplazamiento: [] }`.
Las fotos son las de la etapa 2 del preoperacional, con las de pausas activas
primero; una que no se pueda firmar se omite. **404** si el servicio no existe.

### `POST /api/servicios`

**Body** (esquema JSON de Fastify y después zod `createServicioSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `cliente_id`, `origen_id`, `destino_id` | uuid | sí | Cliente y municipios |
| `fecha_solicitud` | fecha-hora ISO | sí | |
| `conductor_id`, `vehiculo_id` | uuid \| `null` | no | |
| `origen_especifico`, `destino_especifico` | string | no | `''` si faltan |
| `origen_latitud`, `origen_longitud`, `destino_latitud`, `destino_longitud` | number | no | |
| `estado` | enum | no | `solicitado` por defecto. Si nace en otro estado que `solicitado`, `pendiente` o `cancelado`, se valida la transición desde `solicitado` y se aplican los efectos sobre conductor y vehículo |
| `proposito_servicio` | `personal` \| `personal y herramienta` \| `personal_y_herramienta` | no | `personal` por defecto; la forma con espacio se guarda con guion bajo |
| `fecha_realizacion`, `fecha_finalizacion` | fecha-hora ISO | no | |
| `valor` | number | no | `0` por defecto; si llega, zod exige que sea positivo |
| `numero_planilla`, `observaciones` | string | no | |

**Respuesta 201**: `{ success: true, message: 'Servicio creado exitosamente', data }`.

Si trae `fecha_realizacion`, crea además una planilla de recargos vinculada
(empresa = cliente, mes y año de esa fecha, sin días). Si esa creación falla
(por ejemplo, sin conductor o vehículo), se registra en el log y el servicio
queda creado igual.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta un obligatorio o un uuid no tiene formato (esquema de Fastify) | formato de Fastify |
| 400 | Clave foránea rota (cliente, municipio, conductor o vehículo inexistente) | `{ success: false, message: 'Error en las relaciones: …' }` |
| 500 | Lo que rechaza zod, o un estado inicial con transición inválida | formato de Fastify |

### `PUT /api/servicios/:id`

**Body**: los mismos campos del alta, todos opcionales (zod
`updateServicioSchema`, sin esquema JSON de Fastify). Solo se cambia lo que
llega.

- Cambiar `estado` valida la transición (**409**) y mueve conductor y vehículo;
  cambiar conductor o vehículo libera al anterior y reserva al nuevo.
- `conductor_id` o `vehiculo_id` en `null` o `''` se convierten en «no llegó»:
  por esta ruta no se puede desasignar.
- Si el body trae `fecha_realizacion` y el servicio tiene conductor y vehículo,
  crea la planilla vinculada si no existe o, si existe, le copia conductor,
  vehículo, empresa, mes y año cuando cambiaron (ver [recargos](./recargos.md)).
  Aquí las planillas no tienen historial, así que ese cambio no deja rastro.

**Respuesta 200**: `{ success: true, message: 'Servicio actualizado exitosamente', data }`.

**Errores**: **409** `{ success: false, message: 'Transición inválida: …' }`;
**500** con lo que rechaza zod y con un id inexistente (ver Observaciones).

### `DELETE /api/servicios/:id`

Marca `deleted_at` en el servicio y en sus planillas de recargos activas (solo
la fila de la planilla). No se confunde con `cancelado`, que es un hecho de
negocio: esto es que el servicio no debió registrarse. Antes de marcar avisa al
conductor asignado. **Respuesta 200**: `{ success: true, message: 'Servicio eliminado exitosamente' }`.

### `PATCH /api/servicios/:id/cancelar`

**Body** (JSON obligatorio, puede ser `{}`): `observaciones` (string, opcional)
es el motivo.

Pone `cancelado`, `fecha_finalizacion` = ahora y `observaciones` = el motivo o
«Servicio cancelado»; libera conductor y vehículo y avisa al conductor con el
motivo. Desde `realizado`, `planilla_asignada` o `liquidado` la transición es
inválida y responde **500** (este controlador no la traduce a 409). Cancelar
uno ya cancelado reescribe motivo y fecha y vuelve a avisar.

**Respuesta 200**: `{ success: true, message: 'Servicio cancelado exitosamente', data }`.

### `PATCH /api/servicios/:id/estado`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | enum (los ocho) | sí | |
| `observaciones` | string | no | Reemplaza las observaciones del servicio |

`en_curso` fija `fecha_realizacion` = ahora; `realizado` fija
`fecha_finalizacion` = ahora. Pasar a `cancelado` por aquí no avisa al
conductor (usar `/cancelar`).

**Respuesta 200**: `{ success: true, message: 'Estado del servicio cambiado a: <estado>', data }`.
**Errores**: **409** transición inválida; **500** si el id no existe.

### `PATCH /api/servicios/:id/planilla`

**Body**: `numero_planilla` (string, mínimo 1 carácter, obligatorio). Solo
escribe la columna del servicio; no toca la planilla de recargos.
**Respuesta 200**: `{ success, message, data }`. **404** si el id no existe.

### `POST /api/servicios/:id/compartir` · `DELETE /api/servicios/token/:token`

`compartir` devuelve el token vigente o genera uno nuevo
(`randomBytes(32)` en hex) sin caducidad:

```json
{ "success": true, "message": "Token de compartir generado exitosamente",
  "data": { "share_token": "<64 hex>", "expires_at": null, "servicio_id": "uuid" } }
```

**404** `{ success: false, message: 'Servicio no encontrado' }`. Revocar borra
el token: el enlace deja de resolver. **404** `{ success: false, message: 'Token no encontrado' }`.

### `GET /api/servicios/public/:token`

`{ success: true, data }` con el servicio, su conductor (nombre, teléfono,
identificación, foto firmada), vehículo, cliente y municipios. Un servicio
eliminado no resuelve.

**Errores**: **404** `{ success: false, message: 'Enlace inválido o expirado' }`;
**410** `{ success: false, message: 'Este enlace ha expirado' }` si
`share_token_expires_at` ya pasó (la API nunca lo fija, así que hoy no ocurre).

## Efectos

- **Socket.IO**, a todos los conectados (`servicios.events.ts`). Los nombres y
  la forma del payload los fija el store del frontend; los cruza
  `tests/contrato-eventos.test.ts` y `tests/sockets-dominio-integracion.test.ts`
  comprueba que un `POST` produce el evento. `emitir()` pasa cada payload por
  `sinCredenciales` antes de enviarlo. Ver [tiempo-real](../tiempo-real.md).

  | Evento | Lo emite | Payload |
  |---|---|---|
  | `servicio:creado` | `POST` | el servicio |
  | `servicio:actualizado` | `PUT` | el servicio |
  | `servicio:estado-actualizado` | `PATCH /estado` | `{ servicio, estadoAnterior }` |
  | `servicio:numero-planilla-actualizado` | `PATCH /planilla` | `{ id, servicio }` |
  | `servicio:cancelado` | `PATCH /cancelar` | el servicio |
  | `servicio:eliminado` | `DELETE /:id` | `{ id }` |

- **Avisos al conductor** (`servicios-notificaciones.service.ts`): fila en
  `conductor_notification` y push al canal `servicios` de la app;
  `SERVICIO_ASIGNADO` al crear con conductor o al asignarlo en `PUT`,
  `SERVICIO_DESASIGNADO` al que sale en un `PUT`, `SERVICIO_CANCELADO` (con el
  motivo) y `SERVICIO_ELIMINADO` (antes del borrado, con una instantánea del
  servicio). Sin dispositivo el aviso queda en el inbox. `PATCH /estado` no
  avisa.
- **Aviso al equipo**: crear un servicio deja una notificación
  `servicio_creado` (campana y app de gestión) a todos los usuarios activos con
  acceso a `servicios`, menos a quien lo creó.
- **Estados de conductor y vehículo** según la tabla de la cabecera.
- **Planillas de recargos**: creación y sincronización desde `POST` y `PUT`;
  `DELETE` marca las planillas vinculadas.
- **Cron** `cerrar-servicios-con-planilla` (08:00 y 18:00, hora de Bogotá):
  pasa a `realizado` los servicios con planilla numerada, salvo los cancelados
  y los gobernados por el conductor. Ver [tareas programadas](../tareas-programadas.md).

## Observaciones

- **El enlace público no caduca** y devuelve la fila entera del servicio
  (`valor`, `observaciones`, `no_conformidades`) más cédula y teléfono del
  conductor. No tiene límite de intentos (el token no es adivinable).
- **404 que salen como 500.** `PUT`, `PATCH /estado` y `/cancelar` lanzan
  «Servicio no encontrado», pero el controlador solo reconoce el texto de
  Prisma; `DELETE` busca «Record to delete does not exist» y Prisma dice
  «Record to update not found». Además, los errores de zod y una transición
  inválida en el alta no se capturan y salen como 500.
- `GET /calendar` no filtra `deleted_at`: los servicios eliminados aparecen en
  el calendario. `PATCH /planilla` tampoco lo mira y escribe en un servicio
  retirado.
- `DELETE` no libera al conductor ni al vehículo (no pasa por
  `aplicarEfectosColaterales`) y marca solo la fila de la planilla, no sus días
  ni detalles.
- `proposito_servicio` en `/buscar`: el esquema de Fastify admite `personal`,
  `empresarial`, `medico` y `aeropuerto`; zod, `personal` y las dos formas de
  `personal y herramienta`. Solo `personal` pasa los dos; lo demás da 400 o
  500.
- `valor: 0` pasa el esquema de Fastify (`minimum: 0`) y lo rechaza zod
  (`positive`): 500.
- Las descripciones de Swagger de `DELETE`, `/cancelar` y `/planilla` hablan de
  roles `gestor_servicio` y `gestor_planillas` que no existen: la guarda real es
  `servicios:full`.
- El rutograma toma la planilla más reciente del servicio sin mirar si está
  eliminada.
- El rutograma sale a nombre de «COOPERATIVA DE TRANSPORTADORES DEL META Y
  CASANARE», NIT 892099216-1 (`EMPRESA` en `rutograma.service.ts`), mientras
  que el FUEC usa «SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.», NIT 901.983.227
  (`extractos/fuec.config.ts`). Conviene confirmar cuál debe figurar.
