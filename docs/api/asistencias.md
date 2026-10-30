# Asistencias

`/api/asistencias` y `/api/public/asistencias` · código en [`src/modules/asistencias/`](../../src/modules/asistencias/) · permiso [`asistencias`](../permisos.md#catálogo-de-módulos)

Listas de asistencia a capacitaciones, charlas, reuniones y demás eventos de
HSEQ. Cada evento es un `formularios_asistencia` y cada firma de un asistente
una `respuestas_asistencia` (nombre, documento, cargo, teléfono, firma en
base64, IP, user agent y huella del dispositivo). El formulario nace con un
`token` aleatorio de 64 caracteres hexadecimales que va en el QR o el enlace:
con él, cualquier persona sin sesión abre el evento y firma desde su teléfono.

Reglas que un integrador necesita saber:

- **Una firma por dispositivo**: `device_fingerprint`, que genera el cliente,
  es único por formulario (`@@unique([formulario_id, device_fingerprint])`).
  Repetir responde 409.
- **Solo se firma un formulario activo**. Cerrar (`activo: false`) es la forma
  de dejar de recibir firmas; eliminar es borrado lógico y no lo cierra (ver
  Observaciones).
- `duracion_minutos` la calcula el servidor con `hora_inicio` y
  `hora_finalizacion` (`HH:mm`); si la hora final es menor, asume que el evento
  cruza la medianoche.
- `fecha` es `@db.Date`: llega como ISO 8601 en UTC (con `Z`) y se guarda el
  día.
- El portal del conductor y Mis capacitaciones también firman asistencias, con
  sus propias rutas y autenticación (`src/modules/conductor-portal/capacitaciones.service.ts`;
  ver [conductor-portal](./conductor-portal.md) y [mis-capacitaciones](./mis-capacitaciones.md)).

## Acceso

| Operación | Guarda |
|---|---|
| Rutas `/asistencias/…` | `sesión` (`onRequest: authMiddleware` en cada ruta) y `permisoPorMetodo('asistencias')` en el plugin: `asistencias:read` en `GET`, `asistencias:full` en el resto. Solo Administración y HSEQ tienen el módulo |
| `POST /asistencias/formularios/exportar-seleccionados-pdf` | es una descarga, pero al ser `POST` pide `asistencias:full` |
| Rutas `/public/asistencias/:token…` | `pública · token`: quedan fuera de la guarda por `excepto` (patrón que empieza por `/public/`). El `token` se busca por igualdad en `formularios_asistencia.token`; `verificar` y `responder` piden además `device_fingerprint`. `verificar` está limitada a 120 consultas por IP cada 15 minutos (`preHandlerLimite`, 429 con `Retry-After`); el tope es holgado porque en una charla el salón entero abre el QR desde la misma conexión. `responder` no tiene límite |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/asistencias/formularios` | `asistencias:read` | Lista paginada de formularios con su número de firmas |
| POST | `/api/asistencias/formularios` | `asistencias:full` | Crea un formulario y su token |
| GET | `/api/asistencias/formularios/ids` | `asistencias:read` | Ids de todos los formularios del filtro (selección masiva) |
| GET | `/api/asistencias/formularios/exportar-todas-pdf` | `asistencias:read` | ZIP con un PDF por formulario del filtro |
| POST | `/api/asistencias/formularios/exportar-seleccionados-pdf` | `asistencias:full` | ZIP con un PDF por formulario elegido |
| PATCH | `/api/asistencias/formularios/estado` | `asistencias:full` | Activa o cierra varios formularios |
| GET | `/api/asistencias/formularios/:id` | `asistencias:read` | Formulario con todas sus firmas |
| PUT | `/api/asistencias/formularios/:id` | `asistencias:full` | Edita, activa o cierra un formulario |
| DELETE | `/api/asistencias/formularios/:id` | `asistencias:full` | Borrado lógico del formulario |
| GET | `/api/asistencias/formularios/:id/respuestas` | `asistencias:read` | Firmas de un formulario |
| GET | `/api/asistencias/formularios/:id/exportar` | `asistencias:read` | Excel del evento y sus asistentes |
| GET | `/api/asistencias/formularios/:id/exportar-pdf` | `asistencias:read` | PDF del evento con las firmas |
| DELETE | `/api/asistencias/respuestas` | `asistencias:full` | Borra firmas sueltas |
| GET | `/api/public/asistencias/:token` | pública · token | Datos del evento para la página de firma |
| GET | `/api/public/asistencias/:token/verificar` | pública · token | Si este dispositivo ya firmó: solo nombre y fecha |
| POST | `/api/public/asistencias/:token/responder` | pública · token | Registra la firma de un asistente |

Varias rutas declaran esquema JSON de Fastify (body, `:id` con
`format: uuid`, patrones de fecha y hora): lo que no cumple se rechaza con 400
en el formato de Fastify (`{ statusCode, error, message }`). Después el
controlador valida con zod (`asistencias.schema.ts`) y, si zod rechaza,
responde **500** con el detalle de zod en `message`. Los errores propios tienen
la forma `{ "success": false, "message": "…" }`.

### `GET /api/asistencias/formularios`

**Query** (sin esquema: el controlador los lee tal cual)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero | `1` | |
| `limit` | entero | `10` | Máximo 100 |
| `search` | string | — | Contiene, sin distinguir mayúsculas: temática, objetivo, tipo de evento, «otro», sede o instructor |
| `filterActivo` | `all` \| `activo` \| `inactivo` | `all` | |
| `desde`, `hasta` | `YYYY-MM-DD` | — | Fecha del evento, ambas inclusive. Con otro formato se ignoran |
| `sortBy` | `fecha` \| `tematica` | `fecha` | Cualquier otro valor (incluido `respuestas`) ordena por `created_at` |
| `sortOrder` | `asc` \| `desc` | `desc` | |

Los mismos filtros (`search`, `filterActivo`, `desde`, `hasta`) los comparten
`ids` y `exportar-todas-pdf`, para que «Seleccionar todos» y «Descargar todas»
traigan lo mismo que la tabla. Los eliminados nunca salen.

**Respuesta 200**

```json
{ "success": true,
  "data": [ { "id": "uuid", "tematica": "…", "fecha": "2026-10-10T00:00:00.000Z", "token": "…64 hex…", "activo": true,
              "hora_inicio": "08:00", "hora_finalizacion": "09:30", "duracion_minutos": 90, "tipo_evento": "capacitacion", "…": "…",
              "creado_por": { "id": "uuid", "nombre": "…", "correo": "…" }, "_count": { "respuestas": 23 } } ],
  "meta": { "total": 120, "page": 1, "limit": 10, "totalPages": 12 } }
```

### `POST /api/asistencias/formularios`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tematica` | string ≤ 255 | sí | |
| `fecha` | ISO 8601 con `Z` | sí | zod `datetime()` no admite desfase (`-05:00`) |
| `objetivo` | string | no | |
| `hora_inicio`, `hora_finalizacion` | `HH:mm` | no | |
| `tipo_evento` | `capacitacion` \| `asesoria` \| `charla` \| `induccion` \| `reunion` \| `divulgacion` \| `otro` | no | `capacitacion` por defecto |
| `tipo_evento_otro` | string ≤ 255 | si `tipo_evento` es `otro` | |
| `lugar_sede`, `nombre_instructor` | string ≤ 255 | no | |
| `observaciones` | string | no | No está en el esquema de Fastify, pero zod lo acepta y se guarda |

`creado_por_id` sale del token.

**Respuesta 201** — `{ "success": true, "message": "…", "data": {} }`. `data`
llega **vacío**: el esquema de respuesta 201 declara `data` como
`{ type: 'object' }` sin propiedades y el serializador de Fastify omite todo
lo no declarado. El formulario creado, con su `token`, solo llega por el evento
`asistencias:formulario:created` o volviendo a pedir la lista.

**Errores**: 400 de Fastify (falta `tematica` o `fecha`, formato u opción
inválida); 500 si zod rechaza (p. ej. `otro` sin especificar o fecha con
desfase).

### `GET /api/asistencias/formularios/:id`

El formulario con `creado_por`, `_count.respuestas` y todas sus `respuestas`
(de la más reciente a la más antigua, completas: firma, IP, user agent,
huella). Los formularios retirados no se exponen; responden 404 `Formulario no
encontrado`. Sus firmas históricas permanecen guardadas.

### `PUT /api/asistencias/formularios/:id`

Body: los mismos campos del alta, todos opcionales, más `activo` (boolean).
Solo se cambia lo que llega. `duracion_minutos` se recalcula únicamente si
llegan las dos horas. Responde 200 con el formulario (sin respuestas) y emite
`asistencias:formulario:disabled` si llega `activo: false`, o
`asistencias:formulario:updated` en cualquier otro caso. 500 si zod rechaza o
si el formulario no existe.

### `DELETE /api/asistencias/formularios/:id`

Borrado lógico (`deleted_at`). No toca `activo` ni destruye las firmas. El
detalle y el enlace público dejan de exponer el formulario retirado. Responde
`{ success, message }`; 500 si no existe.

### `PATCH /api/asistencias/formularios/estado`

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `ids` | uuid[] | sí | Al menos uno |
| `activo` | boolean | sí | `true` activa, `false` cierra |

Solo cambia los no eliminados que estaban en el estado contrario.

**Respuesta 200** — `{ "success": true, "message": "Formularios cerrados", "actualizados": 3 }`.
Emite `asistencias:formulario:updated` (activar) o
`asistencias:formulario:disabled` (cerrar) con `{ ids, activo, timestamp }`.

### `DELETE /api/asistencias/respuestas`

Body `{ "ids": ["uuid", …] }`. **Borra en duro** esas firmas.
Responde `{ "success": true, "deleted": 2 }`; 400 si `ids` está vacío.

### `GET /api/asistencias/formularios/:id/respuestas`

`{ success, data: [<firma completa>] }`, de la más reciente a la más antigua.
No comprueba que el formulario exista: con un id desconocido devuelve `[]`.

### Exportaciones

- `GET /api/asistencias/formularios/:id/exportar`: Excel con la hoja
  «Información» (datos del evento y total de asistentes) y, si hay firmas, la
  hoja «Asistentes» (sin las imágenes de firma ni su contenido Base64).
  `Content-Disposition: attachment; filename="asistencia_<temática>_<fecha>.xlsx"`.
- `GET /api/asistencias/formularios/:id/exportar-pdf`: PDF del evento con las
  firmas (`pdf-generator.service.ts`). Aquí `:id` no se valida como uuid.
- `GET /api/asistencias/formularios/ids`: mismos filtros que el listado (aquí `desde` y
  `hasta` con otro formato dan 400). Responde
  `{ success, data: [ids], activos: [ids de los activos] }`, para que la barra
  de selección sepa cuántos activar y cuántos cerrar aunque no tenga cargadas
  todas las páginas.
- `GET /api/asistencias/formularios/exportar-todas-pdf`: mismos filtros y validación que
  `ids`, más `jobId` (opcional). ZIP `asistencias_<fecha>.zip` con un PDF por formulario, en
  carpetas `AAAA/MM-mes/AAAA-MM-DD_<temática>.pdf`. Se envía en streaming
  mientras se generan los PDF; 404 JSON si no hay ninguno.
- `POST /api/asistencias/formularios/exportar-seleccionados-pdf`: body
  `{ ids: string[], jobId?: string }`; mismo ZIP
  (`asistencias_seleccionadas_<fecha>.zip`) con los elegidos no eliminados. 400
  si `ids` está vacío, 404 si ninguno existe.

Los dos ZIP informan el avance por socket (ver Efectos). Si un PDF falla a mitad,
el ZIP se aborta y la descarga queda cortada. Los demás errores de exportación
salen 500, también el de un formulario inexistente.

### `GET /api/public/asistencias/:token`

**Respuesta 200** (filtrada por el esquema de respuesta)

```json
{ "success": true, "data": { "id": "uuid", "token": "…", "tematica": "…", "objetivo": null, "fecha": "2026-10-10T00:00:00.000Z",
  "hora_inicio": "08:00", "hora_finalizacion": "09:30", "duracion_minutos": 90, "tipo_evento": "charla",
  "tipo_evento_otro": null, "lugar_sede": "…", "nombre_instructor": "…", "activo": true, "created_at": "…" } }
```

**Errores**: 404 `Formulario no encontrado` (incluye formularios retirados); 403
`Este formulario ya no está disponible` si está cerrado.

### `GET /api/public/asistencias/:token/verificar`

Query `device_fingerprint` (obligatorio). Lo pide la página del QR al abrirse
para mostrar «ya firmaste» en vez del formulario.

**Respuesta 200**

```json
{ "success": true, "data": { "respondido": true, "nombre": "…", "fecha": "2026-10-11T15:00:00.000Z" } }
```

Si ese dispositivo no ha firmado: `{ "respondido": false, "nombre": null, "fecha": null }`.
Nada más: ni documento, ni teléfono, ni cargo, ni la firma, ni IP, user agent
o huella. Lo arma `confirmacionPublica` (`asistencia-publica.ts`) y, además, el
esquema de respuesta de la ruta declara solo esos tres campos, así que el
serializador descarta cualquier otro. La consulta tampoco escribe la huella ni
el nombre en el log. No mira si el formulario está activo.

**Errores**: 400 sin `device_fingerprint`; 404 token desconocido; 429 al pasar
el límite por IP.

### `POST /api/public/asistencias/:token/responder`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre_completo` | string 1–255 | sí | |
| `numero_documento` | string 1–50 | sí | |
| `cargo` | string 1–255 | sí | |
| `numero_telefono` | string 1–20 | sí | |
| `firma` | string | sí | Imagen en base64 |
| `device_fingerprint` | string | sí | Huella del dispositivo |
| `pertenece_comite` | boolean | no | |
| `nombre_comite` | string ≤ 255 | si `pertenece_comite` es `true` | Se valida, pero no se guarda |

El servidor añade la IP de la conexión (`request.ip`) y el user agent.

**Respuesta 201** — `{ "success": true, "message": "Respuesta enviada exitosamente", "data": {} }`
(`data` vacío por el esquema de respuesta, como en el alta del formulario).

**Errores**

| Código | Cuándo |
|---|---|
| 400 | Falta un campo obligatorio (validación de Fastify) |
| 404 | Token desconocido |
| 409 | Ese dispositivo ya firmó: `Ya has enviado una respuesta para este formulario` |
| 500 | Formulario cerrado (`Este formulario ya no está disponible`), validación de zod, o dos envíos simultáneos que chocan en el índice único |

## Efectos

- **Sockets** (con `io.emit`, a todos los sockets conectados; ver
  [tiempo real](../tiempo-real.md)):
  - `asistencias:formulario:created` — `{ formulario, timestamp }` al crear.
  - `asistencias:formulario:updated` / `asistencias:formulario:disabled` —
    `{ formulario, timestamp }` desde `PUT /:id`, o `{ ids, activo, timestamp }`
    desde `PATCH /formularios/estado`.
  - `asistencias:respuesta:created` —
    `{ respuesta, formularioId, formularioToken, timestamp }` con cada firma,
    también las que llegan por el portal del conductor y Mis capacitaciones.
- **Progreso de los ZIP**, solo a la sala `user-<id>` de quien exporta:
  `asistencias:export:progress` `{ jobId, current, total, currentTematica, percent }`
  y, al terminar, `asistencias:export:done` `{ jobId, total }`. `jobId` es el
  que mandó el cliente o `all-<timestamp>` / `sel-<timestamp>`.
- **Registro de actividad**: las escrituras del equipo dejan fila en
  `registro_actividad` (hook global, ver [actividad](./actividad.md)), con frase
  propia para `PATCH /formularios/estado` y `DELETE /respuestas` («eliminó
  firmas de un formulario de asistencia»). Las rutas `/public` no se registran.
- **Archivos**: Excel con `xlsx`, PDF con pdfkit y ZIP con `archiver`, todo en
  la respuesta; nada se guarda en S3.

## Observaciones

- **La huella puede repetirse entre teléfonos iguales.** FingerprintJS
  (versión libre) puede dar el mismo `visitorId` a dos teléfonos del mismo
  modelo y sistema, sobre todo en iPhone: el segundo recibiría 409 al firmar
  (`@@unique([formulario_id, device_fingerprint])`). Desde oct-2026
  `verificar` solo le mostraría el nombre y la fecha del primero, no sus datos.
- `asistencias:respuesta:created` y `asistencias:formulario:created` se
  difunden a todos los sockets, sin filtro por permiso: llevan los datos
  personales y la firma del asistente, y el `token` del formulario
  (`asistencias.controller.ts`).
- **Un formulario eliminado sigue recibiendo firmas.** `obtenerPorToken` y
  `crearRespuesta` no miran `deleted_at`, y eliminar no cierra el formulario
  (`asistencias.service.ts`). `GET /formularios/:id` también devuelve
  eliminados.
- `DELETE /respuestas` borra en duro (`deleteMany`): las firmas no tienen
  borrado lógico.
- Un rechazo de zod sale 500, no 400 (crear, editar, firmar); el formulario
  cerrado al firmar sale 500 en vez de 403; `PUT` y `DELETE` de un id
  inexistente salen 500.
- `POST /formularios` y `POST /public/…/responder` devuelven `data: {}` por su
  esquema de respuesta (`asistencias.routes.ts`).
- `nombre_comite` se exige cuando `pertenece_comite` es `true`, pero el
  servicio no lo guarda aunque la columna existe.
- `sortBy=respuestas` no ordena por firmas, y un `sortOrder` distinto de
  `asc`/`desc` llega a Prisma y da 500.
