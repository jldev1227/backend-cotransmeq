# Arquitectura del backend

Cómo está montado el backend de Cotransmeq: con qué piezas, dónde vive cada
cosa, cómo arranca, cómo se apaga y por dónde pasa una petición. Léelo antes de
tocar `src/app.ts` o `src/server.ts`, de crear un módulo nuevo o de añadir un
plugin. La referencia de endpoints está en [api/](./api/README.md); la
autenticación, las guardas y los permisos tienen documento propio
([autenticacion.md](./autenticacion.md), [middlewares.md](./middlewares.md),
[permisos.md](./permisos.md)), igual que el tiempo real
([tiempo-real.md](./tiempo-real.md)), los crons y colas
([tareas-programadas.md](./tareas-programadas.md)) y los servicios externos
([integraciones.md](./integraciones.md)).

## Stack

**Es Fastify, no NestJS**, pese a que el repo gemelo de Transmeralda se llame
`backend-nest`: no hay módulos, decoradores ni inyección de dependencias de
Nest. Son plugins de Fastify, servicios como objetos o clases estáticas, y
Prisma sobre PostgreSQL.

`@nestjs/schedule` está en `package.json`, pero **ningún archivo lo importa**.
Los crons usan `CronJob` de la librería `cron` (v4), que no está declarada en
`package.json`: llega como dependencia de `@nestjs/schedule`. Quitar el paquete
de Nest «porque no se usa» se lleva `cron` por delante y deja sin compilar
`src/jobs/` y [apagado.ts](../src/lib/apagado.ts). Si se quiere limpiar, primero
se declara `cron` como dependencia directa y después se quita
`@nestjs/schedule` (que de paso instala `@nestjs/common` y `@nestjs/core` como
*peer dependencies* que nadie usa).

| Pieza | Declarada en `package.json` | Instalada (lockfile) | Para qué |
|---|---|---|---|
| `fastify` | `^4.0.0` | 4.29.1 | Servidor HTTP |
| `@fastify/helmet` | `^10.0.0` | 10.1.1 | Cabeceras de seguridad |
| `@fastify/cors` | `^8.0.0` | 8.5.0 | CORS del API REST |
| `@fastify/multipart` | `^8.3.1` | 8.3.1 | Subidas `multipart/form-data` |
| `@fastify/static` | `^6.12.0` | 6.12.0 | `/assets/*` |
| `@fastify/swagger` | `^8.0.0` | 8.15.0 | Registrado, pero no sirve nada (ver [abajo](#documentación-de-la-api-no-hay-docs)) |
| `prisma` / `@prisma/client` | `5.22.0` / `5.22.0` (exactas) | 5.22.0 | ORM sobre PostgreSQL |
| `socket.io` | `^4.0.0` | 4.8.3 | Tiempo real |
| `cron` | (transitiva de `@nestjs/schedule`) | 4.4.0 | Crons |
| `pino` / `pino-pretty` | `^8.0.0` / `^13.1.2` | 8.21.0 / 13.1.3 | Logs |
| `zod` | `^3.0.0` | 3.25.76 | Variables de entorno y validación de entrada |
| `@sentry/node` | `^11.6.0` | 11.6.0 | Rastreo de errores, opcional |
| `typescript` / `tsx` / `vitest` | dev | 5.9.3 / 3.14.0 / 4.1.x | Compilación, desarrollo y pruebas |

Las librerías de PDF, Excel, correo, S3, IA, mapas y push están en
[integraciones.md](./integraciones.md). `package.json` declara además
`node-cron`, `axios`, `polyline` y `@mapbox/polyline`, que ningún archivo
importa: los crons son de `cron`, no de `node-cron`.

**Runtime.** Node 20 (`node:20-alpine` en el `Dockerfile`; el job `verificar`
del CI usa la misma major). TypeScript compila a **CommonJS** (`module:
CommonJS`, `target: ES2021`) y con `strict: false`. `npm run dev` corre
`tsx watch src/server.ts`; `npm run build` hace `tsc` y copia `src/assets` a
`dist/assets`. Que sea CommonJS importa: un ciclo de imports deja uno de los
dos módulos a medio inicializar (`undefined`) durante la carga, y por eso hay
archivos que existen solo para cortar ciclos (por ejemplo
[sheet-rooms.ts](../src/sockets/sheet-rooms.ts)).

`npm run typecheck` (`tsc --noEmit`) está en cero errores y el CI lo exige
antes de desplegar; ver [AGENTS.md](../AGENTS.md).

## Estructura de `src/`

| Carpeta / archivo | Qué hay |
|---|---|
| [server.ts](../src/server.ts) | Arranque del proceso: base, app, crons, puerto, sockets |
| [app.ts](../src/app.ts) | `buildApp()`: plugins, hooks globales y registro de todos los módulos con prefijo `/api` |
| `config/` | [env.ts](../src/config/env.ts) (variables validadas con zod), [prisma.ts](../src/config/prisma.ts) (cliente principal), [prismaTransmeralda.ts](../src/config/prismaTransmeralda.ts) (segundo cliente, contra la base de Transmeralda, solo para importar recargos), [aws.ts](../src/config/aws.ts) (S3), [permissions.ts](../src/config/permissions.ts) (áreas y módulos, ver [permisos.md](./permisos.md)) |
| `middlewares/` | `authMiddleware`, permisos, caché de sesiones, guarda de bonos; ver [middlewares.md](./middlewares.md). `error.middleware.ts` existe pero no se usa |
| `modules/` | 64 carpetas, una por dominio (servicios, recargos, nómina, liquidaciones, formularios…) |
| `jobs/` | Los 12 crons; ver [tareas-programadas.md](./tareas-programadas.md) |
| `queue/` | Colas en memoria (borradores, guardado masivo, envíos por correo) y sus gateways de socket |
| `sockets/` | Socket.IO: inicialización, autenticación del handshake, gateways de canvas y de cierres; ver [tiempo-real.md](./tiempo-real.md) |
| `lib/` | Lógica pura o transversal sin dependencias pesadas: [apagado.ts](../src/lib/apagado.ts), [sentry.ts](../src/lib/sentry.ts), [branding.ts](../src/lib/branding.ts) (logotipos de Cotransmeq), `nomina/` (cálculo de nómina, con su [README](../src/lib/nomina/README.md)), `recargos/`, `pagos/`, `soft-delete/` (helpers del borrado lógico), `portal-access-link.ts` |
| `services/` | Servicios compartidos: correo ([email.service.ts](../src/services/email.service.ts) y [email-plantilla.ts](../src/services/email-plantilla.ts)), PDF con Chromium ([pdf.service.ts](../src/services/pdf.service.ts)), calificación con IA, lista blanca de rutas por usuario |
| `utils/` | [logger.ts](../src/utils/logger.ts), [limitador.ts](../src/utils/limitador.ts) (límite de intentos en memoria), `numero-de-celda.ts` (leer números que llegan formateados desde Univer), `snapshot-version.ts` (versionado de snapshots con advisory lock) |
| `assets/` | Logos, fuentes, imágenes del FUEC, plantillas HTML de PDF. Se sirven en `/assets/*` y los generadores de PDF los leen del disco. Ojo: `logo.png` y `transmeralda-logo.png` son de **Transmeralda**; los de Cotransmeq son `cotransmeq-logo.png` y `logo_cotransmeq-264.webp`, y se resuelven con `lib/branding.ts` |
| `scripts/` | Dos scripts viejos de migración y sincronización (`migrar-terceros.ts`, `sync-certificados-s3.ts`), a mano con `tsx`. Los scripts operativos están en `scripts/` de la raíz del repo |
| `data/` | Estaciones de Distracom (rutograma y condiciones de vía) |
| `types/` | Declaraciones globales |

`lib/` y `utils/` están separados de los servicios a propósito: los servicios
arrastran sockets, colas y Prisma al importarse, y lo que vive en `lib/` tiene
que poder probarse sin nada de eso (ver la sección de borrado lógico de
[AGENTS.md](../AGENTS.md)).

## Anatomía de un módulo

Un módulo es una carpeta de `src/modules/` con, como mínimo, un archivo de
rutas. Las piezas habituales:

| Archivo | Responsabilidad |
|---|---|
| `<modulo>.routes.ts` | Plugin de Fastify (`export async function xRoutes(app)`). Declara la autenticación y el permiso **a nivel de plugin** y las rutas |
| `<modulo>.controller.ts` | Lee y valida la entrada, llama al servicio, traduce errores a HTTP y emite los eventos de socket **después** del commit. En los módulos nuevos (mantenimiento, combustible, incidentes, viáticos) los handlers van dentro del propio archivo de rutas |
| `<modulo>.service.ts` | Reglas de negocio y Prisma. No conoce `FastifyReply`; lanza errores de dominio |
| `<modulo>.schema.ts` | Esquemas zod de entrada (hay 27 de estos archivos); algunas rutas declaran además esquema JSON de Fastify |
| `<modulo>.events.ts` | Tabla `EVENTOS_*` con los nombres de los eventos y sus emisores ([tiempo-real.md](./tiempo-real.md)) |
| `*.spec.ts` | Pruebas unitarias junto al código. Las de integración, con base, están en `tests/` |
| Otros | `*.dominio.ts` / `calculo.ts` (reglas puras), `*.template.ts` (HTML para Chromium), `*.gateway.ts` (handlers de socket), `catalogo.ts`, `*.types.ts` |

`servicios/` es un ejemplo completo (rutas, controlador, servicio, esquema,
eventos, máquina de estados y rutograma). El esqueleto que hay que seguir:

```ts
export async function miModuloRoutes(app: FastifyInstance) {
  app.addHook('onRequest', authMiddleware)                // toda ruta nace protegida
  app.addHook('preHandler', permisoPorMetodo('mi-modulo')) // read para GET, full para el resto
  app.get('/mi-modulo', MiModuloController.listar)
}
// y en app.ts:  app.register(miModuloRoutes, { prefix: '/api' })
```

La autenticación va en el plugin y no ruta por ruta porque así se abrió el
módulo de servicios entero a internet; las rutas públicas son una excepción
explícita (ver [middlewares.md](./middlewares.md#proteger-una-ruta-o-un-módulo-nuevo)).
Un módulo nuevo también va en `ROUTE_PERMISSIONS` y en su espejo del frontend
([permisos.md](./permisos.md#añadir-un-módulo)).

## Arranque

[server.ts](../src/server.ts), en este orden:

1. **Imports.** `dotenv/config` y luego `./lib/sentry`, que tiene que cargar
   antes que el resto (solo hace algo con `SENTRY_DSN`). Importar `./app` carga
   **todos** los módulos, y con ellos [env.ts](../src/config/env.ts): si una
   variable obligatoria falta (`DATABASE_URL`, `JWT_SECRET`) o no pasa el
   esquema zod, el proceso muere aquí, antes de `start()`.
2. `instalarApagadoOrdenado()`, antes de arrancar: un SIGTERM que llegue
   durante el arranque también se atiende.
3. `testDatabaseConnection()`: `$connect` y `SELECT 1`. Si falla, sale con 1.
4. `buildApp()` y `await app.ready()`: aquí se cargan los plugins; un plugin
   que lanza tumba el arranque.
5. `registrarServidor(app)` y los 12 crons, cada uno dentro de
   `registrarCron('nombre', startXCron())`. Se loguean los nombres registrados.
6. `app.listen({ port: env.PORT, host: '0.0.0.0' })`. `PORT` vale 4000 por
   defecto, que es también el puerto local (el de Transmeralda corre en el
   4100 para poder levantar los dos a la vez); el contenedor expone 4000 y el
   compose lo publica en el 3001.
7. `initSockets(app.server)`: Socket.IO se monta **después** del `listen`,
   sobre el mismo servidor HTTP. Los emisores de eventos toleran que todavía
   no exista (`getIo()` lanza y lo atrapan).

`GET /` responde `{ "status": "ok" }`: es lo que mira el healthcheck del
contenedor.

**Nada que lance al importarse.** Importar `./app` carga todos los módulos, así
que un `new Servicio()` a nivel de módulo cuyo constructor lance tumba el
arranque entero. Por eso el controlador de acciones correctivas crea
`IAsugerenciasService` en la primera petición que lo usa (`servicioIA()`): su
constructor lanza si faltan `MINISTRAL_API_KEY` o `MINISTRAL_ENDPOINT`, y sin
ellas solo fallan las sugerencias de IA (ver
[integraciones.md](./integraciones.md#ia)). Un servicio nuevo con
configuración opcional valida en el primer uso, no al importar.

## Apagado ordenado

Cada despliegue recrea el contenedor (`docker compose up --force-recreate`), y
Docker manda SIGTERM. Node corre como PID 1 (la imagen arranca con
`CMD ["node", "dist/server.js"]`; instala `dumb-init` pero no lo usa), así que
sin un manejador propio el SIGTERM no hacía nada y Docker lo remataba con
SIGKILL a los 10 s, con un cron de snapshots a medias.
[apagado.ts](../src/lib/apagado.ts) atiende SIGTERM y SIGINT:

1. Los crons registrados dejan de programar ticks nuevos.
2. En paralelo: `app.close()` (deja de aceptar conexiones y termina las
   peticiones en curso) y el cierre de Socket.IO (sin él, el servidor esperaría
   a que los clientes se fueran solos, cosa que no hacen).
3. Se espera a que termine la ejecución en curso de cada cron.
4. `prisma.$disconnect()`, se vacía la cola de Sentry y se sale con 0 (con 1
   si algún cron no terminó).

Todo con un tope, `LIMITE_APAGADO_MS` (25 s por defecto), por debajo del
`stop_grace_period: 30s` del `docker-compose.yml`: si se agota, el proceso deja
en el log qué crons seguían corriendo y sale con 1, que es mejor que un SIGKILL
mudo. Una segunda señal durante el apagado sale en el acto (un segundo Ctrl+C
en desarrollo).

`registrarCron` activa `waitForCompletion` de `cron` v4: `stop()` devuelve una
promesa que espera la ejecución en curso, y un tick que llega con el anterior
todavía corriendo se salta en vez de solaparse. Un cron arrancado sin
`registrarCron` funciona, pero el apagado no lo espera.

**Lo que el apagado no espera:** los trabajos de las colas en memoria
(`src/queue/`) y los recálculos masivos de recargos, que se cortan donde estén
(ver [tareas-programadas.md](./tareas-programadas.md#qué-pasa-al-reiniciar-el-proceso)),
ni el Chromium de Puppeteer, que muere con el proceso. Tampoco hace
`$disconnect()` del cliente de `prismaTransmeralda.ts` (solo del principal):
sus conexiones se cierran cuando sale el proceso.
`tests/apagado-ordenado.test.ts` fija la espera, el plazo y el no solapamiento.

## Ciclo de vida de una petición

Fastify 4 encola cada `addHook` del contexto raíz en el orden en que
`buildApp()` lo registra, así que el orden de [app.ts](../src/app.ts) **es** el
orden de ejecución. Por eso `instalarSentry(app)` va lo primero: sus hooks solo
alcanzan a lo que se registra después.

```
petición HTTP
  │
  ├─ onRequest  helmet              cabeceras de seguridad
  ├─ onRequest  cors                ¿Origin permitido? (los OPTIONS se responden aquí)
  ├─ onRequest  app.ts              request.prisma = prisma
  ├─ onRequest  plugin del módulo   authMiddleware / guarda del portal / lista de rutas públicas
  ├─ parseo del cuerpo              JSON; multipart se lee en el handler (≤ 200 MB por archivo)
  ├─ preValidation                  esquema JSON de la ruta, si lo declara
  ├─ preHandler plugin y ruta       permisos (permisoPorMetodo / requirePermission) y guardas propias
  ├─ handler                        controller → service → Prisma; eventos de socket tras el commit
  ├─ preSerialization app.ts        sinCredenciales: quita todo campo `password` de la respuesta
  ├─ onSend     Sentry              (solo con SENTRY_DSN) respuestas 5xx armadas a mano
  ├─ onSend     registro actividad  POST/PUT/PATCH/DELETE < 400 con usuario → registro_actividad
  ├─ onResponse multipart           borra los temporales de la subida
  └─ onError    Sentry              (solo con SENTRY_DSN) errores lanzados con estado ≥ 500
```

- **`/assets/*`** lo sirve `@fastify/static` desde `dist/assets` (`src/assets`
  en desarrollo). Es una ruta del contexto raíz: pasa por los hooks globales
  pero no por ninguna guarda, así que todo lo que hay en `src/assets/` es
  público.
- **CORS.** Orígenes permitidos = una lista fija en `app.ts`
  (`http://localhost:5173` y `http://127.0.0.1:5173`, los mismos con el 5174 y
  el 3000, `https://www.cotransmeq.com`, `https://cotransmeq.com` —la landing
  que sirve los formularios SARLAFT públicos— y
  `https://transmeralda-app.vercel.app`, heredado del gemelo) más los de
  `FRONTEND_URL`, separados por coma, con `credentials: true`. Una petición sin
  `Origin` (curl, apps móviles) pasa. El frontend local corre en el 5173, o en
  el 5174 si el 5173 está ocupado: los dos están en la lista fija, con
  `localhost` y con `127.0.0.1` (SvelteKit resuelve el host tal como se
  escribió). Un origen rechazado no sale como 403: el callback devuelve un
  `Error` sin código y Fastify responde 500, que el navegador enseña como «no
  se pudo conectar». Socket.IO tiene su propia lista (`SOCKET_CORS_ORIGINS`).
- **Multipart** no adjunta los campos al cuerpo: cada handler lee el archivo
  (`request.file()` / `request.parts()`). El límite de 200 MB por archivo es por
  los ZIP de certificados tributarios; cada módulo aplica después su propio
  tope.
- **Sin credenciales**
  ([sin-credenciales.ts](../src/lib/sin-credenciales.ts)): el
  `preSerialization` global borra cualquier campo `password`, a cualquier
  profundidad, de las respuestas que serializa Fastify (no de un string, un
  `Buffer`, un stream ni lo escrito en `reply.raw`). Es la red de seguridad de
  los `include` que traen filas enteras de conductores o usuarios; va con
  callback y no `async` para no diferir la serialización. Los emisores de
  socket de servicios y recargos pasan sus payloads por la misma función.
- **Registro de actividad**
  ([registro-actividad.service.ts](../src/modules/actividad/registro-actividad.service.ts)):
  escribe sin `await`, así que un fallo solo deja un aviso en el log. Excluye
  autenticación, rutas públicas, portal, MCP, asistente, crons y autoguardados
  (`EXCLUIR_PREFIJOS` y `EXCLUIR_FRAGMENTOS`).
- **Respuestas en streaming.** El chat del asistente y el servidor MCP hacen
  `reply.hijack()` y escriben sobre `reply.raw`; tras el hijack Fastify ya no
  escribe las cabeceras acumuladas, y hay que copiar `reply.getHeaders()` a
  mano o se pierden las de CORS (curl no lo nota; el navegador sí).

El detalle de cada guarda, lo que dejan en `request` y los formatos de error
está en [middlewares.md](./middlewares.md).

## Logs

[logger.ts](../src/utils/logger.ts) crea un único logger de Pino, y Fastify lo
usa como suyo (`fastify({ logger })`), así que `request.log` y `logger`
escriben en el mismo sitio:

| Entorno | Formato | Nivel por defecto |
|---|---|---|
| `NODE_ENV=production` | JSON de una línea (lo indexa el recolector de Docker) | `info` |
| Cualquier otro | `pino-pretty` coloreado, hora `HH:MM:ss` | `debug` |

`LOG_LEVEL` manda en los dos (p. ej. `LOG_LEVEL=debug` para diagnosticar en
producción sin desplegar). Prisma vuelca sus eventos `info` y `error` al logger,
y fuera de producción también **cada consulta** a nivel `debug`: si el log de
desarrollo es ilegible, `LOG_LEVEL=info`.

Ojo: mucho código todavía escribe con `console.log`/`console.warn` (sockets,
colas, correo, crons de snapshots). Eso no pasa por Pino: no sale en JSON ni
respeta `LOG_LEVEL`. Al buscar algo en los logs de producción, busca también
los prefijos de texto (`[sockets]`, `[borrador-queue]`, `[EmailService]`…).

## Sentry (opcional)

[sentry.ts](../src/lib/sentry.ts) solo se activa con `SENTRY_DSN`; sin ella ni
siquiera carga el SDK. Opcionales: `SENTRY_ENVIRONMENT` (por defecto
`NODE_ENV`), `SENTRY_RELEASE` y `SENTRY_TRACES_SAMPLE_RATE` (sin ella no hay
trazas ni se carga su instrumentación). Captura:

- excepciones y promesas rechazadas sin atrapar (integraciones por defecto);
- errores que llegan a Fastify con estado ≥ 500 (`onError`);
- respuestas 5xx que el controlador armó a mano (`onSend`), agrupadas por
  método, ruta y mensaje. Hace falta porque casi todos los controladores
  atrapan su error y responden `reply.status(500).send({ error })`, y sin esto
  Sentry no vería la mayoría de los fallos.

No envía cuerpos, cabeceras, cookies ni query (llevan el JWT, cédulas y
salarios) y recorta los mensajes a su primera línea, porque los errores de
Prisma vuelcan debajo la consulta con sus datos. El usuario se adjunta solo con
su id. Existe `capturarError()` para errores atrapados a mano en crons y colas,
pero hoy **nadie la llama**: lo que esos procesos atrapan y loguean no llega a
Sentry.

## Errores

**No hay manejador de errores registrado.**
[error.middleware.ts](../src/middlewares/error.middleware.ts) exporta un
`errorHandler`, pero ningún archivo llama a `setErrorHandler`. Un error lanzado
y no atrapado llega al manejador por defecto de Fastify, que responde
`{ statusCode, error, message }` con el `statusCode` del error o 500. En la
práctica la mayoría de los controladores atrapan y responden ellos mismos, y el
formato varía por módulo; los formatos que conviven están en
[middlewares.md](./middlewares.md#formato-de-los-errores).

**Errores de dominio con código, no strings sueltos.** El patrón de referencia
es `FormError`
([domain/errors.ts](../src/modules/formularios-dinamicos/domain/errors.ts)):
una lista cerrada de códigos y un único mapa código → estado HTTP. El servicio
lanza `new FormError('SUBMISSION_LIMIT_REACHED', '…')` sin saber nada de HTTP, y
el controlador lo traduce en un solo punto (`fail()`) a
`{ success: false, error: { code, message, details? } }`. El código es lo que
consume el cliente: la outbox del portal decide si reintenta, descarta o pide
corrección mirando el `code`, nunca el texto. Los módulos más nuevos siguen la
misma idea con su clase (`MantenimientoError(status, code, mensaje)`,
`ViaticosError`, `IncidenteError`, `PatchNominaError`…).

Para código nuevo: lanza un error de dominio con código desde el servicio,
tradúcelo en una sola función del controlador o de las rutas, y responde un
500 genérico para lo inesperado (logueando el detalle). El mensaje de una
excepción de Prisma no sale al cliente: trae nombres de columna y fragmentos de
la consulta.

## Documentación de la API: no hay `/docs`

`app.ts` registra `@fastify/swagger` con opciones de una versión anterior
(`routePrefix: '/docs'`, `exposeRoute: true`). Desde la v8 esas opciones se
movieron a `@fastify/swagger-ui`, que **no está instalado**: el plugin solo
recolecta los esquemas de las rutas en un decorador `app.swagger()` que nadie
usa, y **no se sirve ninguna ruta `/docs`** (responde 404). El log de arranque
de `server.ts` («Docs available at …/docs») y algunos documentos viejos de la
raíz (`TESTS_ACCIONES_CORRECTIVAS.md`) dicen lo contrario.

La referencia vigente es [docs/api/](./api/README.md), un documento por carpeta
de `src/modules/`. [scripts/docs/inventario-rutas.ts](../scripts/docs/inventario-rutas.ts)
arranca la app en memoria (`buildApp()` + `ready()`, sin puerto, crons ni
sockets) y saca todas las rutas con su archivo: `npm run docs:inventario`
regenera el inventario y `npm run docs:verificar` falla si una ruta no está
documentada.

## Convenciones

- **Comentarios que explican el porqué, en español.** `/** */` para la interfaz
  de una función y `///` para la nota pegada a la línea que la necesita. Lo
  valioso es el motivo y lo que se rompió antes.
- **Borrado lógico.** Nada que sea un dato del usuario se borra en duro: se
  marca `deleted_at` y **toda** lectura filtra (consultas, `include`,
  `_count` y filtros por relación). Las reglas y excepciones están en
  [AGENTS.md](../AGENTS.md) y el caso de las liquidaciones en
  [borrado-logico-liquidaciones.md](./borrado-logico-liquidaciones.md).
- **Eventos de socket después del commit,** nunca dentro de un
  `$transaction`, y un emisor nunca lanza ([tiempo-real.md](./tiempo-real.md)).
- **Una sola instancia.** Las colas, los límites de intentos, la presencia de
  los canvas, los *epochs* de reversión y la recuperación de estado de
  Socket.IO viven en la memoria del proceso. Funciona porque producción corre
  un solo contenedor; con dos réplicas habría que moverlos a Redis o a la base.
- **Migraciones a mano.** El historial de migraciones diverge de la base y
  `prisma migrate deploy` es destructivo aquí; el procedimiento está en
  [AGENTS.md](../AGENTS.md).
- **Aplicar en ambos repos.** Todo arreglo o funcionalidad va también a
  `backend-nest` (Transmeralda), con el mismo parche y verificado con `diff`;
  incluye migraciones, datos y la infraestructura (CORS del bucket, variables
  de entorno), que se configura dos veces.

## Diferencias con Transmeralda

`backend-nest` tiene la misma estructura de `src/` y el mismo `server.ts` (solo
cambia el nombre en el log de arranque), `app.ts`, `apagado.ts`, `sentry.ts`,
`logger.ts` y `prisma.ts`, salvo lo siguiente:

- **CORS:** su lista fija no tiene las variantes `127.0.0.1:5173` y
  `127.0.0.1:3000` ni los dominios de `cotransmeq.com`. Su frontend local corre
  en el 5273 y tiene que venir en `FRONTEND_URL`.
- **Archivos propios:** Transmeralda no tiene `prismaTransmeralda.ts` ni
  `lib/branding.ts`; tiene a cambio el historial y el reporte en PDF de
  recargos.
- **Dependencias:** no declara `node-cron`, `axios` ni `polyline`, y su Prisma
  va con rango (`^5.22.0`).
- **Imagen de Docker:** arranca con `docker-entrypoint.sh` (que hace `exec` del
  comando y puede aplicar migraciones con `PRISMA_MIGRATE_ON_START=true`), copia
  `scripts/` y `extractos.txt`, y apunta Chromium con
  `CHROME_PATH=/usr/bin/chromium`.
- **Puerto local:** 4100.
