# Cartera

`/api/cartera` · código en [`src/modules/cartera/`](../../src/modules/cartera/) · permiso [`cartera`](../permisos.md#catálogo-de-módulos)

Cuentas por cobrar de las facturas de liquidaciones de servicios (módulo de
oct-2026): saldo de cada factura, abonos con que el cliente la va pagando
(`factura_liquidacion_abono`, con las retenciones desglosadas porque
contabilidad las cruza con los certificados del cliente) y edades de la deuda
por cliente. Las facturas se registran en
[facturacion-liquidaciones](./facturacion-liquidaciones.md); este módulo está
aparte porque esas rutas piden `liquidaciones-servicios` y Contabilidad, que es
quien cobra, solo tiene `cartera`.

Reglas del módulo:

- Solo cuentan las facturas `ACTIVA` y no eliminadas, y solo los abonos vivos
  (`deleted_at: null`).
- **Nada de esto se guarda**: saldo, estado y edad se calculan en cada lectura
  (`cartera.calculo.ts`) con la fecha de hoy en Colombia, todo en centavos.
  - `aplicado` de un abono = `valor` + `retefuente` + `reteica` + `reteiva` + `otros_descuentos`.
  - `saldo` = `valor_total` de la factura − Σ aplicado.
  - `estado`: `pagada` (saldo ≤ 0), `vencida` (saldo y ya pasó el vencimiento),
    `abonada` (saldo, sin vencer y con algún abono), `pendiente` (sin vencer y
    sin abonos).
  - `tramo` de edad: `corriente` (aún no vence; el día del vencimiento todavía lo
    es), `d1_30`, `d31_60`, `d61_90`, `d90_mas`; `null` si no queda saldo.
- Un abono no puede pasar del saldo, y el valor de una factura no puede quedar
  por debajo de lo ya abonado. Las dos operaciones bloquean la fila de la
  factura (`FOR UPDATE`) mientras recalculan.
- Las condiciones de cobro (valor, emisión, plazo, vencimiento) siguen
  `cartera.condiciones.ts`, compartido con el alta de facturas: el valor se
  guarda como `ajuste_valor` sobre la suma de las liquidaciones; si llega el
  vencimiento, manda sobre el plazo (0–365 días).

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| Todas con `:id` o `:abonoId` | hook `preValidation`: si no es un uuid, 400 `{ "success": false, "message": "Identificador inválido" }` |
| `GET` | `cartera:read`: Administración, Facturación, Contabilidad y Operaciones (esta última solo lee) |
| `PATCH`, `POST`, `DELETE` | `cartera:full`: Administración, Facturación y Contabilidad |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/cartera/resumen` | `cartera:read` | Totales de cabecera y edades por cliente |
| GET | `/api/cartera/facturas` | `cartera:read` | Facturas con su situación (por defecto, solo las abiertas) |
| GET | `/api/cartera/facturas/:id` | `cartera:read` | Una factura con sus liquidaciones y abonos vivos |
| PATCH | `/api/cartera/facturas/:id/condiciones` | `cartera:full` | Corrige valor, emisión, plazo o vencimiento |
| POST | `/api/cartera/facturas/:id/abonos` | `cartera:full` | Registra un abono (JSON o multipart con comprobante) |
| DELETE | `/api/cartera/abonos/:abonoId` | `cartera:full` | Retira un abono (borrado lógico) |
| GET | `/api/cartera/abonos/:abonoId/comprobante` | `cartera:read` | URL firmada del comprobante del abono |

Todas responden con envoltorio: `{ "success": true, "data": … }` o, en error,
`{ "success": false, "message": "…", "code"?: "…", "details"?: […] }`.

**Errores comunes**

| Código | Cuándo | `code` |
|---|---|---|
| 400 | Falla la validación zod (`details` con un mensaje por campo) | — |
| 400 | Condiciones inválidas | `DATOS_INVALIDOS` |
| 404 | Factura o abono inexistente (o eliminado) | `NO_ENCONTRADA` |
| 409 | Factura anulada | `FACTURA_ANULADA` |
| 409 | El abono supera el saldo | `SUPERA_SALDO` |
| 409 | El valor nuevo queda por debajo de lo abonado | `VALOR_MENOR_QUE_ABONADO` |
| 500 | Cualquier otro fallo, con un mensaje fijo por ruta («No fue posible …») | — |

### `GET /api/cartera/resumen`

**Respuesta 200**

```json
{ "success": true, "data": {
  "hoy": "2026-10-11",
  "resumen": { "por_cobrar": 0, "vencido": 0, "corriente": 0, "por_vencer_mes": 0,
    "facturas_abiertas": 0, "facturas_vencidas": 0, "clientes_con_saldo": 0,
    "edades": { "corriente": 0, "d1_30": 0, "d31_60": 0, "d61_90": 0, "d90_mas": 0 } },
  "clientes": [{ "cliente_id": "uuid | null", "nombre": "…", "nit": "…", "facturas": 2,
    "facturas_vencidas": 1, "saldo": 0, "vencido": 0, "edades": { "…": 0 }, "max_dias_vencida": 12 }]
} }
```

`por_vencer_mes` es el saldo sin vencer cuyo vencimiento cae entre hoy y fin de
mes. `clientes` solo incluye a quien tiene saldo, del más vencido al menos; las
facturas sin cliente se agrupan como «Sin cliente» (`cliente_id: null`).

### `GET /api/cartera/facturas`

**Query** (zod `filtrosFacturasSchema`)

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `estado` | `abiertas` \| `todas` \| `pendiente` \| `abonada` \| `vencida` \| `pagada` | `abiertas` | `abiertas` = con saldo > 0 |
| `cliente_id` | uuid \| `sin-cliente` | — | `sin-cliente` = facturas sin cliente |
| `tramo` | `corriente` \| `d1_30` \| `d31_60` \| `d61_90` \| `d90_mas` | — | Solo facturas con saldo en ese tramo |
| `q` | string (≤ 120) | — | Todas las palabras, sin tildes, contra número, nombre y NIT del cliente |

**Respuesta 200** — `data: { hoy, facturas }`, por vencimiento y número. Cada
factura:

```json
{ "id": "uuid", "numero_factura": "FE-123", "cliente": { "id": "…", "nombre": "…", "nit": "…" },
  "fecha_emision": "2026-09-01", "plazo_dias": 30, "fecha_vencimiento": "2026-10-01",
  "ajuste_valor": 0, "observaciones": null, "liquidaciones": 2, "abonos": 1, "ultimo_abono": "2026-09-20",
  "valor": 1000, "recibido": 400, "retenciones": 25, "aplicado": 425, "saldo": 575,
  "estado": "vencida", "dias_vencida": 10, "tramo": "d1_30" }
```

### `GET /api/cartera/facturas/:id`

**Respuesta 200** — `data: { hoy, factura, abonos }`. `factura` es la fila de
arriba más `estado_factura` (`ACTIVA`/`ANULADA`), `fecha_facturacion`,
`facturado_por`, `suma_liquidaciones` e
`items: [{ liquidacion_id, consecutivo, mes, anio, valor }]` (pivotes vivos).
Cada abono:
`{ id, fecha, valor, retefuente, reteica, reteiva, otros_descuentos, aplicado, medio, referencia, tiene_comprobante, comprobante_nombre, observaciones, creado, creado_por }`.
Una factura eliminada da 404; una anulada sí se abre.

### `PATCH /api/cartera/facturas/:id/condiciones`

**Body** (zod `condicionesSchema`, `.strict()`: un campo desconocido es 400)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `valor_total` | number \| string \| null | no | Se guarda como ajuste sobre la suma de las liquidaciones vivas |
| `fecha_emision` | `YYYY-MM-DD` \| null | no | Cambiarla sola arrastra el vencimiento con el mismo plazo |
| `plazo_dias` | number \| string \| null | no | Entero 0–365 |
| `fecha_vencimiento` | `YYYY-MM-DD` \| null | no | Manda sobre el plazo; no antes de la emisión ni a más de 365 días |

**Respuesta 200** — `data` con la forma de `GET /api/cartera/facturas/:id`.
La misma operación existe en `PATCH /api/facturacion-liquidaciones/:id/condiciones`
para quien registra facturas.

### `POST /api/cartera/facturas/:id/abonos`

JSON, o `multipart/form-data` con los mismos campos como texto y el archivo
opcional `comprobante` (PDF, PNG, JPEG o WEBP; otro tipo → 400; más de 10 MB →
413).

**Body** (zod `registrarAbonoSchema`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha` | `YYYY-MM-DD` | sí | Fecha real (rechaza `2026-02-30`) |
| `medio` | `TRANSFERENCIA` \| `CONSIGNACION` \| `CHEQUE` \| `EFECTIVO` \| `OTRO` | sí | |
| `valor` | number | no | Lo que entró al banco. Vacío = 0; ≥ 0; se redondea a centavos |
| `retefuente`, `reteica`, `reteiva`, `otros_descuentos` | number | no | Igual que `valor` |
| `referencia` | string (≤ 120) | no | Vacío = `null` |
| `observaciones` | string (≤ 2000) | no | Vacío = `null` |

La suma de `valor` y retenciones tiene que ser mayor que cero, y no puede pasar
del saldo de la factura (409 `SUPERA_SALDO`; «pagar el saldo» manda exactamente
el saldo). La factura tiene que existir (404) y estar activa (409
`FACTURA_ANULADA`).

**Respuesta 201** — `data: { abono_id, comprobante_s3_key, hoy, factura, abonos }`
(el detalle de la factura ya con el abono).

### `DELETE /api/cartera/abonos/:abonoId`

**Body** (opcional): `{ "motivo": "…" }` (≤ 500). Marca el abono con
`deleted_at`, `eliminado_por_id` y `motivo_eliminacion`; el saldo vuelve a
subir. Abono inexistente o ya retirado → 404.

**Respuesta 200** — `data` con el detalle de su factura.

### `GET /api/cartera/abonos/:abonoId/comprobante`

**Respuesta 200** — `data: { url }`, URL firmada de S3 válida 15 minutos. 404 si
el abono está retirado o no tiene comprobante.

## Efectos

- **S3**: el comprobante se sube a `cartera/abonos/<facturaId>/<abonoId><ext>`
  **antes** de la transacción; si la inserción falla después, el archivo queda
  huérfano (es a propósito: mejor eso que una fila apuntando a un archivo que no
  existe). Ver [integraciones](../integraciones.md).
- **Socket** `facturacion-updated` con la factura completa (forma de
  `GET /api/facturacion-liquidaciones`) tras cambiar condiciones, registrar o
  retirar un abono, para las pantallas de facturas. Se emite sin esperar y un
  fallo no afecta a la respuesta. Ver [tiempo real](../tiempo-real.md).
- **Registro de actividad** de las escrituras (hook global).

## Observaciones

- Al abrir el detalle, una factura `ANULADA` (no eliminada) sí se devuelve, con
  `estado_factura: "ANULADA"`, pero su `estado` de cartera se calcula igual que
  si se cobrara; el listado y el resumen sí la excluyen.
- `DELETE /api/cartera/abonos/:abonoId` no comprueba el estado de la factura
  (lee `estado` y `deleted_at` pero no los usa). Hoy no tiene efecto práctico,
  porque una factura con abonos vivos no se puede anular.
- La respuesta del alta incluye `comprobante_s3_key`, la clave interna del
  archivo en el bucket.
