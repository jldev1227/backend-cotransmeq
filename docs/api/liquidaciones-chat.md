# Chat y recordatorios de cierres

`/api/liquidaciones-terceros/:id/chat`, `/api/liquidaciones-terceros/:id/recordatorios`, `/api/recordatorios/pendientes` · código en [`src/modules/liquidaciones-chat/`](../../src/modules/liquidaciones-chat/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Conversación interna del equipo sobre cada [cierre](./liquidaciones-terceros-descuentos.md)
(`liquidacion_chat_mensaje`) y **recordatorios** para liquidaciones futuras de
una placa (`liquidacion_recordatorio`): «descontar X en el cierre de
noviembre», con monto, prioridad y estado. El `:id` de las rutas es el id del
cierre. Ver [liquidaciones de terceros](./liquidaciones-terceros.md) para el
reparto del dominio.

Los textos se guardan **cifrados en reposo** con AES-256-GCM: la clave de cada
cierre se deriva (HKDF-SHA256) de `LIQ_CHAT_SECRET` y del id del cierre, que
también va como dato autenticado. El servidor descifra los mensajes al
listarlos; los recordatorios no se descifran (ver Observaciones). Los mensajes
se borran de forma lógica y solo por su autor. Crear un recordatorio publica
además un mensaje `RECORDATORIO_REF` en el chat del cierre.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros:limited` (`permisoPorMetodo`) |
| `POST`, `PATCH`, `DELETE` | `liquidaciones-terceros:limited`: el chat lo usan todas las áreas del módulo |
| Borrar un mensaje | Además, solo el autor (comprobación en el servicio → 403) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros/:id/chat/mensajes` | `liquidaciones-terceros:limited` | Mensajes del cierre, paginados hacia atrás |
| POST | `/api/liquidaciones-terceros/:id/chat/mensajes` | `liquidaciones-terceros:limited` | Publica un mensaje |
| DELETE | `/api/liquidaciones-terceros/:id/chat/mensajes/:msgId` | `liquidaciones-terceros:limited` (solo el autor) | Borrado lógico de un mensaje propio |
| GET | `/api/liquidaciones-terceros/:id/recordatorios` | `liquidaciones-terceros:limited` | Recordatorios creados desde el cierre |
| POST | `/api/liquidaciones-terceros/:id/recordatorios` | `liquidaciones-terceros:limited` | Crea un recordatorio |
| PATCH | `/api/liquidaciones-terceros/recordatorios/:recordatorioId/estado` | `liquidaciones-terceros:limited` | Cambia el estado de un recordatorio |
| GET | `/api/recordatorios/pendientes` | `liquidaciones-terceros:limited` | Recordatorios PENDIENTE de una placa y periodo |

### `GET /api/liquidaciones-terceros/:id/chat/mensajes`

**Query**: `before` (fecha ISO; trae los anteriores a ella) y `limit` (50 por
defecto, sin tope).

**Respuesta 200** — `{ mensajes: [{ id, liquidacion_tercero_id, usuario_id, usuario_nombre, contenido, nonce, tipo, recordatorio_id, created_at }], hasMore }`,
en orden cronológico, con `contenido` ya descifrado. Si un mensaje no se puede
descifrar, `contenido` trae el texto cifrado tal cual.

### `POST /api/liquidaciones-terceros/:id/chat/mensajes`

**Body** `{ contenido, tipo?, recordatorio_id? }`: `contenido` obligatorio (se
recorta), `tipo` libre (`NOTA` por defecto). **Respuesta 201** — el mensaje con
`contenido` en claro y `usuario`. 400 `Contenido requerido` si llega vacío.

### `DELETE /api/liquidaciones-terceros/:id/chat/mensajes/:msgId`

Marca `deleted_at`. **Respuesta 200** — `{ "ok": true }`. 403
`{ "error": "No autorizado" }` si el mensaje no existe o no es del usuario.

### `GET /api/liquidaciones-terceros/:id/recordatorios` y `POST /api/liquidaciones-terceros/:id/recordatorios`

`GET` devuelve el arreglo de recordatorios vivos cuyo origen es el cierre, del
más reciente al más antiguo, con `creado_por`.

`POST` **Body** `{ placa, mes, anio, descripcion, monto?, prioridad, aplica_en? }`
(sin esquema; `descripcion` obligatoria). Responde **201** con la fila creada,
incluida `descripcion_cifrada` y `descripcion_nonce`. 400
`Descripción requerida`.

### `PATCH /api/liquidaciones-terceros/recordatorios/:recordatorioId/estado`

**Body** `{ estado, liquidacion_aplicada_id? }`. Escribe el estado tal cual y,
si llega, el cierre en el que se aplicó. Responde la fila actualizada.

### `GET /api/recordatorios/pendientes`

**Query** `placa` (igualdad exacta), `mes`, `anio`. Responde los recordatorios
vivos en `PENDIENTE` de esa placa y periodo, con `monto` como número: lo que el
cierre de ese mes tiene que aplicar.

## Efectos

Eventos a la sala `chat:liquidacion-tercero:<id>` (ver [tiempo real](../tiempo-real.md)):

| Evento | Cuándo |
|---|---|
| `chat:message` | Mensaje publicado, también el `RECORDATORIO_REF` |
| `chat:recordatorio:nuevo` | Recordatorio creado (la descripción viaja cifrada) |
| `chat:recordatorio:estado` | Cambio de estado, a la sala del cierre de origen |

La sala se gestiona por socket en `liquidaciones-chat.gateway.ts`
(`chat:join`, `chat:leave`, `chat:presence`), con la identidad sacada del token.
Las rutas `/chat/` están excluidas del registro de actividad.

## Observaciones

- **Clave de cifrado efímera si falta la variable.** `LIQ_CHAT_SECRET` se lee
  de `process.env` (no está en `src/config/env.ts`) y, si no existe, se genera
  una clave aleatoria en cada arranque: lo escrito antes de un reinicio ya no se
  descifra y la API lo devuelve como texto cifrado.
- Los recordatorios salen siempre **cifrados** (`descripcion_cifrada`,
  `descripcion_nonce`) en el `POST`, el listado, `pendientes`, el cambio de
  estado y el evento de socket, y la clave solo la tiene el servidor: por la
  API la descripción solo se lee en el mensaje «Recordatorio creado: …» del
  chat.
- Ninguna ruta comprueba que el cierre exista ni que el recordatorio o el
  mensaje pertenezcan al `:id` de la URL; un cierre inexistente falla por FK
  con 500. Los controladores no tienen `try/catch` (salvo el borrado): los
  errores salen con el formato por defecto de Fastify.
- `PATCH …/estado` no valida el estado ni quién lo cambia.
- `before` con una fecha inválida y `mes`/`anio` no numéricos en `pendientes`
  terminan en 500.
- En `chat:join`, el log final lee `user.name` del payload: si el cliente no
  manda `user` (la identidad ya sale del token), esa línea lanza `TypeError`
  después de unirlo a la sala.
