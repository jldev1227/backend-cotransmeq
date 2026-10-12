# Ingresos de la empresa (hojas de ingresos y adicionales)

`/api/liquidaciones-terceros-ingresos` · código en [`src/modules/liquidaciones-terceros-ingresos/`](../../src/modules/liquidaciones-terceros-ingresos/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Canvas anual de dos hojas por mes: **«OTROS INGRESOS»**, lo que la empresa
ganó sobre los servicios de terceros, y **«ADICIONALES»**, lo que de eso se le
paga al tercero. El código conserva el nombre de la otra empresa («ingresos de
Transmeralda», tablas `liquidacion_ingreso_transmeralda*`, campo
`total_ingreso_transmeralda`): aquí son los ingresos de Cotransmeq. Ver
[liquidaciones de terceros](./liquidaciones-terceros.md) para el reparto del
dominio.

La **tabla de la hoja no se guarda**: se lee en vivo y es de solo lectura. Sus
filas son de dos orígenes (`origen` en cada fila):

- `SERVICIO`: filas de `liquidacion_tercero` con ingreso para la empresa
  (`ingreso_empresa ≠ 0`, negativos incluidos), de una liquidación no anulada
  con **factura activa**, que no estén en una liquidación ocasional viva. El
  periodo es el de la liquidación de servicio, salvo que el ítem se haya
  **trasladado** a ingresos desde un cierre de placa: entonces cuenta en el mes
  del cierre (`trasladado_de_cierre: true`) y su importe es el `valor_liquidar`
  que le habría pagado el cierre, sin administración.
- `ADICIONAL`: filas de `liquidacion_tercero_final_adicional` de cierres vivos
  (BORRADOR a PAGADA/FACTURADA), en el mes del cierre y con ingreso negativo.

Lo que **sí** se guarda es la capa de decisiones encima: por mes, una cabecera
(`@@unique([mes, anio])`) con los porcentajes (administración de ingresos 10 %,
ganancia con que un ingreso baja a ADICIONALES 70 %, administración de
adicionales 10 % por defecto), los totales en caché, las filas de override
(solo las que se apartan del valor por defecto: INCLUIR marcado, cantidad
distinta de 1, porcentajes propios o V/UNIDAD a mano) y los conceptos del pie
de cada hoja. La hoja de ADICIONALES se calcula primero: su TRANSPORTE POR
PAGAR es lo que la de INGRESOS resta. No hay estados ni bloqueo.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros:limited` (`preHandler` por ruta) |
| `POST …/guardar` | `liquidaciones-terceros:limited`: facturación y contabilidad también editan |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros-ingresos/anual` | `liquidaciones-terceros:limited` | Filas y estado editable de los 12 meses |
| GET | `/api/liquidaciones-terceros-ingresos/estado` | `liquidaciones-terceros:limited` | Estado editable de un mes |
| POST | `/api/liquidaciones-terceros-ingresos/guardar` | `liquidaciones-terceros:limited` | Guarda las decisiones del mes (idempotente) |
| GET | `/api/liquidaciones-terceros-ingresos` | `liquidaciones-terceros:limited` | Filas de un mes |

### Forma de una fila (`IngresoTerceroRow`)

```json
{ "id": "uuid", "origen": "SERVICIO", "liquidacion_id": "uuid", "consecutivo": "…",
  "cliente_id": "uuid", "cliente_nombre": "…", "cliente_nit": "…", "mes": 7, "anio": 2026,
  "tercero_id": "uuid", "tercero_nombre": "…", "placa": "ABC123", "recorrido": "…",
  "fechas": "…", "numero_planilla": "…", "valor_unitario": 0, "cantidad": 1,
  "porcentaje_admin": 0, "valor_admin": 0, "total_facturado": 0, "valor_liquidar": 0,
  "ingreso_empresa": 0, "ingreso_extra_global": 0, "ingresos_extra_aval": 0, "orden": 0,
  "cierre_consecutivo": null, "trasladado_de_cierre": false }
```

`id` es el de la tabla de origen (ítem o adicional); los dos son UUID y no
chocan, así que el cliente lo usa como clave de fila sin distinguir.

### `GET /api/liquidaciones-terceros-ingresos/anual` y `GET /api/liquidaciones-terceros-ingresos`

- `anual?anio=` → `{ anio, meses: { "1": [filas], … "12": [filas] }, estados: { "1": { cabecera, filas, conceptos }, … }, total }`.
  Siempre las 12 claves; un mes sin cabecera trae `cabecera: null`.
- `?mes=&anio=` → `{ mes, anio, items: [filas], total }` (para «Recargar mes»).

El orden es por placa; el cliente reordena de todas formas.

### `GET /api/liquidaciones-terceros-ingresos/estado`

**Query** `mes`, `anio`. Responde `{ mes, anio, cabecera, filas, conceptos }`
(lo que el canvas relee tras guardar):

- `cabecera`: `{ id, mes, anio, observaciones, pct_admon_ingresos, pct_ganancia_adicionales, pct_admon_adicionales, total_facturado_ingresos, total_admon_ingresos, total_liquidar_ingresos, total_facturado_adicionales, total_admon_adicionales, total_liquidar_adicionales, total_pagar_adicionales, total_ingreso_transmeralda, version, updated_at }` o `null`.
- `filas`: `[{ id, liquidacion_tercero_id, origen, incluir_adicional, cantidad, pct_admon_ingresos, pct_ganancia, pct_admon_adicional, valor_unitario_adicional, orden, version }]`;
  `liquidacion_tercero_id` es la clave de la fila de la hoja, sea ítem o adicional.
- `conceptos`: `[{ id, hoja, tipo, concepto, persona, dias, valor_unitario, porcentaje, valor_total, base_calculo, observaciones, orden, version }]`.

### `POST /api/liquidaciones-terceros-ingresos/guardar`

**Body** (zod `guardarIngresoSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `mes`, `anio` | number | sí | 1–12 y 2000–2100 |
| `observaciones` | string \| null | no | |
| `pct_admon_ingresos`, `pct_ganancia_adicionales`, `pct_admon_adicionales` | number | no | −1000 a 1000; si faltan, 10, 70 y 10 |
| `filas` | arreglo | no | `{ liquidacion_tercero_id (uuid), incluir_adicional?, cantidad?, pct_admon_ingresos?, pct_ganancia?, pct_admon_adicional?, valor_unitario_adicional?, orden? }` |
| `conceptos` | arreglo | no | `{ id?, hoja: INGRESOS\|ADICIONALES, tipo: COSTO_LABORAL\|GASTO_OPERATIVO\|ANTICIPO\|IMPUESTO, concepto, persona?, dias?, valor_unitario?, porcentaje?, valor_total?, base_calculo?, observaciones?, orden? }` (`PRESTAMO` ya no se admite) |

Crea la cabecera en el primer guardado del mes (no hay paso de «generar
borrador»). Es un **reemplazo completo** en una transacción de pocas
sentencias: se quedan solo las filas relevantes (deduplicadas por ítem, gana la
última), cada una se clasifica **contra la base** como ítem o adicional
(`liquidacion_tercero_id` o `adicional_id`), las que vuelven se borran en duro
antes de reinsertarse (los únicos cuentan las marcadas) y lo que sale se marca
con `deleted_at`; igual con los conceptos, por `id`. Los totales se calculan en
el servidor con las filas del mes leídas en vivo.

**Respuesta 200** — `{ ok: true, id, accion: "created" | "updated", totales: { total_facturado_ingresos, …, total_ingreso_transmeralda }, filas_count, conceptos_count }`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | El body o la query no pasan zod | `{ "error": "Payload inválido", "detalles": [{ "campo", "mensaje" }] }` |
| 500 | Cualquier otro fallo (incluido un `liquidacion_tercero_id` que no existe: FK) | `{ "error": "<mensaje>" }` |

## Efectos

- El guardado no emite eventos de socket; la sala del libro es
  `sheet:ingresos:<anio>` y la usan el gateway de hojas y la cola de
  [envíos](./liquidaciones-terceros-envios.md).
- El [traslado](./liquidaciones-terceros-descuentos.md) de un ítem desde un
  cierre marca su INCLUIR aquí (creando la cabecera del mes si no existía y
  sembrando los INCLUIR de los clientes prioritarios, hoy FEPCO) y recalcula la
  cabecera; devolverlo lo desmarca.
- Las escrituras que terminan bien dejan fila en `registro_actividad` (ver
  [actividad](./actividad.md)).

## Observaciones

- No hay concurrencia optimista en el guardado: la cabecera y las filas tienen
  `version`, pero el reemplazo completo no la compara; el último que guarda
  gana.
- Un `id` de concepto que pertenezca a la cabecera de otro mes choca con la
  clave primaria (500): el borrado previo solo mira la cabecera actual.
- La lista de clientes prioritarios que se siembran como INCLUIR al crear la
  cabecera desde un traslado (`CLIENTES_PRIORITARIOS = ["FEPCO"]` en
  `liquidaciones-terceros-ingresos.service.ts`) es la misma que en
  Transmeralda: el módulo es idéntico en los dos repos.
