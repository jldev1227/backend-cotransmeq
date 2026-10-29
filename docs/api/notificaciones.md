# Notificaciones

`/api/notificaciones` · código en [`src/modules/notificaciones/`](../../src/modules/notificaciones/) · sin permiso de módulo: `sesión`

La campana del dashboard y la pantalla «Notificaciones» de la app de gestión:
una fila de `notificacion` por destinatario (`usuario_id`, `tipo`, `titulo`,
`mensaje`, `referencia_id`, `referencia_tipo`, `leida`, `created_at`). Este
módulo solo expone la lectura y el marcado de las propias, y la suscripción a
**Web Push**. Las notificaciones las crean otros módulos con
`NotificacionesService.crear` / `crearMasivas` o con `avisarEquipo`
(`avisos-equipo`), y se entregan con `emitNotificacion` (`src/sockets/index.ts`):
socket `nueva-notificacion` a la sala `user-<id>` y, además, Web Push a los
navegadores donde el destinatario activó los avisos.

La lista, el contador y la entrega en Socket.IO/Web Push se filtran con las áreas
actuales y el permiso personalizado de la ruta vinculada. Solo `full` y
`limited` reciben un aviso; `read` sirve para consultar el módulo, pero no para
recibir actividad sobre él. Las referencias no asociadas a una ruta conocida se
descartan. Los avisos de desprendibles web se restringen además a Administración
y Talento Humano; las notificaciones de firma dirigidas al conductor siguen en
el canal móvil independiente.

Reglas que un integrador necesita saber:

- **Todo actúa sobre el usuario de la sesión**: ninguna ruta recibe destinatario.
- **`tipo`** es el enum `enum_notificacion_tipo`: `GENERAL`,
  `LIQUIDACION_ANULADA`, `LIQUIDACION_PENDIENTE`, `LIQUIDACION_CREADA`,
  `LIQUIDACION_ACTUALIZADA`, `LIQUIDACION_FACTURADA`, `FACTURA_ANULADA`,
  `ACTIVIDAD_PESV_ASIGNADA`, `ACTIVIDAD_PESV_ACTUALIZADA`,
  `ACTIVIDAD_PESV_VENCIDA`, `ACCION_CORRECTIVA_RECORDATORIO`,
  `ACCION_CORRECTIVA_VENCIDA`. La web decide qué abrir con `referencia_tipo` y
  `referencia_id`.
- **Web Push está apagado sin claves VAPID.** Se enciende con `VAPID_PUBLIC_KEY`
  y `VAPID_PRIVATE_KEY` (y `VAPID_SUBJECT`, por defecto
  `mailto:sistemas@transmeralda.com`); la pública se pide por API. Es un intento
  adicional: la fila de `notificacion` ya existe y nada de lo que pase con el push
  la afecta. El servidor no sabe qué pestaña tiene el foco: decidir si se muestra
  el aviso es cosa del service worker.

Huellas de `referencia_tipo` que escribe el backend: `servicio`, `extracto` (FUEC), `preoperacional`,
`preop_malo`, `mant:<estado>:<km>:<fecha>`, `dias_laborados:<fecha>`,
`nomina_desprendible_firmado:<año>:<mes>:<desde>`, `docveh:…`, `doccond:…`,
`solicitud_web`, `incidente`, `incidente_investigacion_pendiente`, `viatico_anticipo`,
`viatico_solicitud`, `viatico_fondo`, `ACCION_CORRECTIVA` y, desde el 11-oct-2026,
`factura:<número>` en `LIQUIDACION_FACTURADA` y `FACTURA_ANULADA` (la web filtra la
pestaña Facturas por número). Las `LIQUIDACION_*` llevan la liquidación de servicios
en `referencia_id` sin huella.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin con `authMiddleware`): dashboard o app `app_usuario` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/notificaciones` | sesión | Lista paginada de mis notificaciones |
| GET | `/api/notificaciones/no-leidas` | sesión | Cuenta mis no leídas |
| PATCH | `/api/notificaciones/marcar-todas` | sesión | Marca todas las mías como leídas |
| PATCH | `/api/notificaciones/:id/leida` | sesión | Marca una mía como leída |
| GET | `/api/notificaciones/web-push/clave` | sesión | Clave pública VAPID (o `null` si Web Push está apagado) |
| POST | `/api/notificaciones/web-push/suscripcion` | sesión | Registra la suscripción push de este navegador |
| POST | `/api/notificaciones/web-push/desuscribir` | sesión | Este navegador deja de recibir avisos |
| POST | `/api/notificaciones/web-push/prueba` | sesión | Me reenvía como aviso mi última notificación |

No hay envoltorio `success`: las respuestas son el objeto plano y los errores,
`{ error }`.

### `GET /api/notificaciones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | número | `1` | Sin validar |
| `limit` | número | `20` | Sin validar ni tope |

**Respuesta 200**

```json
{ "notificaciones": [ { "id": "…", "usuario_id": "…", "tipo": "GENERAL", "titulo": "…", "mensaje": "…",
    "referencia_id": "…", "referencia_tipo": "servicio", "leida": false, "created_at": "…" } ],
  "total": 42, "noLeidas": 3, "totalPages": 3, "page": 1 }
```

De la más reciente a la más antigua.

### `GET /api/notificaciones/no-leidas`

**Respuesta 200** — `{ "count": 3 }`.

### `PATCH /api/notificaciones/marcar-todas` y `PATCH /api/notificaciones/:id/leida`

Sin body. **Respuesta 200** — `{ "ok": true }`. Marcar una que no existe o que es
de otro usuario responde **500** `{ "error": "Notificación no encontrada" }`.
Ninguna de las dos emite nada por socket.

### `GET /api/notificaciones/web-push/clave`

**Respuesta 200** — `{ "clave": "<VAPID_PUBLIC_KEY>" }`, o `{ "clave": null }` si
Web Push está apagado (faltan las claves o son inválidas). El frontend la pasa a
`PushManager.subscribe()`.

### `POST /api/notificaciones/web-push/suscripcion`

**Body** — la suscripción de `PushManager.subscribe()` serializada con `toJSON()`:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `endpoint` | string | sí | `https://…`, hasta 2.000 caracteres |
| `keys.p256dh` | string | sí | Hasta 255 caracteres |
| `keys.auth` | string | sí | Hasta 255 caracteres |

Upsert por `endpoint` en `usuario_web_push` con el user agent: si ese navegador
estaba suscrito para otro usuario, pasa al de la sesión, y se reactiva.

**Respuesta 200** — `{ "ok": true }`.

**Errores**: 503 «Los avisos del navegador no están configurados» (sin claves
VAPID); 400 «Suscripción inválida»; 500.

### `POST /api/notificaciones/web-push/desuscribir`

**Body**: `endpoint` (string). Desactiva esa suscripción si es del usuario de la
sesión (al apagar los avisos o al cerrar sesión). **Respuesta 200** —
`{ "ok": true }`; 400 «Falta el endpoint».

### `POST /api/notificaciones/web-push/prueba`

Sin body. Reenvía como aviso la última notificación visible para el usuario (o
una de cortesía, «Avisos activados», si no tiene ninguna visible) a sus navegadores
activos, con `forzar: true` para que el service worker la muestre aunque el
dashboard esté a la vista. Solo le llega a él.

**Respuesta 200** — `{ "enviados": 1, "fallidos": 0 }`. **Errores**: 503 sin
claves VAPID; 500.

## Efectos

- **Web Push** (`web-push.service.ts`, librería `web-push`): payload
  `{ id, tipo, titulo, mensaje, referencia_id, referencia_tipo, created_at, forzar? }`,
  con el `mensaje` recortado a 400 caracteres (el payload cifrado no puede pasar de
  unos 4 KB), TTL de 24 h y urgencia `normal`. Una suscripción que el servicio de
  push responde con 404 o 410 se desactiva. Lo dispara `emitNotificacion` (haya o
  no socket) cuando otro módulo entrega una notificación.
- Las rutas de este módulo no crean notificaciones ni emiten eventos de socket
  (salvo el push de `prueba`). Ver [tiempo real](../tiempo-real.md) para
  `nueva-notificacion`.
- El push a la app móvil de gestión (Expo) es otro canal: dispositivos en
  `usuario_push_device`, registrados por [app-usuarios](./app-usuarios.md).

## Observaciones

- `PATCH /:id/leida` responde **500**, no 404, cuando la notificación no existe o
  es ajena: el servicio lanza un `Error` genérico y el controlador no lo
  distingue. Un `id` que no es UUID también sale como 500, con el mensaje de
  Prisma.
- `page` y `limit` no se validan: `limit` no tiene tope (se puede pedir el
  historial entero de una vez) y `page=0`, un número negativo o un texto hacen
  fallar la consulta con 500.
- Marcar como leídas no avisa a las demás pestañas o dispositivos del mismo
  usuario: su contador queda desfasado hasta que vuelvan a consultar.
- El `VAPID_SUBJECT` por defecto es el mismo en los dos repos,
  `mailto:sistemas@transmeralda.com`: si la variable no está puesta en
  Cotransmeq, los servicios de push ven como contacto el correo de Transmeralda.
  `web-push.service.ts`.
