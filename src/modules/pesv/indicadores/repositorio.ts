/**
 * Lectura de insumos para los indicadores.
 *
 * Este archivo es lo ÚNICO que habla con Prisma en la ruta de indicadores. Los
 * calculadores reciben lo que sale de aquí y no saben que existe una base, que
 * es la condición para que sus pruebas cubran «denominador cero» o «turno que
 * cruza medianoche» sin montar el escenario en Postgres.
 *
 * Toda consulta filtra `deleted_at: null`. Es la regla de la casa y aquí pesa
 * doble: un registro retirado que se cuele en un denominador no rompe nada
 * visiblemente, solo hace que el indicador diga otra cosa.
 */

import { prisma } from '../../../config/prisma'
import { normalizarIdentificacion } from '../dominio/calidad'
import { aFechaUtc, fechaAYmd, instanteFinDeDia, instanteInicioDeDia, type Periodo } from '../dominio/periodos'
import type {
  AccionCorrectivaInsumo,
  ActividadInsumo,
  DiaLaboralInsumo,
  EnvioPreoperacionalInsumo,
  EventoVelocidadInsumo,
  FormacionInsumo,
  MantenimientoInsumo,
  MetaInsumo,
  PoliticaJornada,
  RiesgoInsumo,
  SiniestroInsumo,
  TramoInsumo,
} from './calculadores'

/** Propósito que marca una asignación de Formularios como preoperacional PESV. */
export const PROPOSITO_PREOPERACIONAL = 'PREOPERACIONAL'

/** Tipo del programa de gestión que cubre la velocidad (indicador GVE). */
export const PROGRAMA_VELOCIDAD = 'VELOCIDAD'

export interface InsumosIndicadores {
  siniestros: SiniestroInsumo[]
  tramos: TramoInsumo[]
  riesgos: RiesgoInsumo[]
  metas: MetaInsumo[]
  actividades: ActividadInsumo[]
  dias: DiaLaboralInsumo[]
  politicasJornada: PoliticaJornada[]
  vehiculosUsados: string[]
  vehiculosCubiertosVelocidad: string[]
  eventosVelocidad: EventoVelocidadInsumo[]
  hayHistoricoVelocidadMensual: boolean
  desplazamientos: Array<{ id: string; vehiculoId: string | null; fecha: string }>
  enviosPreoperacionales: EnvioPreoperacionalInsumo[]
  vehiculoFechaTrabajado: Array<{ vehiculoId: string; fecha: string }>
  hayAsignacionPreoperacional: boolean
  mantenimientos: MantenimientoInsumo[]
  formaciones: FormacionInsumo[]
  poblacionObjetivo: number | null
  acciones: AccionCorrectivaInsumo[]
}

const num = (v: unknown): number | null => {
  if (v == null) return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Lee todos los insumos del periodo.
 *
 * Las consultas van en paralelo porque son independientes y el panel las pide
 * todas a la vez: en serie, el overview tardaba lo que tardan trece consultas
 * sumadas sobre tablas de cientos de miles de filas.
 */
export async function leerInsumos(cicloId: string | null, periodo: Periodo): Promise<InsumosIndicadores> {
  const desdeFecha = aFechaUtc(periodo.desde)
  const hastaFecha = aFechaUtc(periodo.hasta)
  const desdeInstante = instanteInicioDeDia(periodo.desde)
  const hastaInstante = instanteFinDeDia(periodo.hasta)

  const [
    siniestrosRaw,
    diasRaw,
    riesgosRaw,
    metasRaw,
    actividadesRaw,
    politicasRaw,
    coberturaVelocidadRaw,
    eventosVelocidadRaw,
    historicoVelocidad,
    serviciosRaw,
    asignacionesPesv,
    mantenimientosRaw,
    formacionesRaw,
    accionesRaw,
  ] = await Promise.all([
    prisma.pesv_incident.findMany({
      where: {
        deleted_at: null,
        fecha: { gte: desdeFecha, lte: hastaFecha },
        ...(cicloId ? { cycle_id: cicloId } : {}),
      },
      select: { id: true, severidad: true, costo_directo: true, costo_indirecto: true },
    }),

    prisma.registro_dia_laboral.findMany({
      where: { deleted_at: null, fecha: { gte: desdeFecha, lte: hastaFecha } },
      select: {
        id: true,
        conductor_id: true,
        fecha: true,
        tipo: true,
        segmentos: {
          where: { deleted_at: null },
          select: {
            id: true,
            vehiculo_id: true,
            km_inicial: true,
            km_final: true,
            horas_conducidas: true,
            hora_inicio: true,
            hora_fin: true,
            inicio_dia_siguiente: true,
            fin_dia_siguiente: true,
          },
        },
      },
    }),

    cicloId
      ? prisma.pesv_risk.findMany({
          where: { deleted_at: null, cycle_id: cicloId },
          select: { id: true, nivel_inicial: true, nivel_final: true },
        })
      : Promise.resolve([]),

    cicloId
      ? prisma.pesv_goal.findMany({
          where: { deleted_at: null, cycle_id: cicloId },
          select: { id: true, lograda: true },
        })
      : Promise.resolve([]),

    /// El plan anual se filtra por la fecha límite: una actividad de diciembre
    /// no es un incumplimiento de marzo. Las que no tienen fecha se leen igual
    /// y el calculador decide (van a `SIN_FECHA`, no al denominador).
    prisma.actividades_pesv.findMany({
      where: {
        deleted_at: null,
        ...(cicloId
          ? { OR: [{ cycle_id: cicloId }, { cycle_id: null, anio: periodo.anio }] }
          : { anio: periodo.anio }),
        OR: [
          { fecha_limite: { gte: desdeFecha, lte: hastaFecha } },
          { fecha_limite: null },
        ],
      },
      select: { id: true, estado: true },
    }),

    prisma.pesv_jornada_policy.findMany({
      where: { deleted_at: null, activo: true },
      select: { horas_maximas_conduccion: true, vigente_desde: true, vigente_hasta: true },
      orderBy: { vigente_desde: 'desc' },
    }),

    cicloId
      ? prisma.pesv_program_vehicle.findMany({
          where: {
            deleted_at: null,
            programa: { deleted_at: null, activo: true, cycle_id: cicloId, tipo: PROGRAMA_VELOCIDAD },
            /// Cobertura vigente EN el periodo, no cobertura declarada alguna
            /// vez: un vehículo que salió del programa en enero no cubre marzo.
            OR: [{ desde: null }, { desde: { lte: hastaFecha } }],
            AND: [{ OR: [{ hasta: null }, { hasta: { gte: desdeFecha } }] }],
          },
          select: { vehiculo_id: true },
        })
      : Promise.resolve([]),

    prisma.pesv_speed_event.findMany({
      where: { deleted_at: null, business_date: { gte: desdeFecha, lte: hastaFecha } },
      select: { id: true, servicio_id: true, vehiculo_id: true, business_date: true },
    }),

    /// Serie histórica: solo interesa SI EXISTE, para poder decirle al usuario
    /// que hay totales mensuales pero no eventos. No se suma a nada.
    prisma.excesos_velocidad.count({
      where: {
        anio: periodo.anio,
        ...(periodo.granularidad === 'MENSUAL' ? { mes: periodo.mes } : {}),
      },
    }),

    /// Un desplazamiento es un servicio que se ejecutó. `fecha_realizacion` es
    /// la fecha real; cuando falta se cae a `fecha_solicitud`, que es lo único
    /// que tienen los servicios antiguos.
    prisma.servicio.findMany({
      where: {
        deleted_at: null,
        estado: { notIn: ['cancelado'] },
        OR: [
          { fecha_realizacion: { gte: desdeInstante, lte: hastaInstante } },
          { fecha_realizacion: null, fecha_solicitud: { gte: desdeInstante, lte: hastaInstante } },
        ],
      },
      select: {
        id: true,
        vehiculo_id: true,
        fecha_realizacion: true,
        fecha_solicitud: true,
      },
    }),

    prisma.form_assignment.findMany({
      where: { deleted_at: null, pesv_proposito: PROPOSITO_PREOPERACIONAL },
      select: { id: true },
    }),

    prisma.vehicle_maintenance_event.findMany({
      where: {
        deleted_at: null,
        OR: [
          { fecha_programada: { gte: desdeFecha, lte: hastaFecha } },
          { fecha_ejecucion: { gte: desdeFecha, lte: hastaFecha } },
        ],
      },
      select: {
        id: true,
        tipo: true,
        estado: true,
        fecha_programada: true,
        fecha_ejecucion: true,
      },
    }),

    cicloId
      ? prisma.pesv_training_plan.findMany({
          where: {
            deleted_at: null,
            cycle_id: cicloId,
            OR: [
              { fecha_planificada: { gte: desdeFecha, lte: hastaFecha } },
              { fecha_ejecucion: { gte: desdeFecha, lte: hastaFecha } },
            ],
          },
          select: {
            id: true,
            ejecutado: true,
            fecha_planificada: true,
            poblacion_objetivo: true,
            asistencia_id: true,
          },
        })
      : Promise.resolve([]),

    prisma.acciones_correctivas_preventivas.findMany({
      where: {
        deleted_at: null,
        origen_pesv: true,
        ...(cicloId ? { pesv_cycle_id: cicloId } : {}),
        OR: [
          { fecha_identificacion_hallazgo: { gte: desdeFecha, lte: hastaFecha } },
          { fecha_identificacion_hallazgo: null },
        ],
      },
      select: {
        id: true,
        estado_global: true,
        fecha_cierre_definitivo: true,
        evaluacion_cierre_eficaz: true,
      },
    }),
  ])

  const idsAsignacionPesv = new Set(asignacionesPesv.map((a) => a.id))

  /// Los envíos se leen por fecha de negocio, no por `submitted_at`: un
  /// preoperacional entregado a las 23:50 pertenece a su día de negocio, y
  /// filtrar por el instante lo empujaría al día siguiente en UTC.
  const enviosRaw = await prisma.form_submission.findMany({
    where: {
      business_date: { gte: desdeFecha, lte: hastaFecha },
      ...(idsAsignacionPesv.size > 0 ? { assignment_id: { in: Array.from(idsAsignacionPesv) } } : {}),
    },
    select: {
      id: true,
      assignment_id: true,
      vehicle_id: true,
      business_date: true,
      status: true,
      superseded: { select: { id: true, status: true } },
    },
  })

  const asistenciaIds = formacionesRaw
    .map((f) => f.asistencia_id)
    .filter((x): x is string => Boolean(x))

  const respuestas = asistenciaIds.length
    ? await prisma.respuestas_asistencia.findMany({
        where: { formulario_id: { in: asistenciaIds } },
        select: { formulario_id: true, numero_documento: true },
      })
    : []

  const asistentesPorFormulario = new Map<string, string[]>()
  for (const r of respuestas) {
    /// Se normaliza la identificación antes de agrupar: la misma persona
    /// firmando «12.345.678» y «12345678» son dos filas y contarían doble en
    /// la cobertura de personal formado.
    const doc = normalizarIdentificacion(r.numero_documento)
    if (!doc) continue
    const lista = asistentesPorFormulario.get(r.formulario_id) ?? []
    lista.push(doc)
    asistentesPorFormulario.set(r.formulario_id, lista)
  }

  // ── Derivados ────────────────────────────────────────────────────────

  const tramos: TramoInsumo[] = []
  const dias: DiaLaboralInsumo[] = []
  const vehiculoFecha = new Map<string, { vehiculoId: string; fecha: string }>()
  const vehiculosUsados = new Set<string>()

  for (const d of diasRaw) {
    const fecha = fechaAYmd(d.fecha)!
    for (const s of d.segmentos) {
      tramos.push({
        id: s.id,
        vehiculoId: s.vehiculo_id,
        kmInicial: s.km_inicial,
        kmFinal: s.km_final,
      })
      if (s.vehiculo_id) {
        vehiculosUsados.add(s.vehiculo_id)
        vehiculoFecha.set(`${s.vehiculo_id}|${fecha}`, { vehiculoId: s.vehiculo_id, fecha })
      }
    }
    dias.push({
      id: d.id,
      conductorId: d.conductor_id,
      fecha,
      tipo: d.tipo,
      segmentos: d.segmentos.map((s) => ({
        id: s.id,
        horasConducidas: num(s.horas_conducidas),
        horaInicio: s.hora_inicio,
        horaFin: s.hora_fin,
        inicioDiaSiguiente: s.inicio_dia_siguiente,
        finDiaSiguiente: s.fin_dia_siguiente,
      })),
    })
  }

  const desplazamientos = serviciosRaw.map((s) => {
    const fecha = fechaAYmd(s.fecha_realizacion ?? s.fecha_solicitud) ?? periodo.desde
    if (s.vehiculo_id) {
      vehiculosUsados.add(s.vehiculo_id)
      vehiculoFecha.set(`${s.vehiculo_id}|${fecha}`, { vehiculoId: s.vehiculo_id, fecha })
    }
    return { id: s.id, vehiculoId: s.vehiculo_id, fecha }
  })

  /// Un envío está sustituido si algún otro envío lo referencia y ese otro NO
  /// está anulado: si la corrección también se anuló, el original vuelve a ser
  /// el vigente.
  const enviosPreoperacionales: EnvioPreoperacionalInsumo[] = enviosRaw.map((e) => ({
    id: e.id,
    vehiculoId: e.vehicle_id,
    businessDate: fechaAYmd(e.business_date)!,
    status: e.status as EnvioPreoperacionalInsumo['status'],
    sustituido: e.superseded.some((s) => s.status !== 'VOIDED'),
    asignacionPesv: idsAsignacionPesv.has(e.assignment_id),
  }))

  const formaciones: FormacionInsumo[] = formacionesRaw.map((f) => ({
    id: f.id,
    ejecutado: f.ejecutado,
    fechaPlanificada: fechaAYmd(f.fecha_planificada),
    asistentes: f.asistencia_id ? (asistentesPorFormulario.get(f.asistencia_id) ?? []) : [],
  }))

  /// La población objetivo del periodo es la mayor declarada entre sus
  /// formaciones. Sumarlas contaría a la misma persona una vez por evento; la
  /// máxima es la aproximación honesta a «cuánta gente había que formar».
  const poblaciones = formacionesRaw
    .map((f) => f.poblacion_objetivo)
    .filter((p): p is number => p != null && p > 0)
  const poblacionObjetivo = poblaciones.length > 0 ? Math.max(...poblaciones) : null

  return {
    siniestros: siniestrosRaw.map((s) => ({
      id: s.id,
      severidad: s.severidad as SiniestroInsumo['severidad'],
      costoDirecto: num(s.costo_directo),
      costoIndirecto: num(s.costo_indirecto),
    })),
    tramos,
    riesgos: riesgosRaw.map((r) => ({
      id: r.id,
      nivelInicial: (r.nivel_inicial as RiesgoInsumo['nivelInicial']) ?? null,
      nivelFinal: (r.nivel_final as RiesgoInsumo['nivelFinal']) ?? null,
    })),
    metas: metasRaw.map((m) => ({ id: m.id, lograda: m.lograda })),
    actividades: actividadesRaw.map((a) => ({
      id: a.id,
      estado: a.estado as ActividadInsumo['estado'],
    })),
    dias,
    politicasJornada: politicasRaw.map((p) => ({
      horasMaximasConduccion: Number(p.horas_maximas_conduccion),
      vigenteDesde: fechaAYmd(p.vigente_desde)!,
      vigenteHasta: fechaAYmd(p.vigente_hasta),
    })),
    vehiculosUsados: Array.from(vehiculosUsados),
    vehiculosCubiertosVelocidad: coberturaVelocidadRaw.map((c) => c.vehiculo_id),
    eventosVelocidad: eventosVelocidadRaw.map((e) => ({
      id: e.id,
      servicioId: e.servicio_id,
      vehiculoId: e.vehiculo_id,
      businessDate: fechaAYmd(e.business_date)!,
    })),
    hayHistoricoVelocidadMensual: historicoVelocidad > 0,
    desplazamientos,
    enviosPreoperacionales,
    vehiculoFechaTrabajado: Array.from(vehiculoFecha.values()),
    hayAsignacionPreoperacional: idsAsignacionPesv.size > 0,
    mantenimientos: mantenimientosRaw.map((m) => ({
      id: m.id,
      tipo: m.tipo as MantenimientoInsumo['tipo'],
      estado: m.estado as MantenimientoInsumo['estado'],
      fechaProgramada: fechaAYmd(m.fecha_programada),
      fechaEjecucion: fechaAYmd(m.fecha_ejecucion),
    })),
    formaciones,
    poblacionObjetivo,
    acciones: accionesRaw.map((a) => ({
      id: a.id,
      /// Ya vienen filtradas por `origen_pesv: true`; se conserva el campo para
      /// que el calculador sea probable con mezclas.
      origenPesv: true,
      cerrada: a.estado_global === 'CUMPLIDA' || a.fecha_cierre_definitivo != null,
      /// `evaluacion_cierre_eficaz` es texto libre histórico. Se acepta como
      /// eficaz solo lo que dice explícitamente que lo fue; cualquier otra cosa
      /// —incluido un vacío— deja el hallazgo sin acreditar, que es lo correcto
      /// para un indicador de cierre.
      eficaz: interpretarEficacia(a.evaluacion_cierre_eficaz),
    })),
  }
}

/**
 * ¿La evaluación de eficacia salió positiva?
 *
 * La columna es `VARCHAR` con valores escritos a mano a lo largo de los años
 * («EFICAZ», «Eficaz», «SI», «NO EFICAZ»). Se resuelve con una lista blanca y no
 * con «contiene EFICAZ», porque «NO EFICAZ» también lo contiene y daría el
 * resultado contrario. Lo que no encaje devuelve `null` («sin evaluar»), nunca
 * `false`: no es lo mismo un cierre evaluado como ineficaz que uno sin evaluar.
 */
export function interpretarEficacia(valor: string | null | undefined): boolean | null {
  if (!valor) return null
  const v = valor.trim().toUpperCase()
  if (['EFICAZ', 'SI', 'SÍ', 'CUMPLE', 'APROBADO', 'POSITIVA', 'EFECTIVA'].includes(v)) return true
  if (['NO EFICAZ', 'INEFICAZ', 'NO', 'NO CUMPLE', 'RECHAZADO', 'NEGATIVA'].includes(v)) return false
  return null
}
