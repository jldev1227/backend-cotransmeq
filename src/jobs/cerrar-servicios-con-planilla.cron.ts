/**
 * Cierre automático de servicios asociados a recargos_planillas con numero_planilla.
 *
 * Reglas:
 *  - Solo se procesan servicios cuyo `recargos_planillas.servicio_id` apunte al servicio
 *    Y `recargos_planillas.numero_planilla` NO sea nulo ni esté vacío.
 *  - NUNCA se tocan servicios en estado `cancelado`.
 *  - Por defecto, servicios ya en `realizado | planilla_asignada | liquidado` se omiten
 *    (se consideran "ya cerrados"). `force=true` los reescribe.
 *  - `fecha_finalizacion` se calcula a partir del último día laborado del recargo
 *    (mayor `dia` con `hora_fin` válida). Si no hay días con hora, se usa ese día a
 *    las 23:59. Si el recargo no tiene días laborados, se usa el último día del mes
 *    del recargo a las 23:59.
 *
 * Programación: todos los días 08:00 y 18:00 America/Bogota.
 */

import { CronJob } from 'cron'
import { prisma } from '../config/prisma'
import { logger } from '../utils/logger'

const ESTADOS_TERMINALES_POST_REALIZADO = [
  'realizado',
  'planilla_asignada',
  'liquidado'
] as const

const ESTADO_DESTINO = 'realizado' as const

export interface CierreDetalle {
  servicioId: string
  numero_planilla: string
  recargoId: string
  estadoAnterior: string
  fechaFinalizacionAnterior: Date | null
  fechaFinalizacionNueva: Date | null
  fechaFinalizacionFuente: FechaFuente | null
  actualizado: boolean
  motivo?: string
}

export interface CierreResultado {
  candidatos: number
  aProcesar: number
  actualizados: number
  errores: number
  omitidos: number
  detalle: CierreDetalle[]
}

export interface CierreOpciones {
  force?: boolean
  dryRun?: boolean
  /** Inyección de logger para reusar en script y en cron */
  logger?: {
    info: (obj: unknown, msg?: string) => void
    warn: (obj: unknown, msg?: string) => void
    error: (obj: unknown, msg?: string) => void
  }
  /** Fecha de referencia (para tests). Por defecto `new Date()`. */
  now?: () => Date
}

const defaultLogger = {
  info: (obj: unknown, msg?: string) =>
    msg ? logger.info(obj, msg) : logger.info(obj),
  warn: (obj: unknown, msg?: string) =>
    msg ? logger.warn(obj, msg) : logger.warn(obj),
  error: (obj: unknown, msg?: string) =>
    msg ? logger.error(obj, msg) : logger.error(obj)
}

interface RecargoCandidato {
  id: string
  numero_planilla: string
  mes: number
  a_o: number
  servicio_id: string
  dias_laborales_planillas: { dia: number; hora_fin: any; deleted_at: Date | null }[]
}

interface ServicioCandidato {
  servicioId: string
  estadoActual: string
  recargos: RecargoCandidato[]
}

function decimalAHoraMinutos(valor: any): { h: number; m: number } | null {
  if (valor === null || valor === undefined) return null
  const str = String(valor).trim()
  if (str === '') return null
  const num = Number(str)
  if (!Number.isFinite(num)) return null
  if (num < 0 || num >= 24) return null
  const h = Math.floor(num)
  const minutos = Math.round((num - h) * 60)
  if (minutos === 60) return { h: h + 1, m: 0 }
  return { h, m: minutos }
}

function diasEnMes(year: number, mes1a12: number): number {
  return new Date(year, mes1a12, 0).getDate()
}

export type FechaFuente =
  | 'ultimo_dia_laboral'    // día con mayor dia + hora_fin válida
  | 'ultimo_dia_sin_hora'   // día con mayor dia pero hora_fin null → fin de día
  | 'fin_mes_recargo'       // sin días laborados → último día del mes del recargo
  | 'now'                   // sin recargo válido (no debería pasar)

/**
 * Calcula la fecha de finalización del servicio a partir del recargo.
 * Prioridad:
 *   1. Último día laborado (mayor `dia`) con `hora_fin` válida
 *   2. Último día laborado (mayor `dia`) con hora_fin null → 23:59 de ese día
 *   3. Sin días laborados → último día del mes del recargo a las 23:59
 *   4. Fallback final: `new Date()` (caller decide)
 */
function calcularFechaFinalizacion(
  recargo: RecargoCandidato
): { fecha: Date; fuente: FechaFuente } {
  const diasActivos = recargo.dias_laborales_planillas
    .filter((d) => d.deleted_at === null && d.dia != null)
    .sort((a, b) => b.dia - a.dia)

  if (diasActivos.length > 0) {
    const ultimo = diasActivos[0]
    const hm = decimalAHoraMinutos(ultimo.hora_fin)
    if (hm) {
      return {
        fecha: new Date(recargo.a_o, recargo.mes - 1, ultimo.dia, hm.h, hm.m, 0, 0),
        fuente: 'ultimo_dia_laboral'
      }
    }
    return {
      fecha: new Date(recargo.a_o, recargo.mes - 1, ultimo.dia, 23, 59, 0, 0),
      fuente: 'ultimo_dia_sin_hora'
    }
  }

  const ultimoDiaMes = diasEnMes(recargo.a_o, recargo.mes)
  return {
    fecha: new Date(recargo.a_o, recargo.mes - 1, ultimoDiaMes, 23, 59, 0, 0),
    fuente: 'fin_mes_recargo'
  }
}

async function obtenerServiciosCandidatos(): Promise<ServicioCandidato[]> {
  const recargos = await prisma.recargos_planillas.findMany({
    where: {
      numero_planilla: { not: null },
      servicio_id: { not: null },
      deleted_at: null
    },
    select: {
      id: true,
      numero_planilla: true,
      servicio_id: true,
      mes: true,
      a_o: true,
      dias_laborales_planillas: {
        where: { deleted_at: null },
        select: { dia: true, hora_fin: true, deleted_at: true }
      }
    }
  })

  const porServicio = new Map<string, ServicioCandidato>()
  for (const r of recargos) {
    if (!r.servicio_id || !r.numero_planilla) continue
    const trimmed = r.numero_planilla.trim()
    if (trimmed === '') continue

    const existente = porServicio.get(r.servicio_id)
    const recargoClean: RecargoCandidato = {
      id: r.id,
      numero_planilla: trimmed,
      mes: r.mes,
      a_o: r.a_o,
      servicio_id: r.servicio_id,
      dias_laborales_planillas: r.dias_laborales_planillas
    }
    if (existente) {
      existente.recargos.push(recargoClean)
    } else {
      porServicio.set(r.servicio_id, {
        servicioId: r.servicio_id,
        estadoActual: '',
        recargos: [recargoClean]
      })
    }
  }

  if (porServicio.size === 0) return []

  const servicios = await prisma.servicio.findMany({
    where: { id: { in: Array.from(porServicio.keys()) } },
    select: { id: true, estado: true }
  })
  const estadosMap = new Map(servicios.map((s) => [s.id, s.estado]))
  for (const [sid, entry] of porServicio) {
    entry.estadoActual = estadosMap.get(sid) ?? 'NO_ENCONTRADO'
  }

  return Array.from(porServicio.values())
}

function debeProcesarse(
  entry: ServicioCandidato,
  force: boolean
): { procesar: boolean; motivo?: string } {
  if (entry.estadoActual === 'cancelado') {
    return { procesar: false, motivo: 'servicio en estado cancelado (se omite)' }
  }
  if (entry.estadoActual === 'NO_ENCONTRADO') {
    return { procesar: false, motivo: 'servicio no encontrado en la base de datos' }
  }
  if (
    !force &&
    (ESTADOS_TERMINALES_POST_REALIZADO as readonly string[]).includes(entry.estadoActual)
  ) {
    return {
      procesar: false,
      motivo: `servicio ya en estado '${entry.estadoActual}' (usa force=true para sobrescribir)`
    }
  }
  if (!force && entry.estadoActual === ESTADO_DESTINO) {
    return { procesar: false, motivo: `servicio ya en estado destino '${ESTADO_DESTINO}'` }
  }
  return { procesar: true }
}

/**
 * Elige el recargo "ganador" para fechar el cierre:
 * el que tenga la fecha de finalización calculada más reciente.
 * Como `calcularFechaFinalizacion` siempre retorna una fecha, no hay caso null.
 */
function elegirRecargoParaCierre(
  recargos: RecargoCandidato[]
): { recargo: RecargoCandidato; fecha: Date; fuente: FechaFuente } {
  let mejor: { recargo: RecargoCandidato; fecha: Date; fuente: FechaFuente; sortKey: number } | null =
    null

  for (const r of recargos) {
    const { fecha, fuente } = calcularFechaFinalizacion(r)
    const sortKey = fecha.getTime()
    if (!mejor || sortKey > mejor.sortKey) {
      mejor = { recargo: r, fecha, fuente, sortKey }
    }
  }

  // No debería pasar porque siempre hay al menos 1 recargo, pero por si acaso:
  if (!mejor) {
    const r = recargos[0]
    return { recargo: r, fecha: new Date(), fuente: 'now' }
  }
  return { recargo: mejor.recargo, fecha: mejor.fecha, fuente: mejor.fuente }
}

export async function ejecutarCierreServiciosConPlanilla(
  opciones: CierreOpciones = {}
): Promise<CierreResultado> {
  const { force = false, dryRun = false, logger: log = defaultLogger, now = () => new Date() } =
    opciones

  log.info(
    { dryRun, force, ejecutadoEn: now().toISOString() },
    '🚀 [CERRAR-SERVICIOS] Iniciando cierre de servicios con planilla'
  )

  const candidatos = await obtenerServiciosCandidatos()
  log.info(
    { total: candidatos.length },
    `📊 Servicios únicos con recargos_planillas.numero_planilla: ${candidatos.length}`
  )

  const aProcesar: CierreDetalle[] = []
  const omitidos: CierreDetalle[] = []

  for (const entry of candidatos) {
    const decision = debeProcesarse(entry, force)
    const { recargo, fecha, fuente } = elegirRecargoParaCierre(entry.recargos)
    const base: CierreDetalle = {
      servicioId: entry.servicioId,
      numero_planilla: recargo.numero_planilla,
      recargoId: recargo.id,
      estadoAnterior: entry.estadoActual,
      fechaFinalizacionAnterior: null,
      fechaFinalizacionNueva: fecha,
      fechaFinalizacionFuente: fuente,
      actualizado: false
    }
    if (!decision.procesar) {
      base.motivo = decision.motivo
      omitidos.push(base)
    } else {
      aProcesar.push(base)
    }
  }

  log.info(
    { aProcesar: aProcesar.length, omitidos: omitidos.length },
    `✅ A procesar: ${aProcesar.length} | ⏭️  Omitidos: ${omitidos.length}`
  )

  if (aProcesar.length === 0) {
    log.info({}, '✨ Nada que actualizar.')
    return {
      candidatos: candidatos.length,
      aProcesar: 0,
      actualizados: 0,
      errores: 0,
      omitidos: omitidos.length,
      detalle: omitidos
    }
  }

  // Cargar fecha_finalizacion actual para no pisar si ya está
  const ids = aProcesar.map((r) => r.servicioId)
  const serviciosActuales = await prisma.servicio.findMany({
    where: { id: { in: ids } },
    select: { id: true, fecha_finalizacion: true }
  })
  const fechaMap = new Map(serviciosActuales.map((s) => [s.id, s.fecha_finalizacion]))
  for (const r of aProcesar) {
    r.fechaFinalizacionAnterior = fechaMap.get(r.servicioId) ?? null
  }

  if (dryRun) {
    log.info({}, '🟡 DRY-RUN: no se aplicaron cambios.')
    return {
      candidatos: candidatos.length,
      aProcesar: aProcesar.length,
      actualizados: 0,
      errores: 0,
      omitidos: omitidos.length,
      detalle: [...aProcesar, ...omitidos]
    }
  }

  let ok = 0
  let errores = 0
  for (const r of aProcesar) {
    try {
      // fechaFinalizacionNueva SIEMPRE viene seteada (calcularFechaFinalizacion
      // tiene fallbacks encadenados). Solo se respeta la fecha previa si es más
      // reciente que la calculada (no pisar cierres legítimos ya hechos).
      let fechaFinalizacion = r.fechaFinalizacionNueva
      if (
        r.fechaFinalizacionAnterior &&
        r.fechaFinalizacionAnterior.getTime() > fechaFinalizacion.getTime()
      ) {
        fechaFinalizacion = r.fechaFinalizacionAnterior
      }

      await prisma.servicio.update({
        where: { id: r.servicioId },
        data: {
          estado: ESTADO_DESTINO,
          fecha_finalizacion: fechaFinalizacion
        }
      })
      r.actualizado = true
      ok++
    } catch (err) {
      errores++
      log.error({ servicioId: r.servicioId, error: err }, '❌ Error actualizando servicio')
    }
  }

  const resultado: CierreResultado = {
    candidatos: candidatos.length,
    aProcesar: aProcesar.length,
    actualizados: ok,
    errores,
    omitidos: omitidos.length,
    detalle: [...aProcesar, ...omitidos]
  }

  // Resumen por fuente de fecha para diagnóstico
  const fuentesCount: Record<string, number> = {}
  for (const r of aProcesar) {
    const f = r.fechaFinalizacionFuente || 'now'
    fuentesCount[f] = (fuentesCount[f] || 0) + 1
  }

  log.info(
    { ...resultado, fuentesCount },
    '📋 Resumen cierre servicios con planilla'
  )
  return resultado
}

export function startCerrarServiciosConPlanillaCron() {
  // 0 8,18 * * *  -> todos los días a las 08:00 y 18:00 hora local del servidor
  const job = new CronJob(
    '0 8,18 * * *',
    async () => {
      try {
        await ejecutarCierreServiciosConPlanilla()
      } catch (error) {
        logger.error({ error }, '❌ Error ejecutando cron cerrar-servicios-con-planilla')
      }
    },
    null,
    true,
    'America/Bogota'
  )

  job.start()
  logger.info(
    '⏰ Cron cerrar-servicios-con-planilla programado: 08:00 y 18:00 America/Bogota'
  )

  return job
}
