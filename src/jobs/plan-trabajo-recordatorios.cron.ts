import { CronJob } from 'cron'
import { ejecutarRecordatoriosPlan } from '../modules/plan-trabajo/plan-trabajo.service'
import { logger } from '../utils/logger'

export function startPlanTrabajoRecordatoriosCron() {
  const job = new CronJob('0 8 * * *', async () => {
    try {
      const resultado = await ejecutarRecordatoriosPlan()
      if (resultado.enviados) logger.info(resultado, 'Recordatorios del plan de trabajo enviados')
    } catch (error) {
      logger.error({ err: error }, 'No se pudieron enviar los recordatorios del plan de trabajo')
    }
  }, null, false, 'America/Bogota')
  job.start()
  return job
}
