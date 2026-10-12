# Terceros

`/api/terceros` · código en [`src/modules/terceros/`](../../src/modules/terceros/) · permiso [`terceros`](../permisos.md#catálogo-de-módulos) para escribir

Directorio de terceros (tabla `terceros`): propietarios de vehículos, proveedores y
empresas a los que se refieren las liquidaciones de terceros, los certificados
tributarios y otros módulos. Campos: `nombre_completo` (se guarda en MAYÚSCULAS),
`identificacion` (única en la base), `telefono`, `correo`, `direccion`,
`tipo_persona` (`PERSONA`, `EMPRESA`, `PROPIETARIO_VEHICULO`, `PROVEEDOR`),
`regimen` (`SIMPLIFICADO`, `COMUN`, `GRAN_CONTRIBUYENTE`, `NO_RESPONSABLE`,
`AUTORRETENEDOR`, `ORDINARIO`), `notas` y `activo` (esta API no lo escribe). El
borrado es lógico (`deleted_at`) y todas las lecturas lo filtran.

La identificación se compara **tal cual**, sin quitar prefijos (`CC`, `NIT`),
puntos ni espacios: el duplicado solo se detecta si el texto es idéntico. El
propietario que figura en la ficha de un vehículo (`vehiculos.propietario_nombre` y
`propietario_identificacion`) es texto libre, no una FK a esta tabla;
`POST /api/terceros/importar-vehiculos` crea terceros a partir de ese texto.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo, a propósito: exigir `read` dejaría fuera a quien tiene `limited` (comentario en `terceros.routes.ts`) |
| `POST`, `PUT`, `DELETE` | `terceros:full` (`preHandler` en `puedeEscribir`): administración, contabilidad, talento humano, facturación y operaciones; HSEQ y mantenimiento no |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/terceros` | sesión | Lista paginada con filtros, orden y conteos |
| GET | `/api/terceros/buscar` | sesión | Autocompletar (hasta 20) |
| GET | `/api/terceros/:id` | sesión | Un tercero |
| POST | `/api/terceros` | `terceros:full` | Crea un tercero |
| PUT | `/api/terceros/:id` | `terceros:full` | Edita un tercero |
| DELETE | `/api/terceros/:id` | `terceros:full` | Borrado lógico |
| POST | `/api/terceros/importar-vehiculos` | `terceros:full` | Crea terceros a partir de los propietarios de los vehículos |

Las rutas con `:id` validan el parámetro con el esquema JSON de Fastify
(`format: 'uuid'`): un id mal formado responde 400 con el formato de Fastify.

### `GET /api/terceros`

**Query** (esquema JSON de la ruta para los cuatro primeros; los de orden se leen
aunque no estén declarados)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | número | `1` | |
| `limit` | número | `20` | Sin tope |
| `tipo_persona` | `PERSONA` \| `EMPRESA` \| `TODOS` | todos | Otro valor → 400 del esquema |
| `search` | string | — | Contiene, sin distinguir mayúsculas, en nombre, identificación, teléfono, correo o dirección |
| `sortBy` | string | `nombre_completo` | `nombre_completo`, `identificacion`, `tipo_persona`, `regimen`, `telefono` o `correo`; otro valor usa el defecto |
| `sortOrder` | `asc` \| `desc` | `asc` | |

**Respuesta 200**

```json
{ "success": true, "message": "Terceros obtenidos exitosamente",
  "data": [ { "id": "uuid", "nombre_completo": "…", "identificacion": "…", "telefono": "…", "correo": "…",
              "direccion": "…", "tipo_persona": "PERSONA", "regimen": null, "notas": null, "activo": true,
              "created_at": "…", "updated_at": "…", "deleted_at": null } ],
  "pagination": { "page": 1, "limit": 20, "total": 134, "pages": 7, "hasNext": true, "hasPrev": false },
  "counts": { "total": 150, "personas": 120, "empresas": 25 } }
```

`counts` ignora la búsqueda y el filtro: son los totales de la tabla (sin borrados),
y solo de `PERSONA` y `EMPRESA`.

### `GET /api/terceros/buscar`

**Query**: `q` (texto; vacío o ausente devuelve los primeros 20).

**Respuesta 200** — `{ success, data: [{ id, nombre_completo, identificacion, tipo_persona }] }`:
hasta 20, por nombre, buscando `q` en nombre o identificación.

### `GET /api/terceros/:id`

**Respuesta 200** — `{ success, data }` con el tercero. 404
`{ success: false, message: 'Tercero no encontrado' }` si no existe o está borrado.

### `POST /api/terceros`

**Body** (zod `createTerceroSchema` en `tercero.schema.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre_completo` | string | sí | Se guarda en MAYÚSCULAS |
| `identificacion` | string \| null | no | Si llega, no puede repetirse entre los terceros vivos |
| `telefono`, `direccion`, `notas` | string \| null | no | |
| `correo` | email \| null | no | |
| `tipo_persona` | enum | no | `PERSONA` por defecto |
| `regimen` | enum \| null | no | |

**Respuesta 201** — `{ success, message, data }` con el tercero creado.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 409 | Identificación repetida en un tercero vivo | `{ "success": false, "message": "Ya existe un tercero con esta identificación" }` |
| 500 | Rechazo de zod, identificación de un tercero borrado (ver Observaciones) y cualquier otro fallo | formato de Fastify (`{ statusCode, error, message }`) |

### `PUT /api/terceros/:id`

Mismos campos, todos opcionales (`updateTerceroSchema`); solo cambia lo que llega
(`tipo_persona` no vuelve a `PERSONA` si no se manda). `nombre_completo` se pasa a
mayúsculas. La identificación se comprueba contra los demás terceros vivos.

**Respuesta 200** — `{ success, message, data }`. **Errores**: 404
`Tercero no encontrado`; 409 identificación repetida; 500 como en el alta.

### `DELETE /api/terceros/:id`

Borrado lógico (`deleted_at`). No comprueba si el tercero está en liquidaciones o
certificados. Responde `{ success, message }`; 404 `Tercero no encontrado`.

### `POST /api/terceros/importar-vehiculos`

Sin body. Recorre los vehículos no eliminados con `propietario_nombre`, uno por
`propietario_identificacion` distinta, y crea un tercero `PERSONA` por cada
propietario que no exista ya entre los terceros vivos (por identificación si la
tiene; si no, por nombre exacto). Ignora nombres vacíos o `NULL`; una
identificación `NULL` en texto cuenta como ausente.

**Respuesta 200** — `{ success, message: "Importación completada: N nuevos, M ya existían", data: { importados, duplicados, total } }`
(`total` = vehículos considerados).

## Efectos

- **Registro de actividad**: hook global de [actividad](./actividad.md);
  `POST /api/terceros/importar-vehiculos` queda como «importó vehículos de terceros».

## Observaciones

- Los rechazos de zod en `POST` y `PUT` salen como **500** con el JSON de zod en
  `message`: los controladores relanzan todo lo que no es duplicado o «no
  encontrado» y no hay manejador de errores (`terceros.controller.ts`).
- `identificacion` es `@unique` en el esquema y ninguna migración de este repo la
  cambia por un índice parcial (`WHERE deleted_at IS NULL`), pero el servicio solo
  busca duplicados entre los vivos: crear o editar con la identificación de un
  tercero borrado pasa la comprobación y Prisma responde 500 (`P2002`). En la
  importación, eso corta el proceso a la mitad y deja creados los anteriores.
- La comprobación de duplicados compara el texto exacto: `CC 39949277` y
  `39949277` pasan como terceros distintos.
- El esquema de `GET /api/terceros` solo deja filtrar `PERSONA`, `EMPRESA` o
  `TODOS`: `PROPIETARIO_VEHICULO` y `PROVEEDOR` no se pueden filtrar (400), y
  `counts` tampoco los cuenta.
- `limit` no tiene tope en `GET /api/terceros`.
- `importar-vehiculos` crea todo como `PERSONA`, también las empresas, y su
  `distinct` por identificación agrupa en uno a todos los propietarios sin
  identificación: de ellos solo se considera el primero.
