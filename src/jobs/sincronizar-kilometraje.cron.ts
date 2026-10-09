/**
 * Kilometraje de los vehículos a partir de los preoperacionales.
 *
 * El conductor reporta `km_inicial` y `km_final` en el preoperacional
 * (HSEQ-FR-08 livianos, HSEQ-FR-09 buses). La ficha del vehículo tiene su
 * propia columna `kilometraje`, que nadie actualizaba. Este job toma, por
 * placa, el `km_final` del preoperacional enviado más reciente y lo escribe
 * en la ficha.
 *
 * Reglas:
 *  - Solo envíos SUBMITTED, no borrados, con placa y `km_final` > 0.
 *  - El kilometraje de la ficha nunca baja: si el último reporte es menor que
 *    lo que ya tiene la ficha (un dedo de más, un vehículo con odómetro
 *    cambiado), se deja como está y queda en el detalle como «menor».
 *  - Idempotente: correrlo dos veces seguidas no cambia nada la segunda.
 *
 * Va por cron y no en el envío del formulario a propósito: un envío que
 * falle al tocar la ficha no debe tumbar el preoperacional, y así también
 * recoge los envíos que llegan tarde desde el portal sin señal.
 *
 * Programación: cada hora, al minuto 20 (America/Bogota).
 */

import { CronJob } from 'cron'
import { Prisma } from '@prisma/client'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'

export const CODIGOS_PREOPERACIONAL = ['HSEQ-FR-08', 'HSEQ-FR-09']

export interface KilometrajeDetalle {
  vehiculoId: string
  placa: string
  kilometrajeAnterior: number | null
  kilometrajeReportado: number
  fechaReporte: string
  submissionId: string
  resultado: 'actualizado' | 'igual' | 'menor'
}

export interface KilometrajeResultado {
  placasConReporte: number
  actualizados: number
  iguales: number
  menores: number
  detalle: KilometrajeDetalle[]
}

export interface KilometrajeOpciones {
  dryRun?: boolean
  logger?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
  }
}

const defaultLogger = {
  info: (obj: unknown, msg?: string) => (msg ? logger.info(obj, msg) : logger.info(obj)),
  warn: (obj: unknown, msg?: string) => (msg ? logger.warn(obj, msg) : logger.warn(obj)),
  error: (obj: unknown, msg?: string) => (msg ? logger.error(obj, msg) : logger.error(obj)),
}

/** Último `km_final` reportado por placa, con lo que hoy dice la ficha. */
async function ultimoReportePorPlaca() {
  return prisma.$queryRaw<
    Array<{ vehiculo_id: string; placa: string; kilometraje: number | null; km: number; fecha: Date; submission_id: string }>
  >(Prisma.sql`
    WITH reporte AS (
      SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, s.id AS submission_id, s.business_date, a.value_decimal::int AS km
      FROM form_answers a
      JOIN form_fields f ON f.id = a.field_id AND f.key = 'km_final'
      JOIN form_submissions s ON s.id = a.submission_id
      JOIN form_versions v ON v.id = s.version_id
      JOIN form_definitions d ON d.id = v.form_id AND d.code IN (${Prisma.join(CODIGOS_PREOPERACIONAL)})
      WHERE s.deleted_at IS NULL AND s.status = 'SUBMITTED' AND s.vehicle_id IS NOT NULL
        AND a.value_decimal IS NOT NULL AND a.value_decimal > 0
      ORDER BY s.vehicle_id, s.business_date DESC, s.submitted_at DESC
    )
    SELECT ve.id AS vehiculo_id, ve.placa, ve.kilometraje, r.km, r.business_date AS fecha, r.submission_id
    FROM reporte r JOIN vehiculos ve ON ve.id = r.vehicle_id AND ve.deleted_at IS NULL
    ORDER BY ve.placa`)
}

export async function ejecutarSincronizacionKilometraje(opciones: KilometrajeOpciones = {}): Promise<KilometrajeResultado> {
  const { dryRun = false, logger: log = defaultLogger } = opciones
  const reportes = await ultimoReportePorPlaca()

  const detalle: KilometrajeDetalle[] = reportes.map((r) => {
    const actual = r.kilometraje ?? 0
    const resultado: KilometrajeDetalle['resultado'] = r.km > actual ? 'actualizado' : r.km === actual ? 'igual' : 'menor'
    return {
      vehiculoId: r.vehiculo_id,
      placa: r.placa,
      kilometrajeAnterior: r.kilometraje,
      kilometrajeReportado: r.km,
      fechaReporte: r.fecha.toISOString().slice(0, 10),
      submissionId: r.submission_id,
      resultado,
    }
  })

  const aActualizar = detalle.filter((d) => d.resultado === 'actualizado')
  let actualizados = 0
  if (!dryRun && aActualizar.length) {
    await prisma.$transaction(
      aActualizar.map((d) =>
        prisma.vehiculos.update({
          where: { id: d.vehiculoId },
          data: { kilometraje: d.kilometrajeReportado, updated_at: new Date() },
        })
      )
    )
    actualizados = aActualizar.length
  }

  const resultado: KilometrajeResultado = {
    placasConReporte: detalle.length,
    actualizados: dryRun ? 0 : actualizados,
    iguales: detalle.filter((d) => d.resultado === 'igual').length,
    menores: detalle.filter((d) => d.resultado === 'menor').length,
    detalle,
  }
  log.info(
    { dryRun, placasConReporte: resultado.placasConReporte, actualizados: resultado.actualizados, porActualizar: aActualizar.length, iguales: resultado.iguales, menores: resultado.menores },
    '🛞 [KILOMETRAJE] Sincronización desde preoperacionales'
  )
  if (resultado.menores) {
    log.warn(
      { placas: detalle.filter((d) => d.resultado === 'menor').map((d) => `${d.placa}: ficha ${d.kilometrajeAnterior} > reporte ${d.kilometrajeReportado}`) },
      '🛞 [KILOMETRAJE] Reportes menores que la ficha (no se bajan)'
    )
  }
  return resultado
}

export function startSincronizarKilometrajeCron() {
  const job = new CronJob(
    '20 * * * *',
    async () => {
      try {
        await ejecutarSincronizacionKilometraje()
      } catch (error) {
        logger.error({ error }, '❌ Error ejecutando cron sincronizar-kilometraje')
      }
    },
    null,
    true,
    'America/Bogota'
  )
  job.start()
  logger.info('⏰ Cron sincronizar-kilometraje programado: cada hora al minuto 20 America/Bogota')
  return job
}
