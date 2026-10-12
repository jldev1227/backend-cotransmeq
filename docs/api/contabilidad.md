# Contabilidad: conciliación de facturas con terceros

`/api/contabilidad` · código en [`src/modules/contabilidad/`](../../src/modules/contabilidad/) · permiso [`contabilidad`](../permisos.md#catálogo-de-módulos)

Herramienta de contabilidad que cruza dos archivos que sube el usuario: el
**movimiento auxiliar por cuenta contable** exportado del software contable y el
**historial de liquidaciones de servicios para terceros**. Empareja por número de
factura y devuelve qué facturas cuadran, cuáles están solo en un lado, qué
liquidaciones están anuladas y dónde hay diferencias de monto. No lee ni escribe
la base de datos: todo sale de los dos archivos.

Cómo concilia (`conciliacion-terceros.service.ts`):

- Acepta CSV o Excel (SheetJS lee el primer libro/hoja). La fila de encabezados
  se busca en las primeras 15 filas y las columnas se ubican por palabras clave,
  no por posición. Los números admiten `$`, puntos de miles y coma decimal.
- **Archivo contable**: la fila de encabezados contiene «Código contable» o
  «Comprobante». Columnas: código y cuenta contable, comprobante, fecha,
  identificación, nombre del tercero, saldo inicial, débito, crédito. Se saltan
  las filas sin comprobante y las de totales. El número de factura sale de los
  dígitos finales del comprobante (`FV-2-4059` → `4059`).
- **Archivo de liquidaciones**: la fila de encabezados contiene `CLIENTE` y
  (`LIQUIDACION` o `PLACA`). Columnas: cliente, n.º de liquidación, placa, nombre
  del tercero, descripción, fechas, V/UNIDAD, CANT, ADMON, TOTAL, V/LIQUIDAR,
  planilla, ingresos extra (global y aval), `INGRESO COTRANSMEQ`, FACTURA,
  LIQUIDADO y orden de compra. Una fila cuya factura o columna «liquidado» diga
  `ANULAD…` va a `anuladas` y no se concilia.
- Del lado contable solo cuentan los créditos de cuentas cuyo nombre contiene
  `ING`, `RECIBIDO` y `TERCERO` (ingresos recibidos para terceros). Una factura
  está `ok` si `|crédito − Σ V/LIQUIDAR| < 1`; si no, `diferencia`.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `POST` (las dos rutas) | `contabilidad:full` (`permisoPorMetodo('contabilidad')`, escritura por defecto): Administración y Contabilidad |

Las dos rutas son de cálculo puro pero van por `POST` (suben archivos), así que
piden el nivel de escritura.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/contabilidad/conciliacion-terceros` | `contabilidad:full` | Procesa los dos archivos y devuelve la conciliación en JSON |
| POST | `/api/contabilidad/conciliacion-terceros/excel` | `contabilidad:full` | Mismo proceso, devuelve un Excel |

### `POST /api/contabilidad/conciliacion-terceros`

**Body** — `multipart/form-data` con dos archivos:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `contable` | archivo CSV/Excel | sí | Movimiento auxiliar por cuenta contable |
| `liquidaciones` | archivo CSV/Excel | sí | Historial de liquidaciones para terceros |

Otros campos del multipart se ignoran. No hay límite propio de tamaño: rige el
global del multipart (200 MB por archivo, `src/app.ts`) y los dos archivos se
cargan en memoria.

**Respuesta 200** — objeto plano (sin envoltorio):

```json
{
  "resumen": { "totalRegistrosContables": 0, "totalLiquidaciones": 0,
    "facturasUnicas_contable": 0, "facturasUnicas_historial": 0, "conciliadas": 0,
    "soloEnContable": 0, "soloEnHistorial": 0, "anuladas": 0,
    "totalCredito": 0, "totalHistorial": 0, "diferenciasDetectadas": 0 },
  "conciliadas": [{ "numFactura": "4059", "cliente": "…", "comprobante": "FV-2-4059",
    "fechaElaboracion": "…", "identificacion": "…", "terceroContable": "…",
    "creditoContable": 0, "debitoContable": 0, "liquidaciones": [{ "numLiquidacion": "…", "placa": "…",
      "nombreTercero": "…", "descripcion": "…", "fechas": "…", "total": 0, "valorLiquidar": 0,
      "ingresoTransmeralda": 0 }],
    "valorLiquidarTotal": 0, "ingresoTransmeraldaTotal": 0, "diferencia": 0, "estado": "ok" }],
  "soloContable": [{ "numFactura": "…", "comprobante": "…", "creditoContable": 0, "observacion": "…" }],
  "soloHistorial": [{ "numFactura": "…", "cliente": "…", "liquidaciones": [], "totalHistorial": 0, "observacion": "…" }],
  "anuladas": [{ "numLiquidacion": "…", "cliente": "…", "placa": "…", "total": 0, "numFactura": "…", "observacion": "Liquidación anulada" }]
}
```

`soloContable` tiene una fila por registro de cuenta de terceros (no por
factura); las facturas del contable sin registros de esas cuentas se omiten.
`totalHistorial` suma `V/LIQUIDAR` de las liquidaciones no anuladas.

**Errores** (`{ error }`)

| Código | Cuándo |
|---|---|
| 400 | Falta el campo `contable` o `liquidaciones` |
| 400 | Uno de los archivos no produjo ningún registro válido |
| 500 | No se encontró la fila de encabezados (mensaje del parser), o cualquier otro fallo |

### `POST /api/contabilidad/conciliacion-terceros/excel`

Mismo body. Si falta alguno de los dos archivos → 400
`{ "error": "Se requieren ambos archivos (contable y liquidaciones)" }`.

**Respuesta 200** — `.xlsx` con hojas `Resumen`, `Conciliadas`,
`Solo en Contable`, `Solo en Historial` y `Anuladas`;
`Content-Disposition: attachment; filename="conciliacion_terceros_AAAAMMDD.xlsx"`.
Sin `Access-Control-Expose-Headers`, así que desde otro origen el navegador no
deja leer ese nombre. Errores de parseo → 500 `{ error }`.

## Efectos

Ninguno: no toca la base, no emite eventos ni escribe archivos. Las dos rutas
están excluidas del registro de actividad.

## Observaciones

- Un archivo sin la fila de encabezados esperada es un error del usuario pero
  sale como **500** (el parser lanza un `Error` y el controlador no lo distingue).
  (`conciliacion-terceros.controller.ts`)
- `/excel` no comprueba que haya registros, a diferencia de la ruta JSON: con
  archivos sin datos válidos devuelve un Excel en ceros.
- Los archivos subidos se leen con `xlsx` 0.18.5 (`XLSX.read`), versión con
  avisos públicos para archivos manipulados (CVE-2023-30533, contaminación de
  prototipo; CVE-2024-22363, ReDoS). La exposición se limita a usuarios con
  `contabilidad:full`.

## Diferencias con Transmeralda

- En el archivo de liquidaciones, la columna de ingreso de la empresa se busca
  como `INGRESO COTRANSMEQ` aquí e `INGRESO TRANSMERALDA` en Transmeralda. Con el
  encabezado de la otra empresa la columna no se encuentra y todos los ingresos
  salen en 0.
- El nombre del campo en el JSON es el mismo en los dos repos
  (`ingresoTransmeralda`, `ingresoTransmeraldaTotal`), aunque aquí lleva el
  ingreso de Cotransmeq; en el Excel la columna se titula «Ingreso Cotransmeq»
  (en Transmeralda, «Ingreso Transmeralda»).
