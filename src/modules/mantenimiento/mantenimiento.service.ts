import { randomUUID } from 'crypto'
import path from 'path'
import { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import { CATEGORIAS_MANTENIMIENTO, etiquetaCategoria, type TipoAdjunto } from './catalogo'
import {
  avanzaPlan,
  calcularProximo,
  compararUrgencia,
  evaluarPlan,
  tienePeriodicidad,
  totalesOrden,
  transicionValida,
  UMBRAL_DIAS_PROXIMO,
  UMBRAL_KM_PROXIMO,
  type EstadoOrden,
  type EvaluacionPlan,
  type LineaRepuesto,
} from './calculo'
import type {
  ActualizarOrdenInput,
  ActualizarPlanInput,
  CambiarEstadoOrdenInput,
  CostosInput,
  CrearOrdenInput,
  CrearPlanInput,
  ListarOrdenesInput,
  ListarPlanesInput,
} from './mantenimiento.schema'

/**
 * Mantenimiento de flota: planes preventivos por vehículo y órdenes de trabajo.
 *
 * Sobre `vehicle_maintenance_plan` / `vehicle_maintenance_event`, que nacieron
 * con el PESV y estaban vacías. Nada de esto toca `mantenimientos`, que es un
 * concepto de nómina.
 *
 * El estado de un plan (vencido, próximo, al día) NO se guarda: depende del
 * kilometraje de la ficha, que el cron de preoperacionales mueve cada hora, y
 * de la fecha de hoy. Se calcula al leer con `evaluarPlan`; lo que se guarda
 * es el próximo km y la próxima fecha, que solo cambian cuando cambia el plan
 * o se cierra una orden.
 */

export class MantenimientoError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message)
  }
}

const noEncontrado = (que: string) => new MantenimientoError(404, 'NO_ENCONTRADO', `${que} no encontrado`)

/** Hoy en Colombia, `YYYY-MM-DD`: el servidor corre en UTC y a las 7 p. m. ya sería mañana. */
export function hoyColombia(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date())
}

const isoDia = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : null)
const aFecha = (iso: string | null | undefined) => (iso ? new Date(`${iso}T00:00:00Z`) : null)
const num = (d: Prisma.Decimal | number | null | undefined) => (d == null ? null : Number(d))
/// La ficha nace con kilometraje 0: eso es «no se sabe», no un vehículo nuevo.
const kmFicha = (km: number | null | undefined) => (km != null && km > 0 ? km : null)

// ── Planes ──────────────────────────────────────────────────────────────

const SELECT_PLAN = {
  id: true,
  vehiculo_id: true,
  nombre: true,
  categoria: true,
  periodicidad_km: true,
  periodicidad_meses: true,
  periodicidad_dias: true,
  ultima_ejecucion_fecha: true,
  ultima_ejecucion_km: true,
  proxima_fecha: true,
  proximo_km: true,
  ultimo_evento_id: true,
  activo: true,
  observaciones: true,
  created_at: true,
  vehiculo: { select: { id: true, placa: true, marca: true, linea: true, kilometraje: true, oculto: true } },
} satisfies Prisma.vehicle_maintenance_planSelect

type FilaPlan = Prisma.vehicle_maintenance_planGetPayload<{ select: typeof SELECT_PLAN }>

function serializarPlan(p: FilaPlan, hoy: string, ordenAbierta?: { id: string; consecutivo: number; estado: string } | null) {
  const proxima_fecha = isoDia(p.proxima_fecha)
  const km_actual = kmFicha(p.vehiculo.kilometraje)
  const evaluacion = evaluarPlan({ proximo_km: p.proximo_km, proxima_fecha, km_actual, hoy, activo: p.activo })
  return {
    id: p.id,
    vehiculo: { id: p.vehiculo.id, placa: p.vehiculo.placa, marca: p.vehiculo.marca, linea: p.vehiculo.linea },
    categoria: p.categoria ?? 'OTRO',
    categoria_etiqueta: etiquetaCategoria(p.categoria),
    nombre: p.nombre,
    periodicidad_km: p.periodicidad_km,
    periodicidad_meses: p.periodicidad_meses,
    periodicidad_dias: p.periodicidad_dias,
    ultima_ejecucion_fecha: isoDia(p.ultima_ejecucion_fecha),
    ultima_ejecucion_km: p.ultima_ejecucion_km,
    ultimo_evento_id: p.ultimo_evento_id,
    proxima_fecha,
    proximo_km: p.proximo_km,
    km_actual,
    activo: p.activo,
    observaciones: p.observaciones,
    orden_abierta: ordenAbierta ?? null,
    ...evaluacion,
  }
}

export type PlanSerializado = ReturnType<typeof serializarPlan>

/** Órdenes abiertas por plan: la lista ofrece «ver OT 12» en vez de «crear orden». */
async function ordenesAbiertasDe(planIds: string[]) {
  if (!planIds.length) return new Map<string, { id: string; consecutivo: number; estado: string }>()
  const filas = await prisma.vehicle_maintenance_event.findMany({
    where: { plan_id: { in: planIds }, deleted_at: null, estado: { in: ['PROGRAMADO', 'EN_CURSO'] } },
    select: { id: true, plan_id: true, consecutivo: true, estado: true },
    orderBy: { consecutivo: 'desc' },
  })
  const mapa = new Map<string, { id: string; consecutivo: number; estado: string }>()
  for (const f of filas) if (f.plan_id && !mapa.has(f.plan_id)) mapa.set(f.plan_id, { id: f.id, consecutivo: f.consecutivo, estado: f.estado })
  return mapa
}

/**
 * Todos los planes vivos de vehículos visibles, ya evaluados.
 *
 * La flota es un catálogo acotado (cientos de vehículos, unos pocos planes por
 * cada uno): se trae entero y se filtra en memoria, porque el estado no es una
 * columna y no se puede filtrar en SQL sin repetir `evaluarPlan` allí.
 */
async function planesEvaluados(where: Prisma.vehicle_maintenance_planWhereInput = {}) {
  const hoy = hoyColombia()
  const filas = await prisma.vehicle_maintenance_plan.findMany({
    where: { deleted_at: null, vehiculo: { deleted_at: null, oculto: false }, ...where },
    select: SELECT_PLAN,
  })
  const abiertas = await ordenesAbiertasDe(filas.map((f) => f.id))
  return filas.map((f) => serializarPlan(f, hoy, abiertas.get(f.id)))
}

function contarEstados(planes: PlanSerializado[]) {
  const c = { vencido: 0, proximo: 0, al_dia: 0, sin_datos: 0, pausado: 0, total: planes.length }
  for (const p of planes) c[p.estado] += 1
  return c
}

const normalizar = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

/** Todas las palabras en algún campo, sin tildes: «abc aceite» encuentra el cambio de aceite de ABC123. */
function coincide(q: string | undefined, campos: Array<string | null | undefined>) {
  const palabras = normalizar(q ?? '').split(/\s+/).filter(Boolean)
  if (!palabras.length) return true
  const texto = normalizar(campos.filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}

async function validarVehiculos(ids: string[]) {
  const vehiculos = await prisma.vehiculos.findMany({
    where: { id: { in: ids }, deleted_at: null },
    select: { id: true, placa: true, kilometraje: true },
  })
  if (vehiculos.length !== ids.length) throw new MantenimientoError(400, 'VEHICULO_INVALIDO', 'Algún vehículo no existe o está en la papelera')
  return new Map(vehiculos.map((v) => [v.id, v]))
}

// ── Órdenes ─────────────────────────────────────────────────────────────

const SELECT_ORDEN = {
  id: true,
  consecutivo: true,
  plan_id: true,
  vehiculo_id: true,
  tipo: true,
  estado: true,
  descripcion: true,
  fecha_programada: true,
  km_programado: true,
  fecha_ejecucion: true,
  km_ejecucion: true,
  taller: true,
  responsable: true,
  numero_factura: true,
  repuestos_detalle: true,
  costo_repuestos: true,
  costo_mano_obra: true,
  costo: true,
  observaciones: true,
  motivo_anulacion: true,
  iniciado_at: true,
  cerrado_at: true,
  anulado_at: true,
  created_at: true,
  vehiculo: { select: { id: true, placa: true, marca: true, linea: true, kilometraje: true } },
  plan: { select: { id: true, nombre: true, categoria: true, deleted_at: true } },
  creado_por: { select: { nombre: true } },
  ejecutado_por: { select: { nombre: true } },
  _count: { select: { adjuntos: { where: { deleted_at: null } } } },
} satisfies Prisma.vehicle_maintenance_eventSelect

type FilaOrden = Prisma.vehicle_maintenance_eventGetPayload<{ select: typeof SELECT_ORDEN }>

function serializarOrden(o: FilaOrden) {
  return {
    id: o.id,
    consecutivo: o.consecutivo,
    tipo: o.tipo,
    estado: o.estado,
    descripcion: o.descripcion,
    vehiculo: { id: o.vehiculo.id, placa: o.vehiculo.placa, marca: o.vehiculo.marca, linea: o.vehiculo.linea, km_actual: kmFicha(o.vehiculo.kilometraje) },
    plan: o.plan
      ? { id: o.plan.id, nombre: o.plan.nombre, categoria: o.plan.categoria, categoria_etiqueta: etiquetaCategoria(o.plan.categoria), eliminado: !!o.plan.deleted_at }
      : null,
    fecha: isoDia(o.fecha_programada),
    km: o.km_programado,
    fecha_ejecucion: isoDia(o.fecha_ejecucion),
    km_ejecucion: o.km_ejecucion,
    taller: o.taller,
    responsable: o.responsable,
    numero_factura: o.numero_factura,
    repuestos: (Array.isArray(o.repuestos_detalle) ? o.repuestos_detalle : []) as unknown as LineaRepuesto[],
    costo_repuestos: num(o.costo_repuestos) ?? 0,
    costo_mano_obra: num(o.costo_mano_obra) ?? 0,
    costo: num(o.costo) ?? 0,
    observaciones: o.observaciones,
    motivo_anulacion: o.motivo_anulacion,
    iniciado_at: o.iniciado_at?.toISOString() ?? null,
    cerrado_at: o.cerrado_at?.toISOString() ?? null,
    anulado_at: o.anulado_at?.toISOString() ?? null,
    creado_at: o.created_at.toISOString(),
    creado_por: o.creado_por?.nombre ?? null,
    cerrado_por: o.ejecutado_por?.nombre ?? null,
    adjuntos: o._count.adjuntos,
  }
}

export type OrdenSerializada = ReturnType<typeof serializarOrden>

/// Resumen en texto de los repuestos para la columna `repuestos` heredada del
/// PESV, que es la que leería un informe que no conozca el detalle.
const resumenRepuestos = (lineas: LineaRepuesto[]) =>
  lineas.length ? lineas.map((l) => `${l.cantidad} × ${l.descripcion}`).join('; ').slice(0, 4000) : null

async function ordenViva(id: string) {
  const o = await prisma.vehicle_maintenance_event.findFirst({ where: { id, deleted_at: null }, select: SELECT_ORDEN })
  if (!o) throw noEncontrado('Orden de trabajo')
  return o
}

function whereOrdenes(input: Omit<ListarOrdenesInput, 'page' | 'limit'>, conEstado = true): Prisma.vehicle_maintenance_eventWhereInput {
  const and: Prisma.vehicle_maintenance_eventWhereInput[] = [{ deleted_at: null, vehiculo: { deleted_at: null } }]
  if (conEstado) {
    if (input.estado === 'abiertas') and.push({ estado: { in: ['PROGRAMADO', 'EN_CURSO'] } })
    else if (input.estado !== 'todas') and.push({ estado: input.estado })
  }
  if (input.tipo !== 'todos') and.push({ tipo: input.tipo })
  if (input.vehiculo_id) and.push({ vehiculo_id: input.vehiculo_id })
  if (input.plan_id) and.push({ plan_id: input.plan_id })
  /// El periodo de una orden cerrada es el de su cierre; el de una abierta, su fecha.
  if (input.desde || input.hasta) {
    const rango = { ...(input.desde ? { gte: aFecha(input.desde)! } : {}), ...(input.hasta ? { lte: aFecha(input.hasta)! } : {}) }
    and.push({ OR: [{ fecha_ejecucion: rango }, { fecha_ejecucion: null, fecha_programada: rango }] })
  }
  const q = input.q?.trim()
  if (q) {
    const n = Number(q.replace(/^ot\s*/i, ''))
    and.push({
      OR: [
        { descripcion: { contains: q, mode: 'insensitive' } },
        { taller: { contains: q, mode: 'insensitive' } },
        { numero_factura: { contains: q, mode: 'insensitive' } },
        { vehiculo: { placa: { contains: q.replace(/\s|-/g, ''), mode: 'insensitive' } } },
        { plan: { nombre: { contains: q, mode: 'insensitive' } } },
        ...(Number.isInteger(n) && n > 0 && n < 2_147_483_647 ? [{ consecutivo: n }] : []),
      ],
    })
  }
  return { AND: and }
}

/** Primer y último día del mes de una fecha `YYYY-MM-DD`. */
function mesDe(iso: string) {
  const [y, m] = iso.split('-').map(Number)
  const ultimo = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { desde: `${iso.slice(0, 7)}-01`, hasta: `${iso.slice(0, 7)}-${String(ultimo).padStart(2, '0')}` }
}

export const MantenimientoService = {
  /** Catálogo, umbrales y vehículos elegibles para los formularios. */
  async opciones() {
    const vehiculos = await prisma.vehiculos.findMany({
      where: { deleted_at: null, oculto: false },
      select: { id: true, placa: true, marca: true, linea: true, kilometraje: true, estado: true },
      orderBy: { placa: 'asc' },
    })
    return {
      hoy: hoyColombia(),
      categorias: CATEGORIAS_MANTENIMIENTO,
      umbrales: { km: UMBRAL_KM_PROXIMO, dias: UMBRAL_DIAS_PROXIMO },
      vehiculos: vehiculos.map((v) => ({ ...v, kilometraje: kmFicha(v.kilometraje) })),
    }
  },

  /** Las cifras de la cabecera: vencidos, próximos, órdenes abiertas y costo del mes. */
  async resumen() {
    const hoy = hoyColombia()
    const mes = mesDe(hoy)
    const [planes, abiertas, costoMes] = await Promise.all([
      planesEvaluados(),
      prisma.vehicle_maintenance_event.groupBy({
        by: ['estado'],
        where: { deleted_at: null, vehiculo: { deleted_at: null }, estado: { in: ['PROGRAMADO', 'EN_CURSO'] } },
        _count: { _all: true },
      }),
      prisma.vehicle_maintenance_event.aggregate({
        where: {
          deleted_at: null,
          vehiculo: { deleted_at: null },
          estado: 'EJECUTADO',
          fecha_ejecucion: { gte: aFecha(mes.desde)!, lte: aFecha(mes.hasta)! },
        },
        _sum: { costo: true },
        _count: { _all: true },
      }),
    ])
    const cuenta = (e: string) => abiertas.find((a) => a.estado === e)?._count._all ?? 0
    return {
      hoy,
      planes: contarEstados(planes),
      ordenes: { abiertas: cuenta('PROGRAMADO') + cuenta('EN_CURSO'), programadas: cuenta('PROGRAMADO'), en_curso: cuenta('EN_CURSO') },
      costo_mes: { mes: hoy.slice(0, 7), total: num(costoMes._sum.costo) ?? 0, ordenes: costoMes._count._all },
    }
  },

  async listarPlanes(input: ListarPlanesInput) {
    const todos = await planesEvaluados({
      ...(input.vehiculo_id ? { vehiculo_id: input.vehiculo_id } : {}),
      ...(input.categoria ? { categoria: input.categoria } : {}),
    })
    const buscados = todos.filter((p) =>
      coincide(input.q, [p.vehiculo.placa, p.vehiculo.marca, p.vehiculo.linea, p.nombre, p.categoria_etiqueta]),
    )
    const filtrados = buscados.filter((p) =>
      input.estado === 'todos' ? true : input.estado === 'alerta' ? p.estado === 'vencido' || p.estado === 'proximo' : p.estado === input.estado,
    )
    filtrados.sort((a, b) => compararUrgencia(a, b) || a.vehiculo.placa.localeCompare(b.vehiculo.placa, 'es', { numeric: true }))
    const inicio = (input.page - 1) * input.limit
    return {
      items: filtrados.slice(inicio, inicio + input.limit),
      total: filtrados.length,
      page: input.page,
      limit: input.limit,
      /// Conteos sobre lo buscado pero sin el filtro de estado: así las
      /// pastillas dicen cuántos hay en cada estado para esa búsqueda.
      conteos: contarEstados(buscados),
    }
  },

  async detallePlan(id: string) {
    const fila = await prisma.vehicle_maintenance_plan.findFirst({ where: { id, deleted_at: null, vehiculo: { deleted_at: null } }, select: SELECT_PLAN })
    if (!fila) throw noEncontrado('Plan de mantenimiento')
    const [abiertas, ordenes] = await Promise.all([
      ordenesAbiertasDe([id]),
      prisma.vehicle_maintenance_event.findMany({
        where: { plan_id: id, deleted_at: null },
        select: SELECT_ORDEN,
        orderBy: { consecutivo: 'desc' },
        take: 50,
      }),
    ])
    return { ...serializarPlan(fila, hoyColombia(), abiertas.get(id)), ordenes: ordenes.map(serializarOrden) }
  },

  /**
   * Aplica un plan a uno o varios vehículos: una fila por vehículo, cada una
   * con su propio punto de partida.
   *
   * Si el vehículo ya tiene un plan vivo con la misma categoría y el mismo
   * nombre, se omite y se informa: volver a aplicar el «plan de aceite» a toda
   * la flota no debe duplicárselo a los que ya lo tenían.
   */
  async crearPlanes(input: CrearPlanInput, usuarioId: string | null) {
    const porVehiculo = new Map(input.vehiculos.map((v) => [v.vehiculo_id, v]))
    const vehiculos = await validarVehiculos([...porVehiculo.keys()])
    const existentes = await prisma.vehicle_maintenance_plan.findMany({
      where: { vehiculo_id: { in: [...porVehiculo.keys()] }, deleted_at: null, categoria: input.categoria, nombre: { equals: input.nombre, mode: 'insensitive' } },
      select: { vehiculo_id: true },
    })
    const yaTienen = new Set(existentes.map((e) => e.vehiculo_id))
    const omitidos = [...yaTienen].map((id) => ({ vehiculo_id: id, placa: vehiculos.get(id)?.placa ?? '', motivo: 'Ya tiene este plan' }))

    const ahora = new Date()
    const datos = [...porVehiculo.values()]
      .filter((v) => !yaTienen.has(v.vehiculo_id))
      .map((v) => {
        const { proximo_km, proxima_fecha } = calcularProximo({
          periodicidad_km: input.periodicidad_km,
          periodicidad_meses: input.periodicidad_meses,
          ultima_km: v.ultima_ejecucion_km ?? null,
          ultima_fecha: v.ultima_ejecucion_fecha ?? null,
        })
        return {
          id: randomUUID(),
          vehiculo_id: v.vehiculo_id,
          nombre: input.nombre,
          categoria: input.categoria,
          tipo: 'PREVENTIVO' as const,
          periodicidad_km: input.periodicidad_km ?? null,
          periodicidad_meses: input.periodicidad_meses ?? null,
          ultima_ejecucion_km: v.ultima_ejecucion_km ?? null,
          ultima_ejecucion_fecha: aFecha(v.ultima_ejecucion_fecha),
          proximo_km,
          proxima_fecha: aFecha(proxima_fecha),
          observaciones: input.observaciones ?? null,
          creado_por_id: usuarioId,
          created_at: ahora,
          updated_at: ahora,
        }
      })
    if (datos.length) await prisma.vehicle_maintenance_plan.createMany({ data: datos })
    return { creados: datos.length, ids: datos.map((d) => d.id), omitidos }
  },

  /**
   * Edita un plan y recalcula el próximo. Si alguien corrige a mano el último
   * km o la última fecha, el plan deja de apoyarse en la orden que lo había
   * dejado así (`ultimo_evento_id` se vacía).
   */
  async actualizarPlan(id: string, input: ActualizarPlanInput) {
    const actual = await prisma.vehicle_maintenance_plan.findFirst({ where: { id, deleted_at: null } })
    if (!actual) throw noEncontrado('Plan de mantenimiento')

    /// `undefined` = no vino (se conserva); `null` = lo vaciaron a propósito.
    const periodicidad = {
      periodicidad_km: input.periodicidad_km === undefined ? actual.periodicidad_km : input.periodicidad_km,
      periodicidad_meses: input.periodicidad_meses === undefined ? actual.periodicidad_meses : input.periodicidad_meses,
      periodicidad_dias: actual.periodicidad_dias,
    }
    if (!tienePeriodicidad(periodicidad)) {
      throw new MantenimientoError(422, 'SIN_PERIODICIDAD', 'Indica cada cuántos kilómetros, cada cuántos meses o ambos')
    }
    const ultimaKm = input.ultima_ejecucion_km === undefined ? actual.ultima_ejecucion_km : input.ultima_ejecucion_km
    const ultimaFecha = input.ultima_ejecucion_fecha === undefined ? isoDia(actual.ultima_ejecucion_fecha) : input.ultima_ejecucion_fecha
    const tocoUltima =
      (input.ultima_ejecucion_km !== undefined && input.ultima_ejecucion_km !== actual.ultima_ejecucion_km) ||
      (input.ultima_ejecucion_fecha !== undefined && input.ultima_ejecucion_fecha !== isoDia(actual.ultima_ejecucion_fecha))
    const { proximo_km, proxima_fecha } = calcularProximo({ ...periodicidad, ultima_km: ultimaKm, ultima_fecha: ultimaFecha })

    await prisma.vehicle_maintenance_plan.update({
      where: { id },
      data: {
        categoria: input.categoria ?? undefined,
        nombre: input.nombre ?? undefined,
        periodicidad_km: periodicidad.periodicidad_km,
        periodicidad_meses: periodicidad.periodicidad_meses,
        observaciones: input.observaciones === undefined ? undefined : input.observaciones,
        activo: input.activo ?? undefined,
        ultima_ejecucion_km: ultimaKm,
        ultima_ejecucion_fecha: aFecha(ultimaFecha),
        proximo_km,
        proxima_fecha: aFecha(proxima_fecha),
        ...(tocoUltima ? { ultimo_evento_id: null } : {}),
      },
    })
    return this.detallePlan(id)
  },

  /** Borrado lógico. Con una orden abierta no: quedaría huérfana a medio trabajo. */
  async eliminarPlan(id: string) {
    const plan = await prisma.vehicle_maintenance_plan.findFirst({ where: { id, deleted_at: null }, select: { id: true } })
    if (!plan) throw noEncontrado('Plan de mantenimiento')
    const abierta = await prisma.vehicle_maintenance_event.findFirst({
      where: { plan_id: id, deleted_at: null, estado: { in: ['PROGRAMADO', 'EN_CURSO'] } },
      select: { consecutivo: true },
    })
    if (abierta) {
      throw new MantenimientoError(409, 'PLAN_CON_ORDEN_ABIERTA', `El plan tiene la OT ${abierta.consecutivo} abierta: ciérrala o anúlala antes de eliminarlo`)
    }
    await prisma.vehicle_maintenance_plan.update({ where: { id }, data: { deleted_at: new Date() } })
  },

  async listarOrdenes(input: ListarOrdenesInput) {
    const where = whereOrdenes(input)
    const [filas, total, porEstado] = await Promise.all([
      prisma.vehicle_maintenance_event.findMany({
        where,
        select: SELECT_ORDEN,
        orderBy: { consecutivo: 'desc' },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      prisma.vehicle_maintenance_event.count({ where }),
      prisma.vehicle_maintenance_event.groupBy({ by: ['estado'], where: whereOrdenes(input, false), _count: { _all: true } }),
    ])
    const conteos = { PROGRAMADO: 0, EN_CURSO: 0, EJECUTADO: 0, CANCELADO: 0 } as Record<EstadoOrden, number>
    for (const g of porEstado) conteos[g.estado as EstadoOrden] = g._count._all
    return { items: filas.map(serializarOrden), total, page: input.page, limit: input.limit, conteos }
  },

  async detalleOrden(id: string) {
    const o = await ordenViva(id)
    const adjuntos = await prisma.vehicle_maintenance_attachment.findMany({
      where: { evento_id: id, deleted_at: null },
      select: { id: true, tipo: true, nombre: true, mimetype: true, size: true, created_at: true },
      orderBy: { created_at: 'asc' },
    })
    return {
      ...serializarOrden(o),
      adjuntos_detalle: adjuntos.map((a) => ({ ...a, created_at: a.created_at.toISOString() })),
    }
  },

  /**
   * Abre una orden. La preventiva hereda el vehículo de su plan, y un plan no
   * puede tener dos órdenes abiertas a la vez: la segunda casi siempre es un
   * doble clic o alguien que no vio la primera.
   */
  async crearOrden(input: CrearOrdenInput, usuarioId: string | null) {
    let vehiculoId: string
    let planId: string | null = null
    if (input.tipo === 'PREVENTIVO') {
      const plan = await prisma.vehicle_maintenance_plan.findFirst({
        where: { id: input.plan_id!, deleted_at: null, vehiculo: { deleted_at: null } },
        select: { id: true, vehiculo_id: true },
      })
      if (!plan) throw noEncontrado('Plan de mantenimiento')
      const abierta = await prisma.vehicle_maintenance_event.findFirst({
        where: { plan_id: plan.id, deleted_at: null, estado: { in: ['PROGRAMADO', 'EN_CURSO'] } },
        select: { id: true, consecutivo: true },
      })
      if (abierta) throw new MantenimientoError(409, 'ORDEN_ABIERTA_EXISTE', `Este plan ya tiene la OT ${abierta.consecutivo} abierta`)
      vehiculoId = plan.vehiculo_id
      planId = plan.id
    } else {
      await validarVehiculos([input.vehiculo_id!])
      vehiculoId = input.vehiculo_id!
    }

    /// El `as`: sin `strict` en el tsconfig, zod infiere todos los campos como
    /// opcionales aunque el esquema los exija.
    const repuestos = (input.repuestos ?? []) as LineaRepuesto[]
    const totales = totalesOrden(repuestos, input.costo_mano_obra)
    const ahora = new Date()
    const creada = await prisma.vehicle_maintenance_event.create({
      data: {
        id: randomUUID(),
        plan_id: planId,
        vehiculo_id: vehiculoId,
        tipo: input.tipo,
        estado: 'PROGRAMADO',
        descripcion: input.descripcion,
        fecha_programada: aFecha(input.fecha ?? hoyColombia()),
        km_programado: input.km ?? null,
        taller: input.taller ?? null,
        responsable: input.responsable ?? null,
        numero_factura: input.numero_factura ?? null,
        repuestos_detalle: repuestos as unknown as Prisma.InputJsonValue,
        repuestos: resumenRepuestos(repuestos),
        ...totales,
        observaciones: input.observaciones ?? null,
        creado_por_id: usuarioId,
        created_at: ahora,
        updated_at: ahora,
      },
      select: { id: true },
    })
    return this.detalleOrden(creada.id)
  },

  /**
   * Corrige una orden. Abierta o en curso se edita todo; cerrada, solo lo que
   * suele llegar después (factura, costos, taller, notas): fecha y km de
   * ejecución movieron el plan y cambiarlos aquí lo dejaría desalineado.
   */
  async actualizarOrden(id: string, input: ActualizarOrdenInput) {
    const o = await ordenViva(id)
    if (o.estado === 'CANCELADO') throw new MantenimientoError(409, 'ORDEN_ANULADA', 'La orden está anulada')
    const cerrada = o.estado === 'EJECUTADO'

    const nuevos = input.repuestos as LineaRepuesto[] | undefined
    const repuestos = nuevos ?? (o.repuestos_detalle as unknown as LineaRepuesto[]) ?? []
    const manoObra = input.costo_mano_obra === undefined ? num(o.costo_mano_obra) : input.costo_mano_obra
    const totales = totalesOrden(Array.isArray(repuestos) ? repuestos : [], manoObra)
    await prisma.vehicle_maintenance_event.update({
      where: { id },
      data: {
        ...(cerrada
          ? {}
          : {
              descripcion: input.descripcion ?? undefined,
              fecha_programada: input.fecha === undefined ? undefined : aFecha(input.fecha),
              km_programado: input.km === undefined ? undefined : input.km,
            }),
        taller: input.taller === undefined ? undefined : input.taller,
        responsable: input.responsable === undefined ? undefined : input.responsable,
        numero_factura: input.numero_factura === undefined ? undefined : input.numero_factura,
        observaciones: input.observaciones === undefined ? undefined : input.observaciones,
        ...(nuevos ? { repuestos_detalle: nuevos as unknown as Prisma.InputJsonValue, repuestos: resumenRepuestos(nuevos) } : {}),
        ...totales,
      },
    })
    return this.detalleOrden(id)
  },

  /**
   * Mueve la orden por su ciclo: en curso, cerrada o anulada.
   *
   * Cerrar una preventiva deja su plan apuntando a esta orden —último km y
   * fecha = los de la ejecución— y recalcula el próximo, en la misma
   * transacción: una orden cerrada con el plan sin mover haría que el aviso
   * de «vencido» siguiera saliendo después de hacer el trabajo.
   *
   * El `updateMany` con el estado previo en el `where` evita que dos
   * personas cierren la misma orden a la vez y muevan el plan dos veces.
   */
  async cambiarEstadoOrden(id: string, input: CambiarEstadoOrdenInput, usuarioId: string | null) {
    const o = await ordenViva(id)
    const desde = o.estado as EstadoOrden
    const hacia = input.estado as EstadoOrden
    if (!transicionValida(desde, hacia)) {
      throw new MantenimientoError(409, 'TRANSICION_INVALIDA', `Una orden ${ETIQUETA_ESTADO[desde]} no puede pasar a ${ETIQUETA_ESTADO[hacia]}`)
    }
    const ahora = new Date()
    const hoy = hoyColombia()

    if (hacia === 'EN_CURSO' || hacia === 'CANCELADO') {
      const r = await prisma.vehicle_maintenance_event.updateMany({
        where: { id, estado: desde, deleted_at: null },
        data:
          hacia === 'EN_CURSO'
            ? { estado: 'EN_CURSO', iniciado_at: ahora }
            : { estado: 'CANCELADO', anulado_at: ahora, motivo_anulacion: input.motivo ?? null },
      })
      if (!r.count) throw new MantenimientoError(409, 'ORDEN_CAMBIO', 'Alguien más cambió esta orden. Recarga y vuelve a intentarlo.')
      return this.detalleOrden(id)
    }

    // ── Cerrar ──
    const fechaEjecucion = input.fecha_ejecucion ?? isoDia(o.fecha_programada) ?? hoy
    const kmEjecucion = input.km_ejecucion ?? o.km_programado ?? null
    if (fechaEjecucion > hoy) throw new MantenimientoError(422, 'FECHA_FUTURA', 'La fecha de cierre no puede ser posterior a hoy')

    const plan =
      o.tipo === 'PREVENTIVO' && o.plan_id
        ? await prisma.vehicle_maintenance_plan.findFirst({ where: { id: o.plan_id, deleted_at: null } })
        : null
    if (plan?.periodicidad_km && kmEjecucion == null) {
      throw new MantenimientoError(422, 'FALTA_KM', 'Indica el kilometraje con que se hizo: el plan cuenta por kilómetros')
    }

    await prisma.$transaction(async (tx) => {
      const r = await tx.vehicle_maintenance_event.updateMany({
        where: { id, estado: desde, deleted_at: null },
        data: {
          estado: 'EJECUTADO',
          fecha_ejecucion: aFecha(fechaEjecucion),
          km_ejecucion: kmEjecucion,
          cerrado_at: ahora,
          ejecutado_por_id: usuarioId,
          ...(desde === 'PROGRAMADO' ? { iniciado_at: ahora } : {}),
        },
      })
      if (!r.count) throw new MantenimientoError(409, 'ORDEN_CAMBIO', 'Alguien más cambió esta orden. Recarga y vuelve a intentarlo.')
      if (plan && avanzaPlan(isoDia(plan.ultima_ejecucion_fecha), fechaEjecucion)) {
        const { proximo_km, proxima_fecha } = calcularProximo({ ...plan, ultima_km: kmEjecucion, ultima_fecha: fechaEjecucion })
        await tx.vehicle_maintenance_plan.update({
          where: { id: plan.id },
          data: {
            ultima_ejecucion_fecha: aFecha(fechaEjecucion),
            ultima_ejecucion_km: kmEjecucion,
            proximo_km,
            proxima_fecha: aFecha(proxima_fecha),
            ultimo_evento_id: id,
          },
        })
      }
    })
    return this.detalleOrden(id)
  },

  /** Factura, foto u otro soporte: a S3 y una fila en `vehicle_maintenance_attachment`. */
  async subirAdjunto(ordenId: string, tipo: TipoAdjunto, archivo: { buffer: Buffer; nombre: string; mimetype: string }, usuarioId: string | null) {
    const o = await prisma.vehicle_maintenance_event.findFirst({ where: { id: ordenId, deleted_at: null }, select: { id: true, vehiculo_id: true, estado: true } })
    if (!o) throw noEncontrado('Orden de trabajo')
    if (o.estado === 'CANCELADO') throw new MantenimientoError(409, 'ORDEN_ANULADA', 'La orden está anulada')
    const id = randomUUID()
    const ext = (path.extname(archivo.nombre) || (archivo.mimetype === 'application/pdf' ? '.pdf' : '.jpg')).toLowerCase()
    /// Bajo la carpeta del vehículo, junto a sus documentos: la hoja de vida
    /// completa de una placa queda en un solo prefijo de S3.
    const s3Key = `vehiculos/${o.vehiculo_id}/mantenimiento/${o.id}/${id}${ext}`
    await uploadToS3(s3Key, archivo.buffer, archivo.mimetype)
    const fila = await prisma.vehicle_maintenance_attachment.create({
      data: { id, evento_id: o.id, tipo, nombre: archivo.nombre.slice(0, 255), mimetype: archivo.mimetype, size: archivo.buffer.length, s3_key: s3Key, creado_por_id: usuarioId },
      select: { id: true, tipo: true, nombre: true, mimetype: true, size: true, created_at: true },
    })
    return { ...fila, created_at: fila.created_at.toISOString() }
  },

  /** URL firmada de 15 minutos, igual que los documentos del vehículo. */
  async urlAdjunto(ordenId: string, adjuntoId: string) {
    const a = await prisma.vehicle_maintenance_attachment.findFirst({
      where: { id: adjuntoId, evento_id: ordenId, deleted_at: null, evento: { deleted_at: null } },
      select: { s3_key: true },
    })
    if (!a) throw noEncontrado('Adjunto')
    return getS3SignedUrl(a.s3_key, 15 * 60)
  },

  /** Borrado lógico: el objeto de S3 se conserva. */
  async eliminarAdjunto(ordenId: string, adjuntoId: string) {
    const r = await prisma.vehicle_maintenance_attachment.updateMany({
      where: { id: adjuntoId, evento_id: ordenId, deleted_at: null },
      data: { deleted_at: new Date() },
    })
    if (!r.count) throw noEncontrado('Adjunto')
  },

  /** Pestaña «Mantenimiento» de la ficha: sus planes, sus órdenes y lo que ha costado. */
  async resumenVehiculo(vehiculoId: string) {
    const v = await prisma.vehiculos.findFirst({ where: { id: vehiculoId, deleted_at: null }, select: { id: true, placa: true, kilometraje: true } })
    if (!v) throw noEncontrado('Vehículo')
    const hoy = hoyColombia()
    const haceUnAnio = `${Number(hoy.slice(0, 4)) - 1}${hoy.slice(4)}`
    /** Lo gastado en órdenes cerradas desde una fecha (o desde siempre). */
    const costoDesde = async (desde: string | null) => {
      const a = await prisma.vehicle_maintenance_event.aggregate({
        where: { vehiculo_id: vehiculoId, deleted_at: null, estado: 'EJECUTADO', ...(desde ? { fecha_ejecucion: { gte: aFecha(desde)! } } : {}) },
        _sum: { costo: true },
        _count: { _all: true },
      })
      return { total: num(a._sum.costo) ?? 0, ordenes: a._count._all }
    }
    const [planes, ordenes, historico, ultimos12, anioActual] = await Promise.all([
      prisma.vehicle_maintenance_plan.findMany({ where: { vehiculo_id: vehiculoId, deleted_at: null }, select: SELECT_PLAN }),
      prisma.vehicle_maintenance_event.findMany({ where: { vehiculo_id: vehiculoId, deleted_at: null }, select: SELECT_ORDEN, orderBy: { consecutivo: 'desc' }, take: 30 }),
      costoDesde(null),
      costoDesde(haceUnAnio),
      costoDesde(`${hoy.slice(0, 4)}-01-01`),
    ])
    const abiertas = await ordenesAbiertasDe(planes.map((p) => p.id))
    const evaluados = planes.map((p) => serializarPlan(p, hoy, abiertas.get(p.id)))
    evaluados.sort(compararUrgencia)
    return {
      vehiculo: { id: v.id, placa: v.placa, km_actual: kmFicha(v.kilometraje) },
      planes: evaluados,
      conteos: contarEstados(evaluados),
      ordenes: ordenes.map(serializarOrden),
      costos: { historico, ultimos_12_meses: ultimos12, anio_actual: anioActual },
    }
  },

  /**
   * Costo por vehículo y por mes de las órdenes CERRADAS en el periodo (por
   * su fecha de ejecución). Sin periodo, el año en curso.
   */
  async costos(input: CostosInput) {
    const hoy = hoyColombia()
    const desde = input.desde ?? `${hoy.slice(0, 4)}-01-01`
    const hasta = input.hasta ?? hoy
    if (desde > hasta) throw new MantenimientoError(422, 'RANGO_INVALIDO', 'La fecha inicial es posterior a la final')
    const filtroVehiculo = input.vehiculo_id ? Prisma.sql`AND e.vehiculo_id = ${input.vehiculo_id}::uuid` : Prisma.empty
    /// `estado = 'EJECUTADO'` va como literal: un parámetro llega como `text`
    /// y Postgres no compara un enum con `text` sin cast.
    const base = Prisma.sql`
      FROM vehicle_maintenance_event e
      JOIN vehiculos ve ON ve.id = e.vehiculo_id AND ve.deleted_at IS NULL
      WHERE e.deleted_at IS NULL AND e.estado = 'EJECUTADO'
        AND e.fecha_ejecucion >= ${desde}::date AND e.fecha_ejecucion <= ${hasta}::date ${filtroVehiculo}`
    const [porVehiculo, porMes] = await Promise.all([
      prisma.$queryRaw<Array<{ vehiculo_id: string; placa: string; marca: string | null; linea: string | null; ordenes: number; preventivas: number; correctivas: number; repuestos: number; mano_obra: number; total: number }>>(Prisma.sql`
        SELECT e.vehiculo_id, ve.placa, ve.marca, ve.linea,
               count(*)::int AS ordenes,
               count(*) FILTER (WHERE e.tipo = 'PREVENTIVO')::int AS preventivas,
               count(*) FILTER (WHERE e.tipo = 'CORRECTIVO')::int AS correctivas,
               coalesce(sum(e.costo_repuestos), 0)::float AS repuestos,
               coalesce(sum(e.costo_mano_obra), 0)::float AS mano_obra,
               coalesce(sum(e.costo), 0)::float AS total
        ${base}
        GROUP BY 1, 2, 3, 4
        ORDER BY total DESC, ve.placa`),
      prisma.$queryRaw<Array<{ mes: string; ordenes: number; preventivo: number; correctivo: number; total: number }>>(Prisma.sql`
        SELECT to_char(e.fecha_ejecucion, 'YYYY-MM') AS mes,
               count(*)::int AS ordenes,
               coalesce(sum(e.costo) FILTER (WHERE e.tipo = 'PREVENTIVO'), 0)::float AS preventivo,
               coalesce(sum(e.costo) FILTER (WHERE e.tipo <> 'PREVENTIVO'), 0)::float AS correctivo,
               coalesce(sum(e.costo), 0)::float AS total
        ${base}
        GROUP BY 1
        ORDER BY 1`),
    ])
    const suma = (k: 'total' | 'repuestos' | 'mano_obra' | 'ordenes') => porVehiculo.reduce((s, v) => s + v[k], 0)
    return {
      desde,
      hasta,
      totales: {
        total: suma('total'),
        repuestos: suma('repuestos'),
        mano_obra: suma('mano_obra'),
        ordenes: suma('ordenes'),
        preventivo: porMes.reduce((s, m) => s + m.preventivo, 0),
        correctivo: porMes.reduce((s, m) => s + m.correctivo, 0),
      },
      por_vehiculo: porVehiculo,
      por_mes: porMes,
    }
  },

  /** Planes en «vencido» o «próximo», para el aviso diario. Los pausados no avisan. */
  async planesEnAlerta(): Promise<Array<PlanSerializado & { estado: 'vencido' | 'proximo' }>> {
    const planes = await planesEvaluados({ activo: true })
    return planes.filter((p): p is PlanSerializado & { estado: 'vencido' | 'proximo' } => p.estado === 'vencido' || p.estado === 'proximo')
  },
}

const ETIQUETA_ESTADO: Record<EstadoOrden, string> = {
  PROGRAMADO: 'abierta',
  EN_CURSO: 'en curso',
  EJECUTADO: 'cerrada',
  CANCELADO: 'anulada',
}

export type { EvaluacionPlan }
