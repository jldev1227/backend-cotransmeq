/**
 * Gastos que asume la empresa y el resumen del tablero de viáticos.
 *
 * ── Gastos directos ──
 * No todo el dinero va a un conductor para una placa (eso es un anticipo). Un gasto directo es
 * algo de la oficina, un mantenimiento, dinero a un conductor o un cobro del banco. `asume` dice
 * quién lo reconoce:
 * - EMPRESA: no pide placa (puede llevarla de referencia).
 * - TERCERO: lo reconoce el propietario de la placa; la placa es obligatoria y se guarda su
 *   tercero (el de la placa, o el que se indique).
 * Los BANCARIOS (4x1000, cuota de manejo, comisiones) no son una forma de entrega sino cobros del
 * banco a la cuenta: siempre de la empresa, sin conductor ni placa, por débito automático.
 * Si lo paga alguien de operaciones, sale del fondo del área (`viaticos-fondo.service.ts`).
 *
 * ── Resumen ──
 * Cuánto se entregó en anticipos, cuánto legalizaron los conductores y cuánto gastó la empresa,
 * por día, semana o mes en el rango que se pida, con los totales y los desgloses del tablero.
 */

import { Prisma } from '@prisma/client'
import { z } from 'zod'

import { prisma } from '../../config/prisma'
import { avisarFondoBajo, ajustarGastoEmpresa, descontarGastoEmpresa, reversarGastoEmpresa, terceroDePlaca } from './viaticos-fondo.service'
import { calcularSaldo, parsear, ViaticosError } from './viaticos.service'

const num = (v: Prisma.Decimal | number | null | undefined) => (v === null || v === undefined ? 0 : Number(v))
const redondear = (v: number) => Math.round(v * 100) / 100
const fechaIso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'debe tener formato YYYY-MM-DD')
const aFecha = (iso: string) => new Date(`${iso}T00:00:00.000Z`)
const deFecha = (d: Date) => d.toISOString().slice(0, 10)
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const CATEGORIAS_GASTO = ['OFICINA', 'MANTENIMIENTO', 'CONDUCTOR', 'BANCARIO', 'OTRO'] as const
export const METODOS_GASTO = ['TRANSFERENCIA', 'RETIRO_TARJETA', 'EFECTIVO', 'DEBITO_AUTOMATICO'] as const
export const ASUME_GASTO = ['EMPRESA', 'TERCERO'] as const

// ─────────────────────────────────────────────────────────────────────────────
// Gastos de la empresa
// ─────────────────────────────────────────────────────────────────────────────

const incluirGasto = {
  vehiculo: { select: { id: true, placa: true } },
  conductor: { select: { id: true, nombre: true, apellido: true } },
  tercero: { select: { id: true, nombre_completo: true, identificacion: true } },
  creado_por: { select: { id: true, nombre: true } }
} satisfies Prisma.viatico_gasto_empresaInclude

function gastoDto(g: Prisma.viatico_gasto_empresaGetPayload<{ include: typeof incluirGasto }>) {
  return {
    id: g.id,
    categoria: g.categoria as (typeof CATEGORIAS_GASTO)[number],
    asume: g.asume as (typeof ASUME_GASTO)[number],
    tercero: g.tercero ? { id: g.tercero.id, nombre: g.tercero.nombre_completo, identificacion: g.tercero.identificacion } : null,
    descripcion: g.descripcion,
    beneficiario: g.beneficiario,
    valor: num(g.valor),
    fecha: deFecha(g.fecha),
    metodo: g.metodo as (typeof METODOS_GASTO)[number],
    numero_comprobante: g.numero_comprobante,
    comprobante: g.comprobante_key ? { key: g.comprobante_key, mime_type: g.comprobante_mime, nombre: g.comprobante_nombre } : null,
    vehiculo: g.vehiculo ? { id: g.vehiculo.id, placa: g.vehiculo.placa } : null,
    conductor: g.conductor ? { id: g.conductor.id, nombre: `${g.conductor.nombre} ${g.conductor.apellido}`.trim() } : null,
    creado_por: g.creado_por ? { id: g.creado_por.id, nombre: g.creado_por.nombre } : null,
    created_at: g.created_at.toISOString()
  }
}

const listarGastosSchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoria: z.enum(CATEGORIAS_GASTO).optional(),
  asume: z.enum(ASUME_GASTO).optional(),
  desde: fechaIso.optional(),
  hasta: fechaIso.optional(),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20)
})

export async function listarGastosEmpresa(query: unknown) {
  const f = parsear(listarGastosSchema, query)
  const where: Prisma.viatico_gasto_empresaWhereInput = { deleted_at: null }
  if (f.categoria) where.categoria = f.categoria
  if (f.asume) where.asume = f.asume
  if (f.desde || f.hasta) where.fecha = { ...(f.desde ? { gte: aFecha(f.desde) } : {}), ...(f.hasta ? { lte: aFecha(f.hasta) } : {}) }
  if (f.q) {
    where.AND = f.q.split(/\s+/).filter(Boolean).map((p) => ({
      OR: [
        { descripcion: { contains: p, mode: 'insensitive' } },
        { beneficiario: { contains: p, mode: 'insensitive' } },
        { numero_comprobante: { contains: p, mode: 'insensitive' } },
        { vehiculo: { placa: { contains: p, mode: 'insensitive' } } },
        { tercero: { nombre_completo: { contains: p, mode: 'insensitive' } } },
        { conductor: { nombre: { contains: p, mode: 'insensitive' } } },
        { conductor: { apellido: { contains: p, mode: 'insensitive' } } }
      ]
    }))
  }
  const [filas, total, suma] = await Promise.all([
    prisma.viatico_gasto_empresa.findMany({
      where,
      include: incluirGasto,
      orderBy: [{ fecha: 'desc' }, { created_at: 'desc' }],
      skip: (f.page - 1) * f.limit,
      take: f.limit
    }),
    prisma.viatico_gasto_empresa.count({ where }),
    prisma.viatico_gasto_empresa.aggregate({ where, _sum: { valor: true } })
  ])
  return {
    data: filas.map(gastoDto),
    meta: { total, page: f.page, limit: f.limit, totalPages: Math.max(1, Math.ceil(total / f.limit)) },
    total_valor: redondear(num(suma._sum.valor))
  }
}

const gastoSchema = z
  .object({
    categoria: z.enum(CATEGORIAS_GASTO, { errorMap: () => ({ message: 'elige la categoría' }) }),
    asume: z.enum(ASUME_GASTO).optional().default('EMPRESA'),
    tercero_id: z.string().uuid().optional().nullable(),
    descripcion: z.string().trim().min(3, 'describe el gasto').max(1000),
    beneficiario: z.string().trim().max(255).optional().nullable(),
    valor: z.coerce.number().positive('debe ser mayor que cero').max(9_999_999_999, 'es demasiado grande'),
    fecha: fechaIso,
    metodo: z.enum(METODOS_GASTO),
    numero_comprobante: z.string().trim().max(60).optional().nullable(),
    comprobante: z
      .object({ key: z.string().min(1), mime_type: z.string(), nombre: z.string().max(255).optional().nullable() })
      .optional()
      .nullable(),
    vehiculo_id: z.string().uuid().optional().nullable(),
    conductor_id: z.string().uuid().optional().nullable()
  })
  .superRefine((v, ctx) => {
    if (v.categoria === 'BANCARIO' && v.asume === 'TERCERO') {
      ctx.addIssue({ code: 'custom', path: ['asume'], message: 'los cobros del banco (4x1000, cuota de manejo) los asume la empresa' })
    } else if (v.asume === 'TERCERO' && !v.vehiculo_id) {
      ctx.addIssue({ code: 'custom', path: ['vehiculo_id'], message: 'indica la placa: el gasto lo asume su propietario' })
    }
    /// Un mantenimiento que asume la empresa (vehículo propio) no exige placa: la regla es que la
    /// empresa no pide placa; el que asume el tercero ya la exige arriba.
    if (v.categoria === 'CONDUCTOR' && !v.conductor_id) {
      ctx.addIssue({ code: 'custom', path: ['conductor_id'], message: 'indica el conductor' })
    }
  })

/** Tercero que asume el gasto: el indicado o el propietario de la placa. Sin él no se puede. */
async function terceroQueAsume(input: z.infer<typeof gastoSchema>): Promise<string | null> {
  if (input.asume !== 'TERCERO') return null
  if (input.tercero_id) {
    const t = await prisma.terceros.findFirst({ where: { id: input.tercero_id, deleted_at: null }, select: { id: true } })
    if (!t) throw new ViaticosError('El tercero no existe.', 400, 'TERCERO_INVALIDO')
    return t.id
  }
  const { tercero, placa } = await terceroDePlaca(input.vehiculo_id!)
  if (!tercero) {
    throw new ViaticosError(`La placa ${placa} no tiene propietario (tercero). Créalo primero para cargarle el gasto.`, 409, 'PLACA_SIN_TERCERO')
  }
  return tercero.id
}

async function exigirReferencias(input: z.infer<typeof gastoSchema>) {
  const [v, c] = await Promise.all([
    input.vehiculo_id ? prisma.vehiculos.findFirst({ where: { id: input.vehiculo_id, deleted_at: null }, select: { id: true } }) : true,
    input.conductor_id ? prisma.conductores.findFirst({ where: { id: input.conductor_id, deleted_at: null }, select: { id: true } }) : true
  ])
  if (!v) throw new ViaticosError('La placa no existe.', 400, 'VEHICULO_INVALIDO')
  if (!c) throw new ViaticosError('El conductor no existe.', 400, 'CONDUCTOR_INVALIDO')
  if (input.comprobante && (!input.comprobante.key.startsWith('viaticos/comprobantes/') || input.comprobante.key.includes('..'))) {
    throw new ViaticosError('El comprobante no es válido.', 400, 'COMPROBANTE_INVALIDO')
  }
}

const datos = (input: z.infer<typeof gastoSchema>, terceroId: string | null) => ({
  categoria: input.categoria,
  /// Los cobros del banco son de la empresa aunque lleguen marcados de otra forma.
  asume: input.categoria === 'BANCARIO' ? 'EMPRESA' : input.asume,
  tercero_id: terceroId,
  descripcion: input.descripcion,
  beneficiario: input.beneficiario || null,
  valor: input.valor,
  fecha: aFecha(input.fecha),
  metodo: input.metodo,
  numero_comprobante: input.numero_comprobante || null,
  comprobante_key: input.comprobante?.key ?? null,
  comprobante_mime: input.comprobante?.mime_type ?? null,
  comprobante_nombre: input.comprobante?.nombre ?? null,
  vehiculo_id: input.vehiculo_id || null,
  conductor_id: input.conductor_id || null
})

export async function crearGastoEmpresa(usuarioId: string, body: unknown) {
  const input = parsear(gastoSchema, body)
  await exigirReferencias(input)
  const terceroId = await terceroQueAsume(input)
  let fondo: { antes: number; despues: number } | null = null
  const creado = await prisma.$transaction(async (tx) => {
    const g = await tx.viatico_gasto_empresa.create({ data: { ...datos(input, terceroId), creado_por_id: usuarioId, actualizado_por_id: usuarioId } })
    /// Operaciones lo paga con su fondo: sin saldo, la transacción entera se deshace.
    fondo = await descontarGastoEmpresa(tx, usuarioId, g.id, input.valor)
    return g
  })
  if (fondo) void avisarFondoBajo(usuarioId, fondo)
  return gastoDto(await prisma.viatico_gasto_empresa.findUniqueOrThrow({ where: { id: creado.id }, include: incluirGasto }))
}

export async function actualizarGastoEmpresa(usuarioId: string, id: string, body: unknown) {
  if (!UUID_RE.test(id)) throw new ViaticosError('El gasto no existe.', 404, 'NO_ENCONTRADO')
  const actual = await prisma.viatico_gasto_empresa.findFirst({ where: { id, deleted_at: null } })
  if (!actual) throw new ViaticosError('El gasto no existe.', 404, 'NO_ENCONTRADO')
  const input = parsear(gastoSchema, body)
  await exigirReferencias(input)
  const terceroId = await terceroQueAsume(input)
  await prisma.$transaction(async (tx) => {
    await ajustarGastoEmpresa(tx, usuarioId, id, num(actual.valor), input.valor)
    await tx.viatico_gasto_empresa.update({ where: { id }, data: { ...datos(input, terceroId), actualizado_por_id: usuarioId, updated_at: new Date() } })
  })
  return gastoDto(await prisma.viatico_gasto_empresa.findUniqueOrThrow({ where: { id }, include: incluirGasto }))
}

export async function retirarGastoEmpresa(usuarioId: string, id: string) {
  if (!UUID_RE.test(id)) throw new ViaticosError('El gasto no existe.', 404, 'NO_ENCONTRADO')
  const actual = await prisma.viatico_gasto_empresa.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
  if (!actual) throw new ViaticosError('El gasto no existe.', 404, 'NO_ENCONTRADO')
  await prisma.$transaction(async (tx) => {
    await tx.viatico_gasto_empresa.update({ where: { id }, data: { deleted_at: new Date(), actualizado_por_id: usuarioId, updated_at: new Date() } })
    /// El dinero vuelve al fondo del que salió.
    await reversarGastoEmpresa(tx, usuarioId, id)
  })
  return { id }
}

// ─────────────────────────────────────────────────────────────────────────────
// Resumen del tablero
// ─────────────────────────────────────────────────────────────────────────────

const resumenSchema = z.object({
  desde: fechaIso,
  hasta: fechaIso,
  agrupar: z.enum(['dia', 'semana', 'mes']).optional().default('semana')
})

type Agrupacion = 'dia' | 'semana' | 'mes'

/** Inicio del periodo que contiene la fecha (semanas de lunes a domingo). */
function inicioPeriodo(d: Date, agrupar: Agrupacion): Date {
  const r = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  if (agrupar === 'mes') r.setUTCDate(1)
  if (agrupar === 'semana') r.setUTCDate(r.getUTCDate() - ((r.getUTCDay() + 6) % 7))
  return r
}

function siguiente(d: Date, agrupar: Agrupacion): Date {
  const r = new Date(d)
  if (agrupar === 'dia') r.setUTCDate(r.getUTCDate() + 1)
  else if (agrupar === 'semana') r.setUTCDate(r.getUTCDate() + 7)
  else r.setUTCMonth(r.getUTCMonth() + 1)
  return r
}

export async function resumenViaticos(query: unknown) {
  const f = parsear(resumenSchema, query)
  const desde = aFecha(f.desde)
  const hasta = aFecha(f.hasta)
  if (hasta < desde) throw new ViaticosError('La fecha final es anterior a la inicial.', 400, 'RANGO_INVALIDO')
  const dias = Math.round((hasta.getTime() - desde.getTime()) / 86_400_000) + 1
  /// Con agrupación diaria más de ~6 meses no se lee; se pide una más gruesa.
  if (f.agrupar === 'dia' && dias > 190) throw new ViaticosError('Para más de seis meses agrupa por semana o por mes.', 400, 'RANGO_GRANDE')

  const enRango = { gte: desde, lte: hasta }
  const [anticipos, legalizados, gastosEmpresa, vigentes, fondos] = await Promise.all([
    prisma.viatico_anticipo.findMany({
      where: { deleted_at: null, fecha: enRango },
      select: {
        fecha: true,
        valor: true,
        conductor: { select: { id: true, nombre: true, apellido: true } },
        vehiculo: { select: { id: true, placa: true } }
      }
    }),
    prisma.viatico_gasto.findMany({ where: { anulado_at: null, fecha: enRango, anticipo: { deleted_at: null } }, select: { fecha: true, valor: true } }),
    prisma.viatico_gasto_empresa.findMany({ where: { deleted_at: null, fecha: enRango }, select: { fecha: true, valor: true, categoria: true, asume: true } }),
    /// Lo que está en manos de los conductores hoy (sin importar el rango): saldo de los anticipos vigentes.
    prisma.viatico_anticipo.findMany({ where: { deleted_at: null }, select: { id: true, valor: true, gastos: { where: { anulado_at: null }, select: { valor: true } } } }),
    prisma.viatico_fondo_movimiento.groupBy({ by: ['fondo'], _sum: { valor: true } })
  ])

  // Periodos vacíos incluidos: una semana sin anticipos es un dato, no un hueco.
  const periodos = new Map<string, { desde: Date; anticipos: number; cantidad_anticipos: number; legalizado: number; gastos_empresa: number; cantidad_gastos: number }>()
  for (let p = inicioPeriodo(desde, f.agrupar); p <= hasta; p = siguiente(p, f.agrupar)) {
    periodos.set(deFecha(p), { desde: p, anticipos: 0, cantidad_anticipos: 0, legalizado: 0, gastos_empresa: 0, cantidad_gastos: 0 })
  }
  const periodo = (d: Date) => periodos.get(deFecha(inicioPeriodo(d, f.agrupar)))
  for (const a of anticipos) {
    const p = periodo(a.fecha)
    if (p) {
      p.anticipos += num(a.valor)
      p.cantidad_anticipos++
    }
  }
  for (const g of legalizados) {
    const p = periodo(g.fecha)
    if (p) p.legalizado += num(g.valor)
  }
  const porCategoria = new Map<string, { valor: number; cantidad: number }>()
  let gastosTercero = 0
  let cantidadGastosTercero = 0
  for (const g of gastosEmpresa) {
    /// Los que asume el tercero no son costo de la empresa: se cuentan aparte.
    if (g.asume === 'TERCERO') {
      gastosTercero += num(g.valor)
      cantidadGastosTercero++
      continue
    }
    const p = periodo(g.fecha)
    if (p) {
      p.gastos_empresa += num(g.valor)
      p.cantidad_gastos++
    }
    const c = porCategoria.get(g.categoria) ?? { valor: 0, cantidad: 0 }
    c.valor += num(g.valor)
    c.cantidad++
    porCategoria.set(g.categoria, c)
  }

  const top = <K extends string>(items: { clave: K; etiqueta: string; valor: number }[]) => {
    const m = new Map<K, { etiqueta: string; valor: number; cantidad: number }>()
    for (const i of items) {
      const x = m.get(i.clave) ?? { etiqueta: i.etiqueta, valor: 0, cantidad: 0 }
      x.valor += i.valor
      x.cantidad++
      m.set(i.clave, x)
    }
    return [...m.entries()]
      .map(([id, x]) => ({ id, etiqueta: x.etiqueta, valor: redondear(x.valor), cantidad: x.cantidad }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 8)
  }

  const total = (k: 'anticipos' | 'legalizado' | 'gastos_empresa') => redondear([...periodos.values()].reduce((s, p) => s + p[k], 0))
  const enManos = vigentes.reduce((s, a) => {
    const saldo = calcularSaldo(num(a.valor), a.gastos.reduce((t, g) => t + num(g.valor), 0)).saldo
    return s + Math.max(0, saldo)
  }, 0)

  return {
    rango: { desde: f.desde, hasta: f.hasta, agrupar: f.agrupar },
    totales: {
      anticipos: total('anticipos'),
      cantidad_anticipos: anticipos.length,
      legalizado: total('legalizado'),
      gastos_empresa: total('gastos_empresa'),
      cantidad_gastos_empresa: gastosEmpresa.length - cantidadGastosTercero,
      /// Gastos directos que asume el propietario de la placa (se le descuentan a él).
      gastos_tercero: redondear(gastosTercero),
      cantidad_gastos_tercero: cantidadGastosTercero,
      /// Lo que salió en el rango: anticipos y todos los gastos directos.
      egresos: redondear(total('anticipos') + total('gastos_empresa') + gastosTercero),
      en_manos_de_conductores: redondear(enManos)
    },
    periodos: [...periodos.entries()].map(([clave, p]) => ({
      clave,
      desde: deFecha(p.desde),
      hasta: deFecha(new Date(Math.min(siguiente(p.desde, f.agrupar).getTime() - 86_400_000, hasta.getTime()))),
      anticipos: redondear(p.anticipos),
      cantidad_anticipos: p.cantidad_anticipos,
      legalizado: redondear(p.legalizado),
      gastos_empresa: redondear(p.gastos_empresa),
      cantidad_gastos_empresa: p.cantidad_gastos
    })),
    por_categoria: CATEGORIAS_GASTO.map((c) => ({ categoria: c, valor: redondear(porCategoria.get(c)?.valor ?? 0), cantidad: porCategoria.get(c)?.cantidad ?? 0 })),
    top_conductores: top(anticipos.map((a) => ({ clave: a.conductor.id, etiqueta: `${a.conductor.nombre} ${a.conductor.apellido}`.trim(), valor: num(a.valor) }))),
    top_placas: top(anticipos.map((a) => ({ clave: a.vehiculo.id, etiqueta: a.vehiculo.placa, valor: num(a.valor) }))),
    /// Saldo de cada fondo para anticipos (hoy uno: el del área de operaciones).
    fondos: fondos.map((x) => ({ usuario_id: x.fondo, nombre: x.fondo === 'OPERACIONES' ? 'Área de operaciones' : x.fondo, saldo: redondear(num(x._sum.valor)) }))
  }
}
