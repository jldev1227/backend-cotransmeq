# Municipios

`/api/municipios` · código en [`src/modules/municipios/`](../../src/modules/municipios/) · sin permiso de módulo: es pública

Catálogo de departamentos y municipios de Colombia (códigos DANE, tipo y
coordenadas) en la tabla `municipios`. Es lo que referencian el origen y el
destino de un servicio (`origen_id`, `destino_id`), los lugares propios
(`custom-places`) y los siniestros PESV. La API solo lo lee: el servicio tiene
funciones de alta, edición y borrado, pero ninguna ruta las expone.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `pública`: el plugin no registra `authMiddleware` ni otra guarda, y `municipios` no está en `ROUTE_PERMISSIONS` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/municipios` | pública | Todos los municipios |
| GET | `/api/municipios/buscar` | pública | Búsqueda paginada |
| GET | `/api/municipios/departamento/:codigoDepartamento` | pública | Municipios de un departamento |
| GET | `/api/municipios/:id` | pública | Un municipio (hoy siempre falla, ver Observaciones) |

Los errores de los controladores tienen la forma `{ error: '<mensaje>' }`.

### `GET /api/municipios`

**Respuesta 200**: arreglo plano (sin envoltorio), por departamento y luego por
nombre. El esquema de respuesta deja solo estos campos y convierte las
coordenadas a número:

```json
[ { "id": "uuid", "codigo_departamento": 0, "nombre_departamento": "…",
    "codigo_municipio": 0, "nombre_municipio": "…", "tipo": "Municipio",
    "longitud": 0.0, "latitud": 0.0 } ]
```

**500** `{ error: 'Error al obtener municipios' }`.

### `GET /api/municipios/buscar`

**Query** (validada por el esquema JSON de Fastify: **400** con su formato si no
cumple)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `nombre` | string | — | Nombre del municipio (contiene, sin distinguir mayúsculas) |
| `departamento` | string | — | Nombre del departamento (ídem) |
| `tipo` | `Municipio` \| `Área no municipalizada` | — | Igualdad |
| `codigo_departamento` | number | — | |
| `page` | number ≥ 1 | `1` | |
| `limit` | number 1–100 | `20` | |

**Respuesta 200**

```json
{ "municipios": [ { "id": "uuid", "nombre_municipio": "…", "latitud": "0.000000", "longitud": "0.000000",
                    "created_at": "…", "updated_at": "…", "…": "…" } ],
  "pagination": { "page": 1, "limit": 20, "total": 19, "totalPages": 1 } }
```

Aquí van las filas completas y las coordenadas llegan como texto (`Decimal`).
**500** `{ error: 'Error al buscar municipios' }`.

### `GET /api/municipios/departamento/:codigoDepartamento`

Arreglo plano con las filas completas del departamento, por nombre.
**400** `{ error: 'Código de departamento inválido' }` si el código no es
numérico; **500** `{ error: 'Error al obtener municipios por departamento' }`.

### `GET /api/municipios/:id`

`:id` es un uuid (lo valida el esquema de Fastify). Debería devolver el
municipio con sus diez últimos servicios de origen y de destino, o **404**
`{ error: 'Municipio no encontrado' }`; hoy responde siempre **500**
`{ error: 'Error al obtener municipio' }`.

## Observaciones

- **`GET /:id` no funciona nunca.** `findById` incluye las relaciones
  `serviciosOrigen` y `serviciosDestino`, que no existen en el modelo (se
  llaman `servicios_servicio_origen_idTomunicipios` y
  `servicios_servicio_destino_idTomunicipios`); Prisma rechaza la consulta y el
  controlador la convierte en 500 (`municipios.service.ts`, con
  `// @ts-nocheck`).
- Todo el módulo es público y sin límite de intentos. El catálogo no tiene
  datos personales, pero `GET /api/municipios` devuelve la tabla entera en cada
  llamada.
- Las coordenadas cambian de tipo según la ruta: número en `GET /api/municipios`
  (por su esquema de respuesta) y texto en `/buscar` y `/departamento/…`.
- El esquema zod `buscarMunicipiosSchema` no se usa: la query la valida solo el
  esquema JSON de la ruta, y los dos describen `tipo` con valores distintos.
