import { prisma } from '../../config/prisma'
import { emitNotificacion } from '../../sockets'
import { logger } from '../../utils/logger'
import { puedeOperarModuloParaAvisos } from '../notificaciones/permisos-notificaciones'

/**
 * Avisos al equipo administrativo de cosas que pasan en la operación: un servicio nuevo, un
 * preoperacional que diligenció un conductor, un día laborado que registró. Llegan a la campana de
 * la web y a «Notificaciones» de la app de gestión (la misma tabla `notificacion`, por socket).
 *
 * A quién le llega cada uno:
 * - `servicio_creado`: a todos los que pueden ver Servicios, menos a quien lo creó.
 * - `preoperacional`: operaciones, HSEQ y administración.
 * - `dias_laborados`: operaciones, talento humano y administración.
 * - `fuec_creado`: operaciones con acceso a Extractos, incluido quien lo emitió.
 *
 * Nunca lanza: el aviso es un efecto secundario y no debe tumbar lo que lo provocó.
 */

export type EventoEquipo = 'servicio_creado' | 'preoperacional' | 'dias_laborados' | 'fuec_creado'

const AREAS: Record<Exclude<EventoEquipo, 'servicio_creado'>, string[]> = {
  preoperacional: ['operaciones', 'hseq', 'administracion'],
  dias_laborados: ['operaciones', 'talento_humano', 'administracion'],
  fuec_creado: ['operaciones'],
}

const MODULO_POR_EVENTO: Record<EventoEquipo, string> = {
  servicio_creado: 'servicios',
  preoperacional: 'formularios',
  dias_laborados: 'recorridos',
  fuec_creado: 'extractos',
}

async function destinatarios(evento: EventoEquipo, excluir?: string | null): Promise<string[]> {
  const usuarios = await prisma.usuarios.findMany({
    where: { activo: true, ...(excluir ? { id: { not: excluir } } : {}) },
    select: { id: true, area: true, permisos_rutas: true },
  })
  return usuarios
    .filter((u) => {
      if (!puedeOperarModuloParaAvisos(u, MODULO_POR_EVENTO[evento])) return false
      if (evento === 'servicio_creado') return true
      const areas = AREAS[evento]
      return (u.area ?? []).some((area) => areas.includes(area))
    })
    .map((u) => u.id)
}

/** Desprendible disponible: aviso web al equipo de nómina, separado del inbox móvil del conductor. */
export async function avisarDesprendibleEquipo(params: {
  liquidacionId: string
  nombreConductor: string
  periodo: string
  anio: number
  mes: number
}): Promise<void> {
  try {
    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true },
      select: { id: true, area: true, permisos_rutas: true },
    })
    const ids = usuarios.filter((usuario) => {
      const areas = Array.isArray(usuario.area) ? usuario.area : []
      if (!areas.some((area) => area === 'administracion' || area === 'talento_humano')) return false
      return puedeOperarModuloParaAvisos(usuario, 'nomina')
    }).map((usuario) => usuario.id)
    if (!ids.length) return

    const creadas = await prisma.notificacion.createManyAndReturn({
      data: ids.map((usuario_id) => ({
        usuario_id,
        tipo: 'GENERAL' as const,
        titulo: `Desprendible disponible: ${params.nombreConductor}`.slice(0, 255),
        mensaje: `${params.nombreConductor} ya tiene disponible su desprendible de nómina de ${params.periodo}.`,
        referencia_id: params.liquidacionId,
        referencia_tipo: `nomina_desprendible_disponible:${params.anio}:${params.mes}`,
      })),
    })
    for (const notificacion of creadas) emitNotificacion(notificacion)
  } catch (error) {
    logger.error({ err: error, liquidacionId: params.liquidacionId }, 'No se pudo avisar al equipo del desprendible disponible')
  }
}

export async function avisarEquipo(params: {
  evento: EventoEquipo
  /** Quien lo provocó, si es un usuario del dashboard: no se avisa a sí mismo. */
  excluirUsuarioId?: string | null
  titulo: string
  mensaje: string
  referencia_id: string
  /** Lo usa la web (y la app) para saber qué abrir al tocar el aviso. */
  referencia_tipo: string
}): Promise<void> {
  try {
    const ids = await destinatarios(params.evento, params.excluirUsuarioId)
    if (!ids.length) return
    const creadas = await prisma.notificacion.createManyAndReturn({
      data: ids.map((usuario_id) => ({
        usuario_id,
        tipo: 'GENERAL' as const,
        titulo: params.titulo.slice(0, 255),
        mensaje: params.mensaje,
        referencia_id: params.referencia_id,
        referencia_tipo: params.referencia_tipo,
      })),
    })
    for (const n of creadas) emitNotificacion(n)
  } catch (error) {
    logger.error({ err: error, evento: params.evento, referencia: params.referencia_id }, 'No se pudo avisar al equipo')
  }
}

const fechaCorta = (d: Date) => d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'America/Bogota' })

/** Servicio recién creado (web, app de gestión o asistente). */
export async function avisarServicioCreado(servicioId: string, creadorId?: string | null) {
  try {
    const s = await prisma.servicio.findUnique({
      where: { id: servicioId },
      select: {
        fecha_realizacion: true,
        fecha_solicitud: true,
        clientes: { select: { nombre: true } },
        municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
        municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } },
        creado_por: { select: { nombre: true } },
      },
    })
    if (!s) return
    const ruta = `${s.municipios_servicio_origen_idTomunicipios?.nombre_municipio ?? '—'} → ${s.municipios_servicio_destino_idTomunicipios?.nombre_municipio ?? '—'}`
    const cuando = fechaCorta(s.fecha_realizacion ?? s.fecha_solicitud)
    await avisarEquipo({
      evento: 'servicio_creado',
      excluirUsuarioId: creadorId,
      titulo: `Nuevo servicio ${ruta}`,
      mensaje: `${s.creado_por?.nombre ?? 'Alguien'} creó un servicio para ${s.clientes?.nombre?.trim() ?? 'un cliente'} el ${cuando}.`,
      referencia_id: servicioId,
      referencia_tipo: 'servicio',
    })
  } catch (error) {
    logger.error({ err: error, servicioId }, 'No se pudo avisar el servicio creado')
  }
}

/** Envío de un formulario por un conductor: solo avisa si es un preoperacional. */
export async function avisarPreoperacional(submissionId: string) {
  try {
    const envio = await prisma.form_submission.findUnique({
      where: { id: submissionId },
      select: {
        version: { select: { title: true, form: { select: { name: true } } } },
        conductor: { select: { nombre: true, apellido: true } },
        vehiculo: { select: { placa: true } },
      },
    })
    if (!envio) return
    const nombreFormulario = envio.version.form.name || envio.version.title
    if (!/preoperacional/i.test(`${nombreFormulario} ${envio.version.title}`)) return
    const conductor = envio.conductor ? `${envio.conductor.nombre} ${envio.conductor.apellido}`.trim() : 'Un conductor'
    await avisarEquipo({
      evento: 'preoperacional',
      titulo: `Preoperacional de ${conductor}`,
      mensaje: `${conductor} diligenció el preoperacional${envio.vehiculo?.placa ? ` del vehículo ${envio.vehiculo.placa}` : ''}.`,
      referencia_id: submissionId,
      referencia_tipo: 'preoperacional',
    })
  } catch (error) {
    logger.error({ err: error, submissionId }, 'No se pudo avisar el preoperacional')
  }
}

const TIPO_DIA: Record<string, string> = {
  LABORADO: 'un día laborado',
  DISPONIBLE: 'un día disponible',
  DESCANSO: 'un descanso',
  MANTENIMIENTO: 'un día de mantenimiento',
}

/** Día registrado por primera vez por un conductor (las correcciones del mismo día no avisan). */
export async function avisarDiaLaborado(conductorId: string, fecha: string, tipo: string) {
  try {
    const c = await prisma.conductores.findUnique({ where: { id: conductorId }, select: { nombre: true, apellido: true } })
    const conductor = c ? `${c.nombre} ${c.apellido}`.trim() : 'Un conductor'
    const dia = new Date(`${fecha}T12:00:00Z`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' })
    await avisarEquipo({
      evento: 'dias_laborados',
      titulo: `Días laborados de ${conductor}`,
      mensaje: `${conductor} registró ${TIPO_DIA[tipo] ?? 'un día'} el ${dia}.`,
      referencia_id: conductorId,
      referencia_tipo: `dias_laborados:${fecha}`,
    })
  } catch (error) {
    logger.error({ err: error, conductorId, fecha }, 'No se pudo avisar el día laborado')
  }
}
