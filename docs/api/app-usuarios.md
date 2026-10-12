# App móvil de administrativos

`/api/app-usuarios` · código en [`src/modules/app-usuarios/`](../../src/modules/app-usuarios/) · sin permiso de módulo: [sesión del equipo](../autenticacion.md#app-móvil-de-administrativos)

Acceso de las personas del equipo a la app móvil de gestión (shell `/gestion`).
Desde «Mi perfil» del dashboard cada usuario genera un **enlace de 30 días** con
un código opaco (32 bytes aleatorios en base64url; en `usuario_enlace_app` solo
se guarda su SHA-256). La app canjea el código por un JWT con la misma forma que
el del login del dashboard más `tipo: 'app_usuario'` y el id del enlace
(`enlace`), así que usa los endpoints de siempre con los mismos permisos de su
dueño: crear un servicio desde el teléfono sigue la misma secuencia que desde la
web. Aquí viven también los dispositivos push (Expo) de esa app.

Reglas que un integrador necesita saber:

- **Un enlace vigente por usuario.** Generar uno revoca el anterior; el código
  solo se devuelve en esa respuesta. Cualquier usuario activo puede generarlo
  (antes se limitaba por área); lo que ve dentro lo deciden sus permisos.
- **El enlace se puede canjear varias veces** mientras esté vigente: la app
  reintenta cuando la red falla y un código de un solo uso dejaría fuera a quien
  perdió la respuesta del primer canje. Cada canje crea una fila en `sesiones`
  (aparece en «Sesiones» del dashboard y se puede cerrar desde allí) y suma
  `usos`.
- **La sesión de la app vence con el enlace** y se corta al revocarlo:
  `authMiddleware` acepta tokens `app_usuario` y además consulta
  `sesionAppVigente` (enlace sin revocar ni vencer y sesión activa). Esa consulta
  tiene una caché de 30 s que se vacía al generar o revocar un enlace.
- Una sesión de la app no puede emitir enlaces: así no puede renovarse sola.

## Acceso

| Rutas | Guarda |
|---|---|
| `GET`, `POST` y `DELETE /enlace` | `sesión` del **dashboard**: `authMiddleware` dentro del `preHandler` `soloDashboard`, que además rechaza un token `tipo: 'app_usuario'` con 403 «El enlace se genera desde la web.» |
| `POST /canjear` | `pública · token`: el código del enlace en el body, comparado por su SHA-256 con `usuario_enlace_app.codigo_hash`; `· límite 20/15 min por IP` |
| `POST` y `DELETE /dispositivos-push` | `sesión` (dashboard o app; `authMiddleware` en `preHandler`) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/app-usuarios/enlace` | sesión del dashboard | Resumen del enlace vigente del usuario |
| POST | `/api/app-usuarios/enlace` | sesión del dashboard | Revoca el anterior y genera un enlace nuevo |
| DELETE | `/api/app-usuarios/enlace` | sesión del dashboard | Revoca el enlace vigente (corta las sesiones de la app) |
| POST | `/api/app-usuarios/canjear` | pública · token · límite 20/15 min por IP | Cambia el código del enlace por una sesión de la app |
| POST | `/api/app-usuarios/dispositivos-push` | sesión | Registra el token Expo del teléfono para el usuario |
| DELETE | `/api/app-usuarios/dispositivos-push` | sesión | Desactiva el token Expo del teléfono |

Los errores propios son `{ success: false, message, code? }`; los de
`authMiddleware`, `{ error, message? }`.

### `GET /api/app-usuarios/enlace`

**Respuesta 200**

```json
{ "success": true, "data": {
  "habilitado": true,
  "enlace": { "id": "…", "creado": "…", "vence": "…", "ultimo_uso": null, "usos": 0 }
} }
```

`enlace` es `null` si no hay uno sin revocar ni vencer. `habilitado` es siempre
`true` (se conserva por compatibilidad). No incluye el código ni la URL.

### `POST /api/app-usuarios/enlace`

Sin body. Revoca los enlaces vivos del usuario y emite uno nuevo de 30 días.

**Respuesta 201** — el resumen de arriba más `url`:
`<origen>/public/abrir-app?tipo=usuario&codigo=<código>`, la página puente https
del front (Gmail y WhatsApp anulan los esquemas propios). `<origen>` es
`EMAIL_FRONTEND_URL` o el primer `FRONTEND_URL`. Es la única vez que sale el código.

**Errores**: 403 `USUARIO_INACTIVO` (usuario inexistente o inactivo); 403 si la
sesión es de la app; 500.

### `DELETE /api/app-usuarios/enlace`

Revoca los enlaces vivos del usuario. **Respuesta 200** —
`{ success, data: { revocados: <n> } }`. Las sesiones de la app que salieron de
ellos dejan de pasar `authMiddleware` en la siguiente petición (401 «Sesión
revocada»).

### `POST /api/app-usuarios/canjear`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `codigo` | string | sí | 20 a 200 caracteres; el `codigo` de la URL del enlace |

Revalida al usuario (pudo quedar inactivo desde que generó el enlace), firma el
JWT con vencimiento igual al del enlace, suma `usos` y `ultimo_uso_at`, y crea la
fila de `sesiones` (`remember_me`, user agent `App móvil · <user agent>`, IP de
`X-Forwarded-For` o la de la conexión).

**Respuesta 200**

```json
{ "success": true, "data": {
  "token": "<JWT>", "expires_at": "…",
  "usuario": { "id": "…", "nombre": "…", "correo": "…", "role": "…", "area": ["operaciones"], "cargo": "…",
    "modulos_accesibles": { "servicios": "full", "…": "…" } }
} }
```

Payload del JWT: `{ sub, correo, role, nombre, area, permisos, tipo: 'app_usuario', enlace }`.
`modulos_accesibles` sale de `getAccessibleModules` con su rol, áreas y lista
blanca `permisos_rutas` ([permisos](../permisos.md)).

**Errores**

| Código | `code` | Cuándo |
|---|---|---|
| 400 | `ENLACE_INVALIDO` | Body sin `codigo` o fuera de longitud («Enlace incompleto.») |
| 401 | `ENLACE_INVALIDO` | Código desconocido, enlace revocado o vencido |
| 403 | `USUARIO_INACTIVO` | El usuario ya no existe o está inactivo |
| 429 | — | Tope de intentos por IP |
| 500 | — | Otro fallo |

### `POST /api/app-usuarios/dispositivos-push` y `DELETE /api/app-usuarios/dispositivos-push`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `expo_push_token` | string | sí | `ExpoPushToken[…]` o `ExponentPushToken[…]` |
| `plataforma` | `'ios'` \| `'android'` | sí (solo `POST`) | |

`POST` hace upsert por `expo_push_token` en `usuario_push_device`
(`usuario-push.service.ts`): si el teléfono estaba registrado a otro usuario,
pasa al de la sesión, y se reactiva. Inválido → 400 «Token de push no válido».
`DELETE` desactiva el token solo si es del usuario de la sesión; sin
`expo_push_token` → 400 «Falta el token». Los dos responden `{ success: true }`.

## Efectos

- Filas en `usuario_enlace_app` (generar, revocar, `usos` y `ultimo_uso_at`) y en
  `sesiones` por cada canje.
- No se envía correo: la URL del enlace se entrega en la respuesta de
  `POST /enlace` para que el usuario la abra o la comparta.
- Push: `enviarPushUsuarios` (`src/modules/usuario-push/usuario-push.service.ts`,
  módulo sin rutas propias) manda a Expo a los dispositivos activos registrados
  aquí; hoy lo usa [liquidaciones-servicios](./liquidaciones-servicios.md). Un
  token que Expo declara `DeviceNotRegistered` se desactiva. El aviso de verdad es
  la fila de `notificacion` ([notificaciones](./notificaciones.md)); el push es un
  intento adicional que nunca lanza.

## Observaciones

- El comentario sobre `POST /canjear` en `app-usuarios.routes.ts` dice «Sin límite
  de intentos a propósito», pero la ruta sí pasa por `preHandlerLimite`
  (20 intentos por IP cada 15 minutos).
- Revocar el enlace no cierra las filas de `sesiones` que salieron de él: siguen
  apareciendo como activas en «Sesiones» aunque `authMiddleware` ya las rechace.
- La IP que se guarda en `sesiones` sale de `X-Forwarded-For` y no de
  `ipCliente` (`CF-Connecting-IP`), que es la que usa el resto del backend detrás
  de Cloudflare.
- `DELETE /dispositivos-push` no tiene `try/catch`: un fallo de la base sale con el
  formato por defecto de Fastify.
