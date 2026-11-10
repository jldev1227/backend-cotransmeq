import { CronJob } from 'cron'

import { purgarPuntosRastreoVencidos } from '../modules/conductor-portal/rastreo-servicio.service'
import { logger } from '../utils/logger'

/** Elimina puntos 90 días después de finalizar sesión; conserva la sesión/consentimiento. */
export function startPurgarRastreoGpsCron() {
	const job = new CronJob(
		'15 3 * * *',
		async () => {
			try {
				const resultado = await purgarPuntosRastreoVencidos()
				logger.info({ puntos: resultado.count }, '✅ Purga de puntos GPS vencidos')
			} catch (error) {
				logger.error({ error }, '❌ Error purgando puntos GPS vencidos')
			}
		},
		null,
		true,
		'America/Bogota'
	)
	return job
}
