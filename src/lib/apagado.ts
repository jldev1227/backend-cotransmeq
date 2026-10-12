/**
 * Apagado ordenado del proceso: lo que pasa entre el SIGTERM y la salida.
 *
 * Docker (y `docker compose up --force-recreate` en cada despliegue) manda
 * SIGTERM y, si el proceso no ha salido al cabo del `stop_grace_period`, lo
 * remata con SIGKILL. Antes solo se atendía SIGINT, así que el SIGTERM no
 * hacía nada —con node como PID 1 ni siquiera mata: el kernel no aplica la
 * acción por defecto a PID 1— y el contenedor moría por SIGKILL a los 10 s,
 * con un cron de snapshots o de cierre de servicios a mitad de camino y las
 * peticiones en vuelo cortadas.
 *
 * Orden del apagado:
 *   1. los crons dejan de programar ticks nuevos;
 *   2. el HTTP deja de aceptar conexiones y termina las peticiones en curso, y
 *      se cierran los sockets (si no, el servidor espera a que los clientes de
 *      socket.io se vayan solos, que no lo hacen nunca);
 *   3. se espera a que acabe la ejecución en curso de cada cron;
 *   4. se cierra Prisma y se sale con 0.
 * Todo con un tope (`LIMITE_APAGADO_MS`) por debajo del grace period de Docker
 * (`stop_grace_period` en docker-compose.yml): si se agota, se registra qué
 * seguía corriendo y se sale con 1, que es mejor que un SIGKILL mudo.
 *
 * Este módulo no importa nada pesado al cargarse (sockets y Prisma se piden al
 * apagar) para que registrar un cron no arrastre el resto de la app.
 */
import type { CronJob } from 'cron'
import type { FastifyInstance } from 'fastify'
import { logger } from '../utils/logger'

/// 25 s: por debajo de los 30 s de `stop_grace_period` del compose, para que
/// sea este proceso —y no Docker— quien decida y deje constancia en el log.
export const LIMITE_APAGADO_MS = Number(process.env.LIMITE_APAGADO_MS) || 25_000

interface CronRegistrado {
  nombre: string
  job: CronJob<any, any>
}

const crons: CronRegistrado[] = []
let servidor: FastifyInstance | null = null
let apagando = false

/**
 * Apunta un cron al apagado ordenado y lo devuelve tal cual.
 *
 * Todo `start*Cron()` que se arranque en `server.ts` debe pasar por aquí
 * (`registrarCron('nombre', startXCron())`): un cron sin registrar sigue
 * funcionando, pero el apagado no lo espera y Docker lo corta a medias.
 *
 * Activa `waitForCompletion`, que en `cron` v4 hace dos cosas que aquí se
 * quieren: `stop()` devuelve una promesa que espera a la ejecución en curso, y
 * un tick que llega con la anterior todavía corriendo se salta en vez de
 * solaparse. Sin él la librería da el callback por terminado en cuanto
 * devuelve su promesa, y no habría forma de saber si una captura de
 * snapshots va por la mitad.
 */
export function registrarCron<J extends CronJob<any, any>>(nombre: string, job: J): J {
  job.waitForCompletion = true
  crons.push({ nombre, job })
  return job
}

/** Nombres de los crons registrados (para el log de arranque y los tests). */
export function cronsRegistrados(): string[] {
  return crons.map((c) => c.nombre)
}

/** El servidor HTTP que hay que cerrar. Se registra en cuanto existe. */
export function registrarServidor(app: FastifyInstance): void {
  servidor = app
}

/**
 * Detiene todos los crons registrados y espera a que termine lo que esté
 * corriendo, como mucho `limiteMs`. Devuelve los que siguen en marcha al
 * agotarse el plazo (vacío si todos terminaron).
 */
export async function detenerCrons(limiteMs = LIMITE_APAGADO_MS): Promise<string[]> {
  const esperas = crons.map(({ job }) => Promise.resolve(job.stop()))
  let temporizador: NodeJS.Timeout | undefined
  const plazo = new Promise<void>((resolve) => {
    temporizador = setTimeout(resolve, limiteMs)
    temporizador.unref()
  })
  await Promise.race([Promise.allSettled(esperas), plazo])
  clearTimeout(temporizador)
  return crons.filter(({ job }) => job.isCallbackRunning).map(({ nombre }) => nombre)
}

/** Cierra socket.io sin dejar que un fallo aquí aborte el resto del apagado. */
async function cerrarSockets(): Promise<void> {
  try {
    const { getIo } = await import('../sockets')
    // `close()` desconecta a todos los clientes y cierra también el servidor
    // HTTP subyacente; si Fastify ya lo cerró, socket.io lo ignora.
    await getIo().close()
  } catch {
    // Sockets sin inicializar (el SIGTERM llegó durante el arranque): nada
    // que cerrar.
  }
}

/**
 * Secuencia completa. Exportada para poder probarla; en el proceso real la
 * dispara `instalarApagadoOrdenado` al recibir la señal.
 */
export async function apagar(
  senal: string,
  salir: (codigo: number) => void = (c) => process.exit(c),
): Promise<void> {
  if (apagando) return
  apagando = true
  const inicio = Date.now()
  logger.info({ senal, crons: crons.length }, '📴 Apagado ordenado: dejando de aceptar trabajo nuevo')

  const tope = setTimeout(() => {
    const pendientes = crons.filter(({ job }) => job.isCallbackRunning).map(({ nombre }) => nombre)
    logger.error(
      { senal, limiteMs: LIMITE_APAGADO_MS, cronsEnCurso: pendientes },
      '⏱️  Apagado ordenado agotó su plazo; se sale con trabajo a medias',
    )
    salir(1)
  }, LIMITE_APAGADO_MS)
  tope.unref()

  // Los crons se detienen primero (no programan más ticks) y se espera su
  // ejecución en curso en paralelo con el cierre del HTTP: los dos necesitan
  // la base, que se cierra al final.
  const esperaCrons = detenerCrons(LIMITE_APAGADO_MS)

  try {
    if (servidor) await Promise.allSettled([servidor.close(), cerrarSockets()])
    logger.info({ ms: Date.now() - inicio }, '✅ HTTP y sockets cerrados')
  } catch (error) {
    logger.error({ error }, '❌ Error cerrando el servidor HTTP')
  }

  const pendientes = await esperaCrons
  if (pendientes.length > 0) {
    logger.warn({ cronsEnCurso: pendientes }, '⚠️  Crons que no terminaron a tiempo')
  } else if (crons.length > 0) {
    logger.info({ ms: Date.now() - inicio }, '✅ Crons detenidos sin trabajo en curso')
  }

  try {
    const { prisma } = await import('../config/prisma')
    await prisma.$disconnect()
    logger.info('✅ Base de datos desconectada')
  } catch (error) {
    logger.error({ error }, '❌ Error desconectando la base de datos')
  }

  // Lo último: si algo falló durante el apagado, que el evento salga antes
  // del `exit`. Sin `SENTRY_DSN` no hace nada.
  try {
    const { cerrarSentry } = await import('./sentry')
    await cerrarSentry()
  } catch {
    // Sentry nunca debe impedir el apagado.
  }

  clearTimeout(tope)
  logger.info({ senal, ms: Date.now() - inicio }, '👋 Apagado ordenado completo')
  salir(pendientes.length > 0 ? 1 : 0)
}

/**
 * Atiende SIGTERM (Docker, despliegues) y SIGINT (Ctrl+C en desarrollo).
 *
 * Una segunda señal durante el apagado sale en el acto: en desarrollo, un
 * segundo Ctrl+C es alguien que no quiere esperar 25 s.
 */
export function instalarApagadoOrdenado(): void {
  for (const senal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(senal, () => {
      if (apagando) {
        logger.warn({ senal }, '⏹️  Segunda señal durante el apagado: salida inmediata')
        process.exit(1)
      }
      void apagar(senal)
    })
  }
}
