# Variables de entorno

Inventario de todas las variables que lee el backend: las que valida
[`src/config/env.ts`](../src/config/env.ts) y las que se leen directamente con
`process.env` en cualquier parte de `src/`, más las que solo usan las pruebas y
el contenedor. Para cada una: si es obligatoria, su valor por defecto, para qué
sirve y qué pasa si falta. Léelo al montar un entorno nuevo, al añadir una
variable o cuando algo funciona en local y no en producción (casi siempre es
configuración distinta, no código). Cómo se usa cada servicio externo está en
[integraciones.md](./integraciones.md); las colas y los crons, en
[tareas-programadas.md](./tareas-programadas.md); los sockets, en
[tiempo-real.md](./tiempo-real.md).

## Cómo se cargan

- **`src/config/env.ts`** ejecuta `dotenv.config()` y valida `process.env` con
  un esquema de zod al importarse. Si falta una obligatoria o un valor no encaja
  (por ejemplo `PERMISSIONS_MODE=foo`), `envSchema.parse` lanza y **el proceso
  no arranca**. Los valores por defecto de ese esquema se aplican cuando la
  variable no está.
- **Lecturas directas.** Muchos módulos leen `process.env.X` sin pasar por el
  esquema; su valor por defecto está donde se lee, y se cita abajo. Algunas son
  así a propósito: `permissions.middleware.ts` lee `PERMISSIONS_MODE` de
  `process.env` para que los tests puedan alternarlo, y `sarlaft-email-mode.ts`
  recibe el entorno como parámetro.
- **Solo se carga `.env`** del directorio de trabajo (`env.ts`, `server.ts`,
  `config/prisma.ts` y `config/prismaTransmeralda.ts`). `.env.production` y
  `.env.azure` están versionados, pero ningún código los lee. `dotenv` no pisa
  lo que ya está en el entorno: una variable exportada en la shell o puesta por
  el contenedor manda sobre el archivo.
- **En producción no hay `.env` dentro de la imagen** (`.dockerignore` lo
  excluye): las variables llegan por los `env_file` de `docker-compose.yml` (el
  `.env` del servidor y el `.azure-openai.env` que escribe el workflow). Ver
  [despliegue.md](./despliegue.md).
- **[`.env.example`](../.env.example) está desactualizado.** Trae `DOMAIN`,
  `JWT_EXPIRY`, `REDIS_HOST` y `REDIS_PORT`, que nada lee (las colas no usan
  Redis); marca como opcionales las variables de Ministral, que son
  obligatorias; dice que `DESPRENDIBLE_LAYOUT` vale `clasico` por defecto, y es
  `nuevo`; y le faltan la mayoría de las de abajo. Este documento es la
  referencia. `.env.test` está versionado y solo lo carga la suite de pruebas
  ([pruebas.md](./pruebas.md)).

Tipos usados en las tablas: **Obligatoria** (sin ella no arranca),
**Producción** (arranca, pero en producción se rompe algo importante: CORS,
enlaces, correos, archivos) y **Opcional** (tiene valor por defecto o apaga una
función).

## Núcleo

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `DATABASE_URL` | Obligatoria | — | Conexión a PostgreSQL, del backend y de la CLI de Prisma. `config/prisma.ts` le quita comillas y le añade el pool (`connection_limit=10`, `pool_timeout=30`, `connect_timeout=10`) | No arranca (zod). Si está pero vacía, se arma con las `DB_*` |
| `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` | Opcional | `DB_PORT=5432`, `DB_NAME=postgres` | Alternativa a `DATABASE_URL`, solo si esta llega vacía. Con un host de `azure.com` añade `sslmode=require` | Nada mientras haya `DATABASE_URL`. La CLI de Prisma no las usa |
| `TRANSMERALDA_DATABASE_URL` | Opcional | — | Base de Transmeralda, para importar recargos (`importar-desde-transmeralda`). Ver [base-de-datos.md](./base-de-datos.md#lectura-cruzada-de-la-base-de-transmeralda) | Esas rutas responden 503; no se intenta conectar |
| `PORT` | Opcional | `4000` | Puerto HTTP; escucha en `0.0.0.0`. En local este repo se levanta en el 4000 | En el contenedor tiene que ser 4000: el compose publica `3001:4000` y el healthcheck pregunta al 4000 |
| `NODE_ENV` | Opcional | — (la imagen pone `production`) | Con `production`: logs JSON a nivel `info`, sin log de consultas, prohíbe el modo sandbox de SARLAFT y la emisión de plantillas no aprobadas; entorno por defecto de Sentry | Comportamiento de desarrollo |
| `LOG_LEVEL` | Opcional | `info` en producción, `debug` fuera | Nivel de pino ([`src/utils/logger.ts`](../src/utils/logger.ts)). Manda en los dos entornos | — |
| `LIMITE_APAGADO_MS` | Opcional | `25000` | Tope del apagado ordenado tras el SIGTERM ([`src/lib/apagado.ts`](../src/lib/apagado.ts)) | Tiene que quedar por debajo del `stop_grace_period: 30s` del compose |
| `FRONTEND_URL` | Producción | — | Orígenes CORS, separados por coma, que se suman a una lista fija (`localhost` y `127.0.0.1` en los puertos 5173, 5174 y 3000, `https://cotransmeq.com`, `https://www.cotransmeq.com` y `https://transmeralda-app.vercel.app`, que viene del gemelo). La primera URL es además respaldo de los enlaces de los correos | Solo pasan los orígenes de esa lista: el dominio del frontend de producción tiene que venir aquí |
| `EMAIL_FRONTEND_URL` | Producción | — | URL pública canónica del frontend: enlaces de los correos (portal, certificados, invitaciones), URL del QR de los extractos, enlace de la app de administrativos y URLs del MCP | Se usa la primera de `FRONTEND_URL` y, sin ella, `http://localhost:5173`. El envío de desprendibles de `liquidaciones.routes.ts` no mira `FRONTEND_URL` y cae directo a `localhost` |

## Autenticación y seguridad

Detalle de cada credencial en [autenticacion.md](./autenticacion.md) y de los
modos de permisos en [permisos.md](./permisos.md).

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `JWT_SECRET` | Obligatoria | — | Firma todos los JWT: equipo, app, portal, impresión, sockets. Es también el respaldo de la firma de extractos | No arranca. Cambiarla cierra todas las sesiones y, sin `FUEC_FIRMA_SECRET`, invalida la validación pública de los extractos ya emitidos |
| `FUEC_FIRMA_SECRET` | Opcional, recomendada | `JWT_SECRET` | Secreto del HMAC-SHA512 de los extractos FUEC ([`fuec-firma.ts`](../src/modules/extractos/fuec-firma.ts)) | Se firma con `JWT_SECRET`, que queda atado a todos los extractos emitidos |
| `PASSWORD_RECOVERY_SERVICE_TOKEN` | Opcional | — | Secreto compartido con el frontend para `/api/auth/recuperacion/*` (cabecera `x-recovery-token`) | Esas rutas responden 503 |
| `PERMISSIONS_MODE` | Opcional | `enforce` | `enforce` rechaza con 403; `warn` deja pasar y registra `[permisos:warn]`. Solo como salida de emergencia | — |
| `SOCKET_AUTH_MODE` | Opcional | `enforce` | `enforce` rechaza el handshake sin token válido (del equipo con su sesión abierta, o del portal); `permissive` deja pasar sin identidad y lo registra; `off` no verifica | — |
| `SOCKET_CORS_ORIGINS` | Opcional | — | Orígenes permitidos para Socket.IO, separados por coma | Se acepta cualquier origen (`*`) |
| `CRON_SECRET` | Producción, si hay programador externo | — | Cabecera `x-cron-secret` de las rutas `*/cron-hora` de snapshots (recorridos, cierres de terceros, ocasional) | Esas rutas responden 401 o 403 siempre. Los crons internos de `server.ts` no la necesitan |
| `LIQ_CHAT_SECRET` | Producción | — | Clave maestra en hexadecimal (la aleatoria de respaldo es de 32 bytes) del cifrado AES-256-GCM del chat de liquidaciones | Se genera una aleatoria en cada arranque: tras un reinicio o un despliegue, los mensajes anteriores no se pueden descifrar |

## Correo

[`src/services/email.service.ts`](../src/services/email.service.ts) usa Resend
si hay `RESEND_API_KEY`; si no, SMTP cuando están `SMTP_HOST`, `SMTP_USER` y
`SMTP_PASSWORD`. Sin ninguno de los dos, cada envío falla con «No hay proveedor
de email configurado».

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `RESEND_API_KEY` | Producción (o SMTP) | — | Proveedor principal | Se usa SMTP |
| `RESEND_FROM` | Producción | — | Remitente con Resend; tiene que ser de un dominio verificado | El servicio general cae a `SMTP_FROM` y luego a `Cotransmeq <noreply@cotransmeq.com>`, pero el envío de liquidaciones de terceros (`envios-email.service.ts`) cae a `noreply@transmeralda.com` |
| `SMTP_HOST`, `SMTP_USER`, `SMTP_PASSWORD` | Producción (o Resend) | — | SMTP de respaldo | Ver arriba |
| `SMTP_PORT` | Opcional | `587` | Puerto SMTP | — |
| `SMTP_SECURE` | Opcional | `false` | `true` para TLS directo | — |
| `SMTP_FROM` | Opcional | — | Remitente con SMTP | — |
| `EMAIL_LOGO_URL` | Opcional | Logo de Cotransmeq (`LOGO_EMAIL_URL_POR_DEFECTO` en `src/lib/branding.ts`) | Logo de las plantillas de correo | — |
| `NOTIF_BCC_EMAIL` | Opcional | — | Copia oculta en los envíos de desprendibles y primas | Sin copia |
| `CONTABILIDAD_SMTP_USER`, `CONTABILIDAD_SMTP_PASSWORD` | Opcional | — | Gmail de contabilidad: la vía preferida para que las liquidaciones de terceros salgan con ese remitente | Se envían por Resend con `LIQ_EMAIL_FROM_NAME` |
| `LIQ_EMAIL_FROM_NAME` | Opcional | `Contabilidad Cotransmeq S.A.S.` | Nombre visible de esos envíos | — |
| `LIQ_EMAIL_REPLY_TO` | Producción | `''` | Buzón que recibe las respuestas de los terceros. Vacía a propósito: el valor del gemelo mandaría las respuestas a la otra empresa | Sin `Reply-To`: las respuestas van al remitente |
| `LIQ_EMAIL_BCC` | Opcional; en producción se define en la variable `LIQ_EMAIL_BCC` del entorno `production` de GitHub Actions | `''` | Copia oculta de constancia. El workflow la incluye en el archivo de entorno del contenedor; los envíos de prueba nunca llevan copia | Sin copia |
| `SOLICITUDES_WEB_EMAIL_TO` | Opcional | — | Buzones, separados por coma, avisados por cada solicitud de la landing | Solo el aviso en el panel |

## Archivos (S3)

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` | Producción | `''` | Credenciales de S3 | Fallan todas las subidas y descargas; certificados tributarios exige las cuatro variables |
| `AWS_REGION` | Producción | `us-east-2` en `config/aws.ts`, `us-east-1` en `documentos.service.ts`, ninguno en certificados | Región del bucket | Los valores por defecto no coinciden entre módulos: ponla siempre |
| `AWS_S3_BUCKET_NAME` | Producción | `transmeralda` en `config/aws.ts`, `''` en `documentos.service.ts` | Bucket de la empresa | **Sin ella, `config/aws.ts` apunta al bucket de Transmeralda.** Cada despliegue tiene su propio bucket |
| `FORMS_S3_NATIVE_CHECKSUM` | Opcional | `true` | Con `true`, el PUT firmado lleva `ChecksumSHA256` y S3 rechaza bytes que no cuadren. `false` solo para proveedores compatibles sin checksums nativos: entonces se verifica descargando el objeto | Afecta adjuntos de formularios dinámicos, soportes de días laborados y comprobantes de viáticos |

El CORS del bucket no es una variable, pero es configuración por entorno: las
subidas desde el navegador y la app (PUT a una URL prefirmada) fallan sin una
regla de PUT, y el error se parece a uno de firma.

## Avisos push

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | Opcional | — | Par VAPID del Web Push de la campana (`npx web-push generate-vapid-keys`). La pública se sirve en `/api/notificaciones/web-push/clave` | Push web apagado; la campana funciona igual. Un par inválido se registra como error y también lo apaga |
| `VAPID_SUBJECT` | Opcional | Un `mailto:` de sistemas de Transmeralda (heredado del gemelo) | Contacto para los servicios de push | — |

Los avisos a los teléfonos (conductores y app de gestión) van por la API de
Expo y no necesitan variables.

## Inteligencia artificial

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `MINISTRAL_API_KEY`, `MINISTRAL_ENDPOINT` | Producción | — | Modelo Ministral en Azure: sugerencias de plan de acción en acciones correctivas y calificación de preguntas abiertas de evaluaciones. No están en `env.ts` | El backend arranca. Las dos rutas de sugerencias de acciones correctivas responden 500 (`IAsugerenciasService` se crea en la primera petición que lo usa y su constructor lanza), y las preguntas abiertas de las evaluaciones reciben 0 con «Calificación manual requerida» (`ai-grading.service.ts` avisa en el log al arrancar) |
| `MINISTRAL_MODEL_NAME` | Opcional | `Ministral-3B-2` | Nombre del modelo | — |
| `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT` | Opcional | — | Asistente de IA del dashboard y lectura de los comprobantes de viáticos ([`azure-openai.ts`](../src/modules/asistente/azure-openai.ts)); el cliente se crea al primer uso | El backend arranca; el chat responde con un error («Asistente sin configurar») y la lectura de comprobantes, 503 `LECTURA_NO_DISPONIBLE` (los datos se escriben a mano) |
| `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_MODEL` | — | — | El workflow las escribe en `.azure-openai.env`, pero nada en `src/` las lee | Sin efecto |

## Mapas

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `HERE_MAPS_API_KEY` | Opcional | — | Autocompletado y detalle de lugares (`/api/maps/*`) para la app móvil | El autocompletado devuelve solo los lugares propios y un `error`; el detalle responde 503 |
| `MAPBOX_ACCESS_TOKEN` (o `VITE_MAPBOX_ACCESS_TOKEN`) | Opcional | — | Ruta del rutograma en PDF y condiciones de vía del portal | El rutograma sale sin ruta (avisa en el log al arrancar) y las consultas a Mapbox fallan |
| `DISTRACOM_ICON_URL` | Opcional | Icono en el bucket S3 de Transmeralda | Icono de las estaciones en el rutograma | — |

## Colas en memoria

Las colas de [`src/queue/`](../src/queue/) viven en el proceso, sin Redis: un
reinicio pierde lo que estuviera esperando.

| Variable | Por defecto | Para qué |
|---|---|---|
| `BORRADOR_QUEUE_CONCURRENCY` | `1` | Trabajos simultáneos de la cola de borradores de cierres |
| `BORRADOR_QUEUE_MAX_SIZE` | `10` | Tamaño máximo de las colas de borradores (cierres y nómina) |
| `BORRADOR_QUEUE_JOB_TTL_MS` | `300000` | Vida de un trabajo de borrador |
| `ENVIO_LIQ_DELAY_MS` | `800` | Pausa entre correos de un lote (Resend admite 2 por segundo); envíos de liquidaciones de terceros y de desprendibles |
| `ENVIO_LIQ_MAX_QUEUE` | `5` | Lotes en cola |
| `ENVIO_LIQ_JOB_TTL_MS` | `600000` | Vida de un lote |

## Nómina, recargos y portal del conductor

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `DESPRENDIBLE_LAYOUT` | Opcional | `nuevo` | Maquetación del PDF del desprendible que genera el backend: `nuevo` o `clasico`. El comentario de `env.ts` y el `.env.example` dicen que el defecto es `clasico`; el código dice `nuevo` | Un valor distinto de los dos impide arrancar |
| `PLANILLA_PREFIX` | Producción | `TM` | Prefijo (1 a 5 caracteres) del número de planilla autogenerado. El comentario de `recargos.service.ts` dice que Cotransmeq usa `CM` | **Sin ella las planillas salen con el prefijo de Transmeralda** |
| `NOMINA_EMPRESA_PAREX_ID`, `NOMINA_EMPRESA_GEOPARK_ID` | Opcional | — | UUID de los clientes PAREX y GEOPARK, cuyos recargos entran en el IBC | `nomina-patch.service.ts` resuelve los ids por nombre y usa la variable solo de respaldo; `nomina-canvas.service.ts` la usa sin respaldo. Según el comentario del primero, no están puestas en ningún entorno |
| `NOMINA_FRACCION_AJUSTE` | Opcional | `0.08` | Fracción del ajuste de recargos | — |
| `SNAPSHOT_ANTIRREBOTE_MIN` | Opcional | `50` | Ventana antirrebote de las capturas automáticas de snapshots | — |
| `MOBILE_PORTAL_URL` | Opcional | `cotransmeq://portal` | Deep link de confianza para las solicitudes que vienen de la app móvil (no se acepta una URL del cliente, para evitar redirecciones abiertas) | — |
| `PORTAL_SESSION_STORAGE_KEY` | Opcional | `cotransmeq_portal_token` | Clave de `localStorage` con la que Chromium siembra la sesión al imprimir páginas del portal. Tiene que ser la misma que usa el `portalStore` del frontend | La página se imprime como no autenticada |

## SARLAFT

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `SARLAFT_EMAIL_MODE` | Opcional | `produccion` | `sandbox` redirige todos los correos SARLAFT a `SARLAFT_TEST_RECIPIENT` y prefija el asunto con `[SANDBOX]` | Con `NODE_ENV=production`, `sandbox` lanza un error en vez de redirigir |
| `SARLAFT_TEST_RECIPIENT` | Opcional | — | Buzón del modo sandbox | — |
| `SARLAFT_CLIENT_COPY_ENABLED` | Opcional | `false` | Copia del PDF al correo del declarante, apagada por decisión de negocio | — |
| `SARLAFT_PUBLIC_DOWNLOAD_TTL_SECONDS` | Opcional | `3600` | Vigencia del enlace temporal de descarga; tope de 24 h | — |
| `SARLAFT_PUBLIC_API_URL` | Producción | — | URL pública de este backend para el enlace de descarga del correo | Se usa `API_PUBLIC_URL` y, sin ella, `http://localhost:PORT`, que solo sirve en desarrollo |
| `API_PUBLIC_URL` | Opcional | — | Respaldo de la anterior | — |
| `SARLAFT_EMPRESA_NOMBRE` | Opcional | `COTRANSMEQ S.A.S.` | Nombre de la empresa que devuelve el controlador público | — |
| `SARLAFT_TELEFONO`, `SARLAFT_TELEFONO_WA` | Opcional | Los teléfonos de contacto escritos en `sarlaft-config.ts` | Teléfono principal y de WhatsApp de los formatos | — |
| `SARLAFT_EMAILS_CLIENTE_PROVEEDOR`, `SARLAFT_EMAILS_ACCIONISTAS`, `SARLAFT_EMAILS_PERSONAL`, `SARLAFT_EMAILS_AUTORIZACION_PROPIETARIO`, `SARLAFT_EMAILS_DECLARACION_TRANSPORTE` | Opcional | Los buzones internos escritos en `sarlaft-config.ts` | Destinatarios internos de cada tipo de formulario, separados por coma. Se leen con `process.env[clave]` (no aparecen buscando `process.env.X`) y solo se aceptan direcciones de `CANALES_AUTORIZADOS`; las demás se descartan con un aviso | Se usan los buzones por defecto, también si tras filtrar no queda ninguno |

## Observabilidad

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `SENTRY_DSN` | Opcional | — | Activa Sentry ([`src/lib/sentry.ts`](../src/lib/sentry.ts)) | No se carga ni el SDK |
| `SENTRY_ENVIRONMENT` | Opcional | `NODE_ENV`, o `development` | Entorno del evento | — |
| `SENTRY_RELEASE` | Opcional | — | Versión, p. ej. el SHA desplegado | — |
| `SENTRY_TRACES_SAMPLE_RATE` | Opcional | — | Muestreo de trazas. Definida, aunque valga 0, carga la instrumentación de todo | Sin trazas |

`LOG_LEVEL` y `NODE_ENV` están en [Núcleo](#núcleo).

## PDF con Chromium

| Variable | Tipo | Por defecto | Para qué | Si falta |
|---|---|---|---|---|
| `PUPPETEER_EXECUTABLE_PATH`, `PUPPETEER_CHROMIUM_PATH`, `CHROMIUM_PATH`, `CHROME_PATH` | Opcional | La imagen fija `PUPPETEER_EXECUTABLE_PATH`, `CHROME_BIN` y `CHROMIUM_PATH` en `/usr/bin/chromium-browser` | Ruta de Chromium para Puppeteer ([`pdf.service.ts`](../src/services/pdf.service.ts)), en ese orden de preferencia (`CHROME_BIN` no la lee el código) | Se prueban rutas conocidas de macOS y Linux y el `PATH`; si no hay nada, el primer PDF falla con un error descriptivo |

## Solo para pruebas

| Variable | Para qué |
|---|---|
| `ALLOW_DESTRUCTIVE_TESTS` | `true` deja que la suite borre en una base cuyo nombre no contiene `test` ni `_local`. Ver [pruebas.md](./pruebas.md) |
| `TEST_DB_SIN_DOCKER` | `1`: `npm run test:setup` no levanta Docker y usa la base que ya escucha en el 55433 (el modo del CI) |
| `WEB_PUSH_CORREO` | Usuario al que `npm run test:web-push` reenvía sus últimas notificaciones |
| `WEB_PUSH_CANTIDAD` | Cuántas (por defecto 10, entre 1 y 50) |

`.env.test` define además `JWT_EXPIRY`, que ningún código lee: la vigencia del
token del equipo está fija en `auth.service.ts` (30 días, 90 con «recordarme»).

## Scripts de migración entre bases

No las lee el servidor, solo los scripts de `scripts/` que copian o comparan
datos entre dos bases (`check-databases.ts`, `compare-databases.ts`,
`migrate-to-azure.ts`, `migrate-fixed.ts`, `migrate-smart.ts`…). Las
credenciales no están escritas en el código: salen de estas dos variables.

| Variable | Para qué | Si falta |
|---|---|---|
| `MIGRACION_ORIGEN_URL` | Cadena de conexión `postgresql://…` de la base de origen | El script sale con 1 y dice qué variable falta |
| `MIGRACION_DESTINO_URL` | Cadena de conexión de la base de destino | Ídem |

## Contenedor y despliegue

`docker-compose.yml` lee `BACKEND_ENV_FILE` (por defecto `.env`): el archivo de
entorno del contenedor, que el script de despliegue apunta al `.env` del
servidor. Este repo no tiene `docker-entrypoint.sh`, así que tampoco las
variables `PRISMA_MIGRATE_ON_START` y `PRISMA_AUTO_RESOLVE_FAILED` del gemelo.

## Diferencias con Transmeralda

| Variable | Cotransmeq | Transmeralda |
|---|---|---|
| `MOBILE_PORTAL_URL` | `cotransmeq://portal` | `transmeralda://portal` |
| `PORTAL_SESSION_STORAGE_KEY` | `cotransmeq_portal_token` | `transmeralda_portal_token` |
| `LIQ_EMAIL_FROM_NAME` | `Contabilidad Cotransmeq S.A.S.` | `Contabilidad Transmeralda S.A.S.` |
| `LIQ_EMAIL_REPLY_TO`, `LIQ_EMAIL_BCC` | Vacías | El Gmail de contabilidad de Transmeralda |
| `TRANSMERALDA_DATABASE_URL` | Base de Transmeralda para importar hacia Cotransmeq | No existe |
| `COTRANSMEQ_DATABASE_URL` | No existe | Base de Cotransmeq para importar hacia Transmeralda |
| `SARLAFT_EMPRESA_NOMBRE`, `SARLAFT_TELEFONO`, `SARLAFT_TELEFONO_WA`, `SARLAFT_EMAILS_*` | Solo aquí | No existen: nombre, teléfonos y buzones están escritos en el código |
| `PRISMA_MIGRATE_ON_START`, `PRISMA_AUTO_RESOLVE_FAILED` | No existen | Las lee su `docker-entrypoint.sh` |
| `FORMS_S3_NATIVE_CHECKSUM` | En `env.ts` | También, en otra posición del archivo y con el mismo uso |
| `.env.example` | Existe, desactualizado | No existe |

**Valores por defecto que apuntan a Transmeralda.** Por herencia del gemelo,
varias variables caen en valores de la otra empresa si no se ponen:
`PLANILLA_PREFIX` (`TM`), `AWS_S3_BUCKET_NAME` en `config/aws.ts`
(`transmeralda`), el remitente de los envíos de liquidaciones de terceros
(`noreply@transmeralda.com`), `VAPID_SUBJECT` y el origen CORS
`https://transmeralda-app.vercel.app`. En producción, las tres primeras tienen
que estar puestas.
