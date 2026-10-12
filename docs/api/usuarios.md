# Usuarios

`/api/usuarios` (y `/api/conductores/basicos`) · código en [`src/modules/usuarios/`](../../src/modules/usuarios/) · acceso de administración: `requireAdmin`, que pide `full` en el módulo [`sesiones`](../permisos.md#catálogo-de-módulos)

Cuentas del equipo administrativo (modelo `usuarios`, tabla `users`; los
conductores no son usuarios). El módulo cubre el alta manual —la alternativa a la
[invitación](./invitaciones.md) para quien no tiene correo corporativo o hay que
dejar listo en el momento—, la edición de datos, rol y áreas, la activación, la
firma y los permisos. El hash se hace con `argon2.hash` con los parámetros por
defecto, igual que la invitación, para no tener dos formatos «nuevos».

El acceso de una persona se decide con tres datos que conviene no confundir:

- **`area`** (`String[]`, columna `areas`): las reglas por área de
  `src/config/permissions.ts`.
- **`permisos_rutas`** (JSON `{ "<moduleId>": "full" | "read" | "limited" }`): lista
  blanca por usuario. Con al menos una clave **sustituye por completo** a las
  reglas por área: solo entran los módulos listados, con exactamente ese nivel,
  incluidos los `general: true`. Excepciones: `perfil` siempre queda accesible y
  `role: 'admin'` conserva acceso total. `null` y `{}` significan «sin lista
  blanca». Ver [permisos](../permisos.md).
- **`permisos`** (JSON de booleanos, heredado): **no** decide el acceso a módulos.
  Hoy solo se leen claves sueltas: `bonos-planilla` (permiso individual que exige
  `requireBonosPlanilla`, `src/middlewares/bonos.middleware.ts`, y el canvas de
  recorridos) y `nomina` (a quién avisar de un desprendible firmado).
  `PERMISOS_DEFAULT` (todo en `false`) se escribe en el alta y al aceptar una
  invitación. `PERMISOS_ADMIN`, en `usuarios.service.ts`, se exporta pero ningún
  código lo usa; sus claves se llaman como modelos de Prisma (`recargos`,
  `conductores`…), pero es un `Record<string, boolean>`, no un `select` ni un
  `include`: no hay que tocarlo en los repasos de borrado lógico.

Los cambios aplican de inmediato: las escrituras vacían la caché de
`permisos_rutas` (`invalidarPermisosRutas`) y la de sesiones
(`olvidarSesionesEnCache`), de las que leen los guards; sin eso tardarían hasta
30 s.

## Acceso

| Rutas | Guarda |
|---|---|
| Todas menos las dos de abajo | `authMiddleware` + `requireAdmin` en cada ruta (`admin`: `sesiones:full`) |
| `GET /api/usuarios/firmantes`, `GET /api/conductores/basicos` | solo `sesión` |

`requireAdmin` (`src/middlewares/permissions.middleware.ts`) pasa si el usuario
tiene nivel **`full`** en el módulo `sesiones`: área `administracion`, una
lista blanca con `{"sesiones": "full"}` (`read` o `limited` no bastan), o
`role: 'admin'` con lista blanca. Quien pasa puede editar el `area`, el `role` y
la `permisos_rutas` de cualquiera, incluida la propia: conceder «Sesiones» con
nivel completo desde la pantalla de permisos equivale a dar administración. No
mira el módulo `usuarios` (que es el que piden las herramientas del
[asistente](./asistente.md)) y siempre rechaza con 403, también en
`PERMISSIONS_MODE=warn`.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/usuarios` | admin | Alta manual de un usuario |
| GET | `/api/usuarios` | admin | Lista todos los usuarios |
| GET | `/api/usuarios/firmantes` | sesión | Usuarios con firma, con URL firmada de S3 |
| GET | `/api/usuarios/presencia` | admin | Lista de usuarios con `en_linea` |
| GET | `/api/usuarios/online-ids` | admin | Ids de los usuarios conectados por socket |
| GET | `/api/usuarios/:id` | admin | Un usuario |
| PUT | `/api/usuarios/:id` | admin | Edita datos, rol, áreas, estado y lista blanca |
| PATCH | `/api/usuarios/:id/activo` | admin | Activa o desactiva; al desactivar cierra sus sesiones |
| PATCH | `/api/usuarios/:id/permisos` | admin | Reemplaza el JSON `permisos` |
| POST | `/api/usuarios/permisos/bonos-planilla` | admin | Concede o quita `bonos-planilla` a varios usuarios |
| POST | `/api/usuarios/:id/firma` | admin | Sube o reemplaza la firma de un usuario |
| DELETE | `/api/usuarios/:id/firma` | admin | Quita la firma de un usuario |
| GET | `/api/conductores/basicos` | sesión | Pensada para listar conductores; hoy siempre falla (ver Observaciones) |

### Forma de un usuario

Lo que devuelven el alta, el listado, la ficha, el `PUT` y los dos `PATCH`
(`USUARIO_SELECT`, nunca incluye `password`):

```json
{
  "id": "uuid", "nombre": "…", "correo": "…", "telefono": "…", "role": "usuario",
  "cargo": "…", "area": ["operaciones"], "activo": true, "firma_url": "firmas/<id>.png",
  "permisos": { "bonos-planilla": false, "…": false },
  "permisos_rutas": null, "es_invitado": false,
  "ultimo_acceso": "…", "created_at": "…", "updated_at": "…"
}
```

### `POST /api/usuarios`

**Body** (`createUsuarioSchema`, `usuarios.schema.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string | sí | Mínimo 2 caracteres; se guarda con `trim` |
| `correo` | string (email) | sí | Se guarda con `trim` y en minúsculas |
| `password` | string | sí | Mínimo 6 (mismo mínimo que la invitación y el cambio de contraseña) |
| `telefono` | string | no | |
| `cargo` | string \| null | no | |
| `role` | string | no | `usuario` por defecto. El esquema acepta cualquier texto, pero tiene que ser un valor de `enum_users_role` (`admin`, `liquidador`, `facturador`, `aprobador`, `gestor_flota`, `gestor_nomina`, `consulta`, `usuario`, `gestor_servicio`, `gestor_planillas`, `kilometraje`) o Prisma falla |
| `area` | string[] | no | Valores de `AREAS` (`administracion`, `operaciones`, `contabilidad`, `facturacion`, `talento_humano`, `hseq`, `mantenimiento`) |
| `permisos_rutas` | objeto \| null | no | Claves que existan en `ROUTE_PERMISSIONS` (si no, 400 con la lista de válidas) y valores `full`/`read`/`limited` |

Además se fijan `permisos: PERMISOS_DEFAULT` y `es_invitado: false` (lo que mira
la pantalla para distinguir altas manuales de invitaciones).

**Respuesta 201**: el usuario creado.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | El body no cumple el esquema | `{ "error": "Datos inválidos", "details": [<issues de zod>] }` |
| 409 | Ya existe ese correo (chequeo previo o P2002 en una carrera) | `{ "error": "Correo duplicado", "message": "Ya existe un usuario registrado con el correo \"x\"." }` |
| 500 | Cualquier otro fallo, incluido un `role` fuera del enum | `{ "error": "No se pudo crear el usuario" }` |

### `GET /api/usuarios` y `GET /api/usuarios/:id`

El listado devuelve todos los usuarios (activos e inactivos) ordenados por
`nombre`. La ficha responde 404 `{ "error": "Usuario no encontrado" }`; un id que no
es UUID hace fallar a Prisma con 500.

### `PUT /api/usuarios/:id`

**Body** (`updateUsuarioSchema`; todo opcional, solo cambia lo que llega)

| Campo | Tipo | Notas |
|---|---|---|
| `nombre` | string | Mínimo 2 |
| `telefono` | string | |
| `correo` | string (email) | **No** se normaliza, a diferencia del alta |
| `role` | string | Igual que en el alta: tiene que ser del enum |
| `cargo` | string \| null | |
| `area` | string[] | Valores de `AREAS` |
| `activo` | boolean | `false` cierra todas sus sesiones |
| `permisos_rutas` | objeto \| null | Igual que en el alta; `null` o `{}` quitan la lista blanca |

Siempre pone `updated_at` a ahora. Efectos: tocar `permisos_rutas` invalida su
caché; tocar `area`, `role` o `activo` vacía la caché de sesiones; `activo: false`
cierra sus sesiones (`SesionesService.cerrarTodas`), sin evento de socket.

**Respuesta 200**: el usuario. **Errores**: el controlador no captura nada, así
que un body inválido (zod), un id inexistente (P2025), un correo repetido (P2002)
o un `role` fuera del enum salen como 500 con el formato por defecto de Fastify.

### `PATCH /api/usuarios/:id/activo`

**Body**: `{ "activo": boolean }` (sin validar). Pasa por el mismo `update` que el
`PUT`. Si `activo` es falso, además cierra todas sus sesiones y emite
`usuario-deshabilitado` con `{ usuarioId }` a **todos** los sockets conectados
(`io.emit`). Responde el usuario.

### `PATCH /api/usuarios/:id/permisos`

**Body**: `{ "permisos": { "<clave>": boolean } }` (`updatePermisosSchema`).
**Reemplaza** el JSON entero (no mezcla: una clave que no se mande, como
`bonos-planilla`, se pierde) y no toca `updated_at`. Vacía la caché de sesiones.
Responde el usuario. Body inválido o id inexistente: 500 (formato de Fastify).

### `POST /api/usuarios/permisos/bonos-planilla`

Concede o quita el permiso individual `bonos-planilla`, que es independiente del
área.

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `userIds` | string[] (UUID) | sí | Al menos uno. Los que no existen se ignoran |
| `granted` | boolean | sí | |

Mezcla `'bonos-planilla': granted` en el `permisos` de cada usuario sin perder
las demás claves; también actualiza a los desactivados. Vacía la caché de
sesiones (el middleware lee `permisos` de la sesión).

**Respuesta 200**: `{ "success": true, "updated": [{ "id", "nombre", "correo", "permisos" }], "granted": true }`.

**Errores**: 400 `{ "error": "Datos inválidos", "details": [...] }`; 500
`{ "error": "<mensaje>" }`.

### `POST /api/usuarios/:id/firma` y `DELETE /api/usuarios/:id/firma`

`POST` recibe `multipart/form-data` (primer archivo, sin validar tipo), lo sube a
S3 como `firmas/<id>.<ext>` y borra la anterior. Responde
`{ "success": true, "data": { "id", "nombre", "cargo", "firma_url" } }` (sin URL
firmada). `DELETE` borra el objeto (ignorando fallos de S3) y pone `firma_url` en
`null`: `{ "success": true }`. Ambos: 404 `{ "error": "Usuario no encontrado" }`;
`POST` sin archivo, 400 `{ "error": "No se envió ningún archivo" }`; sin multipart,
406 de `@fastify/multipart`.

### `GET /api/usuarios/firmantes`

Usuarios con firma, para los documentos que la llevan:
`[{ "id", "nombre", "cargo", "firma_url", "firma_signed_url" }]`, con URL firmada
de S3 válida **24 horas** (`null` si no se pudo firmar).

### `GET /api/usuarios/presencia` y `GET /api/usuarios/online-ids`

`presencia` devuelve el mismo listado que `GET /api/usuarios` con
`en_linea: boolean`; `online-ids`, un arreglo de ids. Los dos salen de
`getOnlineUserIds()`: los usuarios que anunciaron presencia por socket en este
proceso (ver [tiempo real](../tiempo-real.md)).

### `GET /api/conductores/basicos`

Pretende listar `{ id, nombre, correo, telefono, conductores: [{ id, numero_identificacion, estado }] }`
de los usuarios con rol `CONDUCTOR`. Responde siempre 500: ver Observaciones.

## Efectos

- Sesiones: `PUT` con `activo: false` y `PATCH …/activo` cierran todas las del
  usuario; solo el `PATCH` emite `usuario-deshabilitado`.
- Cachés: `invalidarPermisosRutas` (`src/services/permisos-rutas.service.ts`) y
  `olvidarSesionesEnCache` (`src/middlewares/cache-sesiones.ts`).
- S3: `firmas/<id>.<ext>`.
- `registro_actividad`: todas las escrituras quedan registradas en el módulo
  `usuarios`, con frases propias para permisos, activación, bonos de planilla y
  firma (ver [actividad](./actividad.md)).

## Observaciones

- Las rutas usan `sesiones` y el asistente usa `usuarios`: con una lista blanca
  que tenga uno y no el otro, la pantalla y el asistente discrepan
  (`permissions.middleware.ts`).
- **Los errores del `PUT` y del `PATCH …/permisos` salen como 500**: `parse` de zod
  sin captura, id inexistente, correo repetido o `role` inválido
  (`usuarios.controller.ts`).
- **`PATCH …/activo` no valida el body.** Sin `activo` (o con `null`, `0`, `""`),
  el usuario sigue activo, pero el controlador cierra todas sus sesiones y emite
  `usuario-deshabilitado` igual (`if (!activo)`). Un `"false"` en texto llega a
  Prisma y responde 500.
- `usuario-deshabilitado` se emite a todos los clientes conectados, no al room del
  usuario: cualquiera con el panel abierto se entera de a quién se desactivó.
- **`GET /api/conductores/basicos` no funciona**: filtra por `role: 'CONDUCTOR'`,
  que no es un valor de `enum_users_role`, y por `deletedAt`, que `usuarios` no
  tiene. El `// @ts-nocheck` de `usuarios.service.ts` lo esconde y Prisma lo
  rechaza en cada llamada. Su consumidor (`src/lib/stores/servicios.ts` del
  frontend) además espera `{ success, data }` y la ruta devuelve un arreglo.
- El `PUT` guarda el correo sin pasarlo a minúsculas, al revés que el alta: ver
  la observación sobre correos en [auth](./auth.md#observaciones).
- `GET /api/usuarios/firmantes` entrega a cualquier usuario con sesión (también a
  la app de administrativos) la firma de todos, con URL válida 24 horas.
- Las subidas de firma no validan tipo de archivo; el tope es el global de
  multipart (200 MB).
