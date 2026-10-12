# Integraciones externas

Los servicios de fuera de los que depende el backend —S3, correo, push, IA,
MCP, mapas, Sentry— y las herramientas del sistema que usa para generar
documentos (Chromium, Ghostscript). Para cada uno: para qué sirve, dónde está el
código, qué variables lo configuran y qué pasa si faltan. Léelo antes de
levantar un entorno nuevo, de rotar una clave o cuando algo «externo» deja de
funcionar en un solo despliegue (casi siempre es configuración divergente, no
código). El inventario completo de variables está en
[variables-de-entorno.md](./variables-de-entorno.md); aquí no se copian valores
ni secretos.

## Resumen

| Servicio | Para qué | Variables principales | Si falta |
|---|---|---|---|
| AWS S3 | Archivos: firmas, documentos, evidencias, comprobantes, certificados | `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET_NAME` | Arranca; falla cada subida o descarga |
| Resend / SMTP | Todo el correo del sistema | `RESEND_API_KEY` o `SMTP_*` | Arranca; cada envío lanza «No hay proveedor de email configurado» |
| Gmail de contabilidad | Envío de liquidaciones a terceros | `CONTABILIDAD_SMTP_*`, `LIQ_EMAIL_*` | Cae a Resend o al SMTP global |
| Web Push (VAPID) | Avisos del navegador de la campana | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Push web apagado; la campana sigue |
| Expo Push | Avisos a las apps móviles | — (sin credenciales) | — |
| Azure OpenAI | Asistente del dashboard y lectura de comprobantes de viáticos | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Asistente «no disponible»; comprobantes a mano |
| Ministral (Azure AI) | Sugerencias de acciones correctivas y calificación de evaluaciones | `MINISTRAL_API_KEY`, `MINISTRAL_ENDPOINT` | Arranca; las sugerencias responden 500 y las preguntas abiertas reciben 0 |
| MCP | Conectar Claude o ChatGPT a la app | — (tokens personales en la base) | — |
| Chromium (Puppeteer) | HTML → PDF | `PUPPETEER_EXECUTABLE_PATH` | Falla cada PDF de Chromium |
| Ghostscript | Comprimir PDFs de la hoja de vida del conductor | — | Se suben sin comprimir |
| HERE | Autocompletado de sitios para la app móvil | `HERE_MAPS_API_KEY` | Solo lugares propios |
| Mapbox / Overpass | Ruta, mapa y condiciones de la vía | `MAPBOX_ACCESS_TOKEN` | Rutograma y condiciones sin ruta |
| Sentry | Rastreo de errores | `SENTRY_DSN` | No se carga el SDK |
| Base de Transmeralda | Importar recargos de la otra empresa | `TRANSMERALDA_DATABASE_URL` | Las rutas de importación responden 503 |

## AWS S3

**Para qué.** Todo archivo que sube un usuario o genera el sistema y hay que
conservar. Cada empresa tiene **su propio bucket**: la configuración (bucket,
credenciales, CORS) se hace dos veces.

**Archivos.** [config/aws.ts](../src/config/aws.ts) es el cliente general:
`uploadToS3`, `deleteFromS3`, `getS3SignedUrl` (GET firmado, 1 h por defecto),
`getS3UploadUrl` (PUT firmado para subir directo desde el cliente, 15 min),
`headS3Object`, `getS3ObjectStream`, `getS3ObjectAsBase64` y
`computeS3ObjectSha256`. Los certificados tributarios usan su propio cliente
([certificados.s3.ts](../src/modules/certificados-tributarios/certificados.s3.ts)).

**Variables.** `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`,
`AWS_S3_BUCKET_NAME`. Si faltan:

- `config/aws.ts` **no avisa**: usa `us-east-2`, credenciales vacías y el
  bucket `transmeralda` por defecto —el de la **otra empresa**, heredado del
  gemelo—, y el error aparece en cada operación. `AWS_S3_BUCKET_NAME` tiene
  que estar siempre definida aquí.
- Los certificados tributarios exigen las cuatro (`assertS3Config`) y responden
  con un mensaje claro (`S3ConfigError`).

**Carpetas del bucket:**

| Prefijo | Qué guarda | Módulo |
|---|---|---|
| `formularios-dinamicos/<versionId>/<envioId>/<adjuntoCliente>.<ext>` | Fotos y firmas de los formularios (PUT directo) | formularios-dinamicos |
| `dias-laborados/<conductorId>/<fecha>/<adjuntoCliente>.<ext>` | Adjuntos del reporte de días (PUT directo) | dias-laborados |
| `viaticos/comprobantes/<AAAA-MM>/<uuid>.<ext>`, `viaticos/gastos/<conductorId>/<gastoId>/<adjunto>.<ext>` | Comprobantes de anticipos y soportes de gastos (PUT directo) | viaticos |
| `firmas/<usuarioId>.<ext>` | Firma de un usuario del equipo | auth, usuarios |
| `firmas_desprendibles/<liquidacionId>/<conductorId>/<firmaId>.png`, `firmas_primas/…` | Firma de desprendibles y primas | liquidaciones, portal |
| `documentos_compartidos/signatures/<token>/<firmaId>.png` | Firmas de documentos compartidos | documentos |
| `conductores/<conductorId>/documentos/<CATEGORIA>/<uuid>.<ext>` | Hoja de vida del conductor (PDF comprimidos con Ghostscript) | conductores-documentos |
| `conductores/<conductorId>/<timestamp>-<nombre>` | Foto del conductor | conductores |
| `vehiculos/<vehiculoId>/documentos/<CATEGORIA>/<uuid>.<ext>` | Documentos del vehículo | vehiculos-documentos |
| `vehiculos/<vehiculoId>/mantenimiento/<ordenId>/<id><ext>` | Adjuntos de órdenes de trabajo | mantenimiento |
| `combustible/<vehiculoId>/<registroId>/<uuid><ext>` | Soportes de tanqueo | combustible |
| `incidentes/<id>/evidencias/<id><ext>` | Evidencias de incidentes | incidentes |
| `acciones-correctivas/adjuntos/<uuid>.<ext>` | Adjuntos de acciones correctivas | acciones-correctivas |
| `planillas/recargos/<uuid>.<ext>` | Planillas escaneadas de recargos | recargos |
| `cartera/abonos/<facturaId>/<abonoId><ext>` | Soportes de abonos | cartera |
| `liquidaciones-terceros/pagos/<AAAA-MM>/<uuid><ext>` | Comprobantes de pago a terceros | liquidaciones-terceros-pagos |
| `sarlaft/<año>/<radicado>/…` | Anexos del formulario SARLAFT y el PDF generado (`generado/declaracion_transporte_v<n>.pdf`) | formularios-sarlaft |
| `certificados-tributarios/<nit>/…` | Certificados tributarios de terceros | certificados-tributarios |
| `assets/…` | Imágenes públicas que usan los correos y los PDF (logo, icono de Distracom) | — |

**URL prefirmadas y checksum nativo.** El conductor sube fotos y firmas desde el
teléfono con un `PUT` directo a S3: pasarlas por la API significaría subir dos
veces y bloquear un worker durante una subida por datos móviles. La URL firma
el `Content-Type` y el `Content-Length`, así que un enlace filtrado no sirve
para subir otra cosa. Con `FORMS_S3_NATIVE_CHECKSUM` en `true` (el defecto) la
URL firma además el SHA-256 de los bytes: S3 rechaza la subida si no cuadra y
después el backend lo confirma con `HeadObject` (`ChecksumMode: 'ENABLED'`, sin
el cual S3 no devuelve el checksum). Lo usan formularios dinámicos, días
laborados y los gastos de viáticos. Con `false` (proveedores compatibles con S3
que no implementan checksums) la verificación descarga el objeto en streaming y
lo hashea, con tope de tamaño.

Dos trampas que ya mordieron:

- **El checksum no se reenvía como cabecera.** `getSignedUrl` lo sube al query
  string y lo firma ahí; si el cliente manda también `x-amz-checksum-sha256`
  como cabecera, es una cabecera `x-amz-*` sin firmar y S3 rechaza la subida
  entera con 403. El comentario de `getS3UploadUrl` en `aws.ts` todavía dice
  que S3 lo «exige como cabecera»: manda lo que explican
  `formularios-portal.service.ts` y [AGENTS.md](../AGENTS.md).
- **CORS del bucket.** El PUT sale del navegador o de la app, así que el bucket
  necesita una regla CORS que permita `PUT` desde los orígenes del frontend. Si
  falta, el preflight falla, `fetch` lanza sin llegar a AWS y en DevTools se ve
  igual que un problema de firma. Revísalo antes que la firma. Un
  `SignatureDoesNotMatch` de verdad trae el `CanonicalRequest` en el XML: cómo
  diagnosticarlo está en [AGENTS.md](../AGENTS.md).

## Correo

**Proveedor** ([email.service.ts](../src/services/email.service.ts)). Con
`RESEND_API_KEY` se usa Resend; si no, SMTP (nodemailer) con `SMTP_HOST`,
`SMTP_USER` y `SMTP_PASSWORD` (más `SMTP_PORT`, 587 por defecto, y
`SMTP_SECURE`). Ojo: **no es un respaldo ante fallos**. Si hay clave de Resend y
Resend rechaza el envío, no se reintenta por SMTP. Sin ninguno de los dos, cada
envío lanza «No hay proveedor de email configurado» y cada llamador decide qué
hacer (las colas lo anotan como `ERROR`).

**Remitente.** Resend solo envía desde un dominio verificado: el `from` sale de
`RESEND_FROM`, luego `SMTP_FROM` y por último
`Cotransmeq <noreply@cotransmeq.com>`. Si es un correo personal (gmail,
hotmail…) se avisa en el log, porque Resend lo rechaza. Con SMTP manda
`SMTP_FROM`. El helper genérico `EmailService.sendEmail` elige su remitente por
defecto según el proveedor (`RESEND_FROM` con Resend, `SMTP_FROM` con SMTP).

**Enlaces.** Los enlaces de los correos (portal del conductor, certificados,
invitaciones) se arman con `EMAIL_FRONTEND_URL`, luego el **primer** origen de
`FRONTEND_URL` y por último `http://localhost:5173`. Nunca con `FRONTEND_URL`
entero: es una lista separada por comas para el CORS y produciría enlaces rotos.
El enlace del portal para la app móvil no usa el esquema `cotransmeq://`
(Gmail le quita el destino): va a la página puente `https` del frontend
(`/public/abrir-app`), salvo que `MOBILE_PORTAL_URL` sea ya un `https` propio
([portal-access-link.ts](../src/lib/portal-access-link.ts)).

**Plantillas.** [email-plantilla.ts](../src/services/email-plantilla.ts) es la
base de todos los correos: tablas y CSS en línea, 600 px, imágenes solo por URL
pública absoluta (Gmail bloquea las base64). El logo sale de `EMAIL_LOGO_URL` o
de `LOGO_EMAIL_URL_POR_DEFECTO` ([branding.ts](../src/lib/branding.ts)), un
objeto público `assets/cotransmeq.png` que hoy vive en el bucket de
Transmeralda; la mascota, de
`<primer origen de FRONTEND_URL>/mascot/png/<reaccion>.png`. `MARCA` es el único
bloque que cambia entre empresas (aquí, verde bosque con el naranja para la
acción). Los constructores de cada correo son funciones
puras (`EmailPlantillas` en `email.service.ts`) para poder previsualizarlas sin
enviar. La carpeta `email/templates/` de la raíz solo la usan scripts viejos de
envío manual (`scripts/send_*`).

**Copia oculta de auditoría.** `NOTIF_BCC_EMAIL` va en copia oculta en los
desprendibles (salvo los envíos de prueba), las primas y los certificados
tributarios. No en los enlaces de acceso ni en las invitaciones, que llevan un
token personal.

**Buzón de contabilidad** (envío de liquidaciones a terceros desde los canvas
de cierres, ingresos y ocasional,
[envios-email.service.ts](../src/modules/liquidaciones-terceros-envios/envios-email.service.ts)).
El tercero tiene que ver el correo como enviado por contabilidad y su respuesta
tiene que llegar a ese buzón. Orden de proveedores:

1. **Gmail de contabilidad** por SMTP (`CONTABILIDAD_SMTP_USER` +
   `CONTABILIDAD_SMTP_PASSWORD`, un *app password* de Google; `smtp.gmail.com:587`).
   El remitente es ese Gmail, sin ambigüedad. Gmail limita unos 500 envíos al día.
2. **Resend**: remitente `LIQ_EMAIL_FROM_NAME <correo de RESEND_FROM>` y
   `Reply-To` a `LIQ_EMAIL_REPLY_TO`.
3. **SMTP global**, con el mismo nombre y `Reply-To`.

`LIQ_EMAIL_BCC` es la copia oculta de constancia. En Cotransmeq
`LIQ_EMAIL_FROM_NAME` vale por defecto «Contabilidad Cotransmeq S.A.S.», y
`LIQ_EMAIL_REPLY_TO` y `LIQ_EMAIL_BCC` **no tienen valor por defecto** a
propósito: el gemelo los trae apuntando a su propio Gmail de contabilidad, y
heredarlos mandaría las respuestas de los terceros a la otra empresa. Sin
ellas no hay `Reply-To` ni BCC. Ojo también con el remitente de reserva de este
archivo, que es compartido con el gemelo: con Resend y sin `RESEND_FROM` ni
`SMTP_FROM`, el correo sale como `noreply@transmeralda.com`. En modo prueba el
asunto lleva `[PRUEBA]`, no hay BCC ni copias y todo va al buzón de prueba. El
ritmo entre correos lo pone la cola
([tareas-programadas.md](./tareas-programadas.md#colas-en-memoria)).

**Otros flujos con configuración propia:**

- **SARLAFT** (`formularios-sarlaft/sarlaft-email-mode.ts`):
  `SARLAFT_EMAIL_MODE` (`produccion` | `sandbox`; `sandbox` redirige todo a
  `SARLAFT_TEST_RECIPIENT` y **lanza** si `NODE_ENV=production`),
  `SARLAFT_CLIENT_COPY_ENABLED` (apagado), `SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS`
  (3600) y `SARLAFT_PUBLIC_API_URL` (o `API_PUBLIC_URL`; si falta, el enlace de
  descarga apunta a localhost). Detalle en
  [sarlaft-declaracion-empresa-transporte/README_QA_EMAIL.md](./sarlaft-declaracion-empresa-transporte/README_QA_EMAIL.md).
- **Solicitudes de la landing**: `SOLICITUDES_WEB_EMAIL_TO` (lista por comas);
  vacía, solo se notifica en el panel.
- **Campañas de formularios**: espera 600 ms entre correos.

## Web Push (VAPID)

[web-push.service.ts](../src/modules/notificaciones/web-push.service.ts), con la
librería `web-push`. Cada `emitNotificacion` (la campana) también se manda a los
navegadores donde el usuario activó los avisos (`usuario_web_push`), para que le
llegue aunque no tenga la app abierta. TTL de 24 h, mensaje recortado a 400
caracteres; una suscripción que responde 404 o 410 se desactiva. Nunca lanza:
la fila de `notificacion` ya está escrita.

Variables: `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY` (generadas con
`npx web-push generate-vapid-keys`) y `VAPID_SUBJECT` (un `mailto:`; el valor
por defecto es `mailto:sistemas@transmeralda.com`, heredado del gemelo, así que
aquí conviene definirlo). Sin el par, el push web queda apagado y
`GET /api/notificaciones/web-push/clave` (la clave pública que pide el
frontend) devuelve `{ clave: null }`; la campana sigue igual. Con claves
inválidas, lo mismo más un error en el log.
`WEB_PUSH_CORREO=<correo> npm run test:web-push` reenvía como avisos reales las
últimas notificaciones de ese usuario, solo a sus navegadores.

## Push de las apps móviles (Expo)

Sin credenciales: un `POST` a `https://exp.host/--/api/v2/push/send` con los
tokens de los dispositivos. Hay tres copias del cliente:
[conductor-push.service.ts](../src/modules/conductor-portal/conductor-push.service.ts)
(app del conductor, `conductor_push_device` y `conductor_notification`), la de
nómina (`nomina-canvas/nomina-notificaciones.service.ts`, que se dejó aparte
para no tocar un camino de avisos de pago que funciona) y
[usuario-push.service.ts](../src/modules/usuario-push/usuario-push.service.ts)
(app de administrativos, `usuario_push_device`). El aviso de verdad es la fila
de la bandeja, que se escribe antes; el push es un intento adicional y sus
fallos no se propagan.

## IA

| Uso | Proveedor y cliente | Archivos | Variables | Si falta |
|---|---|---|---|---|
| Asistente del dashboard (chat con herramientas, en streaming) | Azure OpenAI con el SDK `openai` y `baseURL` al endpoint de Azure | [azure-openai.ts](../src/modules/asistente/azure-openai.ts), `asistente.service.ts` | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` | `GET /api/asistente/estado` → `{ disponible: false }` y el chat responde un evento de error. El backend arranca: el cliente se crea al primer uso |
| Lectura de comprobantes de anticipos de viáticos (valor, fecha y número desde la imagen o el PDF) | El mismo despliegue de Azure OpenAI | [viaticos-comprobante.service.ts](../src/modules/viaticos/viaticos-comprobante.service.ts) | Las mismas | 503 `LECTURA_NO_DISPONIBLE`: los datos se escriben a mano |
| Sugerencias para el plan de acción de una acción correctiva | Ministral 3B en Azure AI, con `fetch` a `<MINISTRAL_ENDPOINT>/chat/completions` | [ia-sugerencias.service.ts](../src/modules/acciones-correctivas/ia-sugerencias.service.ts) | `MINISTRAL_API_KEY`, `MINISTRAL_ENDPOINT`, `MINISTRAL_MODEL_NAME` (`Ministral-3B-2`) | El backend arranca; las dos rutas de sugerencias responden 500 con el mensaje del constructor (ver abajo) |
| Calificar respuestas abiertas de las evaluaciones | Ministral 3B con `@azure-rest/ai-inference` | [ai-grading.service.ts](../src/services/ai-grading.service.ts) | Las mismas `MINISTRAL_*` | Aviso en el log al arrancar y 0 puntos con «Calificación manual requerida» |

**Sugerencias de acciones correctivas al primer uso.** El constructor de
`IAsugerenciasService` lanza si faltan `MINISTRAL_API_KEY` o
`MINISTRAL_ENDPOINT`, así que `acciones-correctivas.controller.ts` no lo crea al
importarse sino en la primera petición que lo usa (`servicioIA()`): sin esas
variables el backend arranca —también en local, en las pruebas y en el script
de inventario de rutas— y solo fallan las sugerencias de IA. Si el constructor
lanza, no queda nada guardado: la siguiente petición vuelve a intentarlo.

**No hay Anthropic en el backend.** `@anthropic-ai/sdk` está en `package.json`
pero ningún archivo lo importa. La relación con Claude es la inversa: Claude (o
ChatGPT) se conecta a la app por MCP.

**De dónde salen en producción.** Las variables de Azure OpenAI (y la de HERE)
no están en el `.env` del servidor: el job `deploy` del workflow las toma de
los `vars`/`secrets` del entorno `production` de GitHub y las escribe en
`.azure-openai.env`, que el `docker-compose.yml` carga junto al `.env`. El
workflow también escribe `AZURE_OPENAI_API_VERSION` y `AZURE_OPENAI_MODEL`, que
el código no lee.

El filtro de contenido de Azure da falsos positivos con frases de la operación;
el asistente lo detecta (`content_filter`) y pide reformular en vez de «intenta
de nuevo».

## MCP

[mcp.routes.ts](../src/modules/mcp/mcp.routes.ts), con
`@modelcontextprotocol/sdk`: un servidor MCP sin estado (Streamable HTTP, cada
`POST` crea su `Server` y responde en JSON) para conectar Claude o ChatGPT.

- `POST /api/mcp` con `Authorization: Bearer cmq_…` (Claude Desktop, Claude
  Code, ChatGPT con token) y `POST /api/mcp/cmq_…` para los conectores que solo
  piden una URL. `GET`, `DELETE`, `PUT` y `PATCH` responden 405. El servidor se
  presenta como `cotransmeq`.
- El token es personal: se crea, lista y revoca desde el perfil
  (`/api/api-tokens`, tabla `api_tokens`, prefijo `cmq_`, hasta 10 activos por
  usuario). Detalle en [autenticacion.md](./autenticacion.md).
- Expone las mismas herramientas que el asistente
  (`modules/asistente/herramientas.ts`), filtradas por los permisos del dueño
  del token, más `search` y `fetch` (el par que exige ChatGPT). Las que
  escriben exigen `confirmado=true`.
- Los enlaces `/dashboard/…` que devuelven las herramientas se vuelven
  absolutos con `EMAIL_FRONTEND_URL` (o el primer `https` de `FRONTEND_URL`).
- Escribe con `reply.hijack()` y copia las cabeceras de `reply` a mano: tras el
  hijack Fastify ya no escribe las de CORS.

## PDF

| Herramienta | Para qué | Archivos |
|---|---|---|
| Puppeteer (`puppeteer-core`) + Chromium del sistema | `pdfFromHtml`: HTML → PDF de liquidaciones de terceros (canvas, ZIP y envíos por correo), desprendible del backend (descarga por API, ZIP y firma pública; maquetación según `DESPRENDIBLE_LAYOUT`), salidas no conformes, rutograma, evaluaciones, SARLAFT y `POST /api/pdf/from-html` (que aquí acepta además `preferCSSPageSize`). `pdfFromUrl`: imprime una página del portal web (documento de un envío de formulario para la app). `resultadoDePagina`: abre una página del web que genera el PDF con pdfmake y recoge el resultado (desprendible del portal, byte a byte el del web) | [pdf.service.ts](../src/services/pdf.service.ts) |
| pdfmake | Extracto de contrato (FUEC) para la app del conductor, con la misma maquetación que el dashboard: `pdfExtractoDoc.ts` es espejo del archivo del frontend y su spec falla si divergen | [extracto-pdf.ts](../src/modules/conductor-portal/extracto-pdf.ts) |
| pdfkit | PDFs de acciones correctivas, asistencias, evaluaciones y SARLAFT | `*/pdf-generator*.service.ts` |
| pdf-lib + `@pdf-lib/fontkit` | Llenar por coordenadas la plantilla PDF de la declaración SARLAFT de empresa de transporte | `formularios-sarlaft/declaracion-transporte-pdf.*` |
| Ghostscript (`gs`) | Comprimir los PDF escaneados de más de 300 KB de la hoja de vida del conductor (`/ebook`), en asíncrono y con tope de 60 s | [compresion.ts](../src/modules/conductores-documentos/compresion.ts) |

**Chromium.** `resolveChromiumPath()` prueba `PUPPETEER_EXECUTABLE_PATH`,
`PUPPETEER_CHROMIUM_PATH`, `CHROMIUM_PATH` y `CHROME_PATH`, luego las rutas
conocidas de Linux (`/usr/bin/chromium-browser`, `/usr/bin/chromium`…), las
apps de macOS y por último el `PATH`. La imagen instala `chromium` con `apk` y
exporta `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` (además de
`CHROME_BIN` y `CHROMIUM_PATH`, y `PUPPETEER_SKIP_DOWNLOAD=true`). Este
`pdf.service.ts` no tiene pie de página (`footerTemplate`), y con
`preferCSSPageSize` pasa la opción tal cual a Chromium sin quitar los márgenes
del servidor. En local hace falta Chrome o Chromium
instalado. Si no lo encuentra, la API arranca igual y falla cada PDF que lo
necesite. Hay un solo navegador por proceso, lanzado al primer uso con
`--no-sandbox`; `pdfFromUrl` y `resultadoDePagina` abren un contexto efímero
(almacenamiento propio, destruido al terminar) porque siembran una sesión.

**Depende del frontend.** `pdfFromUrl` y `resultadoDePagina` navegan a
`origenDelPortal()`: el **primer** origen de `FRONTEND_URL` (luego
`EMAIL_FRONTEND_URL`, luego `localhost:5173`). El orden de `FRONTEND_URL`
importa, y el backend tiene que poder alcanzar esa URL. La sesión se siembra en
`localStorage` con la clave `PORTAL_SESSION_STORAGE_KEY`
(`cotransmeq_portal_token`), que tiene que ser la misma que usa el
`portalStore` del frontend; el token sembrado es uno propio de minutos de vida
que solo abre la lectura que se imprime.

**Ghostscript.** Si `gs` no está, falla o tarda, se sube el original: comprimir
es un ahorro, nunca un motivo de rechazo. Solo se usa el comprimido si ahorra al
menos un 15 %. La imagen lo instala desde el 11-oct-2026; si alguien lo quita
del `Dockerfile`, los PDF vuelven a subirse sin comprimir sin que nada avise.

**Fuentes, logos y tokens visuales.** El PDF de SARLAFT en HTML carga sus
fuentes de Google Fonts (Chromium necesita salida a internet). Los generadores
toman el logotipo con `resolverLogoCotransmeq()` de
[branding.ts](../src/lib/branding.ts), que devuelve `null` antes que caer al de
Transmeralda (en `src/assets/` conviven los dos). Los tokens de color de las
liquidaciones de terceros son espejo del frontend; ver
[AGENTS.md](../AGENTS.md#documentos-pdf).

**Red de `pdfFromHtml`.** El HTML que llega a `pdfFromHtml` puede venir del
cliente (`POST /api/pdf/from-html`, el documento de un envío de formulario, los
canvas de cierres y sus envíos por correo), y las URL que traiga las pediría el
Chromium **del servidor**, desde su red. Por eso cada página se prepara con
`blindarPagina()` ([pdf-red.ts](../src/services/pdf-red.ts)) antes de cargar
el HTML: sin JavaScript y con interceptación de peticiones. Solo pasan `data:`,
`blob:`, `about:` y http(s) hacia direcciones públicas; se bloquean loopback,
redes privadas, enlace local (incluida la dirección de metadatos de la nube),
CGNAT (el rango de Tailscale), multicast y reservadas, IPv6 locales, nombres
sin punto (`frontend`, `postgres`), dominios internos (`.local`, `.internal`,
`.lan`, `.home`, `.corp`, `localhost`), nombres que no resuelven o que
resuelven a cualquiera de esas IP (basta una) y cualquier otro esquema
(`file:`, `ftp:`…). La resolución DNS se cachea 5 minutos por nombre. Lo
bloqueado no tumba la generación: simplemente no carga (una imagen rota en el
PDF). Las plantillas
propias no necesitan más, porque sus imágenes son `data:` o URL públicas (S3)
y ninguna usa JavaScript; en local, tampoco carga nada servido desde
`localhost`. `pdfFromUrl` y `resultadoDePagina` no pasan por ahí: abren
páginas del propio frontend, que necesitan JavaScript, sin HTML del cliente.

## Excel

- **`exceljs`**: el Excel de una liquidación de servicio (tres hojas:
  liquidación, recargos y trazabilidad; la marca por empresa llega de
  `excel-marca.ts`) en
  [excel-liquidacion.ts](../src/modules/liquidaciones-servicios/excel-liquidacion.ts),
  y el script `npm run nomina:contraste`.
- **`xlsx`** (SheetJS 0.18.5): exportaciones de asistencias e inducciones,
  lectura de los archivos de la conciliación de terceros en contabilidad y el
  importador de extractos (`npm run extractos:importar`). Es la última versión
  publicada en npm (SheetJS distribuye las siguientes desde su propio CDN) y
  arrastra avisos de seguridad conocidos al leer archivos manipulados;
  contabilidad la usa justo para leer archivos subidos.

## Mapas

| Servicio | Para qué | Archivo | Variable | Si falta |
|---|---|---|---|---|
| HERE (autocomplete y lookup) | Buscar sitios desde la app móvil: `GET /api/maps/autocomplete` y `GET /api/maps/lookup`. Los lugares propios (`custom_places`: pozos, campamentos) van primero | [maps.routes.ts](../src/modules/maps/maps.routes.ts) | `HERE_MAPS_API_KEY` | `autocomplete` devuelve solo los lugares propios con un `error` legible; `lookup` de un sitio de HERE responde 503 |
| Mapbox Directions y Static Images | Ruta, distancia y mapa del rutograma en PDF; ruta con pasos, tráfico e incidentes para la app del conductor | `servicios/rutograma.service.ts`, `conductor-portal/condiciones-via.service.ts` | `MAPBOX_ACCESS_TOKEN` (o `VITE_MAPBOX_ACCESS_TOKEN`, el nombre que usa el frontend) | Rutograma sin ruta ni mapa (aviso al construir el servicio); condiciones de vía con tráfico «sin datos» |
| Overpass (OpenStreetMap) | Paradas, estaciones, hospedaje y peligros a lo largo de la ruta | Los mismos | — | — |
| Distracom | Estaciones de servicio aliadas | `src/data/distracomlocations` (local) | `DISTRACOM_ICON_URL` (icono; por defecto, uno del bucket de Transmeralda) | — |

**Azure Maps no está en el backend.** Lo usa el frontend, en su ruta de
servidor de SvelteKit (`src/routes/api/maps/place/+server.ts` de
`cotransmeq-app`), junto con su propio proxy de HERE para la web. Las claves de
esos proxies se configuran en el frontend, no aquí. En el entorno local de
Cotransmeq se ha visto que faltan las claves de mapas (las de este backend y
las del frontend); antes de diagnosticar un buscador vacío, mira el `.env`
(este documento no lo lee).

## QR y firma de los extractos (FUEC)

El QR del extracto lo dibuja `qrcode` con las mismas opciones que el frontend
(`OPCIONES_QR_EXTRACTO`), así que es idéntico módulo a módulo. Cada extracto
lleva un HMAC-SHA512 del contenido impreso
([fuec-firma.ts](../src/modules/extractos/fuec-firma.ts)) que valida la página
pública. El secreto es `FUEC_FIRMA_SECRET` y, **si falta, `JWT_SECRET`**: en ese
caso rotar el `JWT_SECRET` (por ejemplo, para cerrar todas las sesiones)
invalidaría la validación de todos los extractos ya impresos. Conviene tener un
secreto propio.

## Sentry

Opcional, solo con `SENTRY_DSN`. Qué captura y qué no envía está en
[arquitectura.md](./arquitectura.md#sentry-opcional).

## Base de Transmeralda (importación de recargos)

Integración propia de Cotransmeq: las rutas
`/api/recargos/importar-desde-transmeralda/*` (vista previa, crear entidades
faltantes, sincronizar conductores e importar) leen planillas de recargos
directamente de la **base de datos de Transmeralda**.
[prismaTransmeralda.ts](../src/config/prismaTransmeralda.ts) crea al primer uso
un segundo `PrismaClient` contra `TRANSMERALDA_DATABASE_URL`
(`connection_limit=5`, `connect_timeout=10`, solo log de errores), aparte del
pool principal. Sin la variable, `requireTransmeraldaConfigured()` hace que
esas rutas respondan 503 sin intentar conectar; el resto del backend arranca
normal.

Trampa: ese cliente es el que se generó con el esquema **de Cotransmeq**. Si
una columna existe aquí y no en la base de Transmeralda, cualquier consulta del
importador que la toque falla; antes de añadir columnas a las tablas de
recargos, comprueba que el otro esquema las tenga o que el importador no las
pida. El apagado ordenado no desconecta este cliente.

## Diferencias con Transmeralda

`config/aws.ts`, `pdf.service.ts` (salvo lo indicado), `web-push.service.ts`,
`envios-email.service.ts`, `ai-grading.service.ts`, el módulo de mapas y los
clientes de Expo son iguales en `backend-nest`. Lo que cambia:

- **Marca de los correos.** Allí `MARCA` es la de Transmeralda (verdes), el
  logo por defecto es `assets/logo.png` de su bucket y el remitente de reserva
  es `Transmeralda <noreply@transmeralda.com>`.
- **Buzón de contabilidad.** Allí `LIQ_EMAIL_FROM_NAME`, `LIQ_EMAIL_REPLY_TO` y
  `LIQ_EMAIL_BCC` tienen valores por defecto que apuntan a su Gmail de
  contabilidad.
- **MCP:** el prefijo de los tokens es `tme_`.
- **Base de la otra empresa:** Transmeralda no tiene un cliente equivalente.
- **Chromium:** su imagen exporta `CHROME_PATH=/usr/bin/chromium`, y su
  `pdf.service.ts` admite pie de página (`footerTemplate`) y, con
  `preferCSSPageSize`, quita los márgenes del servidor para que mande el
  `@page` del CSS. Tiene además el reporte de recargos en PDF.
