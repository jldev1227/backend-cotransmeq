# Invitaciones

`/api/invitaciones` · código en [`src/modules/invitaciones/`](../../src/modules/invitaciones/) · acceso de administración (`requireAdmin`, `full` en el módulo [`sesiones`](../permisos.md#catálogo-de-módulos)) para emitir; validar y aceptar son públicas con el token de la invitación

Alta de usuarios por invitación. Un administrador invita un correo con sus
áreas y su cargo; el backend crea una fila en `invitaciones_usuario` con un token
aleatorio (`crypto.randomBytes(32)` en hexadecimal, 64 caracteres) que vence a
las **72 horas**, y manda un correo con el enlace
`<EMAIL_FRONTEND_URL o el primer FRONTEND_URL>/invite/<token>`. La página
`/invite/[token]` del frontend valida el token y la persona pone su nombre, su
contraseña y su teléfono; al aceptar se crea el usuario con las áreas y el cargo
de la invitación, `role` por defecto (`usuario`), `permisos: PERMISOS_DEFAULT`,
`permisos_rutas` vacío, `es_invitado: true` e `invitado_por_id`. Aceptar **no
inicia sesión**: no devuelve token; la persona entra después por
[`POST /api/auth/login`](./auth.md#post-apiauthlogin).

Estados (`estado`):

| Estado | Cuándo |
|---|---|
| `pendiente` | Recién creada. Es el único que se puede validar y aceptar |
| `reemplazada` | Se invitó de nuevo el mismo correo: las pendientes anteriores pasan a este estado |
| `expirada` | Se intentó validar después de `expires_at`; se marca en ese momento, no hay cron |
| `aceptada` | Se creó el usuario, o se intentó aceptar cuando el correo ya tenía cuenta |
| `revocada` | Un administrador la anuló |

## Acceso

| Rutas | Guarda |
|---|---|
| `POST /api/invitaciones`, `GET /api/invitaciones`, `DELETE /api/invitaciones/:id` | `authMiddleware` + `requireAdmin` en cada ruta (`admin`: nivel `full` en el módulo `sesiones`) |
| `GET /api/invitaciones/validar/:token`, `POST /api/invitaciones/aceptar` | `pública · token`: el token de la invitación se busca exacto (`token` es único) y tiene que estar `pendiente` y sin vencer. Sin límite de intentos (el token tiene 256 bits) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/invitaciones` | admin | Crea la invitación y manda el correo |
| GET | `/api/invitaciones` | admin | Lista todas las invitaciones |
| DELETE | `/api/invitaciones/:id` | admin | Revoca una invitación (no la borra) |
| GET | `/api/invitaciones/validar/:token` | pública · token | Datos de una invitación vigente, para la página de registro |
| POST | `/api/invitaciones/aceptar` | pública · token | Crea el usuario de una invitación vigente |

### `POST /api/invitaciones`

**Body** (`crearInvitacionSchema`, `invitaciones.schema.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `correo` | string (email) | sí | Se guarda tal cual, sin normalizar |
| `area` | string[] | sí | Al menos una, de `AREAS` (`administracion`, `operaciones`, `contabilidad`, `facturacion`, `talento_humano`, `hseq`, `mantenimiento`) |
| `cargo` | string | no | |

Antes de crear comprueba que el correo no tenga ya cuenta (comparación exacta) y
pasa a `reemplazada` las invitaciones pendientes de ese correo.

**Respuesta 201**

```json
{
  "success": true,
  "correoEnviado": true,
  "invitacion": {
    "id": "uuid", "correo": "…", "token": "<64 hex>", "area": ["operaciones"], "cargo": "…",
    "invitado_por_id": "uuid", "estado": "pendiente", "expires_at": "…", "created_at": "…",
    "invitado_por": { "id": "uuid", "nombre": "…", "correo": "…" }
  }
}
```

El correo se manda después de crear la fila y su fallo no deshace nada:
`correoEnviado: false` avisa que la invitación existe pero el correo no salió (la
respuesta trae el `token` para armar el enlace a mano).

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | El body no cumple el esquema | `{ "error": "Datos inválidos", "details": [<issues de zod>] }` |
| 409 | El correo ya tiene cuenta | `{ "error": "<correo> ya tiene una cuenta en el sistema. Si perdió el acceso, puede restablecer su contraseña desde «¿Olvidaste tu contraseña?»." }` |
| 500 | Cualquier otro fallo | `{ "error": "No se pudo crear la invitación." }` |

### `GET /api/invitaciones`

Arreglo plano con todas las invitaciones, de todos los estados, por
`created_at` descendente: las columnas de la fila (incluido `token`) más
`invitado_por: { id, nombre }`.

### `DELETE /api/invitaciones/:id`

Pone `estado: 'revocada'`, sea cual sea el estado actual. Responde
`{ "success": true }`.

**Errores**: 404 `{ "error": "La invitación ya no existe." }` (P2025); 500
`{ "error": "No se pudo revocar la invitación." }` para lo demás (también un `id`
que no es UUID).

### `GET /api/invitaciones/validar/:token`

**Respuesta 200**

```json
{ "correo": "…", "area": ["operaciones"], "cargo": "…", "invitadoPorNombre": "…" }
```

**Errores**: 404 `{ "error": "Invitación inválida o expirada." }` si el token no
existe, no está `pendiente` o venció (en ese caso, además, la marca `expirada`);
500 `{ "error": "No se pudo validar la invitación." }`.

### `POST /api/invitaciones/aceptar`

**Body** (`aceptarInvitacionSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `token` | string | sí | El de la invitación |
| `nombre` | string | sí | Mínimo 2 caracteres; se guarda tal cual |
| `password` | string | sí | Mínimo 6; se guarda con `argon2.hash` |
| `telefono` | string | no | |

El correo, las áreas y el cargo salen de la invitación, no del body.

**Respuesta 201**: `{ "success": true, "usuario": { "id", "nombre", "correo", "area", "cargo" } }`.
La invitación pasa a `aceptada`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | El body no cumple el esquema | `{ "error": "Datos inválidos", "details": [...] }` |
| 410 | Token inexistente, ya usado, revocado, reemplazado o vencido | `{ "error": "La invitación no es válida, ya se usó o expiró. Pide una nueva al administrador." }` |
| 409 | Entre la invitación y la aceptación alguien dio de alta ese correo a mano (la invitación queda `aceptada`) | `{ "error": "<correo> ya tiene una cuenta. Inicia sesión con ella o restablece la contraseña." }` |
| 409 | Carrera en el índice único de `correo` (P2002) | `{ "error": "Ya existe una cuenta registrada con ese correo." }` |
| 500 | Cualquier otro fallo | `{ "error": "No se pudo completar el registro." }` |

## Efectos

- Correo de invitación con `EmailService.sendInvitacionEmail`
  (`src/services/email.service.ts`), remitente `Cotransmeq <noreply@cotransmeq.com>`,
  con las áreas por su etiqueta legible (`AREA_LABELS`). Ver
  [integraciones](../integraciones.md).
- Crea el usuario en `usuarios` al aceptar (ver [usuarios](./usuarios.md)).
- `registro_actividad` (módulo `usuarios`): crear queda como «invitó a alguien al
  equipo»; revocar, con la frase genérica (ver Observaciones). Aceptar está
  excluido del hook y además no tiene usuario autenticado (ver
  [actividad](./actividad.md)).

## Observaciones

- **El correo no se normaliza.** Se invita y se crea la cuenta con las mayúsculas
  que escribió el administrador, el chequeo de «ya tiene cuenta» es exacto, el
  login busca el correo tal cual y la recuperación lo pasa a minúsculas: una
  cuenta creada así no puede recuperar su contraseña. Ver
  [auth](./auth.md#observaciones) (`invitaciones.service.ts`).
- **`DELETE` revoca en cualquier estado**, también una `aceptada` (el usuario
  creado no se toca), y responde éxito igual. En `registro_actividad` la acción
  queda como «eliminó el usuario #xxxxxxxx», porque la ruta cae en la frase
  genérica del módulo `usuarios` (`registro-actividad.service.ts`).
- `GET /api/invitaciones/validar/:token` escribe: marca `expirada` la invitación
  vencida.
- El listado y el alta devuelven el `token` de las invitaciones, y el token viaja
  en la URL de `validar/:token`, que Fastify registra en el log de cada petición
  (`incoming request`, nivel `info`).
