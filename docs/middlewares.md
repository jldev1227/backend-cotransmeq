# Middlewares y ciclo de una petición

Qué corre antes y después de cada handler, en qué orden, y cómo proteger una
ruta nueva. Las credenciales que verifican las guardas están en
[autenticacion.md](./autenticacion.md); el mapa de áreas y módulos, en
[permisos.md](./permisos.md).

## Orden de ejecución

Fastify ejecuta los hooks por fases. Los globales se registran en
`src/app.ts`, en este orden, y afectan a todas las rutas; los de cada plugin de
módulo solo a las rutas de ese plugin (encapsulación de Fastify).

```
petición
  │
  ├─ onRequest   (global)  request.prisma = prisma
  ├─ onRequest   (plugin)  autenticación: authMiddleware / portalAuthMiddleware / hook con rutas públicas
  ├─ (parseo del body, multipart hasta 200 MB)
  ├─ preValidation         esquema JSON de Fastify, si la ruta lo declara → 400
  ├─ preHandler  (plugin)  permisos: permisoPorMetodo / requirePermission
  ├─ preHandler  (ruta)    guardas propias: requirePermission, requireAdmin, requireBonosPlanilla,
  │                        requireRecorridosEdicion, preHandlerLimite…
  ├─ handler (controller → service → Prisma)
  ├─ preSerialization (global)  sinCredenciales: quita todo campo `password` de la respuesta
  ├─ onSend      (global)  Sentry: reporta respuestas 5xx armadas a mano
  ├─ onSend      (global)  registro de actividad: escrituras exitosas → registro_actividad
  └─ onError     (global)  Sentry: errores lanzados con estado ≥ 500
```

Además, `app.ts` instala estos plugins y hooks globales:

| Plugin o hook | Qué hace |
|---|---|
| Sentry (`src/lib/sentry.ts`) | Solo si hay `SENTRY_DSN`. Se instala antes que cualquier ruta porque sus hooks solo alcanzan lo registrado después. No envía cuerpos, cabeceras, cookies ni query, y recorta los mensajes a su primera línea |
| `preSerialization` con `sinCredenciales` (`src/lib/sin-credenciales.ts`) | Quita cualquier campo `password` (el hash de usuarios y conductores), a cualquier profundidad, de toda respuesta que serializa Fastify. Ver [Después del handler](#después-del-handler) |
| `@fastify/helmet` | Cabeceras de seguridad por defecto |
| `@fastify/multipart` | Subidas `multipart/form-data`, hasta 200 MB por archivo (los ZIP de certificados) |
| `@fastify/static` | Sirve `src/assets/` (`dist/assets/` en producción) en `/assets/*`: logos de los PDF y correos |
| `@fastify/cors` | Orígenes permitidos: una lista fija en `app.ts` más los de `FRONTEND_URL` (separados por coma), con `credentials: true`. Un origen fuera de la lista falla con «Not allowed by CORS» |
| `@fastify/swagger` | Registrado con opciones de una versión anterior; **no sirve ninguna ruta** (`/docs` no existe, aunque el log de arranque lo anuncie). La referencia de la API está en [api/](./api/README.md) |

Y `GET /` responde `{ "status": "ok" }`: es la comprobación de salud.

### Por qué la autenticación va en `onRequest` y los permisos en `preHandler`

`onRequest` corre antes de leer el cuerpo: una subida de 200 MB sin token se
rechaza sin recibirla. Los permisos van en `preHandler` porque dependen de
`request.user`, que deja la autenticación, y porque algunas guardas necesitan
la ruta ya resuelta (`request.routeOptions.url`).

## Guardas

| Guarda | Archivo | Uso típico | Rechaza con |
|---|---|---|---|
| `authMiddleware` | `src/middlewares/auth.middleware.ts` | `app.addHook('onRequest', authMiddleware)` en el plugin | 401 |
| `requirePermission(módulo, nivel)` | `src/middlewares/permissions.middleware.ts` | `preHandler` de una ruta o del plugin | 401 sin usuario, 404 cuando deniega la lista blanca individual, 403 cuando deniegan las áreas |
| `permisoPorMetodo(módulo, { lectura, escritura }, { excepto })` | idem | `app.addHook('preHandler', …)` en el plugin | como `requirePermission` |
| `requireAlgunPermiso([m, n], …)` | idem | ruta que sirve a dos pantallas de módulos distintos | como `requirePermission` |
| `requireAdmin` | idem | gestión de usuarios, sesiones e invitaciones | 403 «Sin permisos para esta acción» |
| `requireBonosPlanilla` | `src/middlewares/bonos.middleware.ts` | marcar bonos en recorridos | 403 |
| `requireRecorridosEdicion` | `src/modules/recorridos-canvas/recorridos.middleware.ts` | escrituras del canvas de recorridos | 403 |
| `portalAuthMiddleware` | `conductor-portal.routes.ts`, `formularios-portal.routes.ts` (copias privadas) | rutas del portal del conductor | 401, 403 para un token de impresión fuera de su alcance |
| `conductorAuthMiddleware` | `dias-laborados.routes.ts` | reporte de días del conductor | 401 |
| `preHandlerLimite(límites, clave?)` | `src/utils/limitador.ts` | rutas públicas y login | 429 con `Retry-After` |

### `authMiddleware`

Verifica el JWT, que el `tipo` sea del equipo (sin `tipo` o `app_usuario`) y que
la sesión siga abierta, con una caché de 30 s. Deja en `request.user` el
payload del token con `id`, `sub`, `role`, `area`, `permisos`, `nombre` y
`correo` **leídos de la base**. El detalle está en
[autenticacion.md](./autenticacion.md#cada-petición).

### `requirePermission(módulo, nivel = 'read')`

1. Sin `request.user` → 401 (en cualquier modo).
2. Carga la lista blanca del usuario (`permisos_rutas`, caché de 30 s) y la deja
   en `request.permisosRutas`.
3. Resuelve el acceso con `checkAccess` (ver [permisos.md](./permisos.md)).
4. Sin acceso al módulo → 404 si la decisión viene de `permisos_rutas`; si viene de las áreas, 403
   `{ error: 'Sin permisos', message: 'No tienes acceso al módulo "X"…' }`.
5. Nivel por debajo del pedido (`limited` < `read` < `full`) → 404 con lista blanca individual, 403 por áreas
   `{ error: 'Nivel de acceso insuficiente', message: … }`.
6. Si pasa, deja el nivel en `request.accessLevel` para que el controlador
   recorte lo que haga falta (p. ej. `limited` que solo registra facturas).

Con `PERMISSIONS_MODE=warn`, los rechazos de los pasos 4 y 5 **por área** no
cortan la petición: se registran en consola como `[permisos:warn]` y pasan. Los
rechazos que vienen de una lista blanca `permisos_rutas` se aplican siempre,
porque son un recorte que un administrador acaba de escribir para esa persona.
El default es `enforce`.

### `permisoPorMetodo(módulo, niveles, opciones)`

Guarda de un plugin entero: `GET` y `HEAD` piden el nivel de lectura (`read`
por defecto) y el resto el de escritura (`full` por defecto). Se pone a nivel
de plugin para que una ruta nueva del archivo **nazca protegida**: así quedaron
los huecos de octubre de 2026, cuando nómina, primas, facturación y
liquidaciones solo pedían sesión.

`excepto(patron, metodo)` deja fuera rutas concretas del plugin. Recibe la ruta
**como está escrita en el archivo**, sin el prefijo `/api` (la guarda lo quita
con `this.prefix`), y el método, porque hay rutas públicas y privadas con el
mismo patrón (`POST /inducciones` es el registro público de visitantes; `GET
/inducciones`, el listado privado).

```ts
app.addHook('onRequest', authMiddleware)
app.addHook('preHandler', permisoPorMetodo('liquidaciones-terceros', { lectura: 'limited', escritura: 'limited' }))
```

### `requireAlgunPermiso`

Pasa si el usuario tiene al menos uno de los pares `[módulo, nivel]`. Existe
para rutas que usan pantallas de dos módulos: el PDF del canvas se exporta
desde recorridos y desde cierres de terceros, y pedir solo uno rompía la otra
pantalla. Si no tiene ninguno, responde como la primera guarda de la lista.

### `requireAdmin`

Exige nivel **`full`** en `sesiones` y que el usuario pertenezca al área
Administración. `role` es un dato heredado y nunca sustituye esa comprobación.
Protege toda la gestión de usuarios (`/api/usuarios/*`), las sesiones y las
invitaciones: quien pasa puede cambiar áreas y permisos por ruta de cualquiera,
también los suyos. El módulo `usuarios` del mapa no decide este acceso y
`PERMISSIONS_MODE` no altera la guarda: siempre rechaza si no cumple ambas
condiciones.

### `requireBonosPlanilla`

Comprueba el permiso **individual** `bonos-planilla` en `users.permisos`, que
otorga un administrador desde Usuarios y es independiente del área. Solo
protege escrituras: ver los bonos ya otorgados no lo pide.

### `requireRecorridosEdicion`

`recorridos:full` siempre, con la misma comprobación que usa el socket
(`RecorridosPatchService.puedeEditar`): si la API REST y `sheet:patch` tuvieran
reglas distintas, bloquear una no serviría de nada.

### Guardas del portal del conductor

Verifican el JWT del magic link (`tipo: 'conductor_portal'`) o un token de
impresión acotado a una sola ruta, y dejan al conductor en
`request.conductorPortal`. El del magic link tiene que seguir registrado en
`conductor_token`, sin vencer y con el conductor sin borrar
(`tokenPortalRegistrado`, con caché de 30 s); si no, 401. Ver
[autenticacion.md](./autenticacion.md#portal-del-conductor).

### Límites de intentos

`preHandlerLimite({ porIp, porClave }, clave?)` cuenta el intento por IP y, si se
da `clave` (cédula, correo), también por esa clave. Los presets y los topes de
cada ruta están en [autenticacion.md](./autenticacion.md#límites-de-intentos).

## Lo que las guardas dejan en el request

| Propiedad | La pone | Contenido |
|---|---|---|
| `request.prisma` | hook global | El cliente de Prisma (preferir importar `prisma` de `src/config/prisma`) |
| `request.user` | `authMiddleware` | Payload del JWT + `id`, `sub`, `role`, `area` (arreglo), `permisos`, `nombre`, `correo` de la base. Con `app_usuario`, además `tipo` y `enlace` |
| `request.accessLevel` | `requirePermission` | `'full' \| 'read' \| 'limited'` |
| `request.permisosRutas` | `requirePermission` | Lista blanca normalizada o `null` |
| `request.conductorPortal` | guardas del portal | `{ id, cedula, nombre }` del conductor |
| `request.conductorDiasLaborados` | `conductorAuthMiddleware` | `{ id, cedula, nombre }` |

## Después del handler

**Sin credenciales** ([sin-credenciales.ts](../src/lib/sin-credenciales.ts)).
Un `preSerialization` global pasa cada respuesta por `sinCredenciales`, que
borra todo campo `password` a cualquier profundidad (solo recorre objetos
planos y arreglos; `Date`, `Decimal` o `Buffer` quedan como están). Es una red
de seguridad para los `include` que traen filas enteras de conductores o
usuarios, no el control principal: cada consulta sigue debiendo pedir solo lo
que necesita. Fastify no llama a este hook cuando la respuesta ya es un
string, un `Buffer` o un stream, ni cuando la ruta escribe en `reply.raw`. Es
un callback y no `async` a propósito: un hook asíncrono difiere la
serialización un turno, y una ruta que escribe la respuesta por su cuenta en
ese hueco choca con «headers already sent». Los emisores de socket de
servicios y recargos aplican la misma función a sus payloads.

**Registro de actividad** (`src/modules/actividad/registro-actividad.service.ts`).
Un `onSend` global apunta en `registro_actividad` cada `POST`, `PUT`, `PATCH` y
`DELETE` que termina con estado menor de 400 y tiene usuario del equipo:
quién, módulo, acción, ruta, recurso y una descripción legible. Se excluyen
autenticación, rutas públicas, portal, MCP, asistente, notificaciones, PDF y
algunas más (`EXCLUIR_PREFIJOS`). Se escribe sin `await`: si falla, solo deja un
aviso en el log y la respuesta sale igual. Es lo que lee el módulo
[actividad](./api/actividad.md).

**Sentry.** Reporta los errores lanzados con estado ≥ 500 y también las
respuestas 5xx que los controladores arman a mano (la mayoría capturan su
propio error y responden `{ error }`), agrupadas por ruta y mensaje.

## Formato de los errores

No hay un manejador de errores propio: `src/middlewares/error.middleware.ts`
existe pero **no está registrado**. En la práctica conviven tres formatos:

| Origen | Cuerpo |
|---|---|
| Guardas del equipo | `{ error, message? }` con 401 o 403 |
| Guardas del portal | `{ success: false, message }` (formularios: `{ success: false, error: { code, message } }`) |
| Límite de intentos | `{ success: false, error: 'Demasiados intentos', message, reintentar_en }` con 429 |
| Esquema JSON de Fastify o error no capturado | Formato por defecto de Fastify: `{ statusCode, error, message }` |
| Controladores | Lo que decida cada uno; está documentado por endpoint en [api/](./api/README.md) |

## Proteger una ruta o un módulo nuevo

1. **Autenticación en el plugin, no ruta por ruta.**
   `app.addHook('onRequest', authMiddleware)`. Si el archivo tiene rutas
   públicas, que sean una excepción explícita (una lista como `RUTAS_PUBLICAS`
   en `servicios.routes.ts`, o `excepto`), nunca al revés: el módulo de
   servicios estuvo abierto a internet, escrituras incluidas, porque el
   middleware se puso en una sola ruta y nadie lo repitió en las demás.
2. **Permiso en el plugin.** `app.addHook('preHandler', permisoPorMetodo('<módulo>'))`
   con los niveles que correspondan. Si el módulo es nuevo, añádelo a
   `ROUTE_PERMISSIONS` en `src/config/permissions.ts` **y** a su espejo del
   frontend (`src/lib/config/permissions.ts`): un módulo que no está en el mapa
   da 403 a todo el mundo, y uno que solo está en el backend no aparece en el
   sidebar.
3. **Recortes finos en el controlador**, leyendo `request.accessLevel`.
4. **Rutas públicas:** límite de intentos si mandan correos o validan algo
   adivinable, y respuestas que no revelen si un dato existe.
5. **Pruebas:** `tests/auth-sesiones.test.ts` cubre las guardas; los helpers
   de `tests/helpers/sesion-prueba.ts` crean usuarios y sesiones de prueba.
6. **Los dos repos.** Los middlewares y el mapa de permisos son idénticos en
   Transmeralda y Cotransmeq y tienen que seguir así.

## Observaciones

- El comentario de `requireRecorridosEdicion` dice que el modo por defecto de
  `requirePermission` es `warn`; desde octubre de 2026 es `enforce`. La guarda
  sigue siendo útil porque comparte la regla con el socket.
- Un origen rechazado por CORS no sale como 403: el callback devuelve un
  `Error` y Fastify responde con error de servidor. En el navegador se ve como
  «no se pudo conectar con el servidor».
