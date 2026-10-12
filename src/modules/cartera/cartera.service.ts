/**
 * Cartera: lo que los clientes deben por las facturas de liquidaciones de
 * servicios, los abonos con que lo van pagando y las edades de la deuda.
 *
 * Solo cuentan las facturas ACTIVAS y no eliminadas, y solo los abonos vivos
 * (`deleted_at: null`): una factura anulada no se cobra, y un abono retirado
 * que se siguiera sumando escondería deuda real.
 *
 * El saldo, el estado y la edad no se guardan: los calcula
 * `cartera.calculo.ts` en cada lectura con la fecha de hoy en Colombia.
 */
import { randomUUID } from 'crypto'
import path from 'path'
import type { Prisma } from '@prisma/client'
import { prisma } from '../../config/prisma'
import { getS3SignedUrl, uploadToS3 } from '../../config/aws'
import { aFechaDb, hoyColombia, isoDia } from '../../lib/pagos/medios'
import {
  agruparPorCliente,
  aplicadoDeAbono,
  resumirCartera,
  situacionFactura,
  type FacturaParaAgrupar,
  type SituacionFactura,
  type TramoEdad,
} from './cartera.calculo'
import { ErrorCartera, resolverCondiciones, type EntradaCondiciones } from './cartera.condiciones'
import type { FiltrosFacturasCartera, RegistrarAbonoInput } from './cartera.schema'

const MONTOS_ABONO = {
  valor: true,
  retefuente: true,
  reteica: true,
  reteiva: true,
  otros_descuentos: true,
} as const

/// Lo que cuenta para cartera. Toda lectura de este módulo parte de aquí.
const FACTURA_EN_CARTERA = { estado: 'ACTIVA' as const, deleted_at: null }

const SELECT_FACTURA = {
  id: true,
  numero_factura: true,
  fecha_facturacion: true,
  fecha_emision: true,
  plazo_dias: true,
  fecha_vencimiento: true,
  valor_total: true,
  ajuste_valor: true,
  observaciones: true,
  estado: true,
  cliente: { select: { id: true, nombre: true, nit: true } },
  abonos: {
    where: { deleted_at: null },
    select: { ...MONTOS_ABONO, fecha: true },
    orderBy: { fecha: 'desc' as const },
  },
  _count: { select: { items: { where: { deleted_at: null } } } },
} satisfies Prisma.factura_liquidacion_servicioSelect

type FilaFactura = Prisma.factura_liquidacion_servicioGetPayload<{ select: typeof SELECT_FACTURA }>

export interface FacturaCartera extends SituacionFactura {
  id: string
  numero_factura: string
  cliente: { id: string; nombre: string | null; nit: string | null } | null
  fecha_emision: string
  plazo_dias: number
  fecha_vencimiento: string
  ajuste_valor: number
  observaciones: string | null
  liquidaciones: number
  abonos: number
  ultimo_abono: string | null
}

function aFacturaCartera(f: FilaFactura, hoy: string): FacturaCartera {
  const vence = isoDia(f.fecha_vencimiento)!
  const situacion = situacionFactura({ valor_total: f.valor_total, fecha_vencimiento: vence, abonos: f.abonos }, hoy)
  return {
    id: f.id,
    numero_factura: f.numero_factura,
    cliente: f.cliente ? { id: f.cliente.id, nombre: f.cliente.nombre, nit: f.cliente.nit } : null,
    fecha_emision: isoDia(f.fecha_emision)!,
    plazo_dias: f.plazo_dias,
    fecha_vencimiento: vence,
    ajuste_valor: Number(f.ajuste_valor),
    observaciones: f.observaciones,
    liquidaciones: f._count.items,
    abonos: f.abonos.length,
    ultimo_abono: isoDia(f.abonos[0]?.fecha),
    ...situacion,
  }
}

function paraAgrupar(f: FacturaCartera): FacturaParaAgrupar {
  return {
    cliente_id: f.cliente?.id ?? null,
    cliente_nombre: f.cliente?.nombre ?? null,
    cliente_nit: f.cliente?.nit ?? null,
    fecha_vencimiento: f.fecha_vencimiento,
    situacion: f,
  }
}

async function facturasAbiertasYCerradas(where: Prisma.factura_liquidacion_servicioWhereInput, hoy: string) {
  const filas = await prisma.factura_liquidacion_servicio.findMany({
    where: { ...FACTURA_EN_CARTERA, ...where },
    select: SELECT_FACTURA,
    orderBy: [{ fecha_vencimiento: 'asc' }, { numero_factura: 'asc' }],
  })
  return filas.map((f) => aFacturaCartera(f, hoy))
}

/** Normaliza para buscar sin tildes ni mayúsculas. */
const plano = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

function coincide(q: string, campos: Array<string | null | undefined>): boolean {
  const palabras = plano(q).split(/\s+/).filter(Boolean)
  if (!palabras.length) return true
  const texto = plano(campos.filter(Boolean).join(' '))
  return palabras.every((p) => texto.includes(p))
}

/** Abono serializado para el detalle. */
function serializarAbono(a: {
  id: string
  fecha: Date
  valor: Prisma.Decimal
  retefuente: Prisma.Decimal
  reteica: Prisma.Decimal
  reteiva: Prisma.Decimal
  otros_descuentos: Prisma.Decimal
  medio: string
  referencia: string | null
  comprobante_s3_key: string | null
  comprobante_nombre: string | null
  observaciones: string | null
  created_at: Date
  creado_por: { id: string; nombre: string | null } | null
}) {
  return {
    id: a.id,
    fecha: isoDia(a.fecha)!,
    valor: Number(a.valor),
    retefuente: Number(a.retefuente),
    reteica: Number(a.reteica),
    reteiva: Number(a.reteiva),
    otros_descuentos: Number(a.otros_descuentos),
    aplicado: aplicadoDeAbono(a),
    medio: a.medio,
    referencia: a.referencia,
    tiene_comprobante: Boolean(a.comprobante_s3_key),
    comprobante_nombre: a.comprobante_nombre,
    observaciones: a.observaciones,
    creado: a.created_at.toISOString(),
    creado_por: a.creado_por ? { id: a.creado_por.id, nombre: a.creado_por.nombre } : null,
  }
}

const SELECT_ABONO_DETALLE = {
  id: true,
  fecha: true,
  ...MONTOS_ABONO,
  medio: true,
  referencia: true,
  comprobante_s3_key: true,
  comprobante_nombre: true,
  observaciones: true,
  created_at: true,
  creado_por: { select: { id: true, nombre: true } },
} satisfies Prisma.factura_liquidacion_abonoSelect

export const CarteraService = {
  /** Totales de cabecera y la tabla de edades por cliente. */
  async resumen(hoy: string = hoyColombia()) {
    const facturas = await facturasAbiertasYCerradas({}, hoy)
    const agrupables = facturas.map(paraAgrupar)
    return {
      hoy,
      resumen: resumirCartera(agrupables, hoy),
      clientes: agruparPorCliente(agrupables),
    }
  },

  /**
   * Facturas con su situación. Por defecto solo las abiertas (con saldo):
   * las pagadas se piden aparte para no arrastrar todo el histórico.
   */
  async listarFacturas(filtros: FiltrosFacturasCartera, hoy: string = hoyColombia()) {
    const where: Prisma.factura_liquidacion_servicioWhereInput = {}
    if (filtros.cliente_id === 'sin-cliente') where.cliente_id = null
    else if (filtros.cliente_id) where.cliente_id = filtros.cliente_id

    let facturas = await facturasAbiertasYCerradas(where, hoy)
    const estado = filtros.estado ?? 'abiertas'
    if (estado === 'abiertas') facturas = facturas.filter((f) => f.saldo > 0)
    else if (estado !== 'todas') facturas = facturas.filter((f) => f.estado === estado)
    if (filtros.tramo) facturas = facturas.filter((f) => f.saldo > 0 && f.tramo === (filtros.tramo as TramoEdad))
    if (filtros.q?.trim()) {
      facturas = facturas.filter((f) => coincide(filtros.q!, [f.numero_factura, f.cliente?.nombre, f.cliente?.nit]))
    }
    return { hoy, facturas }
  },

  /** Una factura con sus abonos vivos y sus liquidaciones. */
  async detalle(id: string, hoy: string = hoyColombia()) {
    const f = await prisma.factura_liquidacion_servicio.findFirst({
      where: { id, deleted_at: null },
      select: {
        ...SELECT_FACTURA,
        facturado_por: { select: { id: true, nombre: true } },
        items: {
          where: { deleted_at: null },
          select: {
            valor_liquidacion: true,
            liquidacion: { select: { id: true, consecutivo: true, mes: true, anio: true, total: true } },
          },
        },
      },
    })
    if (!f) throw new ErrorCartera('Factura no encontrada', 404, 'NO_ENCONTRADA')

    const abonos = await prisma.factura_liquidacion_abono.findMany({
      where: { factura_id: id, deleted_at: null },
      select: SELECT_ABONO_DETALLE,
      orderBy: [{ fecha: 'desc' }, { created_at: 'desc' }],
    })

    const suma = f.items.reduce((s, i) => s + Number(i.valor_liquidacion), 0)
    return {
      hoy,
      factura: {
        ...aFacturaCartera(f, hoy),
        estado_factura: f.estado,
        fecha_facturacion: f.fecha_facturacion.toISOString(),
        facturado_por: f.facturado_por,
        suma_liquidaciones: Math.round(suma * 100) / 100,
        items: f.items.map((i) => ({
          liquidacion_id: i.liquidacion.id,
          consecutivo: i.liquidacion.consecutivo,
          mes: i.liquidacion.mes,
          anio: i.liquidacion.anio,
          valor: Number(i.valor_liquidacion),
        })),
      },
      abonos: abonos.map(serializarAbono),
    }
  },

  /**
   * Registra un abono.
   *
   * La factura se bloquea (`FOR UPDATE`) mientras se recalcula el saldo: dos
   * personas registrando el mismo pago a la vez lo dejaban aplicado dos
   * veces, y el segundo pasaba la validación porque el primero aún no estaba
   * confirmado.
   *
   * El comprobante se sube ANTES de la transacción (S3 no es transaccional).
   * Si la inserción falla después, el archivo queda huérfano en S3: es el mal
   * menor frente a una fila que apunte a un archivo que no existe.
   */
  async registrarAbono(
    facturaId: string,
    input: RegistrarAbonoInput,
    usuarioId: string | null,
    archivo?: { buffer: Buffer; nombre: string; mimetype: string },
  ) {
    const previa = await prisma.factura_liquidacion_servicio.findFirst({
      where: { id: facturaId, deleted_at: null },
      select: { id: true, estado: true, numero_factura: true },
    })
    if (!previa) throw new ErrorCartera('Factura no encontrada', 404, 'NO_ENCONTRADA')
    if (previa.estado !== 'ACTIVA') {
      throw new ErrorCartera(`La factura ${previa.numero_factura} está anulada: no admite abonos.`, 409, 'FACTURA_ANULADA')
    }

    const abonoId = randomUUID()
    let s3Key: string | null = null
    if (archivo) {
      const ext = (path.extname(archivo.nombre) || '.pdf').toLowerCase()
      s3Key = `cartera/abonos/${facturaId}/${abonoId}${ext}`
      await uploadToS3(s3Key, archivo.buffer, archivo.mimetype)
    }

    const aplicadoNuevo = aplicadoDeAbono(input)
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM factura_liquidacion_servicio WHERE id = ${facturaId}::uuid FOR UPDATE`
      const f = await tx.factura_liquidacion_servicio.findUniqueOrThrow({
        where: { id: facturaId },
        select: {
          estado: true,
          deleted_at: true,
          valor_total: true,
          fecha_vencimiento: true,
          abonos: { where: { deleted_at: null }, select: MONTOS_ABONO },
        },
      })
      if (f.estado !== 'ACTIVA' || f.deleted_at) {
        throw new ErrorCartera('La factura ya no está activa.', 409, 'FACTURA_ANULADA')
      }
      const s = situacionFactura(
        { valor_total: f.valor_total, fecha_vencimiento: isoDia(f.fecha_vencimiento)!, abonos: f.abonos },
        hoyColombia(),
      )
      /// Comparación en centavos: «pagar el saldo» manda exactamente el saldo.
      if (Math.round(aplicadoNuevo * 100) > Math.round(s.saldo * 100)) {
        throw new ErrorCartera(
          `El abono (${formatoPesos(aplicadoNuevo)}) supera el saldo de la factura (${formatoPesos(Math.max(s.saldo, 0))}).`,
          409,
          'SUPERA_SALDO',
        )
      }
      await tx.factura_liquidacion_abono.create({
        data: {
          id: abonoId,
          factura_id: facturaId,
          fecha: aFechaDb(input.fecha),
          valor: input.valor,
          retefuente: input.retefuente,
          reteica: input.reteica,
          reteiva: input.reteiva,
          otros_descuentos: input.otros_descuentos,
          medio: input.medio,
          referencia: input.referencia ?? null,
          observaciones: input.observaciones ?? null,
          comprobante_s3_key: s3Key,
          comprobante_nombre: archivo?.nombre?.slice(0, 255) ?? null,
          comprobante_mime: archivo?.mimetype ?? null,
          creado_por_id: usuarioId,
        },
      })
    })

    return { abono_id: abonoId, comprobante_s3_key: s3Key, ...(await this.detalle(facturaId)) }
  },

  /** Retira un abono (borrado lógico): el saldo vuelve a subir. */
  async eliminarAbono(abonoId: string, usuarioId: string | null, motivo?: string | null) {
    const abono = await prisma.factura_liquidacion_abono.findFirst({
      where: { id: abonoId, deleted_at: null },
      select: { id: true, factura_id: true, factura: { select: { estado: true, deleted_at: true } } },
    })
    if (!abono) throw new ErrorCartera('Abono no encontrado', 404, 'NO_ENCONTRADA')
    await prisma.factura_liquidacion_abono.update({
      where: { id: abonoId },
      data: { deleted_at: new Date(), eliminado_por_id: usuarioId, motivo_eliminacion: motivo?.trim() || null },
    })
    return this.detalle(abono.factura_id)
  },

  /** URL firmada de 15 minutos del comprobante de un abono vivo. */
  async urlComprobante(abonoId: string) {
    const a = await prisma.factura_liquidacion_abono.findFirst({
      where: { id: abonoId, deleted_at: null },
      select: { comprobante_s3_key: true },
    })
    if (!a?.comprobante_s3_key) throw new ErrorCartera('El abono no tiene comprobante', 404, 'NO_ENCONTRADA')
    return getS3SignedUrl(a.comprobante_s3_key, 15 * 60)
  },

  /**
   * Corrige valor, emisión, plazo o vencimiento de una factura activa.
   *
   * El valor no puede quedar por debajo de lo ya aplicado: la factura pasaría
   * a «pagada» con saldo negativo y el abono de más quedaría sin explicación.
   */
  async actualizarCondiciones(facturaId: string, entrada: EntradaCondiciones) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM factura_liquidacion_servicio WHERE id = ${facturaId}::uuid FOR UPDATE`
      const f = await tx.factura_liquidacion_servicio.findFirst({
        where: { id: facturaId, deleted_at: null },
        select: {
          estado: true,
          numero_factura: true,
          fecha_emision: true,
          plazo_dias: true,
          ajuste_valor: true,
          abonos: { where: { deleted_at: null }, select: MONTOS_ABONO },
        },
      })
      if (!f) throw new ErrorCartera('Factura no encontrada', 404, 'NO_ENCONTRADA')
      if (f.estado !== 'ACTIVA') {
        throw new ErrorCartera(`La factura ${f.numero_factura} está anulada.`, 409, 'FACTURA_ANULADA')
      }
      const agg = await tx.factura_liquidacion_item.aggregate({
        where: { factura_id: facturaId, deleted_at: null },
        _sum: { valor_liquidacion: true },
      })
      const r = resolverCondiciones(entrada, {
        suma: Number(agg._sum.valor_liquidacion ?? 0),
        fecha_emision: isoDia(f.fecha_emision)!,
        plazo_dias: f.plazo_dias,
        ajuste_valor: Number(f.ajuste_valor),
      })
      const aplicado = f.abonos.reduce((s, a) => s + Math.round(aplicadoDeAbono(a) * 100), 0) / 100
      if (Math.round(r.valor_total * 100) < Math.round(aplicado * 100)) {
        throw new ErrorCartera(
          `El valor no puede quedar por debajo de lo ya abonado (${formatoPesos(aplicado)}).`,
          409,
          'VALOR_MENOR_QUE_ABONADO',
        )
      }
      await tx.factura_liquidacion_servicio.update({
        where: { id: facturaId },
        data: {
          valor_total: r.valor_total,
          ajuste_valor: r.ajuste_valor,
          fecha_emision: aFechaDb(r.fecha_emision),
          plazo_dias: r.plazo_dias,
          fecha_vencimiento: aFechaDb(r.fecha_vencimiento),
        },
      })
    })
    return this.detalle(facturaId)
  },
}

function formatoPesos(v: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2 }).format(v)
}
