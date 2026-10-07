import type { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '../../config/prisma'
import { getIo } from '../../sockets'
import {
  OpcionDesconocidaError,
  registrarResultado,
  respuestaPreguntaSchema
} from '../evaluaciones/registrar-resultado'
import { barajar } from '../evaluaciones/evaluacion-publica'
import { sopaParaPublico, type ConfigSopa } from '../evaluaciones/sopa-letras'

/**
 * Asistencias y evaluaciones de capacitación desde la app del conductor. El conductor ya está
 * autenticado, así que no llena sus datos: se toman de `conductores`. Una asistencia o evaluación
 * cuenta como respondida si hay una fila con su documento (web pública) o con la huella del portal.
 */

export class CapacitacionesError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

export interface MetaPeticion {
  ip: string
  userAgent: string
}

const ZONA_HORARIA = 'America/Bogota'
const LIMITE_HISTORIAL = 30
/**
 * Días que una evaluación recién creada se ofrece a todos los conductores en la
 * app. Antes solo aparecían las ligadas a una formación PESV cuya asistencia ya
 * se firmó, y el resto solo se podía abrir escaneando su QR: una evaluación
 * hecha para responder desde el teléfono no le aparecía a nadie.
 */
const DIAS_EVALUACION_ABIERTA = 30
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const huellaPortal = (conductorId: string) => `portal-conductor:${conductorId}`

async function cargarConductor(conductorId: string) {
  const conductor = await prisma.conductores.findUnique({
    where: { id: conductorId },
    select: {
      id: true,
      nombre: true,
      apellido: true,
      numero_identificacion: true,
      cargo: true,
      telefono: true,
      email: true
    }
  })
  if (!conductor) throw new CapacitacionesError('Conductor no encontrado', 404)
  return conductor
}

type Conductor = Awaited<ReturnType<typeof cargarConductor>>

function datosConductor(c: Conductor) {
  return {
    nombre_completo: `${c.nombre} ${c.apellido}`.trim(),
    numero_documento: c.numero_identificacion ?? '',
    cargo: c.cargo || 'CONDUCTOR',
    telefono: c.telefono ?? ''
  }
}

// Filtro común a respuestas_asistencia y resultado: su documento o la huella del portal
function delConductor(c: Conductor) {
  const condiciones: { numero_documento?: string; device_fingerprint?: string }[] = [
    { device_fingerprint: huellaPortal(c.id) }
  ]
  if (c.numero_identificacion) condiciones.push({ numero_documento: c.numero_identificacion })
  return { OR: condiciones }
}

/** Fecha del día (YYYY-MM-DD) en Colombia desplazada `dias`, como Date UTC para columnas `@db.Date`. */
function diaBogota(dias: number) {
  const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: ZONA_HORARIA }).format(new Date())
  const d = new Date(`${hoy}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + dias)
  return d
}

type Formulario = Prisma.formularios_asistenciaGetPayload<{}>

function resumenAsistencia(f: Formulario) {
  return {
    token: f.token,
    tematica: f.tematica,
    objetivo: f.objetivo,
    fecha: f.fecha.toISOString().slice(0, 10),
    hora_inicio: f.hora_inicio,
    hora_finalizacion: f.hora_finalizacion,
    tipo_evento: f.tipo_evento,
    tipo_evento_otro: f.tipo_evento_otro,
    lugar_sede: f.lugar_sede,
    nombre_instructor: f.nombre_instructor
  }
}

const puntajeMaximo = (preguntas: { puntaje: number }[]) =>
  preguntas.reduce((suma, p) => suma + p.puntaje, 0)

export async function listarCapacitaciones(conductorId: string) {
  const conductor = await cargarConductor(conductorId)
  const filtro = delConductor(conductor)

  const [pendientes, firmas, resultados] = await Promise.all([
    prisma.formularios_asistencia.findMany({
      where: {
        activo: true,
        deleted_at: null,
        fecha: { gte: diaBogota(-1), lte: diaBogota(1) },
        respuestas: { none: filtro }
      },
      orderBy: [{ fecha: 'asc' }, { hora_inicio: 'asc' }]
    }),
    prisma.respuestas_asistencia.findMany({
      where: filtro,
      select: { formulario_id: true, created_at: true, formulario: true },
      orderBy: { created_at: 'desc' }
    }),
    prisma.resultado.findMany({
      where: { ...filtro, evaluacion: { deleted_at: null } },
      select: {
        evaluacionId: true,
        puntaje_total: true,
        created_at: true,
        evaluacion: { select: { titulo: true, preguntas: { select: { puntaje: true } } } }
      },
      orderBy: { created_at: 'desc' }
    })
  ])

  // Puede haber dos filas del mismo formulario (web y app): cuenta la más reciente
  const asistenciasFirmadas = []
  const formulariosVistos = new Set<string>()
  for (const r of firmas) {
    if (formulariosVistos.has(r.formulario_id)) continue
    formulariosVistos.add(r.formulario_id)
    if (r.formulario.deleted_at || asistenciasFirmadas.length >= LIMITE_HISTORIAL) continue
    asistenciasFirmadas.push({ ...resumenAsistencia(r.formulario), firmada_en: r.created_at.toISOString() })
  }

  const evaluacionesRespondidas = []
  const evaluacionesVistas = new Set<string>()
  for (const r of resultados) {
    if (evaluacionesVistas.has(r.evaluacionId)) continue
    evaluacionesVistas.add(r.evaluacionId)
    if (evaluacionesRespondidas.length >= LIMITE_HISTORIAL) continue
    evaluacionesRespondidas.push({
      id: r.evaluacionId,
      titulo: r.evaluacion.titulo,
      puntaje_total: r.puntaje_total,
      puntaje_maximo: puntajeMaximo(r.evaluacion.preguntas),
      respondida_en: r.created_at.toISOString()
    })
  }

  // Evaluaciones de las formaciones PESV cuya asistencia ya firmó el conductor
  const formaciones = formulariosVistos.size
    ? await prisma.pesv_training_plan.findMany({
        where: {
          deleted_at: null,
          asistencia_id: { in: [...formulariosVistos] },
          evaluacion_id: { not: null, notIn: [...evaluacionesVistas] },
          evaluacion: { deleted_at: null }
        },
        select: {
          tema: true,
          evaluacion: {
            select: {
              id: true,
              titulo: true,
              descripcion: true,
              requiere_firma: true,
              preguntas: { select: { puntaje: true } }
            }
          }
        },
        orderBy: { created_at: 'desc' }
      })
    : []

  const evaluacionesPendientes = []
  const pendientesVistas = new Set<string>()
  for (const f of formaciones) {
    const e = f.evaluacion
    if (!e || pendientesVistas.has(e.id)) continue
    pendientesVistas.add(e.id)
    evaluacionesPendientes.push({
      id: e.id,
      titulo: e.titulo,
      descripcion: e.descripcion,
      preguntas: e.preguntas.length,
      puntaje_maximo: puntajeMaximo(e.preguntas),
      requiere_firma: e.requiere_firma,
      formacion: f.tema ?? null
    })
  }

  // Evaluaciones recientes que el conductor no ha respondido, aunque no estén en una formación
  const abiertas = await prisma.evaluacion.findMany({
    where: {
      deleted_at: null,
      created_at: { gte: diaBogota(-DIAS_EVALUACION_ABIERTA) },
      id: { notIn: [...evaluacionesVistas, ...pendientesVistas] }
    },
    select: {
      id: true,
      titulo: true,
      descripcion: true,
      requiere_firma: true,
      preguntas: { select: { puntaje: true } }
    },
    orderBy: { created_at: 'desc' },
    take: LIMITE_HISTORIAL
  })
  for (const e of abiertas) {
    if (!e.preguntas.length) continue
    evaluacionesPendientes.push({
      id: e.id,
      titulo: e.titulo,
      descripcion: e.descripcion,
      preguntas: e.preguntas.length,
      puntaje_maximo: puntajeMaximo(e.preguntas),
      requiere_firma: e.requiere_firma,
      formacion: null
    })
  }

  return {
    asistencias_pendientes: pendientes.map(resumenAsistencia),
    evaluaciones_pendientes: evaluacionesPendientes,
    asistencias_firmadas: asistenciasFirmadas,
    evaluaciones_respondidas: evaluacionesRespondidas
  }
}

async function formularioPorToken(token: string) {
  const formulario = await prisma.formularios_asistencia.findUnique({ where: { token } })
  if (!formulario || formulario.deleted_at) {
    throw new CapacitacionesError('Asistencia no encontrada', 404)
  }
  return formulario
}

/** Con `conImagen` trae también la firma (data URI PNG, decenas de KB). */
async function firmaDelConductor(formularioId: string, conductor: Conductor, conImagen = false) {
  return prisma.respuestas_asistencia.findFirst({
    where: { formulario_id: formularioId, ...delConductor(conductor) },
    select: { created_at: true, firma: conImagen },
    orderBy: { created_at: 'desc' }
  })
}

export async function obtenerAsistencia(token: string, conductorId: string) {
  const conductor = await cargarConductor(conductorId)
  const formulario = await formularioPorToken(token)
  const firma = await firmaDelConductor(formulario.id, conductor, true)
  return {
    asistencia: { ...resumenAsistencia(formulario), activo: formulario.activo },
    firmada_en: firma ? firma.created_at.toISOString() : null,
    /// La firma que dejó el conductor, para que la vea en la asistencia firmada.
    firma: firma?.firma ?? null,
    conductor: datosConductor(conductor)
  }
}

export async function firmarAsistencia(
  token: string,
  conductorId: string,
  body: unknown,
  meta: MetaPeticion
) {
  const conductor = await cargarConductor(conductorId)
  const formulario = await formularioPorToken(token)
  if (!formulario.activo) {
    throw new CapacitacionesError('Esta asistencia ya no está disponible', 403)
  }
  if (await firmaDelConductor(formulario.id, conductor)) {
    throw new CapacitacionesError('Ya firmaste esta asistencia', 409)
  }

  const firma = (body as { firma?: unknown } | null)?.firma
  if (typeof firma !== 'string' || !firma.startsWith('data:image/')) {
    throw new CapacitacionesError('La firma es requerida', 400)
  }
  if (!conductor.numero_identificacion) {
    throw new CapacitacionesError('Tu perfil no tiene número de identificación registrado', 422)
  }

  const datos = datosConductor(conductor)
  let respuesta
  try {
    respuesta = await prisma.respuestas_asistencia.create({
      data: {
        formulario_id: formulario.id,
        nombre_completo: datos.nombre_completo.slice(0, 255),
        numero_documento: datos.numero_documento.slice(0, 50),
        cargo: datos.cargo.slice(0, 255),
        numero_telefono: datos.telefono.slice(0, 20),
        pertenece_comite: null,
        firma,
        ip_address: meta.ip.slice(0, 45),
        user_agent: meta.userAgent,
        device_fingerprint: huellaPortal(conductor.id)
      }
    })
  } catch (err: any) {
    // Dos envíos simultáneos: la llave única (formulario, huella) deja pasar solo uno
    if (err?.code === 'P2002') throw new CapacitacionesError('Ya firmaste esta asistencia', 409)
    throw err
  }

  // Mismo evento que la firma desde la web pública
  try {
    getIo().emit('asistencias:respuesta:created', {
      respuesta,
      formularioId: formulario.id,
      formularioToken: formulario.token,
      timestamp: new Date().toISOString()
    })
  } catch {
    // Sin socket no se pierde la firma
  }

  return { firmada_en: respuesta.created_at.toISOString() }
}

async function evaluacionVigente(id: string) {
  const evaluacion = UUID_RE.test(id)
    ? await prisma.evaluacion.findFirst({
        where: { id, deleted_at: null },
        include: { preguntas: { include: { opciones: true } } }
      })
    : null
  if (!evaluacion) throw new CapacitacionesError('Evaluación no encontrada', 404)
  // La web muestra las preguntas en el orden en que llegan de la base (sin ORDER BY). Las creadas
  // juntas comparten `created_at`, así que se ordena de forma estable y ante empate manda ese orden.
  evaluacion.preguntas.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
  return evaluacion
}

const respuestaSelect = {
  preguntaId: true,
  valor_texto: true,
  valor_numero: true,
  opcionesIds: true,
  relacion: true,
  puntaje: true
} as const

async function resultadoDelConductor(evaluacionId: string, conductor: Conductor) {
  return prisma.resultado.findFirst({
    where: { evaluacionId, ...delConductor(conductor) },
    select: { puntaje_total: true, created_at: true, respuestas: { select: respuestaSelect } },
    orderBy: { created_at: 'desc' }
  })
}

type RespuestaGuardada = {
  preguntaId: string
  valor_texto: string | null
  valor_numero: number | null
  opcionesIds: string[]
  relacion: unknown
  puntaje: number
}

/**
 * Lo que respondió el conductor en cada pregunta y si acertó. Solo SU respuesta:
 * nunca la correcta, para que un error no le entregue la clave.
 */
function detalleDeRespuestas(
  preguntas: { id: string; puntaje: number }[],
  respuestas: RespuestaGuardada[]
) {
  return preguntas.flatMap((pregunta) => {
    const r = respuestas.find((respuesta) => respuesta.preguntaId === pregunta.id)
    if (!r) return []
    return [{
      pregunta_id: pregunta.id,
      valor_texto: r.valor_texto,
      valor_numero: r.valor_numero,
      opciones_ids: r.opcionesIds,
      // RELACION: pares `{izq, der}`; SOPA_LETRAS: trazos `{palabra, desde, hasta}` validados.
      relacion: Array.isArray(r.relacion) ? (r.relacion as unknown[]) : [],
      puntaje: r.puntaje,
      estado: r.puntaje >= pregunta.puntaje ? 'correcta' : r.puntaje > 0 ? 'parcial' : 'incorrecta'
    }]
  })
}

export async function obtenerEvaluacion(id: string, conductorId: string) {
  const conductor = await cargarConductor(conductorId)
  const evaluacion = await evaluacionVigente(id)
  const maximo = puntajeMaximo(evaluacion.preguntas)
  const resultado = await resultadoDelConductor(evaluacion.id, conductor)

  return {
    evaluacion: {
      id: evaluacion.id,
      titulo: evaluacion.titulo,
      descripcion: evaluacion.descripcion,
      requiere_firma: evaluacion.requiere_firma,
      puntaje_maximo: maximo,
      // Sin `esCorrecta` ni `respuestaCorrecta`; en RELACION la derecha va barajada (la pareja es por índice)
      preguntas: evaluacion.preguntas.map((p) => ({
        id: p.id,
        texto: p.texto,
        tipo: p.tipo,
        puntaje: p.puntaje,
        opciones: p.opciones.map((o) => ({ id: o.id, texto: o.texto })),
        relacion_izq: p.relacionIzq,
        relacion_der: p.tipo === 'RELACION' ? barajar(p.relacionDer) : p.relacionDer,
        // Sopa de letras: cuadrícula y lista, sin dónde está cada palabra
        configuracion:
          p.tipo === 'SOPA_LETRAS' && p.configuracion
            ? sopaParaPublico(p.configuracion as unknown as ConfigSopa)
            : null
      }))
    },
    resultado: resultado
      ? {
          puntaje_total: resultado.puntaje_total,
          puntaje_maximo: maximo,
          respondida_en: resultado.created_at.toISOString(),
          respuestas: detalleDeRespuestas(evaluacion.preguntas, resultado.respuestas)
        }
      : null,
    conductor: datosConductor(conductor)
  }
}

const responderEvaluacionSchema = z.object({
  respuestas: z.array(respuestaPreguntaSchema),
  firma: z.string().optional()
})

export async function responderEvaluacion(
  id: string,
  conductorId: string,
  body: unknown,
  meta: MetaPeticion
) {
  const conductor = await cargarConductor(conductorId)
  const evaluacion = await evaluacionVigente(id)
  if (await resultadoDelConductor(evaluacion.id, conductor)) {
    throw new CapacitacionesError('Ya respondiste esta evaluación', 409)
  }

  const parsed = responderEvaluacionSchema.safeParse(body)
  if (!parsed.success) throw new CapacitacionesError('Las respuestas no son válidas', 400)
  const firma = parsed.data.firma?.trim() ? parsed.data.firma : undefined
  if (evaluacion.requiere_firma && !firma) {
    throw new CapacitacionesError('Esta evaluación requiere tu firma', 400)
  }
  if (!conductor.numero_identificacion) {
    throw new CapacitacionesError('Tu perfil no tiene número de identificación registrado', 422)
  }

  const datos = datosConductor(conductor)
  let resultado
  try {
    resultado = await registrarResultado(evaluacion, parsed.data.respuestas, {
      ...datos,
      correo: conductor.email ?? '',
      firma,
      device_fingerprint: huellaPortal(conductor.id),
      ip_address: meta.ip.slice(0, 45),
      user_agent: meta.userAgent
    })
  } catch (error) {
    // La evaluación se editó mientras el conductor la respondía: sus opciones ya no existen.
    if (error instanceof OpcionDesconocidaError) throw new CapacitacionesError(error.message, 409)
    throw error
  }

  return {
    puntaje_total: resultado.puntaje_total,
    puntaje_maximo: puntajeMaximo(evaluacion.preguntas),
    respondida_en: resultado.created_at.toISOString(),
    respuestas: detalleDeRespuestas(evaluacion.preguntas, resultado.respuestas)
  }
}
