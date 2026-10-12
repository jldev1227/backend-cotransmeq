/**
 * Tanqueos de combustible: registro, rendimiento y exportación.
 *
 * Toda lectura pasa por `cargar()`, que trae los tanqueos del filtro y, para
 * medir el rendimiento, el historial COMPLETO de sus vehículos hasta el final
 * del periodo: el tramo del primer lleno del mes empieza en un lleno del mes
 * anterior, y la referencia de las alertas mira tramos previos. El filtro por
 * conductor tampoco recorta ese historial: el rendimiento es del vehículo, no
 * de quien tanqueó.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import { calcularTramos, rendimientoPonderado, validarKilometraje, type TanqueoMedible, type Tramo, type VecinosKm } from './rendimiento'
import { aInstante, rangoBogota, type FiltrosTanqueos, type TanqueoInput } from './combustible.schema'

export class CombustibleError extends Error {
  constructor(
    message: string,
    public status = 400,
    public code?: string,
  ) {
    super(message)
  }
}

const SELECT = {
  id: true,
  vehiculo_id: true,
  conductor_id: true,
  fecha_hora: true,
  kilometraje: true,
  galones: true,
  valor_total: true,
  tipo_combustible: true,
  estacion: true,
  tanque_lleno: true,
  medio_pago: true,
  comprobante_key: true,
  comprobante_mime: true,
  comprobante_nombre: true,
  observaciones: true,
  creado_por_id: true,
  created_at: true,
  updated_at: true,
} as const

type Fila = {
  id: string
  vehiculo_id: string
  conductor_id: string | null
  fecha_hora: Date
  kilometraje: number
  galones: unknown
  valor_total: unknown
  tipo_combustible: string
  estacion: string | null
  tanque_lleno: boolean
  medio_pago: string | null
  comprobante_key: string | null
  comprobante_mime: string | null
  comprobante_nombre: string | null
  observaciones: string | null
  creado_por_id: string | null
  created_at: Date
  updated_at: Date
}

/// Tope del cálculo en memoria. Una flota de ~350 placas tanquea del orden de
/// 3.000–4.000 veces al mes; diez veces eso cubre un año entero sin riesgo
/// para la memoria del proceso. Si se pasa, hay que acotar por fechas.
const MAX_FILAS = 40_000

const num = (v: unknown) => Number(v ?? 0)

function aMedible(f: Pick<Fila, 'id' | 'fecha_hora' | 'kilometraje' | 'galones' | 'valor_total' | 'tanque_lleno'>): TanqueoMedible {
  return {
    id: f.id,
    fecha_hora: f.fecha_hora,
    kilometraje: f.kilometraje,
    galones: num(f.galones),
    valor_total: num(f.valor_total),
    tanque_lleno: f.tanque_lleno,
  }
}

/** Tanqueos del filtro + tramos de rendimiento de sus vehículos. */
async function cargar(filtros: Pick<FiltrosTanqueos, 'vehiculo_id' | 'conductor_id' | 'desde' | 'hasta'>) {
  const { gte, lt } = rangoBogota(filtros.desde, filtros.hasta)
  const filas = (await prisma.combustible_tanqueo.findMany({
    where: {
      deleted_at: null,
      ...(filtros.vehiculo_id ? { vehiculo_id: filtros.vehiculo_id } : {}),
      ...(filtros.conductor_id ? { conductor_id: filtros.conductor_id } : {}),
      ...(gte || lt ? { fecha_hora: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}),
    },
    select: SELECT,
    orderBy: [{ fecha_hora: 'desc' }, { kilometraje: 'desc' }],
    take: MAX_FILAS,
  })) as Fila[]

  const vehiculoIds = [...new Set(filas.map((f) => f.vehiculo_id))]
  const historial = vehiculoIds.length
    ? await prisma.combustible_tanqueo.findMany({
        where: { deleted_at: null, vehiculo_id: { in: vehiculoIds }, ...(lt ? { fecha_hora: { lt } } : {}) },
        select: { id: true, vehiculo_id: true, fecha_hora: true, kilometraje: true, galones: true, valor_total: true, tanque_lleno: true },
      })
    : []

  const porVehiculo = new Map<string, TanqueoMedible[]>()
  for (const h of historial) {
    if (!porVehiculo.has(h.vehiculo_id)) porVehiculo.set(h.vehiculo_id, [])
    porVehiculo.get(h.vehiculo_id)!.push(aMedible(h))
  }
  const tramoPorId = new Map<string, Tramo>()
  const tramosPorVehiculo = new Map<string, Tramo[]>()
  for (const [vehiculoId, tanqueos] of porVehiculo) {
    const tramos = calcularTramos(tanqueos)
    tramosPorVehiculo.set(vehiculoId, tramos)
    for (const t of tramos) tramoPorId.set(t.hasta_id, t)
  }
  return { filas, tramoPorId, tramosPorVehiculo }
}

/** Placa, conductor y usuario por lote: el modelo no declara relaciones (ver schema). */
async function nombres(filas: Fila[]) {
  const ids = (sel: (f: Fila) => string | null) => [...new Set(filas.map(sel).filter((x): x is string => !!x))]
  const [vehiculos, conductores, usuarios] = await Promise.all([
    prisma.vehiculos.findMany({
      where: { id: { in: ids((f) => f.vehiculo_id) } },
      select: { id: true, placa: true, marca: true, linea: true, modelo: true },
    }),
    prisma.conductores.findMany({
      where: { id: { in: ids((f) => f.conductor_id) } },
      select: { id: true, nombre: true, apellido: true, numero_identificacion: true },
    }),
    prisma.usuarios.findMany({ where: { id: { in: ids((f) => f.creado_por_id) } }, select: { id: true, nombre: true } }),
  ])
  return {
    vehiculo: new Map(vehiculos.map((v) => [v.id, v])),
    conductor: new Map(
      conductores.map((c) => [
        c.id,
        { id: c.id, nombre: `${c.nombre} ${c.apellido}`.trim(), numero_identificacion: c.numero_identificacion },
      ]),
    ),
    usuario: new Map(usuarios.map((u) => [u.id, u])),
  }
}

type Nombres = Awaited<ReturnType<typeof nombres>>

/** Estado del rendimiento de UN tanqueo, para pintarlo sin reglas en el cliente. */
function rendimientoDe(f: Fila, tramo: Tramo | undefined) {
  if (tramo) {
    return {
      estado: tramo.anomalo ? ('alerta' as const) : ('medido' as const),
      km_recorridos: tramo.km_recorridos,
      galones_tramo: Math.round(tramo.galones * 1000) / 1000,
      rendimiento: tramo.rendimiento,
      referencia: tramo.referencia,
      desviacion: tramo.desviacion,
      costo_km: tramo.valor / tramo.km_recorridos,
    }
  }
  /// Un parcial no cierra tramo: sus galones se suman al siguiente lleno. Un
  /// lleno sin tramo es el primero del vehículo (el punto de partida) o uno al
  /// mismo odómetro que el anterior.
  return {
    estado: f.tanque_lleno ? ('inicio' as const) : ('parcial' as const),
    km_recorridos: null,
    galones_tramo: null,
    rendimiento: null,
    referencia: null,
    desviacion: null,
    costo_km: null,
  }
}

function serializar(f: Fila, n: Nombres, tramo: Tramo | undefined) {
  const v = n.vehiculo.get(f.vehiculo_id)
  const galones = num(f.galones)
  const valor = num(f.valor_total)
  const creador = f.creado_por_id ? n.usuario.get(f.creado_por_id) : null
  return {
    id: f.id,
    vehiculo: { id: f.vehiculo_id, placa: v?.placa ?? '—', marca: v?.marca ?? null, linea: v?.linea ?? null },
    conductor: f.conductor_id ? (n.conductor.get(f.conductor_id) ?? { id: f.conductor_id, nombre: 'Conductor', numero_identificacion: null }) : null,
    fecha_hora: f.fecha_hora.toISOString(),
    kilometraje: f.kilometraje,
    galones,
    valor_total: valor,
    precio_galon: galones > 0 ? valor / galones : 0,
    tipo_combustible: f.tipo_combustible,
    estacion: f.estacion,
    tanque_lleno: f.tanque_lleno,
    medio_pago: f.medio_pago,
    observaciones: f.observaciones,
    comprobante: f.comprobante_key ? { nombre: f.comprobante_nombre ?? 'Comprobante', mime: f.comprobante_mime } : null,
    creado_por: creador ? { id: creador.id, nombre: creador.nombre } : null,
    created_at: f.created_at.toISOString(),
    updated_at: f.updated_at.toISOString(),
    rendimiento: rendimientoDe(f, tramo),
  }
}

export type TanqueoSerializado = ReturnType<typeof serializar>

/** Totales de un conjunto de tanqueos y de los tramos que esos tanqueos cierran. */
function totales(filas: Fila[], tramoPorId: Map<string, Tramo>) {
  const tramos = filas.map((f) => tramoPorId.get(f.id)).filter((t): t is Tramo => !!t)
  const galones = filas.reduce((s, f) => s + num(f.galones), 0)
  const gasto = filas.reduce((s, f) => s + num(f.valor_total), 0)
  const km = tramos.reduce((s, t) => s + t.km_recorridos, 0)
  const valorTramos = tramos.reduce((s, t) => s + t.valor, 0)
  return {
    tanqueos: filas.length,
    galones,
    gasto,
    precio_galon: galones > 0 ? gasto / galones : null,
    tramos: tramos.length,
    km_recorridos: km,
    rendimiento: rendimientoPonderado(tramos),
    /// Costo por km sobre los TRAMOS (lo pagado por el combustible que se
    /// recorrió), no gasto del periodo / km del periodo: un lleno del día 31
    /// cuyo recorrido cae en el mes siguiente inflaría el mes que no lo usó.
    costo_km: km > 0 ? valorTramos / km : null,
    alertas: tramos.filter((t) => t.anomalo).length,
  }
}

const CSV_SEP = ';'
/// `;` y coma decimal: es lo que espera Excel con la configuración regional de
/// Colombia. Con `,` todo el archivo se abría en una sola columna.
const decimal = (v: number | null | undefined, dec = 2) =>
  v == null || !Number.isFinite(v) ? '' : v.toFixed(dec).replace('.', ',')

/**
 * Escapa una celda CSV. El prefijo `'` ante `=`, `+`, `-` y `@` neutraliza la
 * inyección de fórmulas: la estación y las observaciones las escribe cualquiera.
 */
function celda(valor: unknown): string {
  let texto = valor == null ? '' : String(valor)
  if (/^[=+\-@\t\r]/.test(texto)) texto = `'${texto}`
  return `"${texto.replace(/"/g, '""')}"`
}

const fechaBogota = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/Bogota',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function partesBogota(d: Date) {
  const p = Object.fromEntries(fechaBogota.formatToParts(d).map((x) => [x.type, x.value]))
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour === '24' ? '00' : p.hour}:${p.minute}` }
}

async function vecinosDe(vehiculoId: string, instante: Date, excluir?: string | null): Promise<VecinosKm> {
  const base = { deleted_at: null, vehiculo_id: vehiculoId, ...(excluir ? { id: { not: excluir } } : {}) }
  const [anterior, siguiente] = await Promise.all([
    prisma.combustible_tanqueo.findFirst({
      where: { ...base, fecha_hora: { lt: instante } },
      orderBy: [{ fecha_hora: 'desc' }, { kilometraje: 'desc' }],
      select: { fecha_hora: true, kilometraje: true },
    }),
    prisma.combustible_tanqueo.findFirst({
      where: { ...base, fecha_hora: { gt: instante } },
      orderBy: [{ fecha_hora: 'asc' }, { kilometraje: 'asc' }],
      select: { fecha_hora: true, kilometraje: true },
    }),
  ])
  return { anterior, siguiente }
}

/** Reglas comunes a crear y editar. Lanza `CombustibleError` con código. */
async function validar(input: TanqueoInput, excluir?: string) {
  const vehiculo = await prisma.vehiculos.findFirst({ where: { id: input.vehiculo_id, deleted_at: null }, select: { id: true } })
  if (!vehiculo) throw new CombustibleError('Vehículo no encontrado', 404, 'VEHICULO_NO_ENCONTRADO')
  if (input.conductor_id) {
    const conductor = await prisma.conductores.findFirst({ where: { id: input.conductor_id, deleted_at: null }, select: { id: true } })
    if (!conductor) throw new CombustibleError('Conductor no encontrado', 404, 'CONDUCTOR_NO_ENCONTRADO')
  }
  /// Mismo vehículo a la misma hora exacta es el doble clic en «Registrar» o
  /// la misma factura cargada dos veces; un tanqueo real no se repite al minuto.
  const repetido = await prisma.combustible_tanqueo.findFirst({
    where: { deleted_at: null, vehiculo_id: input.vehiculo_id, fecha_hora: input.fecha_hora, ...(excluir ? { id: { not: excluir } } : {}) },
    select: { id: true },
  })
  if (repetido) throw new CombustibleError('Ya hay un tanqueo de este vehículo a esa misma fecha y hora.', 409, 'TANQUEO_DUPLICADO')

  const error = validarKilometraje(input.kilometraje, await vecinosDe(input.vehiculo_id, input.fecha_hora, excluir))
  /// 409 y no 400: el dato es válido por sí solo; choca con otro tanqueo ya guardado.
  if (error) throw new CombustibleError(error.mensaje, 409, error.codigo)
}

function datos(input: TanqueoInput) {
  return {
    vehiculo_id: input.vehiculo_id,
    conductor_id: input.conductor_id ?? null,
    fecha_hora: input.fecha_hora,
    kilometraje: input.kilometraje,
    galones: input.galones,
    valor_total: input.valor_total,
    tipo_combustible: input.tipo_combustible,
    estacion: input.estacion ?? null,
    tanque_lleno: input.tanque_lleno,
    medio_pago: input.medio_pago ?? null,
    observaciones: input.observaciones ?? null,
  }
}

async function filaActiva(id: string): Promise<Fila> {
  const fila = (await prisma.combustible_tanqueo.findFirst({ where: { id, deleted_at: null }, select: SELECT })) as Fila | null
  if (!fila) throw new CombustibleError('Tanqueo no encontrado', 404, 'TANQUEO_NO_ENCONTRADO')
  return fila
}

/** Un tanqueo recién guardado, con su rendimiento ya recalculado. */
async function releer(id: string) {
  const fila = await filaActiva(id)
  const { tramoPorId } = await cargar({ vehiculo_id: fila.vehiculo_id })
  return serializar(fila, await nombres([fila]), tramoPorId.get(fila.id))
}

export const CombustibleService = {
  /** Vehículos y conductores para los selectores, con lo que el formulario necesita sugerir. */
  async catalogos() {
    const [vehiculos, conductores] = await Promise.all([
      prisma.vehiculos.findMany({
        where: { deleted_at: null },
        select: { id: true, placa: true, marca: true, linea: true, modelo: true, combustible: true, kilometraje: true, oculto: true },
        orderBy: { placa: 'asc' },
      }),
      prisma.conductores.findMany({
        where: { deleted_at: null },
        select: { id: true, nombre: true, apellido: true, numero_identificacion: true, estado: true },
        orderBy: [{ nombre: 'asc' }, { apellido: 'asc' }],
      }),
    ])
    return { vehiculos, conductores }
  },

  async listar(filtros: FiltrosTanqueos) {
    const { filas, tramoPorId } = await cargar(filtros)
    const visibles = filtros.solo_alertas ? filas.filter((f) => tramoPorId.get(f.id)?.anomalo) : filas
    const inicio = (filtros.pagina - 1) * filtros.por_pagina
    const pagina = visibles.slice(inicio, inicio + filtros.por_pagina)
    const n = await nombres(pagina)
    return {
      data: pagina.map((f) => serializar(f, n, tramoPorId.get(f.id))),
      meta: { total: visibles.length, pagina: filtros.pagina, por_pagina: filtros.por_pagina, truncado: filas.length >= MAX_FILAS },
      /// Los totales no dependen de «solo alertas»: el chip de alertas debe
      /// seguir diciendo cuántas hay también cuando ya se está filtrando por él.
      resumen: totales(filas, tramoPorId),
    }
  },

  /** Rendimiento por vehículo en el periodo, de peor a mejor. */
  async rendimientoPorVehiculo(filtros: FiltrosTanqueos) {
    const { filas, tramoPorId, tramosPorVehiculo } = await cargar(filtros)
    const grupos = new Map<string, Fila[]>()
    for (const f of filas) {
      if (!grupos.has(f.vehiculo_id)) grupos.set(f.vehiculo_id, [])
      grupos.get(f.vehiculo_id)!.push(f)
    }
    /// Una fila por vehículo basta para resolver las placas.
    const n = await nombres([...grupos.values()].map((g) => g[0]))
    const vehiculos = [...grupos.entries()].map(([vehiculoId, propias]) => {
      const t = totales(propias, tramoPorId)
      const v = n.vehiculo.get(vehiculoId)
      /// `propias` viene de la más reciente a la más antigua: el primer tramo
      /// que aparezca es el último medido.
      const ultimo = propias.map((f) => tramoPorId.get(f.id)).find((x): x is Tramo => !!x) ?? null
      const historicos = tramosPorVehiculo.get(vehiculoId) ?? []
      return {
        vehiculo: { id: vehiculoId, placa: v?.placa ?? '—', marca: v?.marca ?? null, linea: v?.linea ?? null, modelo: v?.modelo ?? null },
        ...t,
        ultimo_km: Math.max(...propias.map((f) => f.kilometraje)),
        ultimo_tanqueo: propias[0].fecha_hora.toISOString(),
        ultimo_tramo: ultimo
          ? { rendimiento: ultimo.rendimiento, referencia: ultimo.referencia, desviacion: ultimo.desviacion, anomalo: ultimo.anomalo }
          : null,
        /// Rendimiento de toda la vida del vehículo hasta el fin del periodo:
        /// da contexto a un mes con pocos tramos.
        rendimiento_historico: rendimientoPonderado(historicos),
      }
    })
    vehiculos.sort((a, b) => b.alertas - a.alertas || a.vehiculo.placa.localeCompare(b.vehiculo.placa, 'es', { numeric: true }))
    return { vehiculos, totales: totales(filas, tramoPorId) }
  },

  async exportarCsv(filtros: FiltrosTanqueos): Promise<string> {
    const { filas, tramoPorId } = await cargar(filtros)
    const visibles = filtros.solo_alertas ? filas.filter((f) => tramoPorId.get(f.id)?.anomalo) : filas
    const n = await nombres(visibles)
    const cabecera = [
      'Fecha',
      'Hora',
      'Placa',
      'Conductor',
      'Documento conductor',
      'Odómetro (km)',
      'Galones',
      'Valor total',
      'Precio por galón',
      'Combustible',
      'Estación',
      'Tanque lleno',
      'Medio de pago',
      'Km del tramo',
      'Galones del tramo',
      'Rendimiento (km/gal)',
      'Referencia (km/gal)',
      'Desviación (%)',
      'Alerta',
      'Costo por km',
      'Comprobante',
      'Observaciones',
      'Registrado por',
    ]
    const lineas = visibles.map((f) => {
      const s = serializar(f, n, tramoPorId.get(f.id))
      const { fecha, hora } = partesBogota(f.fecha_hora)
      const r = s.rendimiento
      return [
        fecha,
        hora,
        s.vehiculo.placa,
        s.conductor?.nombre ?? '',
        s.conductor?.numero_identificacion ?? '',
        s.kilometraje,
        decimal(s.galones, 3),
        decimal(s.valor_total, 0),
        decimal(s.precio_galon, 0),
        s.tipo_combustible,
        s.estacion ?? '',
        s.tanque_lleno ? 'Sí' : 'No (parcial)',
        s.medio_pago ?? '',
        r.km_recorridos ?? '',
        decimal(r.galones_tramo, 3),
        decimal(r.rendimiento, 2),
        decimal(r.referencia, 2),
        r.desviacion == null ? '' : decimal(r.desviacion * 100, 1),
        r.estado === 'alerta' ? 'Rendimiento bajo' : '',
        decimal(r.costo_km, 0),
        s.comprobante ? 'Sí' : 'No',
        s.observaciones ?? '',
        s.creado_por?.nombre ?? '',
      ]
        .map(celda)
        .join(CSV_SEP)
    })
    /// BOM: sin él Excel abre el UTF-8 como Latin-1 y «Estación» sale «EstaciÃ³n».
    return '﻿' + [cabecera.map(celda).join(CSV_SEP), ...lineas].join('\r\n')
  },

  /**
   * Lo que el formulario necesita para avisar antes de guardar: el tanqueo
   * anterior y el siguiente a esa fecha, el kilometraje de la ficha (que
   * alimentan los preoperacionales) y el combustible del vehículo.
   */
  async contexto(vehiculoId: string, fechaHora?: string | null, excluir?: string | null) {
    const vehiculo = await prisma.vehiculos.findFirst({
      where: { id: vehiculoId, deleted_at: null },
      select: { id: true, placa: true, combustible: true, kilometraje: true },
    })
    if (!vehiculo) throw new CombustibleError('Vehículo no encontrado', 404, 'VEHICULO_NO_ENCONTRADO')
    const instante = (fechaHora && aInstante(fechaHora)) || new Date()
    const vecinos = await vecinosDe(vehiculoId, instante, excluir)
    const iso = (x: { fecha_hora: string | Date; kilometraje: number } | null) =>
      x ? { fecha_hora: new Date(x.fecha_hora).toISOString(), kilometraje: x.kilometraje } : null
    return {
      vehiculo: { id: vehiculo.id, placa: vehiculo.placa, combustible: vehiculo.combustible, kilometraje_ficha: vehiculo.kilometraje ?? null },
      anterior: iso(vecinos.anterior),
      siguiente: iso(vecinos.siguiente),
    }
  },

  async crear(input: TanqueoInput, usuarioId: string | null) {
    await validar(input)
    const fila = await prisma.combustible_tanqueo.create({
      data: { ...datos(input), creado_por_id: usuarioId, actualizado_por_id: usuarioId },
      select: { id: true },
    })
    return releer(fila.id)
  },

  async actualizar(id: string, input: TanqueoInput, usuarioId: string | null) {
    await filaActiva(id)
    await validar(input, id)
    await prisma.combustible_tanqueo.update({
      where: { id },
      data: { ...datos(input), actualizado_por_id: usuarioId, updated_at: new Date() },
    })
    return releer(id)
  },

  /** Retiro lógico: el tramo vecino se recalcula solo al leer. */
  async eliminar(id: string, usuarioId: string | null) {
    await filaActiva(id)
    const ahora = new Date()
    await prisma.combustible_tanqueo.update({ where: { id }, data: { deleted_at: ahora, updated_at: ahora, actualizado_por_id: usuarioId } })
  },

  /**
   * Sube (o reemplaza) el comprobante. El objeto anterior se queda en S3: el
   * bucket es la evidencia, y un reemplazo por error se recupera desde ahí.
   */
  async subirComprobante(id: string, archivo: { buffer: Buffer; nombre: string; mimetype: string }, usuarioId: string | null) {
    const fila = await filaActiva(id)
    const ext = (path.extname(archivo.nombre) || (archivo.mimetype === 'application/pdf' ? '.pdf' : '.jpg')).toLowerCase()
    const key = `combustible/${fila.vehiculo_id}/${fila.id}/${randomUUID()}${ext}`
    await uploadToS3(key, archivo.buffer, archivo.mimetype)
    await prisma.combustible_tanqueo.update({
      where: { id },
      data: {
        comprobante_key: key,
        comprobante_mime: archivo.mimetype,
        comprobante_nombre: archivo.nombre.slice(0, 255),
        actualizado_por_id: usuarioId,
        updated_at: new Date(),
      },
    })
    return releer(id)
  },

  async quitarComprobante(id: string, usuarioId: string | null) {
    await filaActiva(id)
    await prisma.combustible_tanqueo.update({
      where: { id },
      data: { comprobante_key: null, comprobante_mime: null, comprobante_nombre: null, actualizado_por_id: usuarioId, updated_at: new Date() },
    })
    return releer(id)
  },

  /** URL firmada de 15 minutos para ver o descargar el comprobante. */
  async urlComprobante(id: string) {
    const fila = await filaActiva(id)
    if (!fila.comprobante_key) throw new CombustibleError('El tanqueo no tiene comprobante', 404, 'SIN_COMPROBANTE')
    return getS3SignedUrl(fila.comprobante_key, 15 * 60)
  },
}
