# Mapas (autocompletado de lugares)

`/api/maps` · código en [`src/modules/maps/`](../../src/modules/maps/) · sin permiso de módulo: basta la sesión

Autocompletado de direcciones para el origen y el destino de los servicios en la
app móvil. Mezcla dos fuentes: primero los lugares propios de la operación
([custom-places](./custom-places.md): pozos, campamentos…) y después HERE
(`autocomplete` y `lookup` de `search.hereapi.com`, limitado a Colombia y en
español). La clave de HERE vive solo en el servidor (`HERE_MAPS_API_KEY` en
`src/config/env.ts`); sin ella se devuelven solo los lugares propios y un
mensaje de error que el cliente puede mostrar, y el campo sigue aceptando texto
libre.

La web no usa estas rutas: tiene su propio proxy en SvelteKit
(`src/routes/api/maps/*` del frontend), con la misma clave de HERE y Azure Maps
para la geocodificación inversa (`/api/maps/place`). Este módulo no usa Azure.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin): token del dashboard o de la app de administrativos |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/maps/autocomplete` | sesión | Sugerencias para un texto |
| GET | `/api/maps/lookup` | sesión | Coordenadas de una sugerencia |

### `GET /api/maps/autocomplete`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `q` | string | `''` | Se recorta a 120 caracteres. Con menos de 3, responde vacío sin consultar nada |
| `limit` | entero | `8` | Entre 1 y 15 |

**Respuesta 200** (siempre, aunque HERE falle)

```json
{ "results": [
    { "id": "local:cp:<uuid>", "title": "…", "subtitle": "POZO · <dirección>", "address": "…", "source": "local" },
    { "id": "here:af:street:…", "title": "…", "subtitle": "<ciudad>, <municipio>, Colombia", "address": "…", "source": "here" } ],
  "error": null }
```

Primero van los lugares propios (con el mismo `limit`) y después los de HERE;
si dos tienen el mismo título gana el propio. Se devuelven como mucho `limit`.
`error` es `'La búsqueda de direcciones no está configurada en el servidor.'`
sin clave, o `'No se pudo consultar el buscador de direcciones.'` si HERE falla
o tarda más de 8 s.

### `GET /api/maps/lookup`

**Query**: `id` (obligatorio), el de una sugerencia.

**Respuesta 200**: `{ id, title, address, city, lat, lng }`. Con un id
`local:cp:<uuid>` se resuelve contra los lugares propios (y suma un uso al
lugar); en ese caso `city` lleva la categoría y la dirección, no una ciudad.
Cualquier otro id se consulta en HERE.

**Errores** (cuerpo `{ error }`)

| Código | Cuándo |
|---|---|
| 400 | Falta `id` |
| 404 | El lugar propio no existe o está retirado, o HERE devuelve el sitio sin coordenadas |
| 502 | HERE falla o tarda más de 8 s |
| 503 | No hay `HERE_MAPS_API_KEY` |

## Observaciones

- No hay límite de intentos: cada llamada con tres o más caracteres consume
  cuota de HERE, y cualquier sesión del equipo puede gastarla.
- En `lookup` de un lugar propio, `city` repite la categoría y la dirección del
  lugar (`subtitle`), no una ciudad.
