# Lugares propios

`/api/custom-places` · código en [`src/modules/custom-places/`](../../src/modules/custom-places/) · sin permiso de módulo propio; editar y borrar piden ser el autor o [`servicios`](../permisos.md#catálogo-de-módulos) `full`

Sitios de la operación que no están en los buscadores de direcciones (pozos,
campamentos, patios, veredas, fincas, bases, estaciones) con sus coordenadas,
en la tabla `custom_places`. Los consume el autocompletado de origen y destino
de los servicios: en la app móvil a través de [maps](./maps.md), y en la web a
través del proxy de SvelteKit (`/api/maps/custom-place`), que reenvía el token
del usuario.

- `categoria` es `POZO`, `CAMPAMENTO`, `PATIO`, `VEREDA`, `FINCA`, `BASE`,
  `ESTACION`, `OTRO` o nula.
- Las coordenadas se redondean a seis decimales al guardar.
- `veces_usado` sube cada vez que alguien abre el lugar por id (para elegirlo
  en un servicio) y ordena las búsquedas.
- Borrar es lógico: `activo = false` y `deleted_at`.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET`, `POST` | sin más: cualquiera del equipo busca y registra lugares |
| `PATCH`, `DELETE` | `autorOGestor`: pasa quien creó el lugar (`creado_por_id`); si no, `servicios:full`. Antes cualquier sesión podía renombrar o borrar los lugares de todos |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/custom-places` | sesión | Busca lugares por nombre y categoría |
| POST | `/api/custom-places` | sesión | Registra un lugar |
| GET | `/api/custom-places/:id` | sesión | Un lugar, listo para guardarlo en un servicio |
| PATCH | `/api/custom-places/:id` | autor o `servicios:full` | Edita un lugar |
| DELETE | `/api/custom-places/:id` | autor o `servicios:full` | Retira un lugar |

### Forma de un lugar en búsquedas

Las búsquedas y la lectura por id devuelven la misma forma que los resultados
de HERE en [maps](./maps.md), para que el cliente los mezcle sin traducir:

```json
{ "id": "local:cp:<uuid>", "_id": "<uuid>", "nombre": "…", "title": "…",
  "categoria": "POZO", "descripcion": "…", "subtitle": "POZO · <dirección>", "address": "<dirección>",
  "latitud": 5.012345, "longitud": -72.654321, "veces_usado": 14, "source": "local" }
```

`subtitle` es la categoría y la dirección; `address`, la dirección o, si no hay,
el nombre.

### `GET /api/custom-places`

**Query** (zod `searchCustomPlaceSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string 1–255 | — | Nombre (contiene, sin distinguir mayúsculas) |
| `categoria` | enum | — | |
| `limit` | entero 1–50 | `10` | |

**Respuesta 200**: `{ results: [<lugar>] }` con los activos, por `veces_usado`
descendente y luego por nombre. **400** `{ error: 'Parámetros inválidos', details }`
(`details` es el `flatten()` de zod).

### `POST /api/custom-places`

**Body** (zod `createCustomPlaceSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string 2–255 | sí | |
| `latitud` | number −90 a 90 | sí | Se redondea a seis decimales |
| `longitud` | number −180 a 180 | sí | Ídem |
| `categoria` | enum \| `null` | no | |
| `descripcion`, `direccion` | string ≤ 1000 \| `null` | no | |
| `municipio_id` | uuid \| `null` | no | |

**Respuesta 201**: `{ success: true, data }` con la fila tal como queda en la
base (no con la forma de búsqueda; las coordenadas llegan como texto
`Decimal`). **400** `{ error: 'Datos inválidos', details }`; **500**
`{ error: 'Error al crear lugar personalizado' }`.

### `GET /api/custom-places/:id`

`:id` es el uuid interno (sin el prefijo `local:cp:`). Devuelve el lugar con la
forma de búsqueda más `lat` y `lng`, y suma uno a `veces_usado` sin esperar.
**404** `{ error: 'Lugar personalizado no encontrado' }` si no existe, está
inactivo o retirado.

### `PATCH /api/custom-places/:id` · `DELETE /api/custom-places/:id`

`PATCH` recibe los campos del alta, todos opcionales, y responde
`{ success: true, data }` con la fila. `DELETE` marca `activo = false` y
`deleted_at` y responde igual. **400** `{ error: 'Datos inválidos', details }`;
**500** `{ error: 'Error al actualizar lugar personalizado' }` o
`{ error: 'Error al eliminar lugar personalizado' }`.

## Observaciones

- Un id inexistente en `PATCH` o `DELETE` responde 500, no 404 (Prisma no
  encuentra la fila y el controlador no lo distingue); y como no hay autor que
  comparar, antes exige `servicios:full`.
- `PATCH` y `DELETE` no miran `deleted_at`: un lugar retirado se puede editar o
  volver a retirar, aunque `GET /:id` lo trate como inexistente.
- `GET /:id` escribe en una lectura (sube `veces_usado`).
- El comentario de `CustomPlacesService.search` promete ordenar primero las
  coincidencias exactas y por prefijo; el código ordena solo por uso y nombre.
- Las respuestas mezclan dos formas: búsqueda y lectura por id con la forma de
  HERE; alta, edición y borrado con la fila cruda.
