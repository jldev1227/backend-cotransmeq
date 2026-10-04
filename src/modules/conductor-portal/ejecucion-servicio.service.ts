import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '../../config/prisma'
import { businessDateFor, isFormError } from '../formularios-dinamicos/domain'
import { condicionAcceso } from '../formularios-dinamicos/formularios-portal.service'
import { lockSubmissionPorId, TX_OPCIONES } from '../formularios-dinamicos/formularios-portal.locks'
import { aplicarEfectosColaterales, type ServicioEstado } from '../servicios/servicios.estados'
import { emitServicioEstadoActualizado } from '../servicios/servicios.events'
import { ServiciosService } from '../servicios/servicios.service'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { emitNotificacion } from '../../sockets'

/**
 * Inicio y liberación de un servicio por el conductor desde la app.
 *
 * El conductor inicia el servicio con un preoperacional V2 (por etapas) del
 * vehículo del servicio y lo libera al terminar, con un reporte del recorrido.
 * Lo que hizo queda en `servicio_ejecucion` (1:1); el servicio cambia de estado
 * con la máquina de estados de siempre, así que conductor y vehículo pasan a
 * `servicio` al iniciar y vuelven a `disponible` al liberar.
 *
 * Tres reglas que no se negocian:
 *  - `servicios.fecha_realizacion` es la fecha PLANEADA y no se toca al iniciar.
 *  - El «día» es la fecha en America/Bogota; un inicio diferido (cola offline)
 *    usa el día del teléfono, no el del servidor.
 *  - Iniciar y liberar son idempotentes: la cola offline los reintenta.
 */

export class EjecucionServicioError extends Error {
  constructor(message: string, readonly status: number, readonly code?: string) {
    super(message)
  }
}

const ZONA_HORARIA = 'America/Bogota'
/// Margen para relojes de teléfono adelantados al validar la hora de liberación.
const TOLERANCIA_FUTURO_MS = 10 * 60 * 1000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const CODIGO_AUTOMOVILES = 'HSEQ-FR-08'
const CODIGO_BUSES = 'HSEQ-FR-09'

/// Estados en que el conductor inicia el servicio desde la app. `en_curso` también:
/// operaciones puede marcarlo en curso un minuto antes de que el conductor asocie
/// el prealistamiento, y ese inicio no debe perderse.
const ESTADOS_PARA_INICIAR: ServicioEstado[] = ['planificado', 'en_curso']
/// Realizado por operaciones sin pasar por la app: solo se le asocia el
/// preoperacional. No cambia de estado y no se libera desde la app.
const ESTADOS_PARA_ASOCIAR: ServicioEstado[] = ['realizado']

/** Versiones por etapas del motor de formularios (`settings.modo = 'ETAPAS'`). */
const VERSION_POR_ETAPAS: Prisma.form_versionWhereInput = {
  settings_json: { path: ['modo'], equals: 'ETAPAS' }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reglas puras
// ─────────────────────────────────────────────────────────────────────────────

function normalizarClase(clase: string | null | undefined): string {
  return (clase ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Formato recomendado por la clase del vehículo. Cualquier clase que no sea de
 * las dos familias (CAMION, POR DEFINIR, OTRO, vacío) no recomienda ninguno y
 * el conductor elige.
 */
export function formatoRecomendado(clase: string | null | undefined): string | null {
  const c = normalizarClase(clase)
  if (['CAMIONETA', 'CAMPERO', 'AUTOMOVIL'].includes(c)) return CODIGO_AUTOMOVILES
  if (['BUS', 'BUSETA', 'MICROBUS'].includes(c)) return CODIGO_BUSES
  return null
}

/** Etapas cerradas: un envío entregado las tiene todas; un borrador, las que respaldó la app. */
export function etapasCerradas(status: string, deviceJson: unknown): number[] {
  if (status === 'SUBMITTED') return [1, 2, 3]
  const crudas = (deviceJson as { stagesClosed?: unknown } | null)?.stagesClosed
  if (!Array.isArray(crudas)) return []
  const numeros = crudas.map((n) => Number(n)).filter((n) => Number.isInteger(n) && n > 0)
  return [...new Set(numeros)].sort((a, b) => a - b)
}

const diaBogota = (instante: Date) => businessDateFor(instante, ZONA_HORARIA)

/** `business_date` es DATE: Prisma lo devuelve como medianoche UTC. */
const diaDeFecha = (fecha: Date) => fecha.toISOString().slice(0, 10)

/** El envío es del día si su fecha de negocio o su inicio caen ese día en Bogotá. */
function esDelDia(sub: { business_date: Date; started_at: Date }, dia: string): boolean {
  return diaDeFecha(sub.business_date) === dia || diaBogota(sub.started_at) === dia
}

function rangoDelDia(dia: string): { desde: Date; hasta: Date } {
  /// Bogotá no tiene horario de verano: el día local es siempre UTC-5.
  const desde = new Date(`${dia}T00:00:00-05:00`)
  return { desde, hasta: new Date(desde.getTime() + 24 * 60 * 60 * 1000) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lecturas
// ─────────────────────────────────────────────────────────────────────────────

const submissionSelect = {
  id: true,
  client_submission_id: true,
  assignment_id: true,
  status: true,
  device_json: true,
  updated_at: true,
  version: { select: { form: { select: { code: true } } } }
} satisfies Prisma.form_submissionSelect

const servicioSelect = {
  id: true,
  estado: true,
  conductor_id: true,
  vehiculo_id: true,
  vehiculos: { select: { id: true, placa: true, clase_vehiculo: true } },
  ejecucion: {
    include: { preoperacional: { select: submissionSelect } }
  }
} satisfies Prisma.servicioSelect

type ServicioCargado = Prisma.servicioGetPayload<{ select: typeof servicioSelect }>

async function cargarServicio(servicioId: string, conductorId: string): Promise<ServicioCargado> {
  if (!UUID_RE.test(servicioId)) throw new EjecucionServicioError('Servicio no encontrado', 404)
  const servicio = await prisma.servicio.findFirst({
    where: { id: servicioId, conductor_id: conductorId, deleted_at: null },
    select: servicioSelect
  })
  if (!servicio) throw new EjecucionServicioError('Servicio no encontrado', 404)
  return servicio
}

interface FormatoV2 {
  assignment_id: string
  code: string
  name: string
}

/**
 * Asignaciones de preoperacional por etapas que el conductor ve hoy en su
 * portal. Misma definición de «accesible» que el listado de formularios
 * (`condicionAcceso`) más la vigencia, para que la app no ofrezca un formato
 * que luego el portal de formularios rechazaría.
 */
async function formatosV2(conductorId: string): Promise<FormatoV2[]> {
  let acceso: Prisma.form_assignmentWhereInput
  try {
    acceso = await condicionAcceso({ kind: 'CONDUCTOR', id: conductorId })
  } catch (err) {
    if (isFormError(err)) return []
    throw err
  }
  const ahora = new Date()
  const asignaciones = await prisma.form_assignment.findMany({
    where: { AND: [acceso, { version: VERSION_POR_ETAPAS }] },
    select: {
      id: true,
      name: true,
      starts_at: true,
      ends_at: true,
      version: { select: { form: { select: { code: true, name: true } } } }
    },
    orderBy: { created_at: 'asc' }
  })
  return asignaciones
    .filter((a) => (!a.starts_at || ahora >= a.starts_at) && (!a.ends_at || ahora <= a.ends_at))
    .map((a) => ({ assignment_id: a.id, code: a.version.form.code, name: a.version.form.name }))
}

type SubmissionResumen = Prisma.form_submissionGetPayload<{ select: typeof submissionSelect }>

function resumenPreoperacional(sub: SubmissionResumen) {
  return {
    submission_id: sub.id,
    client_submission_id: sub.client_submission_id,
    assignment_id: sub.assignment_id,
    code: sub.version.form.code,
    status: sub.status as 'DRAFT' | 'SUBMITTED',
    etapas_cerradas: etapasCerradas(sub.status, sub.device_json)
  }
}

const CAMPOS_REPORTE = [
  'km_final',
  'via_trocha',
  'via_afirmado',
  'via_mixto',
  'via_pavimentada',
  'riesgo_desniveles',
  'riesgo_deslizamientos',
  'riesgo_sin_senalizacion',
  'riesgo_animales',
  'riesgo_peatones',
  'riesgo_trafico_alto',
  'estado_conductor',
  'novedades'
] as const

async function construirEjecucion(servicio: ServicioCargado, conductorId: string) {
  const formatos = await formatosV2(conductorId)
  const habilitado = formatos.length > 0
  const recomendado = formatoRecomendado(servicio.vehiculos?.clase_vehiculo)
  const estado = servicio.estado as ServicioEstado
  const ejecucion = servicio.ejecucion

  /// Preoperacionales del día del conductor para el vehículo del servicio. Se
  /// filtra por VERSIÓN por etapas y no por las asignaciones vigentes: un
  /// borrador empezado antes de que la asignación pasara a otra versión sigue
  /// sirviendo.
  let preoperacionalesDelDia: (ReturnType<typeof resumenPreoperacional> & { updated_at: string })[] = []
  if (servicio.vehiculo_id) {
    const hoy = diaBogota(new Date())
    const { desde, hasta } = rangoDelDia(hoy)
    const filas = await prisma.form_submission.findMany({
      where: {
        conductor_id: conductorId,
        vehicle_id: servicio.vehiculo_id,
        deleted_at: null,
        status: { in: ['DRAFT', 'SUBMITTED'] },
        version: VERSION_POR_ETAPAS,
        AND: [
          { OR: [{ service_id: null }, { service_id: servicio.id }] },
          {
            OR: [
              { business_date: new Date(`${hoy}T00:00:00.000Z`) },
              { started_at: { gte: desde, lt: hasta } }
            ]
          }
        ]
      },
      select: submissionSelect,
      orderBy: { updated_at: 'desc' }
    })
    preoperacionalesDelDia = filas.map((f) => ({
      ...resumenPreoperacional(f),
      updated_at: f.updated_at.toISOString()
    }))
  }

  const iniciado = Boolean(ejecucion?.iniciado_at)
  const preoperacional = ejecucion?.preoperacional ? resumenPreoperacional(ejecucion.preoperacional) : null
  const tieneReporte = ejecucion ? CAMPOS_REPORTE.some((c) => ejecucion[c] !== null) : false

  return {
    habilitado,
    estado,
    puede_iniciar: habilitado && !iniciado && Boolean(servicio.vehiculo_id) && ESTADOS_PARA_INICIAR.includes(estado),
    /// Aparte de `puede_iniciar` para que una app anterior, que no lo conoce, no
    /// ofrezca iniciar ni liberar un servicio ya realizado.
    puede_asociar: habilitado && !iniciado && Boolean(servicio.vehiculo_id) && ESTADOS_PARA_ASOCIAR.includes(estado),
    puede_liberar:
      estado === 'en_curso' && iniciado && !ejecucion?.liberado_at && preoperacional?.status === 'SUBMITTED',
    vehiculo: servicio.vehiculos
      ? {
          id: servicio.vehiculos.id,
          placa: servicio.vehiculos.placa,
          clase_vehiculo: servicio.vehiculos.clase_vehiculo ?? null
        }
      : null,
    formatos: formatos.map((f) => ({ ...f, recomendado: recomendado !== null && f.code === recomendado })),
    preoperacionales_del_dia: preoperacionalesDelDia,
    ejecucion: ejecucion
      ? {
          iniciado_at: ejecucion.iniciado_at?.toISOString() ?? null,
          liberado_at: ejecucion.liberado_at?.toISOString() ?? null,
          iniciado_diferido: ejecucion.iniciado_diferido,
          liberado_diferido: ejecucion.liberado_diferido,
          recomendaciones: ejecucion.recomendaciones,
          preoperacional,
          reporte: tieneReporte
            ? {
                km_final: ejecucion.km_final,
                via_trocha: ejecucion.via_trocha,
                via_afirmado: ejecucion.via_afirmado,
                via_mixto: ejecucion.via_mixto,
                via_pavimentada: ejecucion.via_pavimentada,
                riesgo_desniveles: ejecucion.riesgo_desniveles,
                riesgo_deslizamientos: ejecucion.riesgo_deslizamientos,
                riesgo_sin_senalizacion: ejecucion.riesgo_sin_senalizacion,
                riesgo_animales: ejecucion.riesgo_animales,
                riesgo_peatones: ejecucion.riesgo_peatones,
                riesgo_trafico_alto: ejecucion.riesgo_trafico_alto,
                estado_conductor: ejecucion.estado_conductor,
                novedades: ejecucion.novedades
              }
            : null
        }
      : null
  }
}

export async function obtenerEjecucion(servicioId: string, conductorId: string) {
  return construirEjecucion(await cargarServicio(servicioId, conductorId), conductorId)
}

// ─────────────────────────────────────────────────────────────────────────────
// Escrituras
// ─────────────────────────────────────────────────────────────────────────────

const fechaIso = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Fecha inválida')
  .transform((v) => new Date(v))

const iniciarSchema = z.object({
  client_submission_id: z.string().regex(UUID_RE, 'client_submission_id inválido'),
  dispositivo_at: fechaIso,
  diferido: z.boolean().optional().default(false),
  formato_elegido: z.boolean().optional().default(false)
})

const reporteSchema = z
  .object({
    km_final: z.number().int().min(0).max(10_000_000).nullable().optional(),
    via_trocha: z.boolean().nullable().optional(),
    via_afirmado: z.boolean().nullable().optional(),
    via_mixto: z.boolean().nullable().optional(),
    via_pavimentada: z.boolean().nullable().optional(),
    riesgo_desniveles: z.boolean().nullable().optional(),
    riesgo_deslizamientos: z.boolean().nullable().optional(),
    riesgo_sin_senalizacion: z.boolean().nullable().optional(),
    riesgo_animales: z.boolean().nullable().optional(),
    riesgo_peatones: z.boolean().nullable().optional(),
    riesgo_trafico_alto: z.boolean().nullable().optional(),
    estado_conductor: z.enum(['optimo', 'fatigado', 'regular', 'malo']).nullable().optional(),
    novedades: z.string().max(5000).nullable().optional()
  })
  .strict()

const liberarSchema = z.object({
  liberado_at: fechaIso,
  dispositivo_at: fechaIso,
  diferido: z.boolean().optional().default(false),
  reporte: reporteSchema.optional()
})

const recomendacionesSchema = z.object({
  recomendaciones: z.string().trim().min(1, 'Escribe la recomendación').max(5000)
})

function parsear<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const r = schema.safeParse(body ?? {})
  if (!r.success) {
    const detalle = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
    throw new EjecucionServicioError(`Datos inválidos: ${detalle}`, 400, 'DATOS_INVALIDOS')
  }
  return r.data
}

/** Bloquea la fila del servicio: dos inicios (o un inicio y una liberación) no se cruzan. */
async function bloquearServicio(tx: Prisma.TransactionClient, servicioId: string) {
  await tx.$queryRaw`SELECT id FROM servicios WHERE id = ${servicioId}::uuid FOR UPDATE`
  const servicio = await tx.servicio.findFirst({
    where: { id: servicioId, deleted_at: null },
    select: { estado: true, conductor_id: true, vehiculo_id: true }
  })
  if (!servicio) throw new EjecucionServicioError('Servicio no encontrado', 404)
  return servicio
}

/** Emite el mismo evento que el cambio de estado del dashboard. Nunca deshace lo guardado. */
async function avisarCambioDeEstado(servicioId: string, estadoAnterior: string) {
  try {
    const servicio = await ServiciosService.findById(servicioId)
    if (servicio) emitServicioEstadoActualizado(servicio, estadoAnterior)
  } catch {
    /* el aviso en tiempo real no es parte de la operación */
  }
}

/**
 * Avisa al área de operaciones que el conductor liberó el servicio: una
 * notificación por usuario (con id, para que la campana la marque como leída) y
 * el mismo aviso por socket. Al abrirla, el portal va al detalle del servicio.
 *
 * Nunca deshace la liberación: ya quedó guardada cuando esto corre.
 */
async function notificarLiberacionAOperaciones(servicioId: string) {
  try {
    const servicio = await prisma.servicio.findUnique({
      where: { id: servicioId },
      select: {
        conductores: { select: { nombre: true, apellido: true } },
        vehiculos: { select: { placa: true } },
        municipios_servicio_origen_idTomunicipios: { select: { nombre_municipio: true } },
        municipios_servicio_destino_idTomunicipios: { select: { nombre_municipio: true } }
      }
    })
    if (!servicio) return
    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { has: 'operaciones' } },
      select: { id: true }
    })
    const conductor =
      `${servicio.conductores?.nombre ?? ''} ${servicio.conductores?.apellido ?? ''}`.trim() || 'Un conductor'
    const origen = servicio.municipios_servicio_origen_idTomunicipios?.nombre_municipio
    const destino = servicio.municipios_servicio_destino_idTomunicipios?.nombre_municipio
    const ruta = origen && destino ? ` ${origen} → ${destino}` : ''
    const placa = servicio.vehiculos?.placa ? ` (${servicio.vehiculos.placa})` : ''
    for (const usuario of usuarios) {
      const notificacion = await NotificacionesService.crear({
        usuario_id: usuario.id,
        tipo: 'GENERAL',
        titulo: 'Servicio realizado',
        mensaje: `${conductor} liberó el servicio${ruta}${placa}. Toca para ver el detalle.`,
        referencia_id: servicioId,
        referencia_tipo: 'servicio'
      })
      emitNotificacion(notificacion)
    }
  } catch {
    /* el aviso no es parte de la operación */
  }
}

export async function iniciarServicio(servicioId: string, conductorId: string, body: unknown) {
  const input = parsear(iniciarSchema, body)
  const servicio = await cargarServicio(servicioId, conductorId)

  /// Reintento de la cola offline: ya estaba iniciado con este mismo preoperacional.
  if (servicio.ejecucion?.iniciado_at) {
    if (servicio.ejecucion.preoperacional?.client_submission_id === input.client_submission_id) {
      return construirEjecucion(servicio, conductorId)
    }
    throw new EjecucionServicioError('El servicio ya se inició con otro preoperacional.', 409, 'ESTADO_INVALIDO')
  }

  const formatos = await formatosV2(conductorId)
  if (!formatos.length) {
    throw new EjecucionServicioError('No tienes habilitado el inicio de servicios desde la app.', 403, 'NO_HABILITADO')
  }

  const estadoAnterior = servicio.estado as ServicioEstado
  if (!ESTADOS_PARA_INICIAR.includes(estadoAnterior) && !ESTADOS_PARA_ASOCIAR.includes(estadoAnterior)) {
    throw new EjecucionServicioError(`El servicio está ${estadoAnterior}; no se puede iniciar.`, 409, 'ESTADO_INVALIDO')
  }
  if (!servicio.vehiculo_id) {
    throw new EjecucionServicioError('El servicio no tiene vehículo asignado.', 422, 'SIN_VEHICULO')
  }

  const sub = await prisma.form_submission.findFirst({
    where: { client_submission_id: input.client_submission_id, conductor_id: conductorId, deleted_at: null },
    select: {
      id: true,
      status: true,
      vehicle_id: true,
      service_id: true,
      business_date: true,
      started_at: true,
      version: { select: { settings_json: true } }
    }
  })
  if (!sub) {
    throw new EjecucionServicioError(
      'El preoperacional todavía no llega al servidor. Se reintentará.',
      409,
      'PREOPERACIONAL_NO_SINCRONIZADO'
    )
  }
  const esPorEtapas = (sub.version.settings_json as { modo?: unknown } | null)?.modo === 'ETAPAS'
  if (!esPorEtapas || (sub.status !== 'DRAFT' && sub.status !== 'SUBMITTED')) {
    throw new EjecucionServicioError('Ese formulario no es un preoperacional válido para iniciar.', 422, 'PREOPERACIONAL_INVALIDO')
  }
  if (sub.vehicle_id !== servicio.vehiculo_id) {
    throw new EjecucionServicioError('El preoperacional es de otro vehículo.', 422, 'VEHICULO_DISTINTO')
  }
  const diaInicio = diaBogota(input.diferido ? input.dispositivo_at : new Date())
  if (!esDelDia(sub, diaInicio)) {
    throw new EjecucionServicioError('El preoperacional es de otro día.', 422, 'OTRO_DIA')
  }

  const recomendado = formatoRecomendado(servicio.vehiculos?.clase_vehiculo)
  const ahora = new Date()

  await prisma.$transaction(async (tx) => {
    /// Mismo lock de fila que el backup y el envío del formulario: sin él, un
    /// backup en vuelo podría reescribir `service_id` justo después de ligarlo.
    const bloqueada = await lockSubmissionPorId(tx, sub.id)
    if (!bloqueada || bloqueada.deleted_at) {
      throw new EjecucionServicioError(
        'El preoperacional todavía no llega al servidor. Se reintentará.',
        409,
        'PREOPERACIONAL_NO_SINCRONIZADO'
      )
    }
    const actual = await tx.form_submission.findUnique({
      where: { id: sub.id },
      select: { status: true, device_json: true, service_id: true, vehicle_id: true }
    })
    if (!actual) throw new EjecucionServicioError('Preoperacional no encontrado', 404)
    if (actual.service_id && actual.service_id !== servicioId) {
      throw new EjecucionServicioError(
        'Ese preoperacional ya está ligado a otro servicio.',
        409,
        'PREOPERACIONAL_EN_OTRO_SERVICIO'
      )
    }
    if (actual.vehicle_id !== servicio.vehiculo_id) {
      throw new EjecucionServicioError('El preoperacional es de otro vehículo.', 422, 'VEHICULO_DISTINTO')
    }
    if (actual.status === 'DRAFT' && !etapasCerradas(actual.status, actual.device_json).includes(1)) {
      throw new EjecucionServicioError(
        'La etapa 1 del preoperacional (prealistamiento) no está cerrada.',
        409,
        'ETAPA1_ABIERTA'
      )
    }

    const enBase = await bloquearServicio(tx, servicioId)
    const previa = await tx.servicio_ejecucion.findUnique({
      where: { servicio_id: servicioId },
      select: { iniciado_at: true, preoperacional_submission_id: true }
    })
    if (previa?.iniciado_at) {
      if (previa.preoperacional_submission_id === sub.id) return
      throw new EjecucionServicioError('El servicio ya se inició con otro preoperacional.', 409, 'ESTADO_INVALIDO')
    }
    const estadoEnBase = enBase.estado as ServicioEstado
    if (!ESTADOS_PARA_INICIAR.includes(estadoEnBase) && !ESTADOS_PARA_ASOCIAR.includes(estadoEnBase)) {
      throw new EjecucionServicioError(`El servicio está ${enBase.estado}; no se puede iniciar.`, 409, 'ESTADO_INVALIDO')
    }

    await tx.form_submission.update({ where: { id: sub.id }, data: { service_id: servicioId } })

    const datos = {
      conductor_id: conductorId,
      preoperacional_submission_id: sub.id,
      formato_elegido_por_conductor: recomendado === null && input.formato_elegido,
      iniciado_at: ahora,
      iniciado_dispositivo_at: input.dispositivo_at,
      iniciado_diferido: input.diferido
    }
    await tx.servicio_ejecucion.upsert({
      where: { servicio_id: servicioId },
      create: { servicio_id: servicioId, ...datos },
      update: datos
    })

    /// En curso o realizado por operaciones: el estado ya es el correcto.
    if (estadoEnBase !== 'planificado') return

    /// Solo el estado: `fecha_realizacion` es la fecha planeada y no se toca.
    await tx.servicio.update({ where: { id: servicioId }, data: { estado: 'en_curso' } })
    await aplicarEfectosColaterales({
      servicioId,
      estadoAnterior: enBase.estado as ServicioEstado,
      estadoNuevo: 'en_curso',
      conductorIdAnterior: enBase.conductor_id,
      conductorIdNuevo: enBase.conductor_id,
      vehiculoIdAnterior: enBase.vehiculo_id,
      vehiculoIdNuevo: enBase.vehiculo_id,
      tx
    })
  }, TX_OPCIONES)

  const actualizado = await cargarServicio(servicioId, conductorId)
  if (actualizado.estado !== estadoAnterior) await avisarCambioDeEstado(servicioId, estadoAnterior)
  return construirEjecucion(actualizado, conductorId)
}

export async function liberarServicio(servicioId: string, conductorId: string, body: unknown) {
  const input = parsear(liberarSchema, body)
  const servicio = await cargarServicio(servicioId, conductorId)
  const ejecucion = servicio.ejecucion

  /// Reintento de la cola offline: ya estaba liberado.
  if (ejecucion?.liberado_at) return construirEjecucion(servicio, conductorId)

  if (servicio.estado !== 'en_curso' || !ejecucion?.iniciado_at) {
    throw new EjecucionServicioError('El servicio no fue iniciado desde la app.', 409, 'NO_INICIADO')
  }
  if (ejecucion.preoperacional?.status !== 'SUBMITTED') {
    throw new EjecucionServicioError(
      'El preoperacional todavía no está enviado. Se reintentará.',
      409,
      'PREOPERACIONAL_ABIERTO'
    )
  }

  const ahora = new Date()
  const desde = ejecucion.iniciado_dispositivo_at ?? ejecucion.iniciado_at
  if (input.liberado_at < desde || input.liberado_at.getTime() > ahora.getTime() + TOLERANCIA_FUTURO_MS) {
    throw new EjecucionServicioError(
      'La hora de liberación debe estar entre el inicio del servicio y ahora.',
      422,
      'HORA_INVALIDA'
    )
  }

  const reporte = input.reporte ?? {}

  await prisma.$transaction(async (tx) => {
    const enBase = await bloquearServicio(tx, servicioId)
    const previa = await tx.servicio_ejecucion.findUnique({
      where: { servicio_id: servicioId },
      select: { iniciado_at: true, liberado_at: true }
    })
    if (previa?.liberado_at) return
    if (enBase.estado !== 'en_curso' || !previa?.iniciado_at) {
      throw new EjecucionServicioError('El servicio no fue iniciado desde la app.', 409, 'NO_INICIADO')
    }

    await tx.servicio_ejecucion.update({
      where: { servicio_id: servicioId },
      data: {
        liberado_at: input.liberado_at,
        liberado_registrado_at: ahora,
        liberado_dispositivo_at: input.dispositivo_at,
        liberado_diferido: input.diferido,
        ...reporte
      }
    })
    await tx.servicio.update({
      where: { id: servicioId },
      data: { estado: 'realizado', fecha_finalizacion: input.liberado_at }
    })
    await aplicarEfectosColaterales({
      servicioId,
      estadoAnterior: 'en_curso',
      estadoNuevo: 'realizado',
      conductorIdAnterior: enBase.conductor_id,
      conductorIdNuevo: enBase.conductor_id,
      vehiculoIdAnterior: enBase.vehiculo_id,
      vehiculoIdNuevo: enBase.vehiculo_id,
      tx
    })
  }, TX_OPCIONES)

  const actualizado = await cargarServicio(servicioId, conductorId)
  /// Solo la primera liberación avisa: el reintento de la cola offline sale arriba sin pasar por aquí, y si
  /// otra petición ganó la carrera el estado ya venía en `realizado`.
  if (actualizado.estado !== servicio.estado) {
    await avisarCambioDeEstado(servicioId, servicio.estado)
    await notificarLiberacionAOperaciones(servicioId)
  }
  return construirEjecucion(actualizado, conductorId)
}

/**
 * Recomendaciones u observaciones del conductor después de liberar. Opcionales
 * y aparte de `novedades`. Reenviar las reemplaza: la cola offline puede
 * repetir la petición y el conductor puede corregirlas.
 */
export async function guardarRecomendaciones(servicioId: string, conductorId: string, body: unknown) {
  const input = parsear(recomendacionesSchema, body)
  const servicio = await cargarServicio(servicioId, conductorId)
  if (!servicio.ejecucion?.liberado_at) {
    throw new EjecucionServicioError('El servicio todavía no está liberado.', 409, 'NO_LIBERADO')
  }
  await prisma.servicio_ejecucion.update({
    where: { servicio_id: servicioId },
    data: { recomendaciones: input.recomendaciones, recomendaciones_at: new Date() }
  })
  return construirEjecucion(await cargarServicio(servicioId, conductorId), conductorId)
}
