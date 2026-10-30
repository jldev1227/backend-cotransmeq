import { randomUUID } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { iniciarSesionSimit, type ResultadoPortalSimit } from './simit.portal'
import { emitirConsultaSimitActualizada } from './simit.events'
import { notificarPendientesSimit } from './simit.notificaciones'

const VENTANA_DIAS = 30
const MS_HORA = 60 * 60 * 1000
const MS_DIA = 24 * 60 * 60 * 1000
const PAUSA_ENTRE_CONSULTAS_MS = 1_200
const CLAVE_PROGRAMACION = 'simit_programacion'
const FRECUENCIAS_VALIDAS = [1, 2, 3, 4, 6, 8, 12, 24] as const

function serializarDetalleSimit(detalle: ResultadoPortalSimit['detalle']): Prisma.InputJsonValue {
  return {
    fuente: detalle.fuente,
    resumen: detalle.resumen,
    comparendosDetalle: detalle.comparendosDetalle.map((comparendo) => ({
      numeroComparendo: comparendo.numeroComparendo,
      fechaImposicion: comparendo.fechaImposicion,
      horaImposicion: comparendo.horaImposicion,
      direccion: comparendo.direccion,
      error: comparendo.error,
    })),
  }
}

export interface ProgramacionSimit {
  cadaHoras: (typeof FRECUENCIAS_VALIDAS)[number]
  horaInicio: string
  horarios: string[]
}

export interface ResultadoLoteSimit {
  consultados: number
  omitidos: number
  errores: number
}

export interface EjecucionSimit {
  id: string
  estado: 'en_curso' | 'completada' | 'error'
  origen: 'manual' | 'cron'
  iniciadoAt: string
  finalizadoAt: string | null
  procesados: number
  total: number
  resultado: ResultadoLoteSimit | null
  mensajeError: string | null
}

const ejecucionesSimit = new Map<string, EjecucionSimit>()
let loteActivo: { estado: EjecucionSimit; promesa: Promise<ResultadoLoteSimit> } | null = null
const consultasIndividualesActivas = new Map<string, Promise<InicioConsultaIndividual | null>>()

type TipoEntidad = 'vehiculo' | 'conductor'
type EstadoConsultaIndividual = 'en_curso' | 'sin_deuda' | 'con_deuda' | 'error'

interface InicioConsultaIndividual {
  consulta_id: string
  estado_consulta: EstadoConsultaIndividual
  promesa: Promise<void>
}

interface ConsultaResumen {
  id: string
  vehiculo_id?: string | null
  conductor_id?: string | null
  tipo_entidad: string
  identificador: string
  proveedor: string | null
  estado_consulta: string
  comparendos: number | null
  multas: number | null
  acuerdos_pago: number | null
  saldo_total: Prisma.Decimal | null
  detalle: Prisma.JsonValue | null
  error: string | null
  consultado_at: Date
}

interface ObjetivoSimit {
  id: string
  tipo: TipoEntidad
  nombre: string
  identificador: string
}

function atencionRequerida(consulta: ConsultaResumen | null | undefined, ahora: number, cadaHoras: number) {
  if (!consulta) return true
  const estado = estadoConsultaEfectivo(consulta)
  if (estado === 'error' || estado === 'con_deuda') return true
  if (consulta.saldo_total && Number(consulta.saldo_total) > 0) return true
  return ahora - consulta.consultado_at.getTime() >= cadaHoras * MS_HORA
}

function estadoConsultaEfectivo(consulta: Pick<ConsultaResumen, 'estado_consulta' | 'comparendos' | 'multas' | 'acuerdos_pago' | 'saldo_total' | 'detalle'>) {
  if (consulta.estado_consulta !== 'con_deuda') return consulta.estado_consulta
  const resumen = consulta.detalle && typeof consulta.detalle === 'object' && !Array.isArray(consulta.detalle)
    ? consulta.detalle.resumen
    : null
  const resolucionesEnCero = typeof resumen === 'string' && /\bresoluciones:\s*0(?:;|$)/i.test(resumen)
  const sinObligaciones = (consulta.saldo_total == null || Number(consulta.saldo_total) <= 0)
    && (consulta.comparendos ?? 0) <= 0
    && (consulta.multas ?? 0) <= 0
    && (consulta.acuerdos_pago ?? 0) <= 0
    && resolucionesEnCero
  /// Las consultas antiguas guardaron `pazSalvo: false` como deuda aunque los rubros y el total fueran cero.
  return sinObligaciones ? 'sin_deuda' : consulta.estado_consulta
}

function mascaraDocumento(documento: string | null) {
  if (!documento) return 'Sin identificación'
  return documento.length < 5 ? '••••' : `${'•'.repeat(Math.max(0, documento.length - 4))}${documento.slice(-4)}`
}

export function normalizarProgramacion(valor: unknown): ProgramacionSimit {
  const datos = valor && typeof valor === 'object' ? valor as Record<string, unknown> : {}
  const cadaHoras = FRECUENCIAS_VALIDAS.includes(datos.cadaHoras as ProgramacionSimit['cadaHoras'])
    ? datos.cadaHoras as ProgramacionSimit['cadaHoras']
    : 24
  const horaInicio = typeof datos.horaInicio === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(datos.horaInicio)
    ? datos.horaInicio
    : '08:00'
  const [hora, minuto] = horaInicio.split(':').map(Number)
  const horarios = Array.from({ length: 24 / cadaHoras }, (_, indice) => {
    const horaProgramada = (hora + indice * cadaHoras) % 24
    return `${String(horaProgramada).padStart(2, '0')}:${String(minuto).padStart(2, '0')}`
  }).sort()
  return { cadaHoras, horaInicio, horarios }
}

/** Lee una programación persistida por empresa y conserva 8:00 a. m. como valor inicial. */
export async function leerProgramacionSimit(): Promise<ProgramacionSimit> {
  const fila = await prisma.configuracion_empresa.findUnique({ where: { clave: CLAVE_PROGRAMACION } })
  return normalizarProgramacion(fila?.valor)
}

export function expresionCronSimit(programacion: ProgramacionSimit): string {
  const minuto = Number(programacion.horaInicio.slice(3, 5))
  const horas = programacion.horarios.map((hora) => Number(hora.slice(0, 2))).sort((a, b) => a - b)
  return `${minuto} ${horas.join(',')} * * *`
}

export async function guardarProgramacionSimit(
  datos: { cadaHoras: number; horaInicio: string },
  usuarioId: string,
): Promise<ProgramacionSimit> {
  const programacion = normalizarProgramacion(datos)
  await prisma.configuracion_empresa.upsert({
    where: { clave: CLAVE_PROGRAMACION },
    create: {
      clave: CLAVE_PROGRAMACION,
      valor: { cadaHoras: programacion.cadaHoras, horaInicio: programacion.horaInicio },
      actualizado_por_id: usuarioId,
    },
    update: {
      valor: { cadaHoras: programacion.cadaHoras, horaInicio: programacion.horaInicio },
      actualizado_por_id: usuarioId,
    },
  })
  return programacion
}

async function objetivosSimit(): Promise<{ vehiculos: ObjetivoSimit[]; conductores: ObjetivoSimit[] }> {
  const ahora = new Date()
  const desde = new Date(ahora.getTime() - VENTANA_DIAS * MS_DIA)
  const servicios = await prisma.servicio.findMany({
    where: {
      deleted_at: null,
      estado: { in: ['realizado', 'planilla_asignada', 'liquidado'] },
      OR: [
        { fecha_realizacion: { gte: desde, lte: ahora } },
        { fecha_realizacion: null, fecha_solicitud: { gte: desde, lte: ahora } },
      ],
    },
    select: { vehiculo_id: true, conductor_id: true },
  })
  const idsVehiculos = [...new Set(servicios.map((s) => s.vehiculo_id).filter((id): id is string => Boolean(id)))]
  const idsConductores = [...new Set(servicios.map((s) => s.conductor_id).filter((id): id is string => Boolean(id)))]
  const [vehiculos, conductores] = await Promise.all([
    idsVehiculos.length ? prisma.vehiculos.findMany({
      where: { id: { in: idsVehiculos }, deleted_at: null },
      select: { id: true, placa: true },
      orderBy: { placa: 'asc' },
    }) : [],
    idsConductores.length ? prisma.conductores.findMany({
      where: { id: { in: idsConductores }, deleted_at: null },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
      orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
    }) : [],
  ])

  return {
    vehiculos: vehiculos.map((ficha) => ({
      id: ficha.id, tipo: 'vehiculo' as const, nombre: ficha.placa, identificador: ficha.placa,
    })),
    conductores: conductores.map((ficha) => ({
      id: ficha.id,
      tipo: 'conductor' as const,
      nombre: `${ficha.nombre} ${ficha.apellido}`.trim(),
      identificador: ficha.numero_identificacion ?? '',
    })),
  }
}

/** Historial de una ficha; el documento del conductor se oculta en las respuestas del panel. */
export async function historialSimit(tipo: TipoEntidad, id: string) {
  const entidad = tipo === 'vehiculo'
    ? await prisma.vehiculos.findFirst({ where: { id }, select: { id: true, placa: true } })
    : await prisma.conductores.findFirst({ where: { id }, select: { id: true, numero_identificacion: true } })
  if (!entidad) return null

  const [historial, programacion] = await Promise.all([prisma.simit_consulta.findMany({
    where: tipo === 'vehiculo' ? { vehiculo_id: id } : { conductor_id: id },
    orderBy: { consultado_at: 'desc' },
    take: 100,
    select: {
      id: true,
      tipo_entidad: true,
      identificador: true,
      proveedor: true,
      estado_consulta: true,
      comparendos: true,
      multas: true,
      acuerdos_pago: true,
      saldo_total: true,
      detalle: true,
      error: true,
      consultado_at: true,
    },
  }), leerProgramacionSimit()])

  return {
    tipo,
    identificador: tipo === 'vehiculo'
      ? (entidad as { placa: string }).placa
      : mascaraDocumento((entidad as { numero_identificacion: string | null }).numero_identificacion),
    proveedorConfigurado: true,
    mensajeIntegracion: `Consulta cada ${programacion.cadaHoras} ${programacion.cadaHoras === 1 ? 'hora' : 'horas'} desde las ${programacion.horaInicio} (hora de Colombia).`,
    programacion,
    ultimaConsulta: historial[0] ? { ...historial[0], estado_consulta: estadoConsultaEfectivo(historial[0]) } : null,
    historial: historial.map((consulta) => ({
      ...consulta,
      estado_consulta: estadoConsultaEfectivo(consulta),
    })),
  }
}

function normalizarIdentificadorSimit(tipo: TipoEntidad, valor: string | null | undefined) {
  const normalizado = (valor ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
  const valido = tipo === 'vehiculo'
    ? /^[A-Z]{3}\d{3}$/.test(normalizado)
    : /^[A-Z0-9]{4,20}$/.test(normalizado)

  return {
    identificador: normalizado,
    error: valido ? null : tipo === 'vehiculo'
      ? 'La placa debe normalizarse al formato AAA123 para consultar SIMIT.'
      : 'La ficha no tiene un número de identificación válido para consultar SIMIT.',
  }
}

async function ejecutarConsultaIndividualSimit(
  tipo: TipoEntidad,
  entidadId: string,
  consultaId: string,
  identificador: string,
) {
  let estado: EstadoConsultaIndividual = 'error'
  let comparendos: number | null = null
  let multas: number | null = null
  let acuerdosPago: number | null = null
  let saldoTotal: number | null = null
  let detalle: Prisma.InputJsonValue | undefined
  let mensajeError: string | null = null
  let sesion: Awaited<ReturnType<typeof iniciarSesionSimit>> | null = null

  try {
    sesion = await iniciarSesionSimit()
    const resultado = await sesion.consultar(identificador)
    estado = resultado.estado_consulta
    comparendos = resultado.comparendos
    multas = resultado.multas
    acuerdosPago = resultado.acuerdos_pago
    saldoTotal = resultado.saldo_total
    detalle = serializarDetalleSimit(resultado.detalle)
  } catch (error) {
    const mensaje = error instanceof Error ? error.message : 'Error al consultar SIMIT.'
    mensajeError = mensaje.replaceAll(identificador, tipo === 'vehiculo' ? identificador : mascaraDocumento(identificador)).slice(0, 500)
  } finally {
    if (sesion) await sesion.cerrar().catch(() => undefined)
  }

  const consulta = await prisma.simit_consulta.update({
    where: { id: consultaId },
    data: {
      estado_consulta: estado,
      comparendos,
      multas,
      acuerdos_pago: acuerdosPago,
      saldo_total: saldoTotal,
      detalle,
      error: mensajeError,
      consultado_at: new Date(),
    },
    select: { consultado_at: true },
  })
  await notificarPendientesSimit({
    tipo,
    entidadId,
    consultaId,
    estado,
    comparendos,
    multas,
    acuerdosPago,
    saldoTotal,
    consultadoAt: consulta.consultado_at,
  })
  emitirConsultaSimitActualizada({
    tipo,
    entidad_id: entidadId,
    consulta_id: consultaId,
    consultado_at: consulta.consultado_at.toISOString(),
    estado_consulta: estado,
  })
}

/** Consulta una ficha y conserva `en_curso` y su resultado en el historial. */
export async function iniciarConsultaIndividualSimit(tipo: TipoEntidad, entidadId: string) {
  const clave = `${tipo}:${entidadId}`
  const existente = consultasIndividualesActivas.get(clave)
  if (existente) {
    const inicio = await existente
    return inicio ? { ...inicio, yaEstabaEnCurso: true } : null
  }

  const promesaInicio = (async (): Promise<InicioConsultaIndividual | null> => {
    const entidad = tipo === 'vehiculo'
      ? await prisma.vehiculos.findFirst({
        where: { id: entidadId, deleted_at: null },
        select: { id: true, placa: true },
      })
      : await prisma.conductores.findFirst({
        where: { id: entidadId, deleted_at: null },
        select: { id: true, numero_identificacion: true },
      })
    if (!entidad) return null

    const valorOriginal = tipo === 'vehiculo'
      ? (entidad as { placa: string }).placa
      : (entidad as { numero_identificacion: string | null }).numero_identificacion
    const normalizado = normalizarIdentificadorSimit(tipo, valorOriginal)
    const identificador = normalizado.identificador
    const consulta = await prisma.simit_consulta.create({
      data: {
        tipo_entidad: tipo,
        identificador: tipo === 'vehiculo'
          ? identificador || 'Sin placa'
          : mascaraDocumento(identificador || null),
        proveedor: 'fcm-portal-json',
        estado_consulta: normalizado.error ? 'error' : 'en_curso',
        error: normalizado.error,
        vehiculo_id: tipo === 'vehiculo' ? entidadId : null,
        conductor_id: tipo === 'conductor' ? entidadId : null,
      },
      select: { id: true, consultado_at: true },
    })
    const estadoInicial: EstadoConsultaIndividual = normalizado.error ? 'error' : 'en_curso'
    emitirConsultaSimitActualizada({
      tipo,
      entidad_id: entidadId,
      consulta_id: consulta.id,
      consultado_at: consulta.consultado_at.toISOString(),
      estado_consulta: estadoInicial,
    })

    return {
      consulta_id: consulta.id,
      estado_consulta: estadoInicial,
      promesa: normalizado.error
        ? Promise.resolve()
        : ejecutarConsultaIndividualSimit(tipo, entidadId, consulta.id, identificador),
    }
  })()

  consultasIndividualesActivas.set(clave, promesaInicio)
  try {
    const inicio = await promesaInicio
    if (!inicio || inicio.estado_consulta === 'error') {
      consultasIndividualesActivas.delete(clave)
      return inicio ? { ...inicio, yaEstabaEnCurso: false } : null
    }
    void inicio.promesa.finally(() => {
      if (consultasIndividualesActivas.get(clave) === promesaInicio) consultasIndividualesActivas.delete(clave)
    }).catch(() => undefined)
    return { ...inicio, yaEstabaEnCurso: false }
  } catch (error) {
    consultasIndividualesActivas.delete(clave)
    throw error
  }
}

/** Registros recientes que alimentan el aviso del dashboard y el cron diario. */
export async function estadoSimitDashboard() {
  const ahora = new Date()
  const [objetivos, programacion] = await Promise.all([objetivosSimit(), leerProgramacionSimit()])
  const idsVehiculos = objetivos.vehiculos.map((r) => r.id)
  const idsConductores = objetivos.conductores.map((r) => r.id)
  const [consultasVehiculos, consultasConductores] = await Promise.all([
    idsVehiculos.length ? prisma.simit_consulta.findMany({
      where: { vehiculo_id: { in: idsVehiculos } },
      orderBy: { consultado_at: 'desc' },
      distinct: ['vehiculo_id'],
      select: {
        vehiculo_id: true,
        id: true, tipo_entidad: true, identificador: true, proveedor: true, estado_consulta: true,
        comparendos: true, multas: true, acuerdos_pago: true, saldo_total: true,
        detalle: true, error: true, consultado_at: true,
      },
    }) : [],
    idsConductores.length ? prisma.simit_consulta.findMany({
      where: { conductor_id: { in: idsConductores } },
      orderBy: { consultado_at: 'desc' },
      distinct: ['conductor_id'],
      select: {
        conductor_id: true,
        id: true, tipo_entidad: true, identificador: true, proveedor: true, estado_consulta: true,
        comparendos: true, multas: true, acuerdos_pago: true, saldo_total: true,
        detalle: true, error: true, consultado_at: true,
      },
    }) : [],
  ])

  const porVehiculo = new Map(consultasVehiculos.flatMap((c) => c.vehiculo_id ? [[c.vehiculo_id, c] as const] : []))
  const porConductor = new Map(consultasConductores.flatMap((c) => c.conductor_id ? [[c.conductor_id, c] as const] : []))
  const mapea = (objetivo: ObjetivoSimit, consulta: ConsultaResumen | undefined) => ({
    id: objetivo.id,
    tipo: objetivo.tipo,
    nombre: objetivo.nombre,
    identificador: objetivo.tipo === 'vehiculo' ? objetivo.identificador : mascaraDocumento(objetivo.identificador),
    estado: consulta ? estadoConsultaEfectivo(consulta) : 'sin_consulta',
    ultimaConsulta: consulta?.consultado_at ?? null,
    comparendos: consulta?.comparendos ?? null,
    multas: consulta?.multas ?? null,
    acuerdosPago: consulta?.acuerdos_pago ?? null,
    saldoTotal: consulta?.saldo_total == null ? null : Number(consulta.saldo_total),
    error: consulta?.error ?? null,
    requiereAtencion: atencionRequerida(consulta, ahora.getTime(), programacion.cadaHoras),
    href: objetivo.tipo === 'vehiculo' ? `/dashboard/flota/${objetivo.id}?tab=simit` : `/dashboard/conductores/${objetivo.id}?tab=simit`,
  })
  const listaVehiculos = objetivos.vehiculos.map((ficha) => mapea(ficha, porVehiculo.get(ficha.id)))
  const listaConductores = objetivos.conductores.map((ficha) => mapea(ficha, porConductor.get(ficha.id)))
  const consultas = [...consultasVehiculos, ...consultasConductores]
  const todos = [...listaVehiculos, ...listaConductores]

  return {
    proveedorConfigurado: true,
    mensajeIntegracion: `Consultas automatizadas desde el portal público SIMIT con Chromium y lectura de la respuesta JSON. Cada ${programacion.cadaHoras} ${programacion.cadaHoras === 1 ? 'hora' : 'horas'} desde las ${programacion.horaInicio} (hora de Colombia).`,
    programacion,
    periodoDias: VENTANA_DIAS,
    resumen: {
      vehiculos: listaVehiculos.length,
      conductores: listaConductores.length,
      sinConsulta: todos.filter((r) => r.estado === 'sin_consulta').length,
      conDeuda: todos.filter((r) => r.estado === 'con_deuda' || (r.saldoTotal ?? 0) > 0).length,
      requierenAtencion: todos.filter((r) => r.requiereAtencion).length,
      ultimaConsulta: consultas.reduce<Date | null>((max, c) => !max || c.consultado_at > max ? c.consultado_at : max, null),
    },
    vehiculos: listaVehiculos,
    conductores: listaConductores,
  }
}

async function ejecutarLoteSimit(
  reportarProgreso: (procesados: number, total: number) => void,
): Promise<ResultadoLoteSimit> {
  const objetivos = await objetivosSimit()
  const lote = [...objetivos.vehiculos, ...objetivos.conductores]
  if (!lote.length) {
    reportarProgreso(0, 0)
    return { consultados: 0, omitidos: 0, errores: 0 }
  }
  /// Cada disparo del cron es una consulta nueva; deduplicar por día impediría cumplir frecuencias menores a 24 horas.
  const pendientes = lote.filter((r) => r.identificador)
  reportarProgreso(0, pendientes.length)
  if (!pendientes.length) return { consultados: 0, omitidos: lote.length, errores: 0 }

  const sesion = await iniciarSesionSimit()
  let errores = 0
  try {
    for (const [indice, objetivo] of pendientes.entries()) {
      let estado: 'sin_deuda' | 'con_deuda' | 'error' = 'error'
      let comparendos: number | null = null
      let multas: number | null = null
      let acuerdosPago: number | null = null
      let saldoTotal: number | null = null
      let detalle: Prisma.InputJsonValue | undefined
      let mensajeError: string | null = null

      try {
        const resultado = await sesion.consultar(objetivo.identificador)
        estado = resultado.estado_consulta
        comparendos = resultado.comparendos
        multas = resultado.multas
        acuerdosPago = resultado.acuerdos_pago
        saldoTotal = resultado.saldo_total
        detalle = serializarDetalleSimit(resultado.detalle)
      } catch (error) {
        errores++
        const mensaje = error instanceof Error ? error.message : 'Error al consultar SIMIT.'
        mensajeError = mensaje.replaceAll(objetivo.identificador, mascaraDocumento(objetivo.identificador)).slice(0, 500)
      }

      const consulta = await prisma.simit_consulta.create({
        data: {
          tipo_entidad: objetivo.tipo,
          identificador: objetivo.tipo === 'vehiculo' ? objetivo.identificador : mascaraDocumento(objetivo.identificador),
          proveedor: 'fcm-portal-json',
          estado_consulta: estado,
          comparendos,
          multas,
          acuerdos_pago: acuerdosPago,
          saldo_total: saldoTotal,
          detalle,
          error: mensajeError,
          vehiculo_id: objetivo.tipo === 'vehiculo' ? objetivo.id : null,
          conductor_id: objetivo.tipo === 'conductor' ? objetivo.id : null,
        },
      })
      await notificarPendientesSimit({
        tipo: objetivo.tipo,
        entidadId: objetivo.id,
        consultaId: consulta.id,
        estado,
        comparendos,
        multas,
        acuerdosPago,
        saldoTotal,
        consultadoAt: consulta.consultado_at,
      })
      emitirConsultaSimitActualizada({
        tipo: objetivo.tipo,
        entidad_id: objetivo.id,
        consulta_id: consulta.id,
        consultado_at: consulta.consultado_at.toISOString(),
        estado_consulta: estado,
      })

      reportarProgreso(indice + 1, pendientes.length)

      if (indice < pendientes.length - 1) await new Promise((resolve) => setTimeout(resolve, PAUSA_ENTRE_CONSULTAS_MS))
    }
  } finally {
    await sesion.cerrar()
  }

  return { consultados: pendientes.length, omitidos: lote.length - pendientes.length, errores }
}

function registrarEjecucion(origen: EjecucionSimit['origen']) {
  if (loteActivo) return { ...loteActivo, yaEstabaEnCurso: true }

  const estado: EjecucionSimit = {
    id: randomUUID(),
    estado: 'en_curso',
    origen,
    iniciadoAt: new Date().toISOString(),
    finalizadoAt: null,
    procesados: 0,
    total: 0,
    resultado: null,
    mensajeError: null,
  }
  ejecucionesSimit.set(estado.id, estado)
  while (ejecucionesSimit.size > 20) {
    const idMasAntiguo = ejecucionesSimit.keys().next().value
    if (!idMasAntiguo || idMasAntiguo === estado.id || ejecucionesSimit.get(idMasAntiguo)?.estado === 'en_curso') break
    ejecucionesSimit.delete(idMasAntiguo)
  }

  const promesa = ejecutarLoteSimit((procesados, total) => {
    estado.procesados = procesados
    estado.total = total
  }).then((resultado) => {
    estado.estado = 'completada'
    estado.resultado = resultado
    estado.finalizadoAt = new Date().toISOString()
    return resultado
  }).catch((error: unknown) => {
    estado.estado = 'error'
    estado.mensajeError = error instanceof Error ? error.message.slice(0, 500) : 'No se pudo completar la consulta SIMIT.'
    estado.finalizadoAt = new Date().toISOString()
    throw error
  }).finally(() => {
    if (loteActivo?.estado.id === estado.id) loteActivo = null
  })

  loteActivo = { estado, promesa }
  return { estado, promesa, yaEstabaEnCurso: false }
}

/** Inicia una consulta manual; si el cron ya está procesando, devuelve ese mismo lote. */
export function iniciarConsultaSimitAhora() {
  return registrarEjecucion('manual')
}

export function obtenerEjecucionSimit(id: string): EjecucionSimit | null {
  return ejecucionesSimit.get(id) ?? null
}

/** Ejecuta el lote en el horario configurado. */
export function consultarSimitProgramado(): Promise<ResultadoLoteSimit> {
  return registrarEjecucion('cron').promesa
}
