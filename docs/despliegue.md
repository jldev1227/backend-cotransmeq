# Despliegue

Cómo llega el backend a producción (`https://api-cotransmeq.transmeralda.com`):
la imagen Docker, el compose, el workflow de GitHub Actions que construye y
reemplaza el contenedor en el servidor Proxmox, cómo se aplican las migraciones
en producción, qué variables tienen que estar puestas y qué comprobar después.
Léelo antes de desplegar algo que cambie el esquema o las variables, o antes de
tocar el `Dockerfile`, el compose o el workflow.

## El camino completo

1. **Push a `main`** (o lanzamiento manual, `workflow_dispatch`).
2. **`verificar`**, en un runner de GitHub (`ubuntu-latest`): `npm ci`,
   `prisma generate`, `npm run typecheck` y las tres suites puras. Si falla,
   nada más arranca y el contenedor vivo no se toca.
3. **`deploy`** (`needs: verificar`), en el runner *self-hosted* del contenedor
   LXC de producción: escribe `.azure-openai.env` y ejecuta
   `sudo /usr/local/sbin/deploy-backend-cotransmeq <sha>`.
4. **El script del servidor** construye la imagen allí mismo, recrea el
   contenedor, espera a que esté sano y, si no lo está, vuelve a la imagen
   anterior.

La base de datos no forma parte de este camino: las migraciones se aplican a
mano y antes (ver [Migraciones en producción](#migraciones-en-producción)).

## La imagen (`Dockerfile`)

Dos etapas sobre `node:20-alpine` ([`Dockerfile`](../Dockerfile)).

**`builder`**

- `openssl` y `libc6-compat`, que necesita Prisma en Alpine.
- `npm ci` **sin** `|| npm install`: si el lockfile no cuadra con
  `package.json`, el build falla en vez de resolver en silencio versiones
  distintas de las probadas.
- `npx prisma generate`, `COPY . .` y `npm run build`
  (`tsc && cp -r src/assets dist/assets`). Cualquier error de tipos aborta el
  build antes de tocar el contenedor vivo; el build ya no lleva `|| true`.

**`runner`**

- Paquetes: `openssl`, `libc6-compat`, `chromium` con `nss`, `freetype`,
  `harfbuzz`, `ca-certificates` y `ttf-freefont` (Puppeteer renderiza con
  Chromium los PDF que salen de plantillas HTML), `dumb-init` (instalado, pero
  ni el `CMD` ni un `ENTRYPOINT` lo usan) y `ghostscript`, que comprime los PDF
  que se suben a las hojas de vida de los conductores
  ([`compresion.ts`](../src/modules/conductores-documentos/compresion.ts)). Sin
  `ghostscript` no falla nada: los PDF se guardan sin comprimir y nadie se
  entera. Crea `/app/.cache/puppeteer`.
- `NODE_ENV=production`, `PUPPETEER_SKIP_DOWNLOAD=true` y
  `PUPPETEER_EXECUTABLE_PATH`, `CHROME_BIN` y `CHROMIUM_PATH` en
  `/usr/bin/chromium-browser` (ver la resolución de Chromium en
  [variables-de-entorno.md](./variables-de-entorno.md#pdf-con-chromium)).
- Copia del builder `package.json`, el lockfile, `prisma/`,
  `node_modules/.prisma`, `node_modules/@prisma` y `dist/` (que ya incluye
  `dist/assets`).
- `npm ci --only=production || npm install --production`.
- `EXPOSE 4000` y `CMD ["node", "dist/server.js"]`, sin entrypoint.

Detalles que conviene saber:

- **Las copias del cliente de Prisma no sirven.** `npm ci` borra `node_modules`
  antes de instalar, así que `node_modules/.prisma` y `@prisma` copiados del
  builder desaparecen; el cliente que queda es el que regenera el `postinstall`
  de `@prisma/client` (posible porque `prisma` está en `dependencies`). El
  gemelo lo hace explícito con `npm ci --omit=dev && npx prisma generate`.
- **El `|| npm install --production`** es el respaldo silencioso que el
  comentario de la etapa `builder` dice haber quitado: si `npm ci` falla en la
  etapa final, se instalan versiones resueltas en el momento.
- `.dockerignore` excluye `.env` y `.env.*`, salvo `.env.production`, que está
  versionado; y no excluye `.azure-openai.env`, que el workflow escribe en el
  checkout antes del build. Los dos entran en el contexto y en la capa
  `COPY . .` de la etapa `builder` (no en la imagen final). Ningún código lee
  `.env.production`.
- Sin entrypoint, `node` es el PID 1 y recibe el SIGTERM, que atiende
  [`src/lib/apagado.ts`](../src/lib/apagado.ts).

## El compose (`docker-compose.yml`)

[`docker-compose.yml`](../docker-compose.yml), servicio `backend`:

| Clave | Valor | Por qué |
|---|---|---|
| `image`, `container_name` | `backend-cotransmeq:production`, `backend-cotransmeq-nest` | El script de despliegue etiqueta la imagen nueva como `production` |
| `restart` | `always` | — |
| `stop_grace_period` | `30s` | El SIGTERM de cada despliegue inicia el apagado ordenado: deja de aceptar peticiones, cierra los sockets, espera a la ejecución en curso de cada cron y cierra Prisma, con un tope de 25 s (`LIMITE_APAGADO_MS`). Con los 10 s por defecto de Docker, el SIGKILL lo cortaba a mitad de una captura de snapshots |
| `ports` | `3001:4000` | El servidor escucha en el 4000 dentro del contenedor |
| `env_file` | `${BACKEND_ENV_FILE:-.env}` y `.azure-openai.env` | Variables del contenedor; ver abajo |
| `healthcheck` | `wget` a `http://127.0.0.1:4000/` cada 15 s, 5 s de espera, 30 s de arranque, 4 reintentos | Lo que espera el script de despliegue |

Sobre `env_file`: si una variable está en los dos archivos, gana el último. Las
de Azure OpenAI y `HERE_MAPS_API_KEY` que escribe el workflow pisan las del
`.env` del servidor, también cuando el secreto de GitHub está vacío (se escribe
`HERE_MAPS_API_KEY=` y queda vacía). Para levantar el compose fuera del
servidor hace falta que exista un `.azure-openai.env`, aunque sea vacío.

Como el healthcheck pregunta al 4000, el `.env` de producción no puede fijar
otro `PORT`.

## El workflow (`.github/workflows/deploy.yml`)

[`deploy.yml`](../.github/workflows/deploy.yml) se dispara con un push a `main` o
a mano. `concurrency: backend-cotransmeq-production` con
`cancel-in-progress: false` serializa los despliegues de este repo; entre repos
los coordina el lock del servidor.

| Job | Dónde | Qué hace |
|---|---|---|
| `verificar` | `ubuntu-latest` | Tipos y suites puras ([pruebas.md](./pruebas.md#integración-continua)). Corre fuera del servidor para no quitarle CPU ni RAM a producción |
| `suite-con-base` | `ubuntu-latest` + Postgres de servicio | Suite completa. Informativa: no frena el despliegue |
| `deploy` | `[self-hosted, linux, x64, cotransmeq-ct123, backend-cotransmeq]`, entorno `production`, 90 min de tope | Checkout exacto del commit (`clean: true`, `fetch-depth: 1`), escribe `.azure-openai.env` con `umask 077` (lo borra al salir) y llama al script del servidor |

`deploy` toma de GitHub `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_DEPLOYMENT`,
`AZURE_OPENAI_API_VERSION` y `AZURE_OPENAI_MODEL` (`vars`) y
`AZURE_OPENAI_KEY` y `HERE_MAPS_API_KEY` (`secrets`). `AZURE_OPENAI_API_VERSION`
y `AZURE_OPENAI_MODEL` no las lee ningún código.

## El script del servidor (`ops/deploy-proxmox.sh`)

El workflow llama a `/usr/local/sbin/deploy-backend-cotransmeq`, que vive en el
servidor. [`ops/deploy-proxmox.sh`](../ops/deploy-proxmox.sh) tiene los mismos
nombres y rutas y parece ser su fuente, pero desde el repo no se puede
comprobar que la copia instalada sea idéntica. Lo que hace:

1. Valida que el SHA recibido sea completo y que el checkout del runner
   (`/opt/actions-runner/backend-cotransmeq/_work/backend-cotransmeq/backend-cotransmeq`)
   esté en ese commit.
2. Exige el lock global montado en `/mnt/proxmox-deploy-lock` y espera su turno
   con `flock` hasta 60 minutos: el host Proxmox construye un despliegue a la
   vez. Según el comentario del workflow, ese lock coordina sus cuatro
   despliegues (los dos backends y los dos frontends).
3. Anota la imagen del contenedor actual, construye `backend-cotransmeq:<sha>`
   con la etiqueta `com.cotransmeq.git-sha` y la re-etiqueta como
   `backend-cotransmeq:production`.
4. `docker compose --project-name backend-cotransmeq up -d --no-deps
   --force-recreate backend`, con
   `BACKEND_ENV_FILE=/root/backend-cotransmeq/.env`.
5. Espera hasta 150 s a que Docker lo marque `healthy` y hace
   `curl http://127.0.0.1:3001/`.
6. Si algo falla, vuelve a etiquetar la imagen anterior como `production`, la
   levanta y sale con error: el job queda en rojo y producción sigue con la
   versión de antes.

## Limpieza automática de Docker (`ops/docker-limpieza-72h*`)

Cada despliegue deja en el CT una imagen `backend-cotransmeq:<sha>` de 1–2 GB y su caché de
build; nada las borraba y los discos de 59 GB llegaron al 85 %. Desde el
11-oct-2026 un timer de systemd, instalado en los dos CT (121 y 123), las limpia:

- [`ops/docker-limpieza-72h`](../ops/docker-limpieza-72h) →
  `/usr/local/sbin/docker-limpieza-72h`. Toma el **mismo** `flock` global que
  los deploys (`/mnt/proxmox-deploy-lock/production-build.lock`), así nunca
  corre durante un build ni durante un rollback, que necesita la imagen
  anterior todavía presente. Luego `docker image prune -a --filter until=72h`
  (imágenes sin contenedor creadas hace más de 72 h) y
  `docker builder prune --filter until=72h`. No toca contenedores ni volúmenes.
- [`ops/docker-limpieza-72h.service`](../ops/docker-limpieza-72h.service) y
  [`.timer`](../ops/docker-limpieza-72h.timer) →
  `/etc/systemd/system/`. Diario a las 04:00 UTC (23:00 Bogotá), después del
  backup de las 02:15 UTC; `Persistent=true` recupera la corrida si el CT
  estaba apagado.

La imagen `:production` que corre el contenedor está «en uso» y nunca se borra.
El `builder prune` por edad suelta poco: BuildKit conserva una entrada vieja
mientras sea padre de otra usada hace poco (las capas base las comparten todos
los builds). Si la caché crece, el ajuste es `--max-used-space=<tope>`, no
`--all`. Registro: `journalctl -u docker-limpieza-72h.service`.

## Railway y Azure: obsoletos

[`railway.json`](../railway.json) (builder `DOCKERFILE`, `startCommand: node
dist/server.js`) y los documentos `RAILWAY_DEPLOY.md`, `RAILWAY_AZURE_SETUP.md`,
`DEPLOY_READY.md` y `LISTO_PARA_RAILWAY.md` de la raíz describen un despliegue
en Railway, con la base en Azure, que ya no coincide con el repo:

- El workflow despliega en el servidor Proxmox; nada usa `railway.json`.
- Recomiendan `railway run npx prisma migrate deploy` o `prisma db push` contra
  la base: destructivo aquí.
- Dicen que el build tolera errores de tipos (`tsc || true`); hoy cualquier
  error frena el build y el despliegue.
- Prometen `GET /health`, que no existe: la ruta de salud es `GET /`.

`.env.production` y `.env.azure`, versionados, son de esa época y ningún código
los lee. Tómalo todo como historia.

## Migraciones en producción

El procedimiento completo está en
[base-de-datos.md](./base-de-datos.md#migraciones). Respecto al despliegue:

1. **Antes de desplegar** el código que lee columnas o tablas nuevas, aplica sus
   migraciones a las dos bases de producción. Las migraciones aditivas no
   rompen el código que está corriendo, así que pueden ir antes sin riesgo.
2. Se aplican por el **túnel SSH** a cada base (`127.0.0.1:15433` Cotransmeq,
   `127.0.0.1:15432` Transmeralda), con el paquete
   `migraciones-produccion-AAAA-MM-DD.sql` que vive en `github/transmeralda/`
   (fuera de este repo y de git): primero su paso 0 de verificación, de solo
   lectura; después el archivo entero con
   `psql "$URL_DEL_TUNEL" -v ON_ERROR_STOP=1 --single-transaction -f …`. Lo que
   solo existe aquí (los códigos SARLAFT, el enum de tipo de servicio) va
   aparte.
3. Se anotan con
   `DATABASE_URL="<url del túnel>" npx prisma migrate resolve --applied <nombre>`,
   desde este repo.
4. Si alguna sentencia necesita al dueño de la tabla (identidades, por
   ejemplo), ese archivo se corre con el usuario de migraciones, no con el de
   la aplicación.
5. Nunca con `prisma migrate deploy`.

## Variables antes de desplegar

Van en el `.env` del servidor (`/root/backend-cotransmeq/.env`), salvo las que
trae el workflow. Inventario completo en
[variables-de-entorno.md](./variables-de-entorno.md); las dos empresas necesitan
el mismo conjunto, cada una con sus valores.

| Para qué | Variables |
|---|---|
| Arrancar | `DATABASE_URL`, `JWT_SECRET` |
| Que funcione en producción | `FRONTEND_URL` (CORS), `EMAIL_FRONTEND_URL`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET_NAME`, proveedor de correo (`RESEND_API_KEY` y `RESEND_FROM`, o `SMTP_*`), `LIQ_CHAT_SECRET`, `SARLAFT_PUBLIC_API_URL`, `PLANILLA_PREFIX`, `LIQ_EMAIL_REPLY_TO`, `MINISTRAL_API_KEY` y `MINISTRAL_ENDPOINT` (sugerencias de IA de acciones correctivas y calificación de preguntas abiertas), y `CRON_SECRET` si un programador externo llama a las rutas `cron-hora` |
| Recomendadas | `FUEC_FIRMA_SECRET`, `PASSWORD_RECOVERY_SERVICE_TOKEN`, `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, `SOCKET_CORS_ORIGINS`, `SENTRY_DSN` y `SENTRY_RELEASE`, `TRANSMERALDA_DATABASE_URL` si se importan recargos del gemelo |
| Desde GitHub (`vars` y `secrets` del job `deploy`) | `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_KEY`, `AZURE_OPENAI_DEPLOYMENT`, `HERE_MAPS_API_KEY` |

`PLANILLA_PREFIX`, `AWS_S3_BUCKET_NAME` y el remitente de correo tienen valores
por defecto que apuntan a Transmeralda (prefijo `TM`, bucket `transmeralda`,
`noreply@transmeralda.com` en los envíos de liquidaciones de terceros): sin
ellas, este backend escribe con la marca o en el bucket de la otra empresa.

Y lo que **no** debe estar:

- Un `PORT` distinto de 4000.
- `SARLAFT_EMAIL_MODE=sandbox`: con `NODE_ENV=production` hace fallar los
  correos SARLAFT.
- `PERMISSIONS_MODE=warn`, salvo como salida de emergencia. Si el `.env` la
  fija, manda sobre el valor por defecto del código (`enforce`).

Antes de un despliegue que endurezca permisos o sesiones, mira el contenedor
vivo: `docker logs backend-cotransmeq-nest 2>&1 | grep -c "permisos:warn"`
cuenta a quién habría rechazado el modo estricto, y
`grep -E '^PERMISSIONS_MODE=' /root/backend-cotransmeq/.env` dice si el `.env`
lo fija. Quien tenga un token sin fila activa en `sesiones` tendrá que volver a
entrar.

## Comprobaciones después de desplegar

1. **El workflow**: `verificar` y `deploy` en verde. Si `deploy` falló, el script
   ya restauró la imagen anterior; el motivo está en su log.
2. **Salud**: `curl -fsS https://api-cotransmeq.transmeralda.com/` devuelve
   `{"status":"ok"}`. No hay `/health`. `GET /` no consulta la base, pero el
   servidor no llega a escuchar si la base no respondió al arrancar.
3. **Qué commit corre**:
   `docker image inspect backend-cotransmeq:production --format '{{ index .Config.Labels "com.cotransmeq.git-sha" }}'`.
4. **Arranque, en `docker logs backend-cotransmeq-nest`**:
   - `Database connected successfully`.
   - `Crons registrados para el apagado ordenado` con los doce de
     [`server.ts`](../src/server.ts): `acciones-correctivas`,
     `snapshot-liquidaciones-terceros`, `snapshot-liquidaciones-mensual`,
     `snapshot-adicionales-periodo`, `snapshot-recorridos`, `snapshot-nomina`,
     `cerrar-servicios-con-planilla`, `sincronizar-kilometraje`,
     `vencimientos-documentos`, `mantenimiento-planes`,
     `vencimientos-documentos-conductor` e `incidentes-investigacion`. Un cron
     que no esté en esa lista no lo espera el apagado ordenado (ver
     [tareas-programadas.md](./tareas-programadas.md#crons)).
   - `[sockets] auth instalada en modo "…"`, con el modo esperado (`enforce`
     por defecto).
   - `Server listening on …`.
   - Ningún `ZodError` (variable obligatoria que falta o valor inválido), ni el
     aviso `Ministral API no configurado` de la calificación con IA (sin esas
     variables el backend arranca, pero las sugerencias de acciones correctivas
     fallan).
5. **Permisos**: con `PERMISSIONS_MODE=warn`,
   `docker logs backend-cotransmeq-nest 2>&1 | grep "permisos:warn"` dice quién
   habría sido rechazado; con `enforce`, busca 403 inesperados en el log de
   peticiones. Ver [permisos.md](./permisos.md).
6. **Sockets**: un dashboard abierto recibe eventos (presencia, notificaciones).
   En modo `permissive`, `[sockets][auth] conexión SIN token` cuenta los
   clientes que aún no mandan token. Ver [tiempo-real.md](./tiempo-real.md).
7. **Herramientas de la imagen**, si se tocó el `Dockerfile`:
   `docker exec backend-cotransmeq-nest gs --version` (sin Ghostscript la
   compresión falla en silencio) y generar un PDF de prueba (Chromium).
8. **Migraciones**: los objetos nuevos existen (`to_regclass`,
   `information_schema.columns`) y están anotados en `_prisma_migrations`.
9. **Sentry**, si está configurado: errores nuevos tras el despliegue.
10. **El gemelo**: el mismo cambio, con sus migraciones y variables, en
    `backend-nest`.

## Diferencias con Transmeralda

- **`Dockerfile`.** El gemelo tiene `docker-entrypoint.sh` (que con
  `PRISMA_MIGRATE_ON_START=true` correría `prisma migrate deploy`: no se usa),
  copia también `scripts/` y `extractos.txt`, fija solo
  `CHROME_PATH=/usr/bin/chromium` y genera el cliente de Prisma de forma
  explícita en la etapa final (`npm ci --omit=dev && npx prisma generate`), sin
  respaldo con `npm install`.
- **Servidor.** Runner `transmeralda-ct121`, script
  `/usr/local/sbin/deploy-backend-nest`, grupo de concurrencia
  `backend-nest-production`, contenedor `backend-nest`, imagen
  `backend-nest:production`, etiqueta `com.transmeralda.git-sha` y `.env` en
  `/root/backend-nest/.env`. El puerto publicado es el mismo (`3001:4000`), en
  otro contenedor LXC.
- **API**: `https://api.transmeralda.com`.
- **Scripts**: el gemelo tiene además `start:docker`, `prisma:deploy`,
  `prisma:recover` y `prisma:baseline`, todos desaconsejados.
- **Variables**: allí los valores por defecto de prefijo de planilla, bucket,
  remitente y `LIQ_EMAIL_REPLY_TO` ya son los de su empresa.
