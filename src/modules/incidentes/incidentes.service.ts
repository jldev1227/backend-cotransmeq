/**
 * Accidentes, incidentes y casi-accidentes con su investigación.
 *
 * Reporte → investigación (Res. 1401/2007) → cierre, sobre `pesv_incident`
 * (ver en `schema.prisma` por qué se reutilizó). Las reglas puras —qué
 * transición vale, qué falta para cerrar, el plazo de 15 días— están en
 * `incidentes.dominio.ts`; aquí solo se leen y escriben filas.
 *
 * Las acciones correctivas NO se crean aquí: se delega en
 * `AccionesCorrectivasService.crear`, con la fuente «Investigación de
 * Incidente/Accidente», para que nazcan con el mismo flujo de aprobación y
 * seguimiento que cualquier otra. Aquí solo se guarda el vínculo.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import { emitNotificacion } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { AccionesCorrectivasService, siguienteNumeroAccion } from '../acciones-correctivas/acciones-correctivas.service'
import {
  areasAviso,
  codigoIncidente,
  consecutivoDeTexto,
  diasSinAccidentes,
  erroresDeGravedad,
  faltantesParaCerrar,
  fechaLimiteInvestigacion,
  hoyColombia,
  investigacionEditable,
  mesInicioVentana,
  plazoInvestigacion,
  reporteEditable,
  serieMensual,
  sumarDias,
  transicion,
  DIAS_PARA_INVESTIGAR,
  SEVERIDAD_LABEL,
  TIPO_LABEL,
  type EstadoIncidente,
  type MiembroEquipo,
  type Severidad,
  type TipoIncidente,
} from './incidentes.dominio'
import type { CrearAccion, CrearIncidente, FiltrosListado, Investigacion, Tercero } from './incidentes.schema'

/** Fuente con la que nacen las acciones: la misma etiqueta del catálogo del frontend. */
export const FUENTE_ACCION = 'Investigación de Incidente/Accidente'

export class IncidenteError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public detalles?: string[],
  ) {
    super(message)
  }
}

const noEncontrado = () => new IncidenteError(404, 'INCIDENTE_NO_ENCONTRADO', 'Incidente no encontrado')

/** `YYYY-MM-DD` de una columna `@db.Date` (llega a medianoche UTC). */
const isoDia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const aFecha = (s: string) => new Date(`${s}T00:00:00Z`)
const num = (d: Prisma.Decimal | number | null | undefined) => (d === null || d === undefined ? null : Number(d))

const SELECT_LISTA = {
  id: true,
  consecutivo: true,
  tipo: true,
  estado: true,
  fecha: true,
  hora: true,
  lugar: true,
  severidad: true,
  heridos: true,
  fallecidos: true,
  numero_informe: true,
  created_at: true,
  vehiculo: { select: { id: true, placa: true, marca: true, linea: true } },
  conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
  municipio: { select: { id: true, nombre_municipio: true, nombre_departamento: true } },
  _count: {
    select: {
      evidencias: { where: { deleted_at: null } },
      acciones: { where: { accion: { deleted_at: null } } },
    },
  },
} satisfies Prisma.pesv_incidentSelect

type FilaLista = Prisma.pesv_incidentGetPayload<{ select: typeof SELECT_LISTA }>

function serializarLista(f: FilaLista, hoy: string) {
  const fecha = isoDia(f.fecha)!
  return {
    id: f.id,
    codigo: codigoIncidente(f.consecutivo),
    consecutivo: f.consecutivo,
    tipo: f.tipo as TipoIncidente,
    estado: f.estado as EstadoIncidente,
    fecha,
    hora: f.hora,
    lugar: f.lugar,
    severidad: (f.severidad as Severidad | null) ?? null,
    heridos: f.heridos ?? 0,
    fallecidos: f.fallecidos ?? 0,
    numero_informe: f.numero_informe,
    vehiculo: f.vehiculo,
    conductor: f.conductor
      ? { id: f.conductor.id, nombre: `${f.conductor.nombre} ${f.conductor.apellido}`.trim(), documento: f.conductor.numero_identificacion }
      : null,
    municipio: f.municipio ? { id: f.municipio.id, nombre: f.municipio.nombre_municipio, departamento: f.municipio.nombre_departamento } : null,
    evidencias: f._count.evidencias,
    acciones: f._count.acciones,
    plazo: plazoInvestigacion({ estado: f.estado as EstadoIncidente, fecha }, hoy),
    created_at: f.created_at.toISOString(),
  }
}

const SELECT_DETALLE = {
  ...SELECT_LISTA,
  trayecto: true,
  tipo_evento: true,
  descripcion: true,
  servicio_id: true,
  terceros_involucrados: true,
  terceros_detalle: true,
  autoridad: true,
  costo_directo: true,
  costo_indirecto: true,
  investigacion_realizada: true,
  investigacion_iniciada_at: true,
  fecha_investigacion: true,
  equipo_investigador: true,
  actos_inseguros: true,
  condiciones_inseguras: true,
  factores_personales: true,
  factores_trabajo: true,
  analisis_porques: true,
  causas_identificadas: true,
  lecciones_aprendidas: true,
  fecha_cierre: true,
  responsable_cierre: true,
  observaciones_cierre: true,
  updated_at: true,
  servicio: {
    select: {
      id: true,
      origen_especifico: true,
      destino_especifico: true,
      fecha_solicitud: true,
      estado: true,
      clientes: { select: { id: true, nombre: true } },
    },
  },
  cliente: { select: { id: true, nombre: true } },
  registrado_por: { select: { id: true, nombre: true } },
  cerrado_por: { select: { id: true, nombre: true } },
  evidencias: {
    where: { deleted_at: null },
    orderBy: { created_at: 'asc' },
    select: {
      id: true,
      nombre_original: true,
      mimetype: true,
      tamano: true,
      descripcion: true,
      created_at: true,
      subido_por: { select: { nombre: true } },
    },
  },
  acciones: {
    where: { accion: { deleted_at: null } },
    orderBy: { created_at: 'asc' },
    select: {
      creada_desde_incidente: true,
      created_at: true,
      accion: {
        select: {
          id: true,
          accion_numero: true,
          descripcion_hallazgo: true,
          tipo_accion_ejecutar: true,
          estado_global: true,
          estado_aprobacion: true,
          fecha_identificacion_hallazgo: true,
        },
      },
    },
  },
} satisfies Prisma.pesv_incidentSelect

type FilaDetalle = Prisma.pesv_incidentGetPayload<{ select: typeof SELECT_DETALLE }>

const arreglo = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

function serializarDetalle(f: FilaDetalle, hoy: string) {
  const base = serializarLista(f, hoy)
  return {
    ...base,
    trayecto: f.trayecto,
    tipo_evento: f.tipo_evento,
    descripcion: f.descripcion,
    terceros: arreglo<Tercero>(f.terceros_detalle),
    autoridad: f.autoridad,
    costo_directo: num(f.costo_directo),
    costo_indirecto: num(f.costo_indirecto),
    servicio: f.servicio
      ? {
          id: f.servicio.id,
          ruta: `${f.servicio.origen_especifico} → ${f.servicio.destino_especifico}`,
          fecha: f.servicio.fecha_solicitud.toISOString(),
          estado: f.servicio.estado,
          cliente: f.servicio.clientes?.nombre ?? null,
        }
      : null,
    cliente: f.cliente,
    registrado_por: f.registrado_por,
    investigacion: {
      realizada: f.investigacion_realizada,
      iniciada_at: f.investigacion_iniciada_at?.toISOString() ?? null,
      fecha_investigacion: isoDia(f.fecha_investigacion),
      equipo_investigador: arreglo<MiembroEquipo>(f.equipo_investigador),
      actos_inseguros: f.actos_inseguros,
      condiciones_inseguras: f.condiciones_inseguras,
      factores_personales: f.factores_personales,
      factores_trabajo: f.factores_trabajo,
      analisis_porques: arreglo<string>(f.analisis_porques),
      causas_identificadas: f.causas_identificadas,
      lecciones_aprendidas: f.lecciones_aprendidas,
    },
    cierre: {
      fecha_cierre: isoDia(f.fecha_cierre),
      responsable_cierre: f.responsable_cierre,
      observaciones_cierre: f.observaciones_cierre,
      cerrado_por: f.cerrado_por,
    },
    evidencias: f.evidencias.map((e) => ({
      id: e.id,
      nombre: e.nombre_original,
      mimetype: e.mimetype,
      tamano: e.tamano,
      descripcion: e.descripcion,
      subido_por: e.subido_por?.nombre ?? null,
      created_at: e.created_at.toISOString(),
    })),
    acciones_vinculadas: f.acciones.map((a) => ({
      id: a.accion.id,
      numero: a.accion.accion_numero,
      descripcion: a.accion.descripcion_hallazgo,
      tipo: a.accion.tipo_accion_ejecutar,
      estado: a.accion.estado_global,
      aprobacion: a.accion.estado_aprobacion,
      creada_desde_incidente: a.creada_desde_incidente,
      vinculada_at: a.created_at.toISOString(),
    })),
    updated_at: f.updated_at.toISOString(),
  }
}

export type IncidenteDetalle = ReturnType<typeof serializarDetalle>

async function cargarParaEscribir(id: string) {
  const inc = await prisma.pesv_incident.findFirst({
    where: { id, deleted_at: null },
    select: {
      id: true,
      consecutivo: true,
      estado: true,
      fecha: true,
      tipo: true,
      lugar: true,
      fecha_investigacion: true,
      causas_identificadas: true,
      municipio: { select: { nombre_municipio: true } },
      vehiculo: { select: { placa: true } },
    },
  })
  if (!inc) throw noEncontrado()
  return { ...inc, estado: inc.estado as EstadoIncidente, fecha: isoDia(inc.fecha)! }
}

/**
 * Comprueba que lo referenciado exista y completa lo que se deduce del
 * servicio: si se eligió un servicio, de él salen el cliente y —si faltan—
 * el vehículo y el conductor.
 */
async function resolverReferencias(d: Pick<CrearIncidente, 'vehiculo_id' | 'conductor_id' | 'servicio_id' | 'municipio_id'>) {
  let vehiculo_id = d.vehiculo_id ?? null
  let conductor_id = d.conductor_id ?? null
  let cliente_id: string | null = null
  if (d.servicio_id) {
    const s = await prisma.servicio.findFirst({
      where: { id: d.servicio_id, deleted_at: null },
      select: { cliente_id: true, vehiculo_id: true, conductor_id: true },
    })
    if (!s) throw new IncidenteError(400, 'SERVICIO_INVALIDO', 'El servicio elegido no existe')
    cliente_id = s.cliente_id
    vehiculo_id ??= s.vehiculo_id
    conductor_id ??= s.conductor_id
  }
  const [vehiculo, conductor, municipio] = await Promise.all([
    vehiculo_id ? prisma.vehiculos.findFirst({ where: { id: vehiculo_id, deleted_at: null }, select: { id: true } }) : null,
    conductor_id ? prisma.conductores.findFirst({ where: { id: conductor_id, deleted_at: null }, select: { id: true } }) : null,
    d.municipio_id ? prisma.municipios.findUnique({ where: { id: d.municipio_id }, select: { id: true } }) : null,
  ])
  if (vehiculo_id && !vehiculo) throw new IncidenteError(400, 'VEHICULO_INVALIDO', 'El vehículo elegido no existe')
  if (conductor_id && !conductor) throw new IncidenteError(400, 'CONDUCTOR_INVALIDO', 'El conductor elegido no existe')
  if (d.municipio_id && !municipio) throw new IncidenteError(400, 'MUNICIPIO_INVALIDO', 'El municipio elegido no existe')
  return { vehiculo_id, conductor_id, cliente_id, servicio_id: d.servicio_id ?? null, municipio_id: d.municipio_id ?? null }
}

function validarGravedad(d: CrearIncidente, hoy: string) {
  const errores = erroresDeGravedad(
    { tipo: d.tipo, severidad: d.severidad ?? null, heridos: d.heridos, fallecidos: d.fallecidos, fecha: d.fecha },
    hoy,
  )
  if (errores.length) throw new IncidenteError(422, 'REPORTE_INCOHERENTE', errores[0], errores)
}

function datosDelReporte(d: CrearIncidente) {
  return {
    tipo: d.tipo,
    fecha: aFecha(d.fecha),
    hora: d.hora ?? null,
    lugar: d.lugar,
    trayecto: d.trayecto,
    tipo_evento: d.tipo_evento ?? null,
    descripcion: d.descripcion,
    severidad: d.tipo === 'CASI_ACCIDENTE' ? null : (d.severidad ?? null),
    heridos: d.heridos,
    fallecidos: d.fallecidos,
    terceros_detalle: d.terceros as unknown as Prisma.InputJsonValue,
    terceros_involucrados: d.terceros.length,
    autoridad: d.autoridad ?? null,
    numero_informe: d.numero_informe ?? null,
    costo_directo: d.costo_directo ?? null,
    costo_indirecto: d.costo_indirecto ?? null,
  }
}

const fechaLarga = (iso: string) =>
  new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(aFecha(iso))

/**
 * Avisa del reporte a HSEQ y administración (y a talento humano si hubo
 * lesionados). Quien reportó no se avisa a sí mismo. Un fallo aquí no tumba
 * el reporte: el accidente ya quedó registrado y eso es lo que importa.
 */
async function avisarReporte(id: string, actorId: string | null) {
  try {
    const inc = await prisma.pesv_incident.findUnique({
      where: { id },
      select: {
        id: true,
        consecutivo: true,
        tipo: true,
        fecha: true,
        hora: true,
        severidad: true,
        heridos: true,
        fallecidos: true,
        lugar: true,
        vehiculo: { select: { placa: true } },
        municipio: { select: { nombre_municipio: true } },
      },
    })
    if (!inc) return
    const fecha = isoDia(inc.fecha)!
    const severidad = (inc.severidad as Severidad | null) ?? null
    const areas = areasAviso({ severidad, heridos: inc.heridos, fallecidos: inc.fallecidos })
    const tipo = inc.tipo as TipoIncidente
    const grave = severidad === 'LESION_GRAVE' || severidad === 'FATALIDAD'
    const titulo = `${grave || tipo === 'ACCIDENTE_TRANSITO' ? '⚠️ ' : ''}${TIPO_LABEL[tipo]} · ${codigoIncidente(inc.consecutivo)}${inc.vehiculo ? ` · ${inc.vehiculo.placa}` : ''}`
    const victimas = [
      inc.heridos ? `${inc.heridos} lesionado${inc.heridos === 1 ? '' : 's'}` : null,
      inc.fallecidos ? `${inc.fallecidos} fallecido${inc.fallecidos === 1 ? '' : 's'}` : null,
    ].filter(Boolean)
    const donde = [inc.lugar, inc.municipio?.nombre_municipio].filter(Boolean).join(', ')
    const mensaje =
      `${fechaLarga(fecha)}${inc.hora ? ` a las ${inc.hora}` : ''} · ${donde}. ` +
      `${severidad ? SEVERIDAD_LABEL[severidad] : 'Sin daños ni lesiones'}${victimas.length ? ` (${victimas.join(', ')})` : ''}. ` +
      `Hay que investigarlo antes del ${fechaLarga(fechaLimiteInvestigacion(fecha))}.`

    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { hasSome: areas }, ...(actorId ? { id: { not: actorId } } : {}) },
      select: { id: true },
    })
    for (const u of usuarios) {
      const n = await NotificacionesService.crear({
        usuario_id: u.id,
        tipo: 'GENERAL',
        titulo: titulo.slice(0, 255),
        mensaje,
        referencia_id: inc.id,
        referencia_tipo: 'incidente',
      })
      emitNotificacion(n)
    }
  } catch (error) {
    console.error('[incidentes] No se pudo avisar el reporte', error)
  }
}

export const IncidentesService = {
  async listar(f: FiltrosListado) {
    const hoy = hoyColombia()
    const where: Prisma.pesv_incidentWhereInput = { deleted_at: null }
    if (f.tipo) where.tipo = f.tipo
    if (f.severidad) where.severidad = f.severidad
    if (f.desde || f.hasta) where.fecha = { ...(f.desde ? { gte: aFecha(f.desde) } : {}), ...(f.hasta ? { lte: aFecha(f.hasta) } : {}) }
    if (f.plazo === 'vencido') {
      /// Vencido = sin cerrar y con más de 15 días desde el evento.
      where.estado = { not: 'CERRADO' }
      where.fecha = { ...(where.fecha as object), lt: aFecha(sumarDias(hoy, -DIAS_PARA_INVESTIGAR)) }
    } else if (f.estado) where.estado = f.estado
    if (f.q) {
      const q = f.q
      const consecutivo = consecutivoDeTexto(q)
      where.OR = [
        ...(consecutivo !== null ? [{ consecutivo }] : []),
        { lugar: { contains: q, mode: 'insensitive' } },
        { descripcion: { contains: q, mode: 'insensitive' } },
        { numero_informe: { contains: q, mode: 'insensitive' } },
        { vehiculo: { placa: { contains: q.replace(/\s|-/g, ''), mode: 'insensitive' } } },
        { conductor: { OR: [{ nombre: { contains: q, mode: 'insensitive' } }, { apellido: { contains: q, mode: 'insensitive' } }, { numero_identificacion: { contains: q } }] } },
        { municipio: { nombre_municipio: { contains: q, mode: 'insensitive' } } },
      ]
    }

    /// El resumen cuenta TODO lo vigente, no lo filtrado: son las pastillas de
    /// la cabecera, el estado del módulo y no del filtro puesto.
    const [total, filas, porEstado, vencidos] = await Promise.all([
      prisma.pesv_incident.count({ where }),
      prisma.pesv_incident.findMany({
        where,
        select: SELECT_LISTA,
        orderBy: [{ fecha: 'desc' }, { consecutivo: 'desc' }],
        skip: (f.page - 1) * f.limit,
        take: f.limit,
      }),
      prisma.pesv_incident.groupBy({ by: ['estado'], where: { deleted_at: null }, _count: { _all: true } }),
      prisma.pesv_incident.count({
        where: { deleted_at: null, estado: { not: 'CERRADO' }, fecha: { lt: aFecha(sumarDias(hoy, -DIAS_PARA_INVESTIGAR)) } },
      }),
    ])
    const estados = Object.fromEntries(porEstado.map((g) => [g.estado, g._count._all])) as Partial<Record<EstadoIncidente, number>>
    return {
      items: filas.map((x) => serializarLista(x, hoy)),
      pagination: { page: f.page, limit: f.limit, total, pages: Math.max(1, Math.ceil(total / f.limit)) },
      resumen: {
        total: (estados.REPORTADO ?? 0) + (estados.EN_INVESTIGACION ?? 0) + (estados.CERRADO ?? 0),
        REPORTADO: estados.REPORTADO ?? 0,
        EN_INVESTIGACION: estados.EN_INVESTIGACION ?? 0,
        CERRADO: estados.CERRADO ?? 0,
        vencidos,
      },
    }
  },

  async detalle(id: string) {
    const f = await prisma.pesv_incident.findFirst({ where: { id, deleted_at: null }, select: SELECT_DETALLE })
    if (!f) throw noEncontrado()
    return serializarDetalle(f, hoyColombia())
  },

  async crear(d: CrearIncidente, usuarioId: string | null) {
    validarGravedad(d, hoyColombia())
    const refs = await resolverReferencias(d)
    const creado = await prisma.pesv_incident.create({
      data: { id: randomUUID(), ...datosDelReporte(d), ...refs, registrado_por_id: usuarioId },
      select: { id: true },
    })
    await avisarReporte(creado.id, usuarioId)
    return this.detalle(creado.id)
  },

  async editar(id: string, d: CrearIncidente) {
    const actual = await cargarParaEscribir(id)
    if (!reporteEditable(actual.estado)) {
      throw new IncidenteError(409, 'INCIDENTE_CERRADO', 'El incidente está cerrado: reábrelo para corregir el reporte')
    }
    validarGravedad(d, hoyColombia())
    /// La fecha no puede quedar después de una investigación ya fechada.
    const fInv = isoDia(actual.fecha_investigacion)
    if (fInv && d.fecha > fInv) {
      throw new IncidenteError(422, 'REPORTE_INCOHERENTE', 'La fecha del evento quedaría después de la investigación')
    }
    const refs = await resolverReferencias(d)
    await prisma.pesv_incident.update({ where: { id }, data: { ...datosDelReporte(d), ...refs } })
    return this.detalle(id)
  },

  async guardarInvestigacion(id: string, inv: Investigacion) {
    const actual = await cargarParaEscribir(id)
    if (!investigacionEditable(actual.estado)) {
      throw new IncidenteError(
        409,
        'INVESTIGACION_NO_ABIERTA',
        actual.estado === 'REPORTADO' ? 'Primero inicia la investigación' : 'El incidente está cerrado: reábrelo para editar la investigación',
      )
    }
    const hoy = hoyColombia()
    if (inv.fecha_investigacion && inv.fecha_investigacion < actual.fecha) {
      throw new IncidenteError(422, 'FECHA_INVALIDA', 'La investigación no puede ser anterior al evento')
    }
    if (inv.fecha_investigacion && inv.fecha_investigacion > hoy) {
      throw new IncidenteError(422, 'FECHA_INVALIDA', 'La fecha de la investigación no puede ser futura')
    }
    await prisma.pesv_incident.update({
      where: { id },
      data: {
        fecha_investigacion: inv.fecha_investigacion ? aFecha(inv.fecha_investigacion) : null,
        equipo_investigador: inv.equipo_investigador as unknown as Prisma.InputJsonValue,
        actos_inseguros: inv.actos_inseguros ?? null,
        condiciones_inseguras: inv.condiciones_inseguras ?? null,
        factores_personales: inv.factores_personales ?? null,
        factores_trabajo: inv.factores_trabajo ?? null,
        analisis_porques: inv.analisis_porques as unknown as Prisma.InputJsonValue,
        causas_identificadas: inv.causas_identificadas ?? null,
        lecciones_aprendidas: inv.lecciones_aprendidas ?? null,
      },
    })
    return this.detalle(id)
  },

  /**
   * Cambia el estado. La escritura condiciona sobre el estado de origen
   * (`updateMany where estado = desde`): si dos personas pulsan a la vez, la
   * segunda recibe 409 en vez de cerrar dos veces o reabrir lo recién cerrado.
   */
  async cambiarEstado(
    id: string,
    accion: 'iniciar_investigacion' | 'cerrar' | 'reabrir',
    cierre: { fecha_cierre?: string | null; responsable_cierre?: string | null; observaciones_cierre?: string | null },
    usuarioId: string | null,
  ) {
    const actual = await cargarParaEscribir(id)
    const t = transicion(actual.estado, accion)
    if (!t.ok) throw new IncidenteError(409, 'TRANSICION_INVALIDA', t.motivo)
    const hoy = hoyColombia()
    /// `Unchecked`: el tipo «checked» de `updateMany` no admite llaves foráneas sueltas (`cerrado_por_id`).
    let data: Prisma.pesv_incidentUncheckedUpdateManyInput = { estado: t.hacia }

    if (accion === 'iniciar_investigacion') {
      data = { ...data, investigacion_iniciada_at: new Date(), fecha_investigacion: actual.fecha_investigacion ?? aFecha(hoy) }
    } else if (accion === 'cerrar') {
      const completo = await prisma.pesv_incident.findUniqueOrThrow({ where: { id }, select: SELECT_DETALLE })
      const inv = serializarDetalle(completo, hoy).investigacion
      const faltan = faltantesParaCerrar(actual.fecha, inv, { fecha_cierre: cierre.fecha_cierre ?? null, responsable_cierre: cierre.responsable_cierre ?? null }, hoy)
      if (faltan.length) {
        throw new IncidenteError(422, 'INVESTIGACION_INCOMPLETA', `Falta para cerrar: ${faltan.join(', ')}`, faltan)
      }
      data = {
        ...data,
        investigacion_realizada: true,
        fecha_cierre: aFecha(cierre.fecha_cierre!),
        responsable_cierre: cierre.responsable_cierre!,
        observaciones_cierre: cierre.observaciones_cierre ?? null,
        cerrado_por_id: usuarioId,
      }
    } else {
      /// Reabrir borra el cierre: un incidente reabierto con «cerrado el 3 de
      /// octubre por X» a la vista se leería como cerrado.
      data = { ...data, investigacion_realizada: false, fecha_cierre: null, responsable_cierre: null, observaciones_cierre: null, cerrado_por_id: null }
    }

    const r = await prisma.pesv_incident.updateMany({ where: { id, deleted_at: null, estado: t.desde }, data })
    if (r.count === 0) throw new IncidenteError(409, 'TRANSICION_INVALIDA', 'Otra persona cambió el estado: recarga para ver el actual')
    return this.detalle(id)
  },

  /** Borrado lógico del reporte. Sus evidencias y vínculos quedan: se leen a través de él. */
  async eliminar(id: string) {
    const r = await prisma.pesv_incident.updateMany({ where: { id, deleted_at: null }, data: { deleted_at: new Date() } })
    if (r.count === 0) throw noEncontrado()
  },

  // ── Evidencias ──

  async subirEvidencia(id: string, archivo: { buffer: Buffer; nombre: string; mimetype: string }, descripcion: string | null, usuarioId: string | null) {
    const actual = await cargarParaEscribir(id)
    if (!reporteEditable(actual.estado)) {
      throw new IncidenteError(409, 'INCIDENTE_CERRADO', 'El incidente está cerrado: reábrelo para añadir evidencias')
    }
    const evId = randomUUID()
    const ext = (path.extname(archivo.nombre) || (archivo.mimetype === 'application/pdf' ? '.pdf' : '.jpg')).toLowerCase()
    const s3Key = `incidentes/${id}/evidencias/${evId}${ext}`
    await uploadToS3(s3Key, archivo.buffer, archivo.mimetype)
    await prisma.incidente_evidencias.create({
      data: {
        id: evId,
        incidente_id: id,
        s3_key: s3Key,
        nombre_original: archivo.nombre.slice(0, 255),
        mimetype: archivo.mimetype,
        tamano: archivo.buffer.length,
        descripcion: descripcion?.slice(0, 500) || null,
        subido_por_id: usuarioId,
      },
    })
    return { id: evId, s3_key: s3Key }
  },

  async urlEvidencia(id: string, evId: string) {
    const ev = await prisma.incidente_evidencias.findFirst({
      where: { id: evId, incidente_id: id, deleted_at: null, incidente: { deleted_at: null } },
      select: { s3_key: true },
    })
    if (!ev) throw new IncidenteError(404, 'EVIDENCIA_NO_ENCONTRADA', 'Evidencia no encontrada')
    return getS3SignedUrl(ev.s3_key, 15 * 60)
  },

  /** Borrado lógico: el objeto de S3 se queda (es la evidencia de un accidente). */
  async eliminarEvidencia(id: string, evId: string) {
    const actual = await cargarParaEscribir(id)
    if (!reporteEditable(actual.estado)) {
      throw new IncidenteError(409, 'INCIDENTE_CERRADO', 'El incidente está cerrado: reábrelo para quitar evidencias')
    }
    const r = await prisma.incidente_evidencias.updateMany({ where: { id: evId, incidente_id: id, deleted_at: null }, data: { deleted_at: new Date() } })
    if (r.count === 0) throw new IncidenteError(404, 'EVIDENCIA_NO_ENCONTRADA', 'Evidencia no encontrada')
  },

  // ── Acciones correctivas ──

  /**
   * Crea la acción en el módulo de acciones correctivas y la vincula. El
   * número sale de la misma numeración `AC-<año>-<n>` que usa el asistente.
   * Si el vínculo fallara, la acción recién creada se retira: una acción
   * huérfana que dice venir de una investigación sin investigación detrás
   * confunde más que el error.
   */
  async crearAccion(id: string, d: CrearAccion, usuarioId: string | null) {
    const inc = await cargarParaEscribir(id)
    if (!investigacionEditable(inc.estado)) {
      throw new IncidenteError(409, 'INVESTIGACION_NO_ABIERTA', 'Las acciones se registran con la investigación abierta')
    }
    const hoy = hoyColombia()
    let numero = d.accion_numero ?? null
    if (numero) {
      const ocupado = await prisma.acciones_correctivas_preventivas.findUnique({ where: { accion_numero: numero }, select: { id: true } })
      if (ocupado) throw new IncidenteError(409, 'NUMERO_OCUPADO', `Ya existe una acción con el número ${numero}`)
    } else {
      numero = await siguienteNumeroAccion(hoy.slice(0, 4))
    }
    const codigo = codigoIncidente(inc.consecutivo)
    const servicioAcciones = new AccionesCorrectivasService()
    const accion = await servicioAcciones.crear({
      accion_numero: numero,
      descripcion_hallazgo: d.descripcion_hallazgo,
      fuente_genero_hallazgo: FUENTE_ACCION,
      proceso_origen_hallazgo: 'Gestión HSEQ',
      componente_elemento_referencia: `Investigación ${codigo}`,
      marco_legal_normativo: 'Res. 1401 de 2007 (investigación de incidentes y accidentes); Res. 40595 de 2022 (PESV)',
      lugar_sede: [inc.lugar, inc.municipio?.nombre_municipio].filter(Boolean).join(', ') || undefined,
      fecha_identificacion_hallazgo: isoDia(inc.fecha_investigacion) ?? hoy,
      tipo_hallazgo_detectado: d.tipo_hallazgo_detectado ?? undefined,
      tipo_accion_ejecutar: d.tipo_accion_ejecutar,
      valoracion_riesgo: d.valoracion_riesgo ?? undefined,
      causas: d.plan_accion
        ? [
            {
              orden: 1,
              analisis_causa: inc.causas_identificadas?.trim() || `Causa identificada en la investigación ${codigo}`,
              es_causa_raiz: !!inc.causas_identificadas?.trim(),
              descripcion_plan_accion: d.plan_accion,
              responsable_ejecucion: d.responsable_ejecucion ?? undefined,
              fecha_limite_implementacion: d.fecha_limite_implementacion ?? undefined,
              estado_seguimiento: 'En Proceso',
            },
          ]
        : undefined,
      creado_por_id: usuarioId ?? undefined,
    })
    try {
      await prisma.incidente_acciones.create({ data: { incidente_id: id, accion_id: accion.id, creada_desde_incidente: true } })
    } catch (error) {
      await prisma.acciones_correctivas_preventivas.update({ where: { id: accion.id }, data: { deleted_at: new Date() } }).catch(() => {})
      throw error
    }
    return this.detalle(id)
  },

  async vincularAccion(id: string, accionId: string) {
    const inc = await cargarParaEscribir(id)
    if (!investigacionEditable(inc.estado)) {
      throw new IncidenteError(409, 'INVESTIGACION_NO_ABIERTA', 'Las acciones se vinculan con la investigación abierta')
    }
    const accion = await prisma.acciones_correctivas_preventivas.findFirst({ where: { id: accionId, deleted_at: null }, select: { id: true } })
    if (!accion) throw new IncidenteError(404, 'ACCION_NO_ENCONTRADA', 'Acción correctiva no encontrada')
    /// Idempotente: vincular dos veces la misma acción no es un error.
    await prisma.incidente_acciones.upsert({
      where: { incidente_id_accion_id: { incidente_id: id, accion_id: accionId } },
      create: { incidente_id: id, accion_id: accionId, creada_desde_incidente: false },
      update: {},
    })
    return this.detalle(id)
  },

  async desvincularAccion(id: string, accionId: string) {
    const inc = await cargarParaEscribir(id)
    if (!investigacionEditable(inc.estado)) {
      throw new IncidenteError(409, 'INVESTIGACION_NO_ABIERTA', 'Las acciones se desvinculan con la investigación abierta')
    }
    await prisma.incidente_acciones.deleteMany({ where: { incidente_id: id, accion_id: accionId } })
    return this.detalle(id)
  },

  /** Acciones vigentes para vincular, sin las que ya están vinculadas. */
  async buscarAcciones(id: string, q: string) {
    await cargarParaEscribir(id)
    const texto = q.trim()
    const filas = await prisma.acciones_correctivas_preventivas.findMany({
      where: {
        deleted_at: null,
        incidentes: { none: { incidente_id: id } },
        ...(texto
          ? { OR: [{ accion_numero: { contains: texto, mode: 'insensitive' } }, { descripcion_hallazgo: { contains: texto, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: { id: true, accion_numero: true, descripcion_hallazgo: true, estado_global: true, fuente_genero_hallazgo: true },
    })
    return filas.map((a) => ({
      id: a.id,
      numero: a.accion_numero,
      descripcion: a.descripcion_hallazgo,
      estado: a.estado_global,
      fuente: a.fuente_genero_hallazgo,
    }))
  },

  // ── Catálogos para el formulario ──

  /**
   * Vehículos y conductores para el reporte. Propio del módulo para no
   * depender de los permisos de servicios: HSEQ reporta accidentes aunque no
   * despache servicios.
   */
  async opciones() {
    const [vehiculos, conductores] = await Promise.all([
      prisma.vehiculos.findMany({
        where: { deleted_at: null },
        select: { id: true, placa: true, marca: true, linea: true },
        orderBy: { placa: 'asc' },
      }),
      prisma.conductores.findMany({
        where: { deleted_at: null },
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
    ])
    return {
      vehiculos,
      conductores: conductores.map((c) => ({ id: c.id, nombre: `${c.nombre} ${c.apellido}`.trim(), documento: c.numero_identificacion })),
    }
  },

  /** Servicios de ese vehículo o conductor alrededor de la fecha (±1 día), para enlazar el reporte. */
  async serviciosCandidatos(p: { fecha: string; vehiculo_id?: string | null; conductor_id?: string | null }) {
    if (!p.vehiculo_id && !p.conductor_id) return []
    const filas = await prisma.servicio.findMany({
      where: {
        deleted_at: null,
        OR: [...(p.vehiculo_id ? [{ vehiculo_id: p.vehiculo_id }] : []), ...(p.conductor_id ? [{ conductor_id: p.conductor_id }] : [])],
        fecha_solicitud: { gte: new Date(`${sumarDias(p.fecha, -1)}T00:00:00-05:00`), lt: new Date(`${sumarDias(p.fecha, 2)}T00:00:00-05:00`) },
      },
      orderBy: { fecha_solicitud: 'asc' },
      take: 20,
      select: {
        id: true,
        origen_especifico: true,
        destino_especifico: true,
        fecha_solicitud: true,
        estado: true,
        clientes: { select: { nombre: true } },
        vehiculos: { select: { placa: true } },
      },
    })
    return filas.map((s) => ({
      id: s.id,
      ruta: `${s.origen_especifico} → ${s.destino_especifico}`,
      fecha: s.fecha_solicitud.toISOString(),
      estado: s.estado,
      cliente: s.clientes?.nombre ?? null,
      placa: s.vehiculos?.placa ?? null,
    }))
  },

  // ── Indicadores ──

  /**
   * Indicadores básicos de siniestralidad.
   *
   * Lo que NO se calcula: accidentes por cada 100.000 km. El kilometraje de
   * la flota no es confiable todavía — `vehiculos.kilometraje` solo lo tiene
   * una docena de placas, y los `km_inicial`/`km_final` de los
   * preoperacionales cubren pocas placas y traen saltos imposibles (decenas
   * de miles de km en días, un dedo de más). Una tasa sobre ese denominador
   * saldría muy alta o muy baja según qué placa se equivoque, así que se
   * devuelve `null` con el motivo en vez de una cifra engañosa.
   */
  async indicadores(meses: number) {
    const hoy = hoyColombia()
    const desdeMes = mesInicioVentana(hoy, meses)
    const desde = aFecha(`${desdeMes}-01`)
    const [eventos, ultimoAccidente, primero, abiertos, cerrados] = await Promise.all([
      prisma.pesv_incident.findMany({
        where: { deleted_at: null, fecha: { gte: desde } },
        select: { fecha: true, tipo: true, severidad: true, heridos: true, fallecidos: true, costo_directo: true, costo_indirecto: true },
      }),
      prisma.pesv_incident.findFirst({
        where: { deleted_at: null, tipo: 'ACCIDENTE_TRANSITO' },
        orderBy: { fecha: 'desc' },
        select: { fecha: true },
      }),
      prisma.pesv_incident.findFirst({ where: { deleted_at: null }, orderBy: { fecha: 'asc' }, select: { fecha: true } }),
      prisma.pesv_incident.findMany({ where: { deleted_at: null, estado: { not: 'CERRADO' } }, select: { fecha: true, estado: true } }),
      prisma.pesv_incident.findMany({
        where: { deleted_at: null, estado: 'CERRADO', fecha: { gte: desde } },
        select: { fecha: true, fecha_cierre: true },
      }),
    ])
    const filas = eventos.map((e) => ({ ...e, fecha: isoDia(e.fecha)!, tipo: e.tipo as TipoIncidente }))
    const porGravedad: Record<Severidad | 'SIN_LESION', number> = { SOLO_DANOS: 0, LESION_LEVE: 0, LESION_GRAVE: 0, FATALIDAD: 0, SIN_LESION: 0 }
    for (const e of filas) porGravedad[(e.severidad as Severidad | null) ?? 'SIN_LESION']++
    const vencidas = abiertos.filter((a) => plazoInvestigacion({ estado: a.estado as EstadoIncidente, fecha: isoDia(a.fecha)! }, hoy).vencido).length
    const aTiempo = cerrados.filter((c) => c.fecha_cierre && isoDia(c.fecha_cierre)! <= fechaLimiteInvestigacion(isoDia(c.fecha)!)).length

    return {
      hoy,
      desde: `${desdeMes}-01`,
      meses,
      serie: serieMensual(filas, desdeMes, hoy.slice(0, 7)),
      dias_sin_accidentes: diasSinAccidentes(isoDia(ultimoAccidente?.fecha), hoy),
      ultimo_accidente: isoDia(ultimoAccidente?.fecha),
      /// Sin accidentes nunca, los días «sin accidentes» se cuentan desde el primer registro.
      registro_desde: isoDia(primero?.fecha),
      totales: {
        eventos: filas.length,
        accidentes: filas.filter((e) => e.tipo === 'ACCIDENTE_TRANSITO').length,
        incidentes: filas.filter((e) => e.tipo === 'INCIDENTE').length,
        casi_accidentes: filas.filter((e) => e.tipo === 'CASI_ACCIDENTE').length,
        lesionados: filas.reduce((s, e) => s + (e.heridos ?? 0), 0),
        fallecidos: filas.reduce((s, e) => s + (e.fallecidos ?? 0), 0),
        costo_estimado: filas.reduce((s, e) => s + (num(e.costo_directo) ?? 0) + (num(e.costo_indirecto) ?? 0), 0),
      },
      por_gravedad: porGravedad,
      investigacion: {
        abiertas: abiertos.length,
        vencidas,
        cerradas: cerrados.length,
        cerradas_a_tiempo: aTiempo,
      },
      por_100k_km: null,
      motivo_sin_km: 'El kilometraje de la flota todavía no es confiable (pocas placas lo reportan y hay saltos imposibles), así que no se calcula la tasa por 100.000 km.',
    }
  },
}
