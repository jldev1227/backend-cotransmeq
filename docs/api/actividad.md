# Actividad reciente

`/api/actividad` · código en [`src/modules/actividad/`](../../src/modules/actividad/) · permiso [`actividad`](../permisos.md#catálogo-de-módulos) (general)

«Qué hizo quién», para el panel de inicio y la página de actividad reciente. Las
filas de `registro_actividad` no las escribe ningún módulo: las escribe un hook
global `onSend` (`instalarRegistroActividad`, en `registro-actividad.service.ts`),
que `src/app.ts` instala antes de registrar las rutas. Este módulo solo las lee.

**Qué se registra.** Toda petición `POST`, `PUT`, `PATCH` o `DELETE` que responde
con estado menor que 400, hecha por un usuario autenticado (`request.user`, que
pone `authMiddleware`) y cuya ruta no está excluida. La escritura no se espera:
si falla, la petición ya respondió y solo queda un aviso en el log. Cada fila
guarda:

| Columna | Contenido |
|---|---|
| `usuario_id`, `usuario_nombre`, `usuario_areas` | Quién, con sus áreas **en ese momento** |
| `modulo` | Primer segmento de la ruta traducido a una clave de `ROUTE_PERMISSIONS` (`PREFIJO_MODULO`: `vehiculos` → `flota`, `invitaciones` → `usuarios`, `dashboard` → `conductores`…); `otros` si no está en el mapa |
| `accion` | `crear`, `editar`, `eliminar`, `restaurar`, `estado` u `otro`: la de una frase a medida (`FRASES`, la única fuente de `otro`) o deducida del método y la ruta (`DELETE` → `eliminar`; `/restore` o `/restaurar` → `restaurar`; `/estado`, `/cambiar-estado`, `/anular`, `/cancelar`, `/ocultar`, `/activo` → `estado`; `POST` → `crear`; lo demás → `editar`) |
| `metodo`, `ruta` | Método y **patrón** de la ruta (`/api/servicios/:id`), no la URL con ids |
| `recurso_id` | El `:id` (o `:formId`, `:liquidacion_id`, `:consecutivo`) de la ruta, o el `id` de la respuesta |
| `recurso_ref` | Lo que identifica el recurso para una persona (consecutivo, radicado, número de factura, placa, nombre…), tomado de la respuesta o del body |
| `descripcion` | Frase legible: «creó el cliente ACME», «cambió la activación del usuario Ana Pérez»; sin referencia conocida, el id corto («eliminó la sesión #1a2b3c4d»). En las de `accion: 'estado'` cuyo body trae `estado` se añade el estado nuevo en minúsculas |
| `detalle` | `{ estado?, cantidad? }`: el `estado`/`nuevo_estado` del body y el largo de `ids` |
| `ip` | `request.ip` |

**Qué no se registra** (`EXCLUIR_PREFIJOS` y `EXCLUIR_FRAGMENTOS`): sesión y
recuperación de contraseña (`/api/auth`), rutas públicas y del portal del
conductor, el asistente y el MCP, notificaciones, tokens personales, el canje y
los dispositivos de la app móvil, PDF y desprendibles, la aceptación de
invitaciones, borradores y autoguardados, los crons por HTTP, la propia
`/api/actividad`, y cualquier patrón con `/job/`, `-job/`, `/exportar`, `/export`,
`/chat/`, `/presign`, `/lookup`, `/validate` o `/cron-hora`. Son lecturas
disfrazadas de `POST` o ruido.

**Quién ve qué** (`visibilidadActividad`): `role: 'admin'` ve todo; los demás ven
lo que hizo la gente que comparte alguna de sus áreas (`usuario_areas` con
`hasSome`) y lo suyo; un usuario sin área solo se ve a sí mismo. Es el rol, no el
área `administracion`, lo que da la vista completa.

## Acceso

| Rutas | Guarda |
|---|---|
| Las dos | `actividad:read` (`onRequest: authMiddleware` + `preHandler: requirePermission('actividad')`). `actividad` es `general: true`: entra cualquiera con sesión, salvo quien tenga lista blanca sin `actividad` (con `read` o más) |
| Filas | la consulta se restringe siempre con `visibilidadActividad`; los filtros solo acotan dentro de eso |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/actividad` | `actividad:read` | Registro paginado y filtrable |
| GET | `/api/actividad/opciones` | `actividad:read` | Usuarios y módulos para los filtros (últimos 90 días) |

### `GET /api/actividad`

**Query** (zod)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `limit` | entero 1-100 | 15 | Filas por página |
| `pagina` | entero ≥ 1 | 1 | |
| `area` | string ≤ 40 | — | Filas cuyo `usuario_areas` contiene esa área |
| `usuario_id` | UUID | — | Solo ese usuario |
| `modulo` | string ≤ 60 | — | Clave de módulo (`servicios`, `nomina`, `otros`…) |
| `accion` | string ≤ 20 | — | `crear`, `editar`, `eliminar`, `restaurar`, `estado`, `otro` |
| `q` | string ≤ 120 | — | Busca sin distinguir mayúsculas en `descripcion`, `usuario_nombre` y `recurso_ref` |
| `desde` | `YYYY-MM-DD` | — | Desde las 00:00 de ese día en Bogotá |
| `hasta` | `YYYY-MM-DD` | — | Hasta el final de ese día en Bogotá (inclusive) |

**Respuesta 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "uuid", "usuario_id": "uuid", "usuario_nombre": "…", "usuario_areas": ["administracion"],
      "modulo": "usuarios", "accion": "estado", "recurso_id": "uuid", "recurso_ref": "Ana Pérez",
      "descripcion": "cambió la activación del usuario Ana Pérez", "detalle": null, "created_at": "…"
    }
  ],
  "meta": { "total": 240, "pagina": 1, "limit": 15, "totalPages": 16 }
}
```

Orden por `created_at` descendente. No devuelve `metodo`, `ruta` ni `ip`.

**Errores**: 400 `{ "success": false, "message": "Parámetros inválidos", "details": <error.flatten()> }`.

### `GET /api/actividad/opciones`

Agrupa lo que el usuario puede ver de los últimos 90 días.

**Respuesta 200**

```json
{
  "success": true,
  "data": {
    "usuarios": [{ "id": "uuid", "nombre": "…", "registros": 31 }],
    "modulos": [{ "id": "servicios", "registros": 120 }],
    "areas": ["operaciones"]
  }
}
```

`areas` es `null` para `role: 'admin'` y, para los demás, sus propias áreas.

## Observaciones

- **Lo que se hace por el asistente o el MCP no queda registrado.** Las
  herramientas que escriben (crear servicios, planillas, recorridos, acciones
  correctivas, duplicar liquidaciones) llaman a los servicios directamente, sin
  pasar por las rutas HTTP de su módulo, y `/api/asistente` y `/api/mcp` están
  excluidas del hook (ver [asistente](./asistente.md)).
- El hook solo mira el código de estado: una escritura que responde 200 con
  `success: false` se registra como hecha.
- Las frases genéricas pueden engañar: `DELETE /api/invitaciones/:id` (revocar una
  invitación) queda como «eliminó el usuario #xxxxxxxx», porque `invitaciones` se
  mapea al módulo `usuarios` y no tiene frase propia.
- `ip` se guarda con `request.ip`, que detrás de Cloudflare y el túnel es la del
  proxy, no la del usuario (no usa `ipCliente()` de `src/utils/limitador.ts`). La
  API no la devuelve.
