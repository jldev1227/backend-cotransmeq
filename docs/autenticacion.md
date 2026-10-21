# Autenticación

Quién puede llamar a la API, con qué credencial y cómo se revoca cada una.
Léelo antes de añadir una ruta pública, un tipo de token nuevo o cualquier cosa
que dependa de «quién es el usuario». Los permisos por área y módulo (qué puede
hacer alguien ya autenticado) están en [permisos.md](./permisos.md), y el orden
en que corren las guardas, en [middlewares.md](./middlewares.md).

## Credenciales que acepta la API

Todas las credenciales firmadas son JWT con el **mismo** `JWT_SECRET`; lo que
las distingue es el campo `tipo` del payload, y cada guarda solo acepta los
suyos.

| Quién | Credencial | `tipo` | Dura | Se revoca | Guarda |
|---|---|---|---|---|---|
| Persona del equipo (dashboard) | JWT de `POST /api/auth/login` | sin `tipo` | 30 días, 90 con «recordarme» | Sí: fila de `sesiones` | `authMiddleware` |
| Persona del equipo (app móvil) | JWT del canje del enlace de la app | `app_usuario` | Lo que dure el enlace (30 días) | Sí: sesión y enlace | `authMiddleware` |
| Conductor (portal web y apps) | JWT del magic link | `conductor_portal` | 30 días | Sí: fila de `conductor_token` (borrarla, o mandar al conductor a la papelera) | `portalAuthMiddleware` (una copia por archivo de rutas del portal) |
| Conductor (reporte de días, flujo viejo) | JWT del magic link de días laborados | `conductor_dias_laborados` | — | No | `conductorAuthMiddleware` |
| Impresor de PDF (Puppeteer) | JWT efímero | `conductor_portal_print_desprendible`, `conductor_portal_print` | 180 s | — | La misma guarda del portal, acotada a una ruta |
| Claude / ChatGPT (MCP) | Token personal `cmq_…` | no es JWT | Hasta revocarlo | Sí | `mcp.routes.ts` |
| Frontend (recuperación de contraseña) | Cabecera `x-recovery-token` | secreto compartido | — | Rotando el secreto | `recuperacion.controller.ts` |
| Cron externo | Cabecera `x-cron-secret` | secreto compartido | — | Rotando el secreto | `cronAutorizado` (`src/lib/cron-secreto.ts`), en el controlador del snapshot |
| Cualquiera con el enlace | Token o código en la URL | — | Según el recurso | Según el recurso | El controlador del recurso |

## Personas del equipo

### Login

`POST /api/auth/login` ([api/auth.md](./api/auth.md)) recibe
`{ correo, password, rememberMe? }`:

1. El esquema zod (`auth.schema.ts`) recorta espacios y convierte el correo a
   minúsculas antes de validarlo; también exige contraseña de 6 caracteres o
   más. Si el formato no sirve, responde **400**.
2. Mira el límite de intentos fallidos: **5 por correo y 30 por IP cada 15
   minutos**. Solo cuentan los fallos, y un login correcto reinicia el contador
   del correo. Pasado el tope responde **429** con `Retry-After`.
3. Compara la contraseña. Conviven dos formatos de hash: bcrypt (`$2a$`, `$2b$`,
   `$2y$`, heredado del backend anterior) y argon2 (`$argon2…`, todas las
   contraseñas nuevas). Un formato desconocido cuenta como contraseña errada.
4. Usuario con `activo = false` → **403** `{ disabled: true }`.
5. Firma el JWT (`sub`, `correo`, `role`, `nombre`, `area`, `permisos`) por 30
   días, o 90 con `rememberMe`, y **crea la fila de `sesiones`** con el hash del
   token, IP, user agent y vencimiento. Si la fila no se puede guardar, el login
   falla: un token sin sesión no serviría ni para la primera petición.
6. Responde `{ user, token }`, con `user.modulos_accesibles` ya resuelto por el
   mismo código que decide los 403 (`getAccessibleModules`), para que el
   frontend no tenga que recalcular el sidebar.

`permisos_rutas` no viaja en el token a propósito: es la palanca para recortarle
el acceso a alguien y tiene que surtir efecto ya, no en el siguiente login.

### Cada petición

El cliente manda `Authorization: Bearer <token>` y `authMiddleware`
(`src/middlewares/auth.middleware.ts`) hace, en orden:

1. Sin cabecera → 401 `No token`; mal formada o firma inválida → 401 `Invalid token`.
2. `tipo` distinto de «sin tipo» o `app_usuario` → 401
   «Este acceso no sirve para esta sección.». Así un enlace del portal del
   conductor no abre la API del equipo.
3. Busca la sesión por `sha256(token)` (primeros 64 caracteres hex): tiene que
   estar `is_active`, sin vencer y con el usuario activo. Si no → 401
   «Tu sesión se cerró o venció».
4. Arma `request.user` con el payload del token, pero **rol, áreas, permisos
   individuales, nombre y correo salen de la base**, no del token. Lo que el JWT
   trae en esos campos no se usa para autorizar.
5. Si el token es `app_usuario`, comprueba además que el enlace de la app siga
   vigente (`sesionAppVigente`); si no → 401 «Tu acceso a la app fue revocado o venció».

La consulta de la sesión se cachea **30 segundos por hash de token**
(`src/middlewares/cache-sesiones.ts`); la clave es el hash, nunca el token. La
última actividad se apunta al refrescar la caché, no en cada petición.

### Cerrar una sesión y qué tarda en surtir efecto

| Acción | Cómo | Efecto |
|---|---|---|
| Cerrar mi sesión | `POST /api/auth/logout` | Inmediato |
| Cerrar la de otro, o todas las de un usuario | [`sesiones`](./api/sesiones.md) (administración) | Inmediato en este proceso: quien cierra vacía la caché |
| Desactivar a un usuario | [`usuarios`](./api/usuarios.md) | Como mucho 30 s (caché de sesión) |
| Cambiar áreas, rol o permisos individuales | `usuarios` | Como mucho 30 s |
| Cambiar `permisos_rutas` | `usuarios` | Inmediato: la escritura invalida su caché (también de 30 s) |
| Restablecer la contraseña por correo | Recuperación | Cierra **todas** las sesiones del usuario |

El backend corre en un solo contenedor. Si algún día hay varias réplicas, cada
una tendrá su caché y el plazo será de hasta 30 s en todas.

### App móvil de administrativos

Desde «Mi perfil» del dashboard se genera un enlace de 30 días
([api/app-usuarios.md](./api/app-usuarios.md)). Generarlo exige una sesión del
**dashboard**: una sesión de la app no puede renovarse sola. La app canjea el
código del enlace (límite de 20 intentos por IP cada 15 minutos) y recibe un JWT
`tipo: 'app_usuario'` que lleva el id del enlace. Ese token pasa por
`authMiddleware` como cualquier otro del equipo, con la comprobación extra del
paso 5. Revocar el enlace desde el perfil corta la app sin tocar las sesiones
web.

## Conductores

### Portal del conductor

El portal (web en `/public/portal` y apps móviles) no usa usuarios ni áreas.
Flujo ([api/conductor-portal.md](./api/conductor-portal.md)):

1. `POST /api/conductor-portal/solicitar-acceso` con
   `{ numero_identificacion, canal: 'web' | 'mobile' }`. Límite: 3 por cédula y
   30 por IP cada hora. Cédula desconocida → 404; conductor sin correo → 400.
2. Se emite el JWT `tipo: 'conductor_portal'` (`sub` = id del conductor,
   `cedula`, `nombre`), válido 30 días, se registra en `conductor_token` y viaja
   **dentro del enlace** del correo (`src/lib/portal-access-link.ts`):
   `/public/portal?token=…` para la web, o la página puente
   `/public/abrir-app?token=…` para la app, porque Gmail le quita el destino a
   los enlaces `cotransmeq://`. `MOBILE_PORTAL_URL` solo se usa si es https.
3. Al abrir el enlace, el cliente llama
   `GET /api/conductor-portal/verificar-token?token=…`, que comprueba firma,
   `tipo` y que el token esté en `conductor_token` sin vencer, y devuelve
   `{ token, conductor, expires_at }`: el mismo token, no uno nuevo.
4. Desde ahí lo manda como `Authorization: Bearer` a las rutas del portal.

Los correos de nómina, liquidaciones y primas reutilizan el token vigente del
conductor en vez de emitir uno por correo: los tres llaman a
`tokenPortalVigente` (`portal-token.service.ts`), que solo reutiliza tokens
`conductor_portal` firmados con el `JWT_SECRET` actual (`conductor_token` la
comparte el enlace de días laborados) y, si no hay ninguno, emite uno. La
solicitud de acceso y las campañas de formularios emiten uno nuevo.

El middleware tiene **dos copias**, privadas de cada archivo:
`conductor-portal.routes.ts` y `formularios-portal.routes.ts`. Verifican la
firma y el `tipo`, y del token del magic link comprueban además que siga
registrado (`tokenPortalRegistrado`): su fila de `conductor_token` existe, no
ha vencido y el conductor no está borrado (`deleted_at`). Si no, 401 «Tu acceso
al portal venció o fue revocado. Pide un enlace nuevo.». Así se revoca un
enlace: borrando su fila o mandando al conductor a la papelera. La comprobación
se cachea 30 s por hash del token, así que eso surte efecto en medio minuto
como mucho; el borrado definitivo de un conductor vacía la caché en el acto.
El estado laboral no se mira a propósito: un conductor
desvinculado sigue necesitando sus desprendibles. Si todo pasa, dejan al
conductor en `request.conductorPortal`; un `tipo` que no conocen lo rechazan
sin tener que enterarse de nada. `primas` y `liquidaciones` también **emiten**
tokens del portal, para los enlaces de los correos de desprendibles, pero no
los verifican.

Para la revisión de Google Play existe `POST /api/conductor-portal/acceso-revision`:
cédula y contraseña de una cuenta sintética marcada en `permisos` (10 intentos
por IP cada 15 minutos). La contraseña de un conductor real no habilita este acceso.

### Tokens de impresión

Puppeteer abre páginas del portal para generar PDF. Para eso se firman tokens
de 180 segundos con un `tipo` propio, y el middleware solo los deja pasar a
**una** ruta y **un** recurso:

| `tipo` | Solo abre | Recurso |
|---|---|---|
| `conductor_portal_print_desprendible` | `GET /api/conductor-portal/desprendibles/:id/datos` | el `lid` del token |
| `conductor_portal_print` | El detalle de un envío de formulario | el `sid` del token |

Se compara con la ruta **declarada** y no con `request.url`: la ruta del PDF
comparte el parámetro y, mirando solo el id, el impresor podría invocarse a sí
mismo en cadena. Estos tokens no se guardan en `conductor_token` y no pasan por
`tokenPortalRegistrado`: su cerco es la ruta y su vida de 180 s.

### Días laborados

`dias-laborados` conserva un flujo anterior con su propio token
(`conductor_dias_laborados`), su `solicitar-acceso` (mismos límites que el
portal) y su `verificar-token`. Ver [api/dias-laborados.md](./api/dias-laborados.md).

## Accesos públicos por enlace

Rutas sin sesión cuyo control de acceso es un token o un código que viaja en el
enlace. El detalle de cada una está en el doc de su módulo.

| Para qué | Rutas | Doc |
|---|---|---|
| Ver un servicio compartido | `GET /api/servicios/public/:token` | [servicios](./api/servicios.md) |
| Firmar un desprendible | `/api/desprendible-firma/:token/*` | [liquidaciones](./api/liquidaciones.md) |
| Desprendible compartido | `/api/desprendible/compartido/:token/*` | [documentos](./api/documentos.md) |
| Validar un extracto FUEC (QR) | `GET /api/public/extractos/:codigo` (120 por IP por minuto) | [extractos](./api/extractos.md) |
| Diligenciar una asistencia | `/api/public/asistencias/:token/*` | [asistencias](./api/asistencias.md) |
| Responder una evaluación | `/api/public/evaluaciones/:id` | [evaluaciones](./api/evaluaciones.md) |
| Registrar un visitante | `POST /api/inducciones` | [inducciones](./api/inducciones.md) |
| Formularios SARLAFT + PTEE | `/api/public/formularios-sarlaft/*` | [formularios-sarlaft](./api/formularios-sarlaft.md) |
| Certificados de un tercero | `/api/public/certificados-tercero/*` (enlace por correo; 3 por identificación y 30 por IP cada hora) | [certificados-tributarios](./api/certificados-tributarios.md) |
| Solicitud desde la landing | `POST /api/public/solicitudes` (5 por IP por hora, 20 por día) | [solicitudes-web](./api/solicitudes-web.md) |
| Aceptar una invitación | `GET /api/invitaciones/validar/:token`, `POST /api/invitaciones/aceptar` | [invitaciones](./api/invitaciones.md) |

## Recuperación de contraseña

El enlace mágico lo **emite y verifica el frontend** (SvelteKit), que guarda el
secreto de firma. El backend solo hace lo que necesita la base, en dos rutas
([api/auth.md](./api/auth.md)):

- `POST /api/auth/recuperacion/lookup` — ¿el correo es de una cuenta activa?
- `POST /api/auth/recuperacion/aplicar` — reescribe el hash con argon2.

Las dos exigen la cabecera `x-recovery-token` igual a
`PASSWORD_RECOVERY_SERVICE_TOKEN`, comparada en tiempo constante. Sin la
variable responden **503** en vez de quedar abiertas. Límite: 20 intentos por
IP cada 15 minutos. La contraseña nueva va de 8 a 72 caracteres (72 es el tope
de bcrypt). El enlace es de un solo uso sin tabla propia: solo vale si se emitió
después del `updated_at` del usuario, y aplicar el cambio mueve ese
`updated_at`. Al terminar se cierran todas las sesiones del usuario.

## Tokens de API (MCP)

Cada persona puede crear hasta 10 tokens personales para conectar Claude o
ChatGPT ([api/mcp.md](./api/mcp.md)). Llevan el prefijo `cmq_`, se muestran una
sola vez y en la base solo queda su SHA-256. El servidor MCP los acepta como
`Authorization: Bearer cmq_…` o en la ruta (`/api/mcp/cmq_…`) para los
conectores que solo piden una URL.

En cada llamada se carga al dueño (rol, áreas y `permisos_rutas`) y se rechaza si
está inactivo o el token se revocó: un cambio de permisos aplica de inmediato.
Las herramientas disponibles son las del asistente, filtradas con los mismos
permisos.

## Crons externos

Las tres rutas `*/cron-hora` de los snapshots (recorridos, cierres de terceros
y ocasional) son para un programador externo y no piden sesión ni permiso: su
única guarda es la cabecera `x-cron-secret`, que `cronAutorizado`
(`src/lib/cron-secreto.ts`) compara con `CRON_SECRET` en tiempo constante
(`timingSafeEqual`). Sin la variable configurada **rechazan siempre**. La de
recorridos vive en un plugin propio sin `authMiddleware`; las de cierres y
ocasional comparten plugin con rutas que sí exigen sesión, y quedan fuera con
una excepción explícita en el hook `onRequest` y en el `excepto` de
`permisoPorMetodo`. Ver [tareas-programadas.md](./tareas-programadas.md).

## Sockets

El handshake de Socket.IO toma el token de `auth.token`, de la cabecera
`Authorization` o del query `token`, y decide qué identidad le da
(`identidadDelToken` en `src/sockets/auth.ts`):

- **Token del equipo** (sin `tipo` o `app_usuario`) con su sesión abierta, con
  la misma comprobación que `authMiddleware` (`usuarioDeSesion`, caché de
  30 s) y, si es `app_usuario`, con su enlace vigente: identidad de equipo con
  rol, áreas, nombre y correo **leídos de la base**.
- **Token del portal** (`conductor_portal`): conecta sin identidad de equipo.
  El gateway de formularios lo verifica por su cuenta para unirlo a la sala del
  conductor.
- **Cualquier otro** (sesión cerrada, enlace revocado, tokens de impresión o de
  días laborados, firma inválida): cuenta como token inválido.

Con `SOCKET_AUTH_MODE=enforce` se rechaza la conexión sin token o con uno
inválido (y también si la base no responde al verificar); con `permissive` (salida de
emergencia, no el default) pasa sin identidad y queda en el log. La identidad de un evento sale
siempre del token, nunca del payload. Ver [tiempo-real.md](./tiempo-real.md).

## Límites de intentos

`src/utils/limitador.ts`: contadores en memoria por clave y ventana fija. Un
reinicio los borra, lo cual se acepta (el peor caso es regalar una ventana).
La IP sale de `CF-Connecting-IP` (producción va detrás de Cloudflare), luego de
`X-Forwarded-For` y por último de la conexión; sin esto todos compartirían
contador y el primero que se equivocara bloquearía a la empresa. Al pasarse,
**429** con `Retry-After` y `{ success: false, error, message, reintentar_en }`.

| Ruta | Tope |
|---|---|
| Login | 5 fallos por correo y 30 por IP / 15 min |
| Recuperación de contraseña | 20 por IP / 15 min |
| Pedir enlace del portal, de días laborados o de certificados | 3 por cédula o identificación y 30 por IP / hora |
| Acceso de revisión de tiendas | 10 por IP / 15 min |
| Canje del enlace de la app de administrativos | 20 por IP / 15 min |
| Verificar el enlace de certificados | 60 por IP / 15 min |
| Validar un extracto | 120 por IP / minuto |
| Solicitud desde la landing | 5 por IP / hora y 20 por IP / día (limitador propio del módulo) |

## Secretos

| Variable | Para qué | Si falta |
|---|---|---|
| `JWT_SECRET` | Firma **todos** los JWT: equipo, app, portal, impresión, sockets | El backend no arranca |
| `PASSWORD_RECOVERY_SERVICE_TOKEN` | Cabecera `x-recovery-token` | Recuperación deshabilitada (503) |
| `CRON_SECRET` | Cabecera `x-cron-secret` | Las rutas `*/cron-hora` rechazan siempre; los crons internos siguen igual |

Cada entorno necesita su propio `JWT_SECRET`. Un token firmado en un entorno
con el secreto de otro es un token válido allí: sin su fila de sesión no abre
la API del equipo ni da identidad de equipo en los sockets, y sin su fila en
`conductor_token` no abre el portal, pero sí abre las rutas de impresión, el
reporte de días laborados y la sala de formularios del conductor por socket.
Cambiar el secreto invalida de golpe todos los tokens: el equipo tendrá que
volver a entrar y los conductores, pedir otro enlace.

## Observaciones

- **La revocación del portal no llega al socket de formularios.** `forms:join`
  solo verifica firma y `tipo` (`formularios-dinamicos.gateway.ts`): un token
  revocado sigue entrando a la sala de su conductor, y recibiendo los avisos de
  sus formularios, hasta que vence el JWT.
- `solicitar-acceso` y `verificar-token` no miran `deleted_at`: un conductor en
  la papelera recibe el correo y su enlace se valida, pero cada petición
  siguiente responde 401 «Tu acceso al portal venció o fue revocado». Ver
  [api/conductor-portal.md](./api/conductor-portal.md#observaciones).
- `solicitar-acceso` responde 404 a una cédula que no existe y 400 a una sin
  correo, así que permite averiguar qué cédulas son de conductores. El límite
  de intentos lo frena, pero no lo evita.
- Un socket ya conectado no se corta al cerrar su sesión: el servidor emite
  `sesion-cerrada` para que el cliente se desconecte, y el socket queda abierto
  hasta que se desconecte o se reconecte (la reconexión vuelve a pasar por el
  handshake).
- El payload del JWT del equipo trae `role`, `area` y `permisos`, pero el
  middleware los reemplaza por los de la base. El comentario de
  `auth.service.ts` que dice que `permisos` va en el token para que
  `requireBonosPlanilla` no consulte la base quedó viejo.

## Diferencias con Transmeralda

La autenticación es la misma en los dos backends. Cambian dos literales: los
tokens del MCP llevan el prefijo `cmq_` (en Transmeralda, `tme_`) y el deep
link de la app es `cotransmeq://portal`.
