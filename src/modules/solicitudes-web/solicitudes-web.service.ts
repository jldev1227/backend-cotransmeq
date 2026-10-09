/**
 * Bandeja de solicitudes web: recepción desde la landing y gestión en el panel.
 *
 * El formulario público reemplazó a los CTA de WhatsApp, teléfono y correo de
 * las landings. La razón no es estética: llegaban llamadas y mensajes de
 * procedencia dudosa pidiendo servicios «para ya», y la empresa no tenía forma
 * de decidir con criterio a quién atender. Ahora todo entra por aquí con
 * radicado, se clasifica (`triage.ts`) y queda en una bandeja donde
 * operaciones verifica antes de responder.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { emitNotificacion } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { EmailService, getEmailFrontendUrl } from '../../services/email.service'
import { bloqueCita, escaparHtml, renderCorreo, textoAHtml } from '../../services/email-plantilla'
import { clasificarSolicitud, hoyBogota, type Senal } from './triage'
import type { CrearSolicitudPublica, EstadoSolicitud, GestionarSolicitud, ListarSolicitudes } from './solicitudes-web.schema'

export class SolicitudesWebError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string
  ) {
    super(message)
  }
}

export const TIPO_LABEL: Record<string, string> = {
  cotizacion: 'Cotización',
  servicio: 'Solicitud de servicio',
  informacion: 'Información',
  otro: 'Otro'
}

export const ESTADO_LABEL: Record<EstadoSolicitud, string> = {
  nueva: 'Nueva',
  en_verificacion: 'En verificación',
  verificada: 'Verificada',
  atendida: 'Atendida',
  descartada: 'Descartada',
  spam: 'Spam'
}

const PENDIENTES: EstadoSolicitud[] = ['nueva', 'en_verificacion', 'verificada']

export interface ContextoEnvio {
  ip: string | null
  userAgent: string | null
  referer: string | null
}

interface EventoHistorial {
  en: string
  por_id: string | null
  por: string
  accion: string
  detalle: string | null
}

// ─── Radicado ────────────────────────────────────────────────────────────────

/** `SW-AAAA-#####`, correlativo por año. Reintenta si dos envíos chocan. */
async function generarRadicado(intento = 0): Promise<string> {
  const anio = new Date().getFullYear()
  const prefijo = `SW-${anio}-`
  const n = await prisma.solicitud_web.count({ where: { radicado: { startsWith: prefijo } } })
  return `${prefijo}${String(n + 1 + intento).padStart(5, '0')}`
}

// ─── Recepción pública ───────────────────────────────────────────────────────

async function buscarClienteConocido(empresa: string | null | undefined, documento: string | null | undefined) {
  const digitos = (documento ?? '').replace(/\D/g, '')
  const nombre = (empresa ?? '').trim()
  if (digitos.length < 6 && nombre.length < 4) return null
  const or: Prisma.clientesWhereInput[] = []
  if (digitos.length >= 6) or.push({ nit: { contains: digitos } })
  if (nombre.length >= 4) or.push({ nombre: { contains: nombre, mode: 'insensitive' } })
  const c = await prisma.clientes.findFirst({
    where: { deletedAt: null, OR: or },
    select: { id: true, nombre: true }
  })
  return c ?? null
}

export async function crearDesdeLanding(input: CrearSolicitudPublica, ctx: ContextoEnvio) {
  // Honeypot: se contesta como si nada y no se guarda. Un bot que ve 201 no
  // insiste; uno que ve 400 prueba otra cosa.
  if (input.sitio_web && input.sitio_web.trim() !== '') {
    logger.warn({ ip: ctx.ip }, '[solicitudes-web] envío descartado por honeypot')
    return { radicado: null as string | null, urgente: false, descartada: true }
  }

  const hace24h = new Date(Date.now() - 24 * 3_600_000)
  const [previas, mismaIp24h, clienteConocido] = await Promise.all([
    prisma.solicitud_web.findMany({
      where: { OR: [{ telefono: input.telefono }, { correo: input.correo }] },
      select: { estado: true, created_at: true },
      orderBy: { created_at: 'desc' },
      take: 20
    }),
    ctx.ip ? prisma.solicitud_web.count({ where: { ip_origen: ctx.ip, created_at: { gte: hace24h } } }) : Promise.resolve(0),
    buscarClienteConocido(input.empresa, input.documento)
  ])

  const triage = clasificarSolicitud(input, { hoy: hoyBogota(), previas, mismaIp24h, clienteConocido })

  const data = {
    tipo: input.tipo,
    nombre: input.nombre,
    empresa: input.empresa ?? null,
    documento: input.documento ?? null,
    cargo: input.cargo ?? null,
    correo: input.correo,
    telefono: input.telefono,
    origen: input.origen ?? null,
    destino: input.destino ?? null,
    fecha_servicio: input.fecha_servicio ? new Date(`${input.fecha_servicio}T00:00:00.000Z`) : null,
    pasajeros: input.pasajeros ?? null,
    tipo_vehiculo: input.tipo_vehiculo ?? null,
    modalidad: input.modalidad ?? null,
    mensaje: input.mensaje,
    urgente: triage.urgente,
    prioridad: triage.prioridad,
    riesgo_nivel: triage.riesgo_nivel,
    riesgo_puntaje: triage.riesgo_puntaje,
    senales: triage.senales as unknown as Prisma.InputJsonValue,
    cliente_id: clienteConocido?.id ?? null,
    origen_sitio: input.origen_sitio ?? null,
    ip_origen: ctx.ip,
    user_agent: ctx.userAgent,
    referer: ctx.referer,
    tiempo_llenado_ms: input.tiempo_llenado_ms ?? null,
    historial: [
      {
        en: new Date().toISOString(),
        por_id: null,
        por: 'Formulario web',
        accion: 'recibida',
        detalle: triage.senales.length ? triage.senales.map((s) => s.texto).join(' · ') : null
      }
    ] as unknown as Prisma.InputJsonValue
  }

  let creada: { id: string; radicado: string } | null = null
  for (let intento = 0; intento < 3 && !creada; intento++) {
    const radicado = await generarRadicado(intento)
    try {
      creada = await prisma.solicitud_web.create({ data: { ...data, radicado }, select: { id: true, radicado: true } })
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') continue
      throw err
    }
  }
  if (!creada) throw new SolicitudesWebError(500, 'RADICADO', 'No se pudo asignar un radicado')

  // El aviso no puede tumbar la recepción: el radicado ya existe.
  void avisarNuevaSolicitud({ id: creada.id, radicado: creada.radicado, ...data, senales: triage.senales })

  return { radicado: creada.radicado, urgente: triage.urgente, descartada: false }
}

// ─── Avisos internos ─────────────────────────────────────────────────────────

async function avisarNuevaSolicitud(s: {
  id: string
  radicado: string
  tipo: string
  nombre: string
  empresa: string | null
  correo: string
  telefono: string
  origen: string | null
  destino: string | null
  fecha_servicio: Date | null
  pasajeros: number | null
  mensaje: string
  urgente: boolean
  prioridad: string
  riesgo_nivel: string
  senales: Senal[]
}) {
  const etiqueta = TIPO_LABEL[s.tipo] ?? s.tipo
  const quien = s.empresa ? `${s.nombre} (${s.empresa})` : s.nombre
  const titulo = `${s.urgente ? '⚠️ ' : ''}Nueva ${etiqueta.toLowerCase()} web · ${s.radicado}`
  const ruta = s.origen || s.destino ? ` · ${s.origen ?? '?'} → ${s.destino ?? '?'}` : ''
  const mensaje = `${quien}${ruta}. Riesgo ${s.riesgo_nivel}, prioridad ${s.prioridad}.`

  try {
    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { hasSome: ['administracion', 'operaciones'] } },
      select: { id: true }
    })
    for (const u of usuarios) {
      const n = await NotificacionesService.crear({
        usuario_id: u.id,
        tipo: 'GENERAL',
        titulo,
        mensaje,
        referencia_id: s.id,
        referencia_tipo: 'solicitud_web'
      })
      emitNotificacion(n)
    }
  } catch (error) {
    logger.error({ err: error, radicado: s.radicado }, '[solicitudes-web] no se pudo notificar en el panel')
  }

  const destinatarios = (env.SOLICITUDES_WEB_EMAIL_TO ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  if (!destinatarios.length) return

  try {
    const enlace = `${getEmailFrontendUrl()}/dashboard/solicitudes?solicitud=${s.id}`
    const fecha = s.fecha_servicio ? s.fecha_servicio.toISOString().slice(0, 10) : null
    const filas = [
      { etiqueta: 'Radicado', valor: escaparHtml(s.radicado), mono: true },
      { etiqueta: 'Tipo', valor: escaparHtml(etiqueta) },
      { etiqueta: 'Solicitante', valor: escaparHtml(quien) },
      { etiqueta: 'Correo', valor: escaparHtml(s.correo) },
      { etiqueta: 'Teléfono', valor: escaparHtml(s.telefono) },
      ...(s.origen || s.destino ? [{ etiqueta: 'Ruta', valor: escaparHtml(`${s.origen ?? '—'} → ${s.destino ?? '—'}`) }] : []),
      ...(fecha ? [{ etiqueta: 'Fecha del servicio', valor: escaparHtml(fecha) }] : []),
      ...(s.pasajeros ? [{ etiqueta: 'Pasajeros', valor: String(s.pasajeros) }] : []),
      { etiqueta: 'Prioridad', valor: escaparHtml(s.prioridad), destacado: true },
      { etiqueta: 'Riesgo', valor: escaparHtml(s.riesgo_nivel), destacado: true }
    ]
    const html = renderCorreo({
      preheader: `${etiqueta} de ${quien}`,
      eyebrow: 'Solicitud web',
      titulo: s.urgente ? 'Solicitud urgente recibida' : 'Nueva solicitud recibida',
      subtitulo: 'Verifica la procedencia antes de responder.',
      mascota: s.riesgo_nivel === 'alto' ? 'alerta' : 'correo-enviado',
      parrafos: [`Entró una ${escaparHtml(etiqueta.toLowerCase())} por el formulario del sitio web.`],
      htmlTrasParrafos: bloqueCita(textoAHtml(s.mensaje)),
      datos: { titulo: 'Resumen', filas },
      boton: { texto: 'Abrir en la bandeja', url: enlace },
      notas: s.senales.length
        ? [{ tono: s.riesgo_nivel === 'alto' ? 'alerta' : 'aviso', html: `<strong>Señales:</strong> ${escaparHtml(s.senales.map((x) => x.texto).join(' · '))}` }]
        : [],
      enlaceRespaldo: enlace,
      pie: ['Este correo lo genera el sistema cuando alguien diligencia el formulario público. No respondas a esta dirección.']
    })
    await EmailService.sendEmail({ to: destinatarios, subject: titulo.replace('⚠️ ', '[URGENTE] '), html })
  } catch (error) {
    logger.error({ err: error, radicado: s.radicado }, '[solicitudes-web] no se pudo enviar el correo interno')
  }
}

// ─── Panel ───────────────────────────────────────────────────────────────────

const RESUMEN_SELECT = {
  id: true,
  radicado: true,
  tipo: true,
  estado: true,
  prioridad: true,
  nombre: true,
  empresa: true,
  correo: true,
  telefono: true,
  origen: true,
  destino: true,
  fecha_servicio: true,
  pasajeros: true,
  urgente: true,
  riesgo_nivel: true,
  riesgo_puntaje: true,
  cliente_id: true,
  asignado_a_id: true,
  asignado_a: { select: { id: true, nombre: true } },
  created_at: true,
  updated_at: true
} satisfies Prisma.solicitud_webSelect

export async function listar(q: ListarSolicitudes) {
  const where: Prisma.solicitud_webWhereInput = {}
  if (q.tipo) where.tipo = q.tipo
  if (q.estado) where.estado = q.estado
  else if (q.pendientes) where.estado = { in: PENDIENTES }
  if (q.prioridad) where.prioridad = q.prioridad
  if (q.riesgo) where.riesgo_nivel = q.riesgo
  if (q.search) {
    const s = q.search
    where.OR = [
      { radicado: { contains: s, mode: 'insensitive' } },
      { nombre: { contains: s, mode: 'insensitive' } },
      { empresa: { contains: s, mode: 'insensitive' } },
      { correo: { contains: s, mode: 'insensitive' } },
      { telefono: { contains: s.replace(/\s/g, '') } },
      { documento: { contains: s } },
      { origen: { contains: s, mode: 'insensitive' } },
      { destino: { contains: s, mode: 'insensitive' } }
    ]
  }

  /// La prioridad es texto; ordenarla alfabéticamente daría alta < baja < media.
  /// Se ordena en SQL por un CASE y el resto por Prisma.
  const orderBy: Prisma.solicitud_webOrderByWithRelationInput[] =
    q.orden === 'prioridad'
      ? [{ created_at: 'desc' }]
      : [{ [q.orden]: q.direccion } as Prisma.solicitud_webOrderByWithRelationInput, { created_at: 'desc' }]

  const [total, items, porEstado, pendientesPorPrioridad, pendientesRiesgoAlto] = await Promise.all([
    prisma.solicitud_web.count({ where }),
    prisma.solicitud_web.findMany({ where, orderBy, skip: (q.page - 1) * q.limit, take: q.limit, select: RESUMEN_SELECT }),
    prisma.solicitud_web.groupBy({ by: ['estado'], _count: { _all: true } }),
    prisma.solicitud_web.groupBy({ by: ['prioridad'], where: { estado: { in: PENDIENTES } }, _count: { _all: true } }),
    prisma.solicitud_web.count({ where: { estado: { in: PENDIENTES }, riesgo_nivel: 'alto' } })
  ])

  if (q.orden === 'prioridad') {
    const peso: Record<string, number> = { alta: 0, media: 1, baja: 2 }
    items.sort((a, b) => (q.direccion === 'asc' ? -1 : 1) * ((peso[a.prioridad] ?? 9) - (peso[b.prioridad] ?? 9)))
  }

  const estados: Record<string, number> = {}
  for (const g of porEstado) estados[g.estado] = g._count._all
  const prioridades: Record<string, number> = {}
  for (const g of pendientesPorPrioridad) prioridades[g.prioridad] = g._count._all

  return {
    items,
    pagination: { page: q.page, limit: q.limit, total, pages: Math.max(1, Math.ceil(total / q.limit)) },
    resumen: {
      estados,
      pendientes: PENDIENTES.reduce((acc, e) => acc + (estados[e] ?? 0), 0),
      pendientes_por_prioridad: prioridades,
      pendientes_riesgo_alto: pendientesRiesgoAlto
    }
  }
}

/** Lo justo para el contador del menú y el panel de inicio. */
export async function resumenPendientes() {
  const [pendientes, nuevas, urgentes] = await Promise.all([
    prisma.solicitud_web.count({ where: { estado: { in: PENDIENTES } } }),
    prisma.solicitud_web.count({ where: { estado: 'nueva' } }),
    prisma.solicitud_web.count({ where: { estado: { in: PENDIENTES }, urgente: true } })
  ])
  return { pendientes, nuevas, urgentes }
}

export async function detalle(id: string) {
  const s = await prisma.solicitud_web.findUnique({
    where: { id },
    include: {
      asignado_a: { select: { id: true, nombre: true, correo: true } },
      cliente: { select: { id: true, nombre: true, nit: true } }
    }
  })
  if (!s) throw new SolicitudesWebError(404, 'NO_EXISTE', 'La solicitud no existe')

  const [antecedentes, candidatos] = await Promise.all([
    prisma.solicitud_web.findMany({
      where: { id: { not: id }, OR: [{ telefono: s.telefono }, { correo: s.correo }, ...(s.ip_origen ? [{ ip_origen: s.ip_origen }] : [])] },
      select: { id: true, radicado: true, tipo: true, estado: true, nombre: true, empresa: true, created_at: true, telefono: true, correo: true, ip_origen: true },
      orderBy: { created_at: 'desc' },
      take: 10
    }),
    prisma.usuarios.findMany({
      where: { activo: true, area: { hasSome: ['administracion', 'operaciones'] } },
      select: { id: true, nombre: true },
      orderBy: { nombre: 'asc' }
    })
  ])

  return {
    ...s,
    antecedentes: antecedentes.map((a) => ({
      ...a,
      coincide: [a.telefono === s.telefono ? 'teléfono' : null, a.correo === s.correo ? 'correo' : null, a.ip_origen && a.ip_origen === s.ip_origen ? 'conexión' : null].filter(Boolean)
    })),
    candidatos
  }
}

export async function gestionar(id: string, cambios: GestionarSolicitud, actor: { id: string; nombre: string }) {
  const actual = await prisma.solicitud_web.findUnique({ where: { id }, select: { estado: true, prioridad: true, asignado_a_id: true, historial: true } })
  if (!actual) throw new SolicitudesWebError(404, 'NO_EXISTE', 'La solicitud no existe')

  const en = new Date().toISOString()
  const eventos: EventoHistorial[] = []
  const data: Prisma.solicitud_webUpdateInput = {}

  if (cambios.estado && cambios.estado !== actual.estado) {
    data.estado = cambios.estado
    eventos.push({ en, por_id: actor.id, por: actor.nombre, accion: 'estado', detalle: `${ESTADO_LABEL[actual.estado as EstadoSolicitud] ?? actual.estado} → ${ESTADO_LABEL[cambios.estado]}` })
    if (cambios.estado === 'atendida') data.atendida_at = new Date()
  }
  if (cambios.prioridad && cambios.prioridad !== actual.prioridad) {
    data.prioridad = cambios.prioridad
    eventos.push({ en, por_id: actor.id, por: actor.nombre, accion: 'prioridad', detalle: `${actual.prioridad} → ${cambios.prioridad}` })
  }
  if (cambios.asignado_a_id !== undefined && cambios.asignado_a_id !== actual.asignado_a_id) {
    let nombre = 'nadie'
    if (cambios.asignado_a_id) {
      const u = await prisma.usuarios.findUnique({ where: { id: cambios.asignado_a_id }, select: { nombre: true } })
      if (!u) throw new SolicitudesWebError(422, 'USUARIO', 'El usuario a asignar no existe')
      nombre = u.nombre
      data.asignado_a = { connect: { id: cambios.asignado_a_id } }
    } else {
      data.asignado_a = { disconnect: true }
    }
    eventos.push({ en, por_id: actor.id, por: actor.nombre, accion: 'asignacion', detalle: `Asignada a ${nombre}` })
    // Asignar sin tocar el estado saca la solicitud de «nueva»: ya hay alguien encima.
    if (!cambios.estado && actual.estado === 'nueva' && cambios.asignado_a_id) data.estado = 'en_verificacion'
  }
  if (cambios.nota) {
    eventos.push({ en, por_id: actor.id, por: actor.nombre, accion: 'nota', detalle: cambios.nota })
  }

  if (!eventos.length) return detalle(id)

  const historial = Array.isArray(actual.historial) ? (actual.historial as unknown as EventoHistorial[]) : []
  data.historial = [...historial, ...eventos] as unknown as Prisma.InputJsonValue

  await prisma.solicitud_web.update({ where: { id }, data })

  if (cambios.asignado_a_id && cambios.asignado_a_id !== actual.asignado_a_id && cambios.asignado_a_id !== actor.id) {
    try {
      const s = await prisma.solicitud_web.findUnique({ where: { id }, select: { radicado: true, nombre: true, empresa: true } })
      const n = await NotificacionesService.crear({
        usuario_id: cambios.asignado_a_id,
        tipo: 'GENERAL',
        titulo: `Te asignaron la solicitud ${s?.radicado ?? ''}`,
        mensaje: `${actor.nombre} te asignó la solicitud de ${s?.nombre ?? ''}${s?.empresa ? ` (${s.empresa})` : ''}.`,
        referencia_id: id,
        referencia_tipo: 'solicitud_web'
      })
      emitNotificacion(n)
    } catch (error) {
      logger.error({ err: error, id }, '[solicitudes-web] no se pudo avisar la asignación')
    }
  }

  return detalle(id)
}
