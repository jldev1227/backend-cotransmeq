# Formularios SARLAFT + PTEE

`/api/public/formularios-sarlaft` (público) y `/api/formularios-sarlaft` (dashboard) · código en [`src/modules/formularios-sarlaft/`](../../src/modules/formularios-sarlaft/) · permiso [`sarlaft`](../permisos.md#catálogo-de-módulos) en el dashboard

Formularios de cumplimiento (Resoluciones 2328 y 14673 de 2025, Ley 1581 de
2012) que diligencian terceros desde la landing, sin cuenta: conocimiento de
cliente/proveedor (`GC-FR-04`), de accionistas (`GC-FR-05`) y de personal
(`GC-FR-06`), más dos formatos **individuales** que no salen en el selector
público y se piden por código desde su propia ruta: la autorización del
propietario del vehículo (`SLFT-PTEE-FR-12`, que conserva su código original) y
la declaración de empresa de transporte (`GC-FOR-13`, con `FOR` como está
impreso). Las definiciones (secciones y preguntas) son constantes en código
(`formularios-sarlaft.constants.ts`), no tablas. Cada envío crea un
**radicado** en `formulario_sarlaft_ptee` (respuestas en JSON, datos clave
indexados, IP, user agent y referer, estado `recibido`), sus anexos en S3
(`formulario_sarlaft_ptee_documento`, con SHA-256) y una notificación por correo
a los buzones autorizados; el Oficial de Cumplimiento lo evalúa desde el
dashboard.

La declaración de empresa de transporte (`GC-FOR-13`) es distinta de los otros
cuatro: su documento no lo arma el generador HTML genérico sino que se dibuja
sobre el PDF controlado de la marca (template con SHA-256 verificado, marcado
`aprobado`) y el binario exacto se archiva y se versiona. Reglas que un
integrador necesita saber:

- **Radicado**: `SARLAFT-AAAA-CLI|ACC|PER-#####`, `AUTPROP-AAAA-#####` o
  `DECL-TRA-AAAA-#####`. El correlativo sale de contar los envíos del año y
  tipo; ante una colisión con el índice único se reintenta hasta cinco veces
  desplazando el número.
- **Validación en servidor**: obligatorios de las secciones y preguntas
  visibles (condicionales `Se diligencia si <ID> = <valor>` y
  `condicional_pregunta`), tablas repetibles (arreglo de filas bajo
  `key_tabla`, p. ej. `CLI-CA__rows`), porcentajes entre 0 y 100 (admite coma
  decimal) y anexos obligatorios según el formato y el tipo de cliente.
- **Anexos**: un archivo por tipo, en el campo multipart `doc_<tipo>`; 10 MB
  como máximo y extensión `.pdf`, `.jpg`, `.jpeg`, `.png`, `.webp`, `.heic` o
  `.heif` (y MIME acorde). Los campos con un tipo que el formato no pide se
  ignoran.
- **`GC-FOR-13` es transaccional con su PDF**: si la generación o el archivo
  del documento falla, se borra el radicado (borrado físico, rollback de lo
  creado en la misma llamada) y el envío no cuenta. La versión 1 queda
  `recibida`; cada decisión final (`aprobado`, `condicionado`, `rechazado`)
  emite una versión **nueva** `evaluada` con la casilla de resultado marcada;
  ninguna se sobrescribe. `en_revision` y `escalado` no emiten nada (`escalado`
  no es `condicionado`).
- **`GC-FOR-13` valida además**: doble digitación del correo
  (`correo_confirmacion`, fuera de `respuestas`, no se archiva), aceptación
  expresa, un solo estado de alertas (`DET-CNF-02`), observaciones obligatorias
  si hay alertas o alguna confirmación es «No», `anexo_alertas` obligatorio si
  hay alertas, firma PNG o JPG de hasta 2 MB y longitudes máximas por celda
  (`declaracion-transporte.validacion.ts`).
- **Enlace de descarga del declarante** (solo `GC-FOR-13`): token aleatorio de
  32 bytes (base64url) entregado una vez en la respuesta del envío; en base solo
  vive su SHA-256. Vence a los `SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS` (3600 por
  defecto, tope 24 h). El radicado nunca sirve de credencial.
- **Correo**: la notificación interna va a los dos buzones autorizados de
  `sarlaft-config.ts` (reciben todos los tipos) con el PDF, los anexos y las
  firmas como PNG; nunca BCC. Los destinatarios se pueden sobrescribir por tipo
  con `SARLAFT_EMAILS_*`, pero solo con direcciones de la lista blanca
  `CANALES_AUTORIZADOS`. `SARLAFT_EMAIL_MODE=sandbox` redirige todo a
  `SARLAFT_TEST_RECIPIENT` y está prohibido con `NODE_ENV=production` (el
  resolutor lanza). La copia al declarante está apagada salvo
  `SARLAFT_CLIENT_COPY_ENABLED=true`.

Documentación previa: [`SARLAFT_PTEE.md`](../../SARLAFT_PTEE.md) (visión
general; su tabla de rutas omite `documentos-generados`, y el control por área
que menciona lo aplica también la API con el módulo `sarlaft`, ver Acceso),
[`README_DECLARACION_EMPRESA_TRANSPORTE.md`](../../README_DECLARACION_EMPRESA_TRANSPORTE.md)
(vigente: template, ciclo documental, modo de correo) y el diseño original en
[`../sarlaft-declaracion-empresa-transporte/README.md`](../sarlaft-declaracion-empresa-transporte/README.md)
(propone enviar siempre la copia al declarante; el código la dejó apagada por
defecto).

## Acceso

| Operación | Guarda |
|---|---|
| `GET /api/public/formularios-sarlaft`, `…/:codigo`, `…/:codigo/documentos`, `…/contacto` | `pública` |
| `POST /api/public/formularios-sarlaft` | `pública`, sin límite de intentos ni captcha |
| `GET /api/public/formularios-sarlaft/documentos/descargar` | `pública · token`: `?token=` (20–128 caracteres); se busca por su SHA-256 en `formulario_sarlaft_ptee_documento_entrega` y se rechaza si no existe, está `revocado` o venció |
| `GET /api/formularios-sarlaft/**` (las seis lecturas del dashboard) | `sesión` + `sarlaft:read` (`[authMiddleware, requirePermission('sarlaft', 'read')]` en el `preHandler` de cada ruta). `sarlaft` es `full` para `administracion` y `talento_humano`; nadie más lo tiene por área |
| `PATCH /api/formularios-sarlaft/:id/evaluacion` | `sesión` + `sarlaft:full` |

Las validaciones de esquema de Fastify (enums, `format: uuid`, `required`)
responden 400 con su formato por defecto (`{ statusCode, error, message }`)
antes de llegar al controlador.

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/public/formularios-sarlaft` | pública | Formularios del selector público (solo categoría `sarlaft`) |
| GET | `/api/public/formularios-sarlaft/:codigo` | pública | Definición completa de un formato |
| GET | `/api/public/formularios-sarlaft/:codigo/documentos` | pública | Anexos que pide ese formato |
| GET | `/api/public/formularios-sarlaft/contacto` | pública | Canal de contacto según el tipo de formulario |
| POST | `/api/public/formularios-sarlaft` | pública | Radica un envío (multipart) |
| GET | `/api/public/formularios-sarlaft/documentos/descargar` | pública · token | Descarga el PDF de la declaración con el enlace temporal |
| GET | `/api/formularios-sarlaft` | `sarlaft:read` | Listado paginado de radicados |
| GET | `/api/formularios-sarlaft/:id` | `sarlaft:read` | Detalle con respuestas, anexos y versiones documentales |
| GET | `/api/formularios-sarlaft/:id/documentos/:docId/url` | `sarlaft:read` | URL firmada (5 min) de un anexo |
| PATCH | `/api/formularios-sarlaft/:id/evaluacion` | `sarlaft:full` | Estado y concepto de la evaluación interna |
| GET | `/api/formularios-sarlaft/:id/pdf` | `sarlaft:read` | PDF del radicado |
| GET | `/api/formularios-sarlaft/:id/documentos-generados/:docId/pdf` | `sarlaft:read` | Binario archivado de una versión documental |
| GET | `/api/formularios-sarlaft/:id/evidencia` | `sarlaft:read` | ZIP con el PDF y todos los anexos |

### `GET /api/public/formularios-sarlaft`

Solo los formatos de categoría `sarlaft` (`GC-FR-04`, `GC-FR-05` y
`GC-FR-06`); los individuales se piden por código.

**Respuesta 200** (filtrada por el esquema de respuesta de la ruta):

```json
{ "success": true,
  "formularios": [ { "codigo": "GC-FR-04", "tipo": "cliente_proveedor", "titulo": "…", "version": "…",
                     "fecha_documento": "…", "total_secciones": "…", "total_preguntas": "…" } ],
  "marco_normativo": ["Resolución 2328 de 2025", "Resolución 14673 de 2025", "Ley 1581 de 2012", "Decreto 1377 de 2013"],
  "empresa": "COTRANSMEQ S.A.S." }
```

`empresa` sale de `SARLAFT_EMPRESA_NOMBRE` y vale `COTRANSMEQ S.A.S.` si no
está definida.

### `GET /api/public/formularios-sarlaft/:codigo`

`:codigo` ∈ `GC-FR-04`, `GC-FR-05`, `GC-FR-06`, `SLFT-PTEE-FR-12`,
`GC-FOR-13`; otro valor lo rechaza el esquema con 400 (el 404 del controlador
no se alcanza).

**Respuesta 200** — `{ success, formulario }` con la definición tal cual
(`codigo`, `nombre_formato`, `titulo`, `version`, `fecha_documento`,
`archivo_origen`, `tipo`, `categoria`, `secciones[]` con `seccion`,
`tipo_bloque`, `condicional`, `key_tabla`, `nota` y `preguntas[]` con `id`,
`pregunta`, `tipo_respuesta`, `modo_respuesta`, `opciones`, `obligatorio`,
`nota`, `condicional_pregunta`, `formato`) más `total_secciones` y
`total_preguntas`. `GC-FOR-13` trae `fecha_documento` vacío: el formato no
tiene fecha de vigencia impresa.

### `GET /api/public/formularios-sarlaft/:codigo/documentos`

**Query**

| Parámetro | Tipo | Descripción |
|---|---|---|
| `tipo_cliente` | `Persona Natural` \| `Persona Jurídica` | En `GC-FR-04`, `composicion_accionaria` solo se pide a Persona Jurídica |
| `alertas` | `No existen alertas pendientes` \| `Existen alertas informadas en documento anexo` | En `GC-FOR-13` decide si `anexo_alertas` es obligatorio |

**Respuesta 200** — `{ success, documentos: [{ id, nombre, descripcion,
aplicaA, obligatorio }], config: { max_bytes, mimes_permitidos,
extensiones_permitidas } }`. Por formato: `GC-FR-04` cédula, RUT, certificado
de existencia (+ composición accionaria si es PJ), todos obligatorios;
`GC-FR-05` los cuatro, obligatorios; `GC-FR-06` los cuatro, solo cédula y RUT
obligatorios; `SLFT-PTEE-FR-12` once anexos, seis obligatorios; `GC-FOR-13`
`anexo_alertas` (condicional) y `relacion_vehiculos` (opcional). 404
`{ success: false, error: 'Formulario no encontrado' }` con un código
desconocido (esta ruta no tiene `enum`).

### `GET /api/public/formularios-sarlaft/contacto`

**Query**: `tipo` (obligatorio) ∈ `cliente_proveedor`, `accionistas`,
`personal`, `autorizacion_propietario`, `declaracion_empresa_transporte`.

**Respuesta 200** — `{ success, contacto: { tipo, area_responsable,
telefono_principal, telefono_wa, telefono_tel, correo_publico, correo_mailto } }`,
con `telefono_wa` como enlace `https://wa.me/…` y `telefono_tel` como `tel:+…`.
Los valores salen de `sarlaft-config.ts`: un mismo teléfono para todos los
tipos (sobrescribible con `SARLAFT_TELEFONO` y `SARLAFT_TELEFONO_WA`) y un
`correo_publico` por tipo (Compras para cliente/proveedor, Cumplimiento para el
resto).

### `POST /api/public/formularios-sarlaft`

`multipart/form-data`. Un `preHandler` de la ruta recorre las partes y carga en
memoria todos los archivos antes de llegar al controlador.

**Partes**

| Parte | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `payload` | texto (JSON) | sí | Ver tabla siguiente |
| `doc_<tipo>` | archivo | según formato | `<tipo>` es un id de anexo de `GET …/:codigo/documentos`; uno por tipo |

**`payload`** (`submitFormularioSarlaftSchema`, Zod)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `codigo_formulario` | enum | sí | `GC-FR-04`, `GC-FR-05`, `GC-FR-06`, `SLFT-PTEE-FR-12` o `GC-FOR-13` |
| `respuestas` | objeto | sí | `{ <idPregunta>: string \| number \| null \| string[] }`, o para tablas `{ <key_tabla>: [{ <idPregunta>: valor }] }`. Las firmas van como data URL PNG, JPEG o WebP en base64 (ver abajo) |
| `fecha_diligenciamiento` | `YYYY-MM-DD` | no | Se guarda como fecha |
| `correo_confirmacion` | string ≤ 254 | solo `GC-FOR-13` | Tiene que coincidir con `DET-REP-04`; no se archiva |
| `contexto` | `{ user_agent?, referer? }` | no | Se valida y no se usa: el servidor toma IP, user agent y referer de la petición |

**Firmas.** El valor viene del formulario público y acaba dentro de un
`<img src="…">` del PDF, así que solo cuenta como firma si es base64 completo,
de principio a fin: `^data:image/(png|jpe?g|webp);base64,[A-Za-z0-9+/=\s]+$`
(`pdf-generator-sarlaft-html.service.ts` al pintar el PDF de `GC-FR-04`,
`GC-FR-05`, `GC-FR-06` y `SLFT-PTEE-FR-12`, y `formularios-sarlaft.service.ts`
al adjuntarla al correo). Un valor que no cumple se guarda en `respuestas` tal
cual, pero no se pinta (el PDF muestra «No se adjuntó firma») ni se adjunta. En
`GC-FOR-13` una firma que no cumple su propio formato (PNG o JPG de hasta 2 MB,
`esFirmaValida`) rechaza el envío con 422.

En `GC-FR-04`, la tabla de composición accionaria (`CLI-CA__rows`) tiene sus
cinco columnas obligatorias y no lleva condicional: exige al menos una fila
completa, también a Persona Natural.

**Respuesta 201**

```json
{ "success": true, "radicado": "SARLAFT-2026-CLI-00042", "fecha_envio": "…",
  "tipo_formulario": "cliente_proveedor", "codigo_formulario": "GC-FR-04",
  "nombre_completo": "…", "documentos_adjuntos": 3, "mensaje": "Formulario y documentos recibidos exitosamente. …" }
```

En `GC-FOR-13` añade `documento: { id, nombre_archivo, sha256,
version_documento, download_url, expires_at }` (el enlace temporal de descarga:
el token solo sale del servidor aquí y, si está activa, en la copia por correo)
y, si la copia al declarante está habilitada, `entrega_email:
{ destinatario_enmascarado, estado, provider_message_id }`.

**Errores** (`{ success: false, error, details? }`)

| Código | Cuándo |
|---|---|
| 400 | No es multipart o falta la parte `payload` (`Falta el campo "payload"…`); `payload` no es JSON |
| 422 | Zod rechaza el `payload` (`error: 'Datos inválidos'`, `details: ['ruta: mensaje']`) |
| 422 | Obligatorios pendientes o porcentajes fuera de rango (`Hay campos pendientes o con datos inválidos`, `details` con cada problema) |
| 422 | Un anexo supera 10 MB o tiene extensión/MIME no permitidos (sin `details`) |
| 422 | `GC-FOR-13` incoherente (`La declaración tiene datos inconsistentes`, `details`) |
| 422 | Faltan anexos obligatorios (`details: ['Falta adjuntar: …']`) |
| 500 | Cualquier otro fallo, con mensaje genérico; incluye el 409 de radicado agotado (ver Observaciones) |

### `GET /api/public/formularios-sarlaft/documentos/descargar`

**Query**: `token` (20–128 caracteres; fuera de eso, 400 del esquema).

**Respuesta 200** — el PDF archivado de la versión documental a la que apunta
el token, `Content-Disposition: attachment; filename="<codigo>_v<N>.pdf"`,
`Cache-Control: no-store, private`, `X-Content-Type-Options: nosniff`. Cada
descarga marca la entrega como `descargado`.

**Errores**: 404 `{ success: false, error: 'El enlace de descarga no es válido o
ya venció.' }` para token inexistente, revocado o vencido (mismo mensaje en
todos los casos, para no confirmar qué tokens existieron); 404 `Documento no
disponible.` si el objeto no está en S3; 500 `No se pudo procesar la descarga.`
(el token nunca se registra).

### `GET /api/formularios-sarlaft`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `page` | entero ≥ 1 | 1 | |
| `limit` | entero 1–100 | 20 | |
| `search` | string | — | En radicado, nombre, número de documento y correo, sin distinguir mayúsculas |
| `tipo_formulario` | enum | — | Los cinco tipos |
| `estado` | string | — | Igualdad exacta, sin enum |
| `fecha_desde`, `fecha_hasta` | `YYYY-MM-DD` | — | Sobre `fecha_envio`, convertidas a medianoche UTC (ver Observaciones) |
| `orden` | enum | `fecha_envio` | `fecha_envio`, `radicado`, `nombre_completo`, `tipo_formulario`, `estado` (lista blanca también en el servicio) |
| `direccion` | `asc` \| `desc` | `desc` | |

**Respuesta 200** — `{ success, items: [{ id, radicado, codigo_formulario,
tipo_formulario, version, fecha_envio, fecha_diligenciamiento, nombre_completo,
tipo_documento, numero_documento, correo, telefono, estado, documentos_count,
evaluado_por: { id, nombre } | null }], pagination: { page, limit, total, pages } }`.

### `GET /api/formularios-sarlaft/:id`

`:id` uuid. **Respuesta 200** — `{ success, formulario }` con los datos del
listado más `evaluacion_concepto`, `evaluacion_observaciones`, `evaluado_at`,
`evaluado_por` (con correo), `ip_origen`, `user_agent`, `referer`, `respuestas`
(incluidas las firmas como data URL), `definicion` (la del código, para pintar
genéricamente), `documentos[]` (`id`, `tipo_documento`, `nombre_archivo`,
`s3_key`, `mime_type`, `tamano_bytes`, `hash_sha256`, `created_at`) y
`documentos_generados[]` (versiones de `GC-FOR-13`, de la más nueva a la más
vieja, con hashes del template y del PDF, `generado_por` y `entregas[]` sin el
token). 404 `{ success: false, error: 'Formulario no encontrado' }`.

### `GET /api/formularios-sarlaft/:id/documentos/:docId/url`

**Respuesta 200** — `{ success, id, nombre_archivo, mime_type, tamano_bytes,
url, expires_in: 300 }`: URL firmada de S3 de cinco minutos. El anexo se busca
solo por `:docId` (uuid); `:id` no se usa. 404 `Documento no encontrado`.

### `PATCH /api/formularios-sarlaft/:id/evaluacion`

**Body** (esquema JSON de Fastify)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `estado` | enum | no | `recibido`, `en_revision`, `aprobado`, `condicionado`, `rechazado`, `escalado` (`ESTADOS_ADMINISTRATIVOS`) |
| `concepto` | string \| null | no | Columna de 50 caracteres |
| `observaciones` | string \| null | no | |

Siempre escribe `evaluado_por_id` (el usuario del token) y `evaluado_at`, aunque
el body venga vacío. En `GC-FOR-13`, si el estado resultante es una decisión
final emite una versión `evaluada` nueva del PDF (S3 + fila); si esa emisión
falla, la evaluación queda guardada y el error solo va al log.

**Respuesta 200** — `{ success, formulario }` con la fila actualizada tal cual
sale de Prisma (columnas en snake_case, `respuestas` incluidas).

**Errores**: 400 del esquema (estado fuera del enum, `:id` no uuid); 500
`{ success: false, error: <mensaje> }` para un id inexistente y cualquier otro
fallo (ver Observaciones).

### `GET /api/formularios-sarlaft/:id/pdf`

- `GC-FOR-13`: devuelve el binario **archivado** de la última versión
  documental (no lo regenera: otro archivo tendría otro hash),
  `<codigo_template>_<radicado>_v<N>.pdf`.
- Los otros cuatro: lo genera en el momento con el generador HTML (Chromium) a
  partir de las respuestas, `SARLAFT_<radicado>.pdf`.

`application/pdf` con `Content-Disposition: attachment`. 404 si el radicado no
existe, su código no tiene definición o (`GC-FOR-13`) no hay versión archivada.

### `GET /api/formularios-sarlaft/:id/documentos-generados/:docId/pdf`

Binario archivado de una versión concreta,
`<codigo_template>_v<N>_<estado_documental>.pdf`. Se busca solo por `:docId`
(uuid); `:id` no se comprueba. 404 `Versión no encontrada` o `Documento no
disponible.`

### `GET /api/formularios-sarlaft/:id/evidencia`

ZIP `Evidencia_SARLAFT_<radicado>.zip` con `01_Resumen_<radicado>.pdf` (el mismo
de `/pdf`; si falla, el ZIP sale sin él) y `02_Adjuntos/<tipo>_<archivo>`. Un
anexo que no se puede leer de S3 se omite. 404 si el radicado no existe.

## Efectos

- **S3**: anexos en `sarlaft/<año>/<radicado>/<tipo>_<timestamp><ext>`;
  versiones documentales de `GC-FOR-13` en
  `sarlaft/<año>/<radicado>/generado/declaracion_transporte_v<N>.pdf`. Si el
  envío falla después de subir anexos, esos objetos se borran.
- **Correo** al radicar: notificación interna (asunto
  `[SARLAFT|PTEE <código>] Nuevo formulario recibido — Radicado …`, enlace a
  `/dashboard/sarlaft/<id>`) con el PDF, los anexos y cada firma como imagen.
  El remitente lo pone `EmailService` según el proveedor activo. Su fallo no
  deshace el radicado. En `GC-FOR-13` queda registrada en
  `formulario_sarlaft_ptee_documento_entrega` (`canal: email_interno`, proveedor
  y `provider_message_id`), igual que la copia al declarante si está activa.
- **Enlace de descarga**: cada envío de `GC-FOR-13` crea una entrega
  `descarga` con `token_hash` y `expires_at`.
- **Chromium**: el PDF genérico de los otros cuatro formatos se imprime con
  `src/services/pdf.service.ts` al radicar (para el correo) y en cada
  `GET …/:id/pdf` o `…/evidencia`.
- **Registro de actividad**: el `PATCH` de evaluación queda en
  `registro_actividad` por el hook global; las rutas públicas no.

## Observaciones

- El 409 «No se pudo asignar un número de radicado» (cinco colisiones seguidas)
  sale como 500 genérico: el controlador solo traduce 400 y 422
  (`formularios-sarlaft.controller.ts`).
- En `GC-FR-04`, `GC-FR-05`, `GC-FR-06` y `SLFT-PTEE-FR-12`, si falla la subida
  de un anexo a S3 a mitad del envío, se borran los objetos ya subidos pero el
  radicado y las filas de anexos ya creadas se quedan, apuntando a objetos que
  ya no existen; el declarante recibe 500 y al reintentar genera otro radicado
  (`formularios-sarlaft.service.ts`).
- El `POST` público no tiene límite de intentos y el `preHandler` carga en
  memoria todas las partes del multipart antes de validar nada (tope por
  archivo del plugin global: 200 MB; los 10 MB del formato se comprueban
  después).
- El token de descarga no es de un solo uso: el canje marca la entrega como
  `descargado` pero no la rechaza la siguiente vez, así que el enlace sirve
  hasta `expires_at`. El comentario del controlador dice que un token «ya
  consumido» da 404 (`declaracion-transporte-documentos.service.ts`).
- `PATCH …/evaluacion` sobre un `GC-FOR-13` que ya está en una decisión final
  emite otra versión `evaluada` en cada guardado, aunque solo cambien las
  observaciones: se decide con el estado resultante, no con el que llega
  (`formularios-sarlaft.service.ts`).
- `PATCH …/evaluacion` con un id inexistente o un `concepto` de más de 50
  caracteres responde 500 con el mensaje crudo de Prisma; en general los 500
  del dashboard devuelven `err.message`.
- `fecha_desde`/`fecha_hasta` se convierten con `new Date('YYYY-MM-DD')`
  (medianoche UTC): `fecha_hasta` deja fuera el propio día y, en hora de
  Bogotá, la ventana empieza y termina a las 19:00 del día anterior.
- `…/documentos/:docId/url` y `…/documentos-generados/:docId/pdf` ignoran `:id`:
  no comprueban que el anexo o la versión sean de ese radicado.

## Diferencias con Transmeralda

- **Códigos de formato**: Transmeralda usa `SLFT-PTEE-FR-04`, `-05`, `-06` y
  `-13` donde aquí van `GC-FR-04`, `GC-FR-05`, `GC-FR-06` y `GC-FOR-13`
  (`SLFT-PTEE-FR-12` es igual en los dos). Cambian el `enum` de
  `GET /api/public/formularios-sarlaft/:codigo` y el de `codigo_formulario` en
  el `payload` del envío; tipos, anexos, radicados y series son los mismos.
- **Declaración de empresa de transporte**: en Transmeralda el template
  `SLFT-PTEE-FR-13` está `pendiente_aprobacion` y `assertTemplateEmitible()`
  impide emitirlo con `NODE_ENV=production`: allí el `POST` de ese formato
  responde 500 y no se radica, y las decisiones finales no emiten versión
  `evaluada`.
- **Tabla de composición accionaria del formato de cliente/proveedor**: en
  Transmeralda sus cinco columnas son opcionales y admite cero filas; aquí son
  obligatorias (422 si falta).
- **`GET /api/public/formularios-sarlaft`**: en Transmeralda `empresa` es fijo
  (`TRANSMERALDA S.A.S.`); aquí sale de `SARLAFT_EMPRESA_NOMBRE`.
- **Contacto y destinatarios**: en Transmeralda los buzones y teléfonos son
  constantes por tipo en `sarlaft-config.ts`, sin variables de entorno ni lista
  blanca; aquí los dos buzones autorizados reciben todos los tipos, con
  `SARLAFT_EMAILS_*`, `SARLAFT_TELEFONO` y `SARLAFT_TELEFONO_WA` como
  sobrescritura. Cambian los valores de
  `GET /api/public/formularios-sarlaft/contacto`, no su forma.
