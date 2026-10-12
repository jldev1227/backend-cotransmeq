# Envío de liquidaciones por correo

`/api/liquidaciones-terceros/envios` · código en [`src/modules/liquidaciones-terceros-envios/`](../../src/modules/liquidaciones-terceros-envios/) · permiso [`liquidaciones-terceros`](../permisos.md#catálogo-de-módulos)

Envía por correo, desde los canvas del dominio de [terceros](./liquidaciones-terceros.md),
la hoja de cada destinatario como PDF adjunto. Tres tipos de lote: `CIERRE`
(una hoja por [cierre](./liquidaciones-terceros-descuentos.md), al propietario
o a cada copropietario), `INGRESO` y `OCASIONAL` (las hojas de
[ingresos](./liquidaciones-terceros-ingresos.md) y de la
[liquidación ocasional](./liquidaciones-terceros-ocasional.md)).

El cliente manda, por destinatario, el **HTML de la hoja** (el mismo del
preview) y una hoja de estilos común; el PDF se renderiza en el servidor dentro
del job, con Puppeteer, igual que el [export ZIP](./liquidaciones-terceros-pdf.md):
`pdfFromHtml`, sin JavaScript y sin acceso a la red interna del servidor (ver
[integraciones](../integraciones.md#pdf)).
Los envíos van por una cola en memoria (`src/queue/envio-liquidaciones-queue.service.ts`):
un lote de 40 placas son varios minutos, demasiado para una petición HTTP, y
los proveedores limitan la ráfaga (pausa de `ENVIO_LIQ_DELAY_MS`, 800 ms por
defecto, entre correos). El correo sale como **contabilidad**: con el SMTP del
Gmail de contabilidad si está configurado (`CONTABILIDAD_SMTP_USER/PASSWORD`),
si no por Resend con el nombre de contabilidad y `Reply-To` a ese buzón, y como
último respaldo por el SMTP global. Cada intento deja una fila en
`liquidacion_tercero_envio` (constancia que sobrevive a reinicios; la cola no).

## Acceso

| Operación | Guarda |
|---|---|
| Todas | `sesión` (hook `onRequest` del plugin) |
| `GET` | `liquidaciones-terceros:limited` (`preHandler` por ruta) |
| `POST …/lote`, `DELETE …/job/:jobId` | `liquidaciones-terceros:limited`; cancelar solo actúa sobre jobs propios |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/liquidaciones-terceros/envios/lote` | `liquidaciones-terceros:limited` | Encola un lote de envíos |
| GET | `/api/liquidaciones-terceros/envios/periodo` | `liquidaciones-terceros:limited` | Estado de envío de cada cierre del periodo |
| GET | `/api/liquidaciones-terceros/envios/historial` | `liquidaciones-terceros:limited` | Constancias de un periodo para ingresos u ocasional |
| GET | `/api/liquidaciones-terceros/envios/cierre/:cierreId` | `liquidaciones-terceros:limited` | Historial de envíos de un cierre |
| GET | `/api/liquidaciones-terceros/envios/status/:jobId` | `liquidaciones-terceros:limited` | Estado de un job de envío |
| DELETE | `/api/liquidaciones-terceros/envios/job/:jobId` | `liquidaciones-terceros:limited` | Cancela un job propio |

### `POST /api/liquidaciones-terceros/envios/lote`

**Body** (`bodyLimit` 40 MiB; sin esquema, validado a mano en el controlador)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `anio`, `mes` | number | sí | |
| `tipo` | `CIERRE` \| `INGRESO` \| `OCASIONAL` | no | `CIERRE` si falta o no es válido |
| `css` | string | sí | Hasta 400.000 caracteres |
| `items` | arreglo | sí | 1 a 120 destinatarios (ver abajo) |
| `asunto` | string | no | Hasta 300 caracteres; admite `{PLACA}`, `{TERCERO}` y `{PERIODO}`. Por defecto `Liquidación {PLACA} — {PERIODO} · Transmeralda` |
| `mensaje` | string | no | Texto plano, hasta 5000 caracteres; se escapa en el correo |
| `es_prueba` | boolean | no | Todo el lote va a `destino_prueba`, sin copias ni BCC y con `[PRUEBA]` en el asunto |
| `destino_prueba` | string | con `es_prueba` | Correo válido |
| `adjuntos_extra` | `[{ filename, base64, contentType? }]` | no | Comunes a todo el lote; hasta 15 MB decodificados en total |

Cada ítem: `{ cierre_id (obligatorio en CIERRE), origen_id?, tercero_id?, placa, tercero_nombre?, titulo?, to, cc?, filename?, html, resumen? }`.
`to` debe ser un correo válido (salvo en prueba); `cc` admite arreglo o cadena
con comas, hasta 5 copias, y se quita el propio destinatario; `html` hasta
6.000.000 caracteres; `resumen` son hasta 4 pares `{ etiqueta, valor }` ya
formateados para la tarjeta del correo. En `CIERRE`, todos los `cierre_id`
deben ser cierres vivos del periodo; en los otros tipos, un `origen_id`
presente debe ser la cabecera de ese periodo.

**Respuesta 200** — `{ "status": "queued", "job_id": "uuid", "total": 12 }`.

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Periodo inválido, falta `css`, lote vacío, ítem sin `cierre_id` o sin `html`, correo o copia inválidos, más de 5 copias, cierre u origen de otro periodo | `{ "error": "<mensaje>" }` |
| 409 | Ya hay un job corriendo para el mismo tipo y periodo | `{ "status": "locked", "locked_by": { "userId", "userName", "jobId", "anio", "mes", "progress", "currentStep" } }` |
| 413 | Más de 120 ítems, una hoja demasiado grande o adjuntos de más de 15 MB | `{ "error": "<mensaje>" }` |
| 500 | Cola llena (5 por defecto, `ENVIO_LIQ_MAX_QUEUE`) y otros fallos | `{ "error": "<mensaje>" }` |

### `GET /api/liquidaciones-terceros/envios/periodo`

**Query** `anio`, `mes` (400 si faltan). **Respuesta 200** —
`{ estados: { "<cierreId>": { cierre_id, ultimo_enviado: { email_destino, enviado_at } | null, ultimo_error: { email_destino, error, created_at } | null, enviados, pruebas, por_destinatario: { "<correo>": { enviado_at } } } }, proveedor }`.
Solo cuenta envíos de tipo `CIERRE`; los de prueba no cuentan como enviados.
`ultimo_error` solo aparece si es lo último que pasó. `por_destinatario`
distingue a cada copropietario de una placa. `proveedor` es
`smtp-contabilidad`, `resend`, `smtp` o `null` si no hay ninguno configurado.

### `GET /api/liquidaciones-terceros/envios/historial`

**Query** `tipo` (`CIERRE` | `INGRESO` | `OCASIONAL`), `anio`, `mes`; 400 si
falta alguno o `tipo` no es válido. **Respuesta 200** —
`{ historial: [{ id, placa, email_destino, asunto, estado, error, es_prueba, adjuntos, enviado_por, enviado_at, created_at }], proveedor }`,
los 100 más recientes.

### `GET /api/liquidaciones-terceros/envios/cierre/:cierreId`

Arreglo con los 50 envíos más recientes del cierre (filas completas de
`liquidacion_tercero_envio`).

### `GET /api/liquidaciones-terceros/envios/status/:jobId` y `DELETE /api/liquidaciones-terceros/envios/job/:jobId`

`GET` devuelve el job sin su payload: `{ id, status (queued|running|complete|error|cancelled), userId, userName, anio, mes, es_prueba, progress, currentStep, processed, total, resultados: [{ cierre_id, origen_id, placa, to, estado: ENVIADO|ERROR, error?, enviado_at? }], error?, createdAt, startedAt?, finishedAt? }`;
404 si no existe o ya expiró (10 minutos tras terminar, `ENVIO_LIQ_JOB_TTL_MS`).

`DELETE` responde `{ "cancelled": true }`; 404 si no existe o no es del
usuario. Un job en curso se detiene al terminar el correo que está enviando: un
correo enviado no se puede des-enviar.

## Efectos

- **Correo** (ver [integraciones](../integraciones.md)). Remitente con el
  nombre `LIQ_EMAIL_FROM_NAME` (por defecto «Contabilidad Cotransmeq S.A.S.»),
  `Reply-To` `LIQ_EMAIL_REPLY_TO` y copia oculta de constancia `LIQ_EMAIL_BCC`.
  Estos dos últimos vienen **vacíos** por defecto (`src/config/env.ts`): sin
  configurarlos no hay BCC de constancia, y por Resend o el SMTP global tampoco
  `Reply-To` (con el SMTP de contabilidad el `Reply-To` es siempre ese buzón).
  En prueba no hay BCC.
- **Constancia**: la fila de `liquidacion_tercero_envio` nace en `ENVIANDO`
  antes de intentar el envío y pasa a `ENVIADO` (con proveedor y `message_id`)
  o `ERROR` (mensaje recortado a 2000 caracteres). `email_destino` guarda
  destinatario y copias.
- **Sockets** (ver [tiempo real](../tiempo-real.md)):
  `envio-liq:queued|start|progress|item|complete|cancelled|error` a
  `user-<id>`, y `envio-liquidacion:actualizado` a la sala del libro
  (`sheet:cierres-finales:<anio>:<mes>`, `sheet:ingresos:<anio>` o
  `sheet:ocasional:<anio>`) por cada correo, también los de prueba (marcados).

## Observaciones

- `GET …/status/:jobId` no comprueba el dueño: con el `jobId` se ven los
  destinatarios y resultados de un envío ajeno (sin el payload).
- **Textos de la otra empresa.** El asunto por defecto es el literal
  `Liquidación {PLACA} — {PERIODO} · Transmeralda` (controlador) y, por Resend
  sin `RESEND_FROM` ni `SMTP_FROM`, el remitente cae a
  `noreply@transmeralda.com` (`envios-email.service.ts`): el código es el mismo
  que en Transmeralda.
