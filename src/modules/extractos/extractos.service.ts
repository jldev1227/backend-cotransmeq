/**
 * Extractos de contrato (FUEC, formato OP-FR-04).
 *
 * Un extracto es un documento que, una vez emitido, no cambia: lleva una firma
 * del contenido impreso (`fuec-firma.ts`) y un código que va en el QR. Si hay
 * que corregirlo se emite otro que lo reemplaza y el anterior queda anulado.
 *
 * Lo que se repite de un extracto a otro vive en catálogos (`fuec_contratante`
 * y `fuec_catalogo`) y en la ficha del vehículo (número interno, tarjeta de
 * operación, afiliación) y del conductor (vigencia de la licencia). Emitir un
 * extracto actualiza esas fichas con lo que se escribió, para que el próximo
 * salga ya lleno.
 */
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { hoyBogota } from '../dashboard/periodo'
import { FUEC } from './fuec.config'
import { firmaValida, firmarSnapshot, huella, nuevoCodigoVerificacion, type SnapshotFuec } from './fuec-firma'

export class ExtractosError extends Error {
  constructor(message: string, public status = 400, public code?: string) {
    super(message)
  }
}

export type TipoCatalogo = 'OBJETO' | 'CONVENIO' | 'ORIGEN_DESTINO'
export const TIPOS_CATALOGO: TipoCatalogo[] = ['OBJETO', 'CONVENIO', 'ORIGEN_DESTINO']

export type EstadoEfectivo = 'VIGENTE' | 'POR_VENCER' | 'VENCIDO' | 'ANULADO'
/// Días antes del vencimiento en que el extracto pasa a «por vencer».
const DIAS_AVISO = 7

// ── Utilidades ────────────────────────────────────────────────────────────

export function normalizar(s: string | null | undefined): string {
  return (s ?? '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizarPlaca(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

const ymd = (d: Date | null | undefined): string | null => (d ? d.toISOString().slice(0, 10) : null)
const aFecha = (s: string): Date => new Date(`${s}T00:00:00Z`)

/** «24» → «0024»; lo que no es número se deja tal cual. */
export function pad4(v: string | number | null | undefined): string {
  const s = String(v ?? '').trim()
  return /^\d+$/.test(s) ? s.padStart(4, '0') : s
}

export function numeroFuec(anio: number, contrato: string, consecutivo: number): string {
  return `${FUEC.prefijo}${anio}${pad4(contrato)}${pad4(consecutivo)}`
}

export function esAfiliacionPropia(empresa: string | null | undefined): boolean {
  const n = normalizar(empresa)
  return !n || n === 'N/A' || n === 'N / A' || FUEC.afiliacion_propia.some((p) => normalizar(p) === n)
}

export function estadoEfectivo(e: { anulado_at: Date | null; vigencia_hasta: Date }, hoy = hoyBogota()): EstadoEfectivo {
  if (e.anulado_at) return 'ANULADO'
  const hasta = ymd(e.vigencia_hasta)!
  if (hasta < hoy) return 'VENCIDO'
  const limite = new Date(aFecha(hoy).getTime() + DIAS_AVISO * 86_400_000).toISOString().slice(0, 10)
  return hasta <= limite ? 'POR_VENCER' : 'VIGENTE'
}

function sumarDias(ymdStr: string, dias: number): string {
  return new Date(aFecha(ymdStr).getTime() + dias * 86_400_000).toISOString().slice(0, 10)
}

// ── Lectura ───────────────────────────────────────────────────────────────

const incluirDetalle = {
  conductores: { orderBy: { orden: 'asc' as const } },
  creado_por: { select: { id: true, nombre: true } },
  anulado_por: { select: { id: true, nombre: true } },
  reemplaza_a: { select: { id: true, numero_completo: true, consecutivo: true } },
  reemplazado_por: { where: { deleted_at: null }, select: { id: true, numero_completo: true, consecutivo: true } },
} satisfies Prisma.fuec_extractInclude

type ExtractoConTodo = Prisma.fuec_extractGetPayload<{ include: typeof incluirDetalle }>

function formatearExtracto(e: ExtractoConTodo, hoy: string) {
  const responsable = (e.responsable_json ?? {}) as Record<string, string | null>
  return {
    id: e.id,
    consecutivo: e.consecutivo,
    numero_completo: e.numero_completo,
    estado: estadoEfectivo(e, hoy),
    contratante_id: e.contratante_id,
    contratante_nombre: e.contratante_nombre,
    contratante_nit: e.contratante_nit,
    contrato_numero: e.contrato_numero,
    objeto_contrato: e.objeto_contrato,
    origen_destino: e.origen_destino,
    convenio: e.convenio,
    vigencia_desde: ymd(e.vigencia_desde)!,
    vigencia_hasta: ymd(e.vigencia_hasta)!,
    vehiculo_id: e.vehiculo_id,
    placa: e.vehiculo_placa,
    modelo: e.modelo,
    marca: e.marca,
    clase: e.clase,
    numero_interno: e.numero_interno,
    tarjeta_operacion: e.tarjeta_operacion,
    conductores: e.conductores.map((c) => ({
      id: c.id,
      conductor_id: c.conductor_id,
      nombre: c.nombre,
      cedula: c.identificacion,
      licencia_vigencia: ymd(c.licencia_vigencia),
      orden: c.orden,
    })),
    responsable: {
      nombre: responsable.nombre ?? null,
      cedula: responsable.cedula ?? null,
      telefono: responsable.telefono ?? null,
      direccion: responsable.direccion ?? null,
    },
    codigo_verificacion: e.codigo_verificacion,
    huella: huella(e.firma_sha512),
    firmado: !!e.firma_sha512,
    emitido_at: e.emitido_at?.toISOString() ?? e.created_at.toISOString(),
    source: e.source,
    creado_por: e.creado_por,
    anulado_at: e.anulado_at?.toISOString() ?? null,
    anulado_por: e.anulado_por,
    motivo_anulacion: e.motivo_anulacion,
    reemplaza_a: e.reemplaza_a,
    reemplazado_por: e.reemplazado_por,
    snapshot: e.snapshot_json,
  }
}

export type ExtractoDTO = ReturnType<typeof formatearExtracto>

export interface FiltrosListado {
  q?: string
  placa?: string
  contratante_id?: string
  estado?: 'todos' | 'vigentes' | 'por_vencer' | 'vencidos' | 'anulados'
  anio?: number
  page?: number
  limit?: number
}

export async function listarExtractos(f: FiltrosListado) {
  const hoy = hoyBogota()
  const page = Math.max(1, f.page ?? 1)
  const limit = Math.min(100, Math.max(1, f.limit ?? 25))
  const base: Prisma.fuec_extractWhereInput = { deleted_at: null }
  if (f.anio) base.vigencia_desde = { gte: aFecha(`${f.anio}-01-01`), lte: aFecha(`${f.anio}-12-31`) }
  if (f.placa) base.vehiculo_placa = normalizarPlaca(f.placa)
  if (f.contratante_id) base.contratante_id = f.contratante_id
  if (f.q?.trim()) {
    const q = f.q.trim()
    base.OR = [
      { numero_completo: { contains: q } },
      { vehiculo_placa: { contains: normalizarPlaca(q) } },
      { contratante_nombre: { contains: q, mode: 'insensitive' } },
      { origen_destino: { contains: q, mode: 'insensitive' } },
      { conductores: { some: { nombre: { contains: q, mode: 'insensitive' } } } },
      ...(/^\d+$/.test(q) ? [{ consecutivo: Number(q) }] : []),
    ]
  }
  const limite = aFecha(sumarDias(hoy, DIAS_AVISO))
  const porEstado: Record<NonNullable<FiltrosListado['estado']>, Prisma.fuec_extractWhereInput> = {
    todos: {},
    vigentes: { anulado_at: null, vigencia_hasta: { gte: aFecha(hoy) } },
    por_vencer: { anulado_at: null, vigencia_hasta: { gte: aFecha(hoy), lte: limite } },
    vencidos: { anulado_at: null, vigencia_hasta: { lt: aFecha(hoy) } },
    anulados: { anulado_at: { not: null } },
  }
  const where: Prisma.fuec_extractWhereInput = { AND: [base, porEstado[f.estado ?? 'todos']] }
  const [total, filas, vigentes, porVencer, vencidos, anulados] = await Promise.all([
    prisma.fuec_extract.count({ where }),
    prisma.fuec_extract.findMany({ where, include: incluirDetalle, orderBy: { consecutivo: 'desc' }, skip: (page - 1) * limit, take: limit }),
    prisma.fuec_extract.count({ where: { AND: [base, porEstado.vigentes] } }),
    prisma.fuec_extract.count({ where: { AND: [base, porEstado.por_vencer] } }),
    prisma.fuec_extract.count({ where: { AND: [base, porEstado.vencidos] } }),
    prisma.fuec_extract.count({ where: { AND: [base, porEstado.anulados] } }),
  ])
  return {
    data: filas.map((e) => formatearExtracto(e, hoy)),
    total,
    page,
    limit,
    conteos: { todos: vigentes + vencidos + anulados, vigentes, por_vencer: porVencer, vencidos, anulados },
  }
}

export async function obtenerExtracto(id: string): Promise<ExtractoDTO> {
  const e = await prisma.fuec_extract.findFirst({ where: { id, deleted_at: null }, include: incluirDetalle })
  if (!e) throw new ExtractosError('Extracto no encontrado', 404, 'NO_ENCONTRADO')
  return formatearExtracto(e, hoyBogota())
}

export async function aniosDisponibles(): Promise<number[]> {
  const filas = await prisma.$queryRaw<Array<{ anio: number }>>`
    SELECT DISTINCT EXTRACT(YEAR FROM vigencia_desde)::int AS anio FROM fuec_extract WHERE deleted_at IS NULL ORDER BY anio DESC`
  return filas.map((f) => f.anio)
}

// ── Catálogos ─────────────────────────────────────────────────────────────

export async function listarContratantes(q?: string) {
  const where: Prisma.fuec_contratanteWhereInput = { deleted_at: null }
  if (q?.trim()) where.OR = [{ nombre: { contains: q.trim(), mode: 'insensitive' } }, { nit: { contains: q.trim() } }, { numero_contrato: q.trim() }]
  const filas = await prisma.fuec_contratante.findMany({ where, orderBy: [{ usos: 'desc' }, { nombre: 'asc' }], take: 500 })
  return filas.map(formatearContratante)
}

function formatearContratante(c: Prisma.fuec_contratanteGetPayload<object>) {
  return {
    id: c.id,
    nombre: c.nombre,
    nit: c.nit,
    numero_contrato: c.numero_contrato,
    cliente_id: c.cliente_id,
    responsable: { nombre: c.responsable_nombre, cedula: c.responsable_cedula, telefono: c.responsable_telefono, direccion: c.responsable_direccion },
    usos: c.usos,
    ultimo_uso_at: c.ultimo_uso_at?.toISOString() ?? null,
  }
}

export interface ContratanteInput {
  nombre: string
  nit?: string | null
  numero_contrato?: string | null
  cliente_id?: string | null
  responsable?: { nombre?: string | null; cedula?: string | null; telefono?: string | null; direccion?: string | null } | null
}

function datosContratante(d: ContratanteInput) {
  const limpio = (v: string | null | undefined) => (v?.trim() ? v.trim() : null)
  return {
    nombre: d.nombre.trim().replace(/\s+/g, ' '),
    nit: limpio(d.nit),
    numero_contrato: limpio(d.numero_contrato),
    cliente_id: d.cliente_id || null,
    responsable_nombre: limpio(d.responsable?.nombre),
    responsable_cedula: limpio(d.responsable?.cedula),
    responsable_telefono: limpio(d.responsable?.telefono),
    responsable_direccion: limpio(d.responsable?.direccion),
  }
}

export async function guardarContratante(id: string | null, d: ContratanteInput) {
  if (!d.nombre?.trim()) throw new ExtractosError('El nombre del contratante es obligatorio')
  const datos = datosContratante(d)
  if (id) {
    const existe = await prisma.fuec_contratante.findFirst({ where: { id, deleted_at: null } })
    if (!existe) throw new ExtractosError('Contratante no encontrado', 404)
    return formatearContratante(await prisma.fuec_contratante.update({ where: { id }, data: datos }))
  }
  const repetido = await buscarContratantePorNombre(prisma, datos.nombre)
  if (repetido) throw new ExtractosError(`Ya existe el contratante «${repetido.nombre}»`, 409, 'DUPLICADO')
  return formatearContratante(await prisma.fuec_contratante.create({ data: datos }))
}

export async function eliminarContratante(id: string) {
  const r = await prisma.fuec_contratante.updateMany({ where: { id, deleted_at: null }, data: { deleted_at: new Date() } })
  if (!r.count) throw new ExtractosError('Contratante no encontrado', 404)
}

async function buscarContratantePorNombre(tx: Prisma.TransactionClient | typeof prisma, nombre: string) {
  const n = normalizar(nombre)
  const candidatos = await tx.fuec_contratante.findMany({ where: { deleted_at: null, nombre: { contains: nombre.slice(0, 12), mode: 'insensitive' } } })
  return candidatos.find((c) => normalizar(c.nombre) === n) ?? null
}

export async function listarCatalogo(tipo: TipoCatalogo) {
  const filas = await prisma.fuec_catalogo.findMany({ where: { tipo, deleted_at: null }, orderBy: [{ usos: 'desc' }, { texto: 'asc' }], take: 300 })
  return filas.map((c) => ({ id: c.id, tipo: c.tipo as TipoCatalogo, texto: c.texto, usos: c.usos }))
}

export async function eliminarCatalogo(id: string) {
  const r = await prisma.fuec_catalogo.updateMany({ where: { id, deleted_at: null }, data: { deleted_at: new Date() } })
  if (!r.count) throw new ExtractosError('Entrada no encontrada', 404)
}

/** Suma un uso al texto en el catálogo; lo crea si no existe. Lo revive si estaba borrado. */
export async function usarCatalogo(tx: Prisma.TransactionClient, tipo: TipoCatalogo, texto: string | null | undefined) {
  const t = (texto ?? '').trim().replace(/\s+/g, ' ')
  if (!t || (tipo === 'CONVENIO' && esAfiliacionPropia(t))) return
  await tx.fuec_catalogo.upsert({
    where: { tipo_texto: { tipo, texto: t } },
    create: { tipo, texto: t, usos: 1, ultimo_uso_at: new Date() },
    update: { usos: { increment: 1 }, ultimo_uso_at: new Date(), deleted_at: null },
  })
}

// ── Datos para el formulario ──────────────────────────────────────────────

export async function opcionesFormulario() {
  const hoy = hoyBogota()
  const [ultimo, contratantes, objetos, convenios, origenes, vehiculos, conductores] = await Promise.all([
    prisma.fuec_extract.aggregate({ _max: { consecutivo: true } }),
    listarContratantes(),
    listarCatalogo('OBJETO'),
    listarCatalogo('CONVENIO'),
    listarCatalogo('ORIGEN_DESTINO'),
    prisma.vehiculos.findMany({
      where: { deleted_at: null, oculto: false },
      select: { id: true, placa: true, modelo: true, marca: true, clase_vehiculo: true, numero_interno: true, tarjeta_operacion: true, empresa_afiliacion: true, estado: true },
      orderBy: { placa: 'asc' },
    }),
    prisma.conductores.findMany({
      where: { deleted_at: null, oculto: false },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true, vencimiento_licencia: true, licencia_conduccion: true, estado: true },
      orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
    }),
  ])
  return {
    empresa: { ...FUEC, afiliacion_propia: undefined },
    hoy,
    siguiente_consecutivo: (ultimo._max.consecutivo ?? 0) + 1,
    anio: Number(hoy.slice(0, 4)),
    vigencia_defecto: { desde: hoy, hasta: sumarDias(hoy, 30) },
    contratantes,
    catalogos: { OBJETO: objetos, CONVENIO: convenios, ORIGEN_DESTINO: origenes },
    vehiculos: vehiculos.map((v) => ({
      id: v.id,
      placa: v.placa,
      modelo: v.modelo,
      marca: v.marca,
      clase: v.clase_vehiculo === 'POR DEFINIR' ? null : v.clase_vehiculo,
      numero_interno: v.numero_interno,
      tarjeta_operacion: v.tarjeta_operacion,
      empresa_afiliacion: v.empresa_afiliacion,
      estado: v.estado,
    })),
    conductores: conductores.map((c) => ({
      id: c.id,
      nombre: `${c.nombre} ${c.apellido}`.replace(/\s+/g, ' ').trim(),
      cedula: c.numero_identificacion,
      licencia_vigencia: ymd(c.vencimiento_licencia) ?? vigenciaDeLicenciaJson(c.licencia_conduccion),
      estado: c.estado,
    })),
  }
}

/** `licencia_conduccion` es `{categorias:[{categoria, vigencia_hasta}]}`: se toma la vigencia más lejana. */
function vigenciaDeLicenciaJson(json: Prisma.JsonValue | null): string | null {
  const cats = (json as { categorias?: Array<{ vigencia_hasta?: string | null }> } | null)?.categorias
  if (!Array.isArray(cats)) return null
  const fechas = cats.map((c) => c.vigencia_hasta?.slice(0, 10)).filter((f): f is string => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f))
  return fechas.sort().at(-1) ?? null
}

// ── Emisión ───────────────────────────────────────────────────────────────

export interface EmitirInput {
  contratante: ContratanteInput & { id?: string | null }
  contrato_numero?: string | null
  objeto_contrato: string
  origen_destino: string
  convenio?: string | null
  vigencia_desde: string
  vigencia_hasta: string
  vehiculo: {
    id?: string | null
    placa: string
    modelo?: string | null
    marca?: string | null
    clase?: string | null
    numero_interno?: string | null
    tarjeta_operacion?: string | null
  }
  conductores: Array<{ id?: string | null; nombre: string; cedula?: string | null; licencia_vigencia?: string | null }>
  reemplaza_a_id?: string | null
  /** Escribir en la ficha del vehículo y de los conductores lo que se digitó (por defecto sí). */
  actualizar_fichas?: boolean
}

const limpio = (v: string | null | undefined, max = 255) => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

export async function emitirExtracto(usuarioId: string, input: EmitirInput): Promise<ExtractoDTO> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.vigencia_desde) || !/^\d{4}-\d{2}-\d{2}$/.test(input.vigencia_hasta)) {
    throw new ExtractosError('Las fechas de vigencia deben ser YYYY-MM-DD')
  }
  if (input.vigencia_hasta < input.vigencia_desde) throw new ExtractosError('La fecha de vencimiento no puede ser anterior a la inicial')
  const conductores = input.conductores.filter((c) => c.nombre?.trim()).slice(0, 3)
  if (!conductores.length) throw new ExtractosError('El extracto necesita al menos un conductor')
  const placa = normalizarPlaca(input.vehiculo.placa ?? '')
  if (placa.length < 5) throw new ExtractosError('La placa del vehículo no es válida')
  const objeto = limpio(input.objeto_contrato, 2000)
  const origenDestino = limpio(input.origen_destino, 500)
  if (!objeto) throw new ExtractosError('El objeto del contrato es obligatorio')
  if (!origenDestino) throw new ExtractosError('El origen-destino es obligatorio')
  const contratoNumero = limpio(input.contrato_numero ?? input.contratante.numero_contrato, 40)
  if (!contratoNumero) throw new ExtractosError('El número de contrato es obligatorio')
  const actualizarFichas = input.actualizar_fichas !== false
  const hoy = hoyBogota()
  const ahora = new Date()

  const id = await prisma.$transaction(async (tx) => {
    // Una emisión a la vez: el consecutivo sale de max+1 y dos a la vez lo repetirían.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('fuec_consecutivo'))`
    const ultimo = await tx.fuec_extract.aggregate({ _max: { consecutivo: true } })
    const consecutivo = (ultimo._max.consecutivo ?? 0) + 1

    let reemplazado: { id: string; numero_completo: string } | null = null
    if (input.reemplaza_a_id) {
      const r = await tx.fuec_extract.findFirst({ where: { id: input.reemplaza_a_id, deleted_at: null }, select: { id: true, numero_completo: true, anulado_at: true } })
      if (!r) throw new ExtractosError('El extracto que se reemplaza no existe', 404)
      if (r.anulado_at) throw new ExtractosError('Ese extracto ya está anulado; no se puede reemplazar dos veces', 409, 'YA_ANULADO')
      reemplazado = r
    }

    // Contratante: por id, por nombre, o nuevo. Siempre se le copian los datos digitados.
    const datosC = datosContratante({ ...input.contratante, numero_contrato: contratoNumero })
    let contratante = input.contratante.id
      ? await tx.fuec_contratante.findFirst({ where: { id: input.contratante.id, deleted_at: null } })
      : await buscarContratantePorNombre(tx, datosC.nombre)
    contratante = contratante
      ? await tx.fuec_contratante.update({ where: { id: contratante.id }, data: { ...datosC, usos: { increment: 1 }, ultimo_uso_at: ahora } })
      : await tx.fuec_contratante.create({ data: { ...datosC, usos: 1, ultimo_uso_at: ahora } })

    const convenio = esAfiliacionPropia(input.convenio) ? 'N/A' : limpio(input.convenio)!
    await usarCatalogo(tx, 'OBJETO', objeto)
    await usarCatalogo(tx, 'ORIGEN_DESTINO', origenDestino)
    await usarCatalogo(tx, 'CONVENIO', convenio)

    // Vehículo: se toma la ficha y se actualiza con lo digitado.
    const vehiculo = input.vehiculo.id
      ? await tx.vehiculos.findFirst({ where: { id: input.vehiculo.id, deleted_at: null } })
      : await tx.vehiculos.findFirst({ where: { placa, deleted_at: null } })
    const v = {
      modelo: limpio(input.vehiculo.modelo, 20) ?? vehiculo?.modelo ?? null,
      marca: limpio(input.vehiculo.marca, 100) ?? vehiculo?.marca ?? null,
      clase: limpio(input.vehiculo.clase, 100) ?? (vehiculo?.clase_vehiculo && vehiculo.clase_vehiculo !== 'POR DEFINIR' ? vehiculo.clase_vehiculo : null),
      numero_interno: limpio(input.vehiculo.numero_interno, 20) ?? vehiculo?.numero_interno ?? null,
      tarjeta_operacion: limpio(input.vehiculo.tarjeta_operacion, 60) ?? vehiculo?.tarjeta_operacion ?? null,
    }
    if (vehiculo && actualizarFichas) {
      await tx.vehiculos.update({
        where: { id: vehiculo.id },
        data: {
          numero_interno: v.numero_interno,
          tarjeta_operacion: v.tarjeta_operacion,
          ...(v.modelo && !vehiculo.modelo ? { modelo: v.modelo } : {}),
          ...(v.marca && !vehiculo.marca ? { marca: v.marca } : {}),
          ...(v.clase && (!vehiculo.clase_vehiculo || vehiculo.clase_vehiculo === 'POR DEFINIR') ? { clase_vehiculo: v.clase } : {}),
          ...(convenio !== 'N/A' && !vehiculo.empresa_afiliacion ? { empresa_afiliacion: convenio } : {}),
        },
      })
    }

    // Conductores: nombre tal cual se imprime; la ficha recibe cédula y vigencia si faltaban.
    const drivers: Array<{ conductor_id: string | null; nombre: string; identificacion: string | null; licencia_vigencia: Date | null; orden: number }> = []
    for (const [i, c] of conductores.entries()) {
      const ficha = c.id ? await tx.conductores.findFirst({ where: { id: c.id, deleted_at: null } }) : null
      const cedula = limpio(c.cedula, 50)?.replace(/[.\s]/g, '') ?? ficha?.numero_identificacion ?? null
      const vigencia = c.licencia_vigencia && /^\d{4}-\d{2}-\d{2}$/.test(c.licencia_vigencia) ? c.licencia_vigencia : ymd(ficha?.vencimiento_licencia)
      if (ficha && actualizarFichas) {
        const data: Prisma.conductoresUpdateInput = {}
        if (vigencia && ymd(ficha.vencimiento_licencia) !== vigencia) data.vencimiento_licencia = aFecha(vigencia)
        if (cedula && !ficha.numero_identificacion) {
          const ocupada = await tx.conductores.findFirst({ where: { numero_identificacion: cedula, id: { not: ficha.id } }, select: { id: true } })
          if (!ocupada) data.numero_identificacion = cedula
        }
        if (Object.keys(data).length) await tx.conductores.update({ where: { id: ficha.id }, data })
      }
      drivers.push({
        conductor_id: ficha?.id ?? null,
        nombre: limpio(c.nombre)!.toUpperCase(),
        identificacion: cedula,
        licencia_vigencia: vigencia ? aFecha(vigencia) : null,
        orden: i + 1,
      })
    }

    const anio = Number(hoy.slice(0, 4))
    const numero = numeroFuec(anio, contratoNumero, consecutivo)
    const snapshot: SnapshotFuec = {
      numero,
      consecutivo,
      empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
      contrato_numero: pad4(contratoNumero),
      contratante: { nombre: contratante.nombre, nit: contratante.nit },
      objeto_contrato: objeto,
      origen_destino: origenDestino,
      convenio,
      vigencia_desde: input.vigencia_desde,
      vigencia_hasta: input.vigencia_hasta,
      vehiculo: { placa, ...v },
      conductores: drivers.map((d) => ({ nombre: d.nombre, cedula: d.identificacion, licencia_vigencia: ymd(d.licencia_vigencia) })),
      responsable: {
        nombre: contratante.responsable_nombre,
        cedula: contratante.responsable_cedula,
        telefono: contratante.responsable_telefono,
        direccion: contratante.responsable_direccion,
      },
      emitido_at: ahora.toISOString(),
    }

    const creado = await tx.fuec_extract.create({
      data: {
        consecutivo,
        numero_completo: numero,
        contratante_id: contratante.id,
        contratante_nombre: contratante.nombre,
        contratante_nit: contratante.nit,
        contrato_numero: contratoNumero,
        objeto_contrato: objeto,
        origen_destino: origenDestino,
        convenio,
        vigencia_desde: aFecha(input.vigencia_desde),
        vigencia_hasta: aFecha(input.vigencia_hasta),
        vehiculo_id: vehiculo?.id ?? null,
        vehiculo_placa: placa,
        modelo: v.modelo,
        marca: v.marca,
        clase: v.clase,
        numero_interno: v.numero_interno,
        tarjeta_operacion: v.tarjeta_operacion,
        responsable_json: snapshot.responsable as unknown as Prisma.InputJsonValue,
        responsable: contratante.responsable_nombre,
        estado: 'VIGENTE',
        source: 'MANUAL',
        snapshot_json: snapshot as unknown as Prisma.InputJsonValue,
        firma_sha512: firmarSnapshot(snapshot),
        codigo_verificacion: nuevoCodigoVerificacion(),
        emitido_at: ahora,
        reemplaza_a_id: reemplazado?.id ?? null,
        creado_por_id: usuarioId,
        conductores: { create: drivers },
      },
      select: { id: true },
    })

    if (reemplazado) {
      await tx.fuec_extract.update({
        where: { id: reemplazado.id },
        data: { estado: 'ANULADO', anulado_at: ahora, anulado_por_id: usuarioId, motivo_anulacion: `Reemplazado por el No. ${numero}` },
      })
    }
    return creado.id
  })

  return obtenerExtracto(id)
}

export async function anularExtracto(usuarioId: string, id: string, motivo: string): Promise<ExtractoDTO> {
  const m = limpio(motivo, 500)
  if (!m || m.length < 5) throw new ExtractosError('Escribe el motivo de la anulación (mínimo 5 letras)')
  const e = await prisma.fuec_extract.findFirst({ where: { id, deleted_at: null }, select: { anulado_at: true } })
  if (!e) throw new ExtractosError('Extracto no encontrado', 404)
  if (e.anulado_at) throw new ExtractosError('El extracto ya está anulado', 409, 'YA_ANULADO')
  await prisma.fuec_extract.update({ where: { id }, data: { estado: 'ANULADO', anulado_at: new Date(), anulado_por_id: usuarioId, motivo_anulacion: m } })
  return obtenerExtracto(id)
}

// ── Validación pública (QR) ───────────────────────────────────────────────

function enmascarar(cedula: string | null): string | null {
  if (!cedula) return null
  const d = cedula.replace(/\D/g, '')
  return d.length > 4 ? `${'•'.repeat(Math.max(0, d.length - 4))}${d.slice(-4)}` : cedula
}

export async function verificarPublico(codigo: string) {
  const c = codigo.trim().toUpperCase()
  if (!/^[A-Z2-9]{8,24}$/.test(c)) throw new ExtractosError('Código no válido', 404, 'NO_ENCONTRADO')
  const e = await prisma.fuec_extract.findFirst({ where: { codigo_verificacion: c, deleted_at: null }, include: incluirDetalle })
  if (!e) throw new ExtractosError('No existe un extracto con ese código', 404, 'NO_ENCONTRADO')
  const snapshot = e.snapshot_json as unknown as SnapshotFuec
  const valida = firmaValida(snapshot, e.firma_sha512)
  const hoy = hoyBogota()
  return {
    numero: e.numero_completo,
    consecutivo: e.consecutivo,
    estado: estadoEfectivo(e, hoy),
    firma_valida: valida,
    huella: huella(e.firma_sha512),
    emitido_at: e.emitido_at?.toISOString() ?? null,
    empresa: { razon_social: FUEC.razon_social, nit: FUEC.nit },
    contratante: e.contratante_nombre,
    contrato_numero: pad4(e.contrato_numero),
    objeto_contrato: e.objeto_contrato,
    origen_destino: e.origen_destino,
    convenio: e.convenio,
    vigencia_desde: ymd(e.vigencia_desde),
    vigencia_hasta: ymd(e.vigencia_hasta),
    vehiculo: { placa: e.vehiculo_placa, modelo: e.modelo, marca: e.marca, clase: e.clase, numero_interno: e.numero_interno, tarjeta_operacion: e.tarjeta_operacion },
    conductores: e.conductores.map((d) => ({ nombre: d.nombre, cedula: enmascarar(d.identificacion), licencia_vigencia: ymd(d.licencia_vigencia) })),
    anulado: e.anulado_at ? { fecha: e.anulado_at.toISOString(), motivo: e.motivo_anulacion } : null,
    reemplazado_por: e.reemplazado_por[0]?.numero_completo ?? null,
  }
}
