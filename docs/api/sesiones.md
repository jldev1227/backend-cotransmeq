# Sesiones

`/api/sesiones` · código en [`src/modules/sesiones/`](../../src/modules/sesiones/) · acceso de administración (`requireAdmin`, `full` en el módulo [`sesiones`](../permisos.md#catálogo-de-módulos)); `mis-sesiones` solo pide sesión

Cada fila de `sesiones` es un token emitido: el del login del panel
(`POST /api/auth/login`, ver [auth](./auth.md#post-apiauthlogin)) o el del canje del
enlace de la app de administrativos (`app-usuarios`, con `user_agent` que empieza
por `App móvil`, `remember_me: true` y `token_expiry` igual al vencimiento del
enlace). La fila es lo que mantiene vivo el token: `authMiddleware` exige una
sesión con `is_active = true` y `token_expiry` futuro, buscada por `token_hash`
(SHA-256 en hexadecimal del JWT), con una caché de 30 s
(`src/middlewares/cache-sesiones.ts`). Ver [middlewares](../middlewares.md).

Cerrar una sesión es marcarla (`is_active: false`, `closed_at`), nunca borrarla, y
vaciar la caché entera de ese proceso para que el token deje de entrar al
instante. En esta API «activa» significa `is_active = true`, no «vigente»: nada
cierra las sesiones vencidas (ver Observaciones), así que el middleware las
rechaza por `token_expiry` pero los listados las siguen mostrando como activas.

## Acceso

| Rutas | Guarda |
|---|---|
| Todas | `sesión` (hook `preHandler` del plugin con `authMiddleware`) |
| `GET /api/sesiones`, `GET /api/sesiones/activas`, `DELETE /api/sesiones/:id`, `DELETE /api/sesiones/usuario/:usuarioId` | además `admin` (`requireAdmin` en la ruta): nivel `full` en el módulo `sesiones`; con lista blanca, `read` o `limited` no bastan |
| `GET /api/sesiones/mis-sesiones` | solo `sesión`; devuelve las del propio usuario |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/sesiones` | admin | Sesiones de todos, con filtros |
| GET | `/api/sesiones/activas` | admin | Todas las sesiones con `is_active = true` |
| DELETE | `/api/sesiones/:id` | admin | Cierra una sesión y avisa al usuario por socket |
| DELETE | `/api/sesiones/usuario/:usuarioId` | admin | Cierra todas las sesiones de un usuario |
| GET | `/api/sesiones/mis-sesiones` | sesión | Últimas 50 sesiones del usuario autenticado |

### Forma de una sesión

Las tres lecturas devuelven la fila completa (sin `select`) más la duración
calculada hasta `closed_at`, o hasta ahora si sigue abierta:

```json
{
  "id": "uuid", "usuario_id": "uuid", "ip": "…", "user_agent": "…",
  "token_hash": "<64 hex>", "remember_me": false, "token_expiry": "…",
  "last_activity": "…", "is_active": true, "created_at": "…", "closed_at": null,
  "duracion_minutos": 192, "duracion_texto": "3h 12m",
  "usuario": { "id": "uuid", "nombre": "…", "correo": "…", "role": "usuario", "area": ["hseq"], "cargo": "…" }
}
```

`duracion_texto` es `45m`, `3h 12m` o `2d 4h`. `usuario` solo va en los dos
listados de administración.

### `GET /api/sesiones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `activas` | `'true'` \| `'false'` \| ausente | ausente | Filtra por `is_active`; cualquier otro valor no filtra |
| `usuarioId` | UUID | ausente | Solo las de ese usuario |
| `limit` | entero | 100 | Sin tope máximo; un valor no numérico vuelve a 100 |

**Respuesta 200**: arreglo plano ordenado por `created_at` descendente.

### `GET /api/sesiones/activas`

Arreglo plano de todas las sesiones con `is_active = true`, sin límite, ordenadas
por `last_activity` descendente.

### `DELETE /api/sesiones/:id`

Busca la sesión, la cierra por su `token_hash` y emite `sesion-cerrada` con
`{ "motivo": "Un administrador cerró esta sesión." }` al room `user-<usuario_id>`.

**Respuesta 200**: `{ "message": "Sesión cerrada" }`.

**Errores**: 404 `{ "error": "Sesión no encontrada" }`; un `id` que no es UUID
hace fallar a Prisma con 500 (formato de Fastify).

### `DELETE /api/sesiones/usuario/:usuarioId`

Cierra todas las sesiones activas del usuario y emite `sesion-cerrada` con
`{ "motivo": "Un administrador cerró todas tus sesiones." }` a su room.

**Respuesta 200**: `{ "message": "N sesiones cerradas" }` (con `N = 0` si no tenía
ninguna; no hay 404).

### `GET /api/sesiones/mis-sesiones`

Las últimas 50 sesiones del usuario del token (abiertas y cerradas), por
`created_at` descendente, sin el objeto `usuario`.

## Efectos

- Socket `sesion-cerrada` al room privado `user-<id>` (ver
  [tiempo real](../tiempo-real.md)); el panel muestra el motivo y cierra la sesión
  local a los 5 s.
- Cerrar vacía la caché de sesiones del middleware (`olvidarSesionesEnCache`).
  El token deja de dar identidad a un socket nuevo, porque el handshake exige
  la misma sesión abierta, pero un socket que ya estaba conectado no se corta.
- `registro_actividad` (módulo `sesiones`): `DELETE /api/sesiones/:id` queda como
  «eliminó la sesión #xxxxxxxx» y el cierre masivo como «cerró todas las sesiones
  de un usuario» (ver [actividad](./actividad.md)).
- Otros que cierran sesiones: `PUT /api/usuarios/:id` y
  `PATCH /api/usuarios/:id/activo` al desactivar ([usuarios](./usuarios.md)) y
  `POST /api/auth/recuperacion/aplicar` ([auth](./auth.md)).

## Observaciones

- **Las sesiones vencidas nunca se cierran.** `SesionesService.cerrarExpiradas()`
  existe pero nadie la llama (ni un cron): `GET /api/sesiones/activas` y
  `?activas=true` incluyen tokens ya vencidos, con una duración que sigue
  creciendo, y el listado de `activas` no tiene límite (`sesiones.service.ts`).
- **Las respuestas incluyen `token_hash` e `ip`.** El hash no sirve para
  autenticarse, pero nadie lo necesita en la pantalla; las herramientas del
  [asistente](./asistente.md) evitan a propósito devolver hashes de sesión e IP.
- **`sesion-cerrada` va al room del usuario, no al de la sesión**: al cerrar una
  sola, la reciben todas sus pestañas y dispositivos con el panel abierto, y el
  frontend (`src/routes/dashboard/+layout.svelte`) hace logout en todas a los
  5 s, aunque las demás sesiones sigan vigentes en el servidor
  (`sesiones.controller.ts`).
- Una fila sin `token_hash` (la columna admite `null`) no se cierra con
  `DELETE /api/sesiones/:id`, pero la ruta responde «Sesión cerrada» y emite el
  evento igual.
- Cerrar sesiones no revoca los tokens personales del MCP (`api_tokens`), que no
  dependen de esta tabla (ver [mcp](./mcp.md)).
