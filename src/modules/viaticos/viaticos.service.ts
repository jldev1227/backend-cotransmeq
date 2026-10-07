/**
 * Viáticos: anticipos que operaciones entrega a un conductor y los gastos con
 * que el conductor los legaliza.
 *
 * ── El modelo ──
 * - Un ANTICIPO es dinero entregado a un conductor para una placa, por
 *   transferencia (con comprobante y fecha) o por retiro con una tarjeta o
 *   cuenta de la empresa (se anota cuál).
 * - Un GASTO es lo que el conductor reporta desde la app: el valor total de las
 *   facturas que adjunta (una por foto, o varias en un PDF). Se descuenta del
 *   saldo apenas se registra. Operaciones puede ANULARLO con un motivo; nunca se
 *   borra, para no perder la traza contable.
 * - El SALDO no se guarda: `valor - SUM(gastos no anulados)`. Puede quedar
 *   negativo si el conductor gastó más de lo anticipado: es lo que la empresa le
 *   debe, y se muestra así.
 * - Cuando el saldo baja al 15 % del valor se avisa una vez a operaciones y al
 *   conductor (`alerta_saldo_bajo_at`). Si una anulación lo sube otra vez, la
 *   marca se limpia y una nueva caída vuelve a avisar.
 * - Una SOLICITUD es el conductor pidiendo más dinero desde un anticipo. La
 *   aprueba o rechaza operaciones; aprobar es registrar un anticipo nuevo con
 *   el mismo conductor y la misma placa (no se pueden cambiar).
 *
 * Lo usan el panel (`viaticos.routes.ts`) y el portal del conductor
 * (`viaticos-portal.routes.ts`). En el portal la identidad sale SIEMPRE del
 * token, nunca del cuerpo.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '../../config/prisma'
import {
  computeS3ObjectSha256,
  getS3SignedUrl,
  getS3UploadUrl,
  headS3Object,
  sha256HexToBase64
} from '../../config/aws'
import { env } from '../../config/env'
import { logger } from '../../utils/logger'
import { emitNotificacion } from '../../sockets'
import { NotificacionesService } from '../notificaciones/notificaciones.service'
import { enviarPushConductor } from '../conductor-portal/conductor-push.service'

export class ViaticosError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message)
  }
}

/** Fracción del anticipo por debajo de la cual el saldo se considera bajo. */
export const UMBRAL_SALDO_BAJO = 0.15
export const MAX_BYTES_ARCHIVO = 10 * 1024 * 1024
export const MAX_ADJUNTOS_POR_GASTO = 10

const EXTENSION_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/pdf': 'pdf'
}
const PREFIJO_S3 = 'viaticos'
const TTL_URL_LECTURA_SEGUNDOS = 3600
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CANAL_PUSH = 'viaticos'

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades
// ─────────────────────────────────────────────────────────────────────────────

export function parsear<T>(schema: z.ZodType<T, any, any>, body: unknown): T {
  const r = schema.safeParse(body ?? {})
  if (!r.success) {
    const primero = r.error.issues[0]
    const campo = primero?.path?.join('.')
    throw new ViaticosError(`${campo ? `${campo}: ` : ''}${primero?.message ?? 'Datos inválidos'}`, 400, 'DATOS_INVALIDOS')
  }
  return r.data
}

function exigirUuid(id: string, que: string): string {
  if (!UUID_RE.test(id)) throw new ViaticosError(`${que} no existe.`, 404, 'NO_ENCONTRADO')
  return id
}

const aFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const deFecha = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null)
const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))
const redondear = (v: number) => Math.round(v * 100) / 100

const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'debe tener formato YYYY-MM-DD')
const dinero = z.coerce.number().positive('debe ser mayor que cero').max(9_999_999_999, 'es demasiado grande')
const idCliente = z
  .string()
  .trim()
  .min(1)
  .max(64)
  /// Va dentro de claves de S3: nada que pueda escaparse del prefijo.
  .regex(/^[A-Za-z0-9_-]+$/, 'solo admite letras, números, guion y guion bajo')

function nombreConductor(c: { nombre: string; apellido: string }) {
  return `${c.nombre} ${c.apellido}`.trim()
}

async function urlLectura(key: string | null): Promise<string | null> {
  if (!key) return null
  try {
    return await getS3SignedUrl(key, TTL_URL_LECTURA_SEGUNDOS)
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Saldo
// ─────────────────────────────────────────────────────────────────────────────

/** Suma de gastos vigentes por anticipo, en una sola consulta. */
async function gastadoPorAnticipo(ids: string[]): Promise<Map<string, number>> {
  if (!ids.length) return new Map()
  const filas = await prisma.viatico_gasto.groupBy({
    by: ['anticipo_id'],
    where: { anticipo_id: { in: ids }, anulado_at: null },
    _sum: { valor: true }
  })
  return new Map(filas.map((f) => [f.anticipo_id, num(f._sum.valor)]))
}

export interface SaldoAnticipo {
  valor: number
  gastado: number
  saldo: number
  /** Porcentaje del anticipo que queda (0–100; puede ser negativo). */
  porcentaje_restante: number
  saldo_bajo: boolean
  agotado: boolean
}

export function calcularSaldo(valor: number, gastado: number): SaldoAnticipo {
  const saldo = redondear(valor - gastado)
  const porcentaje = valor > 0 ? Math.round((saldo / valor) * 1000) / 10 : 0
  return {
    valor,
    gastado: redondear(gastado),
    saldo,
    porcentaje_restante: porcentaje,
    saldo_bajo: saldo <= valor * UMBRAL_SALDO_BAJO,
    agotado: saldo <= 0
  }
}

const incluirResumen = {
  conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
  vehiculo: { select: { id: true, placa: true, marca: true, linea: true } },
  creado_por: { select: { id: true, nombre: true } },
  solicitudes: { where: { estado: 'PENDIENTE' }, select: { id: true, valor_solicitado: true, created_at: true } }
} satisfies Prisma.viatico_anticipoInclude

type AnticipoConResumen = Prisma.viatico_anticipoGetPayload<{ include: typeof incluirResumen }>

function aResumen(a: AnticipoConResumen, gastado: number) {
  const pendiente = a.solicitudes[0]
  return {
    id: a.id,
    conductor: {
      id: a.conductor.id,
      nombre: nombreConductor(a.conductor),
      numero_identificacion: a.conductor.numero_identificacion
    },
    vehiculo: { id: a.vehiculo.id, placa: a.vehiculo.placa, descripcion: [a.vehiculo.marca, a.vehiculo.linea].filter(Boolean).join(' ') },
    concepto: a.concepto,
    metodo: a.metodo as 'TRANSFERENCIA' | 'RETIRO_TARJETA',
    fecha: deFecha(a.fecha),
    numero_comprobante: a.numero_comprobante,
    entidad: a.entidad,
    tarjeta_cuenta: a.tarjeta_cuenta,
    tiene_comprobante: Boolean(a.comprobante_key),
    solicitud_id: a.solicitud_id,
    solicitud_pendiente: pendiente
      ? { id: pendiente.id, valor_solicitado: num(pendiente.valor_solicitado), created_at: pendiente.created_at.toISOString() }
      : null,
    creado_por: a.creado_por ? { id: a.creado_por.id, nombre: a.creado_por.nombre } : null,
    created_at: a.created_at.toISOString(),
    ...calcularSaldo(num(a.valor), gastado)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Listado y detalle de anticipos
// ─────────────────────────────────────────────────────────────────────────────

const listarSchema = z.object({
  q: z.string().trim().max(120).optional(),
  estado: z.enum(['todos', 'con_saldo', 'saldo_bajo', 'agotados']).optional().default('todos'),
  conductor_id: z.string().uuid().optional(),
  vehiculo_id: z.string().uuid().optional(),
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
})

/**
 * Listado del panel. El filtro por estado depende del saldo, que se calcula:
 * se traen todos los que cumplen los demás filtros y se filtra y pagina en
 * memoria. Son decenas o pocos cientos de anticipos vigentes, no millones.
 */
export async function listarAnticipos(query: unknown) {
  const f = parsear(listarSchema, query)
  const where: Prisma.viatico_anticipoWhereInput = { deleted_at: null }
  if (f.conductor_id) where.conductor_id = f.conductor_id
  if (f.vehiculo_id) where.vehiculo_id = f.vehiculo_id
  if (f.desde || f.hasta) where.fecha = { ...(f.desde ? { gte: aFecha(f.desde) } : {}), ...(f.hasta ? { lte: aFecha(f.hasta) } : {}) }
  if (f.q) {
    const palabras = f.q.split(/\s+/).filter(Boolean)
    where.AND = palabras.map((p) => ({
      OR: [
        { concepto: { contains: p, mode: 'insensitive' } },
        { numero_comprobante: { contains: p, mode: 'insensitive' } },
        { tarjeta_cuenta: { contains: p, mode: 'insensitive' } },
        { vehiculo: { placa: { contains: p, mode: 'insensitive' } } },
        { conductor: { nombre: { contains: p, mode: 'insensitive' } } },
        { conductor: { apellido: { contains: p, mode: 'insensitive' } } },
        { conductor: { numero_identificacion: { contains: p } } }
      ]
    }))
  }
  const anticipos = await prisma.viatico_anticipo.findMany({
    where,
    include: incluirResumen,
    orderBy: [{ fecha: 'desc' }, { created_at: 'desc' }]
  })
  const gastado = await gastadoPorAnticipo(anticipos.map((a) => a.id))
  const todos = anticipos.map((a) => aResumen(a, gastado.get(a.id) ?? 0))

  const conteos = {
    todos: todos.length,
    con_saldo: todos.filter((a) => !a.saldo_bajo).length,
    saldo_bajo: todos.filter((a) => a.saldo_bajo && !a.agotado).length,
    agotados: todos.filter((a) => a.agotado).length
  }
  const filtrados = todos.filter((a) =>
    f.estado === 'con_saldo' ? !a.saldo_bajo : f.estado === 'saldo_bajo' ? a.saldo_bajo && !a.agotado : f.estado === 'agotados' ? a.agotado : true
  )
  const totales = filtrados.reduce(
    (t, a) => ({ anticipado: t.anticipado + a.valor, gastado: t.gastado + a.gastado, saldo: t.saldo + a.saldo }),
    { anticipado: 0, gastado: 0, saldo: 0 }
  )
  const inicio = (f.page - 1) * f.limit
  return {
    data: filtrados.slice(inicio, inicio + f.limit),
    meta: { total: filtrados.length, page: f.page, limit: f.limit, totalPages: Math.max(1, Math.ceil(filtrados.length / f.limit)) },
    conteos,
    totales: { anticipado: redondear(totales.anticipado), gastado: redondear(totales.gastado), saldo: redondear(totales.saldo) },
    solicitudes_pendientes: await prisma.viatico_solicitud.count({ where: { estado: 'PENDIENTE' } })
  }
}

async function adjuntoDto(a: Prisma.viatico_gasto_adjuntoGetPayload<{}>) {
  return {
    id: a.id,
    client_attachment_id: a.client_attachment_id,
    mime_type: a.mime_type,
    byte_size: a.byte_size,
    original_name: a.original_name,
    status: a.status as 'PENDING' | 'UPLOADED',
    url: a.status === 'UPLOADED' ? await urlLectura(a.object_key) : null
  }
}

const incluirGasto = {
  adjuntos: { where: { deleted_at: null }, orderBy: { created_at: 'asc' } },
  anulado_por: { select: { id: true, nombre: true } }
} satisfies Prisma.viatico_gastoInclude

async function gastoDto(g: Prisma.viatico_gastoGetPayload<{ include: typeof incluirGasto }>) {
  return {
    id: g.id,
    client_gasto_id: g.client_gasto_id,
    valor: num(g.valor),
    descripcion: g.descripcion,
    fecha: deFecha(g.fecha),
    anulado: Boolean(g.anulado_at),
    anulado_at: g.anulado_at?.toISOString() ?? null,
    anulado_por: g.anulado_por ? { id: g.anulado_por.id, nombre: g.anulado_por.nombre } : null,
    motivo_anulacion: g.motivo_anulacion,
    created_at: g.created_at.toISOString(),
    adjuntos: await Promise.all(g.adjuntos.map(adjuntoDto))
  }
}

function solicitudDto(s: Prisma.viatico_solicitudGetPayload<{ include: { resuelta_por: { select: { id: true; nombre: true } }; anticipo_generado: { select: { id: true } } } }>) {
  return {
    id: s.id,
    anticipo_origen_id: s.anticipo_origen_id,
    valor_solicitado: num(s.valor_solicitado),
    observaciones: s.observaciones,
    estado: s.estado as 'PENDIENTE' | 'APROBADA' | 'RECHAZADA',
    motivo_rechazo: s.motivo_rechazo,
    resuelta_por: s.resuelta_por ? { id: s.resuelta_por.id, nombre: s.resuelta_por.nombre } : null,
    resuelta_at: s.resuelta_at?.toISOString() ?? null,
    anticipo_generado_id: s.anticipo_generado?.id ?? null,
    created_at: s.created_at.toISOString()
  }
}

/** Detalle de un anticipo. Con `conductorId` solo devuelve uno de ese conductor. */
export async function detalleAnticipo(id: string, conductorId?: string) {
  exigirUuid(id, 'El anticipo')
  const a = await prisma.viatico_anticipo.findFirst({
    where: { id, deleted_at: null, ...(conductorId ? { conductor_id: conductorId } : {}) },
    include: {
      ...incluirResumen,
      actualizado_por: { select: { id: true, nombre: true } },
      gastos: { include: incluirGasto, orderBy: [{ fecha: 'desc' }, { created_at: 'desc' }] },
      solicitudes: {
        include: { resuelta_por: { select: { id: true, nombre: true } }, anticipo_generado: { select: { id: true } } },
        orderBy: { created_at: 'desc' }
      }
    }
  })
  if (!a) throw new ViaticosError('El anticipo no existe.', 404, 'NO_ENCONTRADO')
  const gastado = a.gastos.filter((g) => !g.anulado_at).reduce((s, g) => s + num(g.valor), 0)
  const resumen = aResumen({ ...a, solicitudes: a.solicitudes.filter((s) => s.estado === 'PENDIENTE') }, gastado)
  return {
    ...resumen,
    comprobante: a.comprobante_key
      ? {
          url: await urlLectura(a.comprobante_key),
          mime_type: a.comprobante_mime,
          nombre: a.comprobante_nombre,
          /// El panel la reenvía al editar sin cambiar el archivo.
          key: conductorId ? undefined : a.comprobante_key
        }
      : null,
    /// La lectura automática no se le enseña al conductor: es un dato de control.
    comprobante_lectura: conductorId ? undefined : a.comprobante_lectura,
    actualizado_por: a.actualizado_por ? { id: a.actualizado_por.id, nombre: a.actualizado_por.nombre } : null,
    updated_at: a.updated_at.toISOString(),
    gastos: await Promise.all(a.gastos.map(gastoDto)),
    solicitudes: a.solicitudes.map(solicitudDto)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Comprobante: URL de subida (panel)
// ─────────────────────────────────────────────────────────────────────────────

const presignSchema = z.object({
  nombre: z.string().trim().max(255).optional(),
  mime_type: z.string().trim(),
  byte_size: z.number().int().positive()
})

export async function firmarSubidaComprobante(usuarioId: string, body: unknown) {
  const input = parsear(presignSchema, body)
  const ext = EXTENSION_POR_MIME[input.mime_type]
  if (!ext) throw new ViaticosError('El comprobante debe ser una imagen (JPG, PNG, WEBP) o un PDF.', 415, 'TIPO_NO_ADMITIDO')
  if (input.byte_size > MAX_BYTES_ARCHIVO) throw new ViaticosError('El comprobante no puede pasar de 10 MB.', 413, 'ARCHIVO_GRANDE')
  const key = `${PREFIJO_S3}/comprobantes/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`
  const uploadUrl = await getS3UploadUrl(key, input.mime_type, input.byte_size, null)
  logger.info({ type: 'viatico-comprobante-firmado', usuarioId, key }, '[viaticos] URL de subida de comprobante')
  return { key, upload_url: uploadUrl, headers: { 'Content-Type': input.mime_type } as Record<string, string> }
}

/** Comprueba que el comprobante referenciado existe en S3 y es de este módulo. */
async function verificarComprobante(key: string) {
  if (!key.startsWith(`${PREFIJO_S3}/comprobantes/`) || key.includes('..')) {
    throw new ViaticosError('El comprobante no es válido.', 400, 'COMPROBANTE_INVALIDO')
  }
  const meta = await headS3Object(key)
  if (!meta) throw new ViaticosError('El comprobante todavía no se terminó de subir. Vuelve a intentarlo.', 409, 'ARCHIVO_NO_SUBIDO')
}

// ─────────────────────────────────────────────────────────────────────────────
// Crear, editar y retirar anticipos (panel)
// ─────────────────────────────────────────────────────────────────────────────

const anticipoSchema = z
  .object({
    conductor_id: z.string().uuid('selecciona un conductor'),
    vehiculo_id: z.string().uuid('selecciona una placa'),
    concepto: z.string().trim().min(3, 'escribe el concepto').max(500),
    valor: dinero,
    metodo: z.enum(['TRANSFERENCIA', 'RETIRO_TARJETA']),
    fecha: fechaIso,
    numero_comprobante: z.string().trim().max(60).optional().nullable(),
    entidad: z.string().trim().max(120).optional().nullable(),
    tarjeta_cuenta: z.string().trim().max(120).optional().nullable(),
    comprobante: z
      .object({ key: z.string().min(1), mime_type: z.string(), nombre: z.string().max(255).optional().nullable() })
      .optional()
      .nullable(),
    comprobante_lectura: z.record(z.any()).optional().nullable(),
    solicitud_id: z.string().uuid().optional().nullable()
  })
  .superRefine((v, ctx) => {
    if (v.metodo === 'TRANSFERENCIA' && !v.comprobante) {
      ctx.addIssue({ code: 'custom', path: ['comprobante'], message: 'adjunta el comprobante de la transferencia' })
    }
    if (v.metodo === 'RETIRO_TARJETA' && !v.tarjeta_cuenta?.trim()) {
      ctx.addIssue({ code: 'custom', path: ['tarjeta_cuenta'], message: 'indica de qué tarjeta o cuenta se retiró' })
    }
  })

async function exigirConductorYVehiculo(conductorId: string, vehiculoId: string) {
  const [c, v] = await Promise.all([
    prisma.conductores.findFirst({ where: { id: conductorId, deleted_at: null }, select: { id: true } }),
    prisma.vehiculos.findFirst({ where: { id: vehiculoId, deleted_at: null }, select: { id: true } })
  ])
  if (!c) throw new ViaticosError('El conductor no existe.', 400, 'CONDUCTOR_INVALIDO')
  if (!v) throw new ViaticosError('La placa no existe.', 400, 'VEHICULO_INVALIDO')
}

function datosMetodo(input: z.infer<typeof anticipoSchema>) {
  /// Lo que no aplica al método se limpia: un anticipo por tarjeta no arrastra
  /// el comprobante de una edición anterior como transferencia.
  if (input.metodo === 'TRANSFERENCIA') {
    return {
      numero_comprobante: input.numero_comprobante || null,
      entidad: input.entidad || null,
      tarjeta_cuenta: null,
      comprobante_key: input.comprobante!.key,
      comprobante_mime: input.comprobante!.mime_type,
      comprobante_nombre: input.comprobante!.nombre ?? null,
      comprobante_lectura: (input.comprobante_lectura ?? undefined) as Prisma.InputJsonValue | undefined
    }
  }
  return {
    numero_comprobante: null,
    entidad: null,
    tarjeta_cuenta: input.tarjeta_cuenta!.trim(),
    comprobante_key: null,
    comprobante_mime: null,
    comprobante_nombre: null,
    comprobante_lectura: Prisma.JsonNull
  }
}

export async function crearAnticipo(usuarioId: string, body: unknown) {
  const crudo = (body ?? {}) as Record<string, unknown>
  let solicitud: Awaited<ReturnType<typeof prisma.viatico_solicitud.findUnique>> = null
  if (typeof crudo.solicitud_id === 'string' && crudo.solicitud_id) {
    exigirUuid(crudo.solicitud_id, 'La solicitud')
    solicitud = await prisma.viatico_solicitud.findUnique({ where: { id: crudo.solicitud_id } })
    if (!solicitud) throw new ViaticosError('La solicitud no existe.', 404, 'SOLICITUD_NO_ENCONTRADA')
    if (solicitud.estado !== 'PENDIENTE') {
      throw new ViaticosError('La solicitud ya fue resuelta.', 409, 'SOLICITUD_RESUELTA')
    }
  }
  /// La solicitud nació de un anticipo de ese conductor y esa placa: no se
  /// cambian, se ignore lo que venga en el cuerpo.
  const input = parsear(
    anticipoSchema,
    solicitud ? { ...crudo, conductor_id: solicitud.conductor_id, vehiculo_id: solicitud.vehiculo_id } : crudo
  )
  if (input.metodo === 'TRANSFERENCIA') await verificarComprobante(input.comprobante!.key)
  await exigirConductorYVehiculo(input.conductor_id, input.vehiculo_id)

  const creado = await prisma.$transaction(async (tx) => {
    const a = await tx.viatico_anticipo.create({
      data: {
        conductor_id: input.conductor_id,
        vehiculo_id: input.vehiculo_id,
        concepto: input.concepto,
        valor: input.valor,
        metodo: input.metodo,
        fecha: aFecha(input.fecha),
        ...datosMetodo(input),
        solicitud_id: solicitud?.id ?? null,
        creado_por_id: usuarioId,
        actualizado_por_id: usuarioId
      }
    })
    if (solicitud) {
      /// Condicionado a PENDIENTE: dos aprobaciones simultáneas no crean dos anticipos.
      const r = await tx.viatico_solicitud.updateMany({
        where: { id: solicitud.id, estado: 'PENDIENTE' },
        data: { estado: 'APROBADA', resuelta_por_id: usuarioId, resuelta_at: new Date(), updated_at: new Date() }
      })
      if (r.count !== 1) throw new ViaticosError('La solicitud ya fue resuelta.', 409, 'SOLICITUD_RESUELTA')
    }
    return a
  })

  const resumen = await anticipoParaAviso(creado.id)
  if (resumen) {
    await avisarConductor({
      conductorId: creado.conductor_id,
      tipo: solicitud ? 'VIATICO_SOLICITUD_APROBADA' : 'VIATICO_ANTICIPO_NUEVO',
      titulo: solicitud ? 'Solicitud de viáticos aprobada' : 'Nuevo anticipo de viáticos',
      cuerpo: `${moneda(num(creado.valor))} para ${resumen.vehiculo.placa} · ${creado.concepto}`,
      anticipoId: creado.id
    })
  }
  return detalleAnticipo(creado.id)
}

export async function actualizarAnticipo(usuarioId: string, id: string, body: unknown) {
  exigirUuid(id, 'El anticipo')
  const actual = await prisma.viatico_anticipo.findFirst({ where: { id, deleted_at: null } })
  if (!actual) throw new ViaticosError('El anticipo no existe.', 404, 'NO_ENCONTRADO')
  const crudo = (body ?? {}) as Record<string, unknown>
  const input = parsear(
    anticipoSchema,
    actual.solicitud_id ? { ...crudo, conductor_id: actual.conductor_id, vehiculo_id: actual.vehiculo_id } : crudo
  )
  if (input.metodo === 'TRANSFERENCIA' && input.comprobante!.key !== actual.comprobante_key) {
    await verificarComprobante(input.comprobante!.key)
  }
  await exigirConductorYVehiculo(input.conductor_id, input.vehiculo_id)
  const tieneGastos = await prisma.viatico_gasto.count({ where: { anticipo_id: id, anulado_at: null } })
  if (tieneGastos && input.conductor_id !== actual.conductor_id) {
    throw new ViaticosError(
      'El anticipo ya tiene gastos del conductor: no se puede pasar a otro conductor. Anula los gastos o crea otro anticipo.',
      409,
      'ANTICIPO_CON_GASTOS'
    )
  }
  await prisma.viatico_anticipo.update({
    where: { id },
    data: {
      conductor_id: input.conductor_id,
      vehiculo_id: input.vehiculo_id,
      concepto: input.concepto,
      valor: input.valor,
      metodo: input.metodo,
      fecha: aFecha(input.fecha),
      ...datosMetodo(input),
      /// Si el comprobante no cambió se conserva la lectura que ya tenía.
      ...(input.metodo === 'TRANSFERENCIA' && input.comprobante!.key === actual.comprobante_key && !input.comprobante_lectura
        ? { comprobante_lectura: actual.comprobante_lectura ?? Prisma.JsonNull }
        : {}),
      actualizado_por_id: usuarioId,
      updated_at: new Date()
    }
  })
  /// Cambiar el valor mueve el umbral del 15 %: se reevalúa la alerta.
  await revisarAlertaSaldo(id)
  return detalleAnticipo(id)
}

export async function retirarAnticipo(usuarioId: string, id: string) {
  exigirUuid(id, 'El anticipo')
  const actual = await prisma.viatico_anticipo.findFirst({ where: { id, deleted_at: null } })
  if (!actual) throw new ViaticosError('El anticipo no existe.', 404, 'NO_ENCONTRADO')
  const gastos = await prisma.viatico_gasto.count({ where: { anticipo_id: id, anulado_at: null } })
  if (gastos) {
    throw new ViaticosError(
      `El anticipo tiene ${gastos} gasto(s) vigentes. Anúlalos antes de eliminarlo.`,
      409,
      'ANTICIPO_CON_GASTOS'
    )
  }
  await prisma.viatico_anticipo.update({
    where: { id },
    data: { deleted_at: new Date(), actualizado_por_id: usuarioId, updated_at: new Date() }
  })
  logger.info({ type: 'viatico-anticipo-retirado', id, usuarioId }, '[viaticos] anticipo eliminado')
  return { id }
}

// ─────────────────────────────────────────────────────────────────────────────
// Gastos
// ─────────────────────────────────────────────────────────────────────────────

const gastoSchema = z.object({
  client_gasto_id: idCliente,
  valor: dinero,
  descripcion: z.string().trim().max(500).optional().nullable(),
  fecha: fechaIso
})

/** El conductor reporta un gasto contra uno de SUS anticipos. Idempotente por `client_gasto_id`. */
export async function registrarGasto(conductorId: string, anticipoId: string, body: unknown) {
  exigirUuid(anticipoId, 'El anticipo')
  const input = parsear(gastoSchema, body)
  const existente = await prisma.viatico_gasto.findUnique({
    where: { client_gasto_id: input.client_gasto_id },
    include: incluirGasto
  })
  if (existente) {
    if (existente.conductor_id !== conductorId || existente.anticipo_id !== anticipoId) {
      throw new ViaticosError('Ya existe un gasto con ese identificador.', 409, 'GASTO_CONFLICTO')
    }
    return gastoDto(existente)
  }
  const anticipo = await prisma.viatico_anticipo.findFirst({
    where: { id: anticipoId, conductor_id: conductorId, deleted_at: null },
    select: { id: true }
  })
  if (!anticipo) throw new ViaticosError('El anticipo no existe.', 404, 'NO_ENCONTRADO')

  const gasto = await prisma.viatico_gasto
    .create({
      data: {
        anticipo_id: anticipoId,
        conductor_id: conductorId,
        client_gasto_id: input.client_gasto_id,
        valor: input.valor,
        descripcion: input.descripcion || null,
        fecha: aFecha(input.fecha)
      },
      include: incluirGasto
    })
    .catch(async (err) => {
      /// Carrera con un reintento del mismo gasto: se devuelve el que ganó.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return prisma.viatico_gasto.findUniqueOrThrow({ where: { client_gasto_id: input.client_gasto_id }, include: incluirGasto })
      }
      throw err
    })
  await revisarAlertaSaldo(anticipoId)
  return gastoDto(gasto)
}

const anularSchema = z.object({ motivo: z.string().trim().min(3, 'escribe el motivo').max(500) })

/** Operaciones anula un gasto: deja de descontar del saldo, pero no se borra. */
export async function anularGasto(usuarioId: string, gastoId: string, body: unknown) {
  exigirUuid(gastoId, 'El gasto')
  const input = parsear(anularSchema, body)
  const gasto = await prisma.viatico_gasto.findUnique({ where: { id: gastoId } })
  if (!gasto) throw new ViaticosError('El gasto no existe.', 404, 'NO_ENCONTRADO')
  if (gasto.anulado_at) throw new ViaticosError('El gasto ya estaba anulado.', 409, 'GASTO_ANULADO')
  await prisma.viatico_gasto.update({
    where: { id: gastoId },
    data: { anulado_at: new Date(), anulado_por_id: usuarioId, motivo_anulacion: input.motivo, updated_at: new Date() }
  })
  await revisarAlertaSaldo(gasto.anticipo_id)
  const anticipo = await anticipoParaAviso(gasto.anticipo_id)
  if (anticipo) {
    await avisarConductor({
      conductorId: gasto.conductor_id,
      tipo: 'VIATICO_GASTO_ANULADO',
      titulo: 'Un gasto de viáticos fue anulado',
      cuerpo: `${moneda(num(gasto.valor))} de ${anticipo.concepto}: ${input.motivo}`,
      anticipoId: gasto.anticipo_id
    })
  }
  return detalleAnticipo(gasto.anticipo_id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Adjuntos de un gasto (portal del conductor)
// ─────────────────────────────────────────────────────────────────────────────

const initAdjuntoSchema = z.object({
  client_attachment_id: idCliente,
  mime_type: z.string().trim().min(1).max(100),
  byte_size: z.number().int().positive(),
  sha256: z
    .string()
    .trim()
    .regex(/^[0-9a-fA-F]{64}$/, 'sha256 debe ser hexadecimal de 64 caracteres')
    .transform((v) => v.toLowerCase()),
  original_name: z.string().trim().max(255).optional().nullable()
})

async function gastoDelConductor(conductorId: string, gastoId: string) {
  exigirUuid(gastoId, 'El gasto')
  const gasto = await prisma.viatico_gasto.findFirst({ where: { id: gastoId, conductor_id: conductorId } })
  if (!gasto) throw new ViaticosError('El gasto no existe.', 404, 'GASTO_NO_ENCONTRADO')
  return gasto
}

export async function iniciarAdjuntoGasto(conductorId: string, gastoId: string, body: unknown) {
  const gasto = await gastoDelConductor(conductorId, gastoId)
  const input = parsear(initAdjuntoSchema, body)
  const ext = EXTENSION_POR_MIME[input.mime_type]
  if (!ext) throw new ViaticosError('La factura debe ser una foto (JPG, PNG, WEBP) o un PDF.', 415, 'TIPO_NO_ADMITIDO')
  if (input.byte_size > MAX_BYTES_ARCHIVO) throw new ViaticosError('Cada archivo puede pesar hasta 10 MB.', 413, 'ARCHIVO_GRANDE')

  const existente = await prisma.viatico_gasto_adjunto.findUnique({ where: { client_attachment_id: input.client_attachment_id } })
  let fila = existente
  if (existente) {
    if (existente.gasto_id !== gasto.id) {
      throw new ViaticosError('Ya existe un archivo con ese identificador.', 409, 'ADJUNTO_CONFLICTO')
    }
    if (existente.status === 'UPLOADED') return { id: existente.id, status: 'UPLOADED' as const }
  } else {
    const vivos = await prisma.viatico_gasto_adjunto.count({ where: { gasto_id: gasto.id, deleted_at: null } })
    if (vivos >= MAX_ADJUNTOS_POR_GASTO) {
      throw new ViaticosError(`Un gasto admite hasta ${MAX_ADJUNTOS_POR_GASTO} archivos.`, 409, 'LIMITE_ADJUNTOS')
    }
    fila = await prisma.viatico_gasto_adjunto
      .create({
        data: {
          gasto_id: gasto.id,
          conductor_id: conductorId,
          client_attachment_id: input.client_attachment_id,
          /// El id del teléfono es único: dos intentos escriben el mismo objeto.
          object_key: `${PREFIJO_S3}/gastos/${conductorId}/${gasto.id}/${input.client_attachment_id}.${ext}`,
          mime_type: input.mime_type,
          byte_size: input.byte_size,
          sha256: input.sha256,
          original_name: input.original_name || null
        }
      })
      .catch(async (err) => {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          return prisma.viatico_gasto_adjunto.findUniqueOrThrow({ where: { client_attachment_id: input.client_attachment_id } })
        }
        throw err
      })
  }
  /// El checksum va firmado en la URL; mandarlo también como cabecera da 403
  /// (mismo criterio que los adjuntos de formularios y de días laborados).
  const uploadUrl = await getS3UploadUrl(
    fila!.object_key,
    fila!.mime_type,
    fila!.byte_size,
    env.FORMS_S3_NATIVE_CHECKSUM ? sha256HexToBase64(fila!.sha256) : null
  )
  return { id: fila!.id, status: 'PENDING' as const, upload_url: uploadUrl, headers: { 'Content-Type': fila!.mime_type } }
}

export async function completarAdjuntoGasto(conductorId: string, gastoId: string, adjuntoId: string) {
  const gasto = await gastoDelConductor(conductorId, gastoId)
  exigirUuid(adjuntoId, 'El archivo')
  const adjunto = await prisma.viatico_gasto_adjunto.findFirst({ where: { id: adjuntoId, gasto_id: gasto.id, deleted_at: null } })
  if (!adjunto) throw new ViaticosError('El archivo no existe.', 404, 'ADJUNTO_NO_ENCONTRADO')
  if (adjunto.status === 'UPLOADED') return adjuntoDto(adjunto)

  const meta = await headS3Object(adjunto.object_key)
  if (!meta) throw new ViaticosError('El archivo todavía no llegó al almacenamiento.', 409, 'ARCHIVO_NO_SUBIDO')
  if (meta.contentLength !== adjunto.byte_size) {
    throw new ViaticosError('El archivo almacenado no tiene el tamaño declarado. Vuelve a subirlo.', 422, 'ARCHIVO_NO_COINCIDE')
  }
  if (meta.checksumSha256) {
    if (meta.checksumSha256 !== sha256HexToBase64(adjunto.sha256)) {
      throw new ViaticosError('El archivo almacenado no coincide con el declarado. Vuelve a subirlo.', 422, 'ARCHIVO_NO_COINCIDE')
    }
  } else {
    const calculado = await computeS3ObjectSha256(adjunto.object_key, adjunto.byte_size + 1024).catch(() => null)
    if (!calculado || calculado.sha256Hex !== adjunto.sha256) {
      throw new ViaticosError('El archivo almacenado no coincide con el declarado. Vuelve a subirlo.', 422, 'ARCHIVO_NO_COINCIDE')
    }
  }
  const final = await prisma.viatico_gasto_adjunto.update({
    where: { id: adjunto.id },
    data: { status: 'UPLOADED', uploaded_at: new Date() }
  })
  return adjuntoDto(final)
}

// ─────────────────────────────────────────────────────────────────────────────
// Solicitudes
// ─────────────────────────────────────────────────────────────────────────────

const solicitudSchema = z.object({
  client_solicitud_id: idCliente,
  valor: dinero,
  observaciones: z.string().trim().max(1000).optional().nullable()
})

/** El conductor pide más dinero desde uno de SUS anticipos. Idempotente. */
export async function crearSolicitud(conductorId: string, anticipoId: string, body: unknown) {
  exigirUuid(anticipoId, 'El anticipo')
  const input = parsear(solicitudSchema, body)
  const incluir = { resuelta_por: { select: { id: true, nombre: true } }, anticipo_generado: { select: { id: true } } } as const
  const existente = await prisma.viatico_solicitud.findUnique({ where: { client_solicitud_id: input.client_solicitud_id }, include: incluir })
  if (existente) {
    if (existente.conductor_id !== conductorId) throw new ViaticosError('Ya existe una solicitud con ese identificador.', 409, 'SOLICITUD_CONFLICTO')
    return solicitudDto(existente)
  }
  const anticipo = await prisma.viatico_anticipo.findFirst({
    where: { id: anticipoId, conductor_id: conductorId, deleted_at: null },
    include: { vehiculo: { select: { placa: true } }, conductor: { select: { nombre: true, apellido: true } } }
  })
  if (!anticipo) throw new ViaticosError('El anticipo no existe.', 404, 'NO_ENCONTRADO')
  const pendiente = await prisma.viatico_solicitud.findFirst({ where: { anticipo_origen_id: anticipoId, estado: 'PENDIENTE' } })
  if (pendiente) {
    throw new ViaticosError('Ya tienes una solicitud pendiente para este anticipo. Operaciones la está revisando.', 409, 'SOLICITUD_PENDIENTE')
  }
  const solicitud = await prisma.viatico_solicitud.create({
    data: {
      anticipo_origen_id: anticipoId,
      conductor_id: conductorId,
      vehiculo_id: anticipo.vehiculo_id,
      valor_solicitado: input.valor,
      observaciones: input.observaciones || null,
      client_solicitud_id: input.client_solicitud_id
    },
    include: incluir
  })
  await avisarOperaciones({
    titulo: 'Solicitud de viáticos',
    mensaje: `${nombreConductor(anticipo.conductor)} (${anticipo.vehiculo.placa}) solicita ${moneda(input.valor)}${input.observaciones ? `: ${input.observaciones.slice(0, 140)}` : ''}`,
    referenciaId: solicitud.id,
    referenciaTipo: 'viatico_solicitud'
  })
  return solicitudDto(solicitud)
}

const listarSolicitudesSchema = z.object({
  estado: z.enum(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'todas']).optional().default('PENDIENTE')
})

export async function listarSolicitudes(query: unknown) {
  const f = parsear(listarSolicitudesSchema, query)
  const filas = await prisma.viatico_solicitud.findMany({
    where: f.estado === 'todas' ? {} : { estado: f.estado },
    include: {
      conductor: { select: { id: true, nombre: true, apellido: true, numero_identificacion: true } },
      vehiculo: { select: { id: true, placa: true } },
      anticipo_origen: { select: { id: true, concepto: true, valor: true } },
      resuelta_por: { select: { id: true, nombre: true } },
      anticipo_generado: { select: { id: true } }
    },
    orderBy: { created_at: 'desc' },
    take: 200
  })
  const gastado = await gastadoPorAnticipo([...new Set(filas.map((s) => s.anticipo_origen_id))])
  return filas.map((s) => ({
    ...solicitudDto(s),
    conductor: { id: s.conductor.id, nombre: nombreConductor(s.conductor), numero_identificacion: s.conductor.numero_identificacion },
    vehiculo: { id: s.vehiculo.id, placa: s.vehiculo.placa },
    anticipo_origen: {
      id: s.anticipo_origen.id,
      concepto: s.anticipo_origen.concepto,
      ...calcularSaldo(num(s.anticipo_origen.valor), gastado.get(s.anticipo_origen_id) ?? 0)
    }
  }))
}

export async function detalleSolicitud(id: string) {
  exigirUuid(id, 'La solicitud')
  const todas = await listarSolicitudes({ estado: 'todas' })
  const s = todas.find((x) => x.id === id)
  if (!s) throw new ViaticosError('La solicitud no existe.', 404, 'SOLICITUD_NO_ENCONTRADA')
  return s
}

const rechazarSchema = z.object({ motivo: z.string().trim().min(3, 'escribe el motivo del rechazo').max(500) })

export async function rechazarSolicitud(usuarioId: string, id: string, body: unknown) {
  exigirUuid(id, 'La solicitud')
  const input = parsear(rechazarSchema, body)
  const r = await prisma.viatico_solicitud.updateMany({
    where: { id, estado: 'PENDIENTE' },
    data: { estado: 'RECHAZADA', motivo_rechazo: input.motivo, resuelta_por_id: usuarioId, resuelta_at: new Date(), updated_at: new Date() }
  })
  if (r.count !== 1) {
    const existe = await prisma.viatico_solicitud.findUnique({ where: { id }, select: { id: true } })
    if (!existe) throw new ViaticosError('La solicitud no existe.', 404, 'SOLICITUD_NO_ENCONTRADA')
    throw new ViaticosError('La solicitud ya fue resuelta.', 409, 'SOLICITUD_RESUELTA')
  }
  const s = await prisma.viatico_solicitud.findUniqueOrThrow({ where: { id } })
  await avisarConductor({
    conductorId: s.conductor_id,
    tipo: 'VIATICO_SOLICITUD_RECHAZADA',
    titulo: 'Solicitud de viáticos rechazada',
    cuerpo: `Tu solicitud de ${moneda(num(s.valor_solicitado))} fue rechazada: ${input.motivo}`,
    anticipoId: s.anticipo_origen_id
  })
  return detalleSolicitud(id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Portal del conductor
// ─────────────────────────────────────────────────────────────────────────────

/** Los anticipos del conductor con su saldo, los más recientes primero. */
export async function anticiposDelConductor(conductorId: string) {
  const anticipos = await prisma.viatico_anticipo.findMany({
    where: { conductor_id: conductorId, deleted_at: null },
    include: incluirResumen,
    orderBy: [{ fecha: 'desc' }, { created_at: 'desc' }],
    take: 100
  })
  const gastado = await gastadoPorAnticipo(anticipos.map((a) => a.id))
  const lista = anticipos.map((a) => {
    const r = aResumen(a, gastado.get(a.id) ?? 0)
    /// El conductor no necesita saber quién del panel lo registró.
    return { ...r, creado_por: null }
  })
  const totales = lista.reduce(
    (t, a) => ({ anticipado: t.anticipado + a.valor, gastado: t.gastado + a.gastado, saldo: t.saldo + a.saldo }),
    { anticipado: 0, gastado: 0, saldo: 0 }
  )
  return {
    anticipos: lista,
    totales: { anticipado: redondear(totales.anticipado), gastado: redondear(totales.gastado), saldo: redondear(totales.saldo) },
    umbral_saldo_bajo: UMBRAL_SALDO_BAJO
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Alertas y avisos
// ─────────────────────────────────────────────────────────────────────────────

function moneda(v: number) {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
}

async function anticipoParaAviso(id: string) {
  return prisma.viatico_anticipo.findUnique({
    where: { id },
    include: { vehiculo: { select: { placa: true } }, conductor: { select: { nombre: true, apellido: true } } }
  })
}

/**
 * Reevalúa la alerta de saldo bajo de un anticipo. Avisa la PRIMERA vez que el
 * saldo cae al 15 % o menos; si vuelve a subir (anulación, valor editado)
 * limpia la marca para que una nueva caída avise de nuevo.
 */
export async function revisarAlertaSaldo(anticipoId: string) {
  try {
    const a = await anticipoParaAviso(anticipoId)
    if (!a || a.deleted_at) return
    const gastado = (await gastadoPorAnticipo([a.id])).get(a.id) ?? 0
    const s = calcularSaldo(num(a.valor), gastado)
    if (!s.saldo_bajo) {
      if (a.alerta_saldo_bajo_at) {
        await prisma.viatico_anticipo.update({ where: { id: a.id }, data: { alerta_saldo_bajo_at: null } })
      }
      return
    }
    /// Marca condicionada: dos gastos simultáneos no disparan dos avisos.
    const marcado = await prisma.viatico_anticipo.updateMany({
      where: { id: a.id, alerta_saldo_bajo_at: null },
      data: { alerta_saldo_bajo_at: new Date() }
    })
    if (marcado.count !== 1) return

    const conductor = nombreConductor(a.conductor)
    const resto = s.agotado ? 'sin saldo' : `con ${moneda(s.saldo)} (${Math.max(0, s.porcentaje_restante)} %)`
    await avisarOperaciones({
      titulo: 'Viáticos: saldo bajo',
      mensaje: `${conductor} (${a.vehiculo.placa}) quedó ${resto} del anticipo «${a.concepto}» de ${moneda(num(a.valor))}.`,
      referenciaId: a.id,
      referenciaTipo: 'viatico_anticipo'
    })
    await avisarConductor({
      conductorId: a.conductor_id,
      tipo: 'VIATICO_SALDO_BAJO',
      titulo: 'Saldo bajo de viáticos',
      cuerpo: `Te quedan ${moneda(Math.max(0, s.saldo))} del anticipo «${a.concepto}». Si necesitas más, puedes solicitarlo desde la app.`,
      anticipoId: a.id
    })
  } catch (error) {
    logger.error({ err: error, anticipoId }, '[viaticos] no se pudo revisar la alerta de saldo')
  }
}

/** Notifica en el panel a todos los usuarios activos del área de operaciones. */
async function avisarOperaciones(p: { titulo: string; mensaje: string; referenciaId: string; referenciaTipo: string }) {
  try {
    const usuarios = await prisma.usuarios.findMany({
      where: { activo: true, area: { has: 'operaciones' } },
      select: { id: true }
    })
    for (const u of usuarios) {
      const n = await NotificacionesService.crear({
        usuario_id: u.id,
        tipo: 'GENERAL',
        titulo: p.titulo,
        mensaje: p.mensaje,
        referencia_id: p.referenciaId,
        referencia_tipo: p.referenciaTipo
      })
      emitNotificacion(n)
    }
  } catch (error) {
    logger.error({ err: error, ...p }, '[viaticos] no se pudo avisar a operaciones')
  }
}

type TipoAvisoConductor =
  | 'VIATICO_ANTICIPO_NUEVO'
  | 'VIATICO_SALDO_BAJO'
  | 'VIATICO_SOLICITUD_APROBADA'
  | 'VIATICO_SOLICITUD_RECHAZADA'
  | 'VIATICO_GASTO_ANULADO'

/** Bandeja del conductor + push, como los avisos de servicios. Nunca lanza. */
async function avisarConductor(p: { conductorId: string; tipo: TipoAvisoConductor; titulo: string; cuerpo: string; anticipoId: string }) {
  try {
    /// El aviso de saldo bajo abre directamente el formulario para pedir más.
    const ruta = `/viaticos/${p.anticipoId}${p.tipo === 'VIATICO_SALDO_BAJO' ? '?solicitar=1' : ''}`
    const datos = { type: p.tipo, anticipo_id: p.anticipoId, route: ruta }
    const inbox = await prisma.conductor_notification.create({
      data: { conductor_id: p.conductorId, tipo: p.tipo, titulo: p.titulo.slice(0, 160), cuerpo: p.cuerpo, datos }
    })
    await enviarPushConductor({
      conductorId: p.conductorId,
      notificacionId: inbox.id,
      titulo: p.titulo,
      cuerpo: p.cuerpo,
      datos,
      canal: CANAL_PUSH
    })
  } catch (error) {
    logger.error({ err: error, conductorId: p.conductorId, tipo: p.tipo }, '[viaticos] no se pudo avisar al conductor')
  }
}
