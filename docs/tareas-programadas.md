# Tareas programadas y colas

Lo que el backend hace sin que nadie lo pida en ese momento: los crons que
corren dentro del proceso, las rutas pensadas para que las dispare un
programador externo y las colas en memoria que sacan del ciclo de una petición
los trabajos largos (generar borradores, guardar en lote, enviar correos).
Léelo antes de añadir un cron o una cola, de cambiar sus variables o de
reiniciar el backend con trabajo en curso. Los eventos de progreso que emiten
están en [tiempo-real.md](./tiempo-real.md#colas) y el apagado ordenado, en
[arquitectura.md](./arquitectura.md#apagado-ordenado).

## Crons

Corren **dentro del proceso de la API** (no hay un worker aparte), con
`CronJob` de la librería `cron` v4 y la zona `America/Bogota` declarada en cada
uno. [server.ts](../src/server.ts) los arranca todos, cada uno dentro de
`registrarCron('nombre', …)` para que el apagado espere su ejecución en curso.
Cada callback atrapa su error y lo deja en el log; ninguno lo manda a Sentry.

| Nombre (`registrarCron`) | Cuándo (America/Bogota) | Qué hace | Tablas | Notifica a |
|---|---|---|---|---|
| `vencimientos-documentos` | `0 7 * * *` — 07:00 | Documentos del vehículo (SOAT, pólizas, tecnomecánica, tarjeta de operación, preventiva, GPS): para el vigente de vencimiento más lejano de cada placa y categoría, avisa a 30, 15, 7 y 0 días y al vencer (solo los 3 primeros días de vencido) | Lee `documento`, `vehiculos` (no ocultos); escribe `notificacion` | Usuarios activos de mantenimiento, HSEQ y administración |
| `vencimientos-documentos-conductor` | `0 7 * * *` — 07:00 | Lo mismo con los documentos del conductor. La licencia sale de `conductores.vencimiento_licencia` aunque no haya archivo; solo conductores vinculados y no ocultos | Lee `documento`, `conductores`; escribe `notificacion` | Talento humano, HSEQ y administración |
| `incidentes-investigacion` | `10 7 * * *` — 07:10 | Incidentes sin cerrar con 15 días o más (plazo de la Res. 1401 de 2007): «hoy vence» o «investigación vencida» | Lee `pesv_incident`; escribe `notificacion` | HSEQ y administración, más talento humano si hubo lesionados |
| `mantenimiento-planes` | `15 7 * * *` — 07:15 | Planes de mantenimiento activos que entran en «próximo» o vencen, por kilómetros o por fecha (umbrales en `mantenimiento/calculo.ts`) | Lee `vehicle_maintenance_plan` y el kilometraje de `vehiculos`; escribe `notificacion` | Mantenimiento y administración |
| `acciones-correctivas` | `0 8 * * *` — 08:00 | Acciones sin cierre definitivo cuya última fecha de seguimiento fue hace 15, 30, 45… días exactos | Lee `acciones_correctivas_preventivas` con seguimientos, ciclos de eficacia y causas; escribe `notificacion` (`ACCION_CORRECTIVA_RECORDATORIO`) | Usuarios con `role: 'admin'` y el creador, menos los de operaciones sin HSEQ ni administración |
| `cerrar-servicios-con-planilla` | `0 8,18 * * *` — 08:00 y 18:00 | Servicios con un recargo de planilla que ya tiene `numero_planilla` pasan a `realizado`, con `fecha_finalizacion` del último día laborado de la planilla. Omite los cancelados, los que inició el conductor desde la app (los cierra él) y los ya `realizado`, `planilla_asignada` o `liquidado` | Lee `recargos_planillas` y `dias_laborales_planillas`; escribe `servicios` | Nadie: tampoco emite eventos de socket |
| `sincronizar-kilometraje` | `20 * * * *` — cada hora, al minuto 20 | Copia a la ficha del vehículo el `km_final` del último preoperacional enviado (HSEQ-FR-08 y FR-09). El kilometraje nunca baja | Lee `form_submissions`, `form_answers`, `form_fields`, `form_versions`, `form_definitions`; escribe `vehiculos.kilometraje` | Nadie |
| `snapshot-liquidaciones-terceros` | `5 * * * *` | Snapshot `auto` de cada cierre final no anulado | `liquidacion_tercero_final` → `liquidacion_tercero_final_snapshot` | Nadie |
| `snapshot-liquidaciones-mensual` | `15 * * * *` | Snapshot de cada cabecera del **ocasional** en borrador o liquidada (el nombre es histórico) | `liquidacion_tercero_ocasional` → `liquidacion_tercero_ocasional_snapshot` | Nadie |
| `snapshot-nomina` | `25 * * * *` | Los dos periodos vivos de nómina (el abierto y el que se liquida, según el día de corte 21) | Construye el periodo como el canvas → `nomina_periodo_snapshot` | Nadie |
| `snapshot-adicionales-periodo` | `35 * * * *` | Periodos con adicionales de cierres modificados en las últimas 24 h. Si la tabla no existe (migración pendiente), se omite con un aviso | `liquidacion_tercero_final_adicional` → `liquidacion_tercero_adicional_periodo_snapshot` | Nadie |
| `snapshot-recorridos` | `45 * * * *` | El mes en curso y, del día 1 al 10, también el anterior (se sigue editando mientras se cierra la planilla) | Canvas de recorridos → `recorridos_periodo_snapshot` | Nadie |

Los minutos están repartidos a propósito: los snapshots recorren tablas
grandes y solaparlos alarga el pico sobre la misma base; los avisos de la
mañana van escalonados para no llegar todos en el mismo segundo.

**Avisos idempotentes.** Los crons que notifican guardan una huella en
`notificacion.referencia_tipo` + `referencia_id` (por ejemplo
`docveh:<categoría>:<vence>:<umbral>`, `doccond:…`, `mant:<estado>:<km>:<fecha>`,
`incidente_investigacion_pendiente`) y no avisan dos veces lo mismo al mismo
usuario. La huella no depende del día: si un día el cron no corre, el aviso
sale al siguiente en vez de perderse. Acciones correctivas es la excepción:
deduplica por usuario y día. Cada aviso se entrega por socket
(`nueva-notificacion`) y por Web Push con `emitNotificacion`.

**Snapshots sin duplicados.** Una captura automática se salta si ya hay otra
`auto` dentro de la ventana antirrebote (`SNAPSHOT_ANTIRREBOTE_MIN`, 50 min por
defecto) o si el contenido es idéntico al último (hash canónico). La versión se
reserva con un advisory lock de PostgreSQL
([snapshot-version.ts](../src/utils/snapshot-version.ts)). Por eso es inocuo que
el cron y la ruta externa disparen a la misma hora.

**Ejecutarlos a mano.** El de kilometraje tiene script, con la misma función
que el cron: `npm run kilometraje:sync` (o
`npx tsx scripts/sincronizar-kilometraje.ts --dry-run`). El cierre de
servicios exporta `ejecutarCierreServiciosConPlanilla({ dryRun, force })`, pero
aquí no hay script que lo llame (Transmeralda sí lo tiene). Las funciones de
incidentes y mantenimiento aceptan `dryRun` y se prueban en
`tests/incidentes-integracion.test.ts` y `tests/mantenimiento-integracion.test.ts`.

## Añadir un cron

1. Crea `src/jobs/<nombre>.cron.ts`. Separa la lógica en una función exportada
   (`ejecutarX(opciones)`, con `dryRun` si escribe) que se pueda llamar desde
   un script o un test, y deja el `start*()` como envoltorio que devuelve el
   `CronJob`:

   ```ts
   export function startMiCron() {
     return new CronJob('30 6 * * *', async () => {
       try {
         await ejecutarMiTarea()
       } catch (error) {
         logger.error({ error }, 'Cron mi-cron falló')
       }
     }, null, true, 'America/Bogota')
   }
   ```

2. Regístralo en `server.ts`: `registrarCron('mi-cron', startMiCron())`. Uno
   arrancado suelto funciona, pero el apagado no lo espera y Docker lo corta a
   medias.
3. Hazlo **idempotente**: correrlo dos veces no puede duplicar nada (huella,
   antirrebote o restricción única). Un tick que llega con el anterior todavía
   corriendo se salta (`waitForCompletion`), y el apagado solo espera 25 s.
4. Calcula «hoy» en Colombia, no con `new Date()`: el proceso corre en UTC
   (el `Dockerfile` no fija `TZ`) y a las 7 p. m. de Bogotá ya es mañana. Hay
   helpers como `hoyColombia()` en `mantenimiento.service.ts` e
   `incidentes.dominio.ts`.
5. Para avisar a personas, `NotificacionesService.crear` + `emitNotificacion`.
6. Si quieres que sus fallos lleguen a Sentry, usa `capturarError` de
   [sentry.ts](../src/lib/sentry.ts) en el `catch`.
7. Aplícalo también en `backend-nest` (Transmeralda).

## Rutas disparadas desde fuera (`x-cron-secret`)

Tres rutas repiten, a petición de un programador externo, el trabajo de tres
crons de snapshots. No piden sesión ni permiso: su única guarda es la cabecera
`x-cron-secret`, que `cronAutorizado` ([cron-secreto.ts](../src/lib/cron-secreto.ts))
compara con la variable `CRON_SECRET` en tiempo constante
(`crypto.timingSafeEqual`), para que el tiempo de respuesta no delate cuántos
caracteres acertó quien prueba. **Sin `CRON_SECRET` configurada rechazan
siempre**, también una petición sin cabecera.

| Ruta | Equivale al cron | Sin secreto válido | Cómo queda fuera de la sesión |
|---|---|---|---|
| `POST /api/recorridos-snapshots/cron-hora` | `snapshot-recorridos` | 403 `{ error: 'Prohibido' }` | Plugin aparte (`recorridosSnapshotsCronRoutes`) sin `authMiddleware` |
| `POST /api/liquidaciones-terceros-snapshots/cron-hora` | `snapshot-liquidaciones-terceros` | 403 `{ error: 'No autorizado' }` | Excepción por ruta en el hook `onRequest` del plugin y en el `excepto` de `permisoPorMetodo` |
| `POST /api/liquidaciones-terceros-ocasional-snapshots/cron-hora` | `snapshot-liquidaciones-mensual` | 401 `{ error: 'Unauthorized' }` | Ídem |

Las dos últimas comparten plugin con las rutas de versiones de cierres y del
ocasional, que sí exigen sesión y `liquidaciones-terceros`: el hook
`onRequest` llama a `authMiddleware` para todas salvo la del cron (compara
`request.routeOptions.url`), y `permisoPorMetodo` la excluye con `excepto`.

En los repos no hay ningún programador que llame a estas rutas (ni workflow,
ni compose, ni script); los crons del proceso hacen el mismo trabajo y el
antirrebote absorbe un doble disparo. No se pudo determinar si hay alguno
configurado fuera. Las tres están excluidas del registro de actividad.

## Colas en memoria

Los trabajos largos no corren dentro de la petición: la ruta encola, responde
con un `jobId` y el trabajo sigue en segundo plano en el mismo proceso. **No hay
Redis**: todo vive en memoria y supone una sola instancia. El progreso viaja
por socket a la sala privada del que lo lanzó (`user-<id>`) y el resultado de
cada elemento, a la sala del libro, para que los canvas abiertos lo pinten.
Mientras el trabajo sigue en memoria (hasta su TTL después de terminar) su
estado se puede consultar por REST.

La cancelación es **cooperativa**: un `AbortController` que el bucle mira entre
elementos. No se puede abortar una transacción ni des-enviar un correo, así que
la promesa al usuario es «se detiene al terminar el elemento en curso».

| Cola | Archivo | Rutas (`/api/…`) | Concurrencia | Cola máxima | TTL tras terminar | Exclusión |
|---|---|---|---|---|---|---|
| Borradores de cierres finales | [borrador-queue.service.ts](../src/queue/borrador-queue.service.ts) | `POST liquidaciones-terceros/generar-borrador-async`, `GET …/borrador-status/:jobId`, `DELETE …/borrador-job/:jobId` | `BORRADOR_QUEUE_CONCURRENCY` (1) | `BORRADOR_QUEUE_MAX_SIZE` (10); uno en cola por usuario | `BORRADOR_QUEUE_JOB_TTL_MS` (5 min) | Por periodo `anio:mes`; otro usuario recibe `borrador:locked` con quién lo tiene |
| Borradores de nómina | [borrador-nomina-queue.service.ts](../src/queue/borrador-nomina-queue.service.ts) | `POST nomina/borradores/generar`, `GET …/status/:jobId`, `DELETE …/job/:jobId` | 1, fijo | `BORRADOR_QUEUE_MAX_SIZE` (10) | `BORRADOR_QUEUE_JOB_TTL_MS` (5 min) | Por periodo; responde `status: 'locked'` |
| Guardado masivo de cierres | [bulk-save-liquidacion-tercero.service.ts](../src/queue/bulk-save-liquidacion-tercero.service.ts) | `POST liquidaciones-terceros/guardar-borrador-bulk-async`, `GET …/save-bulk/:batchId`, `DELETE …/save-bulk-job/:batchId` | **Sin límite**: cada petición arranca su trabajo al momento | Sin cola | 1 h, fijo en el código | Ninguna |
| Envíos de liquidaciones de terceros | [envio-liquidaciones-queue.service.ts](../src/queue/envio-liquidaciones-queue.service.ts) | `POST liquidaciones-terceros/envios/lote`, `GET …/envios/status/:jobId`, `DELETE …/envios/job/:jobId` | 1, fijo | `ENVIO_LIQ_MAX_QUEUE` (5) | `ENVIO_LIQ_JOB_TTL_MS` (10 min) | Por `tipo:anio:mes` |
| Envíos de desprendibles de nómina | [envio-nomina-queue.service.ts](../src/queue/envio-nomina-queue.service.ts) | `POST nomina/envios/lote`, `GET …/status/:jobId`, `DELETE …/job/:jobId` | 1, fijo | `ENVIO_LIQ_MAX_QUEUE` (5); 150 envíos por lote | `ENVIO_LIQ_JOB_TTL_MS` (10 min) | Por periodo: rechaza con 409 si ese mes se está enviando |

Qué hace cada una:

- **Borradores de cierres finales.** Genera los cierres del periodo
  (`LiquidacionesTercerosDescuentosService.generarBorrador`). En modo
  encadenado (`persistir: true`, el del canvas) además guarda cada cierre y
  anuncia su hoja con `sheet:sheet-added` a la sala del periodo. Se cancela por
  REST o por socket (`borrador:cancel`), solo su dueño.
- **Borradores de nómina.** Construye el periodo con la misma función que el
  canvas y crea una liquidación por conductor con sus totales (escribe
  `liquidaciones`, `liquidaciones_dias`, `bonificaciones` y `recargos`). No toca
  a un conductor que ya tenga liquidación en el periodo salvo que se pida
  `sobrescribir` para él. Cada alta sale como `borrador-nomina:item` a la sala
  del libro.
- **Guardado masivo.** Llama a `guardarBorrador` placa por placa. No es una
  cola: no tiene límite de concurrencia ni de tamaño.
- **Envíos de liquidaciones de terceros.** Por cada hoja renderiza el PDF con
  Puppeteer a partir del HTML que manda el canvas (el adjunto es exactamente el
  preview), lo envía con el remitente de contabilidad
  ([integraciones.md](./integraciones.md#correo)) y espera `ENVIO_LIQ_DELAY_MS`
  (800 ms) antes del siguiente: Resend corta en 2 peticiones por segundo. Cada
  intento deja fila en `liquidacion_tercero_envio` **antes** de intentarlo
  (`ENVIANDO` → `ENVIADO` / `ERROR`).
- **Envíos de desprendibles.** El correo de siempre de la empresa
  (`sendDesprendibleNotification`) con el enlace al portal y copia oculta a
  talento humano (salvo en prueba); no adjunta PDF: el conductor lo descarga y
  firma en el portal. Constancia en `nomina_envio`, también creada antes de
  intentar. Un conductor sin correo queda `OMITIDO`, sin fila.

El **recálculo masivo de recargos** (`POST /api/recargos/recalcular-bulk`,
`recalcularBulk` en `recargos.service.ts`) sigue el mismo modelo sin estar en
`src/queue/`: lote en memoria, 3 planillas a la vez, 60 s de tope por planilla,
progreso por `recargos-bulk-recalc:*` y estado purgado una hora después de
terminar.

### Variables

| Variable | Defecto | Afecta a |
|---|---|---|
| `BORRADOR_QUEUE_CONCURRENCY` | `1` | Solo a borradores de cierres |
| `BORRADOR_QUEUE_MAX_SIZE` | `10` | Borradores de cierres y de nómina |
| `BORRADOR_QUEUE_JOB_TTL_MS` | `300000` (5 min) | Borradores de cierres y de nómina |
| `ENVIO_LIQ_DELAY_MS` | `800` | Envíos de liquidaciones y de nómina |
| `ENVIO_LIQ_MAX_QUEUE` | `5` | Envíos de liquidaciones y de nómina |
| `ENVIO_LIQ_JOB_TTL_MS` | `600000` (10 min) | Envíos de liquidaciones y de nómina |
| `SNAPSHOT_ANTIRREBOTE_MIN` | `50` | Snapshots automáticos |
| `LIMITE_APAGADO_MS` | `25000` | Plazo del apagado ordenado |
| `CRON_SECRET` | — | Rutas `*/cron-hora` (sin ella, rechazan siempre) |

Las seis primeras de la tabla se validan en [env.ts](../src/config/env.ts);
`SNAPSHOT_ANTIRREBOTE_MIN`, `LIMITE_APAGADO_MS` y `CRON_SECRET` se leen de
`process.env` directamente.

### Qué pasa al reiniciar el proceso

- **Se pierde todo lo que estaba en memoria:** trabajos en cola, el que corría,
  sus estados y sus bloqueos. La consulta de estado responde 404 para ese
  `jobId` y el cliente tiene que darlo por perdido.
- **El apagado ordenado no espera a las colas.** Espera a las peticiones HTTP y
  a los crons, cierra Prisma y sale (como mucho 25 s): un trabajo de cola se
  corta donde esté.
- **Lo ya escrito se queda.** Los cierres, liquidaciones de nómina o placas que
  se guardaron antes del corte son válidos; al relanzar, la cola de nómina
  salta a los conductores que ya tienen liquidación.
- **Envíos: revisa los `ENVIANDO`.** Como la constancia nace antes del intento,
  un corte deja filas en `ENVIANDO` en `liquidacion_tercero_envio` o
  `nomina_envio`: ese correo pudo salir o no. Compruébalo antes de reenviar el
  lote, o el tercero o el conductor lo recibe dos veces.
- **Socket.IO:** las sesiones de reconexión también vivían en memoria; los
  clientes entran como nuevos y los eventos de progreso emitidos durante el
  corte se perdieron. Los *epochs* de los canvas vuelven a cero.
- **Los bloqueos por periodo desaparecen:** justo después del reinicio otra
  persona puede lanzar el mismo periodo.

## Observaciones

- **El cancelar del guardado masivo no detiene nada.** Marca el trabajo como
  `failed` y emite `done`, pero el bucle no mira ese estado: sigue guardando
  las placas que faltan y al terminar vuelve a emitir `done` con el resultado
  real.
- **El cancelar de los envíos de nómina no comprueba el dueño**
  (`envioNominaQueueService.cancelar(jobId)`): cualquiera con permiso de
  escritura en nómina y el `jobId` lo detiene. Las demás colas sí lo comprueban.
  Las consultas de estado de todas salvo el guardado masivo tampoco miran quién
  pregunta.
- **Acciones correctivas** no filtra `deleted_at` de las acciones (la tabla lo
  tiene), así que recuerda acciones borradas, y no filtra usuarios inactivos al
  elegir a los administradores. Los demás crons de avisos sí.
- **Zona horaria.** El `CronJob` dispara en hora de Bogotá, pero dentro del
  callback `new Date()` es la hora del proceso (UTC). `snapshot-nomina` y
  `snapshot-recorridos` calculan el mes y el día con `getMonth()`/`getDate()`,
  así que entre las 19:00 y las 23:59 de Bogotá ya cuentan el día siguiente; y
  `cerrar-servicios-con-planilla` arma `fecha_finalizacion` con
  `new Date(año, mes, día, hora, minuto)` en esa misma zona.
- Ningún cron manda sus errores a Sentry (`capturarError` existe pero nadie la
  llama).

## Diferencias con Transmeralda

`src/jobs/`, `src/queue/`, los controladores de los snapshots y el registro de
crons de `server.ts` son idénticos en `backend-nest`, y las tres rutas
`*/cron-hora` tienen el mismo comportamiento. Diferencias:

- Aquí `package.json` declara `node-cron`, pero no lo usa nadie: los crons son
  de `cron` v4, como en Transmeralda.
- Transmeralda tiene `scripts/cerrar-servicios-con-planilla.ts` para lanzar el
  cierre de servicios a mano (`--dry-run`, `--force`).
- `envio-nomina-queue.service.ts` solo difiere en el orden de dos campos de un
  `where`.
