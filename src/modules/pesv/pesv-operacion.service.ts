/**
 * Operación segura: siniestros, velocidad, mantenimiento, inspecciones y
 * jornada, más la gestión de riesgos, metas, programas y plan de formación.
 *
 * Son las tablas que ALIMENTAN los indicadores. Se separan de
 * `pesv-ciclos.service.ts` porque aquello es el expediente —qué se demuestra— y
 * esto es la operación —qué pasó—. Mezclarlos haría que un cambio en el flujo
 * de revisión de evidencias tocara el mismo archivo que el alta de un siniestro.
 */

import { prisma } from '../../config/prisma'
import { normalizarPlaca } from './dominio/calidad'
import { PesvError } from './dominio/errores'
import { businessDateFor, diasEntre, fechaAYmd, hoyEnBogota, type Periodo } from './dominio/periodos'
import { registrarAuditoria } from './pesv-auditoria'
import { puedeRevisar, type ActorPesv } from './pesv-ciclos.service'
import { PROPOSITO_PREOPERACIONAL } from './indicadores/repositorio'

const fecha = (v: string): Date => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    throw new PesvError('DATOS_INVALIDOS', `Fecha inválida, se esperaba YYYY-MM-DD: "${v}".`)
  }
  return new Date(`${v}T00:00:00Z`)
}
const fechaOpt = (v: string | null | undefined): Date | null => (v ? fecha(v) : null)

// ─────────────────────────────────────────────────────────────────────────
//  Siniestros
// ─────────────────────────────────────────────────────────────────────────

export interface DatosSiniestro {
  cycleId: string
  fecha: string
  hora?: string | null
  severidad: 'FATALIDAD' | 'LESION_GRAVE' | 'LESION_LEVE' | 'SOLO_DANOS'
  trayecto?: 'LABORAL' | 'IN_ITINERE' | 'MISION' | 'PARTICULAR'
  tipoEvento?: string | null
  lugar?: string | null
  descripcion?: string | null
  conductorId?: string | null
  vehiculoId?: string | null
  servicioId?: string | null
  clienteId?: string | null
  heridos?: number | null
  fallecidos?: number | null
  tercerosInvolucrados?: number | null
  costoDirecto?: number | null
  costoIndirecto?: number | null
  investigacionRealizada?: boolean
  causasIdentificadas?: string | null
  fechaInvestigacion?: string | null
  accionCorrectivaId?: string | null
}

/**
 * Registra un siniestro.
 *
 * `fallecidos > 0` fuerza severidad `FATALIDAD`: dejar que convivan «un
 * fallecido» y «solo daños» en la misma fila haría que el desglose del
 * indicador TSV contradijera a la propia fila, y quien lo audite no sabría cuál
 * de los dos campos creer.
 */
export async function crearSiniestro(datos: DatosSiniestro, actor: ActorPesv) {
  if ((datos.fallecidos ?? 0) > 0 && datos.severidad !== 'FATALIDAD') {
    throw new PesvError(
      'DATOS_INVALIDOS',
      'Un siniestro con personas fallecidas debe registrarse con severidad FATALIDAD.',
    )
  }

  const siniestro = await prisma.pesv_incident.create({
    data: {
      cycle_id: datos.cycleId,
      fecha: fecha(datos.fecha),
      hora: datos.hora ?? null,
      severidad: datos.severidad,
      trayecto: datos.trayecto ?? 'LABORAL',
      tipo_evento: datos.tipoEvento ?? null,
      lugar: datos.lugar ?? null,
      descripcion: datos.descripcion ?? null,
      conductor_id: datos.conductorId ?? null,
      vehiculo_id: datos.vehiculoId ?? null,
      servicio_id: datos.servicioId ?? null,
      cliente_id: datos.clienteId ?? null,
      heridos: datos.heridos ?? 0,
      fallecidos: datos.fallecidos ?? 0,
      terceros_involucrados: datos.tercerosInvolucrados ?? 0,
      costo_directo: datos.costoDirecto ?? null,
      costo_indirecto: datos.costoIndirecto ?? null,
      investigacion_realizada: datos.investigacionRealizada ?? false,
      causas_identificadas: datos.causasIdentificadas ?? null,
      fecha_investigacion: fechaOpt(datos.fechaInvestigacion),
      accion_correctiva_id: datos.accionCorrectivaId ?? null,
      registrado_por_id: actor.id,
    },
  })

  await registrarAuditoria({
    entidad: 'SINIESTRO',
    entidadId: siniestro.id,
    accion: 'CREAR',
    actor,
    detalle: { fecha: datos.fecha, severidad: datos.severidad, trayecto: datos.trayecto ?? 'LABORAL' },
  })
  return siniestro
}

export async function actualizarSiniestro(id: string, datos: Partial<DatosSiniestro>, actor: ActorPesv) {
  const existente = await prisma.pesv_incident.findFirst({ where: { id, deleted_at: null } })
  if (!existente) throw new PesvError('SINIESTRO_NO_ENCONTRADO', 'El siniestro no existe o fue retirado.')

  const actualizado = await prisma.pesv_incident.update({
    where: { id },
    data: {
      ...(datos.fecha ? { fecha: fecha(datos.fecha) } : {}),
      ...(datos.hora !== undefined ? { hora: datos.hora } : {}),
      ...(datos.severidad ? { severidad: datos.severidad } : {}),
      ...(datos.trayecto ? { trayecto: datos.trayecto } : {}),
      ...(datos.tipoEvento !== undefined ? { tipo_evento: datos.tipoEvento } : {}),
      ...(datos.lugar !== undefined ? { lugar: datos.lugar } : {}),
      ...(datos.descripcion !== undefined ? { descripcion: datos.descripcion } : {}),
      ...(datos.conductorId !== undefined ? { conductor_id: datos.conductorId } : {}),
      ...(datos.vehiculoId !== undefined ? { vehiculo_id: datos.vehiculoId } : {}),
      ...(datos.servicioId !== undefined ? { servicio_id: datos.servicioId } : {}),
      ...(datos.clienteId !== undefined ? { cliente_id: datos.clienteId } : {}),
      ...(datos.heridos !== undefined ? { heridos: datos.heridos } : {}),
      ...(datos.fallecidos !== undefined ? { fallecidos: datos.fallecidos } : {}),
      ...(datos.tercerosInvolucrados !== undefined ? { terceros_involucrados: datos.tercerosInvolucrados } : {}),
      ...(datos.costoDirecto !== undefined ? { costo_directo: datos.costoDirecto } : {}),
      ...(datos.costoIndirecto !== undefined ? { costo_indirecto: datos.costoIndirecto } : {}),
      ...(datos.investigacionRealizada !== undefined ? { investigacion_realizada: datos.investigacionRealizada } : {}),
      ...(datos.causasIdentificadas !== undefined ? { causas_identificadas: datos.causasIdentificadas } : {}),
      ...(datos.fechaInvestigacion !== undefined ? { fecha_investigacion: fechaOpt(datos.fechaInvestigacion) } : {}),
      ...(datos.accionCorrectivaId !== undefined ? { accion_correctiva_id: datos.accionCorrectivaId } : {}),
    },
  })
  await registrarAuditoria({ entidad: 'SINIESTRO', entidadId: id, accion: 'ACTUALIZAR', actor, detalle: { ...datos } })
  return actualizado
}

export async function retirarSiniestro(id: string, actor: ActorPesv) {
  if (!puedeRevisar(actor)) {
    throw new PesvError('PROHIBIDO', 'Solo HSEQ o Administración pueden retirar un siniestro del registro.')
  }
  const retirado = await prisma.pesv_incident.update({ where: { id }, data: { deleted_at: new Date() } })
  await registrarAuditoria({ entidad: 'SINIESTRO', entidadId: id, accion: 'RETIRAR', actor, detalle: {} })
  return retirado
}

export async function listarSiniestros(periodo: Periodo, cicloId: string | null) {
  return prisma.pesv_incident.findMany({
    where: {
      deleted_at: null,
      fecha: { gte: fecha(periodo.desde), lte: fecha(periodo.hasta) },
      ...(cicloId ? { cycle_id: cicloId } : {}),
    },
    include: {
      conductor: { select: { id: true, nombre: true, apellido: true } },
      vehiculo: { select: { id: true, placa: true } },
      cliente: { select: { id: true, nombre: true } },
      accion_correctiva: { select: { id: true, accion_numero: true, estado_global: true } },
    },
    orderBy: { fecha: 'desc' },
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Eventos de velocidad
// ─────────────────────────────────────────────────────────────────────────

export interface DatosEventoVelocidad {
  ocurridoAt: string
  vehiculoId?: string | null
  conductorId?: string | null
  servicioId?: string | null
  velocidadKmh?: number | null
  limiteKmh?: number | null
  duracionSegundos?: number | null
  latitud?: number | null
  longitud?: number | null
  via?: string | null
  fuente?: 'MANUAL' | 'GPS' | 'TELEMETRIA' | 'IMPORTACION'
  observaciones?: string | null
}

/**
 * Registra un evento individual de exceso.
 *
 * `business_date` se calcula EN SERVIDOR con la zona de negocio. Si viniera del
 * cliente, un evento de las 23:40 en Bogotá enviado desde un dispositivo en UTC
 * caería en el día siguiente y descuadraría el indicador ELVL contra el
 * desplazamiento al que pertenece.
 *
 * `fuente` nunca es `LEGACY`: los totales mensuales de `excesos_velocidad` no se
 * convierten en eventos. Repartir un total de 14 excesos entre los viajes del
 * mes sería inventar catorce hechos que nadie observó.
 */
export async function registrarEventoVelocidad(datos: DatosEventoVelocidad, actor: ActorPesv) {
  const instante = new Date(datos.ocurridoAt)
  if (Number.isNaN(instante.getTime())) {
    throw new PesvError('DATOS_INVALIDOS', 'La marca de tiempo del evento no es válida.')
  }
  if (datos.velocidadKmh != null && datos.limiteKmh != null && datos.velocidadKmh <= datos.limiteKmh) {
    throw new PesvError(
      'DATOS_INVALIDOS',
      'La velocidad registrada no supera el límite: no es un evento de exceso.',
    )
  }

  const evento = await prisma.pesv_speed_event.create({
    data: {
      ocurrido_at: instante,
      business_date: fecha(businessDateFor(instante)),
      vehiculo_id: datos.vehiculoId ?? null,
      conductor_id: datos.conductorId ?? null,
      servicio_id: datos.servicioId ?? null,
      velocidad_kmh: datos.velocidadKmh ?? null,
      limite_kmh: datos.limiteKmh ?? null,
      duracion_segundos: datos.duracionSegundos ?? null,
      latitud: datos.latitud ?? null,
      longitud: datos.longitud ?? null,
      via: datos.via ?? null,
      fuente: datos.fuente ?? 'MANUAL',
      observaciones: datos.observaciones ?? null,
      registrado_por_id: actor.id,
    },
  })
  await registrarAuditoria({
    entidad: 'VELOCIDAD',
    entidadId: evento.id,
    accion: 'REGISTRAR',
    actor,
    detalle: { ocurridoAt: datos.ocurridoAt, fuente: datos.fuente ?? 'MANUAL' },
  })
  return evento
}

export async function retirarEventoVelocidad(id: string, actor: ActorPesv) {
  const retirado = await prisma.pesv_speed_event.update({ where: { id }, data: { deleted_at: new Date() } })
  await registrarAuditoria({ entidad: 'VELOCIDAD', entidadId: id, accion: 'RETIRAR', actor, detalle: {} })
  return retirado
}

export async function listarEventosVelocidad(periodo: Periodo) {
  return prisma.pesv_speed_event.findMany({
    where: { deleted_at: null, business_date: { gte: fecha(periodo.desde), lte: fecha(periodo.hasta) } },
    include: {
      vehiculo: { select: { id: true, placa: true } },
      conductor: { select: { id: true, nombre: true, apellido: true } },
      servicio: { select: { id: true, numero_planilla: true } },
    },
    orderBy: { ocurrido_at: 'desc' },
    take: 500,
  })
}

/**
 * Serie histórica de `excesos_velocidad`.
 *
 * Se expone APARTE y etiquetada como `LEGACY`. No entra en ningún indicador:
 * un total mensual por conductor y vehículo no identifica desplazamientos, y
 * usarlo como numerador de ELVL daría un porcentaje que no corresponde a nada.
 */
export async function serieHistoricaVelocidad(anio: number) {
  const filas = await prisma.excesos_velocidad.groupBy({
    by: ['mes'],
    where: { anio },
    _sum: { cantidad: true },
    orderBy: { mes: 'asc' },
  })
  return {
    origen: 'LEGACY' as const,
    advertencia:
      'Totales mensuales cargados a mano. No identifican el desplazamiento ni el instante, así que no alimentan el indicador ELVL.',
    anio,
    serie: filas.map((f) => ({ mes: f.mes, total: Number(f._sum.cantidad ?? 0) })),
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Mantenimiento
// ─────────────────────────────────────────────────────────────────────────

export interface DatosPlanMantenimiento {
  vehiculoId: string
  nombre: string
  tipo?: 'PREVENTIVO' | 'CORRECTIVO' | 'PREDICTIVO'
  periodicidadDias?: number | null
  periodicidadKm?: number | null
  ultimaEjecucionFecha?: string | null
  ultimaEjecucionKm?: number | null
  observaciones?: string | null
}

/**
 * Plan de mantenimiento por vehículo.
 *
 * Exige al menos una periodicidad —por tiempo o por kilometraje—: un plan sin
 * ninguna de las dos no puede generar una próxima fecha, así que nunca alertaría
 * y ocuparía sitio en la lista aparentando cobertura.
 */
export async function crearPlanMantenimiento(datos: DatosPlanMantenimiento, actor: ActorPesv) {
  if (!datos.periodicidadDias && !datos.periodicidadKm) {
    throw new PesvError(
      'DATOS_INVALIDOS',
      'El plan necesita una periodicidad por días o por kilómetros: sin ninguna no puede programar nada.',
    )
  }

  const plan = await prisma.vehicle_maintenance_plan.create({
    data: {
      vehiculo_id: datos.vehiculoId,
      nombre: datos.nombre,
      tipo: datos.tipo ?? 'PREVENTIVO',
      periodicidad_dias: datos.periodicidadDias ?? null,
      periodicidad_km: datos.periodicidadKm ?? null,
      ultima_ejecucion_fecha: fechaOpt(datos.ultimaEjecucionFecha),
      ultima_ejecucion_km: datos.ultimaEjecucionKm ?? null,
      proxima_fecha: proximaFecha(datos.ultimaEjecucionFecha, datos.periodicidadDias),
      proximo_km:
        datos.ultimaEjecucionKm != null && datos.periodicidadKm
          ? datos.ultimaEjecucionKm + datos.periodicidadKm
          : null,
      observaciones: datos.observaciones ?? null,
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({
    entidad: 'MANTENIMIENTO',
    entidadId: plan.id,
    accion: 'CREAR_PLAN',
    actor,
    detalle: { vehiculoId: datos.vehiculoId, nombre: datos.nombre },
  })
  return plan
}

function proximaFecha(ultima: string | null | undefined, dias: number | null | undefined): Date | null {
  if (!ultima || !dias) return null
  const base = fecha(ultima)
  return new Date(base.getTime() + dias * 86_400_000)
}

export interface DatosEventoMantenimiento {
  planId?: string | null
  vehiculoId: string
  tipo?: 'PREVENTIVO' | 'CORRECTIVO' | 'PREDICTIVO'
  descripcion: string
  fechaProgramada?: string | null
  kmProgramado?: number | null
  fechaEjecucion?: string | null
  kmEjecucion?: number | null
  taller?: string | null
  responsable?: string | null
  repuestos?: string | null
  costo?: number | null
  observaciones?: string | null
}

export async function crearEventoMantenimiento(datos: DatosEventoMantenimiento, actor: ActorPesv) {
  const ejecutado = Boolean(datos.fechaEjecucion)
  const evento = await prisma.vehicle_maintenance_event.create({
    data: {
      plan_id: datos.planId ?? null,
      vehiculo_id: datos.vehiculoId,
      tipo: datos.tipo ?? 'PREVENTIVO',
      estado: ejecutado ? 'EJECUTADO' : 'PROGRAMADO',
      descripcion: datos.descripcion,
      fecha_programada: fechaOpt(datos.fechaProgramada),
      km_programado: datos.kmProgramado ?? null,
      fecha_ejecucion: fechaOpt(datos.fechaEjecucion),
      km_ejecucion: datos.kmEjecucion ?? null,
      taller: datos.taller ?? null,
      responsable: datos.responsable ?? null,
      repuestos: datos.repuestos ?? null,
      costo: datos.costo ?? null,
      observaciones: datos.observaciones ?? null,
      ejecutado_por_id: ejecutado ? actor.id : null,
      creado_por_id: actor.id,
    },
  })
  if (ejecutado) await actualizarHojaDeVida(evento.plan_id, datos)
  await registrarAuditoria({
    entidad: 'MANTENIMIENTO',
    entidadId: evento.id,
    accion: ejecutado ? 'REGISTRAR_EJECUCION' : 'PROGRAMAR',
    actor,
    detalle: { vehiculoId: datos.vehiculoId, descripcion: datos.descripcion },
  })
  return evento
}

/** Marca una intervención como ejecutada y actualiza la hoja de vida del plan. */
export async function ejecutarMantenimiento(
  id: string,
  datos: { fechaEjecucion: string; kmEjecucion?: number | null; taller?: string | null; responsable?: string | null; repuestos?: string | null; costo?: number | null; observaciones?: string | null },
  actor: ActorPesv,
) {
  const evento = await prisma.vehicle_maintenance_event.findFirst({ where: { id, deleted_at: null } })
  if (!evento) throw new PesvError('MANTENIMIENTO_NO_ENCONTRADO', 'La intervención no existe o fue retirada.')

  const actualizado = await prisma.vehicle_maintenance_event.update({
    where: { id },
    data: {
      estado: 'EJECUTADO',
      fecha_ejecucion: fecha(datos.fechaEjecucion),
      km_ejecucion: datos.kmEjecucion ?? null,
      taller: datos.taller ?? evento.taller,
      responsable: datos.responsable ?? evento.responsable,
      repuestos: datos.repuestos ?? evento.repuestos,
      costo: datos.costo ?? evento.costo,
      observaciones: datos.observaciones ?? evento.observaciones,
      ejecutado_por_id: actor.id,
    },
  })

  await actualizarHojaDeVida(evento.plan_id, {
    vehiculoId: evento.vehiculo_id,
    descripcion: evento.descripcion,
    fechaEjecucion: datos.fechaEjecucion,
    kmEjecucion: datos.kmEjecucion,
  })

  /// La oportunidad se calcula y se deja en la bitácora, no en una columna: es
  /// una consecuencia de dos fechas, y guardarla aparte crearía un tercer sitio
  /// donde el dato puede contradecir a los otros dos.
  const programada = fechaAYmd(evento.fecha_programada)
  await registrarAuditoria({
    entidad: 'MANTENIMIENTO',
    entidadId: id,
    accion: 'EJECUTAR',
    actor,
    detalle: {
      fechaProgramada: programada,
      fechaEjecucion: datos.fechaEjecucion,
      oportuno: programada ? diasEntre(programada, datos.fechaEjecucion) <= 0 : null,
    },
  })
  return actualizado
}

async function actualizarHojaDeVida(
  planId: string | null,
  datos: { vehiculoId: string; descripcion: string; fechaEjecucion?: string | null; kmEjecucion?: number | null },
) {
  if (!planId || !datos.fechaEjecucion) return
  const plan = await prisma.vehicle_maintenance_plan.findFirst({ where: { id: planId, deleted_at: null } })
  if (!plan) return

  await prisma.vehicle_maintenance_plan.update({
    where: { id: planId },
    data: {
      ultima_ejecucion_fecha: fecha(datos.fechaEjecucion),
      ultima_ejecucion_km: datos.kmEjecucion ?? plan.ultima_ejecucion_km,
      proxima_fecha: proximaFecha(datos.fechaEjecucion, plan.periodicidad_dias),
      proximo_km:
        (datos.kmEjecucion ?? plan.ultima_ejecucion_km) != null && plan.periodicidad_km
          ? (datos.kmEjecucion ?? plan.ultima_ejecucion_km)! + plan.periodicidad_km
          : plan.proximo_km,
    },
  })
}

/** Alertas de mantenimiento: vencidos y próximos, por fecha o por kilometraje. */
export async function alertasMantenimiento(diasPreaviso = 30) {
  const hoy = hoyEnBogota()
  const [planes, programados] = await Promise.all([
    prisma.vehicle_maintenance_plan.findMany({
      where: { deleted_at: null, activo: true },
      include: { vehiculo: { select: { id: true, placa: true, kilometraje: true } } },
    }),
    prisma.vehicle_maintenance_event.findMany({
      where: { deleted_at: null, estado: 'PROGRAMADO', fecha_programada: { not: null } },
      include: { vehiculo: { select: { id: true, placa: true } } },
      orderBy: { fecha_programada: 'asc' },
    }),
  ])

  const porPlan = planes
    .map((p) => {
      const proxima = fechaAYmd(p.proxima_fecha)
      const dias = proxima ? diasEntre(hoy, proxima) : null
      /// El kilometraje del vehículo es el que lleva Flota. Si está en cero
      /// —dato no capturado— no se calcula la alerta por km: un vehículo con
      /// odómetro sin registrar aparecería siempre como vencido.
      const kmActual = p.vehiculo.kilometraje ?? 0
      const kmRestantes = p.proximo_km != null && kmActual > 0 ? p.proximo_km - kmActual : null
      return {
        planId: p.id,
        vehiculoId: p.vehiculo.id,
        placa: p.vehiculo.placa,
        nombre: p.nombre,
        proximaFecha: proxima,
        diasRestantes: dias,
        proximoKm: p.proximo_km,
        kmRestantes,
        estado:
          (dias != null && dias < 0) || (kmRestantes != null && kmRestantes < 0)
            ? ('VENCIDO' as const)
            : (dias != null && dias <= diasPreaviso) || (kmRestantes != null && kmRestantes <= 1000)
              ? ('PROXIMO' as const)
              : ('AL_DIA' as const),
        enlace: `/dashboard/flota?id=${p.vehiculo.id}`,
      }
    })
    .filter((a) => a.estado !== 'AL_DIA')
    .sort((a, b) => (a.diasRestantes ?? 9999) - (b.diasRestantes ?? 9999))

  const porEvento = programados
    .map((e) => {
      const prog = fechaAYmd(e.fecha_programada)!
      return {
        eventoId: e.id,
        vehiculoId: e.vehiculo.id,
        placa: e.vehiculo.placa,
        descripcion: e.descripcion,
        fechaProgramada: prog,
        diasRestantes: diasEntre(hoy, prog),
        estado: diasEntre(hoy, prog) < 0 ? ('VENCIDO' as const) : ('PROXIMO' as const),
        enlace: `/dashboard/pesv?vista=operacion&panel=mantenimiento&evento=${e.id}`,
      }
    })
    .filter((a) => a.diasRestantes <= diasPreaviso)

  return { planes: porPlan, intervenciones: porEvento }
}

// ─────────────────────────────────────────────────────────────────────────
//  Inspecciones preoperacionales (lectura desde Formularios)
// ─────────────────────────────────────────────────────────────────────────

/**
 * Cobertura de inspección por vehículo-fecha en el período.
 *
 * NO ofrece registro manual. Formularios Dinámicos es la fuente oficial: un
 * segundo camino de captura significaría dos verdades sobre si el vehículo se
 * inspeccionó, y la manual siempre ganaría porque es la cómoda.
 *
 * Los `preoperacionales` antiguos se exponen aparte, como serie histórica.
 */
export async function coberturaInspecciones(periodo: Periodo) {
  const desde = fecha(periodo.desde)
  const hasta = fecha(periodo.hasta)

  const asignaciones = await prisma.form_assignment.findMany({
    where: { deleted_at: null, pesv_proposito: PROPOSITO_PREOPERACIONAL },
    select: { id: true, name: true, version: { select: { title: true, form: { select: { code: true } } } } },
  })

  if (asignaciones.length === 0) {
    return {
      hayAsignacion: false,
      asignaciones: [],
      advertencia:
        'Ninguna asignación de Formularios está etiquetada como preoperacional PESV. Etiquétela para que sus envíos acrediten la inspección diaria.',
      enlaceConfiguracion: '/dashboard/formularios/asignaciones',
      filas: [] as Array<{ vehiculoId: string; placa: string; fecha: string; envioId: string | null; estado: string }>,
    }
  }

  const [envios, historico] = await Promise.all([
    prisma.form_submission.findMany({
      where: {
        assignment_id: { in: asignaciones.map((a) => a.id) },
        business_date: { gte: desde, lte: hasta },
        status: 'SUBMITTED',
      },
      select: {
        id: true,
        vehicle_id: true,
        business_date: true,
        submitted_at: true,
        vehiculo: { select: { id: true, placa: true } },
        conductor: { select: { id: true, nombre: true, apellido: true } },
        superseded: { select: { status: true } },
      },
      orderBy: { business_date: 'desc' },
      take: 2000,
    }),
    prisma.preoperacionales.count({ where: { fecha: { gte: desde, lte: hasta } } }),
  ])

  const filas = envios
    .filter((e) => !e.superseded.some((s) => s.status !== 'VOIDED'))
    .map((e) => ({
      vehiculoId: e.vehiculo?.id ?? '',
      placa: e.vehiculo?.placa ?? '—',
      fecha: fechaAYmd(e.business_date)!,
      envioId: e.id,
      conductor: e.conductor ? `${e.conductor.nombre} ${e.conductor.apellido}` : null,
      entregadoAt: e.submitted_at?.toISOString() ?? null,
      estado: 'ENTREGADO',
      enlace: `/dashboard/formularios/envios?id=${e.id}`,
    }))

  return {
    hayAsignacion: true,
    asignaciones: asignaciones.map((a) => ({
      id: a.id,
      nombre: a.name,
      formulario: `${a.version.form.code} — ${a.version.title}`,
    })),
    advertencia: null,
    enlaceConfiguracion: '/dashboard/formularios/asignaciones',
    filas,
    /// El histórico manual se informa pero no se mezcla: son booleanos diarios
    /// sin respuestas ni firma, y presentarlos junto a los envíos haría creer
    /// que tienen el mismo valor probatorio.
    historicoManual: {
      origen: 'LEGACY' as const,
      registros: historico,
      advertencia:
        'Registros manuales anteriores a la adopción de Formularios. Se conservan como histórico y no cuentan para el indicador IDP.',
    },
  }
}

// ─────────────────────────────────────────────────────────────────────────
//  Riesgos, metas, programas y formación
// ─────────────────────────────────────────────────────────────────────────

export interface DatosRiesgo {
  cycleId: string
  codigo?: string | null
  proceso?: string | null
  actorVial?: string | null
  peligro: string
  exposicion?: string | null
  consecuencia?: string | null
  probabilidadInicial?: number | null
  severidadInicial?: number | null
  nivelInicial?: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | null
  controles?: string | null
  probabilidadFinal?: number | null
  severidadFinal?: number | null
  nivelFinal?: 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO' | null
  responsableId?: string | null
  fechaValoracion?: string | null
}

export async function crearRiesgo(datos: DatosRiesgo, actor: ActorPesv) {
  const riesgo = await prisma.pesv_risk.create({
    data: {
      cycle_id: datos.cycleId,
      codigo: datos.codigo ?? null,
      proceso: datos.proceso ?? null,
      actor_vial: datos.actorVial ?? null,
      peligro: datos.peligro,
      exposicion: datos.exposicion ?? null,
      consecuencia: datos.consecuencia ?? null,
      probabilidad_inicial: datos.probabilidadInicial ?? null,
      severidad_inicial: datos.severidadInicial ?? null,
      nivel_inicial: datos.nivelInicial ?? null,
      controles: datos.controles ?? null,
      probabilidad_final: datos.probabilidadFinal ?? null,
      severidad_final: datos.severidadFinal ?? null,
      nivel_final: datos.nivelFinal ?? null,
      responsable_id: datos.responsableId ?? null,
      fecha_valoracion: fechaOpt(datos.fechaValoracion),
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({ entidad: 'RIESGO', entidadId: riesgo.id, accion: 'CREAR', actor, detalle: { peligro: datos.peligro } })
  return riesgo
}

/**
 * Actualiza un riesgo.
 *
 * La valoración INICIAL no se puede reescribir una vez fijada: los indicadores
 * RSVI y GRV la comparan con la final, y permitir editarla haría que la
 * «reducción» se pudiera fabricar bajando el punto de partida.
 */
export async function actualizarRiesgo(id: string, datos: Partial<DatosRiesgo>, actor: ActorPesv) {
  const existente = await prisma.pesv_risk.findFirst({ where: { id, deleted_at: null } })
  if (!existente) throw new PesvError('RIESGO_NO_ENCONTRADO', 'El riesgo no existe o fue retirado.')

  const intentaCambiarInicial =
    (datos.nivelInicial !== undefined && datos.nivelInicial !== existente.nivel_inicial) ||
    (datos.probabilidadInicial !== undefined && datos.probabilidadInicial !== existente.probabilidad_inicial) ||
    (datos.severidadInicial !== undefined && datos.severidadInicial !== existente.severidad_inicial)

  if (intentaCambiarInicial && existente.nivel_inicial != null && !puedeRevisar(actor)) {
    throw new PesvError(
      'PROHIBIDO',
      'La valoración inicial ya está fijada y solo HSEQ o Administración pueden corregirla: los indicadores RSVI y GRV la usan como línea base.',
    )
  }

  const actualizado = await prisma.pesv_risk.update({
    where: { id },
    data: {
      ...(datos.codigo !== undefined ? { codigo: datos.codigo } : {}),
      ...(datos.proceso !== undefined ? { proceso: datos.proceso } : {}),
      ...(datos.actorVial !== undefined ? { actor_vial: datos.actorVial } : {}),
      ...(datos.peligro !== undefined ? { peligro: datos.peligro } : {}),
      ...(datos.exposicion !== undefined ? { exposicion: datos.exposicion } : {}),
      ...(datos.consecuencia !== undefined ? { consecuencia: datos.consecuencia } : {}),
      ...(datos.probabilidadInicial !== undefined ? { probabilidad_inicial: datos.probabilidadInicial } : {}),
      ...(datos.severidadInicial !== undefined ? { severidad_inicial: datos.severidadInicial } : {}),
      ...(datos.nivelInicial !== undefined ? { nivel_inicial: datos.nivelInicial } : {}),
      ...(datos.controles !== undefined ? { controles: datos.controles } : {}),
      ...(datos.probabilidadFinal !== undefined ? { probabilidad_final: datos.probabilidadFinal } : {}),
      ...(datos.severidadFinal !== undefined ? { severidad_final: datos.severidadFinal } : {}),
      ...(datos.nivelFinal !== undefined ? { nivel_final: datos.nivelFinal } : {}),
      ...(datos.responsableId !== undefined ? { responsable_id: datos.responsableId } : {}),
      ...(datos.fechaValoracion !== undefined ? { fecha_valoracion: fechaOpt(datos.fechaValoracion) } : {}),
    },
  })
  await registrarAuditoria({ entidad: 'RIESGO', entidadId: id, accion: 'ACTUALIZAR', actor, detalle: { ...datos } })
  return actualizado
}

export async function listarRiesgos(cicloId: string) {
  return prisma.pesv_risk.findMany({
    where: { deleted_at: null, cycle_id: cicloId },
    include: { responsable: { select: { id: true, nombre: true } } },
    orderBy: [{ nivel_final: 'desc' }, { created_at: 'asc' }],
  })
}

export interface DatosMeta {
  cycleId: string
  indicadorCodigo?: string | null
  nombre: string
  descripcion?: string | null
  lineaBase?: number | null
  valorMeta?: number | null
  unidad?: string | null
  sentido?: 'MAYOR_ES_MEJOR' | 'MENOR_ES_MEJOR'
  umbralAlerta?: number | null
  fechaLimite?: string | null
  responsableId?: string | null
}

export async function crearMeta(datos: DatosMeta, actor: ActorPesv) {
  const meta = await prisma.pesv_goal.create({
    data: {
      cycle_id: datos.cycleId,
      indicador_codigo: datos.indicadorCodigo ?? null,
      nombre: datos.nombre,
      descripcion: datos.descripcion ?? null,
      linea_base: datos.lineaBase ?? null,
      valor_meta: datos.valorMeta ?? null,
      unidad: datos.unidad ?? null,
      sentido: datos.sentido ?? 'MAYOR_ES_MEJOR',
      umbral_alerta: datos.umbralAlerta ?? null,
      fecha_limite: fechaOpt(datos.fechaLimite),
      responsable_id: datos.responsableId ?? null,
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({ entidad: 'META', entidadId: meta.id, accion: 'CREAR', actor, detalle: { nombre: datos.nombre, indicador: datos.indicadorCodigo ?? null } })
  return meta
}

export async function actualizarMeta(
  id: string,
  datos: Partial<DatosMeta> & { lograda?: boolean | null; resultadoObservacion?: string | null },
  actor: ActorPesv,
) {
  const existente = await prisma.pesv_goal.findFirst({ where: { id, deleted_at: null } })
  if (!existente) throw new PesvError('META_NO_ENCONTRADA', 'La meta no existe o fue retirada.')

  /// Declarar una meta como lograda mueve el indicador CMP. Es un juicio, no un
  /// dato operativo, y por eso lo firma HSEQ o Administración.
  if (datos.lograda !== undefined && !puedeRevisar(actor)) {
    throw new PesvError(
      'REVISION_NO_AUTORIZADA',
      'Solo HSEQ o Administración pueden declarar una meta como lograda o no lograda.',
    )
  }

  const actualizada = await prisma.pesv_goal.update({
    where: { id },
    data: {
      ...(datos.indicadorCodigo !== undefined ? { indicador_codigo: datos.indicadorCodigo } : {}),
      ...(datos.nombre !== undefined ? { nombre: datos.nombre } : {}),
      ...(datos.descripcion !== undefined ? { descripcion: datos.descripcion } : {}),
      ...(datos.lineaBase !== undefined ? { linea_base: datos.lineaBase } : {}),
      ...(datos.valorMeta !== undefined ? { valor_meta: datos.valorMeta } : {}),
      ...(datos.unidad !== undefined ? { unidad: datos.unidad } : {}),
      ...(datos.sentido !== undefined ? { sentido: datos.sentido } : {}),
      ...(datos.umbralAlerta !== undefined ? { umbral_alerta: datos.umbralAlerta } : {}),
      ...(datos.fechaLimite !== undefined ? { fecha_limite: fechaOpt(datos.fechaLimite) } : {}),
      ...(datos.responsableId !== undefined ? { responsable_id: datos.responsableId } : {}),
      ...(datos.lograda !== undefined ? { lograda: datos.lograda } : {}),
      ...(datos.resultadoObservacion !== undefined ? { resultado_observacion: datos.resultadoObservacion } : {}),
    },
  })
  await registrarAuditoria({ entidad: 'META', entidadId: id, accion: 'ACTUALIZAR', actor, detalle: { ...datos } })
  return actualizada
}

export async function listarMetas(cicloId: string) {
  return prisma.pesv_goal.findMany({
    where: { deleted_at: null, cycle_id: cicloId },
    include: { responsable: { select: { id: true, nombre: true } } },
    orderBy: [{ indicador_codigo: 'asc' }, { nombre: 'asc' }],
  })
}

export interface DatosPrograma {
  cycleId: string
  tipo: string
  nombre: string
  alcance?: string | null
  lineamientos?: string | null
  fechaInicio?: string | null
  fechaFin?: string | null
  metodoMedicion?: string | null
  responsableId?: string | null
}

export async function crearPrograma(datos: DatosPrograma, actor: ActorPesv) {
  const programa = await prisma.pesv_program.create({
    data: {
      cycle_id: datos.cycleId,
      tipo: datos.tipo,
      nombre: datos.nombre,
      alcance: datos.alcance ?? null,
      lineamientos: datos.lineamientos ?? null,
      fecha_inicio: fechaOpt(datos.fechaInicio),
      fecha_fin: fechaOpt(datos.fechaFin),
      metodo_medicion: datos.metodoMedicion ?? null,
      responsable_id: datos.responsableId ?? null,
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({ entidad: 'PROGRAMA', entidadId: programa.id, accion: 'CREAR', actor, detalle: { tipo: datos.tipo, nombre: datos.nombre } })
  return programa
}

/** Declara qué vehículos cubre un programa. Es el numerador del indicador GVE. */
export async function cubrirVehiculos(
  programId: string,
  vehiculos: Array<{ vehiculoId: string; mecanismo?: string | null; desde?: string | null; hasta?: string | null }>,
  actor: ActorPesv,
) {
  const programa = await prisma.pesv_program.findFirst({ where: { id: programId, deleted_at: null } })
  if (!programa) throw new PesvError('PROGRAMA_NO_ENCONTRADO', 'El programa no existe o fue retirado.')

  /// `upsert` por (programa, vehículo) y no `deleteMany` + `createMany`: la
  /// unión guarda desde/hasta, y recrearla entera perdería la fecha desde la
  /// que cada vehículo estaba cubierto. Un vehículo que se retiró y volvió
  /// tiene que poder recuperar su fila, no nacer de cero.
  for (const v of vehiculos) {
    const existente = await prisma.pesv_program_vehicle.findFirst({
      where: { program_id: programId, vehiculo_id: v.vehiculoId },
    })
    if (existente) {
      await prisma.pesv_program_vehicle.update({
        where: { id: existente.id },
        data: {
          mecanismo: v.mecanismo ?? existente.mecanismo,
          desde: v.desde ? fecha(v.desde) : existente.desde,
          hasta: v.hasta ? fecha(v.hasta) : null,
          deleted_at: null,
        },
      })
    } else {
      await prisma.pesv_program_vehicle.create({
        data: {
          program_id: programId,
          vehiculo_id: v.vehiculoId,
          mecanismo: v.mecanismo ?? null,
          desde: v.desde ? fecha(v.desde) : null,
          hasta: v.hasta ? fecha(v.hasta) : null,
        },
      })
    }
  }

  await registrarAuditoria({
    entidad: 'PROGRAMA',
    entidadId: programId,
    accion: 'CUBRIR_VEHICULOS',
    actor,
    detalle: { cantidad: vehiculos.length },
  })
  return prisma.pesv_program_vehicle.findMany({
    where: { program_id: programId, deleted_at: null },
    include: { vehiculo: { select: { id: true, placa: true } } },
  })
}

export async function listarProgramas(cicloId: string) {
  return prisma.pesv_program.findMany({
    where: { deleted_at: null, cycle_id: cicloId },
    include: {
      responsable: { select: { id: true, nombre: true } },
      _count: { select: { vehiculos: { where: { deleted_at: null } } } },
    },
    orderBy: { tipo: 'asc' },
  })
}

export interface DatosFormacion {
  cycleId: string
  tema: string
  objetivo?: string | null
  tipo?: string
  trimestre?: number | null
  fechaPlanificada?: string | null
  poblacionObjetivo?: number | null
  responsableId?: string | null
}

export async function crearFormacion(datos: DatosFormacion, actor: ActorPesv) {
  const formacion = await prisma.pesv_training_plan.create({
    data: {
      cycle_id: datos.cycleId,
      tema: datos.tema,
      objetivo: datos.objetivo ?? null,
      tipo: datos.tipo ?? 'CAPACITACION',
      trimestre: datos.trimestre ?? null,
      fecha_planificada: fechaOpt(datos.fechaPlanificada),
      poblacion_objetivo: datos.poblacionObjetivo ?? null,
      responsable_id: datos.responsableId ?? null,
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({ entidad: 'FORMACION', entidadId: formacion.id, accion: 'CREAR', actor, detalle: { tema: datos.tema } })
  return formacion
}

/**
 * Enlaza el evento planificado con la asistencia real y lo marca ejecutado.
 *
 * La población objetivo se CONGELA aquí si no venía declarada. Si se
 * recalculara al consultar, dar de alta a diez personas en diciembre bajaría
 * retroactivamente la cobertura de marzo, y un indicador que cambia solo no
 * sirve para auditar.
 */
export async function vincularAsistencia(
  id: string,
  datos: { asistenciaId: string; evaluacionId?: string | null; fechaEjecucion?: string | null; poblacionObjetivo?: number | null },
  actor: ActorPesv,
) {
  const formacion = await prisma.pesv_training_plan.findFirst({ where: { id, deleted_at: null } })
  if (!formacion) throw new PesvError('DATOS_INVALIDOS', 'El evento de formación no existe.')

  const asistencia = await prisma.formularios_asistencia.findFirst({
    where: { id: datos.asistenciaId, deleted_at: null },
    include: { _count: { select: { respuestas: true } } },
  })
  if (!asistencia) throw new PesvError('DATOS_INVALIDOS', 'La asistencia referenciada no existe.')

  const poblacion = datos.poblacionObjetivo ?? formacion.poblacion_objetivo

  const actualizada = await prisma.pesv_training_plan.update({
    where: { id },
    data: {
      asistencia_id: datos.asistenciaId,
      evaluacion_id: datos.evaluacionId ?? formacion.evaluacion_id,
      fecha_ejecucion: datos.fechaEjecucion ? fecha(datos.fechaEjecucion) : asistencia.fecha,
      ejecutado: true,
      poblacion_objetivo: poblacion,
      poblacion_snapshot_json: {
        congeladaAt: new Date().toISOString(),
        poblacionObjetivo: poblacion,
        asistentesRegistrados: asistencia._count.respuestas,
        asistenciaId: datos.asistenciaId,
      },
    },
  })

  await registrarAuditoria({
    entidad: 'FORMACION',
    entidadId: id,
    accion: 'VINCULAR_ASISTENCIA',
    actor,
    detalle: { asistenciaId: datos.asistenciaId, asistentes: asistencia._count.respuestas },
  })
  return actualizada
}

export async function listarFormaciones(cicloId: string) {
  return prisma.pesv_training_plan.findMany({
    where: { deleted_at: null, cycle_id: cicloId },
    include: {
      asistencia: { select: { id: true, tematica: true, fecha: true, _count: { select: { respuestas: true } } } },
      responsable: { select: { id: true, nombre: true } },
    },
    orderBy: [{ trimestre: 'asc' }, { fecha_planificada: 'asc' }],
  })
}

// ─────────────────────────────────────────────────────────────────────────
//  Política de jornada
// ─────────────────────────────────────────────────────────────────────────

export async function listarPoliticasJornada() {
  return prisma.pesv_jornada_policy.findMany({
    where: { deleted_at: null },
    orderBy: { vigente_desde: 'desc' },
  })
}

/**
 * Crea una política de jornada.
 *
 * Comprueba el solape en el servicio y no con un CHECK en la base: dos rangos
 * cruzados son un error de captura que hay que poder ver y corregir con un
 * mensaje útil, no un fallo de restricción a mitad de un formulario.
 */
export async function crearPoliticaJornada(
  datos: { nombre: string; horasMaximasConduccion: number; horasDescansoMinimo?: number | null; vigenteDesde: string; vigenteHasta?: string | null; fundamento?: string | null },
  actor: ActorPesv,
) {
  if (!puedeRevisar(actor)) {
    throw new PesvError('PROHIBIDO', 'Solo HSEQ o Administración pueden definir la política de jornada.')
  }

  const desde = fecha(datos.vigenteDesde)
  const hasta = fechaOpt(datos.vigenteHasta)
  if (hasta && diasEntre(datos.vigenteDesde, datos.vigenteHasta!) < 0) {
    throw new PesvError('DATOS_INVALIDOS', 'La vigencia final no puede ser anterior a la inicial.')
  }

  const solapadas = await prisma.pesv_jornada_policy.findMany({
    where: {
      deleted_at: null,
      activo: true,
      OR: [{ vigente_hasta: null }, { vigente_hasta: { gte: desde } }],
      ...(hasta ? { vigente_desde: { lte: hasta } } : {}),
    },
    select: { id: true, nombre: true, vigente_desde: true, vigente_hasta: true },
  })
  if (solapadas.length > 0) {
    throw new PesvError(
      'DATOS_INVALIDOS',
      'El rango de vigencia se solapa con otra política activa. Cierre la anterior antes de abrir esta.',
      {
        solapadas: solapadas.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          desde: fechaAYmd(p.vigente_desde),
          hasta: fechaAYmd(p.vigente_hasta),
        })),
      },
    )
  }

  const politica = await prisma.pesv_jornada_policy.create({
    data: {
      nombre: datos.nombre,
      horas_maximas_conduccion: datos.horasMaximasConduccion,
      horas_descanso_minimo: datos.horasDescansoMinimo ?? null,
      vigente_desde: desde,
      vigente_hasta: hasta,
      fundamento: datos.fundamento ?? null,
      creado_por_id: actor.id,
    },
  })
  await registrarAuditoria({
    entidad: 'POLITICA_JORNADA',
    entidadId: politica.id,
    accion: 'CREAR',
    actor,
    detalle: { horas: datos.horasMaximasConduccion, desde: datos.vigenteDesde },
  })
  return politica
}

/** Cierra una política poniéndole fecha de fin. No la borra: es histórico. */
export async function cerrarPoliticaJornada(id: string, vigenteHasta: string, actor: ActorPesv) {
  if (!puedeRevisar(actor)) {
    throw new PesvError('PROHIBIDO', 'Solo HSEQ o Administración pueden cerrar la política de jornada.')
  }
  const politica = await prisma.pesv_jornada_policy.update({
    where: { id },
    data: { vigente_hasta: fecha(vigenteHasta) },
  })
  await registrarAuditoria({ entidad: 'POLITICA_JORNADA', entidadId: id, accion: 'CERRAR', actor, detalle: { vigenteHasta } })
  return politica
}

/** Vehículos activos con su placa normalizada, para los selectores del panel. */
export async function opcionesVehiculos() {
  const vehiculos = await prisma.vehiculos.findMany({
    where: { deleted_at: null, oculto: false },
    select: { id: true, placa: true, marca: true, linea: true },
    orderBy: { placa: 'asc' },
  })
  return vehiculos.map((v) => ({
    id: v.id,
    placa: v.placa,
    placaNormalizada: normalizarPlaca(v.placa),
    etiqueta: [v.placa, v.marca, v.linea].filter(Boolean).join(' · '),
  }))
}
