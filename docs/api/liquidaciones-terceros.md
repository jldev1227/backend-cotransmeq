# Liquidaciones de terceros

`/api/liquidaciones-terceros` · código en [`src/modules/liquidaciones-terceros/`](../../src/modules/liquidaciones-terceros/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Dominio de lo que la empresa le paga a los propietarios de los vehículos de
terceros. Todo parte de las **filas de terceros** de cada liquidación de
servicio (`liquidacion_tercero`): un servicio facturado con su placa, su
tercero, lo facturado (`valor_unitario × cantidad`), la administración que se
queda la empresa y el `valor_liquidar` que le toca al propietario. Cada fila se
paga por **una sola vía**: el cierre de su placa, la liquidación ocasional del
mes o la hoja de ingresos. El dominio está repartido en varias carpetas:

| Carpeta | Qué cubre |
|---|---|
| `liquidaciones-terceros` (este doc) | Las filas de terceros de una liquidación de servicio y su historial plano |
| [`liquidaciones-terceros-descuentos`](./liquidaciones-terceros-descuentos.md) | El **cierre** (`liquidacion_tercero_final`): uno por placa, propietario y mes. Pese al nombre de la carpeta, casi todas las rutas `/api/liquidaciones-terceros/*` viven ahí: listados, generar y guardar borradores (con cola), conceptos de descuento, conductores, copropietarios, ítems del pivote, traslados, estados y borrado |
| [`liquidaciones-terceros-snapshots`](./liquidaciones-terceros-snapshots.md) | Versiones de un cierre, diff y reversión; cron horario |
| [`liquidaciones-terceros-pagos`](./liquidaciones-terceros-pagos.md) | Fecha, medio y comprobante del pago al propietario (estado PAGADA) |
| [`liquidaciones-terceros-pdf`](./liquidaciones-terceros-pdf.md) | PDF del cierre (Puppeteer) y PDF/ZIP de los canvas |
| [`liquidaciones-terceros-envios`](./liquidaciones-terceros-envios.md) | Envío por correo de las hojas, en cola, desde el buzón de contabilidad |
| [`liquidaciones-chat`](./liquidaciones-chat.md) | Chat y recordatorios de cada cierre |
| [`liquidaciones-terceros-adicionales`](./liquidaciones-terceros-adicionales.md) y [`liquidaciones-terceros-adicionales-snapshots`](./liquidaciones-terceros-adicionales-snapshots.md) | Filas adicionales de los cierres (pagos que no salen de un servicio), vistas por periodo, y sus versiones |
| [`liquidaciones-terceros-ocasional`](./liquidaciones-terceros-ocasional.md) y [`liquidaciones-terceros-ocasional-snapshots`](./liquidaciones-terceros-ocasional-snapshots.md) | Liquidación ocasional del mes (los ítems de placas sin cierre) y sus versiones |
| [`liquidaciones-terceros-ingresos`](./liquidaciones-terceros-ingresos.md) | Hojas «OTROS INGRESOS» y «ADICIONALES» de la empresa |
| [`canvas-anotaciones`](./canvas-anotaciones.md) | Notas libres de los canvas de este dominio |

Dos reglas cruzan todas las carpetas. Un ítem del pivote de un cierre se puede
**trasladar** a la liquidación ocasional o a la hoja de ingresos, y la marca
vive en el pivote (`trasladado_a`), que es lo que permite devolverlo (ver
`trasladar` en [descuentos](./liquidaciones-terceros-descuentos.md)). Y nada que
sea dato del usuario se borra en duro: se marca `deleted_at` y cada lectura
filtra (ver [borrado lógico](../borrado-logico-liquidaciones.md)).

Ojo con los parámetros: en este archivo `:liquidacion_id` es el id de una
**liquidación de servicio**; en las demás rutas `/api/liquidaciones-terceros/:id/…`
el `:id` es el de un **cierre**. Las rutas con segmento literal
(`/periodo`, `/config-gastos`, `/envios/…`) ganan sobre `/:liquidacion_id`
porque Fastify prefiere los segmentos estáticos.

Este módulo en concreto sirve el tab «Terceros» del dashboard de liquidaciones
de servicios: el historial plano de filas, la lectura y el reemplazo de las
filas de una liquidación y una migración única desde el JSON
`recargos_data.terceroRows`. Al guardar, cada fila se recalcula en el servidor:
`total_facturado = valor_unitario × cantidad`, `valor_admin = total_facturado ×
porcentaje_admin / 100`, `valor_liquidar = total_facturado − valor_admin` e
`ingreso_empresa = ingreso_empresa ?? (ingreso_extra_global − ingresos_extra_aval)`.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-servicios-seccion06:read` |
| `POST /migrar`, `PUT /:liquidacion_id` | `liquidaciones-servicios-seccion06:full` |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros` | `liquidaciones-servicios-seccion06:read` | Historial paginado de filas de Hoja 4, con agregados del filtro |
| POST | `/api/liquidaciones-terceros/migrar` | `liquidaciones-servicios-seccion06:full` | Migra `recargos_data.terceroRows` a la tabla `liquidacion_tercero` |
| GET | `/api/liquidaciones-terceros/:liquidacion_id` | `liquidaciones-servicios-seccion06:read` | Filas de terceros vivas de una liquidación de servicio |
| PUT | `/api/liquidaciones-terceros/:liquidacion_id` | `liquidaciones-servicios-seccion06:full` | Reemplaza las filas de terceros de una liquidación de servicio |

### `GET /api/liquidaciones-terceros`

**Query** (todo opcional)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | number | `1` | Página |
| `limit` | number | `50` | Tamaño de página; sin tope |
| `cliente_id` | uuid | — | Cliente de la liquidación padre |
| `tercero_id` | uuid | — | Tercero de la fila |
| `placa` | string | — | `contains`, sin distinguir mayúsculas |
| `mes`, `anio` | number | — | Periodo de la liquidación **padre** (no las columnas `mes`/`anio` de la fila) |
| `busqueda` | string | — | Placa, recorrido, nombre del tercero o consecutivo de la liquidación |

Solo filas vivas de liquidaciones vivas. Orden: año y mes de la liquidación
descendentes, luego `orden`.

**Respuesta 200**

```json
{
  "items": [
    { "id": "uuid", "liquidacion_id": "uuid", "placa": "ABC123", "recorrido": "…",
      "valor_unitario": 0, "cantidad": 1, "total_facturado": 0, "valor_admin": 0,
      "valor_liquidar": 0, "ingreso_empresa": 0,
      "tercero": { "id": "…", "nombre_completo": "…", "identificacion": "…", "tipo_persona": "…" },
      "item": { "id": "…", "numero_planilla": "…" },
      "liquidacion": { "id": "…", "consecutivo": "…", "mes": 7, "anio": 2026, "estado": "…",
        "osi": "…", "tercero_liquidado": "…", "cliente": { "…": "…" },
        "factura_items": [{ "factura": { "id": "…", "numero_factura": "…", "estado": "ACTIVA" } }] } }
  ],
  "total": 120, "totalPages": 3, "page": 1,
  "metadata": { "globalCount": 120, "globalFacturado": 0, "globalAdmon": 0,
    "globalLiquidar": 0, "globalIngresoEmpresa": 0, "globalClientes": 4 }
}
```

`metadata` agrega **todo** lo que casa con el filtro, no solo la página: las
tarjetas del tab se calculaban antes sobre las 50 filas visibles y cambiaban al
pasar de página. Los decimales salen como número.

### `GET /api/liquidaciones-terceros/:liquidacion_id`

Arreglo plano de las filas vivas de esa liquidación de servicio, ordenadas por
`orden`, con `tercero` e `item` como en el historial. Un id inexistente
devuelve `[]`.

### `PUT /api/liquidaciones-terceros/:liquidacion_id`

**Body** `{ "items": [...] }` (sin esquema de validación)

| Campo de cada ítem | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `placa` | string | sí | Se guarda tal cual |
| `valor_unitario`, `cantidad`, `porcentaje_admin` | number | sí (de facto) | Base del recálculo |
| `recorrido` | string | no | `'N/A'` si falta |
| `fechas` | string | no | `''` si falta |
| `tercero_id`, `item_id` | uuid | no | `item_id` es el ítem de la liquidación de servicio |
| `ingreso_extra_global`, `ingresos_extra_aval`, `ingreso_empresa` | number | no | Ver la fórmula de arriba |
| `src_index` | number | no | Índice del ítem de servicio de origen; por defecto la posición |

Marca con `deleted_at` todas las filas vivas de la liquidación y crea las
nuevas en la misma transacción; `orden` es la posición en el arreglo.

**Respuesta 200** — arreglo con las filas creadas, en la forma del `GET`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | `items` no es un arreglo | `{ "error": "items debe ser un array" }` |
| 500 | Liquidación inexistente (FK), tipos inválidos y cualquier otro fallo | `{ "error": "<mensaje>" }` |

### `POST /api/liquidaciones-terceros/migrar`

Sin body. Recorre las liquidaciones de servicio no borradas con
`recargos_data.terceroRows` y, en las que todavía no tienen filas vivas, crea
una fila por cada `terceroRow` con el mismo cálculo. Es idempotente: una
liquidación ya migrada se salta.

**Respuesta 200** — `{ "migradas": 3, "itemsMigrados": 12, "totalLiquidacionesRevisadas": 40 }`.

## Efectos

- `PUT` emite `liquidacion-tercero-updated` a **todos** los sockets
  (`io.emit`), después de guardar y fuera de la transacción:
  `{ liquidacion_id, consecutivo, mes, anio, total_items, _evento }`, con
  `_evento = { tipo: 'updated', scope: 'terceros', actor, etiqueta, ts }`. Si
  la emisión falla, la escritura no se revierte (ver [tiempo real](../tiempo-real.md)).
- El mismo `LiquidacionesTercerosService.guardar` lo llaman el alta y la
  edición de una liquidación de servicio cuando traen `terceros_items` (ver
  [liquidaciones de servicios](./liquidaciones-servicios.md)).
- Las escrituras que terminan bien dejan una fila en `registro_actividad` (hook
  global, ver [actividad](./actividad.md)).

## Observaciones

- **Cada guardado cambia la identidad de las filas.** No se reconcilia por
  `id`: se marcan todas las vivas y se crean otras con UUID nuevos. Lo que
  apuntaba a las anteriores —el pivote de un cierre
  (`liquidacion_tercero_final_item`), los ítems de la liquidación ocasional y
  las decisiones de la hoja de ingresos— queda colgando de filas marcadas. El
  cierre sigue sumando el `valor_liquidar` viejo (`sumarItemsCierre` en
  `totales-cierre.ts` no mira el `deleted_at` de la fila) y la fila nueva vuelve
  a aparecer como disponible para otro cierre. Afecta también al guardado desde
  liquidaciones de servicios (`liquidaciones-terceros.service.ts`).
- Ni `guardar` ni `migrar` escriben las columnas `mes`/`anio` de
  `liquidacion_tercero`; hay lecturas de otros módulos que filtran por ellas
  (ver `refresh-items` en [descuentos](./liquidaciones-terceros-descuentos.md)).
- `PUT` no comprueba el estado de la liquidación de servicio: una facturada o
  anulada se reescribe igual. El body no se valida: un número mal formado o una
  liquidación inexistente salen como 500.
- `migrar` es una operación de mantenimiento abierta a cualquiera con
  `limited`. Es idempotente, así que el riesgo es de carga, no de datos.
- `limit` no tiene tope en el historial.
