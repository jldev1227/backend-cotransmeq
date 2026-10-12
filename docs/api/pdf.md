# PDF desde HTML

`/api/pdf/from-html` · código en [`src/modules/pdf/`](../../src/modules/pdf/) · sin permiso de módulo (solo sesión)

Convierte en PDF un HTML que manda el cliente, con Puppeteer + Chromium
(`pdfFromHtml` en `src/services/pdf.service.ts`). Es el endpoint genérico que
usaba el preview de liquidaciones de terceros antes de tener su propio PDF
nativo ([`liquidaciones-terceros-pdf`](./liquidaciones-terceros-pdf.md)); sigue
disponible para cualquier pantalla que quiera imprimir un HTML. A diferencia de
los canvas de terceros, no añade fuentes embebidas: el HTML se imprime tal
cual llega.

Como el HTML lo manda el cliente y lo pinta el Chromium del servidor, la
página se prepara con `blindarPagina()` (`src/services/pdf-red.ts`) antes de
cargarlo: sin JavaScript, y cada petición filtrada. Solo cargan `data:`,
`blob:`, `about:` y http(s) hacia direcciones públicas; loopback, redes
privadas, enlace local y metadatos de la nube, CGNAT (Tailscale), nombres sin
punto o de dominios internos, nombres que resuelven a esas direcciones y
cualquier otro esquema (`file:`…) se bloquean. Lo bloqueado no falla la
petición: sale como recurso roto en el PDF. Detalle en
[integraciones](../integraciones.md#pdf).

## Acceso

| Operación | Guarda |
|---|---|
| `POST` | `sesión` (hook `onRequest` del plugin), sin permiso de módulo |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/pdf/from-html` | sesión | Renderiza un HTML a PDF |

### `POST /api/pdf/from-html`

**Body** (sin esquema; límite de cuerpo por defecto de Fastify, 1 MiB)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `html` | string | sí | Documento completo |
| `landscape` | boolean | no | Horizontal salvo `false` |
| `marginMm` | number | no | 3 por defecto |
| `format` | string | no | `Letter` (por defecto), `A4`, `Legal`, `A3`, `A5` o `Tabloid`; otro valor cae a `Letter` |
| `heightScale`, `widthScale` | number | no | Entre 0,5 y 3; fuera de rango se ignoran. Agrandan la página para que quepa una fila más |
| `preferCSSPageSize` | boolean | no | Solo `true` cuenta: el tamaño del `@page` del CSS manda sobre `format`/`landscape`. Pensado para documentos con *named pages* que mezclan orientaciones |
| `filename` | string | no | Se sanea a `[a-z0-9_-]`; `documento` por defecto |

**Respuesta 200** — `application/pdf`, `inline; filename="<filename>.pdf"`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Falta `html` o no es texto | `{ "error": "Falta el campo \"html\" (string con el contenido a renderizar)." }` |
| 413 | Cuerpo por encima de 1 MiB | Formato por defecto de Fastify |
| 500 | Fallo de Chromium | `{ "error": "<mensaje>" }` |

## Efectos

Ninguno. La ruta está excluida del registro de actividad (`/api/pdf`).

## Observaciones

- Abierta a **cualquier** usuario con sesión, sin permiso de módulo, y renderiza
  HTML arbitrario en el Chromium compartido del servidor, lanzado con
  `--no-sandbox`.
- `marginMm` no se valida: un valor negativo o enorme llega tal cual a
  Puppeteer.

## Diferencias con Transmeralda

Transmeralda no acepta `preferCSSPageSize` en esta ruta: el controlador no lo
lee y el tamaño lo deciden siempre `format`, `landscape` y las escalas.
