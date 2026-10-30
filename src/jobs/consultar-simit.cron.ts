import { CronJob, CronTime } from 'cron'
import {
  consultarSimitProgramado,
  expresionCronSimit,
  leerProgramacionSimit,
  type ProgramacionSimit,
} from '../modules/simit/simit.service'
import { logger } from '../utils/logger'

const ZONA_HORARIA = 'America/Bogota'
let cronSimit: CronJob | null = null

/** Actualiza el horario del proceso actual; la configuración ya se guardó en la base. */
export function actualizarProgramacionCronSimit(programacion: ProgramacionSimit) {
  if (!cronSimit) return
  cronSimit.setTime(new CronTime(expresionCronSimit(programacion), ZONA_HORARIA))
  logger.info({ cadaHoras: programacion.cadaHoras, horarios: programacion.horarios }, '⏰ Programación SIMIT actualizada')
}

/** Consulta los objetivos recientes con una programación editable desde el dashboard. */
export function startConsultarSimitCron() {
  const cron = new CronJob(
    '0 8 * * *',
    async () => {
      try {
        const resultado = await consultarSimitProgramado()
        logger.info(resultado, '✅ Ejecución programada de consultas SIMIT')
      } catch (error) {
        logger.error({ err: error }, '❌ Ejecución programada de consultas SIMIT')
      }
    },
    null,
    true,
    ZONA_HORARIA,
  )
  cronSimit = cron
  void leerProgramacionSimit().then((programacion) => {
    if (cronSimit === cron) actualizarProgramacionCronSimit(programacion)
  }).catch((error: unknown) => {
    logger.error({ err: error }, '❌ No se pudo cargar la programación SIMIT; se conserva 8:00 a. m.')
  })
  return cron
}
