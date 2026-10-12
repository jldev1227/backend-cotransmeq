# Portal del conductor

`/api/conductor-portal` · código en [`src/modules/conductor-portal/`](../../src/modules/conductor-portal/) · sin permiso de módulo: [token del portal](../autenticacion.md#portal-del-conductor) (`tipo: 'conductor_portal'`)

API del portal del conductor: la web pública (`/public/portal`) y las apps
móviles. No hay usuario ni área: el conductor entra con un enlace que le llega
al correo y todo lo que ve sale del **token** (`request.conductorPortal.id`, el
`sub` del JWT), nunca de la URL ni del cuerpo. Un recurso de otro conductor
responde 404, igual que uno que no existe. Cubre desprendibles de nómina y
primas (consulta y firma), días laborados con sus soportes de mantenimiento,
servicios asignados con su inicio y liberación desde la app, condiciones de la
vía, capacitaciones, avisos, dispositivos push, y extractos FUEC y documentos
del vehículo.

Dentro del mismo bloque protegido se registran rutas que viven en otros módulos
y se documentan allí: los viáticos del conductor (`/api/conductor-portal/viaticos/*`,
[viaticos](./viaticos.md)). Los formularios dinámicos y sus recibos
(`/api/conductor-portal/formularios/*`, [formularios-dinamicos](./formularios-dinamicos.md))
comparten prefijo y token, pero tienen su propio archivo y su propia copia del
middleware.

Reglas que un integrador necesita saber:

- **El enlace lleva la sesión.** El JWT del correo es el mismo token con el que
  se llama a la API durante 30 días: `verificar-token` no lo cambia por otro,
  solo lo valida y devuelve el perfil. Ver [Flujo de acceso](#flujo-de-acceso).
- **Desprendibles**: solo los de `desprendible_visible = true` y sin borrar. Se
  firman solo los `PAGADA`; la firma pasa la liquidación a `FIRMADA`. El PDF del
  móvil es el mismo que arma el canvas de nómina en el navegador (pdfmake),
  generado en el servidor abriendo esa página con Puppeteer.
- **Firmas reutilizadas**: una prima sin firma propia muestra la del desprendible
  del mismo conductor cuyo `periodo_end` cae en el mes de la prima ±1, y un
  desprendible sin firma, la de una prima de su mes ±1.
- **Días laborados**: el mismo `DiasLaboradosService.upsertRegistro` y el mismo
  zod que el dashboard ([dias-laborados](./dias-laborados.md)). Nada se borra
  en duro y volver a registrar un día retirado lo revive.
- **Ejecución del servicio**: iniciar, liberar y recomendaciones son idempotentes
  porque la cola offline de la app los reintenta. `fecha_realizacion` es la
  fecha planeada y no se toca.

## Flujo de acceso

1. **Pedir el enlace** — `POST /api/conductor-portal/solicitar-acceso` con la
   cédula y el `canal`. Si el conductor existe y tiene correo, se firma un JWT de
   30 días (`emitirTokenPortal`, `portal-token.service.ts`), se guarda en
   `conductor_token` y se envía el correo. Cada petición firma un token nuevo. El
   enlace (`src/lib/portal-access-link.ts`) es:
   - `canal: 'web'`: `<origen>/public/portal?token=<JWT>`.
   - `canal: 'mobile'`: `<origen>/public/abrir-app?token=<JWT>`, una página puente
     https que abre `cotransmeq://portal` (Gmail anula los esquemas propios).
     Si `MOBILE_PORTAL_URL` ya es una URL http(s), se usa esa con `token=` añadido.

   `<origen>` es `EMAIL_FRONTEND_URL` o, si falta, el primer origen de `FRONTEND_URL`.
2. **Abrir el enlace** — el frontend llama
   `GET /api/conductor-portal/verificar-token?token=<JWT>`: comprueba firma,
   `tipo: 'conductor_portal'` y que la fila de `conductor_token` exista y no haya
   vencido. Devuelve el **mismo** token con el perfil del conductor y `expires_at`.
3. **Usarlo** — `Authorization: Bearer <JWT>` en las rutas protegidas. El
   middleware verifica firma, vencimiento y `tipo`, y que el token siga
   registrado (`tokenPortalRegistrado`, `portal-token.service.ts`): su fila de
   `conductor_token` existe, no ha vencido y el conductor no está borrado
   (`deleted_at`). Esa comprobación se cachea 30 s por hash del token. El
   estado laboral no se mira a propósito: un conductor desvinculado sigue
   viendo sus desprendibles.

Payload del token: `{ sub: <id del conductor>, cedula, nombre: 'Nombre Apellido', tipo: 'conductor_portal' }`.

**Revocar un enlace** es borrar su fila de `conductor_token` o mandar al
conductor a la papelera: el token deja de abrir el portal en 30 s como mucho.
El borrado definitivo de un conductor (en [conductores](./conductores.md)) borra
sus filas y vacía la caché en el acto.

Otros emisores del mismo token: `POST /acceso-revision` (cuenta sintética de
revisión de tiendas) y los correos de desprendibles y primas
(`tokenPortalVigente`, desde `envio-nomina-queue.service.ts`,
`liquidaciones.routes.ts` y `primas.routes.ts`), que reutilizan el token vigente
más largo del conductor en vez de firmar otro. Solo reutilizan tokens
`conductor_portal` firmados con el `JWT_SECRET` actual: el del reporte de
[días laborados](./dias-laborados.md), que comparte la tabla, no sirve.

## Acceso

| Rutas | Guarda |
|---|---|
| `POST /solicitar-acceso` | `pública · límite 3/h por cédula y 30/h por IP` (`limitesEnvioDeEnlace`, [límites de intentos](../autenticacion.md#límites-de-intentos)): 429 con `Retry-After` |
| `POST /acceso-revision` | `pública · límite 10/15 min por IP`. Solo abre una cuenta con `conductores.permisos.google_play_review === true`, `estado: 'activo'`, sin ocultar ni borrar y contraseña argon2 |
| `GET /verificar-token` | `pública · token`: el JWT del enlace en la query, verificado contra `conductor_token` |
| Todas las demás | `portal`: `portalAuthMiddleware` (hook `onRequest` del bloque protegido) acepta solo `tipo: 'conductor_portal'` registrado en `conductor_token`. Sin cabecera o mal formada → 401; otro `tipo` → 401 «Token no autorizado para este recurso»; firma inválida o vencida → 401 «Token inválido o expirado»; sin fila, con la fila vencida o con el conductor borrado → 401 «Tu acceso al portal venció o fue revocado. Pide un enlace nuevo.» |
| `GET /desprendibles/:id/datos` | además, el token de impresión `tipo: 'conductor_portal_print_desprendible'` (180 s): solo en `GET`, solo esa ruta declarada y solo si `:id` es su `lid`; fuera de eso → 403 «Token fuera de su alcance». No se guarda en `conductor_token`, así que no pasa por la comprobación de registro ([tokens de impresión](../autenticacion.md#tokens-de-impresión)) |

Los tokens del equipo (dashboard o `app_usuario`) y el de días laborados
(`conductor_dias_laborados`) no entran aquí, y el del portal tampoco entra en
`authMiddleware`.

### Qué ve el token

Todo se filtra por el conductor del token en el propio controlador o servicio:

| Recurso | Alcance |
|---|---|
| Desprendibles | `liquidaciones` con su `conductor_id`, `desprendible_visible = true` y `deleted_at` nulo |
| Primas | todas las suyas sin borrar (`primas` no tiene bandera de visibilidad) |
| Días laborados y soportes | sus días vivos; el soporte además tiene que colgar del día de esa fecha |
| Servicios, ejecución y vía | `servicios` con su `conductor_id` y sin borrar. No se exponen `no_conformidades` |
| Extractos FUEC | los extractos donde figura por `fuec_extract_driver.conductor_id` (nunca por nombre ni por cédula impresa) |
| Documentos del vehículo | vehículos con su `vehiculos.conductor_id`, o de un extracto vigente (o que aún no empieza) donde figura; solo categorías del catálogo marcadas `paraConductor` y solo el documento actual |
| Capacitaciones | sus filas, por `numero_documento` o por la huella `portal-conductor:<id>`. Una asistencia se abre con su token y una evaluación con su id, como en la web pública por QR: cualquiera vigente |
| Avisos y dispositivos push | `conductor_notification` y `conductor_push_device` suyos |
| Catálogos de días laborados | `GET /dias-laborados/clientes` y `/vehiculos` devuelven el catálogo **entero**, sin filtrar por conductor |

## Endpoints

| Método | Ruta | Acceso | Qué hace |
|---|---|---|---|
| POST | `/api/conductor-portal/solicitar-acceso` | pública · límite 3/h por cédula, 30/h por IP | Envía al correo del conductor el enlace con su token |
| GET | `/api/conductor-portal/verificar-token` | pública · token | Valida el token del enlace y devuelve el perfil |
| POST | `/api/conductor-portal/acceso-revision` | pública · límite 10/15 min por IP | Acceso con cédula y contraseña para la cuenta de revisión de tiendas |
| POST | `/api/conductor-portal/dispositivos-push` | portal | Registra el token Expo del teléfono |
| DELETE | `/api/conductor-portal/dispositivos-push` | portal | Desactiva el token Expo del teléfono |
| GET | `/api/conductor-portal/desprendibles` | portal | Lista sus desprendibles visibles con su estado de firma |
| GET | `/api/conductor-portal/desprendibles/:id/datos` | portal o impresión | Liquidación, firmas y recargos con las fuentes del canvas de nómina |
| GET | `/api/conductor-portal/desprendibles/:id/pdf` | portal | PDF del desprendible |
| GET | `/api/conductor-portal/desprendibles/:id` | portal | Liquidación completa, recargos, planillas clasificadas y firma (formato anterior a `/datos`) |
| POST | `/api/conductor-portal/desprendibles/:id/firmar` | portal | Firma un desprendible pagado |
| GET | `/api/conductor-portal/primas` | portal | Lista sus primas con su estado de firma |
| GET | `/api/conductor-portal/prima/:id` | portal | Una prima con la firma del desprendible del mismo periodo |
| GET | `/api/conductor-portal/primas/:id/enriquecida` | portal | Prima con su firma en base64 (propia o de nómina) |
| GET | `/api/conductor-portal/primas/:id/firma` | portal | URL firmada de la firma de la prima (propia o de nómina) |
| POST | `/api/conductor-portal/primas/:id/firmar` | portal | Firma una prima |
| GET | `/api/conductor-portal/dias-laborados/registros` | portal | Lista sus días con tramos y soportes |
| POST | `/api/conductor-portal/dias-laborados/registros` | portal | Crea o reemplaza un día |
| DELETE | `/api/conductor-portal/dias-laborados/registros/:fecha` | portal | Retira un día |
| POST | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/init` | portal | Inicia la subida de un soporte de mantenimiento |
| POST | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id/complete` | portal | Verifica contra S3 y confirma el soporte |
| DELETE | `/api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id` | portal | Retira un soporte |
| GET | `/api/conductor-portal/dias-laborados/clientes` | portal | Catálogo de clientes para el formulario |
| GET | `/api/conductor-portal/dias-laborados/vehiculos` | portal | Catálogo de vehículos para el formulario |
| GET | `/api/conductor-portal/notificaciones` | portal | Avisos sin leer (máx. 20) |
| POST | `/api/conductor-portal/notificaciones/:id/leida` | portal | Marca un aviso como leído |
| GET | `/api/conductor-portal/servicios` | portal | Lista sus servicios |
| GET | `/api/conductor-portal/servicios/:id` | portal | Detalle de un servicio con las observaciones administrativas |
| GET | `/api/conductor-portal/servicios/:id/via` | portal | Ruta, tráfico, incidentes, peajes, paradas y riesgos |
| GET | `/api/conductor-portal/servicios/:id/ejecucion` | portal | Estado de inicio y liberación, formatos y preoperacionales del día |
| POST | `/api/conductor-portal/servicios/:id/iniciar` | portal | Inicia el servicio con un preoperacional por etapas |
| POST | `/api/conductor-portal/servicios/:id/liberar` | portal | Libera el servicio con la hora y el reporte del recorrido |
| POST | `/api/conductor-portal/servicios/:id/recomendaciones` | portal | Guarda las recomendaciones posteriores a liberar |
| GET | `/api/conductor-portal/capacitaciones` | portal | Asistencias y evaluaciones pendientes e historial |
| GET | `/api/conductor-portal/asistencias/:token` | portal | Detalle de una asistencia para firmarla |
| POST | `/api/conductor-portal/asistencias/:token` | portal | Firma una asistencia con sus datos |
| GET | `/api/conductor-portal/evaluaciones/:id` | portal | Evaluación para responder, sin respuestas correctas |
| POST | `/api/conductor-portal/evaluaciones/:id` | portal | Responde una evaluación |
| GET | `/api/conductor-portal/extractos` | portal | Sus extractos FUEC vigentes e historial reciente |
| GET | `/api/conductor-portal/extractos/:id` | portal | Un extracto |
| GET | `/api/conductor-portal/extractos/:id/pdf` | portal | PDF del extracto con QR |
| GET | `/api/conductor-portal/vehiculos/documentos` | portal | Documentos vigentes de sus vehículos |
| GET | `/api/conductor-portal/vehiculos/:vehiculoId/documentos/:documentoId/url` | portal | URL firmada de 5 minutos para abrir un documento |

Las respuestas llevan `{ success, data?, message? }`. Los errores propios son
`{ success: false, message }`, a veces con `code`; los del esquema JSON de
Fastify salen con su formato (`{ statusCode, error, message }`).

### `POST /api/conductor-portal/solicitar-acceso`

**Body** (esquema de Fastify, `additionalProperties: false`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `numero_identificacion` | string | sí | 5 a 12 caracteres; la cédula exacta de `conductores` |
| `canal` | `'web'` \| `'mobile'` | no | `web` por defecto; decide el enlace del correo |

**Respuesta 200** — `{ "success": true, "message": "Se ha enviado un enlace de acceso a tu correo electrónico", "email": "jua***@dominio.com" }`
(las tres primeras letras del usuario y el dominio).

**Errores**

| Código | Cuándo |
|---|---|
| 400 | Body inválido (formato de Fastify) o conductor sin correo registrado |
| 404 | No hay conductor con esa cédula |
| 429 | Tope de intentos |
| 500 | Falló el envío del correo (el token ya quedó guardado) |

### `GET /api/conductor-portal/verificar-token`

**Query**: `token` (obligatorio), el JWT del enlace.

**Respuesta 200**

```json
{ "success": true, "data": {
  "token": "<el mismo JWT>",
  "conductor": { "id": "…", "nombre": "…", "apellido": "…", "numero_identificacion": "…", "email": "…", "estado": "activo" },
  "expires_at": "…"
} }
```

**Errores**: 400 sin `token` o vacío; 401 «Token inválido o expirado» (firma o
vencimiento del JWT), «Token inválido» (otro `tipo`), «Token expirado o inválido»
(sin fila en `conductor_token` o vencida).

### `POST /api/conductor-portal/acceso-revision`

**Body** (`additionalProperties: false`): `numero_identificacion` (5–12) y
`password` (8–100). Firma un token nuevo (con fila en `conductor_token`) y
responde con la misma forma que `verificar-token`. Cualquier fallo —cédula
desconocida, cuenta sin la marca, inactiva, oculta, borrada o contraseña
incorrecta— es 401 «Credenciales inválidas», sin distinguir. 429 al pasar el tope.

### `POST /api/conductor-portal/dispositivos-push` y `DELETE /api/conductor-portal/dispositivos-push`

**Body** (sin esquema; lo valida el handler)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `expo_push_token` | string | sí | `ExpoPushToken[…]` o `ExponentPushToken[…]` |
| `plataforma` | `'android'` \| `'ios'` | sí (solo `POST`) | |

`POST` hace upsert por `expo_push_token`: si el teléfono estaba registrado a otro
conductor pasa a este, y se reactiva. Formato inválido → 400 «Dispositivo push
inválido». `DELETE` desactiva (no borra) el token solo si es de este conductor y
responde `{ success: true }` siempre. Los usa `enviarPushConductor`
(`conductor-push.service.ts`) desde servicios y viáticos: el aviso se escribe
antes en el inbox y el push es un intento; un token que Expo declara
`DeviceNotRegistered` se desactiva.

### `GET /api/conductor-portal/desprendibles`

**Respuesta 200** — `{ success, data: [...], count }`, del `periodo_end` más
reciente al más antiguo. Cada elemento: `id`, `periodo_inicio`, `periodo_fin`,
`estado`, `sueldo_total`, `dias_laborados`, `salario_devengado`,
`total_recargos`, `total_bonificaciones`, `total_pernotes`, `es_cotransmeq`,
`fecha_liquidacion`, `created_at`, `firmado`, `fecha_firma` y `prima_asociada`
(`{ id, mes, anio, prima, prima_pendiente, estado }` de la primera prima del
conductor en el mes de `periodo_fin` ±1, o `null`). No trae `estado_flujo`.

### `GET /api/conductor-portal/desprendibles/:id/datos`

Los tres datos con los que el canvas de nómina arma el desprendible, sacados con
las mismas funciones que el canvas y no con consultas propias del portal. Lo
consumen el portal web y la página que imprime el PDF del móvil.

**Respuesta 200**

```json
{ "success": true, "data": {
  "liquidacion": { "…": "la de GET /api/liquidaciones/:id, con firmas_desprendibles[].presignedUrl como data URI" },
  "firmas": [ { "…": "firmas de la liquidación con presignedUrl, sin las 'pending' ni vacías" } ],
  "recargosData": { "…": "tablas de recargo de la hoja del canvas", "planillas": [] }
} }
```

`recargosData` es opcional, como en el canvas: si el periodo no es válido o la
lectura falla, llega `{ planillas: [] }` y el PDF sale sin las páginas de
recargos. Ver [liquidaciones](./liquidaciones.md) y [nomina-canvas](./nomina-canvas.md).

**Errores**: 404 «Desprendible no encontrado»; 403 token de impresión fuera de
su alcance; 500.

### `GET /api/conductor-portal/desprendibles/:id/pdf`

PDF (`Content-Type: application/pdf`, `Content-Disposition: inline;
filename="desprendible-AAAA-MM.pdf"`, `Cache-Control: private, no-store`).
Comprueba la propiedad, firma un token de impresión de 180 s con `lid` = la
liquidación y abre con Puppeteer `<origen>/public/portal/desprendibles/imprimir/<id>`
con esa sesión sembrada en `localStorage` (`PORTAL_SESSION_STORAGE_KEY`); la
página ejecuta el mismo `pdfDesprendible.ts` del web y publica el PDF en base64.
`<origen>` es el primer `FRONTEND_URL` (o `EMAIL_FRONTEND_URL`), nunca una URL del
cliente. El token no viaja en la URL.

**Errores**: 404 «Desprendible no encontrado»; 500 si la página no genera el
documento (espera hasta 45 s).

### `GET /api/conductor-portal/desprendibles/:id`

Formato anterior a `/datos`. **Respuesta 200** — `{ success, data: { liquidacion, recargos, dataParaPdf, firma } }`:

- `liquidacion`: `LiquidacionesService.obtenerPorId`, la liquidación completa
  (conductor, vehículos, bonificaciones, pernotes, recargos, anticipos, firmas…).
- `recargos`: `LiquidacionesService.previewRecargos` del periodo (lee las
  planillas, no la hoja del canvas), sin clasificar, o `null` si falla. Se
  conserva para quien lo consuma directamente.
- `dataParaPdf`: `{ planillas: [...] }`, las planillas de recargo clasificadas con
  `_categoria` (`pagar`, `bono_aparte`, `no_pagar`) por
  `LiquidacionesService.buildDataParaPdf`, la misma estructura que arma el modal de
  detalle del dashboard (GEOLAB, RED SALUD e INGENIERIA ESPECIALIZADA salen como
  `bono_aparte`, sin valor en el total). Es lo que usa el PDF. Llega
  `{ planillas: [] }` si la liquidación no tiene `mostrar_recargos` o si falla.
- `firma`: `{ presignedUrl, fecha_firma, origen: 'desprendible' | 'prima' }` con
  URL de S3 de 1 h, o `null`. Sin firma propia, la de una prima del mes ±1.

**Errores**: 404 «Liquidación no encontrada»; 500.

### `POST /api/conductor-portal/desprendibles/:id/firmar`

**Body** (`additionalProperties: false`)

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `firma_base64` | string | sí | `data:image/png;base64,…`; 100 a 2.500.000 caracteres en el esquema. Decodificada: PNG por sus bytes mágicos, de 2.000 B a 1,8 MB |

La liquidación tiene que ser suya, visible, sin borrar y con `estado_flujo`
`PAGADA` (`FIRMADA` se admite solo para responder 409). Sube la imagen a S3
(`firmas_desprendibles/<liquidación>/<conductor>/<uuid>.png`), crea o completa la
fila de `firmas_desprendibles` con IP (`X-Forwarded-For` o la de la conexión) y
user agent, y si estaba `PAGADA` la pasa a `FIRMADA` (+1 en `version`).

**Respuesta 200** — `{ success, message: "Firma registrada exitosamente", data: { firmado: true, fecha_firma } }`.

**Errores**

| Código | Cuándo |
|---|---|
| 400 | No es un PNG, o tamaño fuera de rango |
| 404 | No es suya, no es visible, está borrada o no está `PAGADA`/`FIRMADA` |
| 409 | Ya estaba firmada |
| 413 | Cuerpo mayor de 1 MiB (`bodyLimit` por defecto de Fastify) |
| 500 | S3 u otro fallo |

### `GET /api/conductor-portal/primas`

**Respuesta 200** — `{ success, data: [...] }`, de la más reciente a la más
antigua. Cada prima: `id`, `conductor_id`, `mes`, `anio`, `prima`,
`prima_pendiente`, `tiempo_trabajado_dias`, `sueldo_basico`,
`auxilio_transporte`, `sueldo_variable`, `total_base_liquidacion`, `estado`
(`Pendiente` \| `Pagado`), `observaciones`, `created_at`, `firmado`,
`fecha_firma`. Importes como número. `firmado` cuenta solo firmas propias de la
prima en estado `Activa`.

### `GET /api/conductor-portal/prima/:id`

Ruta en singular. **Respuesta 200** — `{ success, data: { prima, firma } }`:
`prima` con `id`, `conductor_id`, `mes`, `anio`, `prima`, `prima_pendiente`,
`tiempo_trabajado_dias`, `sueldo_basico`, `auxilio_transporte`,
`sueldo_variable`, `total_base_liquidacion`, `estado`, `observaciones`,
`created_at` y `updated_at`, con los importes como los serializa Prisma
(`Decimal` → texto). `firma` es siempre la **del desprendible** del mismo mes ±1
(`{ presignedUrl, fecha_firma, liquidacion_id }`, URL de 1 h) o `null`: esta ruta
no mira la firma propia de la prima. 404 si no es suya.

### `GET /api/conductor-portal/primas/:id/enriquecida`

**Respuesta 200** — `{ success, data: { prima, firma } }`. `prima` es la fila
completa más `conductores: { id, nombre, apellido, numero_identificacion, email }`.
`firma` es la propia de la prima o, si no hay, la del desprendible del mes ±1:
`{ presignedUrl, fecha_firma, origen: 'prima' | 'nomina', liquidacion_id }`, o
`null`. Aquí `presignedUrl` **no es una URL**: es la imagen como data URI base64.

### `GET /api/conductor-portal/primas/:id/firma`

La misma prioridad que `enriquecida`, con URL firmada de S3 (1 h):
`{ success, data: { presignedUrl, fecha_firma, origen, liquidacion_id? } }`, o
`data: null` si no hay ninguna. 404 si la prima no es suya.

### `POST /api/conductor-portal/primas/:id/firmar`

**Body**: `firma_base64` (string de al menos 100 caracteres; sin máximo en el
esquema ni `additionalProperties: false`). Se le quita el prefijo
`data:image/<tipo>;base64,` y se exigen 2.000 B decodificados; no se comprueba que
sea PNG. Sube a `firmas_primas/<prima>/<conductor>/<uuid>.png` y crea o completa
la fila de `firmas_primas`. No cambia el estado de la prima ni avisa a nadie.

**Respuesta 200** — `{ success, message: "Firma de prima registrada exitosamente", data: { firmado: true, fecha_firma } }`.

**Errores**: 400 firma ilegible (menos de 2.000 B); 404 prima ajena o borrada;
409 «Esta prima ya fue firmada»; 500.

### `GET /api/conductor-portal/dias-laborados/registros`

**Query** (esquema de Fastify)

| Parámetro | Tipo | Notas |
|---|---|---|
| `mes` | `AAAA-MM` | Tiene prioridad sobre el rango |
| `desde`, `hasta` | `AAAA-MM-DD` | Solo si llegan los dos |

Sin filtro devuelve todos. **Respuesta 200** — `{ success, data, count }`, por
fecha ascendente: filas de `registro_dia_laboral` vivas con `segmentos` (siempre
presente; tramos vivos de los días `LABORADO`, `[]` en los demás) y `adjuntos`
(soportes `UPLOADED` de los días `MANTENIMIENTO`:
`{ id, client_attachment_id, mime_type, byte_size, original_name, url, uploaded_at }`,
URL de 1 h).

### `POST /api/conductor-portal/dias-laborados/registros`

Crea o reemplaza el día del conductor (upsert por `(conductor_id, fecha)`). Lo
valida el esquema de Fastify y después el mismo zod que el dashboard
(`crearRegistroSchema`, `dias-laborados.schema.ts`).

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `fecha` | `AAAA-MM-DD` | sí | No puede ser futura |
| `tipo` | `LABORADO` \| `DISPONIBLE` \| `DESCANSO` \| `MANTENIMIENTO` | sí | |
| `observaciones` | string | no | |
| `mantenimiento_vehiculo_id` | uuid \| null | no | Vehículo del día de mantenimiento; con él se guarda la placa del catálogo |
| `mantenimiento_vehiculo_placa` | string ≤ 20 \| null | si es `MANTENIMIENTO` | El zod la exige aunque llegue el id. Sin id se intenta enlazar por placa; si no existe, se guarda el texto |
| `segmentos` | arreglo | no | Tramos; solo se guardan si el día es `LABORADO` |

Cada tramo: `vehiculo_placa`, `hora_inicio` y `hora_fin` (`HH:MM`),
`horas_conducidas` (0–24) y `descripcion_servicio` (1–500 sin contar espacios)
son obligatorios; opcionales `cliente_id` y `vehiculo_id` (uuid),
`cliente_nombre`, `dias_offset_inicio` y `dias_offset_fin` (0–2: el extremo cae
ese día, el siguiente o el otro), `km_inicial` y `km_final` (enteros), `pernocte`.
`observaciones`, `inicio_dia_siguiente` y `fin_dia_siguiente` se aceptan pero no
se guardan; lo no declarado se descarta (`additionalProperties: false`). El
horario tiene que ser coherente contando el desfase.

Retira los tramos anteriores con sus bonos e inserta los nuevos; si el día no es
`MANTENIMIENTO`, retira sus soportes; si estaba retirado, lo revive. Solo el
primer registro de esa fecha (aunque después se haya retirado) avisa al equipo.

**Respuesta 200** — `{ success, message: "Registro guardado exitosamente", data: { …registro, segmentos, adjuntos } }`.

**Errores**

| Código | Cuándo | Cuerpo |
|---|---|---|
| 400 | Regla de zod (placa de mantenimiento, horario, descripción…) | `{ success: false, message: <primer problema>, errors: [<issues de zod>] }` |
| 400 | Día futuro, o vehículo de mantenimiento inexistente | `{ success: false, message }` |
| 400 | Tipos o formatos (esquema de Fastify) | formato de Fastify |
| 500 | Cualquier otro fallo | `{ success: false, message }` |

### `DELETE /api/conductor-portal/dias-laborados/registros/:fecha`

Retira el día vivo de esa fecha con sus tramos, bonos y soportes
(`retirarDiaLaboral`, solo marca `deleted_at`). 200 `{ success, message }`; 404
«Registro no encontrado» si no hay día vivo.

### Soportes de mantenimiento: `POST /api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/init`, `POST /api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id/complete` y `DELETE /api/conductor-portal/dias-laborados/registros/:fecha/adjuntos/:id`

Facturas (foto o PDF) de un día `MANTENIMIENTO` que ya existe en el servidor, en
tres pasos idempotentes por `client_attachment_id`, que genera el teléfono
(`dias-adjuntos.service.ts`, mismo camino que los adjuntos de formularios):

1. **`init`** — crea la fila `PENDING` y devuelve una URL prefirmada de `PUT`
   (15 min) que firma tipo, tamaño y, con `FORMS_S3_NATIVE_CHECKSUM`, el SHA-256
   en la query. El teléfono sube los bytes directo a S3 con la cabecera
   `Content-Type` que se le indica.

   | Campo | Tipo | Obligatorio | Notas |
   |---|---|---|---|
   | `client_attachment_id` | string | sí | 1–64, solo `[A-Za-z0-9_-]` (va dentro de la clave de S3) |
   | `mime_type` | string | sí | `image/jpeg`, `image/png`, `image/webp` o `application/pdf` |
   | `byte_size` | entero | sí | Hasta 10 MiB |
   | `sha256` | hex de 64 | sí | |
   | `original_name` | string ≤ 255 | no | |

   Respuesta: `{ success, data: { id, status: "PENDING", upload_url, headers: { "Content-Type": "…" } } }`.
   Repetir con el mismo id y el mismo archivo firma otra URL; si ya estaba
   subido, `{ id, status: "UPLOADED" }`. Máximo 10 soportes vivos por día.
2. **`complete`** — `:id` es el `id` que devolvió `init`, no el
   `client_attachment_id`. Body opcional `{ sha256?, byte_size? }` que, si llega,
   tiene que coincidir con lo declarado. Verifica el objeto **almacenado**
   (tamaño y checksum nativo de S3, o hash leyéndolo) y lo pasa a `UPLOADED`:
   `{ success, data: { id, client_attachment_id, mime_type, byte_size, original_name, url, uploaded_at, status: "UPLOADED" } }`.
   Si falla no marca nada: la app puede volver a pedir URL y subir.
3. **`DELETE`** — marca `deleted_at` (el objeto de S3 se conserva). Lo ya
   borrado o inexistente responde 200 `{ success, data: { id, deleted: true } }`
   para que la cola offline no reintente para siempre.

**Errores** (`{ success: false, message, code }`)

| Código | `code` | Cuándo |
|---|---|---|
| 400 | `DATOS_INVALIDOS` | Fecha o body inválidos |
| 404 | `DIA_NO_ENCONTRADO` | No hay día vivo en esa fecha |
| 404 | `ADJUNTO_NO_ENCONTRADO` | El soporte no existe, es de otro conductor o de otro día |
| 409 | `ADJUNTO_CONFLICTO` | Mismo `client_attachment_id` en otro día o con otro archivo |
| 409 | `ADJUNTO_ELIMINADO` | `init` sobre un soporte ya borrado |
| 409 | `LIMITE_ADJUNTOS` | El día ya tiene 10 soportes vivos |
| 409 | `ARCHIVO_NO_SUBIDO` | `complete` antes de que el objeto llegue a S3 |
| 422 | `SOLO_MANTENIMIENTO` | El día no es `MANTENIMIENTO` |
| 422 | `TIPO_NO_PERMITIDO`, `ARCHIVO_MUY_GRANDE` | Tipo o tamaño no admitidos |
| 422 | `ARCHIVO_NO_COINCIDE` | Lo almacenado no coincide con lo declarado |

### `GET /api/conductor-portal/dias-laborados/clientes` y `GET /api/conductor-portal/dias-laborados/vehiculos`

Catálogos del formulario, sin filtro por conductor: todos los clientes sin
borrar (`{ id, nombre, nit, tipo }`, ocultos incluidos) y todos los vehículos
sin borrar (`{ id, placa, marca, linea, modelo, estado, conductor_id }`),
ordenados por nombre y por placa. `{ success, data }`.

### `GET /api/conductor-portal/notificaciones`

Inbox de la app: solo los avisos **sin leer**, del más antiguo al más reciente y
como mucho 20 (la app lo consulta en cada ronda de sincronización, cada minuto).
`{ success, data: [ { id, tipo, titulo, cuerpo, datos, created_at } ] }`. Los
escriben servicios (`SERVICIO_ASIGNADO`, `SERVICIO_DESASIGNADO`,
`SERVICIO_CANCELADO`, `SERVICIO_ELIMINADO`), viáticos (`VIATICO_*`) y nómina
(`NOMINA_DISPONIBLE`).

### `POST /api/conductor-portal/notificaciones/:id/leida`

Marca el aviso como leído. Idempotente y acotado al conductor: uno ajeno o ya
leído no cuenta y no es error. `{ success, data: { marcadas: 0 | 1 } }`.

### `GET /api/conductor-portal/servicios`

**Query**: `estados`, CSV de estados del servicio. Por defecto
`solicitado,planificado,en_curso,pendiente,realizado,planilla_asignada`.

**Respuesta 200** — `{ success, data, count }`, por `fecha_solicitud`
descendente y sin paginar. Cada servicio: `id`, `estado`, `proposito_servicio`,
`origen_especifico`, `destino_especifico`, `fecha_solicitud`,
`fecha_realizacion`, `fecha_finalizacion`, coordenadas de origen y destino,
`valor` (número), `numero_planilla`, `observaciones` (indicaciones del área
administrativa; van también en el listado porque la app lo guarda como copia
sin conexión), `origen` y `destino` (municipio con coordenadas), `vehiculo`
(`id`, `placa`, `marca`, `linea`, `modelo`, `color`, `clase_vehiculo`,
`tipo_carroceria`) y `cliente` (`id`, `nombre`, `nit`).

### `GET /api/conductor-portal/servicios/:id`

Lo mismo que un elemento del listado, más `created_at` y `vehiculo.combustible`.
`no_conformidades` no se expone (es nota interna). 404 «Servicio no encontrado».

### `GET /api/conductor-portal/servicios/:id/via`

Lo mismo que muestra el detalle del servicio en la web, más la ruta con sus pasos
para que la guía funcione sin red (`condiciones-via.service.ts`). Usa las
coordenadas del servicio o, si faltan, las del municipio.

**Respuesta 200** — `{ success, data }` con:

- `servicio_id`, `generado_en` y `clave`: hash corto que cambia si cambian
  origen, destino, el servicio o su planilla; la app descarta su copia offline.
- `ruta`: `{ coordinates: [lng, lat][], distancia_m, duracion_s, duracion_tipica_s, pasos: [{ instruccion, distancia_m, duracion_s, lng, lat }] }`, o `null` si Mapbox falla.
- `trafico`: `{ estado, retraso_pct }`, con `estado` `fluido` (retraso < 10 %),
  `moderado` (< 30 %), `congestionado` (< 60 %), `critico` o `sin_datos`.
- `incidentes` (Mapbox), `obras`, `peajes` y `paradas` (OpenStreetMap vía
  Overpass, filtrados por cercanía a la ruta) y `distracom` (estaciones de la
  lista estática, máx. 6).
- `vias` y `riesgos`: los booleanos de la planilla de recargo más reciente del servicio.

Caché en memoria por par origen-destino: 5 min para ruta y tráfico; 24 h para
peajes, paradas, obras y Distracom (5 min si Overpass falló).

**Errores**: 404; 422 «El servicio no tiene origen y destino georreferenciados»; 500.

### `GET /api/conductor-portal/servicios/:id/ejecucion`

Estado de la ejecución del servicio (`ejecucion-servicio.service.ts`).

```json
{ "success": true, "data": {
  "habilitado": true, "estado": "planificado",
  "puede_iniciar": true, "puede_asociar": false, "puede_liberar": false,
  "vehiculo": { "id": "…", "placa": "…", "clase_vehiculo": "CAMIONETA" },
  "formatos": [ { "assignment_id": "…", "code": "HSEQ-FR-08", "name": "…", "recomendado": true } ],
  "preoperacionales_del_dia": [ { "submission_id": "…", "client_submission_id": "…", "assignment_id": "…", "code": "…", "status": "DRAFT", "etapas_cerradas": [1], "updated_at": "…" } ],
  "ejecucion": null
} }
```

- `habilitado`: el conductor tiene hoy alguna asignación vigente de un
  preoperacional **por etapas** (`settings.modo = 'ETAPAS'`), con la misma regla
  de acceso que el portal de formularios.
- `formatos[].recomendado`: `HSEQ-FR-08` para camioneta, campero o automóvil;
  `HSEQ-FR-09` para bus, buseta o microbús; ninguno en otras clases.
- `puede_iniciar`: habilitado, no iniciado, con vehículo y en `planificado` o
  `en_curso`. `puede_asociar`: lo mismo en `realizado` (operaciones lo cerró sin
  la app; solo se le liga el preoperacional). `puede_liberar`: `en_curso`,
  iniciado, sin liberar y con el preoperacional `SUBMITTED`.
- `preoperacionales_del_dia`: envíos por etapas del conductor para el vehículo
  del servicio, del día en Bogotá, sin servicio o ligados a este.
- `ejecucion`: `{ iniciado_at, liberado_at, iniciado_diferido, liberado_diferido, recomendaciones, preoperacional, reporte }`, o `null`.

**Errores** (aquí y en las tres siguientes, `{ success: false, message, code? }`):
404 si el id no es UUID, no existe o no es suyo.

### `POST /api/conductor-portal/servicios/:id/iniciar`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `client_submission_id` | uuid | sí | El preoperacional por etapas que generó la app |
| `dispositivo_at` | fecha ISO | sí | Hora del teléfono |
| `diferido` | boolean | no | `true` si sale de la cola offline: el día se toma de `dispositivo_at` y no del servidor |
| `formato_elegido` | boolean | no | El conductor eligió formato porque no había uno recomendado |

Liga el preoperacional al servicio (`form_submission.service_id`, con el mismo
bloqueo de fila que el portal de formularios), crea o completa
`servicio_ejecucion` y, si estaba `planificado`, lo pasa a `en_curso` con los
efectos de la máquina de estados (conductor y vehículo a `servicio`). En
`en_curso` o `realizado` el estado no cambia. Repetir con el mismo
`client_submission_id` devuelve el estado sin hacer nada.

**Respuesta 200** — el mismo objeto que `GET …/ejecucion`.

**Errores**

| Código | `code` | Cuándo |
|---|---|---|
| 400 | `DATOS_INVALIDOS` | Body inválido |
| 403 | `NO_HABILITADO` | Sin preoperacional por etapas habilitado |
| 404 | — | Servicio ajeno o inexistente |
| 409 | `ESTADO_INVALIDO` | Ya iniciado con otro preoperacional, o el estado no admite inicio |
| 409 | `PREOPERACIONAL_NO_SINCRONIZADO` | El envío aún no llega al servidor (la app reintenta) |
| 409 | `PREOPERACIONAL_EN_OTRO_SERVICIO` | El envío ya está ligado a otro servicio |
| 409 | `ETAPA1_ABIERTA` | Borrador sin la etapa 1 (prealistamiento) cerrada |
| 422 | `SIN_VEHICULO` | El servicio no tiene vehículo |
| 422 | `PREOPERACIONAL_INVALIDO` | No es un formulario por etapas o no está en `DRAFT`/`SUBMITTED` |
| 422 | `VEHICULO_DISTINTO` | El preoperacional es de otro vehículo |
| 422 | `OTRO_DIA` | El preoperacional es de otro día |

### `POST /api/conductor-portal/servicios/:id/liberar`

**Body**

| Campo | Tipo | Obligatorio | Notas |
|---|---|---|---|
| `liberado_at` | fecha ISO | sí | Hora declarada: entre el inicio y ahora (+10 min de tolerancia por relojes adelantados) |
| `dispositivo_at` | fecha ISO | sí | |
| `diferido` | boolean | no | |
| `reporte` | objeto | no | Estricto. `km_final` (entero 0–10.000.000), `via_trocha`, `via_afirmado`, `via_mixto`, `via_pavimentada`, `riesgo_desniveles`, `riesgo_deslizamientos`, `riesgo_sin_senalizacion`, `riesgo_animales`, `riesgo_peatones`, `riesgo_trafico_alto` (booleanos), `estado_conductor` (`optimo`, `fatigado`, `regular`, `malo`), `novedades` (≤ 5.000); todos admiten `null` |

Pasa el servicio a `realizado` con `fecha_finalizacion = liberado_at` y los
efectos de la máquina de estados (conductor y vehículo a `disponible`), y guarda
el reporte en `servicio_ejecucion`. Un servicio ya liberado devuelve el estado
sin tocar nada. **Respuesta 200** — el objeto de ejecución.

**Errores**: 400 `DATOS_INVALIDOS`; 404; 409 `NO_INICIADO` (no está `en_curso` o
no se inició desde la app); 409 `PREOPERACIONAL_ABIERTO` (el preoperacional aún
no está `SUBMITTED`; la app reintenta); 422 `HORA_INVALIDA`.

### `POST /api/conductor-portal/servicios/:id/recomendaciones`

**Body**: `recomendaciones` (string, 1–5.000 tras recortar). Solo después de
liberar; reenviar reemplaza. **Respuesta 200** — el objeto de ejecución.
**Errores**: 400 `DATOS_INVALIDOS`, 404, 409 `NO_LIBERADO`.

### `GET /api/conductor-portal/capacitaciones`

`capacitaciones.service.ts`. **Respuesta 200** — `{ success, data: { asistencias_pendientes, evaluaciones_pendientes, asistencias_firmadas, evaluaciones_respondidas } }`:

- `asistencias_pendientes`: formularios de asistencia activos que no ha firmado,
  con fecha desde su `fecha_ingreso` (sin ella, desde ayer) hasta mañana.
- `evaluaciones_pendientes`: las de formaciones PESV cuya asistencia firmó, más
  las evaluaciones creadas en los últimos 30 días que no ha respondido (con al
  menos una pregunta; máx. 30).
- `asistencias_firmadas` y `evaluaciones_respondidas`: historial, máx. 30 cada uno.

### `GET /api/conductor-portal/asistencias/:token` y `POST /api/conductor-portal/asistencias/:token`

`:token` es el de `formularios_asistencia`, el mismo del QR público.

- `GET` — `{ success, data: { asistencia: { token, tematica, objetivo, fecha, hora_inicio, hora_finalizacion, tipo_evento, tipo_evento_otro, lugar_sede, nombre_instructor, activo }, firmada_en, firma, conductor: { nombre_completo, numero_documento, cargo, telefono } } }`.
  `firma` es su propia firma (data URI) si ya firmó.
- `POST` — body `{ firma: "data:image/…" }`. Nombre, documento, cargo y teléfono
  salen de su ficha de conductor y la fila lleva `device_fingerprint =
  portal-conductor:<id>`. **201** `{ success, data: { firmada_en } }`.

**Errores**: 404 asistencia inexistente o borrada; 403 «Esta asistencia ya no
está disponible» (inactiva); 409 ya firmó (también si gana otra petición
simultánea); 400 sin firma; 422 su ficha no tiene número de identificación.

### `GET /api/conductor-portal/evaluaciones/:id` y `POST /api/conductor-portal/evaluaciones/:id`

- `GET` — `{ success, data: { evaluacion: { id, titulo, descripcion, requiere_firma, puntaje_maximo, preguntas }, resultado, conductor } }`.
  Las preguntas van sin `esCorrecta` ni respuesta correcta: en `RELACION` la
  columna derecha va barajada y en `SOPA_LETRAS` la cuadrícula va sin posiciones.
  `resultado` (si ya respondió) trae su respuesta y un `estado` por pregunta
  (`correcta`, `parcial`, `incorrecta`), nunca la clave.
- `POST` — body:

  | Campo | Tipo | Obligatorio | Notas |
  |---|---|---|---|
  | `respuestas` | arreglo | sí | `{ preguntaId, valor_texto?, valor_numero?, opcionesIds?, relacion?: [{ izq, der }], trazos?: [{ palabra?, desde: [fila, col], hasta: [fila, col] }] }` |
  | `firma` | string | si `requiere_firma` | |

  Califica con `registrarResultado`, el mismo de la web pública.
  **201** `{ success, data: { puntaje_total, puntaje_maximo, respondida_en, respuestas } }`.

**Errores**: 404 (id que no es UUID, inexistente o borrada); 409 ya respondida,
o la evaluación cambió mientras la respondía (opción desconocida); 400
respuestas inválidas o falta la firma; 422 sin número de identificación.

### `GET /api/conductor-portal/extractos`

`extractos-portal.service.ts`. **Respuesta 200** — `{ success, data: { hoy, extractos, historial_total, historial_mostrado } }`:
primero los vigentes (no anulados con `vigencia_hasta ≥ hoy`, incluidos los que
aún no empiezan), luego los 30 más recientes del historial (anulados o vencidos);
un conductor de planta puede pasar de mil. Cada extracto sale de lo **impreso**
(`snapshot_json` firmado; en importados viejos sin snapshot, de las columnas):

`id`, `consecutivo`, `numero`, `estado` (`VIGENTE`, `POR_VENCER`, `VENCIDO`,
`ANULADO`, calculado al leer con la fecha de Bogotá), `vigencia_desde`,
`vigencia_hasta`, `contrato_numero`, `contratante { nombre, nit }`,
`objeto_contrato`, `origen_destino`, `convenio`,
`vehiculo { id, placa, modelo, marca, clase, numero_interno, tarjeta_operacion }`,
`conductores [{ nombre, cedula, licencia_vigencia, soy_yo }]`, `responsable`,
`codigo_verificacion` y `url_publica` (solo si está firmado), `huella`,
`firmado`, `emitido_at`, `anulado { fecha, motivo } | null`,
`reemplazado_por { id, numero } | null` y `pdf_nombre`. Ver [extractos](./extractos.md).

### `GET /api/conductor-portal/extractos/:id`

Un extracto, con el mismo formato. 400 `ID_INVALIDO` si no es UUID; 404
`NO_ENCONTRADO` si no figura en él (igual que si no existe).

### `GET /api/conductor-portal/extractos/:id/pdf`

PDF generado en el servidor con pdfmake y la misma maquetación que el dashboard
(`pdfExtractoDoc.ts` es espejo del archivo del front): QR, logo, firma y la
página de la resolución. Los anulados también se entregan. Uno sin firma
electrónica (importado del libro) sale sin código ni enlace de verificación y
con la marca «Copia del libro histórico · sin firma electrónica». Cabeceras:
`application/pdf`, `inline; filename="<pdf_nombre>"`, `private, no-store`.
**Errores**: 400 `ID_INVALIDO`; 404 `NO_ENCONTRADO`.

### `GET /api/conductor-portal/vehiculos/documentos`

Los papeles que le piden en vía, de sus vehículos (ver [Qué ve el token](#qué-ve-el-token)).

**Respuesta 200** — `{ success, data: { vehiculos: [ { id, placa, marca, linea, modelo, numero_interno, motivo: "asignado" | "extracto", extracto: { numero, vigencia_hasta } | null, hoy, documentos: [ { clave, etiqueta, vence, estado, dias, actual } ] } ] } }`.
Categorías: SOAT, revisión tecnomecánica, tarjeta de operación, pólizas RC
contractual y extracontractual, revisión preventiva, tarjeta de propiedad y
manual del vehículo. `actual` trae `id`, `nombre`, `mimetype`, `size`,
`tiene_archivo`, `fecha_vencimiento`, `fecha_expedicion`, `numero` y `emisor`,
sin historial ni metadatos internos. Ver [vehiculos-documentos](./vehiculos-documentos.md).

### `GET /api/conductor-portal/vehiculos/:vehiculoId/documentos/:documentoId/url`

URL firmada de S3 de **5 minutos** para abrir un documento: solo el actual de una
categoría para conductor y de un vehículo que hoy es suyo; las versiones
reemplazadas y los papeles internos no salen aunque se adivine el id.
`{ success, data: { url, expira_at, nombre, mimetype } }`.

**Errores**: 400 `ID_INVALIDO`; 404 `NO_ENCONTRADO`; 404 `SIN_ARCHIVO` (el
documento no tiene archivo cargado).

## Efectos

- **Correo**: `solicitar-acceso` envía el enlace (`EmailService.sendPortalAccessLink`,
  remitente `Cotransmeq <noreply@cotransmeq.com>`). Cada token emitido aquí
  deja una fila en `conductor_token`.
- **S3**: firmas en `firmas_desprendibles/…` y `firmas_primas/…`; soportes en
  `dias-laborados/<conductor>/<fecha>/<client_attachment_id>.<ext>`, subidos por
  `PUT` directo desde el cliente con la URL prefirmada. Nada se borra de S3.
- **Notificaciones** (campana y Web Push, ver [notificaciones](./notificaciones.md)):
  - firmar un desprendible avisa a los usuarios activos con `role` `admin` o
    `gestor_nomina`, área `talento_humano` o `administracion`, o permiso
    individual `nomina`, salvo a quien solo es de operaciones; `referencia_tipo`
    `nomina_desprendible_firmado:<año>:<mes>:<día de corte>`. Si el aviso falla,
    la firma se conserva;
  - liberar un servicio avisa a toda el área `operaciones` («Servicio realizado»,
    `referencia_tipo: 'servicio'`);
  - el primer registro de una fecha avisa a operaciones, talento humano y
    administración (`avisarDiaLaborado`).
- **Sockets** ([tiempo real](../tiempo-real.md)):
  `dias-laborados:registro-actualizado` a todos los sockets al guardar o retirar
  un día; `sheet:invalidate` a la sala de nómina del mes (el de `periodo_end`) al
  pasar un desprendible a `FIRMADA`; `servicio:estado-actualizado` cuando iniciar
  o liberar cambia el estado; `asistencias:respuesta:created` a todos al firmar
  una asistencia; `nueva-respuesta` a la sala `evaluacion-<id>` al responder.
- **Historial**: `historial_estado_liquidacion_nomina` con `PAGADA` → `FIRMADA`,
  sin usuario y motivo «Firma del conductor desde el portal (…)».
- **Puppeteer**: cada `GET /desprendibles/:id/pdf` abre un contexto de navegador
  efímero.
- **Servicios externos** ([integraciones](../integraciones.md)): Mapbox Directions
  (perfiles `driving-traffic` y `driving`) y Overpass para la vía. El envío de
  push a Expo lo hacen otros módulos con los dispositivos registrados aquí.

## Observaciones

- **La papelera corta el uso, no la emisión.** `solicitar-acceso` y
  `verificar-token` no miran `deleted_at`: un conductor en la papelera recibe el
  correo con un token nuevo y `verificar-token` lo valida, pero cada petición
  siguiente responde 401 «Tu acceso al portal venció o fue revocado». Un
  conductor oculto sigue entrando: la comprobación de registro solo mira
  `deleted_at`. `solicitar-acceso` lee `estado` pero no lo usa; solo
  `acceso-revision` exige `activo`. `conductor-portal.routes.ts`.
- El JWT viaja en la query del enlace y sirve 30 días, todas las veces
  (`conductor_token.used` nunca se marca).
- **La revocación no llega al socket de formularios**: `forms:join` solo
  verifica firma y `tipo`, así que un token revocado sigue recibiendo los avisos
  de formularios del conductor hasta que vence el JWT (ver
  [tiempo real](../tiempo-real.md#autenticación)).
- **Enumeración de cédulas**: `solicitar-acceso` responde 404 si la cédula no es
  de un conductor y 400 si no tiene correo, y devuelve el correo enmascarado. El
  límite de 3/h por cédula y 30/h por IP lo frena, no lo impide.
- **El detalle del desprendible devuelve la liquidación entera**: `GET
  /desprendibles/:id` y `/datos` usan `LiquidacionesService.obtenerPorId`, que
  incluye `creado_por`, `actualizado_por` y `liquidado_por` con nombre y correo de
  usuarios del equipo, datos que el desprendible no necesita.
- **Primas**: se listan y se pueden firmar en cualquier `estado` (también
  `Pendiente`), mientras que el desprendible exige `PAGADA`. Su firma no comprueba
  que sea PNG (acepta cualquier `data:image/*` y la guarda como `.png` con
  `image/png`) ni tiene tope en el esquema.
- **El respaldo de firmas (mes ±1) no filtra la liquidación de origen**: reutiliza
  la firma de un desprendible aunque esa liquidación esté borrada o no visible
  (`GET /prima/:id`, `GET /primas/:id/enriquecida`, `GET /primas/:id/firma`).
- `GET /primas/:id/enriquecida` escribe en el log, a nivel `info` y en cada
  llamada, nombre, cédula y correo del conductor.
- **Ids que no son UUID salen como 500** con el mensaje de Prisma en `message`:
  `desprendibles/:id` (y `/datos`, `/pdf`, `/firmar`), `prima/:id`,
  `primas/:id/*`, `servicios/:id`, `servicios/:id/via` y
  `notificaciones/:id/leida`. Extractos, ejecución, evaluaciones y soportes sí lo
  validan antes. Igual pasa con un valor de `estados` fuera del enum en
  `GET /servicios`.
- **Firmar un desprendible visible que no está `PAGADA` responde 404**
  «Liquidación no encontrada», y el listado no trae `estado_flujo` para saberlo
  antes de intentarlo.
- El esquema de `desprendibles/:id/firmar` admite 2.500.000 caracteres y el
  control de tamaño llega a 1,8 MB, pero el `bodyLimit` por defecto de Fastify
  (1 MiB) corta antes con 413.
- `GET /dias-laborados/clientes` y `/vehiculos` entregan a cualquier conductor el
  catálogo completo: clientes con NIT (ocultos incluidos, sin la marca `oculto`) y
  la flota entera con el `conductor_id` de cada vehículo.
- En `dias-laborados:registro-actualizado`, `conductor_apellido` va siempre
  vacío: el token no lo trae (`conductor_nombre` ya es el nombre completo).
- La clave de Mapbox se lee directo de `process.env` (`VITE_MAPBOX_ACCESS_TOKEN` o
  `MAPBOX_ACCESS_TOKEN`) y no está declarada en `src/config/env.ts`; sin ella,
  `ruta` es `null`, el tráfico `sin_datos` y peajes, paradas, obras y Distracom
  vacíos. `condiciones-via.service.ts`.

## Diferencias con Transmeralda

- `GET /api/conductor-portal/desprendibles/:id` devuelve aquí `dataParaPdf`
  (planillas de recargo clasificadas por `buildDataParaPdf`, ver arriba). En
  Transmeralda la respuesta es solo `{ liquidacion, recargos, firma }`.
