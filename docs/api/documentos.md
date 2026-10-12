# Documentos (planillas en S3 y documentos compartidos)

`/api/documentos` y `/api/desprendible/compartido` · código en [`src/modules/documentos/`](../../src/modules/documentos/) · permiso [`recargos`](../permisos.md#catálogo-de-módulos) (lectura) en `/api/documentos`

El módulo registra dos archivos de rutas independientes, cada uno con sus guardas:

- **`documentos.routes.ts`** — el visor de planillas de [recargos](./recargos.md):
  entrega un objeto del bucket por su key, en *stream* o como URL firmada. Hasta
  oct-2026 firmaba **cualquier** key y no pedía sesión, lo que daba a cualquiera
  del equipo nóminas, firmas o formularios SARLAFT; ahora solo sirve keys bajo
  `planillas/` y pide el módulo `recargos`. Usa su propio `S3Client`
  (`documentos.service.ts`), no el de `config/aws.ts`.
- **`documentos-compartidos.routes.ts`** — un enlace público para que un conductor
  vea y firme un documento compartido (tabla `documentos_compartidos`: `token`
  único, `s3_key`, `expires_at`, `signed`, firma en S3). Lo consume la página
  pública del frontend `/public/documento/[token]`. No es el flujo vigente de firma
  de desprendibles de nómina, que vive en `/api/desprendible-firma/…` (módulo
  [liquidaciones](./liquidaciones.md)). Ningún código del backend crea filas en
  `documentos_compartidos`: solo las cuentan y las borran las rutas de
  [conductores](./conductores.md).

## Acceso

| Rutas | Guarda |
|---|---|
| `GET /api/documentos/ver/*`, `GET /api/documentos/url-firma` | `sesión` (hook `onRequest`) → `recargos:read` (hook `preHandler`; administración y operaciones `full`, HSEQ, facturación y talento humano `read`) → hook `preHandler` propio: la key (el comodín `*` o `?key=`) tiene que ser texto, empezar por `planillas/` y no contener `..`; si no, 403 `{ success: false, message: 'Ese documento no se puede consultar por aquí.' }` |
| `/api/desprendible/compartido/:token…` | `pública · token`: el `token` de la URL se busca tal cual en `documentos_compartidos.token` (único). `GET …/:token` y `POST …/firmar` rechazan un enlace vencido (`expires_at` pasado → 410); `GET …/datos` exige que ya esté firmado, pero no mira el vencimiento. Sin límite de intentos |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| GET | `/api/documentos/ver/*` | `recargos:read` + key bajo `planillas/` | Sirve el archivo en *stream* para verlo en el navegador |
| GET | `/api/documentos/url-firma` | `recargos:read` + key bajo `planillas/` | URL firmada de 15 minutos |
| GET | `/api/desprendible/compartido/:token` | pública · token | Datos del documento y URL firmada para verlo |
| POST | `/api/desprendible/compartido/:token/firmar` | pública · token | Registra la firma (imagen) |
| GET | `/api/desprendible/compartido/:token/datos` | pública · token (ya firmado) | Documento y firma |

### `GET /api/documentos/ver/*`

`*` es la key completa de S3 (`planillas/recargos/<id>/<archivo>.pdf`). Puede ir con
las barras tal cual o codificadas (`%2F`): el router decodifica el comodín antes de
la comprobación del prefijo.

**Respuesta 200** — el archivo en *stream*, con `Content-Type` del objeto (o
`application/pdf`), `Content-Disposition: inline` y `Content-Length`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 403 | Key fuera de `planillas/` o con `..` | `{ "success": false, "message": "Ese documento no se puede consultar por aquí." }` |
| 404 | El objeto no existe (`NoSuchKey`) | `{ "success": false, "message": "Documento no encontrado" }` |
| 500 | Cualquier otro fallo de S3 | `{ "success": false, "message": "Error al obtener el documento", "error": "…" }` |

### `GET /api/documentos/url-firma`

**Query**

| Parámetro | Tipo | Obligatorio | Descripción |
|---|---|---|---|
| `key` | string | sí | Key de S3 bajo `planillas/` |

**Respuesta 200** — `{ success, data: { url } }`, URL de S3 firmada por 900 s. No
comprueba que el objeto exista.

**Errores**: 403 como en `ver`; 500
`{ success: false, message: 'Error al generar URL firmada', error }`.

### `GET /api/desprendible/compartido/:token`

**Respuesta 200**

```json
{ "success": true, "data": {
  "id": "uuid", "token": "…", "filename": "…", "original_name": "…", "signed": false,
  "presigned_url": "https://…", "expires_at": "…",
  "conductores": { "id": "uuid", "nombre": "…", "apellido": "…", "numero_identificacion": "…" } } }
```

`presigned_url` está firmada por 1 hora (cadena vacía si la firma falla).
`conductores` es el conductor asociado, o `null`, con solo `id`, `nombre`,
`apellido` y `numero_identificacion` (`CONDUCTOR_PUBLICO` en
`documentos-compartidos.routes.ts`): lo que pinta la página pública. Las tres
rutas públicas lo devuelven con ese mismo `select`.

**Errores**: 404 `{ success: false, message: 'Enlace inválido' }`; 410
`{ success: false, message: 'Este enlace ha expirado' }`; 500
`{ success: false, message: 'Error interno del servidor' }`.

### `POST /api/desprendible/compartido/:token/firmar`

**Body** `multipart/form-data` con la imagen de la firma (se toma el primer
archivo, con cualquier nombre de campo). No se valida el tipo ni el tamaño (solo el
límite global de 200 MB del plugin multipart), ni si el documento ya estaba
firmado: firmar otra vez reemplaza la firma.

Sube la imagen a S3 en `documentos_compartidos/signatures/<token>/<uuid>.png` (con el
`Content-Type` que traiga, o `image/png`) y guarda en la fila `signed = true`,
`signature_s3_key`, `signature_url` (URL firmada por 7 días, guardada tal cual: deja
de servir al vencer), `ip_address` (primer valor de `X-Forwarded-For` o la IP de la
conexión) y `user_agent`.

**Respuesta 200**

```json
{ "success": true, "data": {
  "document": { "…": "fila actualizada, con conductores (id, nombre, apellido, numero_identificacion)" },
  "signature": { "s3_key": "documentos_compartidos/signatures/…", "presignedUrl": "https://…" } } }
```

**Errores**: 400 `Debe proporcionar la firma`; 404 `Enlace inválido`; 410
`Enlace expirado`; 500 `{ success: false, message: <mensaje del error> }`.

### `GET /api/desprendible/compartido/:token/datos`

Solo para documentos ya firmados.

**Respuesta 200** — `{ success, data: { document, signature: { presignedUrl } } }`:
`document` es la fila completa (con `conductores` reducido a `id`, `nombre`,
`apellido` y `numero_identificacion`) más `presigned_url`; las dos URL están
firmadas por 1 hora.

**Errores**: 404 `Enlace inválido`; 403
`{ success: false, message: 'Debe firmar primero para acceder al documento' }`; 500.

## Efectos

- **S3** (ver [integraciones](../integraciones.md)): las firmas quedan bajo
  `documentos_compartidos/signatures/<token>/`; una firma reemplazada no se borra.
- No dejan rastro en el registro de actividad: `/api/desprendible` está excluido y
  estas rutas no tienen usuario.

## Observaciones

- **Seguridad.** `GET …/datos` no mira `expires_at`: un enlace firmado sirve para
  siempre. Las tres rutas aceptan intentos ilimitados sobre el token.
- `POST …/firmar` acepta cualquier archivo como firma y permite volver a firmar,
  con lo que se pierde la evidencia de la firma anterior en la fila (el objeto queda
  en S3). `ip_address` sale de `X-Forwarded-For` sin validar; la columna es `inet`,
  así que un valor que no sea una IP hace fallar la actualización con 500 cuando la
  imagen ya se subió.
- La columna `token` admite 128 caracteres, pero Fastify no enruta parámetros de más
  de 100 (`maxParamLength` por defecto): un token así respondería 404 de ruta
  inexistente. No se pudo comprobar la longitud de los tokens emitidos.
- En `/api/documentos/*`, los 400 de «falta la key» del controlador no se alcanzan:
  el hook responde antes 403 a una key vacía.
- `documentos.service.ts` crea su propio `S3Client` con otros valores por defecto
  (región `us-east-1` y bucket vacío) que `config/aws.ts` (`us-east-2` y
  `transmeralda`). Con `AWS_REGION` y `AWS_S3_BUCKET_NAME` definidas da lo mismo.
- Los 500 de `/api/documentos/*` devuelven el mensaje interno en `error`.
