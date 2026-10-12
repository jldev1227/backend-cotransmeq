# Certificados tributarios

`/api/certificados-tributarios`, `/api/tipos-certificado` y `/api/public/certificados-tercero` · código en [`src/modules/certificados-tributarios/`](../../src/modules/certificados-tributarios/) · permiso [`certificados`](../permisos.md#catálogo-de-módulos)

Certificados de retención (retefuente, reteICA, reteIVA…) que la empresa emite a
sus terceros, guardados como PDF en S3 y entregados por correo con un enlace a un
portal público. El módulo tiene cinco archivos de rutas, todos registrados con
prefijo `/api` en `src/app.ts`:

| Archivo | Rutas |
|---|---|
| `certificados.routes.ts` | Carga a S3 (`/upload`, `/import-zip`) y lecturas directas de S3 (`/nits`, `/list`, `/:nit`) |
| `certificado-archivo.controller.ts` | Registro en base (`certificado_archivo`): listados, vínculo con terceros, sincronización y retiro |
| `certificacion-envio.controller.ts` | Envío por correo y constancia de envíos (`certificacion_envio`) |
| `tipo-certificado.controller.ts` | Catálogo `tipo_certificado` (`/api/tipos-certificado`) |
| `certificados-tercero-public.routes.ts` | Portal público del tercero, por enlace con token |

Hay **dos capas que no se sincronizan solas**:

- **S3** es donde viven los PDF, con la clave
  `certificados-tributarios/<nit>/AÑO <anio>/<tipo>/<nombre saneado>`. `/upload` e
  `/import-zip` solo escriben aquí; `/nits`, `/list` y `/:nit` solo leen de aquí.
- **La tabla `certificado_archivo`** es lo que usan los listados por tercero, los
  envíos por correo y el portal público. Un PDF recién cargado no aparece ahí
  hasta que alguien llama a `POST /api/certificados-tributarios/sync-s3`, que
  crea las filas que falten y las vincula al tercero cuya `identificacion` (solo
  dígitos) coincide con el NIT.

Tipos válidos en la clave de S3: `RETEFUENTE`, `RETEICA`, `RETEIVA`, `ICA`, `IVA`,
`RETENCIONES`, `OTROS`. El NIT son 6 a 15 dígitos.

Retirar un certificado es **borrado lógico** del archivo, sus vínculos y sus
envíos: los envíos son la constancia de a quién y cuándo se entregó un documento
tributario, y no se destruyen.

El portal público por NIT (`/public/certificados-tributarios/:nit`) **se retiró
en oct-2026**: devolvía los certificados de cualquier NIT sin verificar nada. Hoy
el tercero entra solo con el enlace que le llega al correo.

## Acceso

| Operación | Guarda |
|---|---|
| `/api/certificados-tributarios/*` y `/api/tipos-certificado*` | `sesión` (hook `onRequest` de cada plugin) |
| `GET` de esas rutas | `certificados:read` (`permisoPorMetodo('certificados')`) |
| `POST`, `PUT`, `DELETE` de esas rutas | `certificados:full` |
| `/api/public/certificados-tercero/*` | `pública` / `pública · token` (ver abajo) |

El módulo `certificados` solo tiene nivel `full` (Administración y Contabilidad),
así que en la práctica las lecturas y las escrituras las hacen las mismas dos
áreas.

**Portal público del tercero**

| Ruta | Guarda |
|---|---|
| `POST /api/public/certificados-tercero/solicitar-acceso` | `pública · límite 30/hora por IP y 3/hora por identificación` (`limitesEnvioDeEnlace`) |
| `GET /api/public/certificados-tercero/verificar-token` | `pública · token` en el query: un `tercero_token` existente y no vencido (UUID aleatorio, 90 días desde que se generó). `límite 60/15 min por IP` |

Al pasar el límite responde 429 con `Retry-After` y
`{ success: false, error: "Demasiados intentos", message, reintentar_en }`. Los
contadores están en memoria del proceso (`src/utils/limitador.ts`) y la IP sale
de `CF-Connecting-IP` (o del primer `X-Forwarded-For`).

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/certificados-tributarios/upload` | `certificados:full` | Sube un PDF a S3 |
| POST | `/api/certificados-tributarios/import-zip` | `certificados:full` | Sube a S3 todos los PDF de un ZIP, con progreso por socket |
| GET | `/api/certificados-tributarios/nits` | `certificados:read` | NITs con certificados en S3 |
| GET | `/api/certificados-tributarios/list` | `certificados:read` | Claves de S3 de un NIT, agrupadas por carpeta |
| GET | `/api/certificados-tributarios/:nit` | `certificados:read` | Documentos de un NIT en S3, con URL firmada |
| GET | `/api/certificados-tributarios/archivos` | `certificados:read` | Certificados registrados en base, paginados, con URL firmada |
| GET | `/api/certificados-tributarios/por-nit/:nit` | `certificados:read` | Certificados registrados de un NIT |
| GET | `/api/certificados-tributarios/tercero/:terceroId` | `certificados:read` | Certificados vinculados a un tercero |
| GET | `/api/certificados-tributarios/terceros-con-certificados` | `certificados:read` | Terceros con certificados vigentes, con filtros y conteos |
| POST | `/api/certificados-tributarios/sync-s3` | `certificados:full` | Registra en base los PDF de S3 que falten |
| POST | `/api/certificados-tributarios/link` | `certificados:full` | Vincula un certificado a un tercero |
| DELETE | `/api/certificados-tributarios/archivo/:id` | `certificados:full` | Retira (borrado lógico) un certificado |
| POST | `/api/certificados-tributarios/enviar-email` | `certificados:full` | Envía certificados de un tercero por correo |
| POST | `/api/certificados-tributarios/enviar-masivo` | `certificados:full` | Envío a varios terceros (por ids o por filtros) |
| GET | `/api/certificados-tributarios/envios` | `certificados:read` | Constancias de envío, paginadas |
| GET | `/api/certificados-tributarios/envios/tercero/:terceroId` | `certificados:read` | Envíos de un tercero |
| GET | `/api/tipos-certificado` | `certificados:read` | Tipos de certificado activos |
| POST | `/api/tipos-certificado` | `certificados:full` | Crea un tipo |
| PUT | `/api/tipos-certificado/:id` | `certificados:full` | Edita un tipo |
| DELETE | `/api/tipos-certificado/:id` | `certificados:full` | Desactiva un tipo |
| POST | `/api/public/certificados-tercero/solicitar-acceso` | `pública · límite` | Manda al correo del tercero un enlace de acceso |
| GET | `/api/public/certificados-tercero/verificar-token` | `pública · token` | Datos del tercero y sus certificados, por el token del enlace |

Las URL firmadas de S3 que devuelven estas rutas duran **1 hora**.

### `POST /api/certificados-tributarios/upload`

**Body** — `multipart/form-data`:

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| archivo (cualquier nombre de campo) | archivo `.pdf` | sí | Solo se mira la extensión; se guarda como `application/pdf` |
| `anio` | entero 2000–2100 | sí | |
| `nit` | string | no | Si falta, se extrae del nombre del archivo (6–15 dígitos al final). Se dejan solo los dígitos |
| `tipo` | uno de los tipos válidos | no | Si falta o no es válido, se deduce del nombre (`FUENTE`, `ICA`, `IVA`; si no, `OTROS`) |

**Respuesta 200**:
`{ "success": true, "nit": "…", "anio": 2025, "tipo": "RETEFUENTE", "archivo": "<nombre original>", "key": "certificados-tributarios/…", "size": 12345, "url": "<firmada>" }`.
Un archivo con el mismo nombre saneado sobrescribe al anterior en S3.

**Errores**: 400 (`Archivo requerido`, `Solo se permiten archivos PDF`,
`NIT inválido…`, `Año inválido…`); 500
`{ error, code: "config_error" }` si faltan variables de AWS, o
`{ error: "Error al subir archivo", details }`.

### `POST /api/certificados-tributarios/import-zip`

**Body** — `multipart/form-data` con un archivo `.zip` (límite global del
multipart: 200 MB) y `anio` (2000–2100). El ZIP se espera como
`[raíz/]<carpeta de tipo>/<archivo>.pdf`: el tipo sale del nombre de la carpeta
padre (admite alias como `RETEFTE`, `RTEICA`, `RETENCION`) o, si no lo reconoce,
del nombre del archivo; el NIT, del nombre del archivo. El año es el del campo
`anio`, no el de las carpetas.

**Respuesta 200** — llega cuando terminó de subir todo (no es un trabajo en
segundo plano):

```json
{ "success": true, "resumen": { "jobId": "uuid", "anio": 2025, "total": 120, "exitosos": 118,
  "fallidos": 0, "omitidos": 2, "errores": [{ "archivo": "…", "motivo": "No se pudo extraer NIT del nombre" }],
  "detalle": [{ "nit": "…", "tipo": "RETEFUENTE", "archivo": "…", "key": "…" }] } }
```

Durante el proceso emite `certificados:import-progress` al room `user-<id>` de
quien sube: `{ jobId, phase: "started" | "processing" | "finished", total, processed, current, result }`.

**Errores**: 400 (sin archivo, no es `.zip`, año inválido); 500 (`config_error`
o `Error al procesar ZIP` con `details`).

### `GET /api/certificados-tributarios/nits`

**Respuesta 200**: `{ success: true, nits: [{ nit, total, anios: ["AÑO 2025", …] }], total }`,
del NIT con más archivos al que menos. Lee S3, no la base.

### `GET /api/certificados-tributarios/list`

**Query**: `nit` (6–15 dígitos; si no, 400 `NIT inválido`).
**Respuesta 200**:
`{ success: true, nit, total, carpetas: { "AÑO 2025/RETEFUENTE": [{ key, size, lastModified }] } }`.
Sin URL firmadas.

### `GET /api/certificados-tributarios/:nit`

Documentos del NIT leídos de S3:
`{ success: true, nit, documentos: [{ id: "<key>", nombre, url, tamano, tipo: "application/pdf", fecha_creacion, carpeta: "AÑO 2025 / RETEFUENTE" }], carpetas: [{ nombre, cantidad }], total }`.

**Errores**: 400 `{ success: false, code: "invalid_nit", error }`; 404
`{ success: false, code: "not_found", nit, error, documentos: [], carpetas: [] }`
si no hay nada; 500 como las demás.

### `GET /api/certificados-tributarios/archivos`

**Query**: `search` (NIT, nombre de archivo o tipo), `page` (1), `limit` (20).
**Respuesta 200**:
`{ success: true, archivos, total, page, totalPages }`; cada archivo es la fila de
`certificado_archivo` (no retirada) con `tercero` (id, nombre, identificación,
correo, teléfono), `tipo_certificado` y `url`.

### `GET /api/certificados-tributarios/por-nit/:nit` y `GET /api/certificados-tributarios/tercero/:terceroId`

Certificados registrados de un NIT, **incluidos los retirados** (aquí no se
filtra `deleted_at`; ver Diferencias) —`{ success, nit, archivos, total }`, con
`tercero`, `tipo_certificado` y `url`—, o los registrados y no retirados de un
tercero (`{ success, certificados }`, con `tipo_certificado` y `url`), del más
reciente al más antiguo. El NIT no se valida.

### `GET /api/certificados-tributarios/terceros-con-certificados`

**Query**

| Parámetro | Tipo | Por defecto | Descripción |
|---|---|---|---|
| `search` | string | — | Nombre, identificación o correo del tercero |
| `anio` | number | — | Solo terceros con certificados de ese año |
| `tipo` | string | — | Solo terceros con certificados de ese tipo |
| `correo` | `con` \| `sin` | — | Con o sin correo registrado |
| `page` | number | `1` | |
| `limit` | number | `10` | Entre 1 y 100 |

Terceros activos y no eliminados con al menos un certificado vigente que cumpla
los filtros.

**Respuesta 200**:

```json
{ "success": true, "terceros": [{ "id": "…", "nombre_completo": "…", "identificacion": "…", "correo": "…",
    "telefono": "…", "tipo_persona": "…", "activo": true, "certificados_archivo": [{ "id": "…", "anio": 2025, "tipo": "…" }],
    "_count": { "certificados_archivo": 3 }, "ultimo_envio": { "emitido_at": "…", "email_destino": "…", "tipo_envio": "masivo" } }],
  "total": 0, "page": 1, "totalPages": 0,
  "conteos": { "terceros": 0, "con_correo": 0, "sin_correo": 0, "certificados": 0 },
  "anios": [2025], "tipos": ["RETEFUENTE"] }
```

`conteos` ignora el filtro de correo (son los contadores de esos mismos botones).

### `POST /api/certificados-tributarios/sync-s3`

Sin body. Recorre todo el prefijo `certificados-tributarios/` del bucket y crea
una fila por cada clave con forma válida que todavía no tenga una, vinculándola
al tercero y al `tipo_certificado` activo cuyo `codigo` coincida. Una clave que ya
tiene fila, aunque esté retirada, cuenta como `skipped` (la `s3_key` es única):
sincronizar no revive certificados retirados.

**Respuesta 200**: `{ success: true, created, skipped, linked, errors }`.

### `POST /api/certificados-tributarios/link`

**Body** (sin validar): `{ "certificado_id": "uuid", "tercero_id": "uuid" }`. Pone
el `tercero_id` en el certificado y crea el vínculo `certificado_tercero` (único
entre vínculos vivos).

**Respuesta 201**: `{ success: true, vinculo }` con el `tercero` completo y el
`certificado` con su tipo. Cualquier fallo (ids inexistentes, vínculo repetido)
→ 400 `{ error: "Error al vincular", details }`.

### `DELETE /api/certificados-tributarios/archivo/:id`

Marca con `deleted_at` el certificado, sus vínculos y sus envíos. **No borra el
PDF de S3** (ver Observaciones).

**Respuesta 200**: `{ success: true, s3_key }`. Inexistente o ya retirado → 400
`{ error: "Error al eliminar", details: "Certificado no encontrado" }`.

### `POST /api/certificados-tributarios/enviar-email`

**Body** (sin esquema)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `tercero_id` | uuid | sí | Tercero destinatario (400 si no existe) |
| `email_destino` | string | sí | No se valida ni se compara con el correo del tercero |
| `certificado_ids` | uuid[] | no | Certificados no retirados que van en el correo. No se comprueba que sean de ese tercero |
| `mensaje_personalizado` | string | no | |
| `tipo_envio` | `individual` \| `masivo` | no | `individual` por defecto |

Genera un `tercero_token` nuevo (90 días), manda el correo y registra una
constancia `certificacion_envio` por certificado.

**Respuesta 200**: `{ success: true, envios, token }`. Cualquier fallo → 400
`{ error: "Error al enviar email", details }`.

### `POST /api/certificados-tributarios/enviar-masivo`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `filtros` | `{ search?, anio?, tipo? }` | uno de los dos | El servidor resuelve los destinatarios: los mismos terceros **con correo** que el listado muestra con esos filtros, todas las páginas. Con `anio`/`tipo` solo se mandan esos certificados |
| `tercero_ids` | uuid[] | uno de los dos | Se ignora si llegan `filtros` |
| `mensaje_personalizado` | string | no | |

Envía uno por uno, al correo registrado de cada tercero, con `tipo_envio: 'masivo'`.

**Respuesta 200**:
`{ success: true, resultados: [{ tercero_id, status: "sent" | "skipped" | "error", token?, reason?, error? }] }`
(`skipped` con `reason` «Sin correo» o «Sin certificados»).

**Errores**: 400 si los filtros no dan ningún tercero con correo, si no llega ni
`tercero_ids` ni `filtros`, o ante otro fallo general.

### `GET /api/certificados-tributarios/envios` y `GET /api/certificados-tributarios/envios/tercero/:terceroId`

Constancias vivas, de la más reciente a la más antigua. El listado general pagina
(`page` 1, `limit` 20) y trae `tercero` (nombre, identificación, correo) y
`certificado` (archivo, NIT, año, tipo): `{ success, envios, total, page, totalPages }`.
El de un tercero devuelve `{ success, envios }` con el certificado y su tipo.
Cada envío incluye `token_acceso`.

### `GET /api/tipos-certificado`, `POST /api/tipos-certificado`, `PUT /api/tipos-certificado/:id` y `DELETE /api/tipos-certificado/:id`

Catálogo con `nombre`, `codigo` (único), `descripcion` y `activo`. El `GET` lista
los activos por nombre: `{ success, tipos }`. El `POST` (201) y el `PUT` toman
esos campos del body sin validar (`activo` solo en el `PUT`) y devuelven
`{ success, tipo }`. El `DELETE` no borra: pone `activo: false` y devuelve
`{ success: true }`. Cualquier error (código repetido, id inexistente) → 400
`{ error, details }` con el mensaje de Prisma.

### `POST /api/public/certificados-tercero/solicitar-acceso`

**Body**: `{ "identificacion": "…" }` (coincidencia exacta con
`terceros.identificacion` de un tercero activo y no eliminado).

Genera un token y manda al correo del tercero el enlace
`<EMAIL_FRONTEND_URL>/public/certificados?token=<token>`.

**Respuesta 200**:
`{ "success": true, "message": "Enlace de acceso enviado a tu correo", "email": "ju***@dominio.com" }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | Falta `identificacion`, o el tercero no tiene correo |
| 404 | No hay tercero activo con esa identificación |
| 429 | Límite de intentos |
| 500 | Fallo al generar el token o al enviar el correo |

### `GET /api/public/certificados-tercero/verificar-token`

**Query**: `token`.

**Respuesta 200**:

```json
{ "success": true,
  "tercero": { "id": "…", "nombre_completo": "…", "identificacion": "…", "correo": "…" },
  "certificados": [{ "id": "…", "nit": "…", "anio": 2025, "tipo": "RETEFUENTE", "filename": "…",
    "tipo_certificado": { "…": "…" }, "url": "<firmada 1 h>" }],
  "expires_at": "…" }
```

**Errores**: 400 sin token; 401 `Token inválido o expirado`; 429 límite; 500.

## Efectos

- **S3**: `/upload` e `/import-zip` escriben en
  `certificados-tributarios/<nit>/AÑO <anio>/<tipo>/…`; las lecturas firman URL de
  1 hora. Ver [integraciones](../integraciones.md).
- **Correo** (`EmailService.sendCertificacionAccessLink`): el envío individual,
  el masivo y la solicitud del portal mandan el enlace
  `/public/certificados?token=…` del frontend (`EMAIL_FRONTEND_URL`, o el primer
  `FRONTEND_URL`). Los envíos desde el panel incluyen además un enlace directo a
  cada certificado, que caduca a la hora. Remitente: Cotransmeq.
- **Socket** `certificados:import-progress` al room `user-<id>` durante
  `/import-zip`. Ver [tiempo real](../tiempo-real.md).
- **Tokens**: cada envío y cada solicitud crean un `tercero_token` de 90 días.
- **Registro de actividad** de las escrituras con sesión; el portal público
  (`/api/public`) está excluido.

## Observaciones

- **El retiro no borra el PDF de S3.** `deleteCertificado` devuelve `s3_key` «para
  que quien llama lo borre», pero el controlador solo la reenvía. El archivo
  sigue saliendo en `/nits`, `/list` y `/:nit`, que leen S3.
  (`certificado-archivo.controller.ts`, `certificado-archivo.service.ts`)
- **Enviar dos o más certificados en un correo choca con un único.**
  `enviarCertificacionEmail` crea una `certificacion_envio` por certificado, todas
  con el mismo `token_acceso`, que es `@unique` en el esquema (y en la migración
  `20260902000000_paridad_transmeralda`). Según el esquema, a partir del segundo
  certificado el `create` falla con P2002 y la ruta responde 400 —o
  `status: "error"` en el masivo— **después** de haber mandado el correo, y la
  constancia queda incompleta. No verificado contra la base.
  (`certificacion-envio.service.ts`)
- `solicitar-acceso` sigue revelando si una identificación es de un tercero y si
  tiene correo (404 / 400 / 200); el límite de intentos solo lo frena.
- Los tokens del portal valen 90 días, se pueden usar sin límite y no se revocan
  (la columna `tercero_token.used` no se usa). Las respuestas de `/envios`,
  `/envios/tercero/:terceroId`, `/enviar-email` y `/enviar-masivo` los devuelven.
- `/enviar-email` no comprueba que los `certificado_ids` sean del `tercero_id` ni
  valida `email_destino`.
- `/import-zip` no corre «en background» como dice la descripción de su
  `schema`: la petición espera a que se suban todos los PDF. El ZIP (hasta 200 MB)
  y cada PDF descomprimido se cargan en memoria.
- `/upload` e `/import-zip` no registran en base: lo cargado no aparece en los
  listados por tercero, en los envíos ni en el portal hasta un `/sync-s3`.
- La descripción del `schema` de `GET /:nit` todavía dice «para el portal
  público»: hoy la ruta pide sesión y `certificados:read`.
- `certificado-archivo.service.ts` y `tipo-certificado.service.ts` crean su propio
  `new PrismaClient()` en vez de usar el compartido (`src/config/prisma`): dos
  pools de conexiones más.
- Los errores de `link`, `tipos-certificado` y `enviar-email` devuelven el
  mensaje de Prisma en `details`.
- `GET /api/certificados-tributarios/por-nit/:nit` devuelve también los
  certificados retirados, con URL firmada: `getCertificadosByNit` no filtra
  `deleted_at` (`certificado-archivo.service.ts`).

## Diferencias con Transmeralda

- `GET /api/certificados-tributarios/por-nit/:nit` aquí **no** filtra
  `deleted_at` y devuelve también los certificados retirados; en Transmeralda solo
  los vigentes.
