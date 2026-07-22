import { CronJob } from 'cron'
import { prisma } from '../config/prisma'
import { NotificacionesService } from '../modules/notificaciones/notificaciones.service'
import { logger } from '../utils/logger'

const INTERVALO_SEGUIMIENTO_DIAS = 15

function startOfTodayLocal() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

function endOfTodayLocal() {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d
}

function daysBetweenUtcDates(a: Date, b: Date) {
  const msPerDay = 24 * 60 * 60 * 1000
  const aUtc = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const bUtc = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.floor((bUtc - aUtc) / msPerDay)
}

function toDateOnly(value: Date | string | null | undefined): Date | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d
}

async function yaNotificadaHoy(params: {
  usuario_id: string
  tipo: 'ACCION_CORRECTIVA_RECORDATORIO' | 'ACCION_CORRECTIVA_VENCIDA'
  referencia_id: string
}) {
  const hoyInicio = startOfTodayLocal()
  const hoyFin = endOfTodayLocal()

  const existente = await prisma.notificacion.findFirst({
    where: {
      usuario_id: params.usuario_id,
      tipo: params.tipo as any,
      referencia_id: params.referencia_id,
      created_at: {
        gte: hoyInicio,
        lte: hoyFin
      }
    },
    select: { id: true }
  })

  return Boolean(existente)
}

function ultimaFechaSeguimientoAccion(accion: {
  fecha_implementacion: Date | null
  fecha_seguimiento: Date | null
  seguimientos_correccion: { fecha_seguimiento: Date }[]
  ciclos_eficacia: { fecha_seguimiento: Date }[]
  causas: {
    fecha_seguimiento: Date | null
    seguimientos: { fecha_seguimiento: Date }[]
  }[]
}): Date | null {
  const fechas: Date[] = []

  const impl = toDateOnly(accion.fecha_implementacion)
  if (impl) fechas.push(impl)

  const segAccion = toDateOnly(accion.fecha_seguimiento)
  if (segAccion) fechas.push(segAccion)

  for (const s of accion.seguimientos_correccion) {
    const f = toDateOnly(s.fecha_seguimiento)
    if (f) fechas.push(f)
  }

  for (const c of accion.ciclos_eficacia) {
    const f = toDateOnly(c.fecha_seguimiento)
    if (f) fechas.push(f)
  }

  for (const causa of accion.causas) {
    const fCausa = toDateOnly(causa.fecha_seguimiento)
    if (fCausa) fechas.push(fCausa)
    for (const s of causa.seguimientos) {
      const f = toDateOnly(s.fecha_seguimiento)
      if (f) fechas.push(f)
    }
  }

  if (!fechas.length) return null
  return fechas.reduce((max, f) => (f > max ? f : max), fechas[0])
}

export async function ejecutarCronAccionesCorrectivasRecordatorios() {
  const ahora = new Date()

  const acciones = await prisma.acciones_correctivas_preventivas.findMany({
    where: {
      OR: [
        { evaluacion_cierre_eficaz: null },
        { evaluacion_cierre_eficaz: { not: 'EFICAZ' } },
        { fecha_cierre_definitivo: null }
      ]
    },
    include: {
      seguimientos_correccion: { select: { fecha_seguimiento: true } },
      ciclos_eficacia: { select: { fecha_seguimiento: true } },
      causas: {
        select: {
          id: true,
          orden: true,
          fecha_seguimiento: true,
          seguimientos: { select: { fecha_seguimiento: true } }
        }
      }
    }
  })

  if (acciones.length === 0) {
    return { processed: 0, notified: 0 }
  }

  const admins = await prisma.usuarios.findMany({
    where: { role: 'admin' },
    select: { id: true }
  })
  const adminIds = admins.map((a) => a.id)

  let notified = 0

  for (const accion of acciones) {
    const ultima = ultimaFechaSeguimientoAccion(accion)
    if (!ultima) continue

    const diasDesdeUltimo = daysBetweenUtcDates(ultima, ahora)
    if (diasDesdeUltimo < INTERVALO_SEGUIMIENTO_DIAS) continue

    const diasDesdeIntervalo = diasDesdeUltimo % INTERVALO_SEGUIMIENTO_DIAS
    if (diasDesdeIntervalo !== 0) continue

    const proximoEnDias = INTERVALO_SEGUIMIENTO_DIAS
    const usuariosObjetivo = new Set<string>()
    adminIds.forEach((id) => usuariosObjetivo.add(id))
    if (accion.creado_por_id) usuariosObjetivo.add(accion.creado_por_id)

    for (const usuario_id of usuariosObjetivo) {
      const existe = await yaNotificadaHoy({
        usuario_id,
        tipo: 'ACCION_CORRECTIVA_RECORDATORIO',
        referencia_id: accion.id
      })
      if (existe) continue

      await NotificacionesService.crear({
        usuario_id,
        tipo: 'ACCION_CORRECTIVA_RECORDATORIO',
        titulo: 'Recordatorio de seguimiento (Acción correctiva)',
        mensaje: `La acción ${accion.accion_numero} lleva ${diasDesdeUltimo} día(s) sin cierre definitivo. Próximo seguimiento sugerido en ${proximoEnDias} día(s) (intervalo ${INTERVALO_SEGUIMIENTO_DIAS} días).`,
        referencia_id: accion.id,
        referencia_tipo: 'ACCION_CORRECTIVA'
      })
      notified++
    }
  }

  logger.info(
    { processed: acciones.length, notified, intervaloDias: INTERVALO_SEGUIMIENTO_DIAS },
    '✅ Cron recordatorios acciones correctivas (15 días) ejecutado'
  )
  return { processed: acciones.length, notified }
}

export function startAccionesCorrectivasCronJobs() {
  const job = new CronJob(
    '0 8 * * *',
    async () => {
      try {
        await ejecutarCronAccionesCorrectivasRecordatorios()
      } catch (error) {
        logger.error({ error }, '❌ Error ejecutando cron recordatorios acciones correctivas')
      }
    },
    null,
    true,
    'America/Bogota'
  )

  job.start()
  logger.info(
    `⏰ Cron recordatorios acciones correctivas programado: 8:00 AM America/Bogota (cada ${INTERVALO_SEGUIMIENTO_DIAS} días sin cierre)`
  )

  return job
}
