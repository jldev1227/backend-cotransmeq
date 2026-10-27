# PDF de cierres de terceros

`/api/liquidaciones-terceros/:id/pdf`, `/api/liquidaciones-terceros/canvas/*` · código en [`src/modules/liquidaciones-terceros-pdf/`](../../src/modules/liquidaciones-terceros-pdf/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

PDF de los documentos del dominio de [terceros](./liquidaciones-terceros.md),
renderizados en el backend con Puppeteer + Chromium (`src/services/pdf.service.ts`)
en carta horizontal y con las fuentes del documento embebidas como data-URL
(Fraunces, Inter Tight, JetBrains Mono; `fonts.ts`).

Hay dos caminos y la diferencia importa:

- **Liquidación de un cierre** (`GET /:id/pdf`): el HTML lo compone el
  servidor con `liquidaciones-terceros-pdf.template.ts` a partir del detalle del
  cierre. Encabezado del formato «LIQUIDACIÓN DE INGRESOS RECIBIDOS PARA
  TERCEROS» (código GAF-FR-11), periodo, ítems, adicionales, conceptos,
  impuestos y, si aplica, el reparto por copropietario. Es **solo lectura**: no
  recalcula totales ni impuestos antes de imprimir, para no pisar lo que el
  usuario veía con una lógica distinta.
- **Canvas** (`POST /canvas/pdf` y `/canvas/pdf-zip`): el cuerpo lo manda el
  cliente ya renderizado (el mismo HTML y CSS del preview, según la hoja y las
  columnas elegidas) y el servidor solo añade las fuentes y Chromium. Así el
  PDF **es** el preview y no hay una segunda copia de los adaptadores del
  cliente. Sirve para los canvas de cierres, adicionales, ocasional e ingresos,
  y también para el de recorridos.

Los tokens visuales del documento (`pdf-tokens.ts`) son espejo exacto de
`src/lib/styles/pdf-tokens.ts` del frontend; `pdf-tokens.spec.ts` falla si
divergen, porque una divergencia no rompe nada: solo hace que el preview y el
PDF se vean distintos.

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET /api/liquidaciones-terceros/:id/pdf` | `liquidaciones-terceros:limited` (`permisoPorMetodo`) |
| `POST /api/liquidaciones-terceros/canvas/*` | Excluidas de `permisoPorMetodo` con `excepto`; piden `algún(recorridos:read, liquidaciones-terceros:limited)` (`requireAlgunPermiso`), porque el canvas de recorridos también exporta por aquí |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/liquidaciones-terceros/:id/pdf` | `liquidaciones-terceros:limited` | PDF de la liquidación de un cierre |
| POST | `/api/liquidaciones-terceros/canvas/pdf` | `algún(recorridos:read, liquidaciones-terceros:limited)` | PDF de una hoja de canvas a partir de su HTML |
| POST | `/api/liquidaciones-terceros/canvas/pdf-zip` | `algún(recorridos:read, liquidaciones-terceros:limited)` | ZIP con un PDF por hoja |

### `GET /api/liquidaciones-terceros/:id/pdf`

`:id` es el id del cierre. **Respuesta 200** — `application/pdf`, `inline`, con
nombre `liquidacion_<consecutivo>.pdf` (consecutivo de la liquidación de
servicio de referencia o, si no hay, el del cierre) y `Cache-Control: private,
max-age=0, no-store`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 404 | Cierre inexistente o borrado | `{ "error": "Liquidación final de tercero no encontrada" }` |
| 500 | Fallo de Chromium o de la plantilla | `{ "error": "<mensaje>" }` |

### `POST /api/liquidaciones-terceros/canvas/pdf`

**Body** (`bodyLimit` 8 MiB)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `html` | string | sí | Cuerpo del documento, hasta 6.000.000 caracteres |
| `css` | string | sí | Hoja de estilos, hasta 400.000 caracteres; trae el `@page` |
| `filename` | string | no | Se sanea a `[a-z0-9_-]`; `documento` por defecto |
| `landscape` | boolean | no | `false` para vertical; horizontal por defecto |

Se respeta el tamaño de página del CSS (`preferCSSPageSize`). **Respuesta 200**
— `application/pdf` inline.

| Código | Cuándo |
|---|---|
| 400 | Falta `html` o `css` |
| 413 | `html` o `css` por encima del tope (o el cuerpo por encima de 8 MiB, con la respuesta por defecto de Fastify) |
| 500 | Fallo al renderizar |

### `POST /api/liquidaciones-terceros/canvas/pdf-zip`

**Body** (`bodyLimit` 40 MiB): `{ css, documentos: [{ html, filename? }], zipname? }`.
Hasta 120 documentos y 32.000.000 caracteres entre todos; `css` hasta 400.000.
Los nombres se sanean quitando diacríticos («MARÍA» → «MARIA»).

Genera los PDF **de uno en uno** (cuarenta pestañas de Chromium a la vez
agotan la memoria del contenedor) y todos antes de empezar el ZIP, para que un
fallo dé un error claro y no un archivo truncado. **Respuesta 200** —
`application/zip` como adjunto `<zipname>.zip`, enviado en stream.

| Código | Cuándo |
|---|---|
| 400 | Falta `css`, `documentos` vacío o una hoja sin `html` (`La hoja N llegó sin cuerpo`) |
| 413 | Más de 120 hojas o por encima de los topes |
| 500 | Fallo al renderizar; si las cabeceras ya salieron, la respuesta se corta |

## Efectos

Sin escrituras ni eventos. Chromium se lanza una vez por proceso y cada
documento abre y cierra una pestaña. Cada pestaña se prepara con
`blindarPagina()` (`src/services/pdf-red.ts`) antes de cargar el HTML, también
el de los canvas, que manda el cliente: sin JavaScript y con las peticiones
limitadas a `data:`, `blob:`, `about:` y http(s) hacia direcciones públicas,
así que ese marcado no puede hacer que el servidor pida nada de su red interna
(ver [integraciones](../integraciones.md#pdf)). Las fuentes van embebidas como
data-URL y no dependen de la red.

## Observaciones

- El nombre del PDF de un cierre usa el consecutivo de la liquidación de
  **servicio** de referencia antes que el del propio cierre: los cierres de
  varias placas que salen de la misma liquidación de servicio descargan con el
  mismo nombre de archivo.
- El encabezado de la plantilla (`liquidaciones-terceros-pdf.template.ts`) usa
  la razón social SERVICIOS Y TRANSPORTES COTRANSMEQ S.A.S.; la caja de respaldo
  del logo conserva la marca COTRANSMEQ.

## Diferencias con Transmeralda

Mismas rutas, guardas, validación y respuestas. Solo cambia el aspecto del PDF
de un cierre: aquí el logo es `logo_cotransmeq-264.webp` y la paleta de
`pdf-tokens.ts` usa los naranjas de la empresa (las claves conservan el nombre
`verde`, igual que el `app.css` del frontend conserva `--emerald-*`).
