# Pruebas

Cómo se prueba el backend: las cinco configuraciones de Vitest y cuáles no
tocan ninguna base, la base desechable en Docker, las guardas que impiden borrar
datos reales, los helpers de `tests/helpers/` y lo que corre en CI. Léelo
**antes de ejecutar cualquier comando de pruebas**, sobre todo si vas a usar
`npm test`.

> **ADVERTENCIA: la suite borra tablas enteras.**
>
> Varios tests limpian con `deleteMany()` sin filtro, que en SQL es
> `DELETE … WHERE 1=1`. En agosto de 2026 la suite del gemelo (Transmeralda)
> corrió contra la base real más de una vez: se perdieron 87 formularios de
> asistencia con sus respuestas y, el 28 de agosto, `tests/setup.ts` borró 2042
> respuestas de asistencia en producción. No fue `prisma migrate`: fue
> `npm test` con `DATABASE_URL` apuntando a la base real. Esta suite tiene los
> mismos `deleteMany()`.
>
> Hoy hay guardas (abajo), pero solo cubren lo que pasa por Vitest y solo miran
> `DATABASE_URL`. **Corre la suite completa únicamente contra la base de Docker
> de `npm run test:setup`.** Si dudas, usa las suites puras, que no abren
> ninguna conexión.

## Cómo correr las pruebas sin riesgo

```bash
# Sin base de datos (lo mismo que exige el CI antes de desplegar)
npm run test:nomina
npm run test:formularios
npm run test:declaracion-transporte

# Suite completa, contra la base desechable
npm run test:setup           # Docker: levanta cotransmeq_test en el 55433 y aplica el esquema
npx vitest run               # una pasada; `npm test` a secas queda en modo watch
npx vitest run tests/soft-delete-servicios.test.ts   # un archivo
npm run test:down            # al terminar
```

`npm run test:setup` necesita Docker Desktop abierto; si no, se detiene con un
aviso. Es idempotente: con el contenedor ya arriba solo resincroniza el
esquema.

## Configuraciones de Vitest

| Config | Script | Qué corre | ¿Abre base? |
|---|---|---|---|
| [`vitest.config.ts`](../vitest.config.ts) | `npm test`, `npm run test:ui`, `npm run test:coverage` | Todo `*.test.ts` y `*.spec.ts` de `tests/` y `src/`, menos `dist/`, `node_modules/` y `*.push.spec.ts`. Carga `tests/setup.ts` y ejecuta los archivos de uno en uno (`fileParallelism: false`) | Sí: la de `.env.test`, con la guarda |
| [`vitest.nomina.config.ts`](../vitest.nomina.config.ts) | `npm run test:nomina` | `src/lib/nomina/**/*.spec.ts` (estado, liquidar, periodo, vigencias) | No: funciones puras |
| [`vitest.formularios.config.ts`](../vitest.formularios.config.ts) | `npm run test:formularios` | `tests/formularios-dinamicos-*.test.ts` | No: Prisma, S3 y el entorno van mockeados |
| [`vitest.declaracion.config.ts`](../vitest.declaracion.config.ts) | `npm run test:declaracion-transporte` | `tests/declaracion-transporte/**/*.test.ts` | No: Prisma, S3 y el correo van mockeados |
| [`vitest.web-push.config.mts`](../vitest.web-push.config.mts) | `npm run test:web-push` | `src/**/*.push.spec.ts`, prueba manual de Web Push | **Sí, la del `.env`**: ver abajo |

Las tres puras no cargan `tests/setup.ts` (que abre una conexión con un
`SELECT 1` nada más importarse), pero sí inyectan `.env.test` antes de que los
workers importen nada.

`vitest.web-push.config.mts` es la excepción deliberada: usa la base del `.env`
porque las suscripciones de tu navegador viven ahí, y no carga ni `.env.test` ni
`tests/setup.ts`. Solo lee; lo único que puede escribir es marcar como inactiva
una suscripción que el navegador ya revocó. Se usa así:
`WEB_PUSH_CORREO=tu@correo npm run test:web-push` (`WEB_PUSH_CANTIDAD` limita
cuántas notificaciones reenvía, 10 por defecto).

`npm run test:coverage` usa el proveedor `v8`, pero `@vitest/coverage-v8` no
está en `devDependencies`: Vitest pedirá instalarlo.

## Qué protege hoy contra borrar datos reales

1. **`.env.test` manda.** [`tests/env-test.ts`](../tests/env-test.ts) lo carga
   con `override: true` y las configs lo pasan a `test.env`, que Vitest inyecta
   en cada worker **antes** de importar nada: es la única forma de ganarle al
   `dotenv.config()` de `src/config/env.ts`. Si `.env.test` no existe, la suite
   no arranca. El archivo está versionado; según `docker-compose.test.yml` y el
   workflow, apunta a `cotransmeq_test` en el 55433.
2. **La guarda de la base.** [`tests/guard-db.ts`](../tests/guard-db.ts) aborta
   si el nombre de la base de `DATABASE_URL` no contiene `test` ni `_local`
   (sin distinguir mayúsculas), salvo `ALLOW_DESTRUCTIVE_TESTS=true`.
   [`tests/setup.ts`](../tests/setup.ts) la llama al importarse —antes de abrir
   la conexión— y otra vez antes de limpiar; como es el `setupFiles` de la
   config general, corre antes de cada archivo. A diferencia del gemelo, los
   tres tests de asistencias no la vuelven a llamar antes de sus propios
   `deleteMany()`: dependen solo de la de `tests/setup.ts`.
3. **Disparadores en la base.** Donde está aplicada
   `20260830120000_auditoria_asistencias`, un `DELETE` sin filtro sobre las
   asistencias se bloquea y queda auditado (ver
   [base-de-datos.md](./base-de-datos.md#borrado-lógico)).
4. **Archivos en serie.** `fileParallelism: false`: varios archivos hacen
   `deleteMany()` en su `beforeAll` y en paralelo se borraban los datos entre
   ellos (el número de fallos cambiaba en cada ejecución).

Lo que **no** cubren:

- **La guarda solo mira el nombre de la base**, no el host. Una base que se
  llame `*_test` o `*_local` en cualquier servidor cuenta como desechable. Las
  bases locales de trabajo (`*_kody_20261006`) no encajan y quedan protegidas.
- **`.env.test` solo pisa lo que define**: `DATABASE_URL`, `JWT_SECRET`,
  `NODE_ENV`, `PORT`, las de sockets, SMTP, AWS, `FRONTEND_URL`, las de SARLAFT y
  `SENTRY_DSN`. Todo lo demás llega de tu `.env`, porque `src/config/env.ts`
  rellena con `dotenv` lo que falte. Si tu `.env` tiene `RESEND_API_KEY`, el
  proveedor de correo de los tests es Resend de verdad (gana a SMTP). Y
  `TRANSMERALDA_DATABASE_URL`, si está en tu `.env`, sigue apuntando a la base
  de Transmeralda durante las pruebas: la guarda no la mira.
- **Lo que no corre por Vitest** no pasa por ninguna guarda: ver
  [Scripts de prueba fuera de Vitest](#scripts-de-prueba-fuera-de-vitest).

## La base de pruebas

[`docker-compose.test.yml`](../docker-compose.test.yml) levanta
`postgres:18-alpine` (la misma major que producción) como
`cotransmeq-postgres-test`, base `cotransmeq_test`, puerto **55433** (para no
chocar con el Postgres local ni con la base de pruebas del gemelo, en el
55432), datos en `tmpfs` y `fsync` apagado: arranca rápido y al parar no queda
nada que se pueda confundir con la base de desarrollo. El nombre contiene `test`
a propósito: es lo que exige la guarda.

[`scripts/test-setup.sh`](../scripts/test-setup.sh) (`npm run test:setup`):

1. Levanta el contenedor y espera a que esté `healthy` (hasta 120 s).
2. Instala `pgcrypto`, que producción tiene.
3. Aplica el esquema con `prisma db push --skip-generate --accept-data-loss`. No
   usa `migrate deploy` a propósito: el historial no cuadra con la base (ver
   [base-de-datos.md](./base-de-datos.md#migraciones)), y en una base efímera
   solo importa que la forma coincida con `schema.prisma`.
4. Ejecuta a mano las migraciones `*_soft_delete_*` y `*_auditoria_*`, porque
   `db push` no crea los índices parciales ni el schema `auditoria`; sin ellos
   los tests de borrado lógico pasarían por motivos equivocados.

Con `TEST_DB_SIN_DOCKER=1` no toca Docker: espera con `pg_isready` a una base
que ya escuche en esa URL y le habla por `psql`. Es el modo del CI.

`npm run test:down` para y borra el contenedor.

## Sesiones en los tests

Desde octubre de 2026 el middleware de autenticación no se conforma con un JWT
válido: exige su fila **activa** en `sesiones`. Un helper que firme tokens a
mano tiene que registrar la sesión, o toda petición HTTP del test sale con 401.

| Helper | Para qué |
|---|---|
| [`sesion-prueba.ts`](../tests/helpers/sesion-prueba.ts) | `registrarSesion(usuarioId, token)`: crea la fila de `sesiones` con el hash del token, como hace `/auth/login` |
| [`usuarios-prueba.ts`](../tests/helpers/usuarios-prueba.ts) | `sembrarUsuario(etiqueta)`: crea un usuario (con `id` y fechas explícitas, porque `usuarios` no tiene valores por defecto), firma su token y registra la sesión. Todos llevan el prefijo `zztest-seguridad` en el correo y `limpiarUsuariosSembrados()` borra solo esos |
| [`canvas-servicios.ts`](../tests/helpers/canvas-servicios.ts) | Levanta el servidor real (Fastify, Socket.IO y Prisma) en un puerto efímero y conecta varios clientes de socket, cada uno con el JWT de un usuario distinto |
| [`liquidaciones-flujo.ts`](../tests/helpers/liquidaciones-flujo.ts) | Escenario propio de las suites de liquidaciones y facturación: siembra su cliente y sus usuarios con un prefijo y limpia por prefijo (también lo que dejó una ejecución que murió a medias) |
| [`forms-concurrencia.ts`](../tests/helpers/forms-concurrencia.ts) | Doble de Prisma y S3 con semántica real de locks, para probar carreras del portal de formularios sin base |
| [`escanear-eventos.ts`](../tests/helpers/escanear-eventos.ts) | Extrae del código qué eventos de socket emite el backend y cuáles escucha el frontend |

## Qué hay en la suite

- **Borrado lógico** (`soft-delete-*.test.ts`): que lo retirado sigue existiendo
  marcado, que restaurar lo devuelve, que los totales solo suman lo activo.
  Contexto en [borrado-logico-liquidaciones.md](./borrado-logico-liquidaciones.md).
- **Sockets**: `contrato-eventos.test.ts` cruza los eventos que emite el backend
  con los que escucha el frontend; `sockets-dominio-integracion.test.ts`
  comprueba que un `POST` produce su evento con servidor y cliente reales;
  `sockets-seguridad` comprueba que el room privado de cada usuario no se puede
  leer desde otra cuenta y `sockets-enforce`, el rechazo del handshake sin
  token en modo `enforce`. Más en
  [tiempo-real.md](./tiempo-real.md#pruebas-que-protegen-esto).
- **Flujos con base**: liquidaciones de servicios y facturación, cartera y pagos
  de cierres, combustible, incidentes, mantenimiento, primas, nómina,
  documentos de conductores, tarifas, sesiones.
- **Puros que corren con la config general**: en `tests/`, el apagado ordenado,
  los cálculos de combustible y de mantenimiento, el dominio de incidentes, el
  triaje de solicitudes web, los nombres de extractos y el contrato de eventos;
  en `src/` (`*.spec.ts`), nómina, cartera, reglas de cierres, corte de
  recorridos, estructura de PDF, cola de borradores… No tocan la base, pero
  `tests/setup.ts` intenta conectarse igual (si no hay base, solo avisa).
- **PDF de la declaración** (`tests/declaracion-transporte/`): escribe los PDF
  en `tests/declaracion-transporte-output/`, que aquí no está versionado.

**Dependen del frontend gemelo como carpeta hermana** (`../cotransmeq-app`):
`contrato-eventos.test.ts` y
`src/modules/liquidaciones-terceros-pdf/pdf-tokens.spec.ts` (que comprueba que
los tokens visuales del PDF son espejo exacto de los del frontend). Sin esa
carpeta, el segundo se salta y el primero no encuentra ningún listener, así que
el cruce con el frontend no comprueba nada (y no falla).

## Integración continua

Job por job, en [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml):

| Job | Dónde | Qué hace | ¿Frena el despliegue? |
|---|---|---|---|
| `verificar` | `ubuntu-latest`, no el runner del servidor, para no quitarle RAM a producción | `npm ci`, `npx prisma generate`, `npm run typecheck` y las tres suites puras | Sí: `deploy` lleva `needs: verificar` |
| `suite-con-base` | `ubuntu-latest` con un `service` `postgres:18-alpine` (`cotransmeq_test`) en el 55433 | `TEST_DB_SIN_DOCKER=1 npm run test:setup` y `npx vitest run` con `LOG_LEVEL=warn` | No: es informativa (`continue-on-error`, fuera de `needs`) mientras arrastre fallos viejos. Cuando esté en verde, pasa a `needs` |

Por qué falla hoy `suite-con-base`, según el código (no se ha ejecutado para
este documento):

- **Asistencias.** `asistencias-formularios.test.ts` espera que eliminar un
  formulario borre sus respuestas en cascada, pero `AsistenciasService.eliminar`
  ya solo marca `deleted_at`. Y en la base de pruebas los disparadores de
  asistencias bloquean el `deleteMany()` sin filtro, así que esa limpieza no
  borra nada.

## Scripts de prueba fuera de Vitest

Ninguno pasa por `.env.test` ni por la guarda: usan el `.env` o un backend que
esté corriendo.

| Archivo | Qué hace | Cuidado |
|---|---|---|
| `tests/e2e-sarlaft.mjs`, `tests/e2e-declaracion-transporte.mjs` | Recorren los formularios SARLAFT y la declaración de punta a punta contra un backend levantado (`node tests/e2e-sarlaft.mjs [baseUrl]`) | Crean radicados reales: solo contra una base de QA, con el correo en `sandbox` |
| `tests/test_5casos.py`, `tests/test_recargos.py`, `tests/test_regla_descuento.py` | Reimplementaciones en Python de cálculos de recargos y descuentos | No prueban el código del backend |
| `test-*.sh`, `test-*.ts`, `test-*.js`, `test-*.py` y `verificar-rn-0-48h.py` de la raíz | Pruebas manuales antiguas (CRUD por `curl`, filtros, cálculos, IA) | **Históricos**: ningún script de `package.json` ni el workflow los usa; solo los citan documentos viejos. Los `.sh` llaman a `http://localhost:4000` —el puerto local de este backend— con un usuario fijo, y varios hacen `DELETE`. No los ejecutes |

`TESTS_README.md` y `TESTS_ACCIONES_CORRECTIVAS.md`, en la raíz, describen un
estado anterior de la suite.

## Diferencias con Transmeralda

- La base de pruebas del gemelo es `transmeralda_test`, en el **55432**.
- El gemelo tiene más tests: `canvas-servicios-sockets`, cinco más de
  formularios dinámicos (`concurrencia`, `respuestas`, `saneamiento`,
  `semillas` y `validador`), los de historial y vigencias de recargos, los PDF
  de SARLAFT (que allí escriben en una carpeta versionada) y el script
  `helpers/e2e-sesiones.ts` para sus e2e de Playwright. No tiene ni
  `e2e-sarlaft.mjs` ni los scripts de Python.
- Allí los tres tests de asistencias llaman a `exigirBaseDesechable()` antes de
  su `deleteMany()`; aquí no.
- `tests/env-test.ts`, `tests/guard-db.ts`, `tests/setup.ts` y
  `helpers/sesion-prueba.ts` son iguales en los dos, y las cinco configs de
  Vitest solo cambian en comentarios.
