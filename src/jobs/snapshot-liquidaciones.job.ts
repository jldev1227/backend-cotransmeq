import { CronJob } from 'cron'
import { LiquidacionesSnapshotsService } from '../modules/liquidaciones-terceros-snapshots/liquidaciones-terceros-snapshots.service'
import { logger } from '../utils/logger'

export function startLiquidacionesSnapshotJob() {
  const job = new CronJob(
    '5 * * * *',
    async () => {
      try {
        const r = await LiquidacionesSnapshotsService.capturarHorario()
        logger.info({ ok: r.ok, errors: r.errors }, '✅ Cron snapshots liquidaciones terceros ejecutado')
      } catch (error) {
        logger.error({ error }, '❌ Error ejecutando cron snapshots liquidaciones terceros')
      }
    },
    null,
    true,
    'America/Bogota'
  )

  job.start()
  logger.info('⏰ Cron snapshots liquidaciones terceros programado: cada hora (xx:05) America/Bogota')

  return job
}
