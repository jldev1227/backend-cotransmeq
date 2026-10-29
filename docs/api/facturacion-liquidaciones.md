# Facturación de liquidaciones

`/api/facturacion-liquidaciones` · código en [`src/modules/facturacion-liquidaciones/`](../../src/modules/facturacion-liquidaciones/) · permiso [`liquidaciones-servicios`](../permisos.md#catálogo-de-módulos) (nivel `limited` basta para todo)

Registro de las facturas electrónicas que cobran las
[liquidaciones de servicios](./liquidaciones-servicios.md): cabecera
`factura_liquidacion_servicio` y pivote `factura_liquidacion_item` (una fila por
liquidación, con el `valor_liquidacion` con que se facturó). Es la puerta del área
de Facturación, que sobre las liquidaciones solo tiene `limited`: aquí registra,
asocia, quita y anula facturas, pero no edita liquidaciones. El cobro (abonos y
edades) vive en [cartera](./cartera.md).

Reglas del módulo:

- Solo se facturan liquidaciones en `LIQUIDADA` o `APROBADA` que no estén ya en
  otra factura **activa**. Al facturar pasan a `FACTURADA` (con
  `fecha_facturacion`) y queda una fila en su historial. La toma es un
  `updateMany` condicional dentro de la transacción, que hace de cerrojo: si dos
  sesiones facturan lo mismo a la vez, la segunda falla.
- `valor_total = Σ valor_liquidacion de los pivotes vivos + ajuste_valor`. Digitar
  el valor de la factura electrónica guarda la diferencia como `ajuste_valor`,
  así que asociar o quitar liquidaciones después conserva la corrección.
- Una factura activa se puede editar: consecutivo, observaciones, fecha de
  emisión, plazo y liquidaciones del lote. También se pueden agregar
  liquidaciones `LIQUIDADA` o `APROBADA` que no estén en otra factura activa;
  las que se quitan regresan a `APROBADA`.
- Condiciones de cobro: `fecha_emision` (por defecto hoy en Colombia), `plazo_dias`
  (30 por defecto, máximo 365) y `fecha_vencimiento`; si llega el vencimiento,
  manda él y el plazo se recalcula. Mismas reglas que cartera
  (`cartera.condiciones.ts`). Las fechas salen como `YYYY-MM-DD`.
- Al anular, el motivo define el destino: por defecto todas las liquidaciones
  asociadas quedan `APROBADA`; Facturación y Administración con permiso Completo
  también pueden elegir que algunas vuelvan a `LIQUIDADA` para corregirlas o
  marcar una como `ANULADA` por duplicidad.
  Una factura con abonos vivos no se anula. Eliminar es lógico y solo para anuladas; al eliminar, el número
  recibe el sufijo `_ELIMINADA` para poder reutilizarlo, y restaurar se lo quita.
- Quitar una liquidación de su factura **marca** el pivote (`deleted_at`): su
  unicidad `(factura_id, liquidacion_id)` es un índice parcial sobre filas vivas,
  así que puede volver a facturarse.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| Todas | `liquidaciones-servicios:limited` (`permisoPorMetodo` con `lectura` y `escritura` en `limited`): Administración, Operaciones y Facturación |
| `PATCH /:id/editar` al quitar liquidaciones | además, área `administracion` o `facturacion` (403) |
| `PATCH /:id/anular` | Facturación con permiso limitado o Administración con acceso efectivo; Facturación y Administración con permiso Completo pueden elegir destinos especiales (403) |
| `DELETE /:id/items/:liquidacionId` | además, área `administracion` (403) |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/facturacion-liquidaciones` | `liquidaciones-servicios:limited` | Lista paginada de facturas con su situación de cobro |
| POST | `/api/facturacion-liquidaciones` | `liquidaciones-servicios:limited` | Registra una factura y factura sus liquidaciones |
| GET | `/api/facturacion-liquidaciones/eliminadas` | `liquidaciones-servicios:limited` | Papelera de facturas |
| GET | `/api/facturacion-liquidaciones/:id` | `liquidaciones-servicios:limited` | Una factura con sus liquidaciones |
| PATCH | `/api/facturacion-liquidaciones/:id/editar` | `liquidaciones-servicios:limited` (+ administración o facturación si quita liquidaciones) | Edita datos de la factura y agrega o quita liquidaciones del lote |
| POST | `/api/facturacion-liquidaciones/:id/items` | `liquidaciones-servicios:limited` | Asocia liquidaciones a una factura existente |
| DELETE | `/api/facturacion-liquidaciones/:id/items/:liquidacionId` | `liquidaciones-servicios:limited` (+ administración) | Quita una liquidación de la factura y la devuelve a aprobada |
| PATCH | `/api/facturacion-liquidaciones/:id/condiciones` | `liquidaciones-servicios:limited` | Corrige valor, emisión, plazo o vencimiento |
| PATCH | `/api/facturacion-liquidaciones/:id/anular` | `liquidaciones-servicios:limited` (Facturación; opciones especiales también para Administración con Completo) | Anula la factura y aplica el destino elegido a cada liquidación |
| DELETE | `/api/facturacion-liquidaciones/:id` | `liquidaciones-servicios:limited` | Elimina (lógico) una factura anulada |
| PATCH | `/api/facturacion-liquidaciones/:id/restaurar` | `liquidaciones-servicios:limited` | Saca una factura de la papelera |
| POST | `/api/facturacion-liquidaciones/batch-info` | `liquidaciones-servicios:limited` | Factura activa de cada liquidación de una lista |

### Forma de una factura

`GET /`, `POST /:id/items`, `DELETE /:id/items/:liquidacionId` y
`PATCH /:id/condiciones` devuelven la factura con esta forma (`mapFactura`); el
alta, con algunas relaciones menos:

```json
{
  "id": "uuid", "numero_factura": "FE-123", "estado": "ACTIVA", "observaciones": null,
  "fecha_facturacion": "…", "cliente": { "id": "…", "nombre": "…", "nit": "…" },
  "facturado_por": { "id": "…", "nombre": "…", "correo": "…" }, "anulado_por": null,
  "valor_total": 15400000, "ajuste_valor": 0,
  "fecha_emision": "2026-10-01", "plazo_dias": 30, "fecha_vencimiento": "2026-10-31",
  "cartera": { "saldo": 15400000, "aplicado": 0, "estado": "pendiente", "dias_vencida": 0, "abonos": 0 },
  "total_liquidaciones": 2,
  "items": [{ "id": "…", "liquidacion_id": "…", "valor_liquidacion": 7700000,
    "liquidacion": { "id": "…", "consecutivo": "LS-2026-0042", "total": 7700000, "mes": 9, "anio": 2026, "cliente": { "…": "…" } } }]
}
```

`items` son solo los pivotes vivos. `cartera` es `null` si la factura está anulada
o eliminada; su `estado` es `pendiente`, `abonada`, `vencida` o `pagada` (ver
[cartera](./cartera.md)). Los montos de los abonos no viajan: el detalle está en
cartera.

### `GET /api/facturacion-liquidaciones`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | number | `1` | |
| `limit` | number | `15` | |
| `busqueda` | string | — | Número de factura, consecutivo de una liquidación viva de la factura o nombre de su cliente |
| `estado` | `ACTIVA` \| `ANULADA` | — | Sin validar: otro valor es un 500 de Prisma |

Excluye las eliminadas. Orden: `created_at` desc.

**Respuesta 200**: `{ facturas, total, totalPages, page, metadata }`, con
`metadata = { globalCount, globalTotal, globalLiquidaciones, estadoCounts, estadoTotales }`
calculado sobre **todo** el filtro, no solo la página.

### `POST /api/facturacion-liquidaciones`

**Body** (sin esquema; las condiciones las valida `resolverCondiciones`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `numero_factura` | string | sí | Se recorta. No puede repetir el de otra factura no eliminada (también anulada) |
| `liquidacion_ids` | uuid[] | sí | Al menos una |
| `observaciones` | string | no | |
| `valor_total` | number \| string | no | Valor de la factura electrónica; por defecto la suma de los `total` de las liquidaciones |
| `fecha_emision` | `YYYY-MM-DD` | no | Hoy por defecto |
| `plazo_dias` | entero 0–365 | no | `30` por defecto |
| `fecha_vencimiento` | `YYYY-MM-DD` | no | Si llega, manda sobre `plazo_dias` |

El cliente de la factura es el de las liquidaciones (si fueran de varios, el de
mayor valor).

**Respuesta 201** — la factura con la forma de arriba, salvo que el alta no
incluye `cliente` ni `anulado_por` (solo `cliente_id`) y la liquidación de cada
ítem viene sin `mes` ni `anio`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Condiciones inválidas (fecha, plazo, valor) | `{ "error": "…", "code": "DATOS_INVALIDOS" }` |
| 400 | Alguna ya está en una factura activa, no está en `LIQUIDADA`/`APROBADA`, u otra sesión se adelantó | `{ error }` con los consecutivos |
| 409 | Ya existe una factura con ese número | `{ error }` |
| 500 | Número vacío, lista vacía, alguna liquidación inexistente, u otro fallo | `{ error }` |

### `GET /api/facturacion-liquidaciones/eliminadas`

Arreglo plano (sin paginar) de facturas con `deleted_at`, por fecha de
eliminación descendente, con `facturado_por.nombre` e `items` vivos
(`liquidacion: { id, consecutivo, cliente.nombre }`). Los montos salen como
string.

### `GET /api/facturacion-liquidaciones/:id`

La factura (también anulada o eliminada) con `facturado_por`, `anulado_por`,
`cliente`, condiciones, `cartera` e `items` vivos con la liquidación completa
(incluye `cliente` y `creado_por`). Inexistente → 404
`{ "error": "Factura no encontrada" }`; un id mal formado sale como 500.

### `PATCH /api/facturacion-liquidaciones/:id/editar`

Edita una factura activa, agrega liquidaciones opcionales y quita las que se
desmarquen del lote en una sola transacción. Las que se quitan regresan a
`APROBADA`; cambiar la emisión vuelve a calcular el vencimiento con el plazo
indicado.

**Body** (zod, `.strict()`): `numero_factura` (texto no vacío, máximo 50),
`observaciones` (texto o `null`), `fecha_emision` (`YYYY-MM-DD`), `plazo_dias`
(entero 0–365), `liquidacion_ids` (opcional, arreglo de UUID a agregar) y
`quitar_liquidacion_ids` (opcional, arreglo de UUID que pertenecen al lote
actual y se deben devolver a aprobada). Una liquidación no puede agregarse y
quitarse en la misma edición.

**Respuesta 200**:
`{ factura, liquidaciones_afectadas: [{ id, consecutivo, estado_anterior, estado, factura_id, numero_factura }] }`.
El número debe ser único; la validación ignora la factura que se está editando y
la restricción de base de datos cubre actualizaciones concurrentes.

**Errores**: 400 si el body o las condiciones no son válidos, o si una nueva
liquidación no está en estado `LIQUIDADA`/`APROBADA`; 404 si la factura o alguna
liquidación no existe; 409 si el consecutivo está duplicado, la factura está
anulada o una liquidación cambió durante la edición; 403 al quitar liquidaciones
si el usuario no pertenece a Administración ni Facturación.

### `POST /api/facturacion-liquidaciones/:id/items`

**Body**: `{ "liquidacion_ids": ["uuid", "…"] }`. Mismas reglas que el alta. La
factura tiene que estar activa y no eliminada; recalcula `valor_total` desde sus
pivotes vivos más el ajuste y, si no tenía cliente, toma el de lo que se asocia.

**Respuesta 200**:
`{ factura, liquidaciones_afectadas: [{ id, consecutivo, estado: "FACTURADA", factura_id, numero_factura }] }`.

**Errores**: 404 si la factura no existe o está eliminada, o alguna liquidación
no existe o está eliminada; 400 si la factura está anulada, la lista está vacía,
alguna ya está facturada o no está en estado para facturar; 500 lo demás.

### `DELETE /api/facturacion-liquidaciones/:id/items/:liquidacionId`

No requiere body. La liquidación vuelve a `APROBADA` (solo si sigue
`FACTURADA`), conservando quién y cuándo la aprobó; si nunca tuvo aprobación,
la firma quien hace el cambio. Deja fila en el historial y recalcula el total.

**Respuesta 200**:
`{ factura, quedo_vacia, liquidaciones_afectadas: [{ id, consecutivo, estado, factura_id: null, numero_factura: null }] }`.
`quedo_vacia: true` avisa de que la factura se quedó sin liquidaciones: no se
anula sola.

**Errores**: 403 sin administración; 404 si la factura no existe o está
eliminada, o la liquidación no está en ella; 400 si la factura está anulada.

### `PATCH /api/facturacion-liquidaciones/:id/condiciones`

La misma operación que `PATCH /api/cartera/facturas/:id/condiciones`, por la
puerta de quien registra facturas (sin necesitar el permiso `cartera`).

**Body** (zod `condicionesSchema`, `.strict()`: un campo desconocido es 400)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `valor_total` | number \| string \| null | no | Se guarda como ajuste sobre la suma de las liquidaciones |
| `fecha_emision` | `YYYY-MM-DD` \| null | no | Cambiarla sola arrastra el vencimiento con el mismo plazo |
| `plazo_dias` | number \| string \| null | no | Entero 0–365 |
| `fecha_vencimiento` | `YYYY-MM-DD` \| null | no | Manda sobre el plazo; no puede ser anterior a la emisión |

**Respuesta 200** — la factura con la forma de `listar`.

**Errores** (`{ error, code? }`)

| Código | Cuándo |
|---|---|
| 400 | `:id` no es uuid, body con campos de más o condiciones inválidas (`DATOS_INVALIDOS`) |
| 404 | Factura inexistente o eliminada (`NO_ENCONTRADA`) |
| 409 | Factura anulada (`FACTURA_ANULADA`) o el valor queda por debajo de lo ya abonado (`VALOR_MENOR_QUE_ABONADO`) |

### `PATCH /api/facturacion-liquidaciones/:id/anular`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `motivo` | string | sí | Motivo de la anulación, guardado en la factura y el historial |
| `tipo` | enum | no | `SIN_MODIFICAR` (por defecto), `MODIFICAR_LIQUIDACIONES` o `DUPLICIDAD` |
| `liquidaciones_a_liquidar` | uuid[] | condicional | En `MODIFICAR_LIQUIDACIONES`, servicios que deben volver a `LIQUIDADA`; los demás quedan `APROBADA` |
| `liquidacion_duplicada_id` | uuid | condicional | En `DUPLICIDAD`, el servicio duplicado del lote; queda `ANULADA` con motivo de duplicidad y los demás quedan `APROBADA` |

Marca la factura `ANULADA` (`anulado_por`, `fecha_anulacion`). Con
`SIN_MODIFICAR`, todas las liquidaciones quedan `APROBADA`. Con
`MODIFICAR_LIQUIDACIONES`, solo las seleccionadas vuelven a `LIQUIDADA`; el
resto queda `APROBADA`. Con `DUPLICIDAD`, el servicio seleccionado queda
`ANULADA`, con una marca de duplicidad en `motivo_anulacion`, y los demás quedan
`APROBADA`. Todos los cambios se guardan en el historial.

**Respuesta 200** — la factura (con `facturado_por`, `anulado_por`, condiciones e
`items` vivos, sin `cliente` ni `total_liquidaciones`), `cartera: null` y
`estados_resultantes: { "<liquidacion_id>": "LIQUIDADA" | "APROBADA" | "ANULADA" }`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 403 | Sin ser del área `administracion` | `{ error }` |
| 404 | No existe | `{ error }` |
| 409 | Tiene abonos vivos: hay que retirarlos en cartera | `{ "error": "…", "code": "TIENE_ABONOS" }` |
| 400 | Selección de liquidaciones inválida | `{ error }` |
| 409 | Ya estaba anulada o cambió una liquidación durante la operación | `{ error }` |
| 500 | Otro fallo | `{ error }` |

### `DELETE /api/facturacion-liquidaciones/:id` y `PATCH /api/facturacion-liquidaciones/:id/restaurar`

Eliminar solo admite facturas `ANULADA`: pone `deleted_at` y renombra el número a
`<numero>_ELIMINADA`. Responde `{ "message": "Factura FE-123 eliminada exitosamente" }`.
Errores: 404 si no existe; 409 si está activa («Anúlela primero»); 500 si ya
estaba eliminada.

Restaurar quita `deleted_at` y el sufijo (la factura sigue `ANULADA`). Responde
`{ message, factura }`. Errores: 404 si no existe; 409 si no está eliminada o si
su número ya lo usa otra factura no eliminada.

### `POST /api/facturacion-liquidaciones/batch-info`

Lectura por `POST` para mandar muchos ids. **Body**: `{ "ids": ["uuid", "…"] }`
(400 si no es un arreglo).

**Respuesta 200** — mapa plano de las que tienen factura activa:
`{ "<liquidacion_id>": { "factura_id": "…", "numero_factura": "FE-123" } }`.
El listado de liquidaciones ya trae la factura embebida; esta ruta queda para
quien la siga usando.

## Efectos

- **Socket** (a todos, con `_evento`): `facturacion-created` (alta y
  restauración), `facturacion-updated` (editar, asociar, quitar, condiciones),
  `facturacion-anulada` (anular, y también eliminar con `{ id }` y
  `tipo: 'deleted'`), y un `liquidacion-servicio-facturada`
  `{ id, estado, factura_id, numero_factura }` por cada liquidación que cambia de
  estado. Ver [tiempo real](../tiempo-real.md).
- **Notificaciones** a los usuarios activos del área `administracion` menos quien
  actúa: `LIQUIDACION_FACTURADA` al registrar y `FACTURA_ANULADA` al anular
  (campana, socket `nueva-notificacion` y Web Push).
- **Historial** de cada liquidación en `historial_estado_liquidacion` (sin
  snapshot) al facturar, editar/asociar, quitar y anular.
- **Registro de actividad** de las escrituras (excluye `batch-info`).

## Observaciones

- Varios errores de usuario salen como **500**: en el alta, número vacío, lista
  vacía o una liquidación inexistente; anular una ya anulada; eliminar una ya
  eliminada. (`facturacion-liquidaciones.controller.ts` mapea por texto del
  mensaje.)
- El alta no filtra `deleted_at` al leer las liquidaciones: una eliminada pasa la
  comprobación y luego no la toma el cerrojo, así que el error dice «otra sesión
  se adelantó».
- Eliminar dos facturas que tuvieron el mismo número choca con el `@unique` de
  `numero_factura` (las dos serían `<numero>_ELIMINADA`) y sale 500.
- Facturación (`limited`) puede anular, eliminar y restaurar facturas: es a
  propósito según el comentario de `facturacion-liquidaciones.routes.ts`.
- Al editar, Administración y Facturación pueden desmarcar liquidaciones del
  lote; el retiro individual por `DELETE /:id/items/:liquidacionId` sigue siendo
  exclusivo de Administración.
- `PATCH /:id/anular` y `DELETE /:id/items/:liquidacionId` informan en
  `estados_resultantes` / `liquidaciones_afectadas` el estado de destino aunque
  la liquidación ya no estuviera `FACTURADA` (el `updateMany` condicional no la
  tocó).
- El evento de `DELETE /:id` usa como etiqueta `numero_factura` del resultado,
  que no lo trae: cae al prefijo del id.
