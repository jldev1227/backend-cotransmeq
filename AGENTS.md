# backend-cotransmeq

API de Cotransmeq. **Es Fastify, no NestJS** — pese al gemelo llamado
`backend-nest`, la única dependencia de Nest es `@nestjs/schedule`. Prisma sobre
PostgreSQL.

## Este proyecto tiene un gemelo

El mismo producto corre para dos empresas, en cuatro repos:

| | Transmeralda | Cotransmeq |
|---|---|---|
| Backend | `backend-nest` | `backend-cotransmeq` |
| Frontend | `ingreso-svelte` | `cotransmeq-app` |

**Todo arreglo o funcionalidad se aplica en los dos.** No es opcional ni hay que
preguntarlo: un fix que solo aterriza en uno reaparece como incidencia en el otro
días después, cuando ya se dio por resuelto.

Esto **incluye lo que no es código**: migraciones y `UPDATE` de datos van contra
las dos bases, y los cambios de infraestructura (CORS de bucket, variables de
entorno) se aplican dos veces. Cada despliegue tiene su propio bucket S3, su
propia base y su propio origen; un fallo que solo aparece en uno casi siempre es
config divergente, no código.

Los archivos del módulo de formularios son idénticos entre repos. Al replicar,
**aplica el mismo parche** en vez de copiar el archivo entero, y verifica con
`diff` al terminar.

## Convenciones

**Comentarios que explican el porqué, en español.** El repo documenta decisiones,
no mecánica. `/** */` para la interfaz de una función; `///` para una nota pegada a
la línea que la necesita. Lo valioso es el motivo y lo que se rompió antes:

```ts
/// `ChecksumMode: 'ENABLED'` es obligatorio: sin él S3 NO devuelve
/// `ChecksumSHA256` aunque el objeto se haya subido con checksum, y la
/// verificación fallaría siempre por «no hay checksum».
```

**Errores de dominio con código, no strings sueltos.** `FormError` con un código de
`domain/errors.ts`, que mapea a HTTP en un solo sitio. El código viaja al cliente y
la outbox del portal decide con él si reintenta.

## Ejecutar las apps web

Cuando el usuario pida "ejecuta las apps web" o una instrucción equivalente,
inicia y deja corriendo los cuatro procesos con npm run dev:

- Transmeralda: ingreso-svelte (http://localhost:5273) y backend-nest
  (http://localhost:4100).
- Cotransmeq: cotransmeq-app (http://localhost:5173) y backend-cotransmeq
  (http://localhost:4000).

Si alguno ya está corriendo, verifica que corresponda al repositorio y
reutilízalo. Comprueba que los dos frontends respondan por HTTP y que los dos
backends hayan iniciado y conectado con sus bases de datos antes de dar la
tarea por terminada.

## Comandos

```bash
npm run dev              # tsx watch src/server.ts, en :4000
npx tsc --noEmit         # ← antes de dar nada por hecho
npm run prisma:generate
npm run prisma:deploy
```

`tsc --noEmit` está en **cero errores** (11-oct-2026) y tiene que seguir así:
`npm run build` ya no lleva `|| true`, el `Dockerfile` corre ese build, y el job
`verificar` del workflow (`npm run typecheck` + tests puros) va antes del
despliegue. Un error de tipos ya no llega a producción: frena el deploy.

## Documentación

La documentación técnica vive en `docs/` (índice en `docs/README.md`):
arquitectura, autenticación, middlewares, permisos, tiempo real, crons,
integraciones, base de datos, variables, pruebas, despliegue y la referencia de
la API, con un documento por módulo en `docs/api/<modulo>.md`.

**Un cambio de comportamiento lleva su cambio de documento en el mismo commit**,
y en los dos repos. Si tocas rutas, `npm run docs:verificar` falla cuando una
ruta del código no está en el doc de su módulo o un doc nombra una ruta que ya
no existe; `npm run docs:inventario` regenera `docs/api/inventario.md`.

## Operación

**CI antes de desplegar** (`.github/workflows/deploy.yml`). `verificar` corre en
`ubuntu-latest` —no en el runner del servidor, para no quitarle RAM a
producción—: `npm ci`, `prisma generate`, `npm run typecheck` y las suites puras
(`vitest.nomina`, `vitest.formularios`, `vitest.declaracion`). `deploy` lleva
`needs: verificar`. `suite-con-base` corre la suite completa contra un Postgres
del propio runner (`TEST_DB_SIN_DOCKER=1 npm run test:setup`), pero es
**informativa** (`continue-on-error`) mientras arrastre fallos viejos; cuando
esté en verde, va a `needs`.

**Apagado ordenado** (`src/lib/apagado.ts`). Docker manda SIGTERM en cada
despliegue; el proceso deja de aceptar peticiones, cierra sockets, espera a que
termine la ejecución en curso de cada cron y cierra Prisma, con un tope de 25 s
(`LIMITE_APAGADO_MS`) por debajo del `stop_grace_period: 30s` del compose. **Todo
cron nuevo se arranca dentro de `registrarCron('nombre', startXCron())`** en
`server.ts`; uno suelto sigue funcionando, pero el apagado no lo espera.

**Logs** (`src/utils/logger.ts`). Con `NODE_ENV=production`, JSON de una línea a
nivel `info`; en desarrollo, `pino-pretty` a nivel `debug`. `LOG_LEVEL` manda en
los dos.

**Rastreo de errores (Sentry), opcional.** Solo con `SENTRY_DSN`; sin él no se
carga ni el SDK (`src/lib/sentry.ts`). Opcionales: `SENTRY_ENVIRONMENT` (por
defecto `NODE_ENV`), `SENTRY_RELEASE`, `SENTRY_TRACES_SAMPLE_RATE` (sin ella no
hay trazas). Captura excepciones sin atrapar, errores que llegan a Fastify y las
respuestas 5xx que arman los controladores a mano. No envía cuerpos, cabeceras,
cookies ni query (llevan el JWT y datos personales), y recorta los mensajes a
su primera línea (los de Prisma vuelcan los argumentos debajo).

## Formularios dinámicos

El módulo del que depende que un conductor no pierda una inspección.

**Un borrador y un envío guardan las respuestas en columnas distintas y
disjuntas.** `escribirRespuestasCrudas` mete el valor envuelto en `value_json`
(`{draftValue}` / `{draftOptionValues}`) sin tipar ni validar, a propósito: un
número a medio teclear (`"12,"`) no es un decimal válido y rechazarlo perdería lo
que el conductor llevaba escrito. Un envío entregado usa las columnas tipadas y
`form_answer_options`. Cualquier consulta SQL o informe que lea respuestas **tiene
que cubrir las dos formas**, o los borradores saldrán vacíos aunque tengan cientos
de respuestas. Por la API ya no hace falta: `toAnswerDto()` deshace la envoltura.

**Las políticas de límite se cuentan sobre `SUBMITTED`.** Cuidado con
`verificarLimite()`: si `periodKey` es nulo —que es lo que da la frecuencia
`ON_DEMAND`— no filtra por fecha, así que `ONE_PER_CONTEXT` significa «uno por
vehículo **para siempre**», no por día. Hoy todas las asignaciones están en
`UNLIMITED` para esquivarlo.

**Las subidas de evidencia no pasan por la API.** El teléfono hace `PUT` directo a
una URL prefirmada de S3. Al firmarla, el checksum se iza al query string y **no**
debe reenviarse como cabecera: SigV4 exige que toda cabecera `x-amz-*` esté
firmada, y una que no lo esté hace que S3 rechace la petición entera. Si una
subida falla, comprueba el **CORS del bucket** antes que la firma: un preflight
rechazado hace que `fetch` lance sin llegar a AWS, y en DevTools se ve igual que
un problema de firma.

**Un `SignatureDoesNotMatch` de S3 trae el `CanonicalRequest` completo en el XML.**
Recalcula la firma en local con el secreto del `.env`: si coincide con
`SignatureProvided`, el canonical está bien y el problema es que el secreto no
corresponde a esa access key (confírmalo con `aws sts get-caller-identity`).

## Sockets

**Cada dominio declara sus eventos en una tabla `EVENTOS_*`** dentro de su
`*.events.ts`, y `tests/contrato-eventos.test.ts` cruza lo que el backend emite
contra lo que el frontend escucha. Falla si un listener espera algo que nadie
emite, si un nombre se sale de convención, o si algún evento se construye
interpolando —esos no son greppables y se pierden—.

No hay registro espejo en el frontend: duplicar la lista en dos sitios es
justamente el problema del que se venía. El cruce se hace contra el código real.

Existe porque el módulo de Servicios pasó **meses sin emitir nada** mientras el
store del frontend tenía seis listeners con su lógica de patch escrita. Un test
del emisor habría seguido en verde: hace falta uno que levante servidor y cliente
y compruebe que un `POST` produce el evento (`sockets-dominio-integracion.test.ts`).

**Los nombres no se renombran a la ligera.** Los que hay los dictó el frontend que
ya escuchaba; unificarlos por estética deja las páginas mudas otra vez.

**Identidad siempre del token, nunca del payload.** `resolveActor` con
`SOCKET_AUTH_MODE=enforce`. `join-dashboard` aceptaba el `userId` que le mandaran
y filtraba la sala de otro. Queda pendiente el permiso **por recurso** en
`join-evaluacion`, `sheet:join`, `join-room` y `chat:join`: hoy exigen identidad
autenticada, pero no comprueban si ese usuario puede ver ESA evaluación.

Y no vuelques los headers del handshake en el log: llevan el `Authorization`.

## Borrado lógico

**Nada que sea un dato del usuario se borra en duro.** Se marca `deleted_at` y se
filtra al leer. Vino de una liquidación que se restauró poniendo `deleted_at =
NULL` y volvió **vacía**: sus ítems no tenían la columna y la cascada ya se los
había llevado.

### El coste real no es la columna, son las lecturas

Añadir `deleted_at` es una línea. Lo caro —y donde están los errores— es que
**toda** consulta de esa tabla filtre. Si marcas sin filtrar, la fila retirada y
la nueva conviven y se cuentan **las dos**: en tablas con dinero eso no es un
fallo visual, es pagar de más.

Las cuatro formas que hay que revisar, no solo la obvia:

```ts
prisma.hija.findMany({ where: { …, deleted_at: null } })   // consulta directa
include: { hija: { where: { deleted_at: null } } }          // include a-muchos
_count: { select: { hija: { where: { deleted_at: null } } } } // ¡también el conteo!
where: { madre: { some: { …, deleted_at: null } } }         // filtro por relación
```

Un `include` a-**uno** (`select: { madre: { select: {…} } }`) no admite `where` ni
puede duplicar: resuelve una fila por FK. Déjalo.

**Antes de convertir `hija: true` a `hija: { where: … }`, mira el contexto.**
`PERMISOS_ADMIN` en `usuarios.service.ts` es un `Record<string, boolean>` con
claves que se llaman igual que modelos (`recargos: true`). Convertirlo corrompe
los permisos de administrador.

### Índices únicos parciales

Si la tabla tiene `@@unique`, marcar en vez de borrar **rompe el guardado
siguiente**: la fila archivada sigue ocupando la clave. Hay que sustituirla por
un índice parcial:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS tabla_activo_uniq
  ON tabla (a, b) WHERE deleted_at IS NULL;
```

Prisma no sabe expresar índices parciales: **se deja el `@@unique` declarado en el
schema** y la migración lo sustituye. La forma de comprobar que hacía falta es
correr el test antes de aplicar la migración: sale `Unique constraint failed`.

La excepción es cuando la unicidad global es justo lo que quieres. En
`registro_dia_laboral` se dejó `(conductor_id, fecha)` global a propósito: así la
fila marcada conserva su día y el `upsert` del guardado la **revive** cuando el
conductor vuelve a registrarlo. Con un índice parcial se acumularían duplicados.

### Qué NO recibe `deleted_at`

| | Por qué |
|---|---|
| Tokens y sesiones | Revocar **es** borrar; guardar un token marcado es un riesgo, no una recuperación |
| `historial_*`, `*_snapshot`, firmas | Son la evidencia. No se tocan **ni al retirar la madre** |
| Borradores (`*_draft`) | Su valor caduca. El usuario descarta el suyo a propósito |
| Catálogos (`municipios`, `tipo_*`) | Ya tienen `activo`/`oculto`; un segundo eje duplica estados |
| Uniones N-M | Se reemplazan enteras y no recuperan nada útil |

Y hay borrados físicos **legítimos**, que no se convierten: `eliminarPermanente()`
con endpoint propio, y los *rollback* que deshacen algo creado en esa misma
llamada (`formularios-sarlaft` borra el radicado si falla su PDF).

### Helpers

`src/lib/soft-delete/` — `SOLO_ACTIVOS`, los árboles de liquidación y de día
laboral, y `reconciliarItems`. Viven ahí y no en el servicio **porque los
servicios arrastran sockets y la cola de nómina al importarse**, y un test del
marcado no debería necesitar Redis levantado.

**Nunca `deleteMany` + `createMany` al guardar.** Usa `reconciliarItems`, que
correlaciona por `id` y luego por `client_key`, **nunca por posición**: `orden`
cambia en cuanto alguien arrastra una fila.

Sin middleware de Prisma: los filtros son explícitos. Un middleware global
escondería también lo que la auditoría necesita ver.

### Aplicar una migración

El historial de migraciones **diverge de la base**, así que `prisma migrate
deploy` es destructivo aquí. El procedimiento es:

```bash
psql "$URL" -v ON_ERROR_STOP=1 --single-transaction -f prisma/migrations/<n>/migration.sql
# y después registrarla a mano en _prisma_migrations
```

Comprueba el recuento de filas **antes y después**: estas migraciones son
aditivas y no deben tocar ninguna. Y ojo con el `@@map`: el modelo `servicio` es
la tabla `servicios`. Si el SQL falla, **revierte el registro** en
`_prisma_migrations` antes de reintentar, o queda anotada una migración que no se
aplicó.

## Documentos PDF

Los PDF de liquidaciones los renderiza Puppeteer desde un template
(`liquidaciones-terceros-pdf/`). Los tokens visuales viven en `pdf-tokens.ts` y son
**espejo exacto** del fichero homónimo del frontend; `pdf-tokens.spec.ts` lee el
del frontend y falla si divergen. Es la única forma de enterarse: una divergencia
no rompe nada, simplemente el preview se ve de un color y el PDF de otro, y nadie
lo nota hasta que el cliente compara.

Los documentos de **formularios dinámicos** no siguen este camino: se imprimen
desde el cliente. Reimplementar aquí los diecinueve tipos de campo daría un segundo
renderizador que divergiría del primero.

## Logotipos

`src/assets/` guarda arte de las dos empresas y los nombres engañan:
`logo.png` y `transmeralda-logo.png` son de **Transmeralda**. Los buenos son
`cotransmeq-logo.png` (para pdfkit y ExcelJS, que no leen webp) y
`logo_cotransmeq-264.webp` (para las plantillas que renderiza Chromium).

No los resuelvas a mano: `src/lib/branding.ts` expone
`resolverLogoCotransmeq()` —que además cubre las dos rutas posibles del build—
y `LOGO_EMAIL_URL_POR_DEFECTO` para las plantillas de correo, donde manda
`EMAIL_LOGO_URL`. Devuelve `null` antes que caer a la marca ajena: un documento
de Cotransmeq firmado por Transmeralda es peor que uno sin logotipo.
