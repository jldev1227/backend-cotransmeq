# Servidor MCP y tokens personales

`/api/mcp` y `/api/api-tokens` · código en [`src/modules/mcp/`](../../src/modules/mcp/) · token API personal para el MCP y [sesión](../autenticacion.md) para gestionarlo; las herramientas y sus permisos son los del [asistente](./asistente.md)

Servidor [MCP](https://modelcontextprotocol.io) para conectar Claude (Desktop,
Code, claude.ai) o ChatGPT a la plataforma con la identidad de un usuario. Usa
`@modelcontextprotocol/sdk` con el transporte *Streamable HTTP* **sin estado** y
respuestas JSON: cada `POST` crea un `Server` nuevo, solo con la capacidad
`tools`, y unas `instructions` que presentan la empresa y al usuario (nombre y
áreas) y explican cómo usar las herramientas.

Las herramientas son **las mismas del asistente del chat**
(`src/modules/asistente/herramientas.ts`), filtradas con la misma función
`puedeUsar` para el canal `mcp`: lo que el usuario no puede ver en la pantalla
tampoco se lo da el MCP, y las que escriben piden `full` en su módulo igual que la
ruta REST. Por el canal `mcp` no van las que mueven la pantalla del navegador
(`ir_a`, `guia_interactiva`, `abrir_ticket_servicio`, `abrir_desprendible`) y
van, además, `search` y `fetch`, el par que ChatGPT exige para Deep Research. La
tabla completa con el módulo que exige cada una está en
[asistente](./asistente.md#herramientas).

**Autenticación.** Con un token personal `cmq_…` que el usuario crea desde la app
(`POST /api/api-tokens`): `cmq_` + 32 bytes aleatorios en base64url (47
caracteres). Se muestra una sola vez; en `api_tokens` quedan el hash SHA-256
(`token_hash`, único) y los primeros 10 caracteres (`prefijo`) para reconocerlo.
El MCP **no pasa por `authMiddleware` ni por `sesiones`**: `pareceToken` exige el
prefijo `cmq_` y más de 20 caracteres, `apiTokensService.autenticar` busca el hash
sin `revoked_at` y con el usuario activo, y `cargarUsuarioAsistente` vuelve a leer
áreas y `permisos_rutas` en cada petición, así que un cambio de permisos o
desactivar al usuario aplica de inmediato. Los tokens no vencen; se revocan.
`last_used_at` se actualiza como mucho cada 5 minutos. Máximo 10 activos por
usuario.

El token se pasa de una de dos formas:

- cabecera `Authorization: Bearer cmq_…` contra `https://api-cotransmeq.transmeralda.com/api/mcp`
  (Claude Desktop, Claude Code, ChatGPT con «token de acceso»);
- en la ruta, `https://api-cotransmeq.transmeralda.com/api/mcp/cmq_…`, para los conectores
  que solo piden una URL (claude.ai, ChatGPT en modo desarrollador sin
  autenticación).

## Acceso

| Rutas | Guarda |
|---|---|
| `POST /api/mcp`, `POST /api/mcp/:token` | `token API` (el controlador; ver arriba). Sin límite de intentos |
| `GET`, `PUT`, `PATCH` y `DELETE` sobre `/api/mcp` y `/api/mcp/:token` | `pública`: responden siempre 405 sin mirar el token |
| `GET /api/api-tokens`, `POST /api/api-tokens`, `DELETE /api/api-tokens/:id` | `sesión` (hook `preHandler` del plugin con `authMiddleware`); cada usuario ve y revoca solo los suyos |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/mcp` | token API | Mensaje JSON-RPC de MCP con el token en `Authorization` |
| POST | `/api/mcp/:token` | token API | Lo mismo con el token en la ruta |
| GET | `/api/mcp` | pública | 405 (sin stream del servidor) |
| PUT | `/api/mcp` | pública | 405 |
| PATCH | `/api/mcp` | pública | 405 |
| DELETE | `/api/mcp` | pública | 405 (sin sesiones que cerrar) |
| GET | `/api/mcp/:token` | pública | 405 |
| PUT | `/api/mcp/:token` | pública | 405 |
| PATCH | `/api/mcp/:token` | pública | 405 |
| DELETE | `/api/mcp/:token` | pública | 405 |
| GET | `/api/api-tokens` | sesión | Tokens activos del usuario |
| POST | `/api/api-tokens` | sesión | Crea un token y lo devuelve una única vez |
| DELETE | `/api/api-tokens/:id` | sesión | Revoca un token propio |

### `POST /api/mcp` y `POST /api/mcp/:token`

**Cuerpo**: un mensaje JSON-RPC 2.0 de MCP (o un lote): `initialize`,
`tools/list`, `tools/call`… Lo valida el SDK, que exige `Accept` con
`application/json` y `text/event-stream` (si no, 406) y `Content-Type:
application/json` (si no, 415). Un cuerpo `application/json` mal formado lo
rechaza antes Fastify (400, formato por defecto), sin llegar a mirar el token. La
respuesta es JSON (`enableJsonResponse`), sin SSE y sin `Mcp-Session-Id`.

- `initialize`: `serverInfo` `{ name: "cotransmeq", version: "1.0.0" }` y las
  `instructions`.
- `tools/list`: las herramientas que el usuario puede usar por este canal, cada una
  con `name`, `description`, `inputSchema` (el JSON Schema de la herramienta) y
  `annotations: { title: <etiqueta>, readOnlyHint: !escribe, destructiveHint: false, idempotentHint: !escribe, openWorldHint: false }`.
- `tools/call`: `{ "content": [{ "type": "text", "text": "<JSON>" }] }`. Antes de
  serializar se recortan las listas (como en el chat) y todo valor que empiece
  por `/dashboard` se vuelve absoluto con la URL de la app (`EMAIL_FRONTEND_URL`,
  o la primera `https://` de `FRONTEND_URL`); el texto se corta en 40 000
  caracteres o en el tope de la herramienta si es mayor. `search` y `fetch`
  devuelven además `structuredContent`, que es lo que lee ChatGPT. Una
  herramienta que el usuario no puede usar responde `isError: true` con
  «Herramienta no disponible para este usuario.»; una que falla, `isError: true`
  con «No se pudo consultar esta información.».

`search({ query })` → `{ "results": [{ "id": "tipo:uuid", "title", "url" }] }`, hasta 6
por tipo en conductores, vehículos, clientes, servicios, liquidaciones, planillas
de recargos, acciones correctivas, SARLAFT, asistencias y envíos de formularios,
solo de los módulos que el usuario ve. `fetch({ id })` →
`{ "id", "title", "text", "url", "metadata": { "tipo" } }`: delega en la
herramienta de detalle del tipo, con su permiso.

**Errores HTTP**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 401 | Token ausente, sin prefijo `cmq_` o de 20 caracteres o menos, inexistente, revocado, o usuario inactivo | `{ "jsonrpc": "2.0", "error": { "code": -32001, "message": "Token inválido o revocado" }, "id": null }` |
| 400, 406, 415 | Validaciones del transporte del SDK (mensaje JSON-RPC inválido, `Accept` o `Content-Type` incorrectos) | error JSON-RPC del SDK (`code` `-32700`, `-32600` o `-32000`) |
| 500 | Excepción en el transporte | `{ "jsonrpc": "2.0", "error": { "code": -32603, "message": "Error interno" }, "id": null }` |

La respuesta la escribe el SDK sobre los objetos crudos de Node (`reply.hijack()`),
copiando antes las cabeceras de CORS que Fastify había acumulado.

### `GET`, `PUT`, `PATCH` y `DELETE` sobre `/api/mcp` y `/api/mcp/:token`

`GET /api/mcp`, `PUT /api/mcp`, `PATCH /api/mcp`, `DELETE /api/mcp`,
`GET /api/mcp/:token`, `PUT /api/mcp/:token`, `PATCH /api/mcp/:token` y
`DELETE /api/mcp/:token` responden siempre **405** con cabecera `Allow: POST` y
`{ "jsonrpc": "2.0", "error": { "code": -32000, "message": "Método no permitido" }, "id": null }`:
el servidor no tiene sesiones ni stream propio.

### `GET /api/api-tokens`

**Respuesta 200**: arreglo plano de los tokens activos del usuario, del más nuevo
al más viejo. Va en camelCase, a diferencia del resto de la API:

```json
[{ "id": "uuid", "nombre": "Claude Desktop", "prefijo": "cmq_Ab12Cd", "createdAt": "…", "lastUsedAt": "…" }]
```

### `POST /api/api-tokens`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string | sí | 1 a 60 caracteres tras `trim`; para reconocer la conexión |

**Respuesta 200** (no 201): la única vez que viaja el token completo.

```json
{ "id": "uuid", "nombre": "Claude Desktop", "prefijo": "cmq_Ab12Cd", "createdAt": "…", "lastUsedAt": null, "token": "cmq_…" }
```

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Nombre vacío o de más de 60 caracteres | `{ "error": "Nombre inválido", "message": "Ponle un nombre a la conexión" }` |
| 400 | Ya tiene 10 tokens activos | `{ "error": "Ya tienes 10 conexiones activas. Revoca alguna antes de crear otra.", "message": "<lo mismo>" }` |

### `DELETE /api/api-tokens/:id`

Pone `revoked_at` (la fila no se borra: queda para auditoría). **Respuesta 200**:
`{ "ok": true }`.

**Errores**: 400 `{ "error": "Id inválido" }` si `id` no tiene forma de UUID; 404
`{ "error": "Conexión no encontrada", "message": "Conexión no encontrada" }` si no
existe, es de otro usuario o ya estaba revocado.

## Efectos

- `api_tokens`: alta, revocación y `last_used_at`.
- Los de las herramientas que escriben (servicios, planillas de recargos,
  recorridos, acciones correctivas, liquidaciones en borrador), con sus eventos de
  socket y notificaciones: ver [asistente](./asistente.md#herramientas).
- Nada queda en `registro_actividad`: el hook excluye `/api/mcp` y
  `/api/api-tokens` (ver [actividad](./actividad.md)).

## Observaciones

- **El token en la ruta queda en los logs.** Fastify registra la URL de cada
  petición (`incoming request`, nivel `info`) y la app no desactiva ese log
  (`disableRequestLogging`), así que la forma `/api/mcp/cmq_…` deja el token
  completo en el log del servidor. Como los tokens no vencen, quien lea el log
  tiene acceso hasta que se revoque.
- **Los tokens sobreviven al cierre de sesiones.** Cerrar sesiones desde
  administración o restablecer la contraseña (`POST /api/auth/recuperacion/aplicar`
  cierra todas las sesiones para echar a quien tomó la cuenta) no toca
  `api_tokens`: alguien que tuvo una sesión pudo crear un token permanente con
  todos los permisos del usuario. Solo lo cortan revocarlo o desactivar al usuario.
- **Sin límite de peticiones** en `/api/mcp`, y algunas herramientas devuelven
  hasta 500 filas por llamada.
- **Las herramientas que escriben están disponibles por MCP** (ninguna declara
  `canales`), con `destructiveHint: false`. La única barrera del servidor es que el
  cliente mande `confirmado: true`; pedir la confirmación al usuario queda en
  manos de Claude o ChatGPT. El comentario de `src/modules/asistente/acciones.ts`
  que dice que el MCP es de solo lectura está desactualizado.
- `search` y `fetch` enlazan los vehículos a `/dashboard/flota/<id>`, una ruta que
  no existe en el frontend (solo `/dashboard/flota`); `buscar_vehiculos` usa
  `/dashboard/flota?placa=…` (`src/modules/asistente/buscador-global.ts`).

## Diferencias con Transmeralda

- Prefijo de los tokens: `cmq_` aquí, `tme_` en Transmeralda (`api-tokens.service.ts`).
  Un token de una empresa se rechaza en la otra con 401 sin consultar la base.
- Nombre del servidor (`serverInfo.name`): `cotransmeq` aquí, `transmeralda` allí;
  las `instructions` nombran a cada empresa.
