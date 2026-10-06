import { prisma } from '../../config/prisma'
import type { Herramienta } from './asistente.types'
import { enteroEntre, fechaOpcional, textoOpcional } from './asistente.utils'

/**
 * Asistencias (listas de asistencia a capacitaciones, charlas, reuniones) en
 * el asistente y el MCP. Solo lectura: las listas se crean desde la pantalla y
 * las firmas las pone cada asistente desde su teléfono.
 */

const MODULO = 'asistencias'
const LIMITE_MAXIMO = 50
const TIPOS = ['capacitacion', 'charla', 'divulgacion', 'reunion', 'otro'] as const
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i

const diaUTC = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
/** `fecha` es DATE a medianoche UTC: se formatea en UTC o corre un día atrás. */
const fechaDia = (d: Date) => d.toLocaleDateString('es-CO', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' })

const enlaces = (id: string) => ({ enlace: `/dashboard/asistencias/${id}/respuestas`, enlace_editar: `/dashboard/asistencias/${id}` })

export const buscarAsistencias: Herramienta = {
  nombre: 'buscar_asistencias',
  descripcion:
    'Busca listas de asistencia (capacitaciones, charlas, divulgaciones, reuniones) por temática, instructor, lugar, tipo de evento o rango de fechas. Devuelve por evento la fecha, duración, lugar, instructor y cuántas personas firmaron. Para ver quiénes asistieron usa detalle_asistencia.',
  parametros: {
    type: 'object',
    properties: {
      texto: { type: 'string', description: 'Temática, objetivo, instructor o lugar (parcial)' },
      tipo_evento: { type: 'string', enum: [...TIPOS] },
      desde: { type: 'string', description: 'Fecha inicial YYYY-MM-DD del evento' },
      hasta: { type: 'string', description: 'Fecha final YYYY-MM-DD, incluida' },
      solo_activas: { type: 'boolean', description: 'true para ver solo las que aún reciben firmas' },
      limite: { type: 'integer', minimum: 1, maximum: LIMITE_MAXIMO },
    },
    additionalProperties: false,
  },
  etiqueta: 'Buscando asistencias',
  requiere: MODULO,
  salidaMaxima: { lista: LIMITE_MAXIMO },
  async ejecutar(args) {
    const texto = textoOpcional(args.texto, 120)
    const tipo = typeof args.tipo_evento === 'string' && (TIPOS as readonly string[]).includes(args.tipo_evento) ? args.tipo_evento : undefined
    const desde = fechaOpcional(args.desde)
    const hasta = fechaOpcional(args.hasta)
    const limite = enteroEntre(args.limite, 1, LIMITE_MAXIMO, 15)
    const contiene = (q: string) => ({ contains: q, mode: 'insensitive' as const })

    const where = {
      deleted_at: null,
      ...(tipo ? { tipo_evento: tipo } : {}),
      ...(args.solo_activas === true ? { activo: true } : {}),
      ...(desde || hasta ? { fecha: { ...(desde ? { gte: diaUTC(desde) } : {}), ...(hasta ? { lte: diaUTC(hasta) } : {}) } } : {}),
      ...(texto
        ? { OR: [{ tematica: contiene(texto) }, { objetivo: contiene(texto) }, { nombre_instructor: contiene(texto) }, { lugar_sede: contiene(texto) }, { tipo_evento_otro: contiene(texto) }] }
        : {}),
    }

    const [filas, total] = await Promise.all([
      prisma.formularios_asistencia.findMany({
        where,
        select: {
          id: true,
          tematica: true,
          objetivo: true,
          fecha: true,
          tipo_evento: true,
          tipo_evento_otro: true,
          lugar_sede: true,
          nombre_instructor: true,
          hora_inicio: true,
          hora_finalizacion: true,
          duracion_minutos: true,
          activo: true,
          creado_por: { select: { nombre: true } },
          _count: { select: { respuestas: true } },
        },
        orderBy: { fecha: 'desc' },
        take: limite,
      }),
      prisma.formularios_asistencia.count({ where }),
    ])

    return {
      total,
      mostradas: filas.length,
      asistencias: filas.map((f) => ({
        tematica: f.tematica,
        tipo: f.tipo_evento === 'otro' && f.tipo_evento_otro ? f.tipo_evento_otro : f.tipo_evento,
        fecha: fechaDia(f.fecha),
        horario: f.hora_inicio ? `${f.hora_inicio}${f.hora_finalizacion ? ` – ${f.hora_finalizacion}` : ''}` : undefined,
        duracion_minutos: f.duracion_minutos ?? undefined,
        lugar: f.lugar_sede || undefined,
        instructor: f.nombre_instructor || undefined,
        objetivo: f.objetivo || undefined,
        asistentes: f._count.respuestas,
        recibe_firmas: f.activo,
        creada_por: f.creado_por.nombre,
        ...enlaces(f.id),
      })),
    }
  },
}

export const detalleAsistencia: Herramienta = {
  nombre: 'detalle_asistencia',
  descripcion:
    'Trae una lista de asistencia completa: datos del evento y cada asistente (nombre, documento, cargo, teléfono, si pertenece a un comité y a cuál, hora de firma). Se busca por id o enlace, o por la temática exacta con su fecha.',
  parametros: {
    type: 'object',
    properties: {
      asistencia: { type: 'string', description: 'Id o enlace de la lista, o su temática' },
      fecha: { type: 'string', description: 'Fecha YYYY-MM-DD del evento, para desempatar por temática' },
    },
    required: ['asistencia'],
    additionalProperties: false,
  },
  etiqueta: 'Abriendo la lista de asistencia',
  requiere: MODULO,
  salidaMaxima: { lista: 300, caracteres: 40000 },
  async ejecutar(args) {
    const texto = textoOpcional(args.asistencia, 300)
    if (!texto) return { error: 'Indica la lista de asistencia' }
    const id = texto.match(UUID)?.[0]?.toLowerCase()
    const fecha = fechaOpcional(args.fecha)
    const candidatas = await prisma.formularios_asistencia.findMany({
      where: id
        ? { id, deleted_at: null }
        : { deleted_at: null, tematica: { contains: texto, mode: 'insensitive' }, ...(fecha ? { fecha: diaUTC(fecha) } : {}) },
      select: { id: true, tematica: true, fecha: true, _count: { select: { respuestas: true } } },
      orderBy: { fecha: 'desc' },
      take: 6,
    })
    if (candidatas.length === 0) return { error: `No encontré una lista de asistencia «${texto}»` }
    if (candidatas.length > 1) {
      return {
        error: 'Hay varias listas con esa temática; indica la fecha',
        candidatas: candidatas.map((c) => ({ tematica: c.tematica, fecha: fechaDia(c.fecha), asistentes: c._count.respuestas, ...enlaces(c.id) })),
      }
    }

    const f = await prisma.formularios_asistencia.findFirst({
      where: { id: candidatas[0].id },
      include: {
        creado_por: { select: { nombre: true } },
        respuestas: {
          orderBy: { created_at: 'asc' },
          select: { nombre_completo: true, numero_documento: true, cargo: true, numero_telefono: true, pertenece_comite: true, nombre_comite: true, created_at: true },
        },
      },
    })
    if (!f) return { error: 'La lista ya no existe' }

    const comites = new Map<string, number>()
    for (const r of f.respuestas) if (r.pertenece_comite && r.nombre_comite) comites.set(r.nombre_comite, (comites.get(r.nombre_comite) ?? 0) + 1)

    return {
      tematica: f.tematica,
      objetivo: f.objetivo || undefined,
      tipo: f.tipo_evento === 'otro' && f.tipo_evento_otro ? f.tipo_evento_otro : f.tipo_evento,
      fecha: fechaDia(f.fecha),
      horario: f.hora_inicio ? `${f.hora_inicio}${f.hora_finalizacion ? ` – ${f.hora_finalizacion}` : ''}` : undefined,
      duracion_minutos: f.duracion_minutos ?? undefined,
      lugar: f.lugar_sede || undefined,
      instructor: f.nombre_instructor || undefined,
      observaciones: f.observaciones || undefined,
      recibe_firmas: f.activo,
      creada_por: f.creado_por.nombre,
      total_asistentes: f.respuestas.length,
      por_comite: [...comites.entries()].map(([comite, personas]) => ({ comite, personas })),
      asistentes: f.respuestas.map((r) => ({
        nombre: r.nombre_completo,
        documento: r.numero_documento,
        cargo: r.cargo,
        telefono: r.numero_telefono,
        comite: r.pertenece_comite ? r.nombre_comite || 'sí' : undefined,
        firmo: r.created_at.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'short', timeStyle: 'short' }),
      })),
      ...enlaces(f.id),
    }
  },
}

export const HERRAMIENTAS_ASISTENCIAS: readonly Herramienta[] = [buscarAsistencias, detalleAsistencia]
