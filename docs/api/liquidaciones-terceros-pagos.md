# Pagos de cierres de terceros

`/api/liquidaciones-terceros-pagos` · código en [`src/modules/liquidaciones-terceros-pagos/`](../../src/modules/liquidaciones-terceros-pagos/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Cuándo, cómo y con qué soporte se le pagó al propietario un
[cierre](./liquidaciones-terceros-descuentos.md) (`liquidacion_tercero_final_pago`).
PAGADA reemplazó a FACTURADA en oct-2026; el estado solo decía «se pagó» y
contabilidad tenía que reconstruir el resto del extracto del banco.

El paso a PAGADA **no** está aquí: va por el cambio de estado de siempre
(`PATCH /api/liquidaciones-terceros/:id/estado` y `POST …/estado-lote`), que
exige el objeto `pago` y crea la fila en la **misma transacción** que el
estado, de modo que no puede quedar un cierre PAGADA sin pago ni al revés. Hay
como mucho un pago vivo por cierre (índice único parcial
`lt_final_pago_activo_uniq`, solo en la migración); corregirlo o devolver el
cierre a APROBADA **archiva** el anterior (`deleted_at`, `eliminado_por_id`,
`motivo_eliminacion`) en vez de borrarlo. `valor` congela el `total_pagar` del
cierre en el momento del registro. Los medios admitidos son `TRANSFERENCIA`,
`CONSIGNACION`, `CHEQUE`, `EFECTIVO` y `OTRO` (`src/lib/pagos/medios.ts`, con
CHECK en la base). Este módulo sirve para subir el comprobante antes de marcar,
leer los pagos y completar o corregir el de un cierre que ya está pagado.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin); un hook `preValidation` responde 400 si `:cierreId` o `:pagoId` no son UUID |
| `GET` | `liquidaciones-terceros:limited` (facturación y contabilidad consultan) |
| `POST …/comprobante`, `PUT …/:cierreId` | `liquidaciones-terceros:full` **y** área `administracion` (comprobación en el archivo de rutas, mismo criterio que la entrada a PAGADA) → 403 si no |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/liquidaciones-terceros-pagos/comprobante` | `liquidaciones-terceros:full` + Administración | Sube el comprobante a S3 y devuelve su clave |
| GET | `/api/liquidaciones-terceros-pagos/periodo` | `liquidaciones-terceros:limited` | Pagos vivos de los cierres de un periodo |
| GET | `/api/liquidaciones-terceros-pagos/:cierreId` | `liquidaciones-terceros:limited` | Pago vivo e historial de un cierre |
| PUT | `/api/liquidaciones-terceros-pagos/:cierreId` | `liquidaciones-terceros:full` + Administración | Completa o corrige el pago de un cierre ya pagado |
| GET | `/api/liquidaciones-terceros-pagos/comprobante/:pagoId` | `liquidaciones-terceros:limited` | URL firmada del comprobante |

Todas responden con el envoltorio `{ success, data }` o `{ success: false, message }`.

### Forma de un pago

```json
{ "id": "uuid", "cierre_id": "uuid", "fecha": "2026-10-10", "medio": "TRANSFERENCIA",
  "referencia": "…", "valor": 1250000, "tiene_comprobante": true,
  "comprobante_nombre": "soporte.pdf", "observaciones": null,
  "registrado": "2026-10-10T15:00:00.000Z", "registrado_por": { "id": "…", "nombre": "…" },
  "archivado": null, "motivo_archivo": null }
```

La clave S3 del comprobante no sale nunca: solo `tiene_comprobante`.

### `POST /api/liquidaciones-terceros-pagos/comprobante`

`multipart/form-data` con el archivo (se toma el último archivo del formulario;
no se mira el nombre del campo). PDF, PNG, JPG o WEBP, hasta 10 MB. Se sube a
`liquidaciones-terceros/pagos/<AAAA-MM>/<uuid>.<ext>` (mes de hoy en hora de
Colombia) y se devuelve la clave para mandarla luego en el `pago` del cambio de
estado. Un lote de hojas pagadas con una sola transferencia puede compartir el
mismo soporte.

**Respuesta 201** — `{ "success": true, "data": { "s3_key": "liquidaciones-terceros/pagos/2026-10/….pdf", "nombre": "soporte.pdf" } }`.

| Código | Cuándo |
|---|---|
| 400 | Tipo no admitido, archivo vacío o ausente |
| 403 | Usuario sin área Administración |
| 413 | Más de 10 MB |

### `GET /api/liquidaciones-terceros-pagos/periodo`

**Query** `anio` (≥ 2000) y `mes` (1–12); 400 `Periodo inválido` si no.
**Respuesta 200** — `{ success: true, data: { "<cierreId>": pago, … } }` con
los pagos vivos de los cierres vivos del periodo (lo que pinta el canvas junto
al estado de cada hoja).

### `GET /api/liquidaciones-terceros-pagos/:cierreId`

**Respuesta 200**

```json
{ "success": true, "data": {
  "cierre": { "id": "uuid", "estado": "PAGADA", "placa": "ABC123", "consecutivo": "…", "total_pagar": 1250000 },
  "pago": { "…": "…" },
  "sin_registro": false,
  "historial": [{ "…": "pagos archivados" }] } }
```

`sin_registro: true` marca un cierre PAGADA (o FACTURADA heredado) sin pago
vivo: los pagados antes de existir este registro. 404 si el cierre no existe.

### `PUT /api/liquidaciones-terceros-pagos/:cierreId`

**Body** (zod `pagoCierreSchema` en `pago-cierre.ts`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha` | `AAAA-MM-DD` | sí | Fecha real del calendario |
| `medio` | enum | sí | `TRANSFERENCIA`, `CONSIGNACION`, `CHEQUE`, `EFECTIVO`, `OTRO` |
| `referencia` | string ≤ 120 | no | Vacío = `null` |
| `observaciones` | string ≤ 1000 | no | |
| `comprobante_s3_key` | string | no | Debe tener la forma exacta de una clave de este módulo; sin ella se hereda el comprobante del pago que se archiva |
| `comprobante_nombre` | string ≤ 255 | no | Solo se guarda si hay clave |

Solo para cierres ya PAGADA o FACTURADA; no toca el estado. Bloquea la fila del
cierre (`FOR UPDATE`), archiva el pago vivo y crea el nuevo. Responde lo mismo
que el `GET`.

| Código | Cuándo |
|---|---|
| 400 | Body inválido (el mensaje es el primer error de zod) |
| 403 | Usuario sin área Administración |
| 404 | Cierre inexistente |
| 409 | El cierre no está pagado: «el pago se registra al marcarlo PAGADA desde el estado» |

### `GET /api/liquidaciones-terceros-pagos/comprobante/:pagoId`

**Respuesta 200** — `{ success: true, data: { url } }`, URL firmada de S3 válida
15 minutos, para un pago vivo o archivado de un cierre vivo. 404 si el pago no
existe o no tiene comprobante.

## Efectos

- Sube archivos a S3 (ver [integraciones](../integraciones.md)). Si el usuario
  cancela después de subir, el archivo queda sin fila que lo use: es el precio
  asumido de no mandar el archivo dentro del cambio de estado, que es JSON.
- Las escrituras que terminan bien dejan fila en `registro_actividad` (ver
  [actividad](./actividad.md)).

La clave del comprobante se exige con forma exacta (prefijo, mes y UUID,
`CLAVE_COMPROBANTE_PAGO_TERCERO`) tanto aquí como en el `pago` del cambio de
estado: sin eso, quien puede marcar pagada podría ligar al cierre la clave de
otro documento del bucket y leerlo después por la URL firmada.
