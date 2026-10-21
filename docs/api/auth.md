# Autenticación

`/api/auth` · código en [`src/modules/auth/`](../../src/modules/auth/) · sin permiso de módulo: login y recuperación tienen su propio control; el resto pide [sesión](../autenticacion.md)

Entrada del equipo al panel: login, cierre de sesión, perfil propio, cambio de
contraseña, firma propia y la contraparte de servidor de la recuperación de
contraseña. El token que emite el login es un JWT firmado con `JWT_SECRET`
(HS256 por defecto de `jsonwebtoken`), **sin `tipo`** —eso lo identifica como
token del dashboard—, que dura 30 días (90 con `rememberMe`). Cada login crea
además una fila en `sesiones`: el middleware rechaza cualquier token sin su fila
activa, y eso es lo que permite cerrar una sesión o echar a alguien antes de que
venza el JWT (ver [sesiones](./sesiones.md)). Rol, áreas y permisos viajan en el
token, pero `authMiddleware` ya no los usa: los toma de la base en cada petición
(caché de 30 s). `permisos_rutas` ni siquiera va en el token, a propósito: es la
palanca con la que se recorta el acceso de alguien y tiene que aplicar ya.

Las contraseñas se verifican en bcrypt (`$2a$`/`$2b$`/`$2y$`, del backend
antiguo) o argon2 (`$argon2…`); todo lo que se escribe hoy es argon2 y el login
no reescribe los hash bcrypt. La recuperación de contraseña es un *magic link*
que **firma y verifica el frontend** (SvelteKit), dueño del secreto de firma; el
backend solo expone dos operaciones de servicio protegidas con la cabecera
`x-recovery-token`. El uso único del enlace se decide aquí con `updated_at`: el
enlace vale solo si se emitió después del último cambio de la cuenta, y aplicar
la contraseña mueve `updated_at` a ahora, así que ese enlace y cualquier otro
anterior dejan de valer. Ojo: cualquier escritura que toque `usuarios.updated_at`
(editar el perfil, cambiar la contraseña, una edición desde Usuarios) también
invalida los enlaces pendientes.

## Acceso

| Rutas | Guarda |
|---|---|
| `POST /api/auth/login` | pública. Límite de intentos **fallidos** en el controlador (`crearLimitador`): 5 por correo y 30 por IP, ventanas fijas de 15 min contadas desde el primer fallo. La IP sale de `ipCliente()` (`CF-Connecting-IP`, si no el primer `X-Forwarded-For`, si no la de la conexión) |
| `POST /api/auth/recuperacion/*` | sin sesión. `preHandlerLimite`: 20 peticiones por IP cada 15 min, con un contador compartido por las dos rutas y que cuenta todas las peticiones. Después, el controlador compara la cabecera `x-recovery-token` con `PASSWORD_RECOVERY_SERVICE_TOKEN` en tiempo constante (`timingSafeEqual`); sin la variable configurada responde 503 en vez de quedar abierta |
| El resto | `sesión` (`authMiddleware` en cada ruta). Acepta también tokens de la app de administrativos (`tipo: 'app_usuario'`), que tienen su propia fila en `sesiones` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/auth/login` | pública · límite 5/15 min por correo y 30/15 min por IP (solo fallos) | Valida credenciales, crea la sesión y devuelve token y usuario |
| POST | `/api/auth/logout` | sesión | Cierra la sesión del token |
| GET | `/api/auth/profile` | sesión | Perfil propio con los módulos accesibles ya resueltos |
| PUT | `/api/auth/change-password` | sesión | Cambia la contraseña propia conociendo la actual |
| PUT | `/api/auth/update-profile` | sesión | Cambia nombre o teléfono propios |
| GET | `/api/auth/my-session` | sesión | Datos de la sesión del token |
| GET | `/api/auth/my-firma` | sesión | Firma propia con URL firmada de S3 |
| POST | `/api/auth/my-firma` | sesión | Sube o reemplaza la firma propia |
| DELETE | `/api/auth/my-firma` | sesión | Quita la firma propia |
| POST | `/api/auth/recuperacion/lookup` | `x-recovery-token` · límite 20/15 min por IP | ¿El correo es de una cuenta activa? |
| POST | `/api/auth/recuperacion/aplicar` | `x-recovery-token` · límite 20/15 min por IP | Escribe la contraseña nueva de un enlace de recuperación |

### `POST /api/auth/login`

**Body** (`loginSchema` con zod para `correo` y `password`; `rememberMe` se lee crudo)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `correo` | string (email) | sí | Se recorta y pasa a minúsculas antes de validarlo y buscar la cuenta; el limitador usa el mismo valor normalizado |
| `password` | string | sí | Mínimo 6 caracteres; más corta responde 400 sin consultar la base |
| `rememberMe` | boolean | no | `true`: token y sesión de 90 días; si no, 30. Sin validar: un valor no booleano llega a Prisma al crear la sesión y el login responde 500 |

**Respuesta 200**

```json
{
  "token": "<JWT>",
  "user": {
    "id": "uuid", "nombre": "…", "correo": "…", "telefono": "…",
    "role": "usuario", "area": ["operaciones"], "cargo": "…", "activo": true,
    "firma_url": "firmas/<id>.png", "numero_documento": null, "fecha_ingreso": null,
    "permisos": { "bonos-planilla": false, "…": false },
    "permisos_rutas": null,
    "es_invitado": true, "invitado_por_id": "uuid",
    "ultimo_acceso": "…", "created_at": "…", "updated_at": "…",
    "modulos_accesibles": { "dashboard": "full", "servicios": "full", "recargos": "read", "…": "…" }
  }
}
```

- `user` es la fila completa de `usuarios` (todas sus columnas escalares) **sin
  `password`**. `ultimo_acceso` es el del acceso anterior: la fila se lee antes de
  actualizarlo.
- `modulos_accesibles` es `getAccessibleModules(role, area, permisos_rutas)`:
  `{ <moduleId>: 'full' | 'read' | 'limited' }`, calculado con la misma función que
  decide los 403 (`checkAccess`), para que el menú lateral no pueda discrepar de
  la API. Ver [permisos](../permisos.md).
- Payload del JWT: `sub` (id del usuario), `correo`, `role`, `nombre`, `area`,
  `permisos`, `iat`, `exp`. Sin `tipo` ni `permisos_rutas`.

**La fila de `sesiones`** (`SesionesService.crear`, en `src/modules/sesiones/sesiones.service.ts`)

| Columna | Valor |
|---|---|
| `usuario_id` | id del usuario |
| `token_hash` | SHA-256 en hexadecimal del JWT completo. El código lo recorta a los primeros 64 caracteres (`substring(0, 64)`), que es justo el largo del hex de SHA-256: no se pierde nada. Es la clave con la que `authMiddleware` busca la sesión; el token en claro no se guarda |
| `ip` | la misma de `ipCliente()` que usa el limitador |
| `user_agent` | cabecera `User-Agent`, o `null` |
| `remember_me` | `rememberMe` |
| `token_expiry` | ahora + 30 días (90 con `rememberMe`), igual que el `exp` del JWT |
| `is_active` | `true` |
| `last_activity` | ahora; luego la refresca el middleware, como mucho cada 30 s por sesión |
| `created_at` / `closed_at` | `now()` por defecto / `null` |

El token solo se entrega si la fila se guardó: si `SesionesService.crear` falla,
el login responde 500 (formato por defecto de Fastify) en vez de dar un token que
fallaría en la primera petición. Después se actualiza `usuarios.ultimo_acceso`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `correo` no es un email o `password` tiene menos de 6 caracteres | `{ "error": "Correo o contraseña con formato inválido" }` |
| 401 | Correo inexistente, contraseña incorrecta o hash en formato desconocido. Cuenta como fallo | `{ "error": "Invalid credentials" }` |
| 403 | Contraseña correcta pero `activo: false` | `{ "error": "Tu cuenta está deshabilitada. Contacta al administrador.", "disabled": true }` |
| 429 | El correo o la IP llegaron al tope | `{ "success": false, "error": "Demasiados intentos", "message": "Demasiados intentos. Vuelve a intentarlo en N minutos.", "reintentar_en": <segundos> }` y cabecera `Retry-After` |
| 500 | No se pudo crear la sesión, `rememberMe` no booleano u otro error no capturado | formato por defecto de Fastify |

El bloqueo se comprueba **antes** de verificar la contraseña: con el correo
bloqueado, ni la contraseña correcta entra hasta que vence la ventana. Un login
correcto reinicia el contador del correo, no el de la IP.

### `POST /api/auth/logout`

Cierra la sesión del token de `Authorization` (`is_active: false`, `closed_at`)
y vacía la caché de sesiones del middleware, así que el token deja de servir al
instante. Responde `{ "message": "Sesión cerrada" }`. Necesita una sesión
vigente: con una ya cerrada, `authMiddleware` responde 401 antes.

### `GET /api/auth/profile`

**Respuesta 200**

```json
{
  "id": "uuid", "nombre": "…", "correo": "…", "telefono": "…",
  "role": "usuario", "rol": "usuario", "area": ["hseq"], "cargo": "…",
  "firma_url": "firmas/<id>.png", "permisos": { "…": false },
  "permisos_rutas": { "formularios": "read" },
  "modulos_accesibles": { "formularios": "read", "perfil": "full" },
  "ultimo_acceso": "…"
}
```

`rol` es un duplicado de `role`. `permisos_rutas` va crudo (para que la pantalla
de permisos lo muestre tal cual) y `modulos_accesibles` ya resuelto. Además
refresca `sesiones.last_activity` y sobrescribe `sesiones.ip` con la cabecera
`X-Forwarded-For` tal cual llega (o la IP de la conexión).

**Errores**: 401 `{ "error": "Sesión no válida o expirada. Inicie sesión nuevamente." }`
(redundante con el middleware), 404 `{ "error": "Usuario no encontrado" }`,
500 `{ "error": "Error interno" }`.

### `PUT /api/auth/change-password`

**Body** (sin esquema)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `currentPassword` | string | sí | Se verifica contra el hash (bcrypt o argon2) |
| `newPassword` | string | sí | Mínimo 6 caracteres. Se guarda con `argon2.hash` |

**Respuesta 200**: `{ "message": "Contraseña actualizada correctamente" }`. Pone
`updated_at` a ahora, lo que invalida los enlaces de recuperación pendientes.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta alguna de las dos | `{ "error": "Se requiere la contraseña actual y la nueva" }` |
| 400 | `newPassword` con menos de 6 caracteres | `{ "error": "La nueva contraseña debe tener al menos 6 caracteres" }` |
| 400 | La actual no coincide (o el hash tiene formato desconocido) | `{ "error": "La contraseña actual es incorrecta" }` |
| 404 | El usuario ya no existe | `{ "error": "Usuario no encontrado" }` |
| 500 | Cualquier otro fallo | `{ "error": "Error interno" }` |

### `PUT /api/auth/update-profile`

**Body** (sin esquema; solo se cambia lo que llega)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string | no | Sin validación de largo: un string vacío se guarda |
| `telefono` | string | no | |

**Respuesta 200**: `{ id, nombre, correo, telefono, role, area, cargo, permisos, permisos_rutas, ultimo_acceso }`.
Pone `updated_at` a ahora. Un tipo que no sea string llega a Prisma y responde
500 `{ "error": "Error interno" }`.

### `GET /api/auth/my-session`

**Respuesta 200**

```json
{
  "sesion": {
    "id": "uuid", "ip": "…", "user_agent": "…", "remember_me": false,
    "token_expiry": "…", "last_activity": "…", "created_at": "…", "is_active": true,
    "duracion_minutos": 125, "duracion_texto": "2h 5m"
  }
}
```

`{ "sesion": null }` si no encuentra la fila activa del token.

### `GET /api/auth/my-firma`, `POST /api/auth/my-firma` y `DELETE /api/auth/my-firma`

- `GET`: `{ "firma_url": "firmas/<id>.png", "firma_signed_url": "https://…" }`, con
  URL firmada de S3 válida 1 hora. Los dos en `null` si no tiene firma;
  `firma_signed_url: null` si no se pudo firmar.
- `POST`: `multipart/form-data`; se toma el primer archivo (`request.file()`), sin
  validar tipo. Se guarda en S3 como `firmas/<usuarioId>.<ext>` (extensión del
  nombre del archivo, `png` si no tiene) y se borra la anterior. Responde
  `{ "success": true, "firma_url": "firmas/<id>.<ext>", "firma_signed_url": "https://…" }`.
  400 `{ "error": "No se envió ningún archivo" }`; una petición que no es
  multipart la rechaza `@fastify/multipart` con 406.
- `DELETE`: borra el objeto de S3 (los fallos se ignoran) y pone `firma_url` en
  `null`. Responde `{ "success": true }`.

La firma la usan los documentos que se firman en nombre del usuario (ver
`GET /api/usuarios/firmantes` en [usuarios](./usuarios.md)).

### `POST /api/auth/recuperacion/lookup`

Lo llama el **servidor del frontend**, no el navegador. Responde la verdad porque
quien pregunta tiene el secreto de servicio; la ruta pública del frontend
(`/api/auth/recuperar-password` de SvelteKit) es la que contesta siempre lo mismo
al usuario para no revelar qué correos existen.

**Cabecera**: `x-recovery-token: <PASSWORD_RECOVERY_SERVICE_TOKEN>`.

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `correo` | string | sí | Se normaliza con `trim` y minúsculas antes de buscar |

**Respuesta 200**: `{ "existe": true, "nombre": "…" }` o `{ "existe": false }`. Una
cuenta desactivada se trata como inexistente.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Sin correo | `{ "error": "Falta el correo." }` |
| 401 | Cabecera ausente o distinta | `{ "error": "No autorizado." }` |
| 429 | Más de 20 peticiones por IP en 15 min | igual que el del login |
| 503 | `PASSWORD_RECOVERY_SERVICE_TOKEN` sin configurar | `{ "error": "La recuperación de contraseña no está habilitada." }` |
| 500 | Fallo de base | `{ "error": "No se pudo consultar la cuenta." }` |

### `POST /api/auth/recuperacion/aplicar`

**Cabecera**: `x-recovery-token`.

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `correo` | string | sí | `trim` + minúsculas |
| `password` | string | sí | 8 a 72 caracteres, con al menos una letra y un número (mismas reglas que `$lib/recuperacion/password.ts` del frontend) |
| `tokenId` | string | sí | `jti` del enlace; solo va al log |
| `emitidoEn` | string (fecha ISO) | sí | Instante de emisión del enlace. El frontend manda `toISOString()` |

**Respuesta 200**: `{ "ok": true }`. Guarda el hash argon2, pone `updated_at` a
ahora y **cierra todas las sesiones** del usuario (`SesionesService.cerrarTodas`):
quien recupera su contraseña suele ser alguien que perdió el control de la cuenta.
Si cerrar las sesiones falla, el cambio queda guardado igual y solo se registra
en el log.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta `correo` o `tokenId`, o `emitidoEn` no es una fecha | `{ "error": "Petición incompleta." }` |
| 400 | La contraseña no cumple las reglas | `{ "error": "<motivo>" }` (p. ej. `La contraseña debe tener al menos 8 caracteres.`) |
| 401 | Cabecera ausente o distinta | `{ "error": "No autorizado." }` |
| 409 | Cuenta inexistente o desactivada | `{ "error": "Esta cuenta no puede restablecer su contraseña. Comunícate con soporte." }` |
| 409 | `emitidoEn` no es posterior a `usuarios.updated_at` (enlace ya usado o cuenta cambiada después) | `{ "error": "Este enlace ya se utilizó para cambiar la contraseña. Solicita uno nuevo si necesitas volver a cambiarla." }` |
| 429 | Más de 20 peticiones por IP en 15 min | igual que el del login |
| 503 | Secreto sin configurar | `{ "error": "La recuperación de contraseña no está habilitada." }` |
| 500 | Fallo al guardar | `{ "error": "No se pudo guardar la contraseña." }` |

El frontend muestra tal cual el `error` de cualquier 4xx.

## Efectos

- `sesiones`: el login crea la fila; `logout` la cierra; `recuperacion/aplicar`
  cierra todas las del usuario. Cerrar vacía la caché de
  `src/middlewares/cache-sesiones.ts`. Ver [sesiones](./sesiones.md) y
  [middlewares](../middlewares.md).
- S3: `firmas/<usuarioId>.<ext>` (subida y borrado de la firma propia).
- Nada de esto queda en `registro_actividad`: el hook excluye `/api/auth` (ver
  [actividad](./actividad.md)). No emite eventos de socket.

## Observaciones

- **Las cuentas antiguas creadas desde una invitación pueden conservar
  mayúsculas en la base.** El alta manual (`POST /api/usuarios`) y los valores
  recibidos por login y recuperación se normalizan; una búsqueda exacta todavía
  no encuentra una fila cuyo correo persistido tenga mayúsculas o espacios.
- **`PUT /api/auth/change-password` no tiene límite de intentos** y no cierra las
  demás sesiones del usuario, a diferencia de la recuperación. Su mínimo es 6
  caracteres frente a 8 con letra y número en la recuperación
  (`auth.controller.ts`).
- **`GET /api/auth/profile` sobrescribe `sesiones.ip` con `X-Forwarded-For` crudo**,
  no con `ipCliente()`: la IP guardada al iniciar sesión se reemplaza por un valor
  que el cliente puede falsear o que puede ser una lista. Si pasa de 45
  caracteres (`sesiones.ip` es `VarChar(45)`), el `update` falla fuera del
  `try/catch` y el perfil responde 500 (`auth.controller.ts`).
- **El límite de la recuperación cuenta la IP equivocada.** Las dos rutas las
  llama el servidor del frontend (`src/lib/server/recuperacion/backend.ts` de
  `cotransmeq-app`), que no reenvía la IP del usuario: los 20 intentos cada 15 min
  se comparten entre todos los usuarios que salgan por la misma IP del frontend.
- **Recuperar la contraseña no revoca los tokens del MCP.** `aplicar` cierra las
  sesiones, pero un token personal de `api_tokens` creado antes sigue sirviendo
  (ver [mcp](./mcp.md)).
- `POST /api/auth/my-firma` acepta cualquier archivo hasta el tope global de
  multipart (200 MB, en `src/app.ts`) y usa la extensión que trae el nombre.
- `rememberMe` no se valida: un valor no booleano produce 500 después de firmar el
  token (no se entrega).
