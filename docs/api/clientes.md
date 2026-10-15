# Clientes

`/api/clientes` y `/api/empresas` · código en [`src/modules/clientes/`](../../src/modules/clientes/) · permiso [`clientes`](../permisos.md#catálogo-de-módulos) para escribir

Los clientes son las empresas y personas naturales a las que se presta el
servicio. El modelo es `clientes`, pero la tabla se llama `empresas`, y por eso
el resto del sistema los nombra de las dos formas (`cliente_id` en servicios,
`empresa_id` en planillas de recargos). Es de las pocas tablas con columnas en
camelCase: `createdAt`, `updatedAt` y `deletedAt`.

- `tipo` es `EMPRESA` (exige NIT) o `PERSONA_NATURAL` (exige cédula). `PERSONA`
  se sigue aceptando por compatibilidad y se guarda como `PERSONA_NATURAL`.
- `oculto` saca al cliente de los listados, pero los selectores (servicios,
  recargos, `GET /api/empresas/basicos`) lo siguen ofreciendo.
- Eliminar es borrado lógico (`deletedAt`) y manda a la papelera; el borrado
  definitivo solo se permite desde la papelera y si el cliente no tiene
  historial.
- `requiere_osi` y `paga_recargos` son banderas de negocio que leen otros
  módulos.
- `municipio_sede` y `departamento_sede` ubican la sede principal para medir
  cobertura sin inferirla de la dirección libre.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | sin permiso de módulo |
| `POST`, `PUT`, `PATCH`, `DELETE` | `clientes:full` (`puedeEscribir`). `clientes` es `general: true`: lo tiene cualquier usuario del equipo, salvo que su lista blanca `permisos_rutas` lo excluya |
| `GET /clientes/ocultos`, `GET /clientes/papelera`, `PATCH /clientes/:id/ocultar`, `POST /clientes/masivo` | además, chequeo en el controlador: `role === 'admin'` o área `operaciones` o `talento_humano`; si no, **403** `{ success: false, message }` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/empresas/basicos` | sesión | Lista básica de clientes para selectores |
| GET | `/api/empresas` | sesión | Alias de la anterior |
| GET | `/api/clientes` | sesión | Lista paginada, sin ocultos por defecto |
| GET | `/api/clientes/buscar` | sesión | Búsqueda paginada por filtros |
| GET | `/api/clientes/ocultos` | sesión + rol o área | Clientes ocultos |
| GET | `/api/clientes/papelera` | sesión + rol o área | Clientes eliminados |
| GET | `/api/clientes/:id` | sesión | Detalle con su actividad reciente |
| GET | `/api/clientes/:id/stats` | sesión | Estadísticas (hoy en cero) |
| POST | `/api/clientes` | `clientes:full` | Crea un cliente |
| PUT | `/api/clientes/:id` | `clientes:full` | Edita un cliente |
| DELETE | `/api/clientes/:id` | `clientes:full` | Lo manda a la papelera |
| POST | `/api/clientes/:id/restore` | `clientes:full` | Lo saca de la papelera |
| DELETE | `/api/clientes/:id/permanente` | `clientes:full` | Borrado definitivo desde la papelera |
| PATCH | `/api/clientes/:id/ocultar` | `clientes:full` + rol o área | Oculta o muestra |
| POST | `/api/clientes/masivo` | `clientes:full` + rol o área | Ocultar, mostrar, eliminar o restaurar en lote |

Las rutas con esquema JSON de Fastify validan solas y responden **400** con el
formato por defecto; los `:id` declaran `format: 'uuid'`.

### `GET /api/empresas/basicos` · `GET /api/empresas`

`{ success: true, data: [{ id, nit, nombre, tipo, telefono, correo, requiere_osi, oculto }], count }`
con todos los no eliminados, ocultos incluidos, por nombre.

### `GET /api/clientes`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page`, `limit` | string numérico | `1`, `10` | Sin tope para `limit` |
| `tipo` | `EMPRESA` \| `PERSONA_NATURAL` \| `TODOS` | — | |
| `search` | string | — | Nombre, NIT, representante, cédula, teléfono, correo o dirección (contiene, sin distinguir mayúsculas) |
| `orden` | `asc` \| `desc` | `asc` | Por nombre |
| `incluir_ocultos` | `'true'` \| `'false'` | `'false'` | |

**Respuesta 200**

```json
{ "success": true, "message": "Clientes obtenidos exitosamente",
  "data": [ { "id": "uuid", "tipo": "EMPRESA", "nombre": "…", "nit": "…", "correo": "…", "oculto": false,
              "requiere_osi": false, "paga_recargos": true, "createdAt": "…", "updatedAt": "…", "deletedAt": null,
              "_count": { "recargos": 3, "pernotes": 0, "servicio": 40 } } ],
  "pagination": { "page": 1, "limit": 10, "total": 57, "pages": 6, "hasNext": true, "hasPrev": false } }
```

### `GET /api/clientes/buscar`

**Query**: `tipo` (`EMPRESA`, `PERSONA_NATURAL` o `PERSONA`), `requiere_osi`,
`paga_recargos` (ver Observaciones), `search` (nombre, NIT, representante,
cédula o correo), `page` y `limit` (máximo 100; por defecto 1 y 20). Orden:
`createdAt` descendente. Misma forma de respuesta que el listado (sin
`_count.servicio`).

### `GET /api/clientes/ocultos` · `GET /api/clientes/papelera`

**Query**: `page`, `limit`, `tipo`, `search`. `ocultos` lista los no eliminados
con `oculto = true` (por `updatedAt` descendente); `papelera`, los eliminados
(por `deletedAt` descendente).

- `papelera`: `{ success, message: 'Papelera de clientes', data, pagination: { page, limit, total, pages } }`.
- `ocultos`: `{ success, message, data }`. El esquema de respuesta recorta la
  paginación (ver Observaciones). **500** `{ success: false, message, error }`.

### `GET /api/clientes/:id`

`{ success, message, data }` con el cliente no eliminado, sus últimos cinco
recargos (tabla `recargos`) y pernoctes activos, sus últimos cinco servicios
(con conductor, vehículo y municipios) y `_count`. **404**
`{ success: false, message: 'Cliente no encontrado' }`.

### `GET /api/clientes/:id/stats`

`{ success, message, data: { cliente, stats: { recargos: { count: 0, total: 0 }, pernotes: { count: 0, total: 0 } } } }`.
El cálculo está desactivado en `cliente.service.ts`: los contadores salen
siempre en cero. **404** si no existe.

### `POST /api/clientes`

**Body** (esquema JSON de Fastify y después zod `createClienteSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `nombre` | string | sí | |
| `tipo` | `EMPRESA` \| `PERSONA_NATURAL` \| `PERSONA` | no | `EMPRESA` por defecto |
| `nit` | string \| `null` | si es empresa | |
| `cedula` | string \| `null` | si es persona natural | |
| `representante`, `telefono`, `direccion` | string \| `null` | no | |
| `correo` | email \| `null` | no | |
| `requiere_osi`, `paga_recargos` | boolean | no | `false` por defecto |

**Respuesta 201**: `{ success: true, message: 'Cliente creado exitosamente', data }`
con `_count`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta `nombre`, tipo fuera del enum o correo mal formado (esquema de Fastify) | formato de Fastify |
| 409 | Otro cliente no eliminado tiene ese NIT o ese correo | `{ success: false, message: 'Ya existe un cliente con este NIT' }` (o «… correo») |
| 500 | Empresa sin NIT o persona sin cédula (regla de zod) y cualquier otro fallo | formato de Fastify |

### `PUT /api/clientes/:id`

Mismos campos, todos opcionales; solo se cambia lo que llega. Cambiar NIT o
correo pasa por la misma comprobación de duplicados (**409**). **404** si no
existe o está eliminado. **Respuesta 200**: `{ success, message, data }`.

### `DELETE /api/clientes/:id` · `POST /api/clientes/:id/restore`

`DELETE` marca `deletedAt` y responde `{ success, message, data }` con el
cliente; **404** si no existe o ya estaba eliminado. `restore` lo quita;
**404** si no existe, **400** `{ success: false, message: 'El cliente no está eliminado' }`.

### `DELETE /api/clientes/:id/permanente`

Borra la fila. Solo para clientes de la papelera y sin historial: un cliente
con servicios, liquidaciones, recargos, planillas, pernoctes, tarifas o salidas
no conformes es parte de la contabilidad.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 200 | Borrado | `{ success: true, message: 'Cliente eliminado definitivamente' }` |
| 400 | No está en la papelera | `{ success: false, message }` |
| 404 | No existe | `{ success: false, message: 'Cliente no encontrado' }` |
| 409 | Tiene historial | `{ success: false, message, bloqueantes: { servicios, liquidaciones, recargos, planillas, pernotes, tarifas, salidas } }` |

Hoy no llega a responder 409 ni 200 (ver Observaciones).

### `PATCH /api/clientes/:id/ocultar`

**Body**: `oculto` (boolean, obligatorio). **Respuesta 200**
`{ success, message, data }`, con `data` vacío por el esquema de respuesta.
**404** `{ success: false, message: 'Cliente no encontrado' }`; **500**
`{ success: false, message, error }`.

### `POST /api/clientes/masivo`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `ids` | uuid[] | sí | Vacío: 400 `{ success: false, message: 'Se requieren IDs para la operación masiva' }` |
| `accion` | `ocultar` \| `mostrar` \| `eliminar` \| `restaurar` | sí | |

**Respuesta 200**: `{ success, message: '<n> clientes …', data: { count } }`.
`restaurar` solo toca los eliminados; las otras tres, todos los ids recibidos.
**500** `{ success: false, message: 'Error en operación masiva', error }`.

## Efectos

Socket.IO a todos los conectados (`clientes.events.ts` y el controlador). Los
nombres de alta, edición y borrado son los que ya escuchaba
`/dashboard/clientes`, en inglés a diferencia de los de servicios. Ver
[tiempo-real](../tiempo-real.md).

| Evento | Lo emite | Payload |
|---|---|---|
| `cliente:created` | `POST` | el cliente |
| `cliente:updated` | `PUT` | el cliente |
| `cliente:deleted` | `DELETE /:id` y `DELETE /:id/permanente` | `{ id }` |
| `cliente:oculto` | `PATCH /:id/ocultar` | `{ id, oculto, nombre }` |
| `clientes:actualizacion-masiva` | `POST /masivo` | `{ accion, count }` |

`POST /:id/restore` no emite nada.

## Observaciones

- **El borrado definitivo está roto.** `eliminarPermanente` cuenta `recargos`,
  `recargos_planillas` y `pernotes` por `cliente_id`, pero esas tablas lo
  llaman `empresa_id`. Prisma rechaza la consulta y, para un cliente que sí
  está en la papelera, la ruta responde siempre 500
  (`cliente.service.ts`, que lleva `// @ts-nocheck`).
- **Validaciones que salen como 500.** Los errores de zod no se capturan:
  empresa sin NIT, persona sin cédula, o un `limit` mayor de 100 en `/buscar`.
- **NIT y correo son únicos en toda la tabla**, papelera incluida, pero la
  comprobación de duplicados solo mira los no eliminados: el NIT o el correo de
  un cliente de la papelera pasan la comprobación y fallan en la base con 500.
- `GET /buscar` convierte `requiere_osi` y `paga_recargos` ausentes en `false`
  y filtra por ellos: sin pasarlos, solo devuelve clientes con las dos banderas
  en `false`.
- **El esquema de respuesta recorta datos.** `GET /ocultos` declara `total`
  (que el servicio no envía) y no `pagination`, así que la respuesta llega sin
  paginación; `PATCH /:id/ocultar` declara `data` como objeto sin propiedades y
  lo serializa vacío (`{}`).
- El chequeo de rol del controlador no reconoce el área `administracion` (solo
  `role === 'admin'`), y `DELETE /:id` no lo tiene mientras que `masivo` con
  `eliminar` sí.
- `correo: ''` lo rechaza el esquema de Fastify (`format: 'email'`) antes de
  que zod lo convierta en «sin correo», como pretende `cliente.schema.ts`.
- `GET /:id` incluye servicios eliminados (el `include` no filtra
  `deleted_at`).
